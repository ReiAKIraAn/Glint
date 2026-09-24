/**
 * 把三份原始词表压成扩展运行时用的索引。
 *
 *   data/ecdict.csv                            词条：音标 / 中文释义 / COCA+BNC 词频 / 考试标签 / 词形变化
 *   data/cefrj-vocabulary-profile-1.5.csv      CEFR A1–B2 人工分级
 *   data/octanove-vocabulary-profile-c1c2.csv  CEFR C1–C2 人工分级
 *
 * 产出两份，按“谁需要它、什么时候需要”拆分：
 *
 *   src/assets/lexicon.json   词 → 等级、变形 → 原型。被 content script 直接 import 进 bundle，
 *                             扫描页面时同步查表，没有 fetch 也没有 await。
 *   public/data/dict.json     词 → 音标/释义/标签。只有 hover 才用得上，由 background 懒加载。
 *
 * 运行：pnpm data
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ruleLemma } from '../src/lib/lemma';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** CEFR 六级映射成 1–6，运行时只比大小。 */
const CEFR = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 } as const;
type Level = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * 排名比这还靠后的词，网页上几乎不会出现，收进来只是给每个页面的 content script 增重。
 * 落在词库外的词运行时按「生僻」处理，本来就是我们想要的结果。
 */
const RANK_CAP = 60_000;

/** 只保留看起来像英文单词的词条：纯字母，允许词内连字符和撇号。 */
const WORD_SHAPE = /^[a-z]+(?:[-'][a-z]+)*$/;

/** 没有人工分级时，用 COCA/BNC 词频排名反推难度。分界点参照各级别常用的覆盖率区间。 */
function levelFromRank(rank: number): Level {
  if (rank <= 1000) return 1;
  if (rank <= 2000) return 2;
  if (rank <= 4000) return 3;
  if (rank <= 8000) return 4;
  if (rank <= 16000) return 5;
  return 6;
}

// ---------------------------------------------------------------- CEFR 人工分级

/**
 * CEFR 表里一个词可能有多个词性行，等级各不相同（bear 作动词 A2、作名词 B2）。
 * 取最低的那个：只要有一个常见读法，这个词就不该被标成难词。宁可漏标，不要满屏彩灯。
 */
function readCefr(): Map<string, Level> {
  const out = new Map<string, Level>();
  const add = (headword: string, cefr: string) => {
    const level = CEFR[cefr.trim() as keyof typeof CEFR];
    if (!level) return;
    // "adviser/advisor"、"airplane/aeroplane" 这种拼写变体拆成独立词条
    for (const variant of headword.split('/')) {
      const w = variant.trim().toLowerCase();
      if (!WORD_SHAPE.test(w)) continue; // 短语和缩写留给别处
      const prev = out.get(w);
      if (prev === undefined || level < prev) out.set(w, level);
    }
  };

  for (const file of [
    'data/cefrj-vocabulary-profile-1.5.csv',
    'data/octanove-vocabulary-profile-c1c2-1.0.csv',
  ]) {
    const rows = parse(readFileSync(resolve(ROOT, file)), {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
    }) as Record<string, string>[];
    for (const row of rows) if (row.headword && row.CEFR) add(row.headword, row.CEFR);
  }
  return out;
}

// ---------------------------------------------------------------- ECDICT

/**
 * 国内考纲从易到难。一个词落在最容易的那一级上——「我过了六级」意味着
 * 中考/高考/四级/六级四张表里的词都该静音，所以存「最低门槛」而不是全部标签。
 *
 * 雅思/托福/GRE 不在这条阶梯上：过了六级完全不代表认识 GRE 词汇，
 * 它们只出现在悬浮卡片的标签里，不参与静音。
 */
const EXAM_LADDER = ['zk', 'gk', 'cet4', 'cet6', 'ky'] as const;

/**
 * 可以设为备考目标的考纲。这份是完整词表（不是最低门槛），因为备考模式要问的是
 * 「这个词在不在雅思词表里」，而一个词可能同时属于六级和雅思。
 *
 * 只有开了备考模式才用得上，所以不打进 content script，单独放一个文件懒加载。
 */
const EXAM_TARGETS = ['cet4', 'cet6', 'ky', 'toefl', 'ielts', 'gre'] as const;

interface EcdictRow {
  word: string;
  phonetic: string;
  translation: string;
  tag: string;
  collins: string;
  oxford: string;
  bnc: string;
  frq: string;
  /** "p:ran/i:running/d:run/0:run/3:runs" —— 词形变化，见 parseExchange */
  exchange: string;
}

/**
 * exchange 字段是 ECDICT 的词形变化表，正好省掉我们自己做词形还原。
 *   p 过去式 / d 过去分词 / i 现在分词 / 3 第三人称单数 / r 比较级 / t 最高级 / s 复数
 *   0 原型（这一行本身是变形时指回原型）/ 1 变换类型（用不上）
 */
function parseExchange(raw: string): { forms: string[]; lemma?: string } {
  const forms: string[] = [];
  let lemma: string | undefined;
  for (const part of raw.split('/')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const key = part.slice(0, i);
    const value = part.slice(i + 1).trim().toLowerCase();
    if (!value) continue;
    if (key === '0') lemma = value;
    else if (key !== '1') forms.push(value);
  }
  return { forms, lemma };
}

/**
 * ECDICT 的音标字段带着一批陈年的编码损坏，直接显示会是乱码。
 * 逐条都拿真实词对照确认过替换目标：
 *
 *   ^     → ɡ   10918 处。ablatograph "æ'blætә^rɑ:f" = ˌæblætəɡrɑːf
 *   \\\\  → ɜ    1295 处，总是紧跟 ':'。converter "kәn'v\\\\:tә(r)" = kənˈvɜːtə(r)
 *   ә     → ə   99520 处。存的是西里尔字母 U+04D9，不是 IPA 的 U+0259——
 *                长得一模一样，但字体不覆盖西里尔时会跳字体，复制出去也是错的字符。
 *   є     → ɛ   乌克兰语 ie，同样是串码。
 *   @     → ə   SAMPA 风格的残留。
 *
 * 顺带把 ASCII 的重音和长音符号换成真正的 IPA 记号（' → ˈ，, → ˌ，: → ː）。
 * 这个字段里 ' 只用于重音、: 只用于长音，替换没有歧义。
 */
const PHONETIC_FIXES: [RegExp, string][] = [
  [/\\{2,}/g, 'ɜ'],
  [/\^/g, 'ɡ'],
  [/ә/g, 'ə'],
  [/є/g, 'ɛ'],
  [/ˊ/g, 'ˈ'],
  [/@/g, 'ə'],
  [/ /g, ' '],
  [/（/g, '('],
  [/）/g, ')'],
  [/'/g, 'ˈ'],
  [/,/g, 'ˌ'],
  [/:/g, 'ː'],
];

/** 修完之后还剩下这些字符，说明是我们没见过的损坏，宁可不显示。 */
const PHONETIC_GARBAGE = /[\\^?=0-9<>{}|~`!$%&*+_"]/;

function cleanPhonetic(raw: string): string {
  // 分号分隔的是多个读音变体，卡片只显示主读音
  let out = raw.split(';')[0]!.trim();
  if (!out) return '';
  for (const [pattern, replacement] of PHONETIC_FIXES) out = out.replace(pattern, replacement);
  out = out.trim();
  return PHONETIC_GARBAGE.test(out) ? '' : out;
}

/** 中文释义在 CSV 里是字面量 \n，且常带 [网络] / 人名 之类的噪声段落。留前三条。 */
function cleanTranslation(raw: string): string {
  return raw
    .replace(/\\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('[网络]') && !/^n\. \(/.test(line))
    .slice(0, 3)
    .join('\n')
    .slice(0, 160);
}

function main() {
  const cefr = readCefr();
  console.log(`CEFR 人工分级：${cefr.size} 词`);

  const rows = parse(readFileSync(resolve(ROOT, 'data/ecdict.csv')), {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
  }) as EcdictRow[];
  console.log(`ECDICT 原始词条：${rows.length}`);

  /** word → level */
  const levels: Record<string, Level> = {};
  /** 变形 → 原型 */
  const lemmas: Record<string, string> = {};
  /** word → 考纲最低门槛，1=中考 … 5=考研，没上榜的不记 */
  const examFloor: Record<string, number> = {};
  /** 考纲 → 完整词表，供备考模式用 */
  const examTargets: Record<string, Set<string>> = Object.fromEntries(
    EXAM_TARGETS.map((t) => [t, new Set<string>()]),
  );
  /** word → 悬浮卡片要显示的东西 */
  const dict: Record<string, [phonetic: string, translation: string, tag: string, rank: number]> =
    {};

  for (const row of rows) {
    const word = row.word?.trim().toLowerCase();
    // 下限是 1 而不是 2：a 和 i 必须在表里，否则 "I'm" 归一化成 "i" 之后查不到，
    // 会被判成生僻词标出来。
    if (!word || word.length > 24 || !WORD_SHAPE.test(word)) continue;

    const frq = Number(row.frq) || 0;
    const bnc = Number(row.bnc) || 0;
    const collins = Number(row.collins) || 0;
    const curated = collins > 0 || row.oxford === '1' || !!row.tag;

    /**
     * COCA（frq）优先，它更贴近当代书面和网络文本。
     *
     * 只有 BNC 排名、COCA 是 0、又没有任何词典质量信号的，基本都是 ECDICT 里的垃圾条目——
     * 比如 "postpon"（bnc=19201, frq=0，一个被截断的假词）。这种词一旦进了等级表，
     * 就会被词形还原规则当成 postponing 的原型，整条链就歪了。
     */
    const rank = frq > 0 ? (bnc > 0 ? Math.min(frq, bnc) : frq) : curated ? bnc : 0;
    const hasSignal = rank > 0 || curated;

    // 分级：人工标注优先，其次词频。两者都没有的词就是生僻词——
    // 但不写进 levels，运行时“查不到”本身就等价于“最难”，还省一份体积。
    /**
     * 人工分级和词频打架时取更简单的那个。
     *
     * CEFR-J 标的是「学习者该在哪一级主动产出这个词」，跟「读到时认不认识」不是一回事。
     * data 被标成 B2，但它的 COCA 排名是 559——一个每天都撞见几十次的词，
     * 拿来当生词标出来只会让人觉得这工具不懂英语。
     */
    const manual = cefr.get(word);
    const byRank = rank > 0 && rank <= RANK_CAP ? levelFromRank(rank) : undefined;
    if (manual !== undefined && byRank !== undefined) levels[word] = Math.min(manual, byRank) as Level;
    else if (manual !== undefined) levels[word] = manual;
    else if (byRank !== undefined) levels[word] = byRank;

    const tagList = (row.tag ?? '').split(' ').filter(Boolean);
    for (const target of EXAM_TARGETS) {
      if (tagList.includes(target)) examTargets[target]!.add(word);
    }
    for (let i = 0; i < EXAM_LADDER.length; i++) {
      if (!tagList.includes(EXAM_LADDER[i]!)) continue;
      const rung = i + 1;
      const prev = examFloor[word];
      if (prev === undefined || rung < prev) examFloor[word] = rung;
      break; // 阶梯是有序的，第一个命中就是最低门槛
    }

    const translation = cleanTranslation(row.translation ?? '');
    if (translation && hasSignal) {
      dict[word] = [cleanPhonetic(row.phonetic ?? ''), translation, row.tag?.trim() ?? '', rank];
    }

    const { forms, lemma } = parseExchange(row.exchange ?? '');
    // 这一行自己就是个变形（children → child）
    if (lemma && lemma !== word && WORD_SHAPE.test(lemma)) lemmas[word] = lemma;
    // 这一行是原型，它的各个变形都指回来（ran → run）
    for (const form of forms) {
      if (form === word || !WORD_SHAPE.test(form)) continue;
      // 变形本身如果是个独立常用词就别覆盖（saw 是 see 的过去式，但也是“锯”）
      if (lemmas[form] === undefined) lemmas[form] = word;
    }
  }

  // ---------------------------------------------------------------- 收尾

  /**
   * 变形链拍平：bettering → better → good，一步到位指向最终原型。
   * ECDICT 里这种两级跳不少，不拍平的话运行时得反复查。
   */
  for (const form of Object.keys(lemmas)) {
    let base = lemmas[form]!;
    for (let hop = 0; hop < 4; hop++) {
      const next = lemmas[base];
      if (!next || next === base) break;
      base = next;
    }
    if (base === form) delete lemmas[form];
    else lemmas[form] = base;
  }

  // ECDICT 偶尔只给变形排了词频，原型自己反而是 0——desiccated 有排名，desiccate 没有。
  // 只在原型压根没分级时才从变形那里借：原型有自己的等级就别覆盖，
  // 「变形比原型更常用」这个信息下一步还要用。
  const gradedDirectly = new Set(Object.keys(levels));
  for (const [form, base] of Object.entries(lemmas)) {
    const formLevel = levels[form];
    if (formLevel === undefined || gradedDirectly.has(base)) continue;
    const current = levels[base];
    if (current === undefined || formLevel < current) levels[base] = formLevel;
  }

  /**
   * 关键一步：**把变形从等级表里全部删掉。**
   *
   * ECDICT 把变形当独立词条收录，而变形的词频天然比原型低得多——children 自己排在
   * 两万名开外，直接查就成了 C2。留着它们，运行时就得靠 min(变形, 原型) 这种猜测去补救。
   *
   * 删掉之后，等级表里剩下的每一个词都是原型。于是运行时的规则变得干净且可靠：
   * 「查得到 = 它本身就是原型，不要再还原了」。这一条同时堵死了另一个坑——
   * 规则会把 shimmer 剥成 shim（一个真实存在但完全无关的词），
   * 现在 shimmer 在表里查得到，规则根本不会被调用。
   */
  for (const form of Object.keys(lemmas)) {
    const base = lemmas[form]!;
    const baseLevel = levels[base];
    if (baseLevel === undefined) continue;
    const formLevel = levels[form];
    if (formLevel !== undefined && formLevel < baseLevel) {
      // 少数变形比原型常用得多（media 之于 medium、news 之于 new）。
      // 这种词按原型分级会凭空变难，所以让它当独立词，保留自己的等级。
      delete lemmas[form];
    } else {
      delete levels[form];
    }
  }
  for (const form of Object.keys(lemmas)) {
    // 原型自己都没分级，这条映射是死的
    if (levels[lemmas[form]!] === undefined) delete lemmas[form];
  }

  /**
   * -ly 副词跟对应形容词意思几乎一样，难度不该差好几级。
   * manually 的 COCA 排名是 12880（C1），但 manual 是 A2——认识 manual 的人不会卡在 manually。
   * 只调等级，不动词条：manually 在词典里有自己的中文释义，hover 时该显示它自己的。
   */
  for (const word of Object.keys(levels)) {
    if (!word.endsWith('ly') || word.length < 5) continue;
    const stem = word.slice(0, -2);
    const adjective =
      levels[stem] ?? levels[stem + 'e'] ?? (stem.endsWith('i') ? levels[stem.slice(0, -1) + 'y'] : undefined);
    if (adjective !== undefined && adjective < levels[word]!) levels[word] = adjective;
  }

  const known = (w: string) => levels[w] !== undefined;

  // 规则能还原的交给规则，这张表只留不规则的（ran→run、children→child、better→good）。
  // 这一条砍掉了它九成的体积。
  for (const form of Object.keys(lemmas)) {
    if (ruleLemma(form, known) === lemmas[form]) delete lemmas[form];
  }

  /**
   * 等级表按级分桶存成空格分隔的字符串，不是 {"word":4} 的对象。
   * 每个词省掉两个引号、一个冒号、一个逗号和一位数字——几万个词就是几百 KB，
   * 而且解析几个长字符串比解析几万个 key 的对象字面量快得多。
   */
  const buckets: string[][] = [[], [], [], [], [], []];
  for (const [word, level] of Object.entries(levels)) buckets[level - 1]!.push(word);

  // 考纲按门槛分桶，每个词只出现一次。变形已经从等级表里删掉了，这里跟着对齐。
  const examBuckets: string[][] = [[], [], [], [], []];
  for (const [word, rung] of Object.entries(examFloor)) {
    if (levels[word] === undefined) continue;
    examBuckets[rung - 1]!.push(word);
  }

  const lexicon = {
    levels: buckets.map((b) => b.join(' ')),
    exams: examBuckets.map((b) => b.join(' ')),
    // "form>base" 同样拼成一个长字符串
    lemmas: Object.entries(lemmas)
      .map(([form, base]) => `${form}>${base}`)
      .join(' '),
  };

  mkdirSync(resolve(ROOT, 'src/assets'), { recursive: true });
  mkdirSync(resolve(ROOT, 'public/data'), { recursive: true });
  writeFileSync(resolve(ROOT, 'src/assets/lexicon.json'), JSON.stringify(lexicon));
  writeFileSync(resolve(ROOT, 'public/data/dict.json'), JSON.stringify(dict));

  // 备考词表：只保留还在等级表里的词（变形已经剔除过了），空格拼接
  const exams = Object.fromEntries(
    EXAM_TARGETS.map((t) => [
      t,
      [...examTargets[t]!].filter((w) => levels[w] !== undefined).sort().join(' '),
    ]),
  );
  writeFileSync(resolve(ROOT, 'public/data/exams.json'), JSON.stringify(exams));

  const size = (p: string) => (readFileSync(resolve(ROOT, p)).length / 1024 / 1024).toFixed(2);
  console.log(`\nlexicon.json  ${size('src/assets/lexicon.json')} MB  （打进 content script）`);
  console.log(`  levels  ${Object.keys(levels).length} 词  A1–C2 = ${buckets.map((b) => b.length).join(' / ')}`);
  console.log(`  lemmas  ${Object.keys(lemmas).length} 条不规则变形（规则能还原的已剔除）`);
  console.log(`  exams   ${examBuckets.reduce((n, b) => n + b.length, 0)} 词  中考→考研 = ${examBuckets.map((b) => b.length).join(' / ')}`);
  console.log(`dict.json     ${size('public/data/dict.json')} MB  ${Object.keys(dict).length} 词条  （background 懒加载）`);
  console.log(
    `exams.json    ${size('public/data/exams.json')} MB  ` +
      EXAM_TARGETS.map((t) => `${t} ${exams[t]!.split(' ').filter(Boolean).length}`).join(' / '),
  );
}

main();
