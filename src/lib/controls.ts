/**
 * controls.css 里那个自定义滑块的另一半。
 *
 * 已填充的一段是画在轨道背景上的，宽度靠 --p 这个 0~1 的比例算出来——
 * CSS 读不到 input 的当前值，所以得有人在这儿把它写进去。
 * 两个页面各自的「刷新界面」函数里叫一声就行。
 */
export function paintRange(el: HTMLInputElement) {
  const min = Number(el.min || 0);
  const max = Number(el.max || 100);
  const span = max - min;
  el.style.setProperty('--p', String(span ? (Number(el.value) - min) / span : 0));
}
