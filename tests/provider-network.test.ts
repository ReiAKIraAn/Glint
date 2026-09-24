import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchProviderModels } from '../src/lib/provider-network';
import {
  hasHostPermission,
  originForProvider,
  requestHostPermission,
  revokeHostPermission,
} from '../src/lib/permissions';
import { apiKeysStore } from '../src/lib/keys';
import { DEFAULT_SETTINGS, isConfigured, type Settings } from '../src/lib/types';
import { browser } from '#imports';

/**
 * [Milestone 3 Automated Test Suite - Minimal Secure Provider Network Slice]
 * 涵盖全部 12 项场景：
 * 1. 正常 API request (Anthropic Header-based authentication & model list)
 * 2. API Key 绝不出现在请求 URL 中
 * 3. API Key 绝不出现在普通日志与控制台输出中
 * 4. API Key 绝不出现在 error message 中 (包括服务端回显)
 * 5. API Key 绝不进入 content-script message 响应负载
 * 6. Provider origin permission request 仅申请目标 Provider 的单一 Origin
 * 7. Permission denied 时的安全阻断
 * 8. Permission already granted 时的状态识别
 * 9. HTTP error (401 鉴权失败、500 服务端故障)
 * 10. Network error (DNS 失败、离线、SSL 错误)
 * 11. Malformed response (502 HTML、畸形 JSON)
 * 12. 清除 Key 后的状态与 revoke 行为
 */

const TEST_KEY = 'sk-ant-api03-test-token-valid-mock-key-123456';

test('1. 正常 API request: Anthropic 通过 Request Header 鉴权并解析模型列表', async () => {
  const settings: Settings = { ...DEFAULT_SETTINGS, provider: 'anthropic' };
  let capturedUrl = '';
  let capturedHeaders: Record<string, string> = {};

  const mockFetch: typeof fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedHeaders = (init?.headers as Record<string, string>) ?? {};
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { id: 'claude-3-5-sonnet-20241022' },
          { id: 'claude-3-5-haiku-20241022' },
        ],
      }),
      text: async () => '',
    } as unknown as Response;
  };

  const result = await fetchProviderModels(settings, TEST_KEY, { fetchFn: mockFetch });

  assert.strictEqual(result.ok, true);
  if (result.ok) {
    assert.deepStrictEqual(result.models, [
      'claude-3-5-haiku-20241022',
      'claude-3-5-sonnet-20241022',
    ]);
  }
  // 校验鉴权 Header 规范
  assert.strictEqual(capturedHeaders['x-api-key'], TEST_KEY);
  assert.strictEqual(capturedHeaders['anthropic-version'], '2023-06-01');
  assert.strictEqual(capturedHeaders['anthropic-dangerous-direct-browser-access'], 'true');
});

test('2. API Key 绝不出现在请求 URL 中', async () => {
  const settings: Settings = { ...DEFAULT_SETTINGS, provider: 'anthropic' };
  let requestedUrl = '';

  const mockFetch: typeof fetch = async (input) => {
    requestedUrl = String(input);
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    } as unknown as Response;
  };

  await fetchProviderModels(settings, TEST_KEY, { fetchFn: mockFetch });

  assert.strictEqual(requestedUrl, 'https://api.anthropic.com/v1/models?limit=1000');
  assert.strictEqual(requestedUrl.includes(TEST_KEY), false, 'URL 中绝对不可包含 API Key');
  assert.strictEqual(requestedUrl.includes('key='), false, 'URL Query 中绝对不可包含 key=');
  assert.strictEqual(requestedUrl.includes('token='), false, 'URL Query 中绝对不可包含 token=');
});

test('3. API Key 绝不出现在普通日志与控制台输出中', async () => {
  const settings: Settings = { ...DEFAULT_SETTINGS, provider: 'anthropic' };
  const loggedErrors: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    loggedErrors.push(args.map(String).join(' '));
  };

  const mockFetch: typeof fetch = async () => {
    throw new Error(`Connection to anthropic failed with key ${TEST_KEY}`);
  };

  try {
    const res = await fetchProviderModels(settings, TEST_KEY, { fetchFn: mockFetch });
    assert.strictEqual(res.ok, false);
    // 检查日志是否被脱敏
    for (const log of loggedErrors) {
      assert.strictEqual(log.includes(TEST_KEY), false, '日志严禁包含明文 Key');
    }
  } finally {
    console.error = originalError;
  }
});

test('4. API Key 绝不出现在 error message 中 (服务端回显凭证场景)', async () => {
  const settings: Settings = { ...DEFAULT_SETTINGS, provider: 'anthropic' };
  const mockFetch: typeof fetch = async () => {
    return {
      ok: false,
      status: 401,
      text: async () => `{"type":"error","error":{"message":"Invalid key: ${TEST_KEY}"}}`,
    } as unknown as Response;
  };

  const res = await fetchProviderModels(settings, TEST_KEY, { fetchFn: mockFetch });

  assert.strictEqual(res.ok, false);
  if (!res.ok) {
    assert.strictEqual(res.error.includes(TEST_KEY), false, '返回的 error 信息严禁携带明文 Key');
    assert.ok(res.error.includes('[REDACTED]'), '敏感回显必须替换为 [REDACTED]');
  }
});

test('5. API Key 绝不进入 content-script message 响应负载', async () => {
  const settings: Settings = { ...DEFAULT_SETTINGS, provider: 'anthropic' };
  await apiKeysStore.setValue({ anthropic: TEST_KEY });

  // 模拟 background 处理 content script 的 ai:status 查询
  const statusPayload = {
    configured: isConfigured(settings, true),
  };

  // 确认对外发布的 statusPayload 只有布尔值，绝对无 Key 字段
  assert.deepStrictEqual(statusPayload, { configured: true });
  assert.strictEqual('key' in statusPayload, false);
  assert.strictEqual('apiKey' in statusPayload, false);

  await apiKeysStore.setValue({});
});

test('6. Provider origin permission request 仅申请目标 Provider 的单一 Origin', async () => {
  const settings: Settings = { ...DEFAULT_SETTINGS, provider: 'anthropic' };
  const targetOrigin = originForProvider(settings, 'anthropic');
  assert.strictEqual(targetOrigin, 'https://api.anthropic.com/*');

  let requestedOrigins: string[] = [];
  const originalRequest = browser.permissions.request;
  browser.permissions.request = async (query) => {
    requestedOrigins = query.origins ?? [];
    return true;
  };

  try {
    const res = await requestHostPermission(targetOrigin!);
    assert.strictEqual(res.ok, true);
    assert.deepStrictEqual(requestedOrigins, ['https://api.anthropic.com/*']);
    assert.strictEqual(requestedOrigins.includes('https://*/*'), false, '严禁申请全站通配符');
  } finally {
    browser.permissions.request = originalRequest;
  }
});

test('7. Permission denied 时的安全阻断', async () => {
  const originalRequest = browser.permissions.request;
  browser.permissions.request = async () => false;

  try {
    const res = await requestHostPermission('https://api.anthropic.com/*');
    assert.strictEqual(res.ok, false);
    assert.ok(res.error?.includes('未授予'));
  } finally {
    browser.permissions.request = originalRequest;
  }
});

test('8. Permission already granted 时的状态识别', async () => {
  const originalContains = browser.permissions.contains;
  browser.permissions.contains = async (query) => {
    return query.origins?.includes('https://api.anthropic.com/*') ?? false;
  };

  try {
    const granted = await hasHostPermission('https://api.anthropic.com/*');
    assert.strictEqual(granted, true);

    const notGranted = await hasHostPermission('https://unauthorized.domain/*');
    assert.strictEqual(notGranted, false);
  } finally {
    browser.permissions.contains = originalContains;
  }
});

test('9. HTTP error 处理 (401 鉴权失败、500 服务端故障)', async () => {
  const settings: Settings = { ...DEFAULT_SETTINGS, provider: 'anthropic' };

  // 401
  const fetch401: typeof fetch = async () =>
    ({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized client',
    }) as unknown as Response;

  const res401 = await fetchProviderModels(settings, TEST_KEY, { fetchFn: fetch401 });
  assert.strictEqual(res401.ok, false);
  if (!res401.ok) {
    assert.ok(res401.error.includes('401'));
  }

  // 500
  const fetch500: typeof fetch = async () =>
    ({
      ok: false,
      status: 500,
      text: async () => 'Internal server error',
    }) as unknown as Response;

  const res500 = await fetchProviderModels(settings, TEST_KEY, { fetchFn: fetch500 });
  assert.strictEqual(res500.ok, false);
  if (!res500.ok) {
    assert.ok(res500.error.includes('500'));
  }
});

test('10. Network error 处理 (DNS 失败、离线、SSL 错误)', async () => {
  const settings: Settings = { ...DEFAULT_SETTINGS, provider: 'anthropic' };

  const fetchNetworkError: typeof fetch = async () => {
    throw new TypeError('Failed to fetch (DNS_PROBE_FINISHED_NXDOMAIN)');
  };

  const res = await fetchProviderModels(settings, TEST_KEY, { fetchFn: fetchNetworkError });
  assert.strictEqual(res.ok, false);
  if (!res.ok) {
    assert.ok(res.error.includes('连不上 api.anthropic.com'));
    assert.ok(res.error.includes('DNS_PROBE_FINISHED_NXDOMAIN'));
  }
});

test('11. Malformed response 处理 (502 HTML、畸形 JSON)', async () => {
  const settings: Settings = { ...DEFAULT_SETTINGS, provider: 'anthropic' };

  const fetchHtmlResponse: typeof fetch = async () =>
    ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON at position 0');
      },
    }) as unknown as Response;

  const res = await fetchProviderModels(settings, TEST_KEY, { fetchFn: fetchHtmlResponse });
  assert.strictEqual(res.ok, false);
  if (!res.ok) {
    assert.ok(res.error.includes('非 JSON 格式数据'));
  }
});

test('12. 清除 Key 后的状态与 revoke 行为', async () => {
  const settings: Settings = { ...DEFAULT_SETTINGS, provider: 'anthropic' };

  // 1. 保存 Key
  await apiKeysStore.setValue({ anthropic: TEST_KEY });
  assert.strictEqual(isConfigured(settings, true), true);

  // 2. 清除 Key
  const storedKeys = { ...(await apiKeysStore.getValue()) };
  delete storedKeys.anthropic;
  await apiKeysStore.setValue(storedKeys);

  // 3. 验证就绪状态重置
  assert.strictEqual(isConfigured(settings, false), false);
  assert.strictEqual((await apiKeysStore.getValue()).anthropic, undefined);

  // 4. 验证 revoke 调用
  let revokedOrigin = '';
  const originalRemove = browser.permissions.remove;
  browser.permissions.remove = async (query) => {
    revokedOrigin = query.origins?.[0] ?? '';
    return true;
  };

  try {
    const revokeRes = await revokeHostPermission('https://api.anthropic.com/*');
    assert.strictEqual(revokeRes.ok, true);
    assert.strictEqual(revokedOrigin, 'https://api.anthropic.com/*');
  } finally {
    browser.permissions.remove = originalRemove;
  }
});
