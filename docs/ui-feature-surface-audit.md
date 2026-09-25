# M5-W12 Step 1 UI Feature Surface Closure Audit

> **审计性质**: 只读深度闭环审计 (`src/` 生产代码 0 修改)
> **基线 Commit**: `690e3f2dcd9cfcf65c205a2928dc899091d05b8f`
> **分支**: `safari-personal`
> **自动化测试基线**: `408 / 408 PASS`
> **目标**: 完成「UI → Runtime → Manifest → Documentation」全链路一致性闭环审计，排查所有不属于当前 Safari Personal Edition 范围但在 UI、配置、Manifest 或文档中暴露的残留入口与虚假宣称，制定精确的 Step 2 清理方案。

---

## 1. Executive Summary (执行摘要)

在经过 M5-W11 与 M5-W11.1 的架构收敛后，Glint Safari Personal Edition 已正式确立由 **OpenAI**、**DeepSeek** 与 **自定义接口 (Custom API)** 构成的三 Provider 体系，并剥离了历史 Anthropic 运行时依赖，健全了无 Key 模式与 `customExtraBody` 机制。

然而，对整体产品表面的全面检查发现：
1. **Anki 假 UI 残留**: Options 设置页中仍然保留 `#exportAnki` 按钮与 `#ankiNote` 提示段落，点击后弹出“暂不支持导出到 Anki”的报错提示，同时 `README.md` 仍在宣称支持 Anki 导出；
2. **Shortcut 平台冲突与文档失效**: Manifest 声明了 `commands: Alt+G / Alt+Shift+G`，导致 Safari 设置中展示快捷键配置，但在 macOS 下 `Alt+G` 对应 `Option+G`（在输入框中会输出特殊符号 `©`），且 `README.md` 错误地指导用户在不存在的 `chrome://extensions/shortcuts` 中改键；
3. **文档显著陈旧滞后**:
   - `README.md` 仍宣称支持 Anthropic、Gemini、Kimi、Ollama 等 11 家服务商，宣称支持 Anki 导出，并提供 Chrome 专属路径描述；
   - `PRIVACY.md` 宣称已生成的释义会“连同当时那句原文”持久化存储（实际上出于隐私保护，`local:explanations` 仅存 `word`, `explanation`, `updatedAt`，严禁存入原句）；
4. **Options 脚本死代码残留**: [src/entrypoints/options/main.ts](file:///Users/ada/Downloads/glint-main/src/entrypoints/options/main.ts) 中仍静态导入了废弃的 `anthropicIcon`、`geminiIcon`、`ollamaIcon`，未在 UI 中展示但占据模块作用域；
5. **正常收敛能力验证**: AI Redo（无假 UI，仅网络失败时允许重试）、Markdown（原生纯文本流式追加，无伪造渲染开关）、Shadow DOM 与 iframe（严格边界隔离，无虚假穿透宣称）。

---

## 2. 当前正式功能清单与状态基线

基于实际生产代码、Provider 适配器、Options 设置页、Popup 弹窗与 Manifest，当前正式功能清单确立如下：

| 功能模块 | 对应 UI 表面 | 运行时实现 (Runtime) | Manifest 依赖 | 文档宣称现状 | 正式状态 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **CEFR 生词扫描** | Popup 开关 / Options 水平滑块 | [src/lib/scanner.ts](file:///Users/ada/Downloads/glint-main/src/lib/scanner.ts) (A1~C2 难度过滤) | `<all_urls>` | `README.md` 第 7 行 | **SUPPORTED** |
| **四种标注样式** | Options 下拉框 (`style`) | [src/lib/highlight.ts](file:///Users/ada/Downloads/glint-main/src/lib/highlight.ts) (`dotted`, `underline`, `tint`, `color`) | 无 | 待补 `color` 描述 | **SUPPORTED** |
| **熟词消词过滤** | 卡片“✓ 认识”按钮 / Options 清单 | [src/lib/scanner.ts](file:///Users/ada/Downloads/glint-main/src/lib/scanner.ts) (`knownWordsStore`) | `storage` | `README.md` 第 10 行 | **SUPPORTED** |
| **本地离线词典** | 悬浮卡片音标 / 中文释义 | [src/lib/dict.ts](file:///Users/ada/Downloads/glint-main/src/lib/dict.ts) (`dict.json` 3.76MB) | 无 | `README.md` 第 9 行 | **SUPPORTED** |
| **原生离线 TTS** | 卡片小喇叭朗读按钮 | [src/lib/tts.ts](file:///Users/ada/Downloads/glint-main/src/lib/tts.ts) (Web Speech API, `localService`) | 无 | `README.md` 第 9 行 | **SUPPORTED** |
| **OpenAI 释义** | Options 服务商卡片 / Key / 模型 | [src/lib/providers/openai-adapter.ts](file:///Users/ada/Downloads/glint-main/src/lib/providers/openai-adapter.ts) (`gpt-4o-mini`) | `optional_host_permissions` | 混在 11 家列表中 | **SUPPORTED** |
| **DeepSeek 释义** | Options 服务商卡片 / Key / 模型 | [src/lib/providers/deepseek-adapter.ts](file:///Users/ada/Downloads/glint-main/src/lib/providers/deepseek-adapter.ts) (`deepseek-chat`) | `optional_host_permissions` | 混在 11 家列表中 | **SUPPORTED** |
| **自定义接口** | Options 卡片 / 地址 / 额外请求体 | [src/lib/providers/custom-adapter.ts](file:///Users/ada/Downloads/glint-main/src/lib/providers/custom-adapter.ts) (免 Key/带 Key, SSE) | 动态用户手势申请 | 简单提及 | **SUPPORTED** |
| **AI 释义缓存** | 悬停卡片秒显 / Options 清空 | [src/lib/explanation-cache.ts](file:///Users/ada/Downloads/glint-main/src/lib/explanation-cache.ts) (2000条 LRU) | `storage` | `PRIVACY.md` 描述有偏差 | **SUPPORTED** |
| **排除站点** | Popup 当前站开关 / Options 列表 | [src/lib/types.ts](file:///Users/ada/Downloads/glint-main/src/lib/types.ts) (`siteDisabled`) | `storage` | `README.md` 第 11 行 | **SUPPORTED** |
| **配置数据备份** | Options 备份/恢复 JSON 按钮 | [src/entrypoints/options/main.ts](file:///Users/ada/Downloads/glint-main/src/entrypoints/options/main.ts) (`exportData`/`importData`) | 无 | `README.md` 第 10 行 | **SUPPORTED** |

---

## 3. 核心领域逐项审计结论

### 3.1 审计 Anki (Anki TSV Export)

#### 代码事实检查
1. **Options UI 表面**:
   - [src/entrypoints/options/index.html](file:///Users/ada/Downloads/glint-main/src/entrypoints/options/index.html) 第 229 行存在按钮 `<button id="exportAnki">导出到 Anki</button>`；
   - 第 232-234 行存在引导段落 `<p class="note" id="ankiNote">存成一个文本文件，在 Anki 里点 Import File 选中它就行...</p>`。
2. **事件监听与反馈**:
   - [src/entrypoints/options/main.ts](file:///Users/ada/Downloads/glint-main/src/entrypoints/options/main.ts) 第 785 行：
     ```ts
     $('exportAnki').addEventListener('click', async () => {
       setAnkiNote('Safari Personal Edition 暂不支持导出到 Anki。', 'bad');
     });
     ```
   - 用户点击该按钮不会执行任何导出，而是直接在下方抛出红色报错，构成典型的“破损/虚假 UI”。
3. **死代码与孤立依赖**:
   - `options/main.ts` 第 48 行静态引入了 `import { toAnkiTSV, type AnkiRow } from '@/lib/anki'`，但在整个文件中 `toAnkiTSV` 从未被调用。
   - [src/lib/anki.ts](file:///Users/ada/Downloads/glint-main/src/lib/anki.ts) 及其测试 [tests/anki.test.ts](file:///Users/ada/Downloads/glint-main/tests/anki.test.ts) 完全脱离了当前运行时数据流。
4. **外部文档宣称**:
   - `README.md` 第 10 行明确承诺：“已生成的释义可以导出到 Anki”。

#### 审计结论与处置建议
- **定性**: `EXCLUDED (FALSE UI)`。架构决策 D3=NO 已经明确不持久化网页原句，彻底排除 Anki 导出。当前 UI 入口为历史遗留的假入口。
- **Action**: **`REMOVE`**。
  - 从 `options/index.html` 中物理删除 `#exportAnki` 按钮与 `#ankiNote` 提示；
  - 从 `options/main.ts` 中删除点击监听、`setAnkiNote` 函数及无用的 `toAnkiTSV` import；
  - 修正 `README.md`，删除对 Anki 导出的功能承诺；
  - `src/lib/anki.ts` 与 `tests/anki.test.ts` 可保留作为孤立工具单测，或在后续阶段归档。

---

### 3.2 审计 Shortcut (Safari Extension Commands)

#### 代码事实检查
1. **Manifest 声明**:
   - [wxt.config.ts](file:///Users/ada/Downloads/glint-main/wxt.config.ts) 第 60-69 行及打包产物 [.output/safari-mv3/manifest.json](file:///Users/ada/Downloads/glint-main/.output/safari-mv3/manifest.json) 声明了：
     ```json
     "commands": {
       "next-word": { "suggested_key": { "default": "Alt+G" }, "description": "跳到下一个标注的词" },
       "prev-word": { "suggested_key": { "default": "Alt+Shift+G" }, "description": "跳到上一个标注的词" }
     }
     ```
2. **运行时实现完整性**:
   - [src/entrypoints/background.ts](file:///Users/ada/Downloads/glint-main/src/entrypoints/background.ts) 第 40-44 行注册了 `browser.commands?.onCommand.addListener`；
   - 收到命令后向当前 tab 发送 `{ kind: 'nav:step', delta }` 消息；
   - [src/entrypoints/content.ts](file:///Users/ada/Downloads/glint-main/src/entrypoints/content.ts) 监听该消息并触发 `nav?.step(message.delta)`；
   - [src/lib/keynav.ts](file:///Users/ada/Downloads/glint-main/src/lib/keynav.ts) 实现了在视口中遍历高亮 Token 并展开悬浮卡片的逻辑，同时监听原生 `Escape` 键关闭钉住卡片。
3. **平台冲突与体验裂痕**:
   - 在 macOS 系统中，`Alt+G` 对应硬件按键 `Option+G`。在大部分网页输入框或表单中，按下 `Option+G` 会直接输入版权符号 `©`，导致扩展快捷键无法被稳定拦截；
   - Safari 的 **Settings → Extensions** 面板检测到 `commands` 字段会自动渲染快捷键配置入口；
   - `README.md` 第 35 行写道：“可以在 `chrome://extensions/shortcuts` 里改键”，在 Safari 上属于严重误导信息。

#### 审计结论与处置建议
- **定性**: `SUPPORTED RUNTIME / FLAWED PLATFORM UX`。代码并非假实现（底层完整可跑），但在 macOS/Safari 上存在原生 `Option+G` 按键冲突且无快捷改键页面。
- **Action**: **`REMOVE (from Manifest)`** 或 **`DOCUMENT`**。
  - **推荐方案 (RECOMMENDED)**：从 Safari 构建的 Manifest 中移除 `commands` 声明，彻底消除 Safari Extension 系统设置页中的失效配置展示；保留 `Escape` 键的原生 DOM 键盘关闭能力。
  - **文档修正**：彻底删除 `README.md` 中有关 `chrome://extensions/shortcuts` 的 Chrome 专属描述。

---

### 3.3 审计 Provider UI 与注册一致性

#### 代码事实检查
1. **Options 设置页 UI**:
   - [src/entrypoints/options/main.ts](file:///Users/ada/Downloads/glint-main/src/entrypoints/options/main.ts) 第 216 行通过 `PROVIDER_IDS` 动态渲染 Provider 卡片；
   - 当前 `PROVIDER_IDS` 严格受控于 [src/lib/types.ts](file:///Users/ada/Downloads/glint-main/src/lib/types.ts)：`['openai', 'deepseek', 'custom']`；
   - UI 表面**仅且仅有** 3 个卡片：OpenAI、DeepSeek、自定义接口，完全无未实现服务商假入口。
2. **Provider Registry 对齐**:
   - [src/lib/providers/registry.ts](file:///Users/ada/Downloads/glint-main/src/lib/providers/registry.ts) 内部仅注册了 `openai`、`deepseek`、`custom`；
   - `UI Provider list === Provider Registry === Supported Runtime Providers`，三者完全闭环。
3. **死代码与图标残留**:
   - `options/main.ts` 头部仍有：
     ```ts
     import anthropicIcon from '@lobehub/icons-static-svg/icons/anthropic.svg?raw';
     import geminiIcon from '@lobehub/icons-static-svg/icons/gemini-color.svg?raw';
     import ollamaIcon from '@lobehub/icons-static-svg/icons/ollama.svg?raw';
     ```
     并在 `const ICONS` 表中定义。这 3 个图标完全不会被索引，属于死代码。
4. **历史迁移兼容代码**:
   - [src/lib/settings.ts](file:///Users/ada/Downloads/glint-main/src/lib/settings.ts) 中的 `withDefaults`：
     - 将历史存储中的 `provider: 'anthropic'` 自动降级回退为 `'openai'`;
     - 将历史存储中的 `provider: 'compatible'` 平滑迁移为 `'custom'`;
     - 迁移历史单一 `model` 字段和旧 `baseURL`。

#### 审计结论与处置建议
- **定性**:
  - 当前 3 个 Provider UI：`SUPPORTED` (`KEEP`)；
  - `anthropicIcon` / `geminiIcon` / `ollamaIcon`：`DEAD CODE` (`REMOVE`)；
  - `withDefaults` 历史降级逻辑：`MIGRATION-ONLY` (`KEEP`)，绝不可误删。

---

### 3.4 审计 AI Redo / Regenerate

#### 代码事实检查
1. **卡片 UI 表面**:
   - 检查 [src/lib/card.ts](file:///Users/ada/Downloads/glint-main/src/lib/card.ts)：当单词已存在缓存时，卡片直接展现缓存文本，**完全没有渲染任何“重新生成”或 Redo 按钮**；
   - 仅在网络发生超时（Timeout）、中断（Abort）或报错（Error）时，卡片展示 `aiExplainBtn.textContent = '重试 AI 解释'`。
2. **区别界定**:
   - 网络错误重试（Error Retry）≠ 覆盖缓存的主动重新生成（AI Redo）。
   - 当前卡片未给用户暴露任何无效的 AI Redo 假交互。

#### 审计结论与处置建议
- **定性**: `INTENTIONALLY OMITTED / DEFERRED`。
- **Action**: **`DOCUMENT`**。保持当前卡片极简状态机，不在 UI 上添加多余控件。

---

### 3.5 审计 Markdown / Rich Text

#### 代码事实检查
1. **渲染实现**:
   - 所有 AI 流式增量均通过 Shadow DOM 原生 `chunkEl.textContent += delta` 写入；
   - 容器样式采用 CSS `white-space: pre-wrap` 保留模型生成的换行与空行；
   - 全项目 0 第三方 Markdown 解析依赖（零 `marked`, `remark`），从根源杜绝 XSS 逃逸和 WebKit 高频流式重排卡顿。
2. **设置项与 UI 排查**:
   - `options/index.html` 与 `popup/index.html` 均无 Markdown 切换开关，无 HTML 渲染选项。

#### 审计结论与处置建议
- **定性**: `INTENTIONALLY SIMPLIFIED`。
- **Action**: **`DOCUMENT`**。保持极简纯文本设计。

---

### 3.6 审计 Shadow DOM / iframe 边界

#### 代码事实检查
1. **扫描器边界**:
   - [src/lib/scanner.ts](file:///Users/ada/Downloads/glint-main/src/lib/scanner.ts) 中：
     - 第三方 Web Components / ShadowRoot 保持 Opaque（TreeWalker 绝不穿透，扩展自身卡片独立隔离在扩展 Shadow DOM 中）；
     - `iframe` 标签被列入 `OPAQUE_TAGS`，`window.top !== window.self` 阻断跨 frame 扫描。
2. **UI 与文档一致性**:
   - `options` 与 `popup` 均无“穿透 Shadow DOM”或“扫描 iframe”的虚假开关或说明。
   - `README.md` 与 `PRIVACY.md` 亦无夸大宣称。

#### 审计结论与处置建议
- **定性**: `INTENTIONALLY BOUNDED`。
- **Action**: **`DOCUMENT`**。

---

### 3.7 审计 Documentation (README & PRIVACY 冲突分析)

#### 1. README.md 冲突项清单
| 行号 | 现有文档描述 | 实际代码实现 | 冲突性质 | 修复方案 |
| :--- | :--- | :--- | :--- | :--- |
| **L10** | `已生成的释义可以导出到 Anki` | Anki 导出已被架构决议排除，点击为报错文案 | **功能已废弃 (破损承诺)** | 删除该句，仅保留“设置和词表可以备份成 JSON” |
| **L19-23** | 列出 Anthropic、OpenAI、Gemini、DeepSeek、Kimi、Ollama 等 11 家服务商 | 仅支持 OpenAI、DeepSeek、自定义接口 | **服务商列表严重夸大** | 修改为三家正式服务商说明 |
| **L27-35** | `可以在 chrome://extensions/shortcuts 里改键` | Safari 没有该 Chrome 设置页面，macOS 上 Option+G 冲突 | **平台描述错误** | 移除 Chrome 快捷键指引 |
| **L53** | `pnpm build` 打包到 `.output/chrome-mv3`，可在 `chrome://extensions` 加载 | Safari 版命令为 `pnpm build:safari`，输出到 `.output/safari-mv3` | **构建指引不匹配** | 更新为 Safari MV3 构建与运行指引 |

#### 2. PRIVACY.md 冲突项清单
| 行号 | 现有文档描述 | 实际代码实现 | 冲突性质 | 修复方案 |
| :--- | :--- | :--- | :--- | :--- |
| **L28** | `已生成的释义: AI 释义的结果，连同当时那句原文` | [src/lib/explanation-cache.ts](file:///Users/ada/Downloads/glint-main/src/lib/explanation-cache.ts) 严格只存储 `word`, `explanation`, `updatedAt`，严禁存入句子（已由单测 `CACHE-17` 保证） | **隐私保证与文档相反** (文档反向造假：代码更安全，文档写得不安全) | 修正为“仅存储生词原型及释义文本，绝不存储任何网页原文句子” |
| **L51** | 第三方服务商列表包含 Anthropic、Google、Kimi、Groq 等 | 仅支持 OpenAI、DeepSeek 与自定义接口 | **第三方名单陈旧** | 修正为当前支持的服务商清单 |
| **L80** | `通过 Chrome 应用商店条目页上的开发者邮箱联系` | 个人 Safari 专用版 | **分发渠道不匹配** | 修正为 GitHub 仓库 Issue/Discussions |

---

## 4. UI Feature Surface Matrix (全要素闭环矩阵)

| 功能特性 (Feature) | UI Surface | Runtime Implementation | Manifest Dependency | Documentation | 判定状态 (Status) | 建议动作 (Action) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **OpenAI Provider** | Options 卡片 / Key / 模型 | [src/lib/providers/openai-adapter.ts](file:///Users/ada/Downloads/glint-main/src/lib/providers/openai-adapter.ts) | `optional_host_permissions` | README / PRIVACY (需更新) | **SUPPORTED** | **KEEP** |
| **DeepSeek Provider** | Options 卡片 / Key / 模型 | [src/lib/providers/deepseek-adapter.ts](file:///Users/ada/Downloads/glint-main/src/lib/providers/deepseek-adapter.ts) | `optional_host_permissions` | README / PRIVACY (需更新) | **SUPPORTED** | **KEEP** |
| **Custom API Provider** | Options 卡片 / 地址 / 额外请求体 | [src/lib/providers/custom-adapter.ts](file:///Users/ada/Downloads/glint-main/src/lib/providers/custom-adapter.ts) | 动态用户手势申请 | README (需明确) | **SUPPORTED** | **KEEP** |
| **Anthropic Provider** | 无 (仅 main.ts 有未用图标) | 已彻底删除 | 无 | README / PRIVACY 仍宣称 | **REMOVED** | **REMOVE (Docs & Icons)** |
| **其他历史 Provider** | 无 (Gemini/Ollama 图标残留) | 仅 registry 报错与 settings 迁移 | 无 | README 仍宣称 | **EXCLUDED** | **CLEAN (Docs & Icons)** |
| **Settings 迁移兼容** | 无 (用户无感) | `withDefaults` / `migrateLegacyKey` | 无 | 无 | **MIGRATION-ONLY** | **KEEP** |
| **Anki 笔记导出** | Options `#exportAnki` / `#ankiNote` | 无有效实现 (报错桩函数) | 无 | README 仍在宣称 | **EXCLUDED** | **REMOVE (UI & Docs)** |
| **Safari 扩展快捷键** | Safari 系统扩展设置偏好页 | background `onCommand` + content `keynav` | `manifest.commands` (`Alt+G`) | README (宣称 Chrome 路径) | **FLAWED UX** | **REMOVE (Manifest & Docs)** |
| **Escape 键关闭卡片** | 原生键盘交互 | [src/lib/keynav.ts](file:///Users/ada/Downloads/glint-main/src/lib/keynav.ts) `onKeydown` | 无 | 无 | **SUPPORTED** | **KEEP** |
| **AI 重新生成 (Redo)** | 无假入口 (仅错误重试) | 命中缓存直接秒显 | 无 | 无 | **DEFERRED** | **DOCUMENT** |
| **Markdown / 富文本** | 无开关 | 纯原生 `textContent` + CSS | 无 | 无 | **SIMPLIFIED** | **DOCUMENT** |
| **Shadow DOM 穿透** | 无假开关 | Opaque 隔离 | 无 | 无 | **BOUNDED** | **DOCUMENT** |
| **iframe 扫描穿透** | 无假开关 | `OPAQUE_TAGS` 阻断 | 无 | 无 | **BOUNDED** | **DOCUMENT** |

---

## 5. M5-W12 Step 2 可执行清理方案

在后续 Step 2 中，将执行以下**精确、无风险**的清理工作（本 Step 1 严格不修改代码）：

### 任务 1：清理 Options 页面的 Anki 假 UI
- **目标文件**: [src/entrypoints/options/index.html](file:///Users/ada/Downloads/glint-main/src/entrypoints/options/index.html)
  - 删除 `#exportAnki` 按钮及 `#ankiNote` 提示文本。
- **目标文件**: [src/entrypoints/options/main.ts](file:///Users/ada/Downloads/glint-main/src/entrypoints/options/main.ts)
  - 删除 `import { toAnkiTSV, type AnkiRow } from '@/lib/anki'`；
  - 删除 `$('exportAnki').addEventListener('click', ...)` 及 `setAnkiNote` 函数。

### 任务 2：清理 Options 页面的废弃图标死代码
- **目标文件**: [src/entrypoints/options/main.ts](file:///Users/ada/Downloads/glint-main/src/entrypoints/options/main.ts)
  - 删除未被任何正式 Provider 引用的 `anthropicIcon`、`geminiIcon`、`ollamaIcon` import 及其在 `ICONS` 字典中的键值。

### 任务 3：清理 Manifest 中的 `commands` 快捷键声明
- **目标文件**: [wxt.config.ts](file:///Users/ada/Downloads/glint-main/wxt.config.ts)
  - 移除 `manifest.commands` 声明，使 Safari Extension 偏好设置中不再显示带有平台冲突的 Option 快捷键；
  - 保留 [src/lib/keynav.ts](file:///Users/ada/Downloads/glint-main/src/lib/keynav.ts) 中对 `Escape` 键的原生支持。

### 任务 4：修正 README.md
- 删除 Anki 导出宣称；
- 更新 AI 服务商列表为 OpenAI、DeepSeek、自定义接口；
- 移除 `chrome://extensions/shortcuts` 改键说明与 Chrome 构建指引，更新为 Safari MV3 规范。

### 任务 5：修正 PRIVACY.md
- 修正已生成释义的数据存储说明，强调“绝不存储原句”；
- 更新第三方服务商列表为当前支持的 3 家；
- 修正联系方式表述。

---

## 6. 基线健康度验证记录

在当前只读审计状态下，全量验证基线执行结果如下：

```text
pnpm test -- --run               -> 408 / 408 tests PASS (0 failed, 0 skipped, ~47.7s)
pnpm exec tsc --noEmit           -> PASS (0 errors, 0 warnings)
pnpm exec wxt build -b safari --mv3 -> PASS (Built in 471ms, total size 5.67 MB)
git diff --check                 -> PASS (0 formatting/whitespace errors)
```

Manifest 关键字段核实：
```json
{
  "permissions": ["storage", "activeTab"],
  "host_permissions": [],
  "optional_host_permissions": [
    "https://api.openai.com/*",
    "https://api.deepseek.com/*"
  ]
}
```
`host_permissions = []` 保持严格为空，完全符合 Safari 最小权限安全规范。

---

## 7. Step 2 实施完成与验证记录 (Step 2 Implementation Results)

Step 2 已针对 Step 1 审计发现的问题全部实施完成，具体状态如下：

- **Anki UI**: `REMOVED`
  - 移除了 `src/entrypoints/options/index.html` 中的 `#exportAnki` 按钮与 `#ankiNote` 提示段落；
  - 移除了 `src/entrypoints/options/main.ts` 中的事件监听器、`setAnkiNote` 函数、`loadDict` 悬空加载与 `toAnkiTSV` import；
  - 移除了 `README.md` 中的 Anki 导出宣称。
- **Safari manifest commands**: `REMOVED`
  - 移除了 `wxt.config.ts` 中的 `manifest.commands` (`next-word`, `prev-word`) 声明；
  - 清理了 `src/entrypoints/background.ts` 中的 `onCommand` 监听；
  - 构建产物 `.output/safari-mv3/manifest.json` 中已完全无 `commands` 字段，彻底消除了 Safari Extension 设置中的 Option 键位冲突展示；
  - 原生 `Escape` 键收起卡片交互完整保留在 `src/lib/keynav.ts`。
- **Historical Provider icons**: `REMOVED`
  - 清理了 `src/entrypoints/options/main.ts` 中废弃的 `anthropicIcon`、`geminiIcon`、`ollamaIcon` import 及其在 `ICONS` 中的死代码映射；
  - 当前 Options UI 仅保留正式的 `openai`、`deepseek` 图标，`custom` 使用原生插头 SVG。
- **README**: `CORRECTED`
  - 删除了 Anki 导出宣称；
  - 服务商名单更新为正式的 OpenAI、DeepSeek 与自定义接口（OpenAI-compatible Chat Completions 协议）；
  - 删除了 `chrome://extensions/shortcuts` 描述，更新为 Safari 键盘交互规范；
  - 构建命令与产物路径由 `.output/chrome-mv3` 更新为 `.output/safari-mv3`。
- **PRIVACY**: `CORRECTED`
  - 纠正了 AI 缓存描述，明确指出仅存储生词原型及纯文本释义，绝不持久化任何网页原文句子或上下文；
  - 第三方服务商名单同步更新为正式 3 家；
  - 联系方式更新为 GitHub Issue / Discussions。
- **Migration-only Provider compatibility**: `PRESERVED`
  - [src/lib/settings.ts](file:///Users/ada/Downloads/glint-main/src/lib/settings.ts) 中的 `withDefaults` 历史降级与迁移逻辑（`anthropic` -> `openai`，`compatible` -> `custom`）严格保留。
- **Core Provider runtime**: `UNCHANGED`
  - OpenAI / DeepSeek / Custom 适配器、流式解包、Extra Body JSON 校验、本地离线词库、Native TTS 等核心运行时完全未作任何修改。

### 实际修改文件清单
1. `src/entrypoints/options/index.html` (删除 Anki UI 元素)
2. `src/entrypoints/options/main.ts` (删除 Anki 监听、废弃图标 import)
3. `src/entrypoints/background.ts` (删除 onCommand 监听)
4. `wxt.config.ts` (删除 manifest.commands 声明)
5. `README.md` (纠偏功能宣称、服务商列表与构建路径)
6. `PRIVACY.md` (纠偏原句缓存描述、服务商列表与联系方式)
7. `tests/ui-surface.test.ts` (新增针对性 UI/Manifest/Migration 回归测试)
8. `docs/ui-feature-surface-audit.md` (更新审计与实施记录)
