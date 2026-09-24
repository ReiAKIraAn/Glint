import raw from '@/assets/lexicon.json';
import { ruleLemma } from './lemma';
import { UNKNOWN_LEVEL, type Level } from './types';

/**
 * 词库以「按级分桶的空格分隔字符串」存放（见 scripts/build-data.ts），
 * 第一次用到时才展开成 Map。57000 词大约 20ms，每个页面只发生一次。
 */
let levels: Map<string, Level> | undefined;
let irregulars: Map<string, string> | undefined;
/** 词 → 考纲最低门槛（1=中考 … 5=考研）。没上榜的词不在表里。 */
let exams: Map<string, number> | undefined;

function ensureLoaded() {
  if (levels) return;
  levels = new Map();
  raw.levels.forEach((bucket, index) => {
    if (!bucket) return;
    const level = (index + 1) as Level;
    for (const word of bucket.split(' ')) levels!.set(word, level);
  });
  exams = new Map();
  raw.exams.forEach((bucket, index) => {
    if (!bucket) return;
    for (const word of bucket.split(' ')) exams!.set(word, index + 1);
  });
  irregulars = new Map();
  for (const pair of raw.lemmas.split(' ')) {
    const at = pair.indexOf('>');
    if (at > 0) irregulars.set(pair.slice(0, at), pair.slice(at + 1));
  }
}

export interface Resolved {
  /** 词典原型。查不到时就是归一化后的原词。 */
  lemma: string;
  level: Level | typeof UNKNOWN_LEVEL;
}

/** 一篇文章里同一个词会出现很多次，查过的记住。 */
const memo = new Map<string, Resolved>();

export function resolve(surface: string): Resolved {
  ensureLoaded();
  const word = surface.toLowerCase();
  const cached = memo.get(word);
  if (cached) return cached;
  const result = lookup(word);
  memo.set(word, result);
  return result;
}

/**
 * 等级表里只有原型——变形在构建时就被剔除了（见 scripts/build-data.ts）。
 * 这一点让下面这条规则成立，而它是整个查询的地基：
 *
 *   **查得到，就说明它本身是原型，到此为止，不要再试图还原。**
 *
 * 少了这个前提，规则会去啃那些结尾恰好像变形的正常词：shimmer 被剥成 shim
 * （一个真实存在但毫不相干的词），于是 hover 出来的是「垫片」的释义。
 * 现在 shimmer 在表里查得到，规则根本不会被调用。
 */
function lookup(word: string): Resolved {
  const normalized = normalize(word);
  // 归一化之后只剩一个字母的，只可能是 a / i / o（来自 I'm、I'll、a's）。
  // 这些都是最基础的词，任何情况下都不该被标出来。
  if (normalized.length < 2) return { lemma: normalized || word, level: 1 };

  const own = levels!.get(normalized);
  if (own !== undefined) return { lemma: normalized, level: own };

  // 走到这里说明它不是原型。不规则表优先——规则会把 better 剥成 bet，
  // 把 children 剥成什么都不是。
  const base = irregulars!.get(normalized) ?? ruleLemma(normalized, (c) => levels!.has(c));
  if (base !== undefined) {
    const level = levels!.get(base);
    if (level !== undefined) return { lemma: base, level };
  }

  return { lemma: normalized, level: UNKNOWN_LEVEL };
}

/**
 * 缩写形式词库里没有。麻烦的是不能一律按撇号切：
 * "don't" 切出来的 "don" 在词典里是个真词（西班牙语敬称），会被当成 B2 生词标出来。
 */
const CONTRACTIONS: Record<string, string> = {
  "won't": 'will',
  "can't": 'can',
  "shan't": 'shall',
  "ain't": 'be',
  "let's": 'let',
};

function normalize(word: string): string {
  const straight = word.replace(/’/g, "'");
  const known = CONTRACTIONS[straight];
  if (known) return known;
  return straight
    .replace(/n't$/, '') // don't → do，wouldn't → would
    .replace(/'(s|re|ve|ll|d|m)$/, '') // it's / they're / we've / I'll
    .replace(/'$/, ''); // teachers' → teachers
}

/**
 * 这个词最低出现在哪一级考纲里，0 = 不在国内考纲阶梯上。
 * 传原型进来——变形在构建时就已经从索引里剔除了。
 */
export function examFloor(lemma: string): number {
  ensureLoaded();
  return exams!.get(lemma) ?? 0;
}
