/**
 * 设置的读取兼容。
 *
 * WXT 的 fallback 只在「一次都没存过」时生效——存过之后拿到的就是当年那个形状的
 * 旧对象。所以每加一个字段，老用户升上来读到的都是 undefined，然后在
 * `settings.models[provider]` 这种地方炸掉。withDefaults 就是挡这个的，
 * 而它出错的样子是「某个老用户的设置页打不开」，本机永远复现不了。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withDefaults } from '../src/lib/settings';
import { DEFAULT_SETTINGS, DEFAULT_MODELS, isConfigured, type Settings } from '../src/lib/types';

test('空对象补成一份完整默认值', () => {
  assert.deepEqual(withDefaults({}), DEFAULT_SETTINGS);
});

test('存过的值不被默认值盖掉', () => {
  const out = withDefaults({ level: 5, style: 'tint', enabled: false });
  assert.equal(out.level, 5);
  assert.equal(out.style, 'tint');
  assert.equal(out.enabled, false);
});

test('新增的 style: "color" 能够正确保留且不被默认值覆盖', () => {
  const out = withDefaults({ style: 'color' });
  assert.equal(out.style, 'color');
});

test('缺字段的旧对象也能补齐，不会留 undefined', () => {
  const out = withDefaults({ level: 4 });
  assert.equal(out.effort, DEFAULT_SETTINGS.effort);
  assert.deepEqual(out.models, DEFAULT_MODELS);
  assert.deepEqual(out.baseURLs, {});
  for (const [key, value] of Object.entries(out)) {
    assert.notEqual(value, undefined, `${key} 是 undefined`);
  }
});

test('models 只补缺的那几家，已存的不动', () => {
  const out = withDefaults({ models: { anthropic: 'claude-my-own' } as never });
  assert.equal(out.models.anthropic, 'claude-my-own');
  assert.equal(out.models.openai, DEFAULT_MODELS.openai, '没存过的那家要有默认值');
});

test('老版本的单个 model 字段搬进 anthropic 那一格', () => {
  const out = withDefaults({ model: 'claude-legacy' });
  assert.equal(out.models.anthropic, 'claude-legacy');
});

test('老字段不能盖掉新结构里已经存过的值', () => {
  // 这条是真出过问题的方向：用户改了 Anthropic 的模型名，下次读取又被旧值盖回去
  const out = withDefaults({ model: 'claude-legacy', models: { anthropic: 'claude-new' } as never });
  assert.equal(out.models.anthropic, 'claude-new');
});

test('老字段本身不会漏进结果里', () => {
  const out = withDefaults({ model: 'x', baseURL: 'https://old.example.com/v1' });
  assert.ok(!('model' in out), 'model 不该出现在新结构里');
  assert.ok(!('baseURL' in out), 'baseURL 不该出现在新结构里');
});

test('老版本的 baseURL 搬进「自定义接口」那一格', () => {
  const out = withDefaults({ baseURL: 'https://old.example.com/v1' });
  assert.equal(out.baseURLs.compatible, 'https://old.example.com/v1');
  assert.equal(out.baseURLs.custom, 'https://old.example.com/v1');
});

test('历史 provider: anthropic 自动安全降级至默认 provider: openai', () => {
  const out = withDefaults({ provider: 'anthropic' as any });
  assert.equal(out.provider, 'openai');
});

test('历史 provider: compatible 自动迁移至 custom', () => {
  const out = withDefaults({ provider: 'compatible' as any });
  assert.equal(out.provider, 'custom');
});

test('支持当前合法 Provider: openai, deepseek, custom', () => {
  assert.equal(withDefaults({ provider: 'openai' }).provider, 'openai');
  assert.equal(withDefaults({ provider: 'deepseek' }).provider, 'deepseek');
  assert.equal(withDefaults({ provider: 'custom' }).provider, 'custom');
});

test('缺少 customExtraBody 的旧配置自动补充默认 thinking_mode: false', () => {
  const out = withDefaults({ level: 2 });
  assert.equal(typeof out.customExtraBody, 'string');
  assert.deepEqual(JSON.parse(out.customExtraBody!), { thinking_mode: false });
});

test('用户已存的 customExtraBody 不被默认值覆盖', () => {
  const customBody = JSON.stringify({ thinking_mode: true, temperature: 0.7 });
  const out = withDefaults({ customExtraBody: customBody });
  assert.equal(out.customExtraBody, customBody);
});

test('CONFIG-CUSTOM-KEYLESS-01: valid custom endpoint + model + empty key -> configured', () => {
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    provider: 'custom',
    baseURLs: { custom: 'https://api.my-endpoint.com/v1' },
    models: { ...DEFAULT_SETTINGS.models, custom: 'my-custom-model' },
  };
  assert.equal(isConfigured(settings, false), true);
});

test('CONFIG-CUSTOM-KEYLESS-02: valid custom endpoint + model + key -> configured', () => {
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    provider: 'custom',
    baseURLs: { custom: 'https://api.my-endpoint.com/v1' },
    models: { ...DEFAULT_SETTINGS.models, custom: 'my-custom-model' },
  };
  assert.equal(isConfigured(settings, true), true);
});

test('CONFIG-CUSTOM-KEYLESS-03: invalid/missing custom endpoint -> not configured', () => {
  const settingsMissingURL: Settings = {
    ...DEFAULT_SETTINGS,
    provider: 'custom',
    baseURLs: { custom: '' },
    models: { ...DEFAULT_SETTINGS.models, custom: 'my-custom-model' },
  };
  assert.equal(isConfigured(settingsMissingURL, false), false);
  assert.equal(isConfigured(settingsMissingURL, true), false);

  const settingsMissingModel: Settings = {
    ...DEFAULT_SETTINGS,
    provider: 'custom',
    baseURLs: { custom: 'https://api.my-endpoint.com/v1' },
    models: { ...DEFAULT_SETTINGS.models, custom: '' },
  };
  assert.equal(isConfigured(settingsMissingModel, false), false);
  assert.equal(isConfigured(settingsMissingModel, true), false);
});

test('CONFIG-OPENAI-DEEPSEEK-KEY-REQUIRED: OpenAI 与 DeepSeek 必须要求 Key', () => {
  const openaiSettings: Settings = {
    ...DEFAULT_SETTINGS,
    provider: 'openai',
  };
  assert.equal(isConfigured(openaiSettings, true), true);
  assert.equal(isConfigured(openaiSettings, false), false);

  const deepseekSettings: Settings = {
    ...DEFAULT_SETTINGS,
    provider: 'deepseek',
  };
  assert.equal(isConfigured(deepseekSettings, true), true);
  assert.equal(isConfigured(deepseekSettings, false), false);
});
