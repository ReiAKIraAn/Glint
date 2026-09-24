/**
 * 词形还原的回归用例。
 *
 * 用例表在 lemma-cases.ts，和预览沙盒共用。这里跑的是真的 resolve()，
 * 不是复刻一遍逻辑——那种错不会报错，只会让 hover 出来的释义悄悄变成另一个词的意思。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from '../src/lib/lexicon';
import { LEMMA_GROUPS } from './lemma-cases';

/**
 * 「原型」不等于「词根」：happily / enormously 这种派生词在词典里有自己的词条和
 * 自己的中文释义，就该停在自己身上，不该被还原成 happy——否则释义是错的。
 * 只有屈折变化（复数、时态、比较级）才需要还原。
 */
for (const group of LEMMA_GROUPS) {
  test(group.name, () => {
    for (const [surface, expected] of group.cases) {
      assert.equal(resolve(surface).lemma, expected, `${surface} → 期望 ${expected}`);
    }
  });
}

test('归一化后只剩一个字母的当最基础的词，不标', () => {
  for (const word of ["I'm", "I'll", "a's"]) {
    assert.ok(resolve(word).level <= 1, `${word} 不该被标出来`);
  }
});
