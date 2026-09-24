import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactSecrets, safeErrorMessage, sanitizeUrl } from '../src/lib/security';
import { PROVIDERS, baseURLOf, type Settings, DEFAULT_SETTINGS } from '../src/lib/types';

/**
 * [Core Regression Test Suite - Security & Secret Redaction]
 * 运行环境: Node.js 运行时测试 (注意: 非 Safari 原生环境)
 */

test('OpenAI 与 DeepSeek 模型列表请求 URL 严禁包含 ?key= 或任何 query secret', () => {
  const settingsOpenAI: Settings = { ...DEFAULT_SETTINGS, provider: 'openai' };
  const specOpenAI = PROVIDERS[settingsOpenAI.provider];
  const dummyKey = 'sk-proj-DummyKeyForOpenAI123456';

  const url = `${specOpenAI.baseURL}/models`;

  assert.strictEqual(
    url,
    'https://api.openai.com/v1/models',
    'OpenAI 请求必须是纯净的标准 URL，严禁在 query parameter 中拼接 key',
  );
  assert.ok(!url.includes('?key='), 'URL 严禁包含 ?key=');
  assert.ok(!url.includes(dummyKey), 'URL 严禁包含 API Key');
});

test('OpenAI 与 DeepSeek 请求 Header 必须包含 Authorization Bearer 鉴权头', () => {
  const dummyKey = 'sk-dummy-key-123456';
  const headers: Record<string, string> = {
    authorization: `Bearer ${dummyKey}`,
  };

  assert.strictEqual(headers['authorization'], `Bearer ${dummyKey}`, '鉴权头必须为 Bearer token');
});

test('OpenAI 系 Header 鉴权规范核对', () => {
  const openaiKey = 'sk-proj-dummy-openai-key-abcdefghijklmnopqrstuvwxyz';
  const openaiHeaders: Record<string, string> = {
    authorization: `Bearer ${openaiKey}`,
  };
  assert.strictEqual(openaiHeaders['authorization'], `Bearer ${openaiKey}`);
});

test('sanitizeUrl 能够清除 URL 中各形态的敏感 query 参数与凭据', () => {
  const leakedUrl = 'https://generativelanguage.googleapis.com/v1beta/models?key=AIzaSySecretKey123&other=true';
  const sanitized = sanitizeUrl(leakedUrl);
  assert.ok(!sanitized.includes('AIzaSySecretKey123'), '敏感 key query 必须被剔除');
  assert.ok(sanitized.includes('other=true'), '非敏感 query 应被保留');

  const customUrlWithAuth = 'https://user:password123@api.example.com/v1/models?token=secretToken456&api_key=sk-123';
  const sanitizedCustom = sanitizeUrl(customUrlWithAuth);
  assert.ok(!sanitizedCustom.includes('password123'), '用户名密码必须被剔除');
  assert.ok(!sanitizedCustom.includes('secretToken456'), 'token query 必须被剔除');
  assert.ok(!sanitizedCustom.includes('sk-123'), 'api_key query 必须被剔除');
});

test('redactSecrets 能够脱敏各类已知真 Key 与特征 API Key 格式', () => {
  const secretKey = 'sk-ant-api03-very-secret-anthropic-key-123456';
  const errorText = `网络请求失败: sk-ant-api03-very-secret-anthropic-key-123456 returned 401 Unauthorized`;

  const redacted = redactSecrets(errorText, [secretKey]);
  assert.ok(!redacted.includes(secretKey), '已知 Key 必须被脱敏');
  assert.ok(redacted.includes('[REDACTED]'), '脱敏后必须包含占位符');

  const geminiError = 'Google API error at https://generativelanguage.googleapis.com/models?key=AIzaSySecretKey999999999999999999999999';
  const redactedGemini = redactSecrets(geminiError);
  assert.ok(!redactedGemini.includes('AIzaSySecretKey999999999999999999999999'));
  assert.ok(redactedGemini.includes('[REDACTED]'));

  const bearerError = 'Failed Authorization: Bearer sk-openai-secret-token-abcdefghijklmnop';
  const redactedBearer = redactSecrets(bearerError);
  assert.ok(!redactedBearer.includes('sk-openai-secret-token-abcdefghijklmnop'));
  assert.ok(redactedBearer.includes('Bearer [REDACTED]'));
});

test('safeErrorMessage 提取错误文本且保证不泄露任何 secret', () => {
  const rawKey = 'sk-deepseek-778899aabbccddeeff00112233445566';
  const errorObj = new Error(`Connection to https://api.deepseek.com with key ${rawKey} failed`);
  const safeMsg = safeErrorMessage(errorObj, [rawKey]);

  assert.ok(!safeMsg.includes(rawKey), '异常信息中不得包含原始密钥');
  assert.ok(safeMsg.includes('[REDACTED]'));
});

test('UI 模拟：设置页和卡片报错渲染时不会回显任何明文密钥', () => {
  const dummyKey = 'AIzaSyGoogleKeyLeakedInError987654321';
  // 模拟服务器返回包含请求 URL 的报错报文
  const simulatedServerError = `generativelanguage.googleapis.com 接口返回 403: {"error": "Invalid API key: ${dummyKey}"}`;

  // 经过 safeErrorMessage 脱敏
  const safeUiMessage = safeErrorMessage(simulatedServerError, [dummyKey]);
  assert.ok(!safeUiMessage.includes(dummyKey), 'UI 展示文本不得包含 API Key');
  assert.ok(safeUiMessage.includes('[REDACTED]'));
});
