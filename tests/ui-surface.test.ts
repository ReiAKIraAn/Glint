import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { CONTACTS } from '../src/lib/links';
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

test('UI-LINKS-01: GitHub contact URL 必须是用户仓库 https://github.com/ReiAKIraAn/Glint', () => {
  const githubContact = CONTACTS.find((c) => c.name === 'GitHub');
  assert.ok(githubContact, 'CONTACTS 必须包含 GitHub 入口');
  assert.strictEqual(githubContact.url, 'https://github.com/ReiAKIraAn/Glint');
});

test('UI-LINKS-02: CONTACTS 不得包含 X / Twitter contact', () => {
  const xContact = CONTACTS.find((c) => c.name.toLowerCase() === 'x' || c.name.toLowerCase().includes('twitter'));
  assert.strictEqual(xContact, undefined, 'CONTACTS 不得包含 X / Twitter 入口');
  assert.strictEqual(CONTACTS.length, 1, '当前仅保留 GitHub 1 个有效入口');
});

test('UI-LINKS-03: 当前产品 surface 不得包含 x.com / twitter.com 产品社交入口', () => {
  const targets = [
    path.join(ROOT_DIR, 'src/lib/links.ts'),
    path.join(ROOT_DIR, 'src/entrypoints/options/index.html'),
    path.join(ROOT_DIR, 'src/entrypoints/options/main.ts'),
    path.join(ROOT_DIR, 'src/entrypoints/popup/index.html'),
    path.join(ROOT_DIR, 'src/entrypoints/popup/main.ts'),
    path.join(ROOT_DIR, 'README.md'),
    path.join(ROOT_DIR, 'PRIVACY.md'),
  ];
  for (const file of targets) {
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    assert.strictEqual(/https?:\/\/(www\.)?(x\.com|twitter\.com)/i.test(content), false, `${file} 不得包含 x.com/twitter.com 社交链接`);
    assert.strictEqual(/yanxi067/i.test(content), false, `${file} 不得包含旧作者社交账号 yanxi067`);
  }
});

test('UI-SHORTCUT-02: WXT configuration 明确关闭 dev reload command', () => {
  const devConfig = (wxtConfig as { dev?: { reloadCommand?: boolean } }).dev;
  assert.ok(devConfig, 'wxtConfig 必须配置 dev 选项');
  assert.strictEqual(devConfig.reloadCommand, false, 'wxtConfig.dev.reloadCommand 必须明确设为 false');
});

test('UI-MIGRATION-02: 历史 upstream GitHub references 作为历史事实在 docs 中保留，但不再作为当前产品 contact surface', () => {
  // 1. 验证生产联系文件 links.ts 不存在旧 upstream 链接
  const linksPath = path.join(ROOT_DIR, 'src/lib/links.ts');
  const linksContent = fs.readFileSync(linksPath, 'utf8');
  assert.strictEqual(linksContent.includes('whyubel1eve'), false, 'links.ts 不得包含旧 upstream 作者账号 whyubel1eve');

  // 2. 验证 package.json 中各项正式元数据均指向当前仓库
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.repository.url, 'git+https://github.com/ReiAKIraAn/Glint.git');
  assert.strictEqual(pkg.homepage, 'https://github.com/ReiAKIraAn/Glint#readme');
  assert.strictEqual(pkg.bugs, 'https://github.com/ReiAKIraAn/Glint/issues');

  // 3. 验证历史审计文档合法保留溯源事实，未被误删篡改
  const docsReq = fs.readFileSync(path.join(ROOT_DIR, 'docs/requirements.md'), 'utf8');
  assert.ok(docsReq.includes('whyubel1eve/glint'), 'docs/requirements.md 应保留历史参考源事实');
});

test('UI-RARE-WORD-01: Options 页面彻底移除未实现的生僻词标注 UI 选项与无效描述', () => {
  const htmlPath = path.join(ROOT_DIR, 'src/entrypoints/options/index.html');
  const mainPath = path.join(ROOT_DIR, 'src/entrypoints/options/main.ts');

  const htmlContent = fs.readFileSync(htmlPath, 'utf8');
  const mainContent = fs.readFileSync(mainPath, 'utf8');

  // HTML 中严禁出现 markUnknown 与相关无效 UI 文案
  assert.strictEqual(htmlContent.includes('markUnknown'), false, 'options/index.html 不得包含 markUnknown');
  assert.strictEqual(htmlContent.includes('标注词库外的生僻词'), false, 'options/index.html 不得包含 标注词库外的生僻词');

  // main.ts 中严禁包含 markUnknown 元素绑定与无效预览描述
  assert.strictEqual(mainContent.includes('markUnknown:'), false, 'options/main.ts 不得包含 fields.markUnknown');
  assert.strictEqual(mainContent.includes('词库外的生僻词暂不标'), false, 'options/main.ts 不得包含无效预览描述');

  // 保证 Settings 数据结构的向下兼容性，已有配置不会崩溃
  const defaultWithMarkUnknown = withDefaults({ markUnknown: false });
  assert.strictEqual(defaultWithMarkUnknown.markUnknown, false);
});
