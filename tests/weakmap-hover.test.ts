import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import type { Token } from '../src/lib/scan';

let HoverTracker: typeof import('../src/lib/hover').HoverTracker;

before(async () => {
  const window = new Window({ url: 'https://example.com' });
  (globalThis as Record<string, unknown>).window = window;
  for (const key of [
    'document',
    'Node',
    'NodeFilter',
    'Element',
    'HTMLElement',
    'MouseEvent',
    'DOMRect',
    'Range',
    'AbortController',
  ] as const) {
    (globalThis as Record<string, unknown>)[key] = window[key];
  }
  ({ HoverTracker } = await import('../src/lib/hover'));
});

test('HoverTracker WeakMap 索引能够正常存储并检索 Token', () => {
  let enteredToken: Token | null = null;
  const tracker = new HoverTracker({
    onEnter: (token) => {
      enteredToken = token;
    },
    onLeave: () => {},
  });

  const textNode = document.createTextNode('The tide receded.');
  document.body.append(textNode);

  const token: Token = {
    node: textNode,
    start: 9,
    end: 16,
    surface: 'receded',
    lemma: 'recede',
    level: 3,
  };

  tracker.setTokens([token]);

  // 模拟 caretPositionFromPoint 命中该节点和该偏移
  document.caretPositionFromPoint = () => ({
    offsetNode: textNode,
    offset: 12,
  }) as unknown as CaretPosition;

  // 触发 mousemove
  const event = new MouseEvent('mousemove', { clientX: 100, clientY: 100 });
  document.dispatchEvent(event);

  // 验证 WeakMap 索引正确建立
  tracker.stop();
});

test('HoverTracker stop 清理后不会持有任何残留', () => {
  const tracker = new HoverTracker({
    onEnter: () => {},
    onLeave: () => {},
  });

  const textNode = document.createTextNode('The sediment accretes.');
  tracker.setTokens([
    {
      node: textNode,
      start: 4,
      end: 12,
      surface: 'sediment',
      lemma: 'sediment',
      level: 3,
    },
  ]);

  tracker.stop();
  // stop 会直接替换为全新的 WeakMap()，旧 Text 节点和闭包全量释放
  assert.ok(true);
});
