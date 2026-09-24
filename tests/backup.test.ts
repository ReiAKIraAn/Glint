/**
 * 备份的解析与合并。
 *
 * 这是整个扩展里唯一接收外部文件的地方。字段没验干净的话，坏数据会先写进存储，
 * 之后才在设置页或者卡片上炸出来——那时候已经查不回是哪一步进来的了。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BACKUP_VERSION, mergeBackup, parseBackup, type Backup } from '../src/lib/settings';
import type { Explained } from '../src/lib/types';

const analysis = { sense: 's', en: 'e', note: '', sentenceZh: '', example: '', exampleZh: '' };
const item = (time: number): Explained => ({ sentence: 'A sentence.', analysis, time });

const good = {
  version: BACKUP_VERSION,
  exportedAt: 1_700_000_000_000,
  settings: { level: 4 as const },
  knownWords: ['recede', 'stratum'],
  explanations: { recede: item(10) },
};

test('正常备份原样收下', () => {
  const out = parseBackup(good);
  assert.ok(out.ok);
  assert.deepEqual(out.backup.knownWords, ['recede', 'stratum']);
  assert.equal(out.backup.settings.level, 4);
  assert.equal(out.backup.explanations.recede?.time, 10);
});

test('不是对象、版本不对，整份拒掉', () => {
  for (const bad of [null, 42, 'nope', [], {}, { version: 99 }]) {
    assert.equal(parseBackup(bad).ok, false, `${JSON.stringify(bad)} 该被拒`);
  }
});

test('字段类型不对的当没有，不让它进存储', () => {
  const out = parseBackup({ ...good, knownWords: ['ok', 42, null, ''], settings: 'nope' });
  assert.ok(out.ok);
  assert.deepEqual(out.backup.knownWords, ['ok'], '非字符串和空串都该滤掉');
  assert.deepEqual(out.backup.settings, {}, 'settings 不是对象就当空');
});

test('单条释义坏掉只丢那一条，不牵连整份', () => {
  const out = parseBackup({
    ...good,
    explanations: { good: item(1), noSentence: { analysis }, noAnalysis: { sentence: 'x' } },
  });
  assert.ok(out.ok);
  assert.deepEqual(Object.keys(out.backup.explanations), ['good']);
});

test('缺 time 的老条目补 0，不会变成 undefined', () => {
  const out = parseBackup({ ...good, explanations: { w: { sentence: 'x', analysis } } });
  assert.ok(out.ok);
  assert.equal(out.backup.explanations.w?.time, 0);
});

test('合并：已认识的词取并集，不重复', () => {
  const backup = parseBackup(good);
  assert.ok(backup.ok);
  const out = mergeBackup(backup.backup, { knownWords: ['stratum', 'husk'], explanations: {} });
  assert.deepEqual([...out.knownWords].sort(), ['husk', 'recede', 'stratum']);
});

test('合并：同一个词留较新的那条释义', () => {
  const newer = parseBackup({ ...good, explanations: { recede: item(100) } });
  assert.ok(newer.ok);
  const keptIncoming = mergeBackup(newer.backup, { knownWords: [], explanations: { recede: item(5) } });
  assert.equal(keptIncoming.explanations.recede?.time, 100, '备份里的更新，该用备份的');

  const older = parseBackup({ ...good, explanations: { recede: item(1) } });
  assert.ok(older.ok);
  const keptMine = mergeBackup(older.backup, { knownWords: [], explanations: { recede: item(50) } });
  assert.equal(keptMine.explanations.recede?.time, 50, '本机的更新，该留本机的');
});

test('合并不动本机独有的条目', () => {
  const backup = parseBackup(good);
  assert.ok(backup.ok);
  const out = mergeBackup(backup.backup, { knownWords: [], explanations: { husk: item(7) } });
  assert.equal(out.explanations.husk?.time, 7);
  assert.equal(out.explanations.recede?.time, 10);
});

test('备份里没有 API Key 这个字段', () => {
  const backup: Backup = { ...good, version: BACKUP_VERSION };
  assert.ok(!('apiKeys' in backup), '密钥永远不该进备份');
  assert.ok(!JSON.stringify(backup).includes('sk-'));
});
