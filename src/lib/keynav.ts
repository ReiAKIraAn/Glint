import type { Card } from './card';
import type { HoverTracker } from './hover';
import type { Token } from './scan';

/**
 * 键盘遍历标注的词。
 *
 * 标注是用 CSS Custom Highlight API 画上去的，页面上没有对应的 DOM 节点，
 * Tab 键永远走不到——不做这一条的话，键盘用户和读屏用户根本看不到释义，
 * 那不是「少个便利」，是整个功能对他们不存在。
 *
 * 抽成模块是因为内容脚本和预览沙盒都要用：沙盒存在的意义就是能在普通页面里
 * 试真实行为，两边各写一份的话，能试的就不是同一个东西了。
 */
export interface WordNav {
  /** delta 为正往后走，为负往前走；到头绕回去。 */
  step(delta: number): void;
  /** 挂在 keydown 上：Esc 收掉键盘钉住的卡片。 */
  onKeydown(event: KeyboardEvent): void;
}

export function createWordNav(deps: {
  tokens: () => Token[];
  hover: HoverTracker;
  card: Card;
}): WordNav {
  let cursor = -1;

  return {
    step(delta) {
      const tokens = deps.tokens();
      if (!tokens.length) return;
      cursor = (cursor + delta + tokens.length) % tokens.length;
      const token = tokens[cursor]!;
      // 先滚到视野里，再钉卡片——反过来的话卡片会定位在滚动前的旧坐标上
      centerOn(token);
      requestAnimationFrame(() => {
        deps.hover.pin(token);
        deps.card.focus(); // 焦点送进卡片，接下来 Tab 才走得到里面那两个按钮
      });
    },

    onKeydown(event) {
      if (event.key !== 'Escape' || !deps.hover.isPinned) return;
      deps.hover.unpin();
      event.stopPropagation();
    },
  };
}

/**
 * 把某个词滚进视野中间。
 *
 * 不用 scrollIntoView：那要一个元素，而我们手上只有文本节点里的一段区间。
 * 已经在视野里（而且离边缘够远）就不动——跳到相邻的词时页面跟着抖一下很难受，
 * 而且卡片要往下展开，贴着底边的话没地方放。
 */
const MARGIN = 120;

function centerOn(token: Token) {
  const range = new Range();
  try {
    range.setStart(token.node, token.start);
    range.setEnd(token.node, token.end);
  } catch {
    return;
  }
  const rect = range.getBoundingClientRect();
  if (rect.top >= MARGIN && rect.bottom <= window.innerHeight - MARGIN) return;
  window.scrollBy({ top: rect.top - window.innerHeight / 2, behavior: 'auto' });
}
