import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  executeSaveWorkflow,
  validateSaveForm,
  type SaveInputParams,
} from '../src/lib/permissions';
import { DEFAULT_SETTINGS, type Provider, type Settings } from '../src/lib/types';

/**
 * [M5-W13.1 User-Gesture Permission Gate Test Suite]
 * 核心验证：
 * 1. 保存设置流程在触发 permissions.request 之前 100% 纯同步，零 await / Promise 延迟；
 * 2. Custom 有 Key 与无 Key（Keyless）场景均受权限门禁保护；
 * 3. 权限拒绝时绝对不保存任何凭据与配置；
 * 4. Extra Body 结构合法性校验。
 */

test('PERM-GESTURE-01: 验证保存流程在 permission request 前没有任何异步 Promise / await', async () => {
  const settings: Settings = { ...DEFAULT_SETTINGS, provider: 'custom' };
  const input: SaveInputParams = {
    provider: 'custom',
    apiKey: 'sk-test-key',
    baseURL: 'https://api.example.com/v1',
    extraBody: '{"thinking_mode": false}',
    savedKeys: {},
    currentSettings: settings,
  };

  // 1. validateSaveForm 必须是纯同步函数，绝不能返回 Promise
  const syncValidation = validateSaveForm(input);
  assert.strictEqual(syncValidation instanceof Promise, false, 'validateSaveForm 不能是 Promise');
  assert.strictEqual(typeof (syncValidation as any)?.then, 'undefined', 'validateSaveForm 不能有 then 方法');
  assert.strictEqual(syncValidation.ok, true);

  // 2. 验证 executeSaveWorkflow 在调用 requestPermission 之前没有进入微任务队列
  let microtaskRan = false;
  queueMicrotask(() => {
    microtaskRan = true;
  });

  let permissionCalledBeforeMicrotask = false;

  await executeSaveWorkflow(input, {
    requestPermission: async (origin) => {
      // 若在调用此函数前发生了任何 await，微任务队列早已被清空并使 microtaskRan 变为 true
      permissionCalledBeforeMicrotask = !microtaskRan;
      assert.strictEqual(
        microtaskRan,
        false,
        'requestPermission 必须在用户手势事件的初始同步执行帧内被调用，不得发生微任务等待',
      );
      assert.strictEqual(origin, 'https://api.example.com/*');
      return { ok: true };
    },
    saveSettings: async () => {},
    saveApiKey: async () => {},
  });

  assert.strictEqual(permissionCalledBeforeMicrotask, true, 'requestPermission 必须在微任务前执行');
});

test('PERM-CUSTOM-01: Custom + API Key (Save → permission request → granted → API Key saved)', async () => {
  const settings: Settings = { ...DEFAULT_SETTINGS, provider: 'custom' };
  const input: SaveInputParams = {
    provider: 'custom',
    apiKey: 'sk-custom-secret-key',
    baseURL: 'https://my-custom-llm.com/v1',
    extraBody: '{\n  "thinking_mode": false\n}',
    savedKeys: {},
    currentSettings: settings,
  };

  let requestedOrigin = '';
  let savedSettingsPayload: Partial<Settings> | null = null;
  let savedKeyPayload: { provider: Provider; key: string } | null = null;

  const result = await executeSaveWorkflow(input, {
    requestPermission: async (origin) => {
      requestedOrigin = origin;
      return { ok: true };
    },
    saveSettings: async (changes) => {
      savedSettingsPayload = changes;
    },
    saveApiKey: async (p, key) => {
      savedKeyPayload = { provider: p, key };
    },
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(requestedOrigin, 'https://my-custom-llm.com/*');
  assert.deepStrictEqual(savedKeyPayload, {
    provider: 'custom',
    key: 'sk-custom-secret-key',
  });
  assert.ok(savedSettingsPayload);
  assert.strictEqual((savedSettingsPayload as any).customExtraBody, '{\n  "thinking_mode": false\n}');
  assert.strictEqual((savedSettingsPayload as any).baseURLs?.custom, 'https://my-custom-llm.com/v1');
});

test('PERM-CUSTOM-02: Custom keyless (Save → permission request → granted → settings saved, no key saved)', async () => {
  const settings: Settings = { ...DEFAULT_SETTINGS, provider: 'custom' };
  const input: SaveInputParams = {
    provider: 'custom',
    apiKey: '', // 无 Key
    baseURL: 'http://localhost:11434/v1',
    extraBody: '{}',
    savedKeys: {}, // 无已保存 Key
    currentSettings: settings,
  };

  let requestedOrigin = '';
  let settingsSaved = false;
  let keySaved = false;

  const result = await executeSaveWorkflow(input, {
    requestPermission: async (origin) => {
      requestedOrigin = origin;
      return { ok: true };
    },
    saveSettings: async () => {
      settingsSaved = true;
    },
    saveApiKey: async () => {
      keySaved = true;
    },
  });

  assert.strictEqual(result.ok, true);
  // 本地端点同样通过权限门禁申请
  assert.strictEqual(requestedOrigin, 'http://localhost:11434/*');
  assert.strictEqual(settingsSaved, true, '配置必须落盘');
  assert.strictEqual(keySaved, false, '无 Key 模式不得保存空 Key');
});

test('PERM-CUSTOM-03: Permission denied (Save → request denied → nothing sensitive saved)', async () => {
  const settings: Settings = { ...DEFAULT_SETTINGS, provider: 'custom' };
  const input: SaveInputParams = {
    provider: 'custom',
    apiKey: 'sk-should-not-be-saved',
    baseURL: 'https://untrusted-host.com/v1',
    extraBody: '{"mode": "test"}',
    savedKeys: {},
    currentSettings: settings,
  };

  let settingsSaved = false;
  let keySaved = false;

  const result = await executeSaveWorkflow(input, {
    requestPermission: async () => {
      return { ok: false, error: '用户拒绝了网络访问权限' };
    },
    saveSettings: async () => {
      settingsSaved = true;
    },
    saveApiKey: async () => {
      keySaved = true;
    },
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error, '用户拒绝了网络访问权限');
  assert.strictEqual(settingsSaved, false, '权限被拒时严禁保存设置');
  assert.strictEqual(keySaved, false, '权限被拒时严禁保存敏感 API Key');
});

test('PERM-CUSTOM-04: Invalid Extra Body 校验（[] 与 "abc" 必须拒绝，{"thinking_mode": false} 必须接受）', async () => {
  const settings: Settings = { ...DEFAULT_SETTINGS, provider: 'custom' };

  // 1. 数组 [] 必须拒绝
  const arrayInput: SaveInputParams = {
    provider: 'custom',
    apiKey: 'sk-123',
    baseURL: 'https://api.example.com/v1',
    extraBody: '[]',
    savedKeys: {},
    currentSettings: settings,
  };
  const arrayResult = validateSaveForm(arrayInput);
  assert.strictEqual(arrayResult.ok, false);
  assert.strictEqual(arrayResult.field, 'extraBody');
  assert.ok(arrayResult.error.includes('JSON 对象'));

  // 2. 字符串 "abc" 必须拒绝
  const stringInput: SaveInputParams = {
    ...arrayInput,
    extraBody: '"abc"',
  };
  const stringResult = validateSaveForm(stringInput);
  assert.strictEqual(stringResult.ok, false);
  assert.strictEqual(stringResult.field, 'extraBody');

  // 3. 数字 123 必须拒绝
  const numberInput: SaveInputParams = {
    ...arrayInput,
    extraBody: '123',
  };
  const numberResult = validateSaveForm(numberInput);
  assert.strictEqual(numberResult.ok, false);
  assert.strictEqual(numberResult.field, 'extraBody');

  // 4. 标准对象 {"thinking_mode": false} 必须接受
  const validObjInput: SaveInputParams = {
    ...arrayInput,
    extraBody: '{\n  "thinking_mode": false\n}',
  };
  const validObjResult = validateSaveForm(validObjInput);
  assert.strictEqual(validObjResult.ok, true);
  assert.strictEqual(validObjResult.targetOrigin, 'https://api.example.com/*');
});

test('PERM-OPENAI-01: OpenAI 正常保存流程（首个异步即为权限门禁）', async () => {
  const settings: Settings = { ...DEFAULT_SETTINGS, provider: 'openai' };
  const input: SaveInputParams = {
    provider: 'openai',
    apiKey: 'sk-openai-key',
    baseURL: '',
    extraBody: '',
    savedKeys: {},
    currentSettings: settings,
  };

  let requestedOrigin = '';
  let keySaved = false;

  const result = await executeSaveWorkflow(input, {
    requestPermission: async (origin) => {
      requestedOrigin = origin;
      return { ok: true };
    },
    saveSettings: async () => {},
    saveApiKey: async () => {
      keySaved = true;
    },
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(requestedOrigin, 'https://api.openai.com/*');
  assert.strictEqual(keySaved, true);
});
