import { examFloor, resolve } from './lexicon';
import { UNKNOWN_LEVEL, type Level, type Settings } from './types';

export interface Token {
  /** 弱引用持有的 Text 节点引用，允许脱离文档树的节点被 GC 正常回收 */
  readonly nodeRef?: WeakRef<Text>;
  /** 便捷访问器：返回活跃的 Text 节点，若节点已被 GC 回收则返回 undefined */
  readonly node: Text | undefined;
  /** 在 node.data 里的字符区间 */
  readonly start: number;
  readonly end: number;
  /** 页面上的原始写法 */
  readonly surface: string;
  readonly lemma: string;
  readonly level: Level | typeof UNKNOWN_LEVEL;
}

/**
 * 弱引用 Token 实现类：
 * 解除长期驻留的 tokens 集合对 DOM Text 节点的强引用，
 * 使得 DOM 节点脱离树后能够被浏览器垃圾回收器（GC）自然回收。
 */
export class ScannedToken implements Token {
  readonly nodeRef: WeakRef<Text>;
  readonly start: number;
  readonly end: number;
  readonly surface: string;
  readonly lemma: string;
  readonly level: Level | typeof UNKNOWN_LEVEL;

  constructor(
    node: Text,
    start: number,
    end: number,
    surface: string,
    lemma: string,
    level: Level | typeof UNKNOWN_LEVEL,
  ) {
    this.nodeRef = new WeakRef(node);
    this.start = start;
    this.end = end;
    this.surface = surface;
    this.lemma = lemma;
    this.level = level;
  }

  get node(): Text | undefined {
    return this.nodeRef.deref();
  }
}

/**
 * 整个子树都不该被扫描的元素。
 * code/pre/kbd/samp：里面是代码，标注只会碍事。
 * input/textarea/select：文本不属于文档流，Range 也标不上去。
 */
const OPAQUE_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE',
  'CODE', 'PRE', 'KBD', 'SAMP', 'VAR',
  'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'BUTTON',
  'SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'IFRAME', 'OBJECT', 'MATH',
]);

/** 我们自己插进页面的东西，别扫自己。 */
export const OWN_ELEMENT = 'glint-card';

const WORD_RE = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;

/** 紧挨在词前面的这些字符说明它是标识符的一部分，不是散文里的词。 */
const IDENTIFIER_PREFIX = '@#/._\\';

/**
 * 紧跟在词后面的这些同理。
 *
 * 只看前面是不够的：`config.desiccated`、`Node.js`、`api.deepseek.com` 的**第一段**
 * 前面是空格，一路放行，于是 config 这种词就被当成生僻词标出来了。
 *
 * 点号不在这张表里，单独判——`receded.` 是句号，`config.desiccated` 才是标识符，
 * 差别只在点号后面跟的是空白还是字母数字。
 */
const IDENTIFIER_SUFFIX = '@#/_\\';

/** 句子结束符 + 引号/括号。前一个非空白字符是这些之一，说明当前词在句首。 */
const SENTENCE_BOUNDARY = /[.!?:;"“”'‘’()\[\]—–]/;

/**
 * 收集本页代码块里出现过的词。
 *
 * 技术文档里 plugins、hashtag、parser 这类词落在词库外，会被判成「生僻」标出来，
 * 但它们是领域黑话，不是英语词汇——而黑话几乎一定会同时出现在代码块、命令行或
 * 标识符里。这就是把它们和 latticework、conflagration 那种真生僻词区分开的信号。
 */
/**
 * 收集本页代码块里出现过的词。
 *
 * 技术文档里 plugins、hashtag、parser 这类词落在词库外，会被判成「生僻」标出来，
 * 但它们是领域黑话，不是英语词汇——而黑话几乎一定会同时出现在代码块、命令行或
 * 标识符里。这就是把它们和 latticework、conflagration 那种真生僻词区分开的信号。
 */
export function collectCodeWords(root: Node): Set<string> {
  const words = new Set<string>();
  const scope = root.nodeType === Node.ELEMENT_NODE ? (root as Element) : document;
  for (const el of scope.querySelectorAll('code, pre, kbd, samp, var')) {
    const text = el.textContent;
    if (!text) continue;
    for (const match of text.toLowerCase().matchAll(WORD_RE)) words.add(match[0]);
  }
  return words;
}

/**
 * 扫描单个 Text 节点里的所有生词。
 * 纯字符串与正则匹配，不遍历子树，是增量扫描的最小高性能单元。
 */
export function scanTextNode(
  text: Text,
  settings: Settings,
  known: Set<string>,
  canExplain: boolean,
  codeWords: Set<string>,
  examWords?: Set<string>,
  seen?: Set<string>,
): Token[] {
  const data = text.data;
  if (!data || data.length < 2) return [];

  const tokens: Token[] = [];
  WORD_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WORD_RE.exec(data))) {
    const surface = match[0];
    if (surface.length < 3) continue;

    // 全大写多半是缩写（NASA、CEO），不是要学的词
    if (surface.length > 1 && surface === surface.toUpperCase()) continue;

    // 前后紧贴着这些字符的不是在读的英文，是 @handle、#tag、URL 片段、
    // file.ext、snake_case 标识符。社交媒体和代码密集的页面上这类东西极多。
    if (inIdentifier(data, match.index, surface.length)) continue;

    const { lemma, level } = resolve(surface);
    if (level <= settings.level) continue;

    // 备考模式：先过考纲这道闸，再走后面所有常规判断（交集，不是替代）
    if (examWords && !examWords.has(lemma)) continue;

    if (level === UNKNOWN_LEVEL) {
      if (!settings.markUnknown) continue;
      // 词库里查不到，AI 又没就绪——标出来只会给一张空卡片，不如不标
      if (!canExplain) continue;
      // 在本页代码块里出现过 = 领域黑话，不是英语生词
      if (codeWords.has(lemma)) continue;
      if (isUpper(surface[0]!)) continue;
      // 词库外的短词基本是缩写（ops）、handle、拼写错误，不是值得学的生词
      if (surface.length < 5) continue;
    }

    // 句中的大写词多半是专有名词（人名、地名、产品名）。句首的大写词正常处理。
    if (isUpper(surface[0]!) && !atSentenceStart(data, match.index)) continue;

    // 「我过了六级」= 中考到六级的考纲词全部静音，一次顶几千次「我认识」
    if (settings.passedExam > 0) {
      const floor = examFloor(lemma);
      if (floor > 0 && floor <= settings.passedExam) continue;
    }

    if (known.has(lemma)) continue;
    if (settings.oncePerPage && seen?.has(lemma)) continue;
    seen?.add(lemma);

    tokens.push(
      new ScannedToken(
        text,
        match.index,
        match.index + surface.length,
        surface,
        lemma,
        level,
      ),
    );
  }

  return tokens;
}

/**
 * 对一组新增节点进行祖先/后代包含性裁剪 (Containment Pruning)。
 * 仅保留最小祖先根集合，剔除已被集合中其它祖先包含的子孙节点，
 * 避免同一 DOM 子树被多次重复遍历。
 */
export function pruneContainedNodes(nodes: Iterable<Node>): Node[] {
  const list: Node[] = [];
  for (const node of nodes) {
    if (!node || !node.isConnected) continue;
    let isContained = false;
    for (let i = list.length - 1; i >= 0; i--) {
      const existing = list[i]!;
      if (existing === node || existing.contains(node)) {
        isContained = true;
        break;
      }
      if (node.contains(existing)) {
        list.splice(i, 1);
      }
    }
    if (!isContained) {
      list.push(node);
    }
  }
  return list;
}

/**
 * 增量扫描指定 DOM 子树，避开 OPAQUE_TAGS 和非英文节点。
 */
export function scanSubtree(
  root: Node,
  settings: Settings,
  known: Set<string>,
  canExplain: boolean,
  codeWords: Set<string>,
  examWords?: Set<string>,
  seen: Set<string> = new Set(),
): Token[] {
  if (root.nodeType === Node.ELEMENT_NODE) {
    const el = root as Element;
    if (OPAQUE_TAGS.has(el.tagName) || el.tagName.toLowerCase() === OWN_ELEMENT) return [];
    if ((el as HTMLElement).isContentEditable) return [];
    const lang = el.getAttribute('lang');
    if (lang && !lang.toLowerCase().startsWith('en')) return [];
  } else if (root.nodeType === Node.TEXT_NODE) {
    return scanTextNode(root as Text, settings, known, canExplain, codeWords, examWords, seen);
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType !== Node.ELEMENT_NODE) return NodeFilter.FILTER_ACCEPT;
      const el = node as Element;
      if (OPAQUE_TAGS.has(el.tagName) || el.tagName.toLowerCase() === OWN_ELEMENT) {
        return NodeFilter.FILTER_REJECT;
      }
      if ((el as HTMLElement).isContentEditable) return NodeFilter.FILTER_REJECT;
      const lang = el.getAttribute('lang');
      if (lang && !lang.toLowerCase().startsWith('en')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_SKIP;
    },
  });

  const tokens: Token[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    tokens.push(...scanTextNode(node as Text, settings, known, canExplain, codeWords, examWords, seen));
  }

  return tokens;
}

/**
 * @param canExplain 悬浮卡片是否有能力解释词库外的词（即 AI 已就绪）。
 *   没有这个能力时，标出生僻词只会得到一张「本地词库里没有这个词」的空卡片。
 */
export function scan(
  root: Node,
  settings: Settings,
  known: Set<string>,
  canExplain: boolean,
  /** 备考模式的目标词表。给了就只标这里面的词。 */
  examWords?: Set<string>,
): Token[] {
  const codeWords = collectCodeWords(root);
  return scanSubtree(root, settings, known, canExplain, codeWords, examWords);
}

/** 这个词是不是嵌在标识符里——看它紧邻的前后两个字符。 */
function inIdentifier(data: string, start: number, length: number): boolean {
  const before = data[start - 1];
  if (before !== undefined && IDENTIFIER_PREFIX.includes(before)) return true;

  const after = data[start + length];
  if (after === undefined) return false;
  if (IDENTIFIER_SUFFIX.includes(after)) return true;
  // 点号后面还跟着字母数字才算标识符，否则那就是个句号
  return after === '.' && /[A-Za-z0-9]/.test(data[start + length + 1] ?? '');
}

function isUpper(ch: string) {
  return ch >= 'A' && ch <= 'Z';
}

function atSentenceStart(data: string, index: number): boolean {
  for (let i = index - 1; i >= 0; i--) {
    const ch = data[i]!;
    if (/\s/.test(ch)) continue;
    return SENTENCE_BOUNDARY.test(ch);
  }
  // 文本节点开头。可能真是句首，也可能前面还有别的行内元素——
  // 拿不准就当句首，宁可多扫一个词，也别漏掉整段的第一个词。
  return true;
}

/**
 * 取出这个词所在的句子，喂给 AI 做语境释义。
 * 先在所在文本节点里按标点切；切出来太短说明句子被行内标签拆开了（<em>、<a>），
 * 退一步用最近的块级祖先的文本。
 */
export function sentenceAround(token: Token): string {
  const node = token.node;
  if (!node) return token.surface;
  const local = sliceSentence(node.data, token.start, token.end);
  if (local.length >= 24) return local;

  const block = node.parentElement?.closest('p, li, td, th, dd, dt, blockquote, h1, h2, h3, h4, h5, h6, div');
  const text = block?.textContent?.replace(/\s+/g, ' ').trim();
  if (!text) return local;

  const at = text.indexOf(token.surface);
  if (at < 0) return text.slice(0, MAX_SENTENCE);
  return sliceSentence(text, at, at + token.surface.length);
}

/** 句末标点后面还可以跟收尾的括号引号：`etc.)`、`said."` 都是句子结束。 */
const CLOSERS = /[)\]}"'”’』」）】]/;

/**
 * 这些点号不是句号。技术文档里 e.g. / etc. 出现得比真句号还勤，
 * 按句号切会把一句话拦腰砍断。
 */
const ABBREVIATIONS = new Set([
  'e.g', 'i.e', 'etc', 'vs', 'cf', 'al', 'approx', 'est',
  'mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'fig', 'no', 'vol', 'ch', 'p', 'pp',
]);

/**
 * text[i] 是不是一个真的句末？是的话返回句子结束的位置（不含）。
 *
 * 三道判断缺一不可：
 *   `etc.)` —— 点号后面跟着括号，跳过收尾符号再看是不是空白
 *   `3.14`、`api.deepseek.com` —— 点号后面不是空白，不算句末
 *   `e.g. foo` —— 点号前面是缩写，也不算
 */
function boundaryAt(text: string, i: number): number | undefined {
  if (!/[.!?]/.test(text[i]!)) return undefined;

  let j = i + 1;
  while (j < text.length && CLOSERS.test(text[j]!)) j++;
  if (j < text.length && !/\s/.test(text[j]!)) return undefined;

  /**
   * 缩写里的点不算句号——但 `etc.)` 要算。
   *
   * 点号后面跟着收尾括号，说明这个插入语到此为止，后面必然是新句子的开头；
   * 这时候再按「etc 是缩写」把它放过去，整段话就会连成一句。
   */
  if (j === i + 1) {
    const word = /[a-z.]+$/.exec(text.slice(Math.max(0, i - 12), i).toLowerCase())?.[0];
    if (word && ABBREVIATIONS.has(word)) return undefined;
  }

  return j;
}

/**
 * 原句超过这个长度就围着那个词裁一段。
 *
 * 长句整段摆进卡片，一句话就把卡片吃满，你要找的那个词埋在中间；
 * 送去给 AI 也是白读一遍。前后各留一截，够看清词是怎么用的就行。
 */
const MAX_SENTENCE = 260;
const KEEP_BEFORE = 90;
const KEEP_AFTER = 120;

/**
 * 从 text 里切出 [start,end) 所在的那一句。
 *
 * 导出是给测试用的：断句规则（缩写表、`etc.)`、小数点、长句截断）是这个文件里
 * 最容易改坏的一块，而 sentenceAround 需要一个真的文本节点才跑得起来。
 * 这一层是纯字符串进出，值得单独钉住。
 */
export function sliceSentence(text: string, start: number, end: number): string {
  let from = 0;
  for (let i = start - 1; i >= 0 && start - i < 400; i--) {
    const boundary = boundaryAt(text, i);
    if (boundary !== undefined) {
      from = boundary;
      break;
    }
  }
  let to = text.length;
  for (let i = end; i < text.length && i - end < 400; i++) {
    const boundary = boundaryAt(text, i);
    if (boundary !== undefined) {
      to = boundary;
      break;
    }
  }

  const raw = text.slice(from, to);
  const clipped = clipAround(raw, start - from, end - from);
  // 句子是从上一句的句末切开的，开头常常剩下逗号、破折号这类残渣
  return clipped.replace(/\s+/g, ' ').replace(/^[\s,;:—–-]+/, '').trim();
}

/** 太长的话只留词周围那一段，两头补省略号。切在空格上，别把单词劈开。 */
function clipAround(text: string, start: number, end: number): string {
  if (text.length <= MAX_SENTENCE) return text;

  let head = Math.max(0, start - KEEP_BEFORE);
  let tail = Math.min(text.length, end + KEEP_AFTER);
  if (head > 0) {
    const space = text.indexOf(' ', head);
    if (space >= 0 && space < start) head = space + 1;
  }
  if (tail < text.length) {
    const space = text.lastIndexOf(' ', tail);
    if (space > end) tail = space;
  }
  return `${head > 0 ? '…' : ''}${text.slice(head, tail)}${tail < text.length ? '…' : ''}`;
}
