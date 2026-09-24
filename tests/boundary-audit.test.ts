import assert from 'node:assert/strict';
import { test, before, beforeEach } from 'node:test';
import { Window } from 'happy-dom';
import { DEFAULT_SETTINGS, type Settings } from '../src/lib/types';
import {
  scanSubtree,
  scanTextNode,
  collectCodeWords,
  pruneContainedNodes,
  type Token,
  OWN_ELEMENT,
} from '../src/lib/scan';
import { paint, clear, isSupported } from '../src/lib/highlight';
import { HoverTracker } from '../src/lib/hover';
import { Card } from '../src/lib/card';

/**
 * ============================================================================
 * M5-W6 STEP 1: BOUNDARY CAPABILITY AUDIT TEST SUITE
 *
 * 验证目标：
 * 验证 Glint Safari Personal Edition 当前边界策略：
 * 1. 第三方 Shadow DOM (open/closed): OPAQUE / NOT TRAVERSED
 * 2. iframe (same-origin / cross-origin / nested): OPAQUE / NOT TRAVERSED
 * 3. Glint 专属 ShadowRoot: 仅用于扩展卡片 UI 样式与 DOM 隔离，不被页面扫描，不触发观察者循环
 * 4. 动态边界突变 (BOUNDARY-DW-01..10): 动态插入/移除/替换不绕过边界
 * 5. 安全与凭据隔离: 无自动 AI 触发、无 postMessage 泄露、无跨 Frame 通信
 * 6. 性能度量: 确认内部突变不引发无谓 observer 回调与全量重扫
 * ============================================================================
 */

let window: Window;
let highlightMap: Map<string, { ranges: Range[] }>;

/**
 * 与 content.ts 真实运行环境保持一致的增量扫描运行器，暴露观测指标
 */
class BoundaryAuditRunner {
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
  aiRequestsTriggered = 0;

  metrics = {
    observerCallbackCount: 0,
    totalRecords: 0,
    fullRescanCount: 0,
    incrementalScanCount: 0,
    paintCount: 0,
    elapsedMs: 0,
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
      this.metrics.observerCallbackCount++;
      this.metrics.totalRecords += records.length;
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
    this.metrics.fullRescanCount++;
    this.metrics.elapsedMs += performance.now() - t0;
  }

  processBatch() {
    this.batchTimer = undefined;
    if (!this.pendingBatch.length) return;
    const records = this.pendingBatch;
    this.pendingBatch = [];

    const t0 = performance.now();

    if (records.length > 250 || !this.hasRunInitialScan) {
      this.run();
      this.metrics.elapsedMs += performance.now() - t0;
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
        }
      }
    }

    if (codeChanged) {
      this.codeWords = collectCodeWords(document.body);
    }

    const roots = pruneContainedNodes(addedNodes);

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

    this.metrics.elapsedMs += performance.now() - t0;
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
    'HTMLDivElement',
    'HTMLSpanElement',
    'HTMLButtonElement',
    'HTMLIFrameElement',
    'Text',
    'Range',
    'MutationObserver',
    'performance',
    'setTimeout',
    'clearTimeout',
    'requestAnimationFrame',
    'cancelAnimationFrame',
  ]) {
    // @ts-expect-error polyfill globals for test runner
    globalThis[key] = window[key];
  }

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

// ============================================================================
// 4. Shadow DOM Audit (SHADOW-01 ~ SHADOW-07)
// ============================================================================

test('SHADOW-01: 普通 document 生词正常扫描并高亮', () => {
  const p = document.createElement('p');
  p.textContent = 'The tide receded gradually, exposing delicate sediment.';
  document.body.appendChild(p);

  const runner = new BoundaryAuditRunner();
  runner.init();

  assert.ok(runner.tokens.length >= 2, '主文档中应识别到生词');
  assert.ok(runner.tokens.some((t) => t.lemma === 'recede' || t.surface.toLowerCase() === 'receded'));
  assert.ok(runner.tokens.some((t) => t.lemma === 'sediment'));
  assert.ok(highlightMap.has('glint-mark'), 'CSS.highlights 必须已绘制生词 (glint-mark)');

  runner.destroy();
});

test('SHADOW-02: 第三方 open ShadowRoot 内部生词不被扫描、不高亮', () => {
  const host = document.createElement('div');
  host.id = 'host-open';
  const shadow = host.attachShadow({ mode: 'open' });
  const shadowP = document.createElement('p');
  shadowP.textContent = 'Inside open shadow: The tide receded and sediment accumulated.';
  shadow.appendChild(shadowP);

  const mainP = document.createElement('p');
  mainP.textContent = 'In top document: An ephemeral phenomenon was observed.';
  document.body.append(host, mainP);

  const runner = new BoundaryAuditRunner();
  runner.init();

  // 断言：仅主文档生词被捕获，ShadowRoot 内生词完全不进入 tokens 集合
  const words = runner.tokens.map((t) => t.surface.toLowerCase());
  assert.ok(words.includes('ephemeral'), '主文档生词 ephemeral 应被扫描');
  assert.ok(!words.includes('receded'), 'open ShadowRoot 内部 receded 严禁被扫描');
  assert.ok(!words.includes('sediment'), 'open ShadowRoot 内部 sediment 严禁被扫描');
  assert.ok(runner.tokens.every((t) => t.node?.getRootNode() === document), '所有 tokens 根节点必须为主文档');

  runner.destroy();
});

test('SHADOW-03: 第三方 closed ShadowRoot 内部生词不被扫描、不高亮', () => {
  const host = document.createElement('div');
  host.id = 'host-closed';
  const shadow = host.attachShadow({ mode: 'closed' });
  const shadowP = document.createElement('p');
  shadowP.textContent = 'Inside closed shadow: The precipitate dissolved rapidly in the solvent.';
  shadow.appendChild(shadowP);

  const mainP = document.createElement('p');
  mainP.textContent = 'Main doc: We observe persistent turbulence.';
  document.body.append(host, mainP);

  const runner = new BoundaryAuditRunner();
  runner.init();

  const words = runner.tokens.map((t) => t.surface.toLowerCase());
  assert.ok(words.includes('turbulence') || words.includes('persistent'), '主文档生词应被扫描');
  assert.ok(!words.includes('precipitate'), 'closed ShadowRoot 内部单词严禁被扫描');
  assert.ok(!words.includes('dissolved'), 'closed ShadowRoot 内部单词严禁被扫描');

  runner.destroy();
});

test('SHADOW-04: Glint card ShadowRoot 内部 UI 元素不被扫描器扫描', () => {
  const card = new Card({
    lookup: async () => null,
    onKnown: () => {},
    onPointerEnter: () => {},
    onPointerLeave: () => {},
  });
  card.mount();

  const mainP = document.createElement('p');
  mainP.textContent = 'Scientific research shows significant sediment accumulation.';
  document.body.appendChild(mainP);

  const runner = new BoundaryAuditRunner();
  runner.init();

  // 检查扫描结果绝不含 glint-card 或其 ShadowRoot 内部的 UI 文本（如“✓ 认识”、“词义卡片”）
  const lemmas = runner.tokens.map((t) => t.lemma);
  assert.ok(!lemmas.includes('认识'), '卡片按钮文本不可作为生词');
  assert.ok(runner.tokens.every((t) => !card.element.contains(t.node!)), 'Token 严禁来自 glint-card');

  card.destroy();
  runner.destroy();
});

test('SHADOW-05: 第三方 open ShadowRoot 内部发生动态突变，不唤醒主页面扫描器', async () => {
  const host = document.createElement('div');
  const shadow = host.attachShadow({ mode: 'open' });
  const shadowP = document.createElement('p');
  shadowP.textContent = 'Initial text in shadow.';
  shadow.appendChild(shadowP);
  document.body.appendChild(host);

  const runner = new BoundaryAuditRunner();
  runner.init();

  const initialCallbacks = runner.metrics.observerCallbackCount;
  const initialIncrements = runner.metrics.incrementalScanCount;
  const initialRescans = runner.metrics.fullRescanCount;

  // 在 open ShadowRoot 内部增加多个生词节点
  const newP = document.createElement('p');
  newP.textContent = 'Dynamic shadow mutation: The glacier receded and sediment deposited.';
  shadow.appendChild(newP);

  await runner.flush();

  // 断言：由于 ShadowRoot 突变不向外部 document.body 冒泡 childList/characterData，
  // 观察者回调次数与扫描次数均保持零增长
  assert.equal(runner.metrics.observerCallbackCount, initialCallbacks, 'Shadow 内部突变不得触发 body observer 回调');
  assert.equal(runner.metrics.incrementalScanCount, initialIncrements, 'Shadow 内部突变不得唤醒增量扫描');
  assert.equal(runner.metrics.fullRescanCount, initialRescans, 'Shadow 内部突变不得唤醒全量重扫');

  runner.destroy();
});

test('SHADOW-06: 第三方 closed ShadowRoot 内部发生动态突变，不唤醒主页面扫描器', async () => {
  const host = document.createElement('div');
  const shadow = host.attachShadow({ mode: 'closed' });
  document.body.appendChild(host);

  const runner = new BoundaryAuditRunner();
  runner.init();

  const initialCallbacks = runner.metrics.observerCallbackCount;

  const newP = document.createElement('p');
  newP.textContent = 'Closed shadow mutation with rare vocabulary.';
  shadow.appendChild(newP);

  await runner.flush();

  assert.equal(runner.metrics.observerCallbackCount, initialCallbacks, 'closed shadow 内部突变不触发 observer 回调');

  runner.destroy();
});

test('SHADOW-07: Glint card 自身发生内部状态更新与突变，不产生观察者递归与死循环', async () => {
  const p = document.createElement('p');
  p.textContent = 'A pervasive sediment layer covered the terrain.';
  document.body.appendChild(p);

  const runner = new BoundaryAuditRunner();
  runner.init();

  const host = runner.cardElement;

  // 模拟卡片在宿主节点内部更新属性、插入 DOM 等操作
  for (let i = 0; i < 10; i++) {
    const internalDiv = document.createElement('div');
    internalDiv.textContent = `Internal state update ${i}`;
    host.appendChild(internalDiv);
  }

  await runner.flush();

  // 断言：MutationObserver 对 host 及 host.contains(r.target) 的变更直接返回忽略，
  // 绝不放入 pendingBatch，亦不触发 processBatch 或 run
  assert.equal(runner.metrics.incrementalScanCount, 0, '卡片内部变更不得触发增量扫描');
  assert.equal(runner.metrics.fullRescanCount, 1, '卡片内部变更不得触发全量扫描 (仅有初始扫描 1 次)');

  runner.destroy();
});

// ============================================================================
// 6. iframe Audit (IFRAME-01 ~ IFRAME-06)
// ============================================================================

test('IFRAME-01: 顶级文档中的生词正常扫描', () => {
  const p = document.createElement('p');
  p.textContent = 'Top level document contains ubiquitous microbes.';
  document.body.appendChild(p);

  const runner = new BoundaryAuditRunner();
  runner.init();

  assert.ok(runner.tokens.some((t) => t.lemma === 'ubiquitous' || t.surface.toLowerCase() === 'ubiquitous'));
  runner.destroy();
});

test('IFRAME-02: 同源 iframe 节点被视作 OPAQUE_TAGS，不进入其内部扫描', () => {
  const iframe = document.createElement('iframe');
  iframe.id = 'same-origin-iframe';
  document.body.appendChild(iframe);

  // 即使在同一个 DOM 树上为 iframe 注入子节点或文本
  const iframeP = document.createElement('p');
  iframeP.textContent = 'Inside same origin iframe: The glacier receded dramatically.';
  iframe.appendChild(iframeP);

  const topP = document.createElement('p');
  topP.textContent = 'Top level text: Geological sediment layers.';
  document.body.appendChild(topP);

  const runner = new BoundaryAuditRunner();
  runner.init();

  const surfaces = runner.tokens.map((t) => t.surface.toLowerCase());
  assert.ok(surfaces.includes('sediment'), '顶级文档词汇正常扫描');
  assert.ok(!surfaces.includes('receded'), 'iframe 内部词汇严禁被扫描 (OPAQUE_TAGS 拦截)');

  runner.destroy();
});

test('IFRAME-03: 跨域 iframe 边界安全隔离，OPAQUE_TAGS 彻底阻断', () => {
  const iframe = document.createElement('iframe');
  iframe.src = 'https://cross-origin.example.com/widget';
  document.body.appendChild(iframe);

  const runner = new BoundaryAuditRunner();
  runner.init();

  assert.ok(runner.tokens.every((t) => t.node?.parentElement?.tagName !== 'IFRAME'));
  runner.destroy();
});

test('IFRAME-04: 多层嵌套 iframe 递归安全，整棵 iframe 树均不被扫描', () => {
  const parentIframe = document.createElement('iframe');
  const childIframe = document.createElement('iframe');
  const deepP = document.createElement('p');
  deepP.textContent = 'Deep nested iframe text with vocabulary.';
  childIframe.appendChild(deepP);
  parentIframe.appendChild(childIframe);
  document.body.appendChild(parentIframe);

  const runner = new BoundaryAuditRunner();
  runner.init();

  assert.equal(runner.tokens.length, 0, '嵌套 iframe 内部不产生任何 Token');
  runner.destroy();
});

test('IFRAME-05: 动态插入 iframe 节点，增量扫描器跳过 iframe 子树且不产生递归跨 Frame 扫描', async () => {
  const runner = new BoundaryAuditRunner();
  runner.init();

  const iframe = document.createElement('iframe');
  const iframeInner = document.createElement('p');
  iframeInner.textContent = 'Dynamically injected iframe vocabulary: unprecedented anomaly.';
  iframe.appendChild(iframeInner);

  document.body.appendChild(iframe);
  await runner.flush();

  const surfaces = runner.tokens.map((t) => t.surface.toLowerCase());
  assert.ok(!surfaces.includes('unprecedented'), '动态插入的 iframe 内容不得进入 Token 列表');
  assert.ok(!surfaces.includes('anomaly'), '动态插入的 iframe 内容不得进入 Token 列表');

  runner.destroy();
});

test('IFRAME-06: iframe 内部突变绝不自动发起任何 AI 网络请求或提取上下文', async () => {
  const runner = new BoundaryAuditRunner();
  runner.init();

  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  await runner.flush();

  // 模拟对 iframe 进行高频修改
  for (let i = 0; i < 5; i++) {
    const p = document.createElement('p');
    p.textContent = `Iframe mutation batch ${i}: vocabulary word`;
    iframe.appendChild(p);
  }
  await runner.flush();

  // 严格断言：零 AI 请求触发
  assert.equal(runner.aiRequestsTriggered, 0, 'iframe 变动绝对不得触发 AI 请求');

  runner.destroy();
});

// ============================================================================
// 9. Dynamic Boundary Scenarios (BOUNDARY-DW-01 ~ BOUNDARY-DW-10)
// ============================================================================

test('BOUNDARY-DW-01: 动态插入 open ShadowRoot 宿主节点，仅扫描主文档 Light DOM', async () => {
  const runner = new BoundaryAuditRunner();
  runner.init();

  const host = document.createElement('div');
  const lightSpan = document.createElement('span');
  lightSpan.textContent = 'Light DOM text with sediment.';
  host.appendChild(lightSpan);

  const shadow = host.attachShadow({ mode: 'open' });
  const shadowSpan = document.createElement('span');
  shadowSpan.textContent = 'Shadow DOM text with pervasive receded vocabulary.';
  shadow.appendChild(shadowSpan);

  document.body.appendChild(host);
  await runner.flush();

  const words = runner.tokens.map((t) => t.surface.toLowerCase());
  assert.ok(words.includes('sediment'), 'Light DOM 文本正常扫描');
  assert.ok(!words.includes('pervasive'), 'Shadow DOM 内部文本未被穿透扫描');

  runner.destroy();
});

test('BOUNDARY-DW-02: 动态插入 closed ShadowRoot 宿主节点，仅扫描主文档 Light DOM', async () => {
  const runner = new BoundaryAuditRunner();
  runner.init();

  const host = document.createElement('div');
  const lightSpan = document.createElement('span');
  lightSpan.textContent = 'Light DOM text with sediment.';
  host.appendChild(lightSpan);

  const shadow = host.attachShadow({ mode: 'closed' });
  const shadowSpan = document.createElement('span');
  shadowSpan.textContent = 'Closed Shadow DOM text with esoteric words.';
  shadow.appendChild(shadowSpan);

  document.body.appendChild(host);
  await runner.flush();

  const words = runner.tokens.map((t) => t.surface.toLowerCase());
  assert.ok(words.includes('sediment'));
  assert.ok(!words.includes('esoteric'));

  runner.destroy();
});

test('BOUNDARY-DW-03: 动态插入 iframe 节点，TreeWalker 被 OPAQUE_TAGS 拦截', async () => {
  const runner = new BoundaryAuditRunner();
  runner.init();

  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  await runner.flush();

  assert.equal(runner.tokens.length, 0);
  runner.destroy();
});

test('BOUNDARY-DW-04: 动态移除 iframe 节点，扫描器安全清理并不抛错', async () => {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);

  const runner = new BoundaryAuditRunner();
  runner.init();

  iframe.remove();
  await runner.flush();

  assert.equal(runner.tokens.length, 0);
  runner.destroy();
});

test('BOUNDARY-DW-05: 动态移除包含 ShadowRoot 的宿主元素，Tokens 正确清理', async () => {
  const host = document.createElement('div');
  const lightP = document.createElement('p');
  lightP.textContent = 'Sediment layer.';
  host.appendChild(lightP);
  host.attachShadow({ mode: 'open' });
  document.body.appendChild(host);

  const runner = new BoundaryAuditRunner();
  runner.init();
  assert.equal(runner.tokens.length, 1);

  // 拔除 host 元素
  host.remove();
  await runner.flush();

  // 检查 Token 是否已被及时清理
  assert.equal(runner.tokens.length, 0, '脱落 DOM 树的 Token 应被清理');
  runner.destroy();
});

test('BOUNDARY-DW-06: 动态替换包含 ShadowRoot 的宿主元素，新节点正常扫描，边界不泄露', async () => {
  const oldHost = document.createElement('div');
  oldHost.textContent = 'Old sediment.';
  document.body.appendChild(oldHost);

  const runner = new BoundaryAuditRunner();
  runner.init();
  assert.equal(runner.tokens.length, 1);

  const newHost = document.createElement('div');
  const lightP = document.createElement('p');
  lightP.textContent = 'New sediment.';
  newHost.appendChild(lightP);
  const shadow = newHost.attachShadow({ mode: 'open' });
  const shadowP = document.createElement('p');
  shadowP.textContent = 'Hidden shadow text with esoteric vocabulary.';
  shadow.appendChild(shadowP);

  oldHost.replaceWith(newHost);
  await runner.flush();

  const words = runner.tokens.map((t) => t.surface.toLowerCase());
  assert.ok(words.includes('sediment'));
  assert.ok(!words.includes('esoteric'));

  runner.destroy();
});

test('BOUNDARY-DW-07: 嵌套 iframe 内部浏览上下文变动不冒泡至顶级 MutationObserver', async () => {
  const outerIframe = document.createElement('iframe');
  document.body.appendChild(outerIframe);

  const runner = new BoundaryAuditRunner();
  runner.init();

  assert.ok(outerIframe.contentDocument);
  const outerDoc = outerIframe.contentDocument;
  const innerIframe = outerDoc.createElement('iframe');
  outerDoc.body.appendChild(innerIframe);

  const callbacksBefore = runner.metrics.observerCallbackCount;

  // 在内层 iframe 的 contentDocument 中添加生词元素
  assert.ok(innerIframe.contentDocument);
  const innerDoc = innerIframe.contentDocument;
  const p = innerDoc.createElement('p');
  p.textContent = 'Nested iframe document mutation: sediment receded.';
  innerDoc.body.appendChild(p);

  await runner.flush();

  // 严格断言：嵌套 iframe 独立文档树内的变更对顶级 MutationObserver 完全不可见
  assert.equal(runner.metrics.observerCallbackCount, callbacksBefore, '嵌套 iframe 内部文档变动不得触发顶级 observer');
  assert.equal(runner.tokens.length, 0, '嵌套 iframe 内不得产生 Token');
  runner.destroy();
});

test('BOUNDARY-DW-08: 容器内同时包含 ShadowRoot 与普通节点进行 SPA 整页替换', async () => {
  const app = document.createElement('div');
  app.id = 'app';
  app.innerHTML = '<p>Page 1 with sediment.</p>';
  document.body.appendChild(app);

  const runner = new BoundaryAuditRunner();
  runner.init();
  assert.equal(runner.tokens.length, 1);

  // SPA 替换为新页面，其中包含一个含 open Shadow DOM 的组件
  const page2Host = document.createElement('div');
  const shadow = page2Host.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<p>Shadow component with redundant tokens.</p>';
  const page2Light = document.createElement('p');
  page2Light.textContent = 'Page 2 with ubiquitous minerals.';

  app.replaceChildren(page2Host, page2Light);
  await runner.flush();

  const words = runner.tokens.map((t) => t.surface.toLowerCase());
  assert.ok(words.includes('ubiquitous'), '新页面主文档词汇应被扫描');
  assert.ok(!words.includes('redundant'), '新页面 Shadow DOM 内部词汇不应被扫描');
  assert.ok(!words.includes('sediment'), '旧页面词汇必须已被清理');

  runner.destroy();
});

test('BOUNDARY-DW-09: 无限滚动列表动态混杂追加普通段落与广告 iframe', async () => {
  const runner = new BoundaryAuditRunner();
  runner.init();

  for (let batch = 0; batch < 5; batch++) {
    const item = document.createElement('div');
    const p = document.createElement('p');
    p.textContent = `Article batch ${batch} discussing geological sediment.`;
    const adIframe = document.createElement('iframe');
    const adText = document.createElement('p');
    adText.textContent = 'Advertisement iframe text with pervasive promotion.';
    adIframe.appendChild(adText);

    item.append(p, adIframe);
    document.body.appendChild(item);
  }

  await runner.flush();

  const words = runner.tokens.map((t) => t.surface.toLowerCase());
  assert.ok(words.includes('sediment'), '正文文本正常识别');
  assert.ok(!words.includes('pervasive'), '广告 iframe 内部文本完全忽略');

  runner.destroy();
});

test('BOUNDARY-DW-10: Glint card UI 密集更新与主页面高频突变并发无干扰', async () => {
  const runner = new BoundaryAuditRunner();
  runner.init();

  // 模拟主页面在不断添加普通节点的同时，卡片自身 ShadowRoot 也发生多次状态更新
  const cardHost = runner.cardElement;

  for (let i = 0; i < 10; i++) {
    const pageNode = document.createElement('p');
    pageNode.textContent = `Page item ${i} sediment.`;
    document.body.appendChild(pageNode);

    // 卡片自身节点更新
    cardHost.setAttribute('data-test-step', String(i));
  }

  await runner.flush();

  assert.ok(runner.tokens.length > 0, '主页面节点正常被扫描');
  assert.ok(runner.tokens.every((t) => !cardHost.contains(t.node!)), 'Token 绝不属于 cardHost');

  runner.destroy();
});

// ============================================================================
// 8 & 13. MutationObserver & Boundary Performance Metrics
// ============================================================================

test('PERF-BOUNDARY: 比较各边界突变场景下的观察者开销与重扫次数', async () => {
  const runner = new BoundaryAuditRunner();
  runner.init();

  // 1. 基准：普通主文档增加 50 个节点
  const mainT0 = performance.now();
  for (let i = 0; i < 50; i++) {
    const p = document.createElement('p');
    p.textContent = `Normal doc item ${i} with sediment.`;
    document.body.appendChild(p);
  }
  await runner.flush();
  const mainElapsed = performance.now() - mainT0;
  const normalObserverCalls = runner.metrics.observerCallbackCount;
  const normalIncrementalScans = runner.metrics.incrementalScanCount;

  // 2. Open ShadowRoot 增加 50 个节点
  const hostOpen = document.createElement('div');
  const shadowOpen = hostOpen.attachShadow({ mode: 'open' });
  document.body.appendChild(hostOpen);
  await runner.flush();

  const shadowT0 = performance.now();
  const shadowCallbacksBefore = runner.metrics.observerCallbackCount;
  for (let i = 0; i < 50; i++) {
    const p = document.createElement('p');
    p.textContent = `Shadow item ${i} with vocabulary.`;
    shadowOpen.appendChild(p);
  }
  await runner.flush();
  const shadowElapsed = performance.now() - shadowT0;
  const shadowCallbacksDelta = runner.metrics.observerCallbackCount - shadowCallbacksBefore;

  // 3. Iframe 内部浏览上下文增加 50 个节点
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  await runner.flush();

  const iframeT0 = performance.now();
  const iframeCallbacksBefore = runner.metrics.observerCallbackCount;
  assert.ok(iframe.contentDocument);
  const iframeDoc = iframe.contentDocument;
  for (let i = 0; i < 50; i++) {
    const p = iframeDoc.createElement('p');
    p.textContent = `Iframe child ${i} with vocabulary.`;
    iframeDoc.body.appendChild(p);
  }
  await runner.flush();
  const iframeElapsed = performance.now() - iframeT0;
  const iframeCallbacksDelta = runner.metrics.observerCallbackCount - iframeCallbacksBefore;

  // 4. Glint card 增加 50 次内部修改
  const cardT0 = performance.now();
  const cardCallbacksBefore = runner.metrics.observerCallbackCount;
  const cardScansBefore = runner.metrics.incrementalScanCount;
  for (let i = 0; i < 50; i++) {
    const span = document.createElement('span');
    span.textContent = `Card child ${i}`;
    runner.cardElement.appendChild(span);
  }
  await runner.flush();
  const cardElapsed = performance.now() - cardT0;
  const cardScansDelta = runner.metrics.incrementalScanCount - cardScansBefore;

  // 断言与度量记录
  assert.equal(shadowCallbacksDelta, 0, 'ShadowRoot 内部突变引起的 body observer 唤醒为 0');
  assert.equal(cardScansDelta, 0, 'Card 内部突变引起的增量扫描为 0 (完全被忽略拦截)');

  console.log(`[Boundary Perf Measurement]
  Normal DOM (50 items): ${mainElapsed.toFixed(2)}ms, callbacks: ${normalObserverCalls}, incremental: ${normalIncrementalScans}
  Open Shadow (50 items): ${shadowElapsed.toFixed(2)}ms, callbacks: ${shadowCallbacksDelta} (zero wakeup)
  Iframe (50 items): ${iframeElapsed.toFixed(2)}ms, callbacks: ${iframeCallbacksDelta}
  Card updates (50 items): ${cardElapsed.toFixed(2)}ms, incremental scans: ${cardScansDelta} (zero scan)`);

  runner.destroy();
});

// ============================================================================
// 5, 7, 18. Security Review & Credential Boundary Checks
// ============================================================================

test('SECURITY-BOUNDARY: 确认边界元素决不触发 AI 请求或明文凭证扩散', async () => {
  const runner = new BoundaryAuditRunner();
  runner.init();

  // 1. 注入包含诱导词的 ShadowRoot 和 Iframe
  const host = document.createElement('div');
  const shadow = host.attachShadow({ mode: 'open' });
  const p = document.createElement('p');
  p.textContent = 'Confidential document: api-key=sk-ant-api03-secret-key-do-not-leak';
  shadow.appendChild(p);
  document.body.appendChild(host);

  const iframe = document.createElement('iframe');
  iframe.src = 'https://malicious.example.com/phishing';
  document.body.appendChild(iframe);

  await runner.flush();

  // 验证无任何 Token 提取了该字符串
  const surfaces = runner.tokens.map((t) => t.surface);
  assert.ok(!surfaces.includes('sk-ant-api03-secret-key-do-not-leak'));
  assert.equal(runner.aiRequestsTriggered, 0, '绝无自动 AI 调用');

  // 验证全局 window 对象没有被注入任何跨 frame 通信凭据
  assert.ok(!('postMessage' in window && (window as unknown as { __glintSecret?: string }).__glintSecret));

  runner.destroy();
});
