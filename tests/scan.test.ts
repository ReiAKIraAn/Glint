/**
 * scan() 的那一串过滤规则。
 *
 * 每一条都是为了一类真实网页上的误标加的（@handle、代码黑话、人名、全大写缩写…），
 * 而它们全是「continue」——判错了不会报错，只会让页面上多标或少标几个词，
 * 肉眼几乎看不出来。这份用例的作用就是让改动碰到哪一条时立刻知道。
 *
 * 用 happy-dom 起一个真 DOM：scan 走的是 TreeWalker，自己糊一个替身等于在测替身。
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { DEFAULT_SETTINGS, type Settings } from '../src/lib/types';

let scan: typeof import('../src/lib/scan').scan;

before(async () => {
  const window = new Window({ url: 'https://example.com' });
  // scan 直接引用全局的 document / Node / NodeFilter，得在导入它之前铺好
  for (const key of ['document', 'Node', 'NodeFilter', 'Element', 'HTMLElement'] as const) {
    (globalThis as Record<string, unknown>)[key] = window[key];
  }
  ({ scan } = await import('../src/lib/scan'));
});

/** 扫一段 HTML，返回被标出来的词（页面上的原样写法）。 */
function marked(html: string, override: Partial<Settings> = {}, canExplain = true): string[] {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.append(root);
  const settings = { ...DEFAULT_SETTINGS, ...override };
  return scan(root, settings, new Set(), canExplain).map((t) => t.surface);
}

test('基本情形：高于水平的词才标', () => {
  const out = marked('<p>The tide receded further than the fishermen could recall.</p>');
  assert.ok(out.includes('receded'), '难词该标');
  assert.ok(!out.includes('The') && !out.includes('could'), '常用词不该标');
});

test('全大写当缩写，不标', () => {
  assert.deepEqual(marked('<p>She left NASA and joined the ESA programme.</p>'), []);
});

test('标识符里的词不是散文——前后都要看', () => {
  assert.deepEqual(
    marked('<p>Ask @scrutinize or see #interlocutors for the rest.</p>'),
    [],
    '@handle 和 #tag 后面的不该标',
  );
  assert.deepEqual(
    marked('<p>Open config.desiccated and read the rest.</p>', { markUnknown: true }),
    [],
    '点号连接的两段都不该标——只看前面的话，config 会漏过去',
  );
  // 但句末的点号不能被当成标识符
  assert.ok(
    marked('<p>The tide receded.</p>').includes('receded'),
    '句号不是标识符分隔符',
  );
});

test('代码块整个跳过，而且里面的词成为本页黑话', () => {
  // 这条只管词库外的词——词库里查得到的（accrete 之类）本来就有释义，不需要这道闸。
  // plugins 在词库外，正常会被当生僻词标出来。
  const alone = marked('<p>The plugins drifted past the shore.</p>', { markUnknown: true });
  assert.ok(alone.includes('plugins'), '前提：单独出现时会被标');

  const withCode = marked(
    '<p>The plugins drifted past the shore.</p><pre>npm install plugins</pre>',
    { markUnknown: true },
  );
  assert.ok(!withCode.includes('plugins'), '在本页代码块里出现过 = 领域黑话，不该标');
});

test('句中的大写词当专有名词，句首的照常处理', () => {
  const mid = marked('<p>She met Desiccated at noon.</p>');
  assert.ok(!mid.includes('Desiccated'), '句中大写不标');
  const head = marked('<p>Desiccated husks lay on the flats.</p>');
  assert.ok(head.includes('Desiccated'), '句首大写要标');
});

test('页面自己标了非英文的区块，整块不碰', () => {
  assert.deepEqual(marked('<p lang="fr">The tide receded further.</p>'), []);
});

test('contenteditable 不碰——那是用户正在打字的地方', () => {
  assert.deepEqual(marked('<div contenteditable="true"><p>The tide receded.</p></div>'), []);
});

test('oncePerPage：同一个词只标第一次', () => {
  const html = '<p>It receded and then receded again.</p>';
  assert.equal(marked(html, { oncePerPage: true }).filter((w) => w === 'receded').length, 1);
  assert.equal(marked(html, { oncePerPage: false }).filter((w) => w === 'receded').length, 2);
});

test('变形词按原型判等级，surface 保留页面上的写法', () => {
  const root = document.createElement('div');
  root.innerHTML = '<p>Sediment accretes in strata here.</p>';
  document.body.append(root);
  const tokens = scan(root, DEFAULT_SETTINGS, new Set(), true);
  const strata = tokens.find((t) => t.surface === 'strata');
  assert.ok(strata, 'strata 该被标出来');
  assert.equal(strata.lemma, 'stratum', '查的是原型');
  assert.equal(strata.surface, 'strata', 'surface 是页面上的写法');
});

test('已认识的词不再标', () => {
  const root = document.createElement('div');
  root.innerHTML = '<p>The tide receded further.</p>';
  document.body.append(root);
  const out = scan(root, DEFAULT_SETTINGS, new Set(['recede']), true).map((t) => t.surface);
  assert.ok(!out.includes('receded'), '按原型静音，页面上是变形也要生效');
});

test('通过的考试把该考纲及以下的词静音', () => {
  const html = '<p>They accumulate evidence and then recall it.</p>';
  const before = marked(html, { level: 1, passedExam: 0 });
  const after = marked(html, { level: 1, passedExam: 5 });
  assert.ok(after.length < before.length, `过了考研之后该少标：${before} → ${after}`);
});

test('备考模式取交集：不在词表里的一律不标', () => {
  const root = document.createElement('div');
  root.innerHTML = '<p>The tide receded and sediment accretes in strata.</p>';
  document.body.append(root);
  const out = scan(root, DEFAULT_SETTINGS, new Set(), true, new Set(['recede'])).map((t) => t.surface);
  assert.deepEqual(out, ['receded'], '只剩词表里那个');
});

test('生僻词：AI 没就绪就不标，否则只会给一张空卡片', () => {
  const html = '<p>The zzyzxian quorpheline drifted past.</p>';
  assert.deepEqual(marked(html, { markUnknown: true }, false), [], 'AI 没就绪时不标');
  assert.ok(marked(html, { markUnknown: true }, true).length > 0, 'AI 就绪时才标');
  assert.deepEqual(marked(html, { markUnknown: false }, true), [], '开关关着也不标');
});

test('词库外的短词和大写词不标——多半是缩写、handle、人名', () => {
  const out = marked('<p>The Meshyai bot and the qrp tool drifted past.</p>', { markUnknown: true });
  assert.ok(!out.includes('Meshyai'), '词库外 + 首字母大写 = 人名/品牌名');
  assert.ok(!out.includes('qrp'), '词库外的短词多半是缩写');
});
