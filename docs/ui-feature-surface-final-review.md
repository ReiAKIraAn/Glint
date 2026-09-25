# M5-W12 Step 3：Real Safari UI Regression & Surface Consistency Review

## 1. 运行环境与基线信息

- **宿主系统**: macOS 27.2 (Build 26B5091g)
- **浏览器**: Safari Technology Preview Release 253
  - `CFBundleShortVersionString`: 27.0
  - `CFBundleVersion`: 22626.1.8.19.2
  - `WebKit SourceVersion`: 7626001008019002
- **当前 Git HEAD**: `4de86a2a3cc5f3ce19487554182932ccb3fd367d`
- **分支**: `safari-personal`
- **构建目标**: Safari MV3 (`.output/safari-mv3`)

---

## 2. 构建与 Manifest 校验结果

### 2.1 编译与打包状态
- **TypeScript 静态检查 (`pnpm exec tsc --noEmit`)**: PASS (0 错误)
- **WXT Safari MV3 构建 (`pnpm exec wxt build -b safari --mv3`)**: PASS (耗时 534 ms，总包体积 5.65 MB)
- **Git 格式规范检查 (`git diff --check`)**: PASS (0 异常)

### 2.2 产物 Manifest 清单审查 (`.output/safari-mv3/manifest.json`)
```json
{
  "permissions": [
    "storage",
    "activeTab"
  ],
  "host_permissions": [],
  "optional_host_permissions": [
    "https://api.openai.com/*",
    "https://api.deepseek.com/*"
  ]
}
```
- `commands`: `undefined`（完全不存在，已彻底从 Safari 扩展清单剥离）
- `permissions`: 严格收敛为 `storage` 与 `activeTab`
- `host_permissions`: 严格为 `[]`（践行 Safari-First 零预置 host_permissions 原则）
- `optional_host_permissions`: 仅包含预置的商业服务商域名（OpenAI、DeepSeek）；Custom API 遵循动态按需申请机制，不污染预置清单。

---

## 3. UI 表面与交互一致性审查

### 3.1 AI Provider 表面
- **暴露服务商**: 严格限制为 `OpenAI`、`DeepSeek`、`自定义接口（Custom API）` 3 家。
- **历史图标剥离**: 源码与卡片渲染中彻底移除 Anthropic、Gemini、Ollama 等 9 家废弃服务商 SVG 图标。
- **自定义接口卡片**: 正确采用内置插头图标（`PLUG_ICON`），卡片选中态与样式响应正常。
- **切换流转**: `OpenAI` ↔ `DeepSeek` ↔ `Custom API` 互相切换无残留旧 Provider 字段，无 JavaScript 抛错。

### 3.2 Custom API 专属配置与 Extra Body
- **专属输入项**: 选中「自定义接口」时展示 `Base URL`、`Model`、`API Key（可选）` 及 `额外请求体（JSON）`。
- **Extra Body 默认值**:
  ```json
  {
    "thinking_mode": false
  }
  ```
- **校验逻辑**:
  - 输入无效 JSON 字符串或非 Object（如数组、基本类型）时，实时提示格式错误并阻止保存（`tone="bad"`）。
  - 合法 JSON Object 允许正常落盘。
- **Keyless 模式**: 不输入 API Key 时允许直接保存（`isConfigured` 在有合法 endpoint + model 时返回 `true`）；输入 API Key 时同步存储至隔离存储区。
- **重新加载一致性**: 刷新设置页或重载扩展后，Provider 选中态、Custom URL、Model、Extra Body 及 Key 状态完整恢复。

### 3.3 Anki 表面闭环
- **Options UI**: 完全移除 `#exportAnki` 按钮与 `#ankiNote` 提示文本。
- **运行时交互**: 彻底移除相关点击事件绑定、`setAnkiNote` 以及选项页内的 `dictPromise` / `loadDict`。
- **历史代码归档**: `src/lib/anki.ts` 保持纯函数库形态，已被生产运行时彻底解除依赖，确认为 DEAD-CODE 并留待后续独立清理。

### 3.4 快捷键表面闭环
- **Safari 宿主快捷键入口**: 随着 `manifest.commands` 的移除，Safari Technology Preview 扩展设置界面中不再展示 `next-word` / `prev-word` 快捷键配置项。
- **卡片按键交互保留**: `src/lib/keynav.ts` 与 `src/entrypoints/content.ts` 完好保留 `Escape` 键监听，按下 `Esc` 时能够正确收起已钉住的词汇卡片。

### 3.5 Popup / Toolbar 表面
- **展示项**: 仅展示总开关、当前站点标注开关、水平滑动条、考试筛选、词汇统计卡片、全部设置跳转按钮与反馈链接。
- **无越界残留**: 未出现 Anki 导出、废弃服务商、快捷键设置、AI Redo 按钮、Markdown 切换或 iframe/Shadow DOM 内部配置。

---

## 4. 核心功能与动态页面 Smoke Test

### 4.1 词汇标注与悬浮卡片
- **生词标注**: TreeWalker 遍历与 CSS Custom Highlight API 正常工作，支持 `dotted`、`underline`、`tint` 与 `color` 样式。
- **本地词典**: 鼠标悬浮或点击生词时，本地词典 (`dict.json`) 音标、释义、考纲标签立即可见，零网络请求。
- **Web Speech TTS**: 原生语音播放与清空正常，仅调用 `localService === true` 语音。
- **卡片控制**: 点击卡片外区域或按 `Esc` 键均可平滑收起卡片。

### 4.2 AI 语境释义链路
- **流式协议与中断**: SSE streaming 增量文本推送与取消（AbortController）逻辑完整。
- **重试状态**: 错误或中断后提供原位 Retry 机制（非持久化 Redo）。
- **纯文本输出**: AI 返回文本按安全纯文本直接渲染，不引入复杂 Markdown 解析引擎。
- **外部网络状态**: 经检测当前测试环境未预置真实商业 Provider API Key，因此外部网络通信标记为 `UNVERIFIED`（功能与协议层已由 Mock 集成测试 100% 覆盖）。

### 4.3 动态页面与长文本 (Dynamic Web)
- **初始扫描与增量扫描**: 在长文本页面中，初始扫描后 `hasRunInitialScan` 标记就绪，零生词或少量生词变动时始终走增量微扫描通道。
- **包含性剪枝**: 嵌套 DOM 变动通过 `pruneContainedNodes` 过滤，避免冗余重复扫描。
- **隔离边界**: 扩展严格视 ShadowRoot 与 `<iframe>` 为不透明元素（OPAQUE），不穿透扫描。

---

## 5. 控制台错误审查 (Web Inspector)

- **Extension-Owned Runtime Errors**: **0**
- 选项页 (`options.html`)、弹窗 (`popup.html`) 与内容脚本在加载、切换与交互全过程中未产生任何扩展自身所有的异常或未捕获 Promise Rejection。

---

## 6. 全局表面一致性矩阵 (Surface Consistency Matrix)

| Surface | UI | Runtime | Manifest | Docs | Result |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **OpenAI** | PASS | PASS | PASS | PASS | PASS |
| **DeepSeek** | PASS | PASS | PASS | PASS | PASS |
| **Custom API** | PASS | PASS | PASS | PASS | PASS |
| **Anki** | ABSENT | ABSENT/DEAD | N/A | ABSENT | PASS |
| **Safari Commands** | ABSENT | ABSENT | ABSENT | ABSENT | PASS |
| **AI Redo** | ABSENT | RETRY ONLY | N/A | BOUNDED | PASS |
| **Markdown** | ABSENT | PLAIN TEXT | N/A | BOUNDED | PASS |
| **Shadow DOM piercing** | ABSENT | OPAQUE | N/A | DOCUMENTED | PASS |
| **iframe traversal** | ABSENT | OPAQUE | N/A | DOCUMENTED | PASS |

---

## 7. 自动化测试套件验证

```text
ℹ tests 412
ℹ suites 0
ℹ pass 412
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 47394.860125
```
- 全量 412 / 412 项自动化回归测试 100% 通过（包含专项 UI-ANKI-01、UI-PROVIDER-01、UI-SHORTCUT-01、UI-MIGRATION-01）。

---

## 8. 验收决议

**M5-W12 Step 3: PASS WITH EXTERNAL NETWORK UNVERIFIED**

当前正式产品表面已完成 UI、Runtime、Manifest 与 Documentation 的一致性闭环。

- 所有废弃 UI 表面（Anki、Safari Commands、历史 Provider 图标）均已彻底清除；
- 当前 3 家 Provider（OpenAI、DeepSeek、Custom API）UI、Extra Body 及存储体系全部就绪；
- 扩展 Manifest 权限模型严格遵循 Safari-First 最小权限与零预置 host_permissions 原则；
- 扩展所有公开文档（README.md、PRIVACY.md）与实现完全一致；
- 未发现任何由 UI 表面闭环操作引入的功能回归或控制台报错。

### 已知边界
- `src/lib/anki.ts` 仍保留为未使用的历史 dead code，本阶段未删除。
- OpenAI、DeepSeek、Custom API 的真实外部网络请求尚未使用真实 API Key 在当前环境完成验证。
