import type { Settings } from './types';
import type { Token } from './scan';

/**
 * 用 CSS Custom Highlight API 上色，不碰 DOM 结构。
 *
 * 换成给每个词包一层 <span> 的话：页面已有的事件监听会失效，React/Vue 一次 rerender
 * 就把标注冲掉，而且我们自己插入的节点又会触发 MutationObserver，很容易转成死循环。
 * Range + CSS.highlights 完全绕开这些——DOM 一个字节都没改。
 *
 * 代价是 highlight 不接收鼠标事件，所以 hover 要靠 caretPositionFromPoint 反查，见 hover.ts。
 */

/**
 * 所有标注一个样，不按难度分深浅。
 *
 * 页面上的标注只回答一件事：这个词值得停一下。分了档，读者就得一边读一边解码
 * 「这个比那个深一点是什么意思」——而真要知道多难，鼠标停上去，卡片右上角的
 * 等级徽章会直说 B2 还是 C2，那里说得比色深准确得多。
 */
const NAME = 'glint-mark';

export function isSupported(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight === 'function';
}

export function paint(tokens: Token[]) {
  if (!isSupported()) return;
  const ranges: Range[] = [];

  for (const token of tokens) {
    const range = new Range();
    try {
      range.setStart(token.node, token.start);
      range.setEnd(token.node, token.end);
    } catch {
      continue; // 节点在扫描后被页面改掉了，跳过
    }
    ranges.push(range);
  }

  CSS.highlights.set(NAME, new Highlight(...ranges));
}

export function clear() {
  if (!isSupported()) return;
  CSS.highlights.delete(NAME);
}

/**
 * ::highlight() 的样式必须挂在**文档**层，shadow root 里的样式表对它不生效。
 * 所以这里用 adoptedStyleSheets 而不是往 <head> 塞 <style>——不留 DOM 节点，
 * 页面脚本遍历 head 的时候不会被我们绊到。
 */
let sheet: CSSStyleSheet | undefined;

export function applyStyle(style: Settings['style']) {
  if (!sheet) {
    sheet = new CSSStyleSheet();
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }
  sheet.replaceSync(css(style));
}

export function removeStyle() {
  if (!sheet) return;
  document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
  sheet = undefined;
}

/**
 * 颜色用 color-mix 把品牌蓝掺进 currentColor：
 * 浅色页面上 currentColor 是深的，深色页面上是浅的，标注跟着页面走，
 * 不用去猜网站的主题，也不会在暗色站上糊成一团。
 */
function css(style: Settings['style']): string {
  const ink = (pct: number) =>
    `color-mix(in oklch, oklch(62% 0.17 258) ${pct}%, currentColor)`;
  const wash = (pct: number) => `oklch(62% 0.17 258 / ${pct}%)`;

  const decorate = (thickness: string, alpha: number, line: string) => `
    text-decoration-line: underline;
    text-decoration-style: ${line};
    text-decoration-thickness: ${thickness};
    text-decoration-color: ${ink(alpha)};
    text-underline-offset: 0.22em;
  `;

  /**
   * 三种样式的浓淡取的是原来中间那一档：够看见，又不至于让整页跳起来。
   * 底色只有 tint 有——那是用户主动选的，不该是别的样式的副作用。
   */
  const rules: Record<Settings['style'], string> = {
    dotted: decorate('2px', 70, 'dotted'),
    underline: decorate('1.5px', 62, 'solid'),
    tint: `background-color: ${wash(14)};`,
  };

  return `::highlight(${NAME}) { ${rules[style]} }`;
}
