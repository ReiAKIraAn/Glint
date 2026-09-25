import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { withDefaults } from '../src/lib/settings';
import { PROVIDERS, PROVIDER_IDS } from '../src/lib/types';
import wxtConfig from '../wxt.config';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');

test('UI-ANKI-01: Options 页面与脚本彻底移除 Anki 元素', () => {
  const htmlPath = path.join(ROOT_DIR, 'src/entrypoints/options/index.html');
  const mainPath = path.join(ROOT_DIR, 'src/entrypoints/options/main.ts');

  const htmlContent = fs.readFileSync(htmlPath, 'utf8');
  const mainContent = fs.readFileSync(mainPath, 'utf8');

  // HTML 中严禁出现 exportAnki 按钮与 ankiNote 说明
  assert.strictEqual(htmlContent.includes('exportAnki'), false, 'options/index.html 不得包含 exportAnki');
  assert.strictEqual(htmlContent.includes('ankiNote'), false, 'options/index.html 不得包含 ankiNote');
  assert.strictEqual(htmlContent.includes('导出到 Anki'), false, 'options/index.html 不得包含 导出到 Anki 文案');

  // main.ts 中严禁包含 exportAnki 监听、setAnkiNote、toAnkiTSV import
  assert.strictEqual(mainContent.includes('exportAnki'), false, 'options/main.ts 不得包含 exportAnki');
  assert.strictEqual(mainContent.includes('setAnkiNote'), false, 'options/main.ts 不得包含 setAnkiNote');
  assert.strictEqual(mainContent.includes('toAnkiTSV'), false, 'options/main.ts 不得引入 toAnkiTSV');
});

test('UI-PROVIDER-01: Provider UI 仅暴露当前 3 家正式服务商，无废弃图标死代码', () => {
  // 1. PROVIDER_IDS 严格收敛为 3 个
  assert.deepStrictEqual(PROVIDER_IDS, ['openai', 'deepseek', 'custom']);
  assert.strictEqual(Object.keys(PROVIDERS).length, 3);

  // 2. options/main.ts 源码中不包含未使用的历史废弃图标 import
  const mainPath = path.join(ROOT_DIR, 'src/entrypoints/options/main.ts');
  const mainContent = fs.readFileSync(mainPath, 'utf8');

  assert.strictEqual(mainContent.includes('anthropicIcon'), false, 'options/main.ts 不得引入 anthropicIcon');
  assert.strictEqual(mainContent.includes('geminiIcon'), false, 'options/main.ts 不得引入 geminiIcon');
  assert.strictEqual(mainContent.includes('ollamaIcon'), false, 'options/main.ts 不得引入 ollamaIcon');
});

test('UI-SHORTCUT-01: Safari Extension Manifest 不包含 commands 声明', () => {
  // 1. 验证 wxt.config.ts 的 manifest 函数输出
  const manifestFn = (wxtConfig as { manifest: (env: { browser: string }) => Record<string, unknown> }).manifest;
  const safariManifest = manifestFn({ browser: 'safari' });

  assert.strictEqual(safariManifest.commands, undefined, 'Safari manifest 不得声明 commands');

  // 2. 验证实际打包产物（若存在）
  const distManifestPath = path.join(ROOT_DIR, '.output/safari-mv3/manifest.json');
  if (fs.existsSync(distManifestPath)) {
    const distManifest = JSON.parse(fs.readFileSync(distManifestPath, 'utf8'));
    assert.strictEqual(distManifest.commands, undefined, '构建产物 manifest.json 不得包含 commands');
    assert.strictEqual(JSON.stringify(distManifest).includes('next-word'), false);
    assert.strictEqual(JSON.stringify(distManifest).includes('prev-word'), false);
  }
});

test('UI-MIGRATION-01: 历史 provider (anthropic, compatible) 保持安全平滑迁移', () => {
  // 1. 历史 anthropic 安全降级至默认 openai
  const anthropicMigrated = withDefaults({ provider: 'anthropic' as any });
  assert.strictEqual(anthropicMigrated.provider, 'openai');

  // 2. 历史 compatible 安全迁移至 custom
  const compatibleMigrated = withDefaults({ provider: 'compatible' as any });
  assert.strictEqual(compatibleMigrated.provider, 'custom');
});
