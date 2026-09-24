import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { Card, pickSide } from '../src/lib/card';
import { HoverTracker, caretAt, resolveTextCaret, rectOf } from '../src/lib/hover';
import { ScannedToken, type Token } from '../src/lib/scan';
import type { DictEntry } from '../src/lib/types';

/**
 * [Automated Regression Test - Milestone 2: Hover & Card Engine]
 * 运行环境: Node.js + Happy-DOM 模拟环境
 */

let window: Window;

before(() => {
  window = new Window({ url: 'https://en.wikipedia.org/wiki/Sediment' });
  (globalThis as Record<string, unknown>).window = window;

  for (const key of [
    'document',
    'Node',
    'Element',
    'HTMLElement',
    'HTMLDivElement',
    'HTMLSpanElement',
    'HTMLButtonElement',
    'Range',
    'DOMRect',
    'MouseEvent',
    'CustomEvent',
    'AbortController',
  ] as const) {
    (globalThis as Record<string, unknown>)[key] = (window as unknown as Record<string, unknown>)[key];
  }
});

test('resolveTextCaret: 正确解析 Text 节点与 Element 边界子节点', () => {
  const p = document.createElement('p');
  const t1 = document.createTextNode('Hello ');
  const t2 = document.createTextNode('Sediment');
  p.append(t1, t2);
  document.body.append(p);

  // 1. 直接命中 Text 节点
  const direct = resolveTextCaret({ node: t2, offset: 3 });
  assert.ok(direct);
  assert.strictEqual(direct.node, t2);
  assert.strictEqual(direct.offset, 3);

  // 2. WebKit 边界情形：返回 Element 容器与子节点索引
  const fromEl = resolveTextCaret({ node: p, offset: 1 });
  assert.ok(fromEl);
  assert.strictEqual(fromEl.node, t2);
  assert.strictEqual(fromEl.offset, 0);

  // 3. WebKit 边界情形：offset 指向前一个子节点末尾
  const fromElPrev = resolveTextCaret({ node: p, offset: 2 });
  assert.ok(fromElPrev);
  assert.strictEqual(fromElPrev.node, t2);
  assert.strictEqual(fromElPrev.offset, 8); // 'Sediment'.length
});

test('tokenAt hit-test: 准确定位 Token 起始、中间与末尾偏移', () => {
  const tracker = new HoverTracker({ onEnter: () => {}, onLeave: () => {} });
  const textNode = document.createTextNode('The sediment accretes rapidly.');
  document.body.append(textNode);

  const token = new ScannedToken(textNode, 4, 12, 'sediment', 'sediment', 3);
  tracker.setTokens([token]);

  // 模拟 caretPositionFromPoint 落在词头 (4)、词中 (8)、词尾 (12)
  document.caretPositionFromPoint = ((x: number) => {
    return { offsetNode: textNode, offset: x };
  }) as unknown as typeof document.caretPositionFromPoint;

  assert.strictEqual(tracker.tokenAt(4, 0), token, '命中期头');
  assert.strictEqual(tracker.tokenAt(8, 0), token, '命中词中');
  assert.strictEqual(tracker.tokenAt(12, 0), token, '命中词尾');

  // 空白区域未命中
  assert.strictEqual(tracker.tokenAt(2, 0), undefined, '词前空白不得命中');
  assert.strictEqual(tracker.tokenAt(13, 0), undefined, '词后空白不得命中');
});

test('tokenAt: 找不到 Token 时安全返回 undefined', () => {
  const tracker = new HoverTracker({ onEnter: () => {}, onLeave: () => {} });
  const otherText = document.createTextNode('Unrelated content');
  document.body.append(otherText);

  document.caretPositionFromPoint = (() => ({
    offsetNode: otherText,
    offset: 2,
  })) as unknown as typeof document.caretPositionFromPoint;

  assert.strictEqual(tracker.tokenAt(10, 10), undefined);

  // caretAt 返回 null
  document.caretPositionFromPoint = (() => null) as unknown as typeof document.caretPositionFromPoint;
  assert.strictEqual(tracker.tokenAt(10, 10), undefined);
});

test('tokenAt: 脱离 DOM 树的 Token 或已被 GC 的 Token 不得被 hit-test 命中', () => {
  const tracker = new HoverTracker({ onEnter: () => {}, onLeave: () => {} });
  const p = document.createElement('p');
  const textNode = document.createTextNode('Ephemeral detached phrase.');
  p.append(textNode);
  document.body.append(p);

  const token = new ScannedToken(textNode, 0, 9, 'Ephemeral', 'ephemeral', 5);
  tracker.setTokens([token]);

  document.caretPositionFromPoint = (() => ({
    offsetNode: textNode,
    offset: 4,
  })) as unknown as typeof document.caretPositionFromPoint;

  // 节点挂在树上时可命中
  assert.strictEqual(tracker.tokenAt(10, 10), token);

  // 移除父节点使其脱离 DOM 树
  p.remove();
  assert.strictEqual(textNode.isConnected, false);
  assert.strictEqual(tracker.tokenAt(10, 10), undefined, '脱离 DOM 树后不得命中');
});

test('Card show / update / hide 生命周期与单例 DOM 复用验证', async () => {
  let lookupCalledWith = '';
  const mockEntry: DictEntry = {
    phonetic: 'ˈsɛdɪmənt',
    translation: 'n. 沉淀物；沉积物\nvt. 沉淀',
    tags: ['cet4', 'toefl'],
    rank: 1200,
  };

  const card = new Card({
    lookup: async (word) => {
      lookupCalledWith = word;
      return mockEntry;
    },
    onKnown: () => {},
    onPointerEnter: () => {},
    onPointerLeave: () => {},
  });

  card.mount();
  const initialHost = card.element;
  assert.ok(initialHost, 'Card host 元素必须存在');
  assert.strictEqual(initialHost.style.display, 'none', 'mount 后初始应为 none');

  const textNode = document.createTextNode('Sediment layers');
  document.body.append(textNode);
  const token = new ScannedToken(textNode, 0, 8, 'Sediment', 'sediment', 4);
  const rect = new DOMRect(50, 100, 80, 20);

  // 1. show
  await card.show(token, rect);
  assert.strictEqual(card.currentToken, token);
  assert.strictEqual(initialHost.style.display, 'block', 'show 后 display 应为 block');
  assert.strictEqual(lookupCalledWith, 'sediment');

  const shadow = card.shadowRoot;
  assert.strictEqual(shadow.querySelector('.word')?.textContent, 'Sediment');
  assert.strictEqual(shadow.querySelector('.badge')?.textContent, 'B2');
  assert.strictEqual(shadow.querySelector('.phonetic')?.textContent, '/ˈsɛdɪmənt/');
  const tagSpans = shadow.querySelectorAll('.tags span');
  assert.strictEqual(tagSpans.length, 2);
  assert.strictEqual(tagSpans[0]?.textContent, '四级');
  assert.strictEqual(tagSpans[1]?.textContent, '托福');

  // 2. update: 悬停到另一个单词，直接复用同一卡片实例
  const token2 = new ScannedToken(textNode, 9, 15, 'layers', 'layer', 3);
  await card.show(token2, rect);
  assert.strictEqual(card.element, initialHost, '卡片 DOM 节点必须绝对单例复用，不得重新创建');
  assert.strictEqual(shadow.querySelector('.word')?.textContent, 'layers');
  assert.strictEqual(shadow.querySelector('.lemma')?.textContent, '原形 layer');
  assert.strictEqual(shadow.querySelector('.badge')?.textContent, 'B1');

  // 3. hide
  card.hide();
  assert.strictEqual(card.currentToken, undefined, 'hide 后当前 Token 必须重置');

  card.destroy();
  assert.strictEqual(initialHost.isConnected, false, 'destroy 后必须从 DOM 彻底移除');
});

test('Security: 网页 untrusted text 注入防护 (XSS Sanitization)', async () => {
  const card = new Card({
    lookup: async () => ({
      phonetic: '<script>alert(1)</script>',
      translation: '<img src=x onerror="hack()">\n<b>Bold malicious</b>',
      tags: ['zk'],
      rank: 1,
    }),
    onKnown: () => {},
    onPointerEnter: () => {},
    onPointerLeave: () => {},
  });

  const maliciousTextNode = document.createTextNode('<img src=x onerror=hack()>');
  document.body.append(maliciousTextNode);
  const maliciousToken = new ScannedToken(
    maliciousTextNode,
    0,
    26,
    '<script>evil()</script>',
    '"><script>evilLemma()</script>',
    7,
  );

  await card.show(maliciousToken, new DOMRect(10, 20, 30, 40));

  const shadow = card.shadowRoot;

  // 验证 Shadow DOM 中绝对不产生可执行的恶意 HTML 元素
  assert.strictEqual(shadow.querySelectorAll('script').length, 0, '严禁生成 script 标签');
  assert.strictEqual(shadow.querySelectorAll('img').length, 0, '严禁生成 img 标签');

  // 验证文本以字面量形式纯文本显示
  assert.strictEqual(shadow.querySelector('.word')?.textContent, '<script>evil()</script>');
  assert.strictEqual(shadow.querySelector('.lemma')?.textContent, '原形 "><script>evilLemma()</script>');
  assert.strictEqual(shadow.querySelector('.phonetic')?.textContent, '/<script>alert(1)</script>/');
  assert.ok(shadow.querySelector('.zh')?.textContent?.includes('<img src=x onerror="hack()">'));

  card.destroy();
});
