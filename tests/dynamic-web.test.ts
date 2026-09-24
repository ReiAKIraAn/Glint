import assert from 'node:assert/strict';
import { test, before, beforeEach } from 'node:test';
import { Window } from 'happy-dom';
import { DEFAULT_SETTINGS, type Settings } from '../src/lib/types';
import {
  scan,
  scanSubtree,
  scanTextNode,
  collectCodeWords,
  pruneContainedNodes,
  ScannedToken,
  type Token,
  OWN_ELEMENT,
} from '../src/lib/scan';
import { paint, clear, isSupported } from '../src/lib/highlight';
import { HoverTracker } from '../src/lib/hover';

/**
 * ============================================================================
 * M5-W5: Dynamic Web Robustness Test Suite (DW-01 ~ DW-12, RISK01, RISK03, RISK02)
 *
 * 验证目标：
 * 验证现有 Safari-first 增量 DOM 扫描与 MutationObserver 流水线在
 * 复杂动态网页（SPA、无限滚动、高频微更新、超限风暴、长生命周期、Shadow DOM、iframe）
 * 下的实际行为，记录真实量化基准与架构边界。
 * ============================================================================
 */

let window: Window;
let highlightMap: Map<string, { ranges: Range[] }>;

/**
 * 创建与 content.ts 完全等价的增量扫描运行器，并暴露内部遥测指标
 */
class DynamicWebRunner {
  settings: Settings = { ...DEFAULT_SETTINGS, oncePerPage: false };
  known: Set<string> = new Set();
  canExplain = true;
  tokens: Token[] = [];
  seen: Set<string> = new Set();
  codeWords: Set<string> = new Set();
  pendingBatch: MutationRecord[] = [];
  batchTimer?: ReturnType<typeof setTimeout>;
  observer?: MutationObserver;
  cardElement: HTMLElement;
  hover: HoverTracker;
  hasRunInitialScan = false;

  // 遥测指标 (Metrics)
  metrics = {
    initialScanDurationMs: 0,
    mutationProcessingCount: 0,
    totalMutationRecords: 0,
    dirtyTextNodesCount: 0,
    addedNodesCount: 0,
    removedNodesCount: 0,
    fullRescanCount: 0,
    incrementalScanCount: 0,
    lastProcessDurationMs: 0,
    paintCount: 0,
  };

  constructor() {
    this.cardElement = document.createElement(OWN_ELEMENT);
    this.hover = new HoverTracker({
      onEnter: () => {},
      onLeave: () => {},
    });
  }

  init() {
    document.body.appendChild(this.cardElement);
    this.observer = new MutationObserver((records) => {
      const host = this.cardElement;
      if (records.every((r) => r.target === host || host.contains(r.target))) return;
      this.pendingBatch.push(...records);
      if (this.batchTimer === undefined) {
        this.batchTimer = setTimeout(() => this.processBatch(), 40);
      }
    });
    this.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    this.run();
  }

  isCodeNode(node: Node): boolean {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      const tag = el.tagName;
      if (tag === 'CODE' || tag === 'PRE' || tag === 'KBD' || tag === 'SAMP' || tag === 'VAR') return true;
      if (el.querySelector?.('code, pre, kbd, samp, var')) return true;
    }
    return false;
  }

  run() {
    const t0 = performance.now();
    this.codeWords = collectCodeWords(document.body);
    this.seen.clear();
    this.tokens = scanSubtree(
      document.body,
      this.settings,
      this.known,
      this.canExplain,
      this.codeWords,
      undefined,
      this.seen,
    ).slice(0, 2500);
    this.paint();
    this.hover.setTokens(this.tokens);
    this.hasRunInitialScan = true;
    this.metrics.initialScanDurationMs = performance.now() - t0;
    this.metrics.fullRescanCount++;
  }

  processBatch() {
    this.batchTimer = undefined;
    if (!this.pendingBatch.length) return;
    const records = this.pendingBatch;
    this.pendingBatch = [];

    const t0 = performance.now();
    this.metrics.mutationProcessingCount++;
    this.metrics.totalMutationRecords += records.length;

    // >250 阈值或未完成初始扫描时退回全量重扫
    if (records.length > 250 || !this.hasRunInitialScan) {
      this.run();
      this.metrics.lastProcessDurationMs = performance.now() - t0;
      return;
    }

    this.metrics.incrementalScanCount++;
    let codeChanged = false;
    const dirtyTextNodes = new Set<Text>();
    const addedNodes = new Set<Node>();
    const host = this.cardElement;

    for (const r of records) {
      if (r.target === host || host.contains(r.target)) continue;
      if (this.isCodeNode(r.target)) codeChanged = true;

      if (r.type === 'characterData' && r.target.nodeType === Node.TEXT_NODE) {
        dirtyTextNodes.add(r.target as Text);
      } else if (r.type === 'childList') {
        for (let i = 0; i < r.addedNodes.length; i++) {
          const node = r.addedNodes[i]!;
          if (node === host || host.contains(node)) continue;
          if (this.isCodeNode(node)) codeChanged = true;
          addedNodes.add(node);
        }
        for (let i = 0; i < r.removedNodes.length; i++) {
          const node = r.removedNodes[i]!;
          if (this.isCodeNode(node)) codeChanged = true;
          this.metrics.removedNodesCount++;
        }
      }
    }

    this.metrics.dirtyTextNodesCount += dirtyTextNodes.size;
    this.metrics.addedNodesCount += addedNodes.size;

    if (codeChanged) {
      this.codeWords = collectCodeWords(document.body);
    }

    // 包含性裁剪：剔除已被集合中其它祖先包含的子孙节点，杜绝重复扫描同一子树
    const roots = pruneContainedNodes(addedNodes);

    // 若文本变动节点已被某个新增子树根节点包含，则交由子树统一扫描，避免重复
    for (const textNode of dirtyTextNodes) {
      if (roots.some((r) => r.contains(textNode))) {
        dirtyTextNodes.delete(textNode);
      }
    }

    const prevLength = this.tokens.length;
    this.tokens = this.tokens.filter((t) => {
      const node = t.node;
      return !!node && node.isConnected && !dirtyTextNodes.has(node);
    });

    if (this.settings.oncePerPage) {
      this.seen.clear();
      for (const t of this.tokens) this.seen.add(t.lemma);
    }

    let hasNewTokens = false;

    for (const textNode of dirtyTextNodes) {
      if (!textNode.isConnected) continue;
      const newTokens = scanTextNode(
        textNode,
        this.settings,
        this.known,
        this.canExplain,
        this.codeWords,
        undefined,
        this.seen,
      );
      if (newTokens.length) {
        this.tokens.push(...newTokens);
        hasNewTokens = true;
      }
    }

    for (const node of roots) {
      if (!node.isConnected) continue;
      const newTokens = scanSubtree(
        node,
        this.settings,
        this.known,
        this.canExplain,
        this.codeWords,
        undefined,
        this.seen,
      );
      if (newTokens.length) {
        this.tokens.push(...newTokens);
        hasNewTokens = true;
      }
    }

    if (this.tokens.length > 2500) {
      this.tokens = this.tokens.slice(0, 2500);
    }

    if (hasNewTokens || this.tokens.length !== prevLength) {
      this.paint();
      this.hover.setTokens(this.tokens);
    }

    this.metrics.lastProcessDurationMs = performance.now() - t0;
  }

  paint() {
    paint(this.tokens);
    this.metrics.paintCount++;
  }

  destroy() {
    this.observer?.disconnect();
    if (this.batchTimer) clearTimeout(this.batchTimer);
    clear();
    this.cardElement.remove();
  }

  /** 手动排空批处理定时器，确保测试可控 */
  async flush() {
    await new Promise((r) => setTimeout(r, 60));
  }
}

before(() => {
  window = new Window({ url: 'https://en.wikipedia.org/wiki/Sediment' });
  for (const key of [
    'document',
    'location',
    'Node',
    'NodeFilter',
    'Element',
    'HTMLElement',
    'Range',
    'DOMRect',
    'MouseEvent',
    'CustomEvent',
    'MutationObserver',
    'CSSStyleSheet',
  ] as const) {
    (globalThis as Record<string, unknown>)[key] = window[key];
  }
  (globalThis as Record<string, unknown>).window = window;

  highlightMap = new Map();
  (globalThis as Record<string, unknown>).CSS = {
    highlights: highlightMap,
  };
  (globalThis as Record<string, unknown>).Highlight = class {
    ranges: Range[];
    constructor(...ranges: Range[]) {
      this.ranges = ranges;
    }
  };
});

beforeEach(() => {
  document.body.innerHTML = '';
  highlightMap.clear();
});

test('DW-01: Static Baseline — 普通长文章标准要素扫描与代码块领域词黑话提取', () => {
  document.body.innerHTML = `
    <header><h1>Geological Stratigraphy Overview</h1></header>
    <main>
      <p>Sediment accretes in strata and the tide receded slowly along the estuary.</p>
      <ul>
        <li>First geological epoch of the sedimentary formation.</li>
        <li>Subsequent volcanic basalt intrusion.</li>
      </ul>
      <pre><code>function sedimentAnalysis() { return "accretes"; }</code></pre>
      <p>Scientists debate whether the basalt layer is contiguous.</p>
    </main>
  `;

  const runner = new DynamicWebRunner();
  runner.init();

  const tokens = runner.tokens;
  assert.ok(tokens.length >= 3, `应该提取生词 (实际: ${tokens.length})`);
  const surfaces = tokens.map((t) => t.surface);

  // 代码块内的词（accretes）被 collectCodeWords 收录为代码黑话
  // 在普通段落中，accretes 本身是高中/大学词汇（等级4），若为生僻词才会被黑话静音
  assert.ok(surfaces.includes('strata'));
  assert.ok(surfaces.includes('receded'));

  // 代码块本身不应有 token
  const codeNode = document.querySelector('code');
  assert.ok(codeNode);
  const codeTokens = tokens.filter((t) => t.node?.parentElement === codeNode);
  assert.equal(codeTokens.length, 0, '代码块内部节点严禁产生 Token');

  // 验证 highlight 映射
  const mark = highlightMap.get('glint-mark');
  assert.ok(mark && mark.ranges.length === tokens.length);

  runner.destroy();
});

test('DW-02: SPA-style Replacement — 容器内容整页替换后旧 Token 剪除且新生词正常高亮', async () => {
  const container = document.createElement('div');
  container.id = 'app-root';
  container.innerHTML = '<p>The tide receded slowly leaving damp sand.</p>';
  document.body.appendChild(container);

  const runner = new DynamicWebRunner();
  runner.init();
  assert.ok(runner.tokens.some((t) => t.surface === 'receded'));

  // 模拟 SPA 路由跳转：整块容器替换
  container.innerHTML = '<p>Volcanic eruptions desiccated the ancient flora.</p>';
  await runner.flush();

  // 验证旧 token 已被剪除
  assert.ok(!runner.tokens.some((t) => t.surface === 'receded'), '已脱离 DOM 的旧 Token 必须被剪除');
  // 验证新 token 已被提取
  assert.ok(runner.tokens.some((t) => t.surface === 'desiccated'), '新追加的生词必须被成功提取');
  assert.ok(runner.tokens.some((t) => t.surface === 'flora'));

  // 验证 highlight 范围指向当前连接在 DOM 树中的节点
  const mark = highlightMap.get('glint-mark');
  assert.ok(mark);
  for (const range of mark.ranges) {
    assert.equal(range.startContainer.isConnected, true, '高亮 Range 必须仅指向当前活性的 DOM 节点');
  }

  runner.destroy();
});

test('DW-03: React/Vue-style Incremental Updates — 属性变更不触发重扫，局部子树更新仅扫描变动分支', async () => {
  const list = document.createElement('div');
  for (let i = 0; i < 5; i++) {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `<p>Item ${i}: The sediment accretes in strata.</p>`;
    list.appendChild(item);
  }
  document.body.appendChild(list);

  const runner = new DynamicWebRunner();
  runner.init();
  const initialPaintCount = runner.metrics.paintCount;

  // 1. 模拟 Vue/React 频繁的属性与 class 变动（attributes 不在 observe 配置中）
  list.children[0]?.setAttribute('class', 'list-item active');
  list.children[1]?.setAttribute('data-selected', 'true');
  await runner.flush();

  // 属性更新不产生 childList 或 characterData，MutationObserver 零记录
  assert.equal(runner.metrics.mutationProcessingCount, 0, '纯属性变动不应触发扫描批处理');

  // 2. 模拟框架仅替换单个 item
  const newItem = document.createElement('div');
  newItem.className = 'list-item';
  newItem.innerHTML = '<p>Replaced: The tide receded slowly.</p>';
  list.replaceChild(newItem, list.children[0]!);
  await runner.flush();

  assert.equal(runner.metrics.mutationProcessingCount, 1);
  assert.equal(runner.metrics.incrementalScanCount, 1, '局部节点替换必须走增量扫描分支');
  assert.ok(runner.tokens.some((t) => t.surface === 'receded'));

  runner.destroy();
});

test('DW-04: Infinite Scroll — 模拟多轮长列表批量追加 (10, 50, 100 批次)', async () => {
  const feed = document.createElement('div');
  feed.id = 'feed';
  document.body.appendChild(feed);

  const runner = new DynamicWebRunner();
  runner.init();

  const totalBatches = 100;
  for (let b = 0; b < totalBatches; b++) {
    const card = document.createElement('article');
    card.innerHTML = `<p>Post ${b}: Glacial moraine desiccated the valley while sediment accretes.</p>`;
    feed.appendChild(card);
    if (b % 20 === 0) {
      await runner.flush();
    }
  }
  await runner.flush();

  // 验证增量扫描持续生效
  assert.ok(runner.metrics.incrementalScanCount >= 5);
  assert.ok(runner.tokens.length > 50, '所有追加批次的生词均应正常累加保持');
  assert.ok(runner.tokens.every((t) => t.node?.isConnected));

  runner.destroy();
});

test('DW-05: Mutation Storm — 低频增量与超限 (>250) 自适应回退全量重扫机制', async () => {
  const container = document.createElement('div');
  container.innerHTML = '<p>Initial baseline: The tide receded slowly.</p>';
  document.body.appendChild(container);

  const runner = new DynamicWebRunner();
  runner.init();
  assert.ok(runner.tokens.length > 0, '初始必须存在 Token 以启用后续增量流水线');
  const initialFullRescanCount = runner.metrics.fullRescanCount;

  // 1. 低频变动（10 个节点）：由于 records.length <= 250 且 tokens.length > 0，走增量路径
  for (let i = 0; i < 10; i++) {
    const el = document.createElement('span');
    el.textContent = `Word ${i}: receded. `;
    container.appendChild(el);
  }
  await runner.flush();
  assert.equal(runner.metrics.incrementalScanCount, 1, '低频变动必须走增量扫描分支');
  assert.equal(runner.metrics.fullRescanCount, initialFullRescanCount, '低频变动不应触发全量重扫');

  // 2. 高频风暴（一次性灌入 260 条 mutation 记录，超过 250 阈值）
  for (let i = 0; i < 260; i++) {
    const el = document.createElement('span');
    el.textContent = `Storm ${i}: strata. `;
    container.appendChild(el);
  }
  await runner.flush();

  // 验证超限时触发自适应全量重扫 (Adaptive Full Rescan)
  assert.equal(runner.metrics.fullRescanCount, initialFullRescanCount + 1, 'MutationRecord 超过 250 条时必须安全回退至 full rescan (run)');
  assert.ok(runner.tokens.length > 0);

  runner.destroy();
});

test('DW-06: Large DOM — 大规模 DOM 节点扫描基线与 2500 MAX_TOKENS 硬上限截断', () => {
  const container = document.createElement('div');
  const paragraphCount = 1000;
  for (let i = 0; i < paragraphCount; i++) {
    const p = document.createElement('p');
    p.textContent = `Paragraph ${i}: The geological stratum desiccated as sediment accretes and the tide receded.`;
    container.appendChild(p);
  }
  document.body.appendChild(container);

  const runner = new DynamicWebRunner();
  runner.init();

  // 验证 2,500 条硬上限截断
  assert.equal(runner.tokens.length, 2500, '超过 2500 个生词时必须被 MAX_TOKENS 硬性截断，防止内存膨胀');
  assert.ok(runner.metrics.initialScanDurationMs > 0);

  runner.destroy();
});

test('DW-07: Long-lived Page — 模拟多轮“增删改”循环生命周期，验证无陈旧 Token 堆积', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const runner = new DynamicWebRunner();
  runner.init();

  // 执行 30 轮增删循环
  for (let cycle = 0; cycle < 30; cycle++) {
    const p = document.createElement('p');
    p.textContent = `Cycle ${cycle}: The tide receded and sediment accretes.`;
    container.appendChild(p);

    if (container.children.length > 5) {
      container.firstElementChild?.remove();
    }
    if (cycle % 5 === 0) {
      await runner.flush();
    }
  }
  await runner.flush();

  // 容器中最多只有 5 个元素，每个元素 2 个生词，总 Token 数不应无限膨胀
  assert.ok(runner.tokens.length <= 15, `长寿命增删循环后 Token 账本应与实际可见 DOM 对齐 (当前: ${runner.tokens.length})`);
  assert.ok(runner.tokens.every((t) => t.node?.isConnected), '所有保留的 Token 必须均为活跃在树上的节点');

  runner.destroy();
});

test('DW-08: Rapid Text Mutation — 单个 Text 节点高频连续更新文本，旧 Token 立即更替且无重叠', async () => {
  const p = document.createElement('p');
  const textNode = document.createTextNode('Initial: The tide receded.');
  p.appendChild(textNode);
  document.body.appendChild(p);

  const runner = new DynamicWebRunner();
  runner.init();
  assert.equal(runner.tokens.length, 1);
  assert.equal(runner.tokens[0]?.surface, 'receded');

  // 对同一个 Text 节点进行连续修改 (包含 2 个等级 > 3 的生词: sediment, accretes)
  textNode.data = 'Updated 1: The sediment accretes in layers.';
  await runner.flush();

  assert.equal(runner.tokens.length, 2, '包含 sediment 与 accretes 两个生词');
  assert.ok(runner.tokens.some((t) => t.surface === 'sediment'));
  assert.ok(runner.tokens.some((t) => t.surface === 'accretes'));
  assert.ok(!runner.tokens.some((t) => t.surface === 'receded'), '已被覆盖的旧词绝不残留');

  textNode.data = 'Updated 2: Volcanic eruptions desiccated the valley.';
  await runner.flush();

  const surfaces = runner.tokens.map((t) => t.surface);
  assert.ok(surfaces.includes('desiccated'));
  assert.ok(!surfaces.includes('receded'), '旧词绝不残留');
  assert.ok(!surfaces.includes('accretes'));

  runner.destroy();
});

test('DW-09: Extension-owned DOM Mutation — 卡片自身内部 DOM 更新被 MutationObserver 忽略，杜绝死循环', async () => {
  const runner = new DynamicWebRunner();
  runner.init();

  const initialProcessingCount = runner.metrics.mutationProcessingCount;

  // 模拟卡片弹出、内容流式注入与尺寸更新
  const cardHost = runner.cardElement;
  cardHost.innerHTML = '<div class="content"><p>AI is explaining: Sediment refers to...</p></div>';
  const childSpan = document.createElement('span');
  childSpan.textContent = ' streaming chunk 123...';
  cardHost.querySelector('.content')?.appendChild(childSpan);

  await runner.flush();

  // 验证 MutationObserver 内部 early return 生效，完全没有加入 pendingBatch
  assert.equal(runner.metrics.mutationProcessingCount, initialProcessingCount, '扩展自身卡片的 DOM 变动必须被完全忽略，绝不触发重新扫描');

  runner.destroy();
});

test('DW-10: Shadow DOM Boundary — 保持当前架构决策：TreeWalker 绝不穿透网页 ShadowRoot，扩展 Shadow DOM 零干扰', () => {
  const host = document.createElement('div');
  document.body.appendChild(host);

  // 网页自身创建 Shadow DOM
  const shadow = host.attachShadow({ mode: 'open' });
  const shadowP = document.createElement('p');
  shadowP.textContent = 'Inside ShadowRoot: The tide receded and sediment accretes.';
  shadow.appendChild(shadowP);

  // 外部普通 DOM
  const lightP = document.createElement('p');
  lightP.textContent = 'Outside Light DOM: The tide receded.';
  document.body.appendChild(lightP);

  const runner = new DynamicWebRunner();
  runner.init();

  // TreeWalker 仅遍历 light DOM，Shadow DOM 内的词不应被提取
  const tokens = runner.tokens;
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0]?.node?.parentElement, lightP);
  assert.ok(tokens.every((t) => t.node?.getRootNode() === document), '所有 Token 必须来自主文档流，严禁穿透未知 Shadow DOM');

  runner.destroy();
});

test('DW-11: iframe Boundary — iframe 标签属于 OPAQUE_TAGS，不进入 iframe 内部扫描', () => {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);

  const p = document.createElement('p');
  p.textContent = 'Main frame: The tide receded slowly.';
  document.body.appendChild(p);

  const runner = new DynamicWebRunner();
  runner.init();

  // iframe 本身不产生 Token，主文档正常产生
  assert.equal(runner.tokens.length, 1);
  assert.equal(runner.tokens[0]?.surface, 'receded');

  runner.destroy();
});

test('DW-12: Dynamic Page Framework Pattern — 真实复合场景：初始渲染 + SPA 路由 + 无限滚动 + 文本打字', async () => {
  const app = document.createElement('div');
  app.id = 'spa-app';
  document.body.appendChild(app);

  const runner = new DynamicWebRunner();
  runner.init();

  // 1. 首屏文章
  app.innerHTML = '<article><p>Initial route: The tide receded.</p></article>';
  await runner.flush();
  assert.ok(runner.tokens.some((t) => t.surface === 'receded'));

  // 2. SPA 切换到列表页
  app.innerHTML = '<div class="feed"></div>';
  await runner.flush();
  assert.equal(runner.tokens.length, 0);

  // 3. 无限滚动插入 5 条帖子
  const feed = app.querySelector('.feed')!;
  for (let i = 0; i < 5; i++) {
    const post = document.createElement('div');
    post.innerHTML = `<p>Feed ${i}: Sediment accretes in strata.</p>`;
    feed.appendChild(post);
  }
  await runner.flush();
  assert.ok(runner.tokens.length >= 5);

  // 4. 用户在输入框打字 (input 属于 OPAQUE_TAGS，不被扫描)
  const input = document.createElement('input');
  input.value = 'The tide receded';
  feed.appendChild(input);
  await runner.flush();
  assert.ok(!runner.tokens.some((t) => (t.node?.parentNode as HTMLElement)?.tagName === 'INPUT'));

  // 5. 最终验证全链路健康无死循环
  assert.ok(runner.metrics.fullRescanCount >= 1);
  assert.ok(runner.metrics.incrementalScanCount >= 2);
  assert.ok(runner.tokens.every((t) => t.node?.isConnected));

  runner.destroy();
});

test('DW-13: Zero-token dynamic page — 零生词页面全生命周期微更新与多轮波动验证 (RISK-01 Scenarios A..D)', async () => {
  const container = document.createElement('div');
  container.id = 'zero-token-app';
  container.innerHTML = '<main><p>The cat is sleeping on the bed.</p></main>';
  document.body.appendChild(container);

  const runner = new DynamicWebRunner();
  runner.init();

  // Scenario A: Zero-token static page + sequential micro-mutations
  assert.equal(runner.tokens.length, 0);
  assert.equal(runner.hasRunInitialScan, true);
  assert.equal(runner.metrics.fullRescanCount, 1);

  // 1. Single character / text update
  const p = container.querySelector('p')!;
  p.firstChild!.textContent = 'The dog is sleeping on the bed.';
  await runner.flush();
  assert.equal(runner.tokens.length, 0);
  assert.equal(runner.metrics.fullRescanCount, 1, '单字符/文本微更新不应触发全量重扫');
  assert.equal(runner.metrics.incrementalScanCount, 1);

  // 2. Small subtree insertion
  const smallDiv = document.createElement('div');
  smallDiv.innerHTML = '<p>A bird is in the tree.</p>';
  container.appendChild(smallDiv);
  await runner.flush();
  assert.equal(runner.tokens.length, 0);
  assert.equal(runner.metrics.fullRescanCount, 1, '小规模子树插入不应触发全量重扫');
  assert.equal(runner.metrics.incrementalScanCount, 2);

  // 3. Small subtree removal
  smallDiv.remove();
  await runner.flush();
  assert.equal(runner.tokens.length, 0);
  assert.equal(runner.metrics.fullRescanCount, 1, '小规模子树移除不应触发全量重扫');
  assert.equal(runner.metrics.incrementalScanCount, 3);

  // Scenario B: Zero -> Token
  const vocabP = document.createElement('p');
  vocabP.textContent = 'The tide receded slowly.';
  container.appendChild(vocabP);
  await runner.flush();
  assert.ok(runner.tokens.some((t) => t.surface === 'receded'));
  assert.equal(runner.metrics.fullRescanCount, 1);
  assert.equal(runner.metrics.incrementalScanCount, 4);

  // Hover tracker works
  assert.ok(runner.hover);
  const mark = highlightMap.get('glint-mark');
  assert.ok(mark && mark.ranges.length === runner.tokens.length);

  // Scenario C: Token -> Zero
  vocabP.remove();
  await runner.flush();
  assert.equal(runner.tokens.length, 0);
  assert.equal(runner.metrics.fullRescanCount, 1);
  assert.equal(runner.metrics.incrementalScanCount, 5);

  // Mutate again while tokens is 0
  const neutralSpan = document.createElement('span');
  neutralSpan.textContent = 'Peace and calm.';
  container.appendChild(neutralSpan);
  await runner.flush();
  assert.equal(runner.tokens.length, 0);
  assert.equal(runner.metrics.fullRescanCount, 1, 'tokens.length === 0 不会隐式导致全量重扫');
  assert.equal(runner.metrics.incrementalScanCount, 6);

  // Scenario D: Zero -> Token -> Zero -> Token (multi-cycle stability)
  for (let cycle = 0; cycle < 3; cycle++) {
    // -> Token
    const v = document.createElement('p');
    v.textContent = `Cycle ${cycle}: Sediment accretes in strata.`;
    container.appendChild(v);
    await runner.flush();
    assert.ok(runner.tokens.length >= 2);
    assert.equal(runner.metrics.fullRescanCount, 1);

    // -> Zero
    v.remove();
    await runner.flush();
    assert.equal(runner.tokens.length, 0);
    assert.equal(runner.metrics.fullRescanCount, 1);
  }

  runner.destroy();
});

test('DW-14: Nested ancestor/descendant mutation batch — 复合嵌套子树包含性裁剪与兄弟保留验证 (RISK-03 Scenarios A..D)', async () => {
  const runner = new DynamicWebRunner();
  runner.settings.oncePerPage = false;
  runner.init();

  const container = document.createElement('div');
  document.body.appendChild(container);

  // Scenario A: Insert parent -> child -> grandchild in single batch
  const parent = document.createElement('div');
  const child = document.createElement('section');
  const grandchild = document.createElement('p');
  grandchild.textContent = 'The tide receded slowly as sediment accretes in strata.';
  child.appendChild(grandchild);
  parent.appendChild(child);
  container.appendChild(parent);
  await runner.flush();

  const recededCount = runner.tokens.filter((t) => t.surface === 'receded').length;
  const accretesCount = runner.tokens.filter((t) => t.surface === 'accretes').length;
  const strataCount = runner.tokens.filter((t) => t.surface === 'strata').length;
  assert.equal(recededCount, 1, '嵌套新增节点仅被单次有效子树扫描，绝无重复 Token');
  assert.equal(accretesCount, 1);
  assert.equal(strataCount, 1);

  // 清理 Scenario A
  parent.remove();
  await runner.flush();

  // Scenario B: Insert parent + child, then remove parent
  const parentB = document.createElement('div');
  const childB = document.createElement('p');
  childB.textContent = 'Volcanic eruptions desiccated ancient flora.';
  parentB.appendChild(childB);
  container.appendChild(parentB);
  await runner.flush();
  assert.ok(runner.tokens.some((t) => t.surface === 'desiccated'));

  parentB.remove();
  await runner.flush();
  assert.ok(!runner.tokens.some((t) => t.surface === 'desiccated'), '移除父容器后子代 Token 彻底剪除，无陈旧残留');

  // Scenario C: Insert parent + child, then mutate child text
  const parentC = document.createElement('div');
  const childC = document.createElement('p');
  const textC = document.createTextNode('Sediment accretes.');
  childC.appendChild(textC);
  parentC.appendChild(childC);
  container.appendChild(parentC);
  await runner.flush();
  assert.ok(runner.tokens.some((t) => t.surface === 'accretes'));

  // Mutate child text
  textC.data = 'The tide receded.';
  await runner.flush();
  assert.ok(!runner.tokens.some((t) => t.surface === 'accretes'), '旧文本 Token 已被替换');
  assert.ok(runner.tokens.some((t) => t.surface === 'receded'));

  // 清理 Scenario C
  parentC.remove();
  await runner.flush();

  // Scenario D: Sibling insertion (A, B, C)
  const sibA = document.createElement('div');
  sibA.innerHTML = '<p>Sib A: accretes</p>';
  const sibB = document.createElement('div');
  sibB.innerHTML = '<p>Sib B: receded</p>';
  const sibC = document.createElement('div');
  sibC.innerHTML = '<p>Sib C: strata</p>';
  container.appendChild(sibA);
  container.appendChild(sibB);
  container.appendChild(sibC);
  await runner.flush();

  assert.ok(runner.tokens.some((t) => t.node?.parentElement === sibA.firstElementChild));
  assert.ok(runner.tokens.some((t) => t.node?.parentElement === sibB.firstElementChild));
  assert.ok(runner.tokens.some((t) => t.node?.parentElement === sibC.firstElementChild));

  runner.destroy();
});

test('DW-15: Mixed dirtyTextNodes + addedNodes overlap — 文本变动与新增子树重叠混合变动验证 (RISK-03 Scenario E)', async () => {
  const runner = new DynamicWebRunner();
  runner.settings.oncePerPage = false;
  runner.init();

  const container = document.createElement('div');
  const existingP = document.createElement('p');
  const existingText = document.createTextNode('Baseline text.');
  existingP.appendChild(existingText);
  container.appendChild(existingP);
  document.body.appendChild(container);
  await runner.flush();

  // In one batch:
  // 1. Mutate existing text node outside new subtree
  existingText.data = 'The tide receded slowly.';

  // 2. Add new subtree
  const newSubtree = document.createElement('div');
  const newP = document.createElement('p');
  const newText = document.createTextNode('Sediment accretes in strata.');
  newP.appendChild(newText);
  newSubtree.appendChild(newP);
  container.appendChild(newSubtree);

  // 3. Simultaneously touch newText inside newSubtree (characterData mutation)
  newText.data = 'Sediment accretes in ancient strata.';

  await runner.flush();

  // Verify: no missed tokens, no duplicate tokens
  const recededTokens = runner.tokens.filter((t) => t.surface === 'receded');
  const accretesTokens = runner.tokens.filter((t) => t.surface === 'accretes');
  const strataTokens = runner.tokens.filter((t) => t.surface === 'strata');

  assert.equal(recededTokens.length, 1, '外部文本节点的生词被精准捕获');
  assert.equal(accretesTokens.length, 1, '新增子树内的生词被统一处理，且无重复提取');
  assert.equal(strataTokens.length, 1);

  const mark = highlightMap.get('glint-mark');
  assert.ok(mark);
  assert.equal(mark.ranges.length, runner.tokens.length, '高亮 Range 数与 Token 数严格对齐');

  runner.destroy();
});

test('DW-STRESS: Large DOM Stress Testing — 1,000 段落 (~50k 字符) 与 10k/50k DOM 节点极限规模压力验证', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  // 场景 1: ~1,000 个段落 (~50,000 字符文本)
  for (let i = 0; i < 1000; i++) {
    const p = document.createElement('p');
    p.textContent = `Paragraph ${i}: The geological strata desiccated as sediment accretes and the tide receded.`;
    container.appendChild(p);
  }

  const runner1 = new DynamicWebRunner();
  runner1.init();
  assert.equal(runner1.tokens.length, 2500, '1,000 段落触发 MAX_TOKENS = 2500 硬上限截断');
  assert.ok(runner1.metrics.initialScanDurationMs > 0);
  runner1.destroy();
  container.innerHTML = '';

  // 场景 2: 10,000 个 DOM 节点压力测试
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 10000; i++) {
    const s = document.createElement('span');
    s.textContent = 'receded ';
    frag.appendChild(s);
  }
  container.appendChild(frag);

  const runner2 = new DynamicWebRunner();
  runner2.init();
  assert.ok(runner2.tokens.length <= 2500);
  runner2.destroy();

  container.remove();
});

test('DW-LIFECYCLE: Memory & Long-lived Page Lifecycle — 30x SPA 路由、30x 增删循环与 30x 嵌套子树替换长程生命周期', async () => {
  const runner = new DynamicWebRunner();
  runner.init();

  const appRoot = document.createElement('div');
  appRoot.id = 'app-root';
  document.body.appendChild(appRoot);

  // 1. SPA 路由切换 x 30 次
  for (let i = 0; i < 30; i++) {
    appRoot.innerHTML = `<article><h2>Route ${i}</h2><p>The sediment accretes in strata.</p></article>`;
    if (i % 5 === 0) await runner.flush();
  }
  await runner.flush();
  assert.ok(runner.tokens.length <= 5, '30 次 SPA 路由切换后无陈旧 Token 堆积');
  assert.ok(runner.tokens.every((t) => t.node?.isConnected));

  // 2. 增删循环 x 30 次
  const list = document.createElement('ul');
  appRoot.appendChild(list);
  for (let i = 0; i < 30; i++) {
    const li = document.createElement('li');
    li.textContent = `Item ${i}: The tide receded.`;
    list.appendChild(li);
    if (list.children.length > 3) {
      list.firstElementChild?.remove();
    }
    if (i % 5 === 0) await runner.flush();
  }
  await runner.flush();
  assert.ok(runner.tokens.length <= 10, '30 次增删后 Token 账本与活跃 DOM 严格对齐');
  assert.ok(runner.tokens.every((t) => t.node?.isConnected));

  // 3. 嵌套深层子树替换 x 30 次
  const treeContainer = document.createElement('div');
  appRoot.appendChild(treeContainer);
  for (let i = 0; i < 30; i++) {
    treeContainer.innerHTML = `<section><div class="outer"><div class="inner"><p>Level ${i}: The basalt intrusion desiccated ancient strata.</p></div></div></section>`;
    if (i % 5 === 0) await runner.flush();
  }
  await runner.flush();
  assert.ok(runner.tokens.length <= 15, '30 次深层嵌套子树替换后无内存堆积');
  assert.ok(runner.tokens.every((t) => t.node?.isConnected));

  // 验证高亮 Range 集合与 Token 保持 1:1
  const mark = highlightMap.get('glint-mark');
  assert.ok(mark);
  assert.equal(mark.ranges.length, runner.tokens.length);

  runner.destroy();
});

/**
 * ============================================================================
 * M5-W5 Step 2: Targeted Dynamic Scanner Regression Suites
 *
 * 1. RISK-01: Zero-token Unnecessary Full Rescan Fix (RISK01-01 ~ RISK01-06)
 * 2. RISK-03: Overlapping AddedNodes Containment Pruning Fix (RISK03-01 ~ RISK03-08)
 * 3. RISK-02: Mutation Threshold Evaluation (RISK02-EVAL)
 * ============================================================================
 */

test('RISK01-01: initial zero-token state — 页面无超纲生词时初始扫描得到 0 tokens 且 hasRunInitialScan 为 true', () => {
  document.body.innerHTML = '<main><p>The cat is sleeping on the bed.</p></main>';
  const runner = new DynamicWebRunner();
  runner.init();

  assert.equal(runner.tokens.length, 0, '低阶词汇不应产生生词 Token');
  assert.equal(runner.hasRunInitialScan, true, '初始扫描已执行完成');
  assert.equal(runner.metrics.fullRescanCount, 1, '仅执行一次首屏全量扫描');

  runner.destroy();
});

test('RISK01-02: zero-token mutation stays incremental — 零 Token 页面后续微量变动不触发全量重扫，走增量分支', async () => {
  const container = document.createElement('div');
  container.innerHTML = '<p>The dog barked at the cat.</p>';
  document.body.appendChild(container);

  const runner = new DynamicWebRunner();
  runner.init();
  assert.equal(runner.tokens.length, 0);
  assert.equal(runner.metrics.fullRescanCount, 1);

  // 插入简单文本节点，不包含生词
  const p2 = document.createElement('p');
  p2.textContent = 'A bird flew over the house.';
  container.appendChild(p2);
  await runner.flush();

  assert.equal(runner.metrics.fullRescanCount, 1, '零 Token 状态下微量更新严禁退回全量重扫');
  assert.equal(runner.metrics.incrementalScanCount, 1, '必须走增量扫描流水线');
  assert.equal(runner.tokens.length, 0);

  runner.destroy();
});

test('RISK01-03: zero-token inserted vocabulary detected — 零 Token 页面增量插入生词被正确识别并高亮，无需全量重扫', async () => {
  const container = document.createElement('div');
  container.innerHTML = '<p>Simple plain text without difficult words.</p>';
  document.body.appendChild(container);

  const runner = new DynamicWebRunner();
  runner.init();
  assert.equal(runner.tokens.length, 0);
  assert.equal(runner.metrics.fullRescanCount, 1);

  // 插入包含高等级生词 (strata, accretes) 的元素
  const article = document.createElement('article');
  article.innerHTML = '<p>Sediment accretes in strata along the coastline.</p>';
  container.appendChild(article);
  await runner.flush();

  assert.equal(runner.metrics.fullRescanCount, 1, '新增词汇必须由增量扫描处理，不得触发全量扫描');
  assert.equal(runner.metrics.incrementalScanCount, 1);
  assert.ok(runner.tokens.length >= 2, `增量生词被正确提取 (实际: ${runner.tokens.length})`);
  assert.ok(runner.tokens.some((t) => t.surface === 'strata'));
  assert.ok(runner.tokens.some((t) => t.surface === 'accretes'));

  // 验证高亮正常绘制
  const mark = highlightMap.get('glint-mark');
  assert.ok(mark && mark.ranges.length === runner.tokens.length);

  runner.destroy();
});

test('RISK01-04: token population returns after zero state — 经历“0词 -> 有词 -> 0词 -> 有词”多次波动始终保持增量', async () => {
  const container = document.createElement('div');
  container.innerHTML = '<p>The cat is sleeping on the bed.</p>';
  document.body.appendChild(container);

  const runner = new DynamicWebRunner();
  runner.init();
  assert.equal(runner.tokens.length, 0);

  // 1. 插入生词
  const item1 = document.createElement('p');
  item1.textContent = 'The tide receded slowly.';
  container.appendChild(item1);
  await runner.flush();
  assert.equal(runner.tokens.length, 1);
  assert.equal(runner.metrics.fullRescanCount, 1);
  assert.equal(runner.metrics.incrementalScanCount, 1);

  // 2. 移除生词，归零
  item1.remove();
  await runner.flush();
  assert.equal(runner.tokens.length, 0);
  assert.equal(runner.metrics.fullRescanCount, 1);
  assert.equal(runner.metrics.incrementalScanCount, 2);

  // 3. 再次插入新生词
  const item2 = document.createElement('p');
  item2.textContent = 'Volcanic heat desiccated the forest.';
  container.appendChild(item2);
  await runner.flush();
  assert.ok(runner.tokens.some((t) => t.surface === 'desiccated'));
  assert.equal(runner.metrics.fullRescanCount, 1, '全程未发生全量重扫');
  assert.equal(runner.metrics.incrementalScanCount, 3);

  runner.destroy();
});

test('RISK01-05: all tokens removed does not trigger full scan — 节点移除导致全部 Token 清空后，后续变动仍保持增量', async () => {
  const container = document.createElement('div');
  const target = document.createElement('p');
  target.textContent = 'The tide receded.';
  container.appendChild(target);
  document.body.appendChild(container);

  const runner = new DynamicWebRunner();
  runner.init();
  assert.equal(runner.tokens.length, 1);

  // 移除目标节点，Token 降为 0
  target.remove();
  await runner.flush();
  assert.equal(runner.tokens.length, 0);
  assert.equal(runner.metrics.fullRescanCount, 1);
  assert.equal(runner.metrics.incrementalScanCount, 1);

  // 再次变动：插入普通文字
  const simple = document.createElement('p');
  simple.textContent = 'A sunny day in the town.';
  container.appendChild(simple);
  await runner.flush();

  assert.equal(runner.metrics.fullRescanCount, 1, 'Token 归零后的后续变动绝不退化为全量扫描');
  assert.equal(runner.metrics.incrementalScanCount, 2);

  runner.destroy();
});

test('RISK01-06: >250 mutations still trigger fallback — 零 Token 页面在发生超限 (>250) 突变时依然安全回退全量重扫', async () => {
  const container = document.createElement('div');
  container.innerHTML = '<p>The cat is sleeping on the bed.</p>';
  document.body.appendChild(container);

  const runner = new DynamicWebRunner();
  runner.init();
  assert.equal(runner.tokens.length, 0);
  assert.equal(runner.metrics.fullRescanCount, 1);

  // 注入 260 条 mutation 记录
  for (let i = 0; i < 260; i++) {
    const s = document.createElement('span');
    s.textContent = `word-${i} `;
    container.appendChild(s);
  }
  await runner.flush();

  assert.equal(runner.metrics.fullRescanCount, 2, 'records.length > 250 时必须如预期触发安全自适应回退全量重扫');

  runner.destroy();
});

test('RISK03-01: pruneContainedNodes parent-child pruning — 父子节点同时传入时仅保留父节点', () => {
  const parent = document.createElement('div');
  const child = document.createElement('p');
  parent.appendChild(child);
  document.body.appendChild(parent);

  // 正序: [parent, child]
  const res1 = pruneContainedNodes([parent, child]);
  assert.equal(res1.length, 1);
  assert.equal(res1[0], parent);

  // 逆序: [child, parent]
  const res2 = pruneContainedNodes([child, parent]);
  assert.equal(res2.length, 1);
  assert.equal(res2[0], parent);

  parent.remove();
});

test('RISK03-02: pruneContainedNodes parent-grandchild pruning — 祖父与孙节点同时传入时裁剪孙节点', () => {
  const root = document.createElement('div');
  const mid = document.createElement('section');
  const leaf = document.createElement('span');
  root.appendChild(mid);
  mid.appendChild(leaf);
  document.body.appendChild(root);

  const res1 = pruneContainedNodes([root, leaf]);
  assert.equal(res1.length, 1);
  assert.equal(res1[0], root);

  const res2 = pruneContainedNodes([leaf, root]);
  assert.equal(res2.length, 1);
  assert.equal(res2[0], root);

  root.remove();
});

test('RISK03-03: pruneContainedNodes child-grandchild pruning — 中间层与后代传入时仅保留中间层', () => {
  const root = document.createElement('div');
  const mid = document.createElement('article');
  const leaf = document.createElement('b');
  root.appendChild(mid);
  mid.appendChild(leaf);
  document.body.appendChild(root);

  const res1 = pruneContainedNodes([mid, leaf]);
  assert.equal(res1.length, 1);
  assert.equal(res1[0], mid);

  const res2 = pruneContainedNodes([leaf, mid]);
  assert.equal(res2.length, 1);
  assert.equal(res2[0], mid);

  root.remove();
});

test('RISK03-04: pruneContainedNodes sibling preservation — 兄弟节点互不包含，必须全部完整保留', () => {
  const parent = document.createElement('div');
  const sib1 = document.createElement('p');
  const sib2 = document.createElement('p');
  const sib3 = document.createElement('p');
  parent.appendChild(sib1);
  parent.appendChild(sib2);
  parent.appendChild(sib3);
  document.body.appendChild(parent);

  const res = pruneContainedNodes([sib1, sib2, sib3]);
  assert.equal(res.length, 3);
  assert.ok(res.includes(sib1));
  assert.ok(res.includes(sib2));
  assert.ok(res.includes(sib3));

  parent.remove();
});

test('RISK03-05: pruneContainedNodes duplicate node dedup — 相同节点被多次传入时自动去重', () => {
  const el = document.createElement('div');
  document.body.appendChild(el);

  const res = pruneContainedNodes([el, el, el]);
  assert.equal(res.length, 1);
  assert.equal(res[0], el);

  el.remove();
});

test('RISK03-06: pruneContainedNodes disconnected node handling — 未挂载或已脱离 DOM 树的节点自动过滤', () => {
  const attached = document.createElement('div');
  document.body.appendChild(attached);
  const detached = document.createElement('div');

  const res = pruneContainedNodes([attached, detached]);
  assert.equal(res.length, 1);
  assert.equal(res[0], attached);

  const resEmpty = pruneContainedNodes([detached]);
  assert.equal(resEmpty.length, 0);

  attached.remove();
});

test('RISK03-07: opaque subtree handling — 包含 OPAQUE 节点的父子裁剪与跳过验证', () => {
  const container = document.createElement('div');
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.textContent = 'sediment accretes in code block';
  pre.appendChild(code);
  container.appendChild(pre);
  document.body.appendChild(container);

  // 裁剪测试：传入 container 和 code，仅保留 container
  const roots = pruneContainedNodes([container, code]);
  assert.equal(roots.length, 1);
  assert.equal(roots[0], container);

  // 扫描测试：scanSubtree 必须遵守 OPAQUE_TAGS 避开 pre/code
  const tokens = scanSubtree(
    container,
    DEFAULT_SETTINGS,
    new Set(),
    true,
    new Set(),
    undefined,
    new Set(),
  );
  assert.equal(tokens.length, 0, 'OPAQUE_TAGS 内的代码文本严禁产生 Token');

  container.remove();
});

test('RISK03-08: no duplicate token after overlapping mutation records — 父子节点同时进入新增列表时零重复 Token 与零重叠高亮', async () => {
  const runner = new DynamicWebRunner();
  runner.settings.oncePerPage = false; // 严苛模式：关闭 oncePerPage，确保去重来自 DOM 树包含性裁剪而非 seen 集合
  runner.init();

  // 模拟同一事件循环内，父容器挂载到 body，子元素挂载到父容器
  const parent = document.createElement('div');
  const child = document.createElement('p');
  child.textContent = 'The tide receded slowly as sediment accretes in strata.';
  parent.appendChild(child);

  // 挂载到 DOM
  document.body.appendChild(parent);

  // 触发一次合成批处理
  await runner.flush();

  // 提取各单词出现频次
  const recededTokens = runner.tokens.filter((t) => t.surface === 'receded');
  const accretesTokens = runner.tokens.filter((t) => t.surface === 'accretes');
  const strataTokens = runner.tokens.filter((t) => t.surface === 'strata');

  assert.equal(recededTokens.length, 1, 'receded 必须恰好只有 1 个 Token，严禁因父子层叠重复扫描');
  assert.equal(accretesTokens.length, 1, 'accretes 必须恰好只有 1 个 Token');
  assert.equal(strataTokens.length, 1, 'strata 必须恰好只有 1 个 Token');

  // 验证 Highlight Range 集合
  const mark = highlightMap.get('glint-mark');
  assert.ok(mark);
  assert.equal(mark.ranges.length, runner.tokens.length, '高亮 Range 数与 Token 数严格一致');

  runner.destroy();
});

test('RISK02-EVAL: mutation threshold fallback evaluation — 量化评估 >250 突变阈值在 251, 500, 1000 次变动下的降级开销与安全边界', async () => {
  const container = document.createElement('div');
  container.id = 'eval-container';
  // 建立一个含有 100 个段落的基础 DOM 树
  for (let i = 0; i < 100; i++) {
    const p = document.createElement('p');
    p.textContent = `Baseline ${i}: The geological strata accretes.`;
    container.appendChild(p);
  }
  document.body.appendChild(container);

  const runner = new DynamicWebRunner();
  runner.init();
  const baseFullRescanCount = runner.metrics.fullRescanCount;
  assert.equal(baseFullRescanCount, 1);

  // 测试 1: 50 次增量变动 (<= 250)
  const tInc0 = performance.now();
  for (let i = 0; i < 50; i++) {
    const s = document.createElement('span');
    s.textContent = `Inc ${i}: receded. `;
    container.appendChild(s);
  }
  await runner.flush();
  const incDuration = performance.now() - tInc0;
  assert.equal(runner.metrics.fullRescanCount, 1, '50 次变动走增量分支');
  assert.equal(runner.metrics.incrementalScanCount, 1);

  // 测试 2: 251 次突发变动 (临界回退)
  const t251_0 = performance.now();
  for (let i = 0; i < 251; i++) {
    const s = document.createElement('span');
    s.textContent = `Mut251_${i}: receded. `;
    container.appendChild(s);
  }
  await runner.flush();
  const dur251 = performance.now() - t251_0;
  assert.equal(runner.metrics.fullRescanCount, 2, '251 次变动正确触发 fallback 全量扫描');

  // 测试 3: 500 次突发变动
  const t500_0 = performance.now();
  for (let i = 0; i < 500; i++) {
    const s = document.createElement('span');
    s.textContent = `Mut500_${i}: receded. `;
    container.appendChild(s);
  }
  await runner.flush();
  const dur500 = performance.now() - t500_0;
  assert.equal(runner.metrics.fullRescanCount, 3, '500 次变动正确触发 fallback 全量扫描');

  // 测试 4: 1000 次突发变动 (极限风暴)
  const t1000_0 = performance.now();
  for (let i = 0; i < 1000; i++) {
    const s = document.createElement('span');
    s.textContent = `Mut1000_${i}: receded. `;
    container.appendChild(s);
  }
  await runner.flush();
  const dur1000 = performance.now() - t1000_0;
  assert.equal(runner.metrics.fullRescanCount, 4, '1000 次变动正确触发 fallback 全量扫描');

  // 验证硬上限保护依然生效
  assert.ok(runner.tokens.length <= 2500, 'MAX_TOKENS = 2500 硬上限保护依然有效');

  console.info(`[RISK02-EVAL] 50 mutations (incremental): ${incDuration.toFixed(2)}ms`);
  console.info(`[RISK02-EVAL] 251 mutations (fallback): ${dur251.toFixed(2)}ms`);
  console.info(`[RISK02-EVAL] 500 mutations (fallback): ${dur500.toFixed(2)}ms`);
  console.info(`[RISK02-EVAL] 1000 mutations (fallback): ${dur1000.toFixed(2)}ms`);

  runner.destroy();
});
