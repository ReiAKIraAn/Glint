import { test } from 'node:test';
import assert from 'node:assert/strict';
import { originForProvider } from '../src/lib/permissions';
import { DEFAULT_SETTINGS, type Settings } from '../src/lib/types';
import wxtConfig from '../wxt.config';

/**
 * [Core Regression Test Suite - Least-Privilege Permission Architecture]
 * 运行环境: Node.js 运行时测试 (注意: 非 Safari 原生 WebExtension 运行时)
 */

test('originForProvider 为各预置 Provider 正确解析单一目标 Origin', () => {
  const settings: Settings = { ...DEFAULT_SETTINGS };

  assert.strictEqual(originForProvider(settings, 'openai'), 'https://api.openai.com/*');
  assert.strictEqual(originForProvider(settings, 'deepseek'), 'https://api.deepseek.com/*');
});

test('originForProvider 正确解析自定义 Custom Provider 的 Origin', () => {
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    provider: 'custom',
    baseURLs: {
      custom: 'https://custom-ai.company.internal/v1',
    },
  };

  const origin = originForProvider(settings, 'custom');
  assert.strictEqual(origin, 'https://custom-ai.company.internal/*');
});

test('Safari 构建配置严格践行最小权限原则 (Least-Privilege)', () => {
  // 提取 wxt.config 中的 manifest 函数
  const manifestFn = (wxtConfig as { manifest: (env: { browser: string }) => Record<string, unknown> }).manifest;
  assert.ok(typeof manifestFn === 'function', 'wxt.config 必须导出带有 manifest 函数的配置');

  const safariManifest = manifestFn({ browser: 'safari' });
  const chromeManifest = manifestFn({ browser: 'chrome' });

  // 1. Safari 必须零预置 host_permissions，彻底消除安装时的商业域名弹窗警示
  assert.deepStrictEqual(
    safariManifest.host_permissions,
    [],
    'Safari Personal Edition 的 required host_permissions 必须为空数组',
  );

  // 2. Safari 的 optional_host_permissions 必须包含预置 provider 域名，且移除了已下线的 Anthropic
  const safariOptional = safariManifest.optional_host_permissions as string[];
  assert.ok(safariOptional.includes('https://api.openai.com/*'));
  assert.ok(safariOptional.includes('https://api.deepseek.com/*'));
  assert.strictEqual(safariOptional.includes('https://api.anthropic.com/*'), false, '已下线的 Anthropic 不得出现在权限清单中');
  assert.strictEqual(
    safariOptional.includes('https://*/*'),
    false,
    'Safari 严禁申请全站通配符 https://*/*',
  );

  // 3. Chrome 构建应维持向后兼容性
  const chromeRequired = chromeManifest.host_permissions as string[];
  assert.ok(chromeRequired.length > 0, 'Chrome 构建保留静态预置声明');
});
