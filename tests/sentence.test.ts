/**
 * 断句。
 *
 * 这块规则密、反例多，而且改坏了不报错——只会让卡片里的原句被拦腰砍断，
 * 或者把整段话连成一句塞给 AI。scan.ts 里最该钉住的就是它。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sliceSentence } from '../src/lib/scan';

/** 把 text 里 word 所在的那一句切出来。 */
function around(text: string, word: string): string {
  const at = text.indexOf(word);
  assert.ok(at >= 0, `用例写错了：${text} 里没有 ${word}`);
  return sliceSentence(text, at, at + word.length);
}

test('普通句子：前后两句都要切掉', () => {
  const text = 'The tide receded. Sediment accretes in strata. She stopped there.';
  assert.equal(around(text, 'accretes'), 'Sediment accretes in strata.');
});

test('缩写里的点不是句号', () => {
  const text = 'Some tools, e.g. parsers and linters, accrete cruft over time.';
  // 按句号切的话会从 "parsers and..." 开头，把主语丢掉
  assert.equal(around(text, 'accrete'), text);
});

test('etc. 后面跟收尾括号时算句末', () => {
  const text = 'It handles the usual things (parsers, linters, etc.) Sediment accretes anyway.';
  // 不认这条的话整段会连成一句
  assert.equal(around(text, 'accretes'), 'Sediment accretes anyway.');
});

test('小数点不是句号', () => {
  const text = 'The reading was 3.14 before it accreted further.';
  assert.equal(around(text, 'accreted'), text);
});

test('域名里的点不是句号', () => {
  const text = 'Point it at api.deepseek.com and the request accretes latency.';
  assert.equal(around(text, 'accretes'), text);
});

test('问号感叹号同样断句', () => {
  const text = 'Did it recede? Sediment accretes in strata! Nobody wrote it down.';
  assert.equal(around(text, 'accretes'), 'Sediment accretes in strata!');
});

test('引号收尾也算句末', () => {
  const text = 'He said "it receded." Sediment accretes in strata.';
  assert.equal(around(text, 'accretes'), 'Sediment accretes in strata.');
});

test('从上一句切开后，开头的逗号破折号要清掉', () => {
  const text = 'It receded. — sediment accretes in strata.';
  assert.equal(around(text, 'accretes'), 'sediment accretes in strata.');
});

test('长句围着那个词裁，两头补省略号', () => {
  const filler = 'the water carried it away and nobody wrote any of it down '.repeat(6);
  const text = `${filler}but sediment accretes in strata ${filler}`;
  const out = around(text, 'accretes');
  assert.ok(out.length <= 260, `裁完还有 ${out.length} 字`);
  assert.ok(out.includes('accretes'), '把要找的词裁掉了');
  assert.ok(out.startsWith('…') && out.endsWith('…'), '两头该有省略号');

  // 切在空格上，不能把单词劈开：省略号后的第一个词、之前的最后一个词，
  // 都得是原文里完整的词（原文里它们前后是空格，不是字母）
  const body = out.slice(1, -1);
  const first = body.split(' ')[0]!;
  const last = body.split(' ').at(-1)!;
  assert.ok(text.includes(` ${first} `), `开头把 "${first}" 劈开了`);
  assert.ok(text.includes(` ${last} `), `结尾把 "${last}" 劈开了`);
});

test('短句不加省略号', () => {
  const text = 'Sediment accretes in strata.';
  assert.equal(around(text, 'accretes'), text);
});

test('空白统一压成单空格', () => {
  const text = 'Sediment   accretes\n  in strata.';
  assert.equal(around(text, 'accretes'), 'Sediment accretes in strata.');
});
