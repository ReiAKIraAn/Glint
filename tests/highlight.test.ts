import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { applyStyle, clear, isSupported, paint, removeStyle } from '../src/lib/highlight';
import { ScannedToken, type Token } from '../src/lib/scan';

/**
 * [Automated Regression Test - Highlight & Style Lifecycle]
 * 运行环境: Node.js + Happy-DOM 模拟环境
 */

let window: Window;

class MockHighlight extends Set<Range> {
  priority = 0;
  type = 'highlight';
  constructor(...ranges: Range[]) {
    super(ranges);
  }
}

const mockHighlights = new Map<string, MockHighlight>();

before(() => {
  window = new Window({ url: 'https://en.wikipedia.org/wiki/Sediment' });
  (globalThis as Record<string, unknown>).window = window;

  for (const key of [
    'document',
    'Node',
    'Element',
    'HTMLElement',
    'HTMLStyleElement',
    'Range',
    'CSS',
    'CSSStyleSheet',
  ] as const) {
    (globalThis as Record<string, unknown>)[key] = (window as unknown as Record<string, unknown>)[key];
  }

  (globalThis as Record<string, unknown>).Document = window.document.constructor;
  (globalThis as Record<string, unknown>).Highlight = MockHighlight;
  (CSS as unknown as Record<string, unknown>).highlights = mockHighlights;
});

beforeEach(() => {
  clear();
  removeStyle();
});

test('isSupported 识别当前环境的 CSS Custom Highlight API 能力', () => {
  assert.strictEqual(isSupported(), true);
});

test('paint 将有效 Token 范围录入 CSS.highlights.get("glint-mark")', () => {
  const p = document.createElement('p');
  const text = document.createTextNode('Sediment settles at the bottom of the lake.');
  p.append(text);
  document.body.append(p);

  const tokens: Token[] = [
    new ScannedToken(text, 0, 8, 'Sediment', 'sediment', 4),
    new ScannedToken(text, 9, 16, 'settles', 'settle', 3),
  ];

  paint(tokens);

  const mark = CSS.highlights.get('glint-mark');
  assert.ok(mark, 'glint-mark 高亮集必须存在');
  assert.strictEqual(mark.size, 2, '高亮集合中应包含两个 Range');

  clear();
  assert.strictEqual(CSS.highlights.has('glint-mark'), false, 'clear 后 glint-mark 必须被移除');
});

test('applyStyle 正常时通过 document.adoptedStyleSheets 注入规则', () => {
  applyStyle('dotted');

  assert.ok(document.adoptedStyleSheets.length > 0, 'adoptedStyleSheets 必须包含新创建的 sheet');

  // 验证切换样式
  applyStyle('underline');
  assert.strictEqual(document.adoptedStyleSheets.length, 1, '同一实例更新规则，不应重复追加样式表');

  removeStyle();
  assert.strictEqual(document.adoptedStyleSheets.length, 0, 'removeStyle 必须清理 adoptedStyleSheets');
});

test('applyStyle 在 adoptedStyleSheets 抛出异常时平滑回退到 <style> 标签', () => {
  // 模拟 WebKit 跨上下文限制导致 adoptedStyleSheets 赋值报错
  const originalAdopted = Object.getOwnPropertyDescriptor(window.document.constructor.prototype, 'adoptedStyleSheets') ||
    Object.getOwnPropertyDescriptor(document, 'adoptedStyleSheets');

  Object.defineProperty(document, 'adoptedStyleSheets', {
    get() {
      throw new Error('Cross-world adoptedStyleSheets access restricted');
    },
    set() {
      throw new Error('Cross-world adoptedStyleSheets access restricted');
    },
    configurable: true,
  });

  try {
    assert.doesNotThrow(() => {
      applyStyle('dotted');
    }, 'WebKit 限制时不应崩溃，需平滑捕获');

    const fallback = document.getElementById('glint-mark-style');
    assert.ok(fallback, '必须在 head/html 挂载 fallback <style> 标签');
    assert.ok(fallback.textContent?.includes('::highlight(glint-mark)'), 'fallback 标签必须包含 ::highlight(glint-mark) 规则');

    removeStyle();
    assert.strictEqual(document.getElementById('glint-mark-style'), null, 'removeStyle 必须移除 fallback 标签');
  } finally {
    if (originalAdopted) {
      Object.defineProperty(document, 'adoptedStyleSheets', originalAdopted);
    } else {
      delete (document as Record<string, unknown>).adoptedStyleSheets;
    }
  }
});
