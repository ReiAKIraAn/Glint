/**
 * 把已经生成过的语境释义导成 Anki 能直接吃的一份纯文本。
 *
 * 这批数据是整个扩展里唯一花过钱的东西，而它现在只当缓存用——同一个词不再生成
 * 第二次，仅此而已。可它每一条都带着**你自己读到的那一句原句**和它的翻译，
 * 这正好是一张好卡片最难得的那一格：例句不是词典编的，是你真的遇到过的。
 * 让它只能躺在 storage 里太亏了。
 *
 * ## 为什么是 TSV 而不是 .apkg
 *
 * .apkg 是个 zip 包着的 sqlite，要在浏览器里生成就得塞一个 sqlite 实现进来，
 * 为一个导出按钮多背几百 KB。而 Anki 从 2.1.55 起认文件开头以 `#` 起的指令行，
 * 一份纯文本就能把牌组名、笔记类型、哪一列是标签全部说清楚——用户点了导入之后
 * 一个选项都不用选。够用，且不给扩展加任何依赖。
 *
 * ## 三条格式上的硬约束
 *
 * 1. **一行一张卡**，所以字段里绝不能有换行。中文释义本来是 \n 分隔的三条，
 *    在这里转成 `<br>`；其余地方万一混进换行，压成空格。
 * 2. **字段里不能有裸引号**。Anki 的 csv 解析器认双引号引用块，一个落单的 `"`
 *    会让它从这一格开始一路吃到下一个引号，中间几张卡全错位。所以所有文本先过
 *    escapeHtml，`"` 变成 `&quot;`，问题从根上没了——顺带 `<` `>` 也不会被
 *    当成标签，而我们自己拼的 `<b>` `<br>` 是转义之后才加上去的。
 *    同理，下面那几个内联样式一律用**单引号**：只要整份文件里一个双引号都不出现，
 *    就不用去赌 Anki 的解析器对「不在字段开头的引号」到底怎么处理。
 * 3. **标签不能带空格**。Anki 按空格分标签，所以只用等级名和考纲代号这类没有
 *    空格的词，不用中文考纲名。
 */
import { LEVEL_NAMES, UNKNOWN_LEVEL, type DictEntry, type Explained, type Level } from './types';
import { boldWord, escapeHtml } from './text';

export interface AnkiRow {
  /** 词典原型，也就是 explanations 里的那个键 */
  word: string;
  /** 本地词库里的音标 / 中文释义 / 考纲标签。词库外的生僻词是 null */
  entry: DictEntry | null;
  level: Level | typeof UNKNOWN_LEVEL;
  item: Explained;
}

/**
 * 导进哪个牌组、按哪个笔记类型。
 *
 * 牌组不存在时 Anki 会自己建，所以新装的 Anki 也不用先去 Create Deck。
 *
 * 笔记类型写死 Basic：那是每个新用户档案里一定有的两字段（Front / Back）类型。
 * 自己定义一个更漂亮的类型意味着用户得先手工建好、字段名还要一个字不差，
 * 那是把一次「点导入」变成一份说明书。代价是中文界面的 Anki 里它叫「基础」，
 * 对不上时 Anki 不会失败，只会停在导入界面让人自己选一次——这个退路是可接受的。
 */
const DECK = 'Glint';
const NOTETYPE = 'Basic';

/** 灰一档的小字。Basic 卡自带的样式很素，靠内联样式把主次分开。 */
const muted = (html: string) => `<div style='color:#888;font-size:0.9em'>${html}</div>`;
const block = (html: string) => `<div style='margin-top:10px'>${html}</div>`;

/** 收尾：一行一张卡，字段里剩下的换行和制表符一律压成空格。 */
const field = (html: string) => html.replace(/[\t\r\n]+/g, ' ').trim();

/**
 * 正面只放词和音标。
 *
 * 试过把原句放正面（看句子猜词义，更贴近阅读），但那样一张卡考的是整句理解，
 * 答错了说不清是哪个词没记住。词在正面、句子在背面，回想失败时背面那一句
 * 正好告诉你「你上次是在这儿见到它的」。
 */
function front(row: AnkiRow): string {
  const phonetic = row.entry?.phonetic
    ? `<div style='color:#888;font-size:0.7em'>/${escapeHtml(row.entry.phonetic)}/</div>`
    : '';
  return field(`<div>${escapeHtml(row.word)}</div>${phonetic}`);
}

function back(row: AnkiRow): string {
  const a = row.item.analysis;
  const parts = [`<div><b>${escapeHtml(a.sense)}</b></div>`];

  if (a.en) parts.push(muted(`<i>${escapeHtml(a.en)}</i>`));
  // 词典释义是 \n 分隔的最多三条，见 scripts/build-data.ts
  if (row.entry?.translation) {
    parts.push(muted(row.entry.translation.split('\n').map(escapeHtml).join('<br>')));
  }

  // 这一格是这张卡真正值钱的地方：你自己读到的那一句
  parts.push(block(boldWord(row.item.sentence, row.word, row.item.surface)));
  if (a.sentenceZh) parts.push(muted(escapeHtml(a.sentenceZh)));

  if (a.example) {
    parts.push(block(escapeHtml(a.example)));
    if (a.exampleZh) parts.push(muted(escapeHtml(a.exampleZh)));
  }
  if (a.note) parts.push(block(muted(escapeHtml(a.note))));

  return field(parts.join(''));
}

/**
 * 标签全部挂在 `glint::` 下面。
 *
 * Anki 的标签用 `::` 分层，所以在它的侧栏里这些会自动收成一棵树：
 * 展开 glint 就能只复习 C1 的、或者只复习六级词表里的那批。
 */
function tags(row: AnkiRow): string {
  const list = ['glint', `glint::${LEVEL_NAMES[row.level]}`];
  for (const tag of row.entry?.tags ?? []) list.push(`glint::${tag}`);
  return list.join(' ');
}

export function toAnkiTSV(rows: AnkiRow[]): string {
  const header = [
    '#separator:tab',
    '#html:true',
    `#notetype:${NOTETYPE}`,
    `#deck:${DECK}`,
    '#tags column:3',
  ];
  const lines = rows.map((row) => [front(row), back(row), tags(row)].join('\t'));
  return [...header, ...lines].join('\n') + '\n';
}
