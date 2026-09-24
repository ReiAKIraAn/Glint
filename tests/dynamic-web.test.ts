import assert from 'node:assert/strict';
import { test, before, beforeEach } from 'node:test';
import { Window } from 'happy-dom';
import { DEFAULT_SETTINGS, type Settings } from '../src/lib/types';
import {
  scan,
  scanSubtree,
  scanTextNode,
  collectCodeWords,
  ScannedToken,
  type Token,
  OWN_ELEMENT,
} from '../src/lib/scan';
import { paint, clear, isSupported } from '../src/lib/highlight';
import { HoverTracker } from '../src/lib/hover';

/**
 * ============================================================================
 * M5-W5: Dynamic Web Robustness Test Suite (DW-01 ~ DW-12)
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

    // >250 阈值或 tokens 为空时退回全量重扫
    if (records.length > 250 || this.tokens.length === 0) {
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

    for (const node of addedNodes) {
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
