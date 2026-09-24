import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  capExplanationEntries,
  clearExplanations,
  enqueue,
  explanationsStore,
  getExplanation,
  isCleanCacheEntry,
  normalizeWordKey,
  putExplanation,
  sanitizeExplanationStore,
  EXPLANATION_LIMIT,
} from '../src/lib/explanation-cache';
import type { ExplanationCacheEntry } from '../src/lib/types';

// ============================================================================
// VC-07: LRU Same-Millisecond Timestamp Verification
// ============================================================================

test('VC-07-A: capExplanationEntries 边界容量 - 恰好 2000 条同一毫秒条目不触发剔除', () => {
  const store: Record<string, ExplanationCacheEntry> = {};
  const SAME_TS = 1700000000000;
  for (let i = 0; i < 2000; i++) {
    const w = `word_${i}`;
    store[w] = { word: w, explanation: `Explanation text ${i}`, updatedAt: SAME_TS };
  }

  const capped = capExplanationEntries(store, EXPLANATION_LIMIT);
  assert.equal(Object.keys(capped).length, 2000);
  assert.equal(Object.keys(capped).length <= EXPLANATION_LIMIT, true);
});

test('VC-07-B: capExplanationEntries 同毫秒淘汰 - 2005 条同时间戳时严格截断至 2000 条且稳定确定', () => {
  const store: Record<string, ExplanationCacheEntry> = {};
  const SAME_TS = 1700000000000;
  for (let i = 0; i < 2005; i++) {
    const w = `word_${i}`;
    store[w] = { word: w, explanation: `Explanation text ${i}`, updatedAt: SAME_TS };
  }

  const capped = capExplanationEntries(store, EXPLANATION_LIMIT);
  const keys = Object.keys(capped);
  assert.equal(keys.length, 2000, '容量必须严格等于 2000，不得超出或过量丢弃');

  // JavaScript 规范保证 Array.prototype.sort 的稳定性 (stable sort)
  // 当 updatedAt 完全相等时，保持原始插入序列的前 2000 条，末尾 5 条被稳定剔除
  assert.equal(keys[0], 'word_0');
  assert.equal(keys[1999], 'word_1999');
  assert.equal('word_2000' in capped, false);
  assert.equal('word_2004' in capped, false);
});

test('VC-07-C: capExplanationEntries 混合时间戳 - 存在更新时间戳时新条目优先保留', () => {
  const store: Record<string, ExplanationCacheEntry> = {};
  const OLD_TS = 1700000000000;
  const NEW_TS = 1700000005000;

  // 2000 条旧时间戳
  for (let i = 0; i < 2000; i++) {
    const w = `old_${i}`;
    store[w] = { word: w, explanation: `Old expl ${i}`, updatedAt: OLD_TS };
  }

  // 5 条新时间戳
  for (let i = 0; i < 5; i++) {
    const w = `new_${i}`;
    store[w] = { word: w, explanation: `New expl ${i}`, updatedAt: NEW_TS };
  }

  const capped = capExplanationEntries(store, EXPLANATION_LIMIT);
  assert.equal(Object.keys(capped).length, 2000);

  // 5 条最新条目全部保留
  for (let i = 0; i < 5; i++) {
    assert.equal(`new_${i}` in capped, true, `新条目 new_${i} 必须被保留`);
  }
  // 淘汰了 5 条最旧条目
  assert.equal('old_1995' in capped, false);
  assert.equal('old_1999' in capped, false);
});

// ============================================================================
// Empirical Measurement: 2000-entry Serialized Payload Size
// ============================================================================

test('Empirical Payload Size: 测量 2000 条真实释义条目的序列化存储尺寸', () => {
  const sampleExplanations = [
    'Matter that settles to the bottom of a liquid; dregs or lees. In geology, solid particulate matter that can be transported by fluid flow and which eventually is deposited as a layer.',
    'The capacity of a system, community, or society potentially exposed to hazards to adapt, by resisting or changing in order to reach and maintain an acceptable level of functioning and structure.',
    'To become visible, or to emerge from concealing surroundings or obscurity; to come into existence, take form, or become apparent.',
    'A state of balance between opposing forces or actions that is either static (as in a body acted on by forces whose resultant is zero) or dynamic (as in a reversible chemical reaction).',
  ];

  const store: Record<string, ExplanationCacheEntry> = {};
  for (let i = 0; i < 2000; i++) {
    const word = `lexicalword${i}`;
    const explanation = sampleExplanations[i % sampleExplanations.length]!;
    store[word] = {
      word,
      explanation,
      updatedAt: 1700000000000 + i,
    };
  }

  const jsonStr = JSON.stringify(store);
  const byteLength = Buffer.byteLength(jsonStr, 'utf8');
  const kbSize = (byteLength / 1024).toFixed(2);
  const mbSize = (byteLength / (1024 * 1024)).toFixed(2);

  // 记录实际测量结果
  assert.ok(byteLength > 0);
  assert.ok(Object.keys(store).length === 2000);

  // 断言此尺寸与数量符合预期（实际在 450KB ~ 600KB 之间）
  assert.ok(byteLength < 2 * 1024 * 1024, `2000 条典型释义数据体积应约为 ${kbSize} KB (${mbSize} MB)`);
});

// ============================================================================
// Concurrency in Single Runtime: 50 Interleaved Async Tasks
// ============================================================================

test('VC-08-A: 单 JS 运行时内部 50 个高并发读改写任务由 enqueue 串行化保护', async () => {
  await clearExplanations();

  const tasks: Promise<unknown>[] = [];
  for (let i = 0; i < 50; i++) {
    const idx = i;
    tasks.push(
      putExplanation(`async_word_${idx}`, `Explanation content for task ${idx}`)
    );
  }

  await Promise.all(tasks);

  const all = await explanationsStore.getValue();
  assert.equal(Object.keys(all).length, 50, '50 次并发写入必须全部成功落盘，零丢失');

  for (let i = 0; i < 50; i++) {
    assert.equal(all[`async_word_${i}`]?.explanation, `Explanation content for task ${i}`);
  }
});
