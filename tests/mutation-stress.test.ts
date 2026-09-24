import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { DEFAULT_SETTINGS } from '../src/lib/types';
import type { Token } from '../src/lib/scan';

let scanSubtree: typeof import('../src/lib/scan').scanSubtree;
let scanTextNode: typeof import('../src/lib/scan').scanTextNode;
let collectCodeWords: typeof import('../src/lib/scan').collectCodeWords;

before(async () => {
  const window = new Window({ url: 'https://example.com' });
  for (const key of ['document', 'Node', 'NodeFilter', 'Element', 'HTMLElement'] as const) {
    (globalThis as Record<string, unknown>)[key] = window[key];
  }
  const mod = await import('../src/lib/scan');
  scanSubtree = mod.scanSubtree;
  scanTextNode = mod.scanTextNode;
  collectCodeWords = mod.collectCodeWords;
});

test('压力测试 1：模拟 React / Vue 高频动态增删 500 个复杂元素', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const codeWords = new Set<string>();

  let tokens: Token[] = [];
  const start = performance.now();

  for (let i = 0; i < 500; i++) {
    const card = document.createElement('div');
    card.className = `feed-item-${i}`;
    const p = document.createElement('p');
    p.textContent = `Item ${i}: The sediment accretes in strata and the tide receded.`;
    card.append(p);
    container.append(card);

    // 增量只扫描新增的子树
    const newTokens = scanSubtree(card, DEFAULT_SETTINGS, new Set(), true, codeWords);
    tokens.push(...newTokens);

    // 随机删除一些之前的节点
    if (i % 10 === 0 && container.firstChild) {
      (container.firstChild as HTMLElement).remove();
    }
  }

  // 剪除脱离 DOM 的旧 Token
  tokens = tokens.filter((t) => t.node?.isConnected);

  const duration = performance.now() - start;
  const avgPerBatch = duration / 500;

  console.log(`[Stress 1] 500 次动态增删总耗时: ${duration.toFixed(2)}ms, 平均每次增量: ${avgPerBatch.toFixed(3)}ms`);
  assert.ok(avgPerBatch < 2.0, `单次增量耗时平均必须 < 2ms (实际: ${avgPerBatch.toFixed(3)}ms)`);
  assert.ok(tokens.length > 0);
});

test('压力测试 2：模拟大模型流式打字机 (Streaming Chatbot) 100 次高频微更新', () => {
  const chatBubble = document.createElement('div');
  const textNode = document.createTextNode('');
  chatBubble.append(textNode);
  document.body.append(chatBubble);

  const words = [
    'The', 'tide', 'receded', 'further', 'than', 'before.',
    'Meanwhile,', 'sediment', 'accretes', 'in', 'various', 'strata',
    'across', 'the', 'ancient', 'geological', 'formations.',
  ];

  const codeWords = new Set<string>();
  let tokens: Token[] = [];

  const start = performance.now();
  for (let step = 0; step < 100; step++) {
    // 每次流式多吐出几个词
    const wordToAdd = words[step % words.length]!;
    textNode.data += ' ' + wordToAdd;

    // 仅增量扫描变动的这 1 个 Text 节点
    tokens = scanTextNode(textNode, DEFAULT_SETTINGS, new Set(), true, codeWords);
  }

  const duration = performance.now() - start;
  const avgPerStream = duration / 100;

  console.log(`[Stress 2] 100 次打字机流式更新总耗时: ${duration.toFixed(2)}ms, 平均每次: ${avgPerStream.toFixed(3)}ms`);
  assert.ok(avgPerStream < 0.5, `打字机单次更新平均必须 < 0.5ms (实际: ${avgPerStream.toFixed(3)}ms)`);
  assert.ok(tokens.length > 0);
});

test('压力测试 3：模拟无限滚动长列表 (Infinite Scroll) 50 次批量追加', () => {
  const feed = document.createElement('main');
  document.body.append(feed);
  const codeWords = new Set<string>();

  let tokens: Token[] = [];
  const start = performance.now();

  for (let batch = 0; batch < 50; batch++) {
    const batchContainer = document.createElement('section');
    for (let j = 0; j < 10; j++) {
      const art = document.createElement('article');
      art.innerHTML = `<h3>Article ${batch * 10 + j}</h3><p>Fishermen recall that sediment accretes near the shore while the tide receded.</p>`;
      batchContainer.append(art);
    }
    feed.append(batchContainer);

    // 仅扫描这 1 个新追加的 section (设置 oncePerPage: false 验证高负载多词匹配)
    const newTokens = scanSubtree(
      batchContainer,
      { ...DEFAULT_SETTINGS, oncePerPage: false },
      new Set(),
      true,
      codeWords,
    );
    tokens.push(...newTokens);
  }

  const duration = performance.now() - start;
  const avgPerBatch = duration / 50;

  console.log(`[Stress 3] 50 次长列表滚动加载 (累计 500 篇短文) 总耗时: ${duration.toFixed(2)}ms, 平均每次: ${avgPerBatch.toFixed(3)}ms`);
  assert.ok(avgPerBatch < 3.0, `单次长列表追加耗时必须 < 3ms (实际: ${avgPerBatch.toFixed(3)}ms)`);
  assert.ok(tokens.length >= 500);
});
