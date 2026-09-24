/**
 * 导出到 Anki 的格式约束。
 *
 * 这里每一条错了都不会抛异常，只会让导进 Anki 的卡片悄悄变形——而且是在
 * 「用户已经点了导入、几百张卡已经进库」之后才被发现，那时候要一张张删。
 * 所以约束写在这儿，而不是靠肉眼看一眼导出的文件。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toAnkiTSV, type AnkiRow } from '../src/lib/anki';
import type { Explained } from '../src/lib/types';

function explained(over: Partial<Explained['analysis']> & { sentence?: string; surface?: string } = {}): Explained {
  const { sentence, surface, ...analysis } = over;
  return {
    sentence: sentence ?? 'The lower stratum of rock is much older.',
    surface,
    time: 1_700_000_000_000,
    analysis: {
      sense: '岩层',
      en: 'a layer of rock',
      note: '',
      sentenceZh: '下面那一层岩石要老得多。',
      example: 'Each stratum tells a different story.',
      exampleZh: '每一层都讲着不同的故事。',
      ...analysis,
    },
  };
}

const row = (over: Partial<AnkiRow> = {}): AnkiRow => ({
  word: 'stratum',
  entry: { phonetic: 'ˈstrɑːtəm', translation: 'n. 地层\nn. 阶层', tags: ['cet6', 'gre'], rank: 12000 },
  level: 5,
  item: explained(),
  ...over,
});

/** 去掉文件头的那几行 `#` 指令，剩下的就是卡片。 */
const cards = (tsv: string) => tsv.trimEnd().split('\n').filter((line) => !line.startsWith('#'));

test('文件头把牌组、笔记类型、标签列全说清楚，导入时不用选', () => {
  const head = toAnkiTSV([row()]).split('\n');
  assert.equal(head[0], '#separator:tab');
  assert.ok(head.includes('#html:true'));
  assert.ok(head.includes('#notetype:Basic'));
  assert.ok(head.includes('#deck:Glint'));
  assert.ok(head.includes('#tags column:3'));
});

test('一张卡一行三格', () => {
  const lines = cards(toAnkiTSV([row(), row({ word: 'other' })]));
  assert.equal(lines.length, 2);
  for (const line of lines) assert.equal(line.split('\t').length, 3);
});

/**
 * 释义里的换行是最容易漏的一条：中文释义本来就是 \n 分隔的三条，
 * 原样写出去就是三行，Anki 会把后两行当成两张残缺的卡。
 */
test('字段里不许有换行——多条中文释义转成 <br>', () => {
  const [line] = cards(toAnkiTSV([row()]));
  assert.equal(cards(toAnkiTSV([row()])).length, 1);
  assert.ok(line!.includes('n. 地层<br>n. 阶层'));
});

/**
 * 裸引号会被 Anki 的 csv 解析器当成引用块的开头，从这一格开始往后好几张卡全错位。
 * 转义之后它是 &quot;，这条路根本不存在。
 */
test('不许有裸引号', () => {
  const tsv = toAnkiTSV([row({ item: explained({ sentence: 'He called it a "stratum" of society.' }) })]);
  assert.ok(!tsv.includes('"'));
  assert.ok(tsv.includes('&quot;'));
});

test('标签挂在 glint:: 下面，而且不带空格——Anki 按空格分标签', () => {
  const [line] = cards(toAnkiTSV([row()]));
  const tags = line!.split('\t')[2]!;
  assert.deepEqual(tags.split(' '), ['glint', 'glint::C1', 'glint::cet6', 'glint::gre']);
});

test('词库外的生僻词也导得出，等级标成「生僻」', () => {
  const [line] = cards(toAnkiTSV([row({ word: 'latticework', entry: null, level: 7 })]));
  const [front, back, tags] = line!.split('\t');
  assert.ok(front!.includes('latticework'));
  assert.ok(!front!.includes('//')); // 没有音标就不该留个空的 //
  assert.ok(back!.includes('岩层'));
  assert.equal(tags, 'glint glint::生僻');
});

/**
 * 原句里加粗的必须是那个词本身。这条在设置页的列表里也用同一个函数，
 * 曾经的错法是把 act 在 actually 上命中并整个加粗。
 */
test('原句里只加粗那个词，不吞掉相邻的词', () => {
  const item = explained({ sentence: 'They act as if actually nothing happened.' });
  const [line] = cards(toAnkiTSV([row({ word: 'act', item })]));
  const back = line!.split('\t')[1]!;
  assert.ok(back.includes('<b>act</b>'));
  assert.ok(!back.includes('<b>actually</b>'));
});

test('空字段不留下空壳——没有 note / 例句时不该多出一个空块', () => {
  const item = explained({ note: '', example: '', exampleZh: '', en: '' });
  const [line] = cards(toAnkiTSV([row({ item })]));
  const back = line!.split('\t')[1]!;
  assert.ok(!/<div[^>]*><\/div>/.test(back));
  assert.ok(!back.includes('<i></i>'));
});
