/**
 * 释义存量的淘汰。
 *
 * 这里存的是花过钱的东西，所以淘汰规则错了不是「少了几条缓存」，是真金白银没了。
 * 值得钉住的就三件事：不到上限一条都不动、超了只丢最旧的、丢的正好是那几条。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXPLANATION_LIMIT, capExplanations } from '../src/lib/settings';
import type { Explained } from '../src/lib/types';

const entry = (time: number): Explained => ({
  sentence: 'Sediment accretes in strata.',
  analysis: { sense: '', en: '', note: '', sentenceZh: '', example: '', exampleZh: '' },
  time,
});

/** n 条，time 从 0 递增——序号越大越新。 */
function many(n: number): Record<string, Explained> {
  return Object.fromEntries(Array.from({ length: n }, (_, i) => [`w${i}`, entry(i)]));
}

test('没到上限，原样返回同一个对象', () => {
  const all = many(10);
  assert.equal(capExplanations(all), all, '不该白白复制一遍');
});

test('正好到上限也不动', () => {
  const all = many(EXPLANATION_LIMIT);
  assert.equal(Object.keys(capExplanations(all)).length, EXPLANATION_LIMIT);
});

test('超出就丢最旧的，留下的正好是最新那批', () => {
  const kept = capExplanations(many(EXPLANATION_LIMIT + 5));
  const words = Object.keys(kept);
  assert.equal(words.length, EXPLANATION_LIMIT);
  assert.ok(!words.includes('w0'), '最旧的该被丢掉');
  assert.ok(!words.includes('w4'), '第五旧的也该被丢掉');
  assert.ok(words.includes('w5'), '第六旧的要留着');
  assert.ok(words.includes(`w${EXPLANATION_LIMIT + 4}`), '最新的一定要留着');
});

test('留下的条目内容没被改动', () => {
  const kept = capExplanations({ ...many(EXPLANATION_LIMIT), fresh: entry(999999) });
  assert.deepEqual(kept.fresh, entry(999999));
});
