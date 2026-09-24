import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { ScannedToken, sentenceAround, type Token } from '../src/lib/scan';
import { paint, clear } from '../src/lib/highlight';

/**
 * [Core Regression Test Suite - Token Lifecycle & DOM Weak Reference]
 * 运行环境: Node.js + Happy-DOM 模拟 (注意: 非 Safari 原生 WebKit 运行时)
 */

before(() => {
  const window = new Window({ url: 'https://example.com' });
  (globalThis as Record<string, unknown>).window = window;
  for (const key of [
    'document',
    'Node',
    'NodeFilter',
    'Element',
    'HTMLElement',
    'Range',
    'CSS',
    'Highlight',
  ] as const) {
    (globalThis as Record<string, unknown>)[key] = (window as unknown as Record<string, unknown>)[key];
  }
});

test('ScannedToken 使用 WeakRef 持有 Text 节点，并可通过 node getter 访问', () => {
  const textNode = document.createTextNode('Glint adapts seamlessly to Safari.');
  document.body.append(textNode);

  const token = new ScannedToken(textNode, 0, 5, 'Glint', 'glint', 4);

  assert.ok(token.nodeRef instanceof WeakRef, 'nodeRef 必须是 WeakRef 实例');
  assert.strictEqual(token.node, textNode, '活跃节点通过 .node 访问必须返回原实例');
  assert.strictEqual(token.node?.isConnected, true, '挂载在 document.body 中的节点 isConnected 为 true');

  textNode.remove();
  assert.strictEqual(token.node?.isConnected, false, '移除后 isConnected 为 false');
});

test('脱离 DOM 树或被 GC 后的 Token 访问防护：sentenceAround 与 paint 均不崩溃', () => {
  const textNode = document.createTextNode('A fleeting detached node.');
  const token = new ScannedToken(textNode, 2, 10, 'fleeting', 'fleet', 3);

  // 1. 节点未挂载时
  assert.strictEqual(token.node?.isConnected, false);

  // 2. 模拟如果节点已被垃圾回收 (WeakRef.deref() 返回 undefined)
  const deadToken: Token = {
    nodeRef: { deref: () => undefined } as unknown as WeakRef<Text>,
    node: undefined,
    start: 2,
    end: 10,
    surface: 'fleeting',
    lemma: 'fleet',
    level: 3,
  };

  // sentenceAround 安全兜底
  const fallbackSentence = sentenceAround(deadToken);
  assert.strictEqual(fallbackSentence, 'fleeting', '节点被回收时 sentenceAround 应安全回退到 surface');

  // paint 安全跳过，不抛异常
  assert.doesNotThrow(() => {
    paint([deadToken]);
  }, 'paint 遇到已被 GC 的 deadToken 不得抛出异常');

  clear();
});

test('增量集合清理：从 DOM 树移除节点后，tokens 集合成功剔除失效项', () => {
  const p1 = document.createElement('p');
  const t1 = document.createTextNode('First paragraph with remarkable words.');
  p1.append(t1);

  const p2 = document.createElement('p');
  const t2 = document.createTextNode('Second paragraph with ephemeral concepts.');
  p2.append(t2);

  document.body.append(p1, p2);

  let tokens: Token[] = [
    new ScannedToken(t1, 21, 31, 'remarkable', 'remarkable', 3),
    new ScannedToken(t2, 22, 31, 'ephemeral', 'ephemeral', 5),
  ];

  assert.strictEqual(tokens.length, 2);

  // 移除第二个段落
  p2.remove();

  // 模拟 content.ts 中的过滤逻辑
  tokens = tokens.filter((t) => {
    const node = t.node;
    return !!node && node.isConnected;
  });

  assert.strictEqual(tokens.length, 1);
  assert.strictEqual(tokens[0]!.surface, 'remarkable');
  assert.strictEqual(tokens[0]!.node, t1);
});
