/**
 * 把用户数据放进 HTML 之前要做的那几件事。
 *
 * 原来这三个函数各自躺在 options/main.ts 里，只有设置页的列表用得上。
 * 导出 Anki 那一路要拼的是同一种东西（原句里把那个词加粗、其余全部转义），
 * 两边必须逐字一致——不然设置页里看着对的一条，导出去就成了另一个样子。
 */

/**
 * 进 innerHTML 之前必转。
 *
 * 引号也一起转，不只是为了属性值：TSV 里字段带着裸引号会被 Anki 的 csv 解析器
 * 当成引用块的开头，从那一格开始整张卡都会错位。转成 &quot; 之后这个坑从根上没了。
 */
export const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** 词是用户数据，进正则之前得转义，否则一个 `c++` 就能让调用处抛异常。 */
export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 原句里把那个词加粗。
 *
 * 优先用存下来的原样写法，一次精确命中。没有（老条目）才退回按原型找，
 * 而且这一路必须收着来：原来是「取前缀 indexOf，然后把命中处往后所有字母都吃掉」，
 * 于是原型 act 会在句子里撞上 actually，把整个 actually 加粗。
 * 现在要求命中在词首（\b），且后缀不超过三个字母——够覆盖 -s / -ed / -ing，
 * 又不至于把另一个词整个吞进去。都没命中就原样输出，不加粗而已。
 *
 * 返回的是已经转义好的 HTML 片段，调用处别再转一次。
 */
export function boldWord(sentence: string, word: string, surface?: string): string {
  const re = surface
    ? new RegExp(`\\b${escapeRe(surface)}\\b`, 'i')
    : new RegExp(`\\b${escapeRe(word)}[a-z]{0,3}\\b`, 'i');
  const hit = re.exec(sentence);
  if (!hit) return escapeHtml(sentence);
  const at = hit.index;
  return (
    escapeHtml(sentence.slice(0, at)) +
    `<b>${escapeHtml(hit[0])}</b>` +
    escapeHtml(sentence.slice(at + hit[0].length))
  );
}
