import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { DEFAULT_SETTINGS } from '../src/lib/types';
import type { Token } from '../src/lib/scan';

let scan: typeof import('../src/lib/scan').scan;
let scanSubtree: typeof import('../src/lib/scan').scanSubtree;
let scanTextNode: typeof import('../src/lib/scan').scanTextNode;
let collectCodeWords: typeof import('../src/lib/scan').collectCodeWords;

before(async () => {
  const window = new Window({ url: 'https://example.com' });
  for (const key of ['document', 'Node', 'NodeFilter', 'Element', 'HTMLElement'] as const) {
    (globalThis as Record<string, unknown>)[key] = window[key];
  }
  const mod = await import('../src/lib/scan');
  scan = mod.scan;
  scanSubtree = mod.scanSubtree;
  scanTextNode = mod.scanTextNode;
  collectCodeWords = mod.collectCodeWords;
});

test('增量扫描：独立 scanSubtree 产出与全量 scan 结果完全一致', () => {
  const container = document.createElement('div');
  container.innerHTML = '<p>The sediment accretes in strata and the tide receded.</p>';
  document.body.append(container);

  const fullTokens = scan(container, DEFAULT_SETTINGS, new Set(), true);
  const codeWords = collectCodeWords(container);
  const incrementalTokens = scanSubtree(container, DEFAULT_SETTINGS, new Set(), true, codeWords);

  assert.equal(incrementalTokens.length, fullTokens.length);
  assert.deepEqual(
    incrementalTokens.map((t) => t.surface),
    fullTokens.map((t) => t.surface),
  );
});

test('增量扫描：仅对新追加的段落进行扫描，不重复扫描旧段落', () => {
  const container = document.createElement('div');
  const p1 = document.createElement('p');
  p1.textContent = 'The tide receded slowly.';
  container.append(p1);
  document.body.append(container);

  const codeWords = collectCodeWords(container);
  const seen = new Set<string>();
  const initialTokens = scanSubtree(p1, DEFAULT_SETTINGS, new Set(), true, codeWords, undefined, seen);
  assert.ok(initialTokens.some((t) => t.surface === 'receded'));

  // 模拟无限滚动或新增评论：仅追加 p2
  const p2 = document.createElement('p');
  p2.textContent = 'Sediment accretes in strata.';
  container.append(p2);

  // 仅增量扫描 p2，传入已有 seen 集合
  const newTokens = scanSubtree(p2, DEFAULT_SETTINGS, new Set(), true, codeWords, undefined, seen);
  assert.ok(newTokens.some((t) => t.surface === 'accretes'));
  assert.ok(newTokens.some((t) => t.surface === 'strata'));

  // 验证 p2 扫描并没有重新扫描 p1
  assert.ok(!newTokens.some((t) => t.surface === 'receded'));
});

test('增量扫描：单个 Text 节点发生打字更新时，scanTextNode 精准分词', () => {
  const p = document.createElement('p');
  const textNode = document.createTextNode('The tide receded');
  p.append(textNode);
  document.body.append(p);

  const codeWords = new Set<string>();
  const tokens1 = scanTextNode(textNode, DEFAULT_SETTINGS, new Set(), true, codeWords);
  assert.equal(tokens1.length, 1);
  assert.equal(tokens1[0]?.surface, 'receded');

  // 模拟流式追加文本
  textNode.data = 'The tide receded and sediment accretes';
  const tokens2 = scanTextNode(textNode, DEFAULT_SETTINGS, new Set(), true, codeWords);
  assert.equal(tokens2.length, 3);
  assert.ok(tokens2.some((t) => t.surface === 'receded'));
  assert.ok(tokens2.some((t) => t.surface === 'sediment'));
  assert.ok(tokens2.some((t) => t.surface === 'accretes'));
});

test('增量扫描：节点从 DOM 移除后 isConnected 为 false，旧 Token 瞬间识别', () => {
  const container = document.createElement('div');
  const p = document.createElement('p');
  p.textContent = 'The tide receded.';
  container.append(p);
  document.body.append(container);

  const tokens = scan(container, DEFAULT_SETTINGS, new Set(), true);
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0]?.node.isConnected, true);

  // 移除节点
  p.remove();
  assert.equal(tokens[0]?.node.isConnected, false);

  // 过滤已断开连接的节点耗时近乎 0
  const activeTokens = tokens.filter((t) => t.node.isConnected);
  assert.equal(activeTokens.length, 0);
});
