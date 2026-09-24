import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { applyStyle, clear, removeStyle } from '../src/lib/highlight';
import { readSettings, settingsStore, withDefaults } from '../src/lib/settings';
import { DEFAULT_SETTINGS, type Settings } from '../src/lib/types';

/**
 * [M5-W10 Test Suite]
 * 针对「文字变色」标注样式 COLOR-01 ~ COLOR-16 自动化测试。
 */

const __dirname = fileURLToPath(new URL('.', import.meta.url));

let window: Window;
let lastReplacedCss = '';

class MockHighlight extends Set<Range> {
  priority = 0;
  type = 'highlight';
  constructor(...ranges: Range[]) {
    super(ranges);
  }
}

const mockHighlights = new Map<string, MockHighlight>();

before(() => {
  window = new Window({ url: 'https://example.com' });
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

  // 监控 replaceSync 的实际传入参数，精确验证生成并挂载至 CSSStyleSheet 的 CSS 规则
  const origReplaceSync = window.CSSStyleSheet.prototype.replaceSync;
  window.CSSStyleSheet.prototype.replaceSync = function (cssText: string) {
    lastReplacedCss = cssText;
    return origReplaceSync.call(this, cssText);
  };
});

beforeEach(async () => {
  clear();
  removeStyle();
  lastReplacedCss = '';
  await settingsStore.setValue(DEFAULT_SETTINGS);
});

// ------------------------------------------------------------ Settings (COLOR-01 ~ 03)

test('COLOR-01: color 可以保存并读取', async () => {
  await settingsStore.setValue({ ...DEFAULT_SETTINGS, style: 'color' });
  const loaded = await readSettings();
  assert.strictEqual(loaded.style, 'color', '保存为 color 后读取结果必须为 color');
});

test('COLOR-02: withDefaults 可以正确保留 color', () => {
  const result = withDefaults({ style: 'color' });
  assert.strictEqual(result.style, 'color', 'withDefaults 不得将已存在的 color 冲掉');
});

test('COLOR-03: 旧设置缺少 style 时仍默认 dotted，存量既有设置保持兼容', () => {
  const empty = withDefaults({});
  assert.strictEqual(empty.style, 'dotted', '未设置 style 时应默认 fallback 为 dotted');

  const legacy = withDefaults({ level: 4, markUnknown: false });
  assert.strictEqual(legacy.style, 'dotted', '缺少 style 的旧版数据对象应平滑补全为 dotted');

  assert.strictEqual(withDefaults({ style: 'dotted' }).style, 'dotted');
  assert.strictEqual(withDefaults({ style: 'underline' }).style, 'underline');
  assert.strictEqual(withDefaults({ style: 'tint' }).style, 'tint');
});

// ------------------------------------------------------------ Highlight (COLOR-04 ~ 07)

test('COLOR-04: color 样式不产生 underline', () => {
  applyStyle('color');
  assert.ok(!lastReplacedCss.includes('text-decoration-line: underline'), 'color 规则绝不可包含下划线声明');
  assert.ok(lastReplacedCss.includes('text-decoration: none'), 'color 规则必须显式将 text-decoration 设为 none');
});

test('COLOR-05: color 样式不产生 background 底色', () => {
  applyStyle('color');
  assert.ok(!lastReplacedCss.includes('oklch'), 'color 规则绝不可包含 tint 的 oklch 颜色洗底');
  assert.ok(lastReplacedCss.includes('background-color: transparent'), 'color 规则必须显式将 background-color 设为 transparent');
});

test('COLOR-06: Light 模式使用 #D9622B', () => {
  applyStyle('color');
  assert.ok(lastReplacedCss.includes('color: #D9622B;'), '默认规则中文字颜色必须为 #D9622B');
});

test('COLOR-07: Dark 模式使用 #FF9A5C 并通过 media query 声明', () => {
  applyStyle('color');
  assert.ok(lastReplacedCss.includes('@media (prefers-color-scheme: dark)'), '必须使用 @media (prefers-color-scheme: dark) 适配暗色');
  assert.ok(lastReplacedCss.includes('color: #FF9A5C;'), '暗色媒体查询中文字颜色必须为 #FF9A5C');
});

// ------------------------------------------------------------ Style Switching (COLOR-08 ~ 13)

test('COLOR-08: dotted → color 切换无残留', () => {
  applyStyle('dotted');
  assert.ok(lastReplacedCss.includes('dotted'));

  applyStyle('color');
  assert.ok(!lastReplacedCss.includes('dotted'), '切换到 color 后不可残留 dotted 规则');
  assert.ok(lastReplacedCss.includes('color: #D9622B;'), '必须更新为 color 规则');
});

test('COLOR-09: underline → color 切换无残留', () => {
  applyStyle('underline');
  assert.ok(lastReplacedCss.includes('solid'));

  applyStyle('color');
  assert.ok(!lastReplacedCss.includes('solid'), '切换到 color 后不可残留 solid 下划线规则');
  assert.ok(lastReplacedCss.includes('color: #D9622B;'), '必须更新为 color 规则');
});

test('COLOR-10: tint → color 切换无残留', () => {
  applyStyle('tint');
  assert.ok(lastReplacedCss.includes('oklch('));

  applyStyle('color');
  assert.ok(!lastReplacedCss.includes('oklch('), '切换到 color 后不可残留 tint 规则');
  assert.ok(lastReplacedCss.includes('color: #D9622B;'), '必须更新为 color 规则');
});

test('COLOR-11: color → dotted 切换无残留', () => {
  applyStyle('color');
  assert.ok(lastReplacedCss.includes('#D9622B'));

  applyStyle('dotted');
  assert.ok(!lastReplacedCss.includes('#D9622B'), '切换回 dotted 后不可残留 #D9622B');
  assert.ok(!lastReplacedCss.includes('#FF9A5C'), '切换回 dotted 后不可残留 #FF9A5C');
  assert.ok(lastReplacedCss.includes('dotted'), '必须更新为 dotted 规则');
});

test('COLOR-12: color → underline 切换无残留', () => {
  applyStyle('color');
  assert.ok(lastReplacedCss.includes('#D9622B'));

  applyStyle('underline');
  assert.ok(!lastReplacedCss.includes('#D9622B'), '切换回 underline 后不可残留 #D9622B');
  assert.ok(!lastReplacedCss.includes('#FF9A5C'), '切换回 underline 后不可残留 #FF9A5C');
  assert.ok(lastReplacedCss.includes('solid'), '必须更新为 underline 规则');
});

test('COLOR-13: color → tint 切换无残留', () => {
  applyStyle('color');
  assert.ok(lastReplacedCss.includes('#D9622B'));

  applyStyle('tint');
  assert.ok(!lastReplacedCss.includes('#D9622B'), '切换回 tint 后不可残留 #D9622B');
  assert.ok(!lastReplacedCss.includes('#FF9A5C'), '切换回 tint 后不可残留 #FF9A5C');
  assert.ok(lastReplacedCss.includes('oklch('), '必须更新为 tint 规则');
});

// ------------------------------------------------------------ Options UI (COLOR-14 ~ 16)

test('COLOR-14: Options 页面 DOM 结构中存在第四张样式卡片', () => {
  const htmlPath = resolve(__dirname, '../src/entrypoints/options/index.html');
  const htmlContent = readFileSync(htmlPath, 'utf-8');

  const optDoc = new Window().document;
  optDoc.body.innerHTML = htmlContent;

  const styleContainer = optDoc.getElementById('style');
  assert.ok(styleContainer, '必须存在 #style 容器');

  const radios = styleContainer.querySelectorAll('input[name="style"]');
  assert.strictEqual(radios.length, 4, '样式单选列表必须恰好包含 4 个选项');

  const colorRadio = styleContainer.querySelector('input[name="style"][value="color"]');
  assert.ok(colorRadio, '必须包含 value="color" 的单选按钮');

  const swatch = (colorRadio as unknown as { parentElement?: { querySelector: (s: string) => unknown } }).parentElement?.querySelector('.swatch.color');
  assert.ok(swatch, 'color 选项内必须包含 class="swatch color" 的预览节点');
});

test('COLOR-15: 选择 color 后状态同步逻辑验证', () => {
  const htmlPath = resolve(__dirname, '../src/entrypoints/options/index.html');
  const htmlContent = readFileSync(htmlPath, 'utf-8');
  const optDoc = new Window().document;
  optDoc.body.innerHTML = htmlContent;

  const currentSettings: Settings = { ...DEFAULT_SETTINGS, style: 'color' };
  const styleInput = optDoc.querySelector(
    `input[name="style"][value="${currentSettings.style}"]`,
  ) as unknown as { checked: boolean; value: string } | null;
  assert.ok(styleInput, '基于 settings.style 能查找到对应 input');
  styleInput.checked = true;
  assert.strictEqual(styleInput.checked, true, '选中状态必须正确置为 true');
  assert.strictEqual(styleInput.value, 'color');
});

test('COLOR-16: Options 预览区文案为 reading 且文字变色样式定义符合规范', () => {
  const htmlPath = resolve(__dirname, '../src/entrypoints/options/index.html');
  const htmlContent = readFileSync(htmlPath, 'utf-8');
  const optDoc = new Window().document;
  optDoc.body.innerHTML = htmlContent;

  const colorRadio = optDoc.querySelector('input[name="style"][value="color"]');
  const label = (colorRadio as unknown as { parentElement?: { querySelector: (s: string) => { textContent: string | null } | null; textContent: string | null } }).parentElement;
  assert.ok(label, '必须获取到包含 color radio 的 label 元素');
  const swatch = label.querySelector('.swatch.color');
  assert.strictEqual(swatch?.textContent?.trim(), 'reading', '预览文案必须为 "reading"');
  assert.ok(label.textContent?.includes('文字变色'), '标签描述文案必须包含 "文字变色"');

  const cssPath = resolve(__dirname, '../src/entrypoints/options/style.css');
  const cssContent = readFileSync(cssPath, 'utf-8');
  assert.ok(cssContent.includes('.swatch.color'), 'style.css 中必须定义 .swatch.color');
  assert.ok(cssContent.includes('#D9622B'), 'style.css 中必须包含 #D9622B');
  assert.ok(cssContent.includes('#FF9A5C'), 'style.css 中暗色适配必须包含 #FF9A5C');
});
