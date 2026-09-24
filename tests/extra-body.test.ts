import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_EXTRA_BODY_OBJECT,
  DEFAULT_EXTRA_BODY_STRING,
  isValidExtraBodyObject,
  mergeRequestBody,
  parseAndValidateExtraBody,
} from '../src/lib/providers/extra-body';

test('EXTRA-01: 默认值为 thinking_mode: false 的合法 JSON 对象', () => {
  assert.deepStrictEqual(DEFAULT_EXTRA_BODY_OBJECT, { thinking_mode: false });
  const parsed = JSON.parse(DEFAULT_EXTRA_BODY_STRING);
  assert.deepStrictEqual(parsed, { thinking_mode: false });
});

test('EXTRA-02: 合法 object 解析成功', () => {
  const result = parseAndValidateExtraBody('{"thinking_mode": false}');
  assert.strictEqual(result.ok, true);
  if (result.ok) {
    assert.deepStrictEqual(result.data, { thinking_mode: false });
  }
});

test('EXTRA-03: 多字段合法 object 解析成功', () => {
  const input = JSON.stringify({
    thinking_mode: false,
    temperature: 0.3,
    top_p: 0.9,
    max_tokens: 500,
  });
  const result = parseAndValidateExtraBody(input);
  assert.strictEqual(result.ok, true);
  if (result.ok) {
    assert.strictEqual(result.data.thinking_mode, false);
    assert.strictEqual(result.data.temperature, 0.3);
    assert.strictEqual(result.data.top_p, 0.9);
  }
});

test('EXTRA-04: 非法 JSON 抛出明确错误提示', () => {
  const invalidJsonCases = [
    '{thinking_mode: false',
    '{"thinking_mode": }',
    '{',
    'undefined',
    'foo bar',
  ];
  for (const invalid of invalidJsonCases) {
    const result = parseAndValidateExtraBody(invalid);
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.ok(result.error.includes('JSON'), `Case "${invalid}" should mention JSON error`);
    }
  }
});

test('EXTRA-05: 拒绝 null', () => {
  assert.strictEqual(isValidExtraBodyObject(null), false);
  const result = parseAndValidateExtraBody('null');
  assert.strictEqual(result.ok, false);
  if (!result.ok) {
    assert.ok(result.error.includes('不能是数组、基础类型或 null'));
  }
});

test('EXTRA-06: 拒绝 array 数组类型', () => {
  assert.strictEqual(isValidExtraBodyObject([]), false);
  assert.strictEqual(isValidExtraBodyObject([1, 2, 3]), false);
  const result = parseAndValidateExtraBody('[{"thinking_mode": false}]');
  assert.strictEqual(result.ok, false);
  if (!result.ok) {
    assert.ok(result.error.includes('不能是数组、基础类型或 null'));
  }
});

test('EXTRA-07: 拒绝 primitive 基础类型 (string, number, boolean)', () => {
  const primitiveInputs = ['"hello"', '123', 'true', 'false'];
  for (const input of primitiveInputs) {
    const result = parseAndValidateExtraBody(input);
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.ok(result.error.includes('不能是数组、基础类型或 null'));
    }
  }
});

test('EXTRA-08: thinking_mode: false 正确合并进入最终请求体', () => {
  const systemFields = {
    model: 'custom-model',
    stream: true,
    messages: [{ role: 'user', content: 'test' }],
  };
  const extra = { thinking_mode: false };
  const merged = mergeRequestBody(systemFields, extra);

  assert.strictEqual(merged.thinking_mode, false);
  assert.strictEqual(merged.model, 'custom-model');
  assert.strictEqual(merged.stream, true);
});

test('EXTRA-09: extra fields 扩展字段正常合并', () => {
  const systemFields = {
    model: 'custom-model',
    stream: true,
    messages: [{ role: 'user', content: 'test' }],
  };
  const extra = {
    thinking_mode: false,
    custom_flag: 'vendor_extension',
    frequency_penalty: 0.5,
  };
  const merged = mergeRequestBody(systemFields, extra);

  assert.strictEqual(merged.thinking_mode, false);
  assert.strictEqual(merged.custom_flag, 'vendor_extension');
  assert.strictEqual(merged.frequency_penalty, 0.5);
});

test('EXTRA-10: 系统关键字段不可被 extraBody 篡改 (System fields cannot be overridden)', () => {
  const systemFields = {
    model: 'system-protected-model',
    stream: true,
    messages: [{ role: 'system', content: 'tutor' }, { role: 'user', content: 'prompt' }],
  };
  const maliciousExtra = {
    model: 'hijacked-model',
    stream: false, // 试图关闭 stream
    messages: [{ role: 'attacker', content: 'drop table' }], // 试图覆盖 messages
    thinking_mode: true,
  };
  const merged = mergeRequestBody(systemFields, maliciousExtra);

  // 系统字段优先，核心协议不被破坏
  assert.strictEqual(merged.model, 'system-protected-model');
  assert.strictEqual(merged.stream, true);
  assert.deepStrictEqual(merged.messages, systemFields.messages);
  // 用户自定义字段成功并入
  assert.strictEqual(merged.thinking_mode, true);
});
