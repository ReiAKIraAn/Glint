/**
 * 规则词形还原。
 *
 * 关键技巧：每个候选原型都要拿回词库里验证一次。没有这一步，"during" 会被剥成 "dur"，
 * "address" 会被剥成 "addres"。有了这一步，剥错的候选查不到，自然被丢掉——
 * 于是几十行规则就能达到相当高的准确率，不需要带一个词形还原库进来。
 *
 * 规则搞不定的（ran→run、children→child、better→good）由词库里的不规则表兜底，
 * 那张表只收规则还原不出来的条目，所以很小。
 */

/** `exists` 是词库的查询函数，构建脚本和运行时传各自的。 */
export function ruleLemma(word: string, exists: (w: string) => boolean): string | undefined {
  const ok = (candidate: string) =>
    candidate.length >= 2 && candidate !== word && exists(candidate) ? candidate : undefined;

  // 词尾辅音重复还原：running → runn → run，stopped → stopp → stop
  const undouble = (stem: string) => {
    const n = stem.length;
    return n >= 3 && stem[n - 1] === stem[n - 2] ? stem.slice(0, -1) : stem;
  };

  const first = (...candidates: (string | undefined)[]) => candidates.find(Boolean);

  /**
   * 去掉 -ing / -ed 之后，原型该不该补回一个 e？
   *
   * 光看「哪个候选是真词」不够，因为两个候选常常都是真词：
   * hoping 的 hop 和 hope 都存在，writing 的 writ 和 write 都存在。
   * 定序的依据是英语的双写规则——词干如果是「辅音 + 单元音 + 单辅音」，
   * 那它加 -ing 时本该双写（hop → hopping）。既然没双写，说明原型末尾有个被吃掉的 e。
   *
   *   hop  → 辅音 h + 元音 o + 辅音 p   ⇒ 补 e：hope     （hoping）
   *   sing → g 前面是 n，不是元音        ⇒ 不补：sing     （singing，不是 singe）
   *   read → d 前面是两个元音            ⇒ 不补：read     （reading）
   *   be   → 结尾是元音                  ⇒ 不补：be       （being，不是 bee）
   *   us   → 元音 + 辅音，前面没东西      ⇒ 补 e：use      （using，不是 us）
   *
   * 两个候选都还是会试，这里只决定谁先试——只有都成立时顺序才起作用。
   */
  const dropsSilentE = (stem: string) => {
    const n = stem.length;
    if (n < 2) return false;
    const last = stem[n - 1]!;
    const prev = stem[n - 2]!;
    const isVowel = (c: string) => 'aeiou'.includes(c);
    if (isVowel(last) || !isVowel(prev)) return false;
    // 元音前面还有元音的话（read、meet）就是长元音，本来也不会双写
    const before = n >= 3 ? stem[n - 3]! : undefined;
    return before === undefined || !isVowel(before);
  };

  /** 按上面的判断给「补 e」和「光词干」定序，两个都会试。 */
  const stemFirst = (stem: string) =>
    dropsSilentE(stem) ? [ok(stem + 'e'), ok(stem)] : [ok(stem), ok(stem + 'e')];

  // 复数 / 第三人称单数
  if (word.endsWith('ies') && word.length > 4) {
    const hit = ok(word.slice(0, -3) + 'y');
    if (hit) return hit;
  }
  if (word.endsWith('es') && word.length > 3) {
    const hit = first(ok(word.slice(0, -2)), ok(word.slice(0, -1)));
    if (hit) return hit;
  }
  if (word.endsWith('s') && !word.endsWith('ss')) {
    const hit = ok(word.slice(0, -1));
    if (hit) return hit;
  }

  // 过去式 / 过去分词
  if (word.endsWith('ied') && word.length > 4) {
    const hit = ok(word.slice(0, -3) + 'y');
    if (hit) return hit;
  }
  if (word.endsWith('ed') && word.length > 3) {
    const stem = word.slice(0, -2);
    const hit = first(...stemFirst(stem), ok(undouble(stem)));
    if (hit) return hit;
  }

  // 现在分词 / 动名词
  if (word.endsWith('ing') && word.length > 4) {
    const stem = word.slice(0, -3);
    // running → runn → run 走 undouble 那一支
    const hit = first(...stemFirst(stem), ok(undouble(stem)));
    if (hit) return hit;
  }

  // 比较级 / 最高级
  if (word.endsWith('est') && word.length > 4) {
    const stem = word.slice(0, -3);
    const hit = first(ok(stem), ok(stem + 'e'), ok(undouble(stem)), ok(stem.slice(0, -1) + 'y'));
    if (hit) return hit;
  }
  if (word.endsWith('er') && word.length > 3) {
    const stem = word.slice(0, -2);
    const hit = first(ok(stem), ok(stem + 'e'), ok(undouble(stem)), ok(stem.slice(0, -1) + 'y'));
    if (hit) return hit;
  }

  // 副词。happily → happy 要走 -ily 分支，不然剥成 happi 查不到
  if (word.endsWith('ily') && word.length > 4) {
    const hit = ok(word.slice(0, -3) + 'y');
    if (hit) return hit;
  }
  if (word.endsWith('ly') && word.length > 3) {
    const hit = first(ok(word.slice(0, -2)), ok(word.slice(0, -2) + 'e'));
    if (hit) return hit;
  }

  return undefined;
}
