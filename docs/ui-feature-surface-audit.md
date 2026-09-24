# M5-W11 UI Feature Surface Closure Audit

> **性质**: 只读深度审计 (`src/` 生产代码 0 修改)  
> **当前基准 Commit**: `f0ecb761fefa1222a3e8624d34b869ff7c3896e5`  
> **长期冻结 Tag**: `v1.0.0-safari-personal` (`50bd22ea1214f9edaa8e24cd798ea4258ade2ea0`)  
> **目标**: 完成“实际功能能力 ↔ 用户可见 UI”闭环审计，排查所有不属于当前 Safari Personal Edition 范围但在 UI、配置、文档中暴露的残留入口，形成可执行的 Step 2 清理方案。

---

## 1. Executive Summary (执行摘要)

Glint Safari Personal Edition 的核心功能开发与技术基线已经确立。但在经过从上游 Chrome 版本向 Safari Personal Edition 的多轮裁剪演进后，代码库中仍残留部分“功能已被舍弃或延后、但 UI 入口依然向用户暴露”的表面（Surface）。

本次审计对全项目进行了只读排查，涵盖：
1. **设置面板 (Options UI)**：HTML 结构、Tab、卡片、按钮、说明文案；
2. **工具栏弹窗 (Popup UI)**：控件、开关、说明文案；
3. **生词卡片 (Hover Vocabulary Card)**：按钮状态机、Shadow DOM 内部结构；
4. **Manifest / Safari Extension 配置界面**：`commands` 快捷键声明；
5. **项目文档与外部宣称**：`README.md`、`PRIVACY.md` 与相关文档。

### 核心审计发现 (Core Findings)
1. **Anki 导出残留在设置页面**: 按钮 `#exportAnki` 与提示文案 `#ankiNote` 仍存在于设置页，点击仅弹窗显示错误提示，且 `README.md` 仍宣称支持导出。
2. **11 个未实现服务商暴露在设置面板**: 设置面板通过遍历 `PROVIDER_IDS` 渲染了 12 个服务商卡片（包括 OpenAI, Gemini, DeepSeek, Ollama 等），但底层 `ProviderRegistry` 仅实现了 `anthropic`，用户选择并保存其他服务商后触发运行时异常。
3. **Safari 快捷键配置由 Manifest `commands` 显式引入**: `wxt.config.ts` 声明了 `Alt+G` / `Alt+Shift+G`，导致 Safari Extension 设置页向用户展示快捷键配置，且与 macOS Option 键输入机制存在平台冲突。
4. **AI Redo 与 Markdown 未暴露假 UI**: 卡片内部在缓存命中时不展示重新生成按钮（已符合纯展示决策）；AI 文本使用原生 `textContent` 与 `pre-wrap` 渲染，无 Markdown 假开关。

---

## 2. Current Product Principles & Baseline (当前产品原则与基线)

### 2.1 实际已实现能力 (Implemented)
- CEFR 生词分词与扫描（A1~C2 难度过滤、词形还原、代码/专有名词过滤）
- 四种标注样式：`dotted` (虚线), `underline` (下划线), `tint` (底色), `color` (文字变色: Light `#D9622B`, Dark `#FF9A5C`)
- 熟词消词标记与过滤（“✓ 认识”全站消词）
- 220ms 悬停 Shadow DOM 生词卡片与 `caretPositionFromPoint` 光标反查
- 本地离线词典查询（音标、考试标签、中文释义）
- 原生 Web Speech API 离线发音（严格筛选 `localService === true`）
- 单一服务商 BYOK: Anthropic（Request Header 鉴权、密钥不出前台）
- SSE 增量推流打字机（rAF 批量合并渲染、纯 `textContent` 安全防 XSS）
- AI 请求用户主动取消（UI 取消按钮 + Port `AI_ABORT` + AbortController 中止）
- AI 释义本地持久化缓存（2,000 条 LRU，同词二次秒显，零敏感上下文存盘）
- 动态网页增量扫描（嵌套子树包含裁剪、零词增量防护、250 突变全量回退兜底）
- Safari 单域动态权限管理（最小权限原则，用户手势发起与回收）
- 工具栏 Popup 弹窗（实时生词计数、总开关、当前站点黑名单切换）

### 2.2 有意设计边界 (Intentionally Bounded)
- **第三方 Shadow DOM**: 保持 opaque，TreeWalker 绝不穿透，保障 Web Components 封装。
- **iframe 浏览上下文**: 保持 opaque，`window.top !== window.self` 与 `OPAQUE_TAGS` 阻断，不跨 Frame 扫描。

### 2.3 明确排除能力 (Intentionally Excluded)
- **Anki 笔记导出**: 用户决议 D3=NO，保护隐私绝不持久化网页原句，彻底禁用导出。

### 2.4 当前未实现 / 延后特性 (Deferred / Not Implemented)
- **AI 缓存重新生成 (Redo)**: 缓存命中后仅展示释义，无直接强制重新生成入口。
- **第二 AI Provider**: 架构已通过 `ProviderAdapter` 解耦，但当前未实现 Anthropic 之外的第二个 Provider。
- **Markdown / Rich Text AI 排版**: 保持原生 plain text 流式追加，不引入 Markdown 解析库。

### 2.5 平台限制 (Platform Limitations)
- macOS Option 键快捷键冲突。
- Safari WebExtension `browser.commands` 机制在 macOS Safari 上的支持与配置行为。

---

## 3. Dedicated Deep Dives (专项深度剖析)

### 3.1 Deep Dive 1: Safari Extension Shortcut & Manifest `commands`

#### 来源追溯
- **声明源头**: [`wxt.config.ts`](file:///Users/ada/Downloads/glint-main/wxt.config.ts#L60-L69)
  ```ts
  commands: {
    'next-word': {
      suggested_key: { default: 'Alt+G' },
      description: '跳到下一个标注的词',
    },
    'prev-word': {
      suggested_key: { default: 'Alt+Shift+G' },
      description: '跳到上一个标注的词',
    },
  }
  ```
- **构建输出**: `.output/safari-mv3/manifest.json` 中包含 `"commands": { "next-word": ..., "prev-word": ... }`。
- **浏览器表现**: Safari Technology Preview 在 **Settings → Extensions** 面板中检测到 manifest 的 `commands` 字段，因此自动为 Glint 生成快捷键配置界面。
- **事件监听链路**:
  1. `src/entrypoints/background.ts` 第 42-46 行监听 `browser.commands?.onCommand.addListener`；
  2. 向当前活跃标签页分发 `{ kind: 'nav:step', delta }`；
  3. `src/entrypoints/content.ts` 接收该消息并调用 `nav?.step(message.delta)`；
  4. `src/lib/keynav.ts` 中的 `createWordNav` 计算光标位置，调用 `centerOn` 滚动视口并调用 `hover.pin(token)`。

#### 存在的问题与冲突
1. **平台按键冲突**: 在 macOS 系统中，`Alt+G` 映射为 `Option+G`。在绝大多数文本输入区域（输入框、编辑器、终端），按下 `Option+G` 会直接输入特殊符号 `©`，无法被浏览器扩展拦截；在页面上按也极易与系统级输入法冲突。
2. **README 误导**: `README.md` 写明 `可在 chrome://extensions/shortcuts 里改键`，这在 macOS Safari 环境下完全不存在。
3. **定位与产品范围**: Safari Personal Edition 核心场景是沉浸式鼠标阅读。键盘遍历生词并未在 Safari TP 中做完整跨页面适配。

#### 推荐方案
- **评估决议**: 建议将 `commands` 移出 Safari manifest，或在 Step 2 中正式清理。若移出，Safari Extension 设置页将不再显示快捷键配置入口；`content.ts` 中针对已钉住卡片的 `Escape` 键盘关闭逻辑（原生 DOM 事件）不受影响。

---

### 3.2 Deep Dive 2: Anki Export Full Lifecycle Trace

#### 现状全链路追踪
```text
UI 按钮: options/index.html (#exportAnki)
   │
   ├──> 文案承诺: options/index.html (#ankiNote: "存成一个文本文件，在 Anki 里点 Import File 选中它...")
   │
   ├──> 点击事件: options/main.ts (L747: $('exportAnki').addEventListener('click', ...))
   │       │
   │       └──> 虚假反馈: setAnkiNote('Safari Personal Edition 暂不支持导出到 Anki。', 'bad')
   │
   ├──> 死代码残留:
   │       ├── options/main.ts (L47: import { toAnkiTSV, type AnkiRow } from '@/lib/anki')
   │       ├── options/main.ts (L740: function loadDict() - 未被实际调用)
   │       ├── src/lib/anki.ts (完整导出算法文件 - 生产环境孤立)
   │       └── tests/anki.test.ts (相关测试套件 - 脱离生产数据流)
   │
   └──> 外部宣称: README.md (L10: "已生成的释义可以导出到 Anki")
```

#### 判定与影响
- **状态**: **INTENTIONALLY EXCLUDED (明确排除)**，但 **UI SURFACE EXPOSED (界面暴露假功能)**。
- 用户在设置页面看到醒目的“导出到 Anki”主按钮和长段使用指引，点击后却弹出红色报错文案，构成典型的“假 UI / 破损功能”。
- **推荐方案 (Step 2 MUST FIX)**:
  1. 从 `options/index.html` 移除 `#exportAnki` 按钮与 `#ankiNote` 提示说明；
  2. 从 `options/main.ts` 移除 `exportAnki` 点击事件、`setAnkiNote`、未使用的 `toAnkiTSV` 引用与 `loadDict` 悬空函数；
  3. 从 `README.md` 移除对 Anki 导出的功能宣称；
  4. `src/lib/anki.ts` 与 `tests/anki.test.ts` 可作为无副作用工具库保留或归档，不阻断运行。

---

### 3.3 Deep Dive 3: Second Provider & Provider Selector

#### 现状全链路追踪
- **UI 入口**: `options/index.html` 第 141 行 `<div class="providers" id="providerCards"></div>`。
- **渲染代码**: `options/main.ts` 第 213 行：
  ```ts
  function renderProviderCards() {
    $('providerCards').innerHTML = PROVIDER_IDS.map((id) => {
      const spec = PROVIDERS[id];
      return `<button type="button" class="pcard" data-provider="${id}">...`;
    }).join('');
  }
  ```
- **涉及服务商**: `PROVIDER_IDS` 包含 **12 家**：
  `anthropic`, `openai`, `google`, `openrouter`, `opencode`, `siliconflow`, `deepseek`, `moonshot`, `zhipu`, `groq`, `ollama`, `compatible`。
- **底层注册表**: `src/lib/providers/registry.ts`：
  ```ts
  const REGISTRY = new Map<Provider, ProviderAdapter>([
    ['anthropic', anthropicAdapter],
  ]);
  ```
- **实际后果**:
  用户在设置页面能够自由选择 OpenAI、Gemini、DeepSeek 等并保存 Key（还会成功触发单域权限申请弹窗）。但在阅读页面点击“✨ AI 解释”时，后台 `getProviderAdapter(provider)` 抛出 `UnsupportedProviderError: Provider "..." is not supported`，导致卡片报错并阻断。

#### 判定与影响
- **状态**: **DEFERRED / NOT IMPLEMENTED (延后未实现)**，但 **UI SURFACE EXPOSED (界面暴露 11 个未实现项)**。
- 这不仅是误导性 UI，而且允许用户产生无效的存储与权限申请。
- **推荐方案 (Step 2 MUST FIX)**:
  - 方案 A（推荐）：`renderProviderCards()` 中基于 `hasProviderAdapter(id)` 过滤，仅渲染当前已注册支持的服务商（即当前仅展示 Anthropic 卡片）。
  - 方案 B：对未支持的服务商卡片添加 `disabled` 属性并注明“暂未适配”，阻止选中保存。

---

### 3.4 Deep Dive 4: AI Redo / Regenerate

#### 检查结果
- **卡片按钮排查**:
  - `src/lib/card.ts` 内部仅有：
    - `speakBtn` (发音小喇叭)
    - `aiExplainBtn` (✨ AI 解释 / 重试 AI 解释)
    - `aiCancelBtn` (取消)
    - `knownBtn` (✓ 认识)
- **缓存命中行为**:
  - 在 `card.ts` 第 403-417 行：当 `cached` 命中时，卡片直接将缓存文本填入 `aiTextEl`，并将 `aiExplainBtn.hidden = true`，`aiCancelBtn.hidden = true`。
  - 缓存命中状态下**完全没有渲染任何重新生成按钮**。
- **异常重试行为**:
  - 仅在网络出错或超时熔断时，`aiExplainBtn.textContent = '重试 AI 解释'`。这是错误重试，非覆盖缓存的 Redo。
- **判定**: **NO UNWANTED UI (无残留假 UI)**。
  - AI Redo 未在 UI 上产生无效按钮，现状符合预期。

---

### 3.5 Deep Dive 5: Rich Text / Markdown

#### 检查结果
- **设置页排查**: `options/index.html` 无任何 Markdown 开关、富文本切换器或 HTML 解析选项。
- **卡片渲染排查**: `card.ts` 纯粹采用原生 `textContent` 追加流式块，样式为 `white-space: pre-wrap; word-break: break-word;`。
- **判定**: **NO UNWANTED UI (无残留假 UI)**。
  - 文本流式处理纯粹且无富文本假设置。

---

### 3.6 Deep Dive 6: Architectural Boundaries (Shadow DOM & iframe)

#### 检查结果
- **设置与交互排查**: 选项页与 Popup 零 Shadow DOM / iframe 穿透配置开关。
- **用户心智**: 边界策略完全作为后台静默安全与封装机制运行。
- **判定**: **DOCUMENT ONLY (纯文档说明)**。
  - 不需要提供 UI 配置，保持现状即可。

---

## 4. UI Feature Matrix (全景界面功能矩阵)

| 功能项 (Feature) | 实际功能能力 (Actual Capability) | 用户可见入口 (UI Surface) | 当前 UI 状态 (Current Status) | 处理建议 (Recommended Action) | 优先级 |
| :--- | :--- | :--- | :---: | :--- | :---: |
| **CEFR 等级滑动条** | A1~C2 分级扫描与标注过滤 | Options 页面、Popup 弹窗 | A. IMPLEMENTED | **KEEP** (保留) | - |
| **考纲静音下拉框** | 中考~考研已过考试过滤 | Options 页面、Popup 弹窗 | A. IMPLEMENTED | **KEEP** (保留) | - |
| **备考模式下拉框** | 四六级/考研/托福/雅思/GRE 交集 | Options 页面、Popup 弹窗 | A. IMPLEMENTED | **KEEP** (保留) | - |
| **标注样式四选一** | 虚线、下划线、底色、文字变色 | Options 页面单选卡片 | A. IMPLEMENTED | **KEEP** (保留) | - |
| **全站标注总开关** | 一键关闭/启用高亮 | Options 页面、Popup 弹窗 | A. IMPLEMENTED | **KEEP** (保留) | - |
| **单页只标一次开关** | 首次出现标注 | Options 页面开关 | A. IMPLEMENTED | **KEEP** (保留) | - |
| **生僻词标注开关** | 词库外生僻词标注控制 | Options 页面开关 | A. IMPLEMENTED | **KEEP** (保留) | - |
| **站点黑名单管理** | 当前域名一键排除、列表移除 | Options 列表、Popup 站点开关 | A. IMPLEMENTED | **KEEP** (保留) | - |
| **Anthropic BYOK** | 凭据管理、单域鉴权、模型拉取 | Options AI 卡片、输入框 | A. IMPLEMENTED | **KEEP** (保留) | - |
| **思考强度选择器** | low/medium/high 推流控制 | Options 下拉框 | A. IMPLEMENTED | **KEEP** (保留) | - |
| **已认识生词管理** | 单词移除、全部清空 | Options 列表与清空按钮 | A. IMPLEMENTED | **KEEP** (保留) | - |
| **AI 释义缓存管理** | 单条删除、全部清空 | Options 列表与清空按钮 | A. IMPLEMENTED | **KEEP** (保留) | - |
| **数据备份与导入** | JSON 格式导出与合并导入 | Options 导出/导入按钮 | A. IMPLEMENTED | **KEEP** (保留) | - |
| **生词卡片发音** | 原生 Web Speech 离线朗读 | 卡片小喇叭按钮 | A. IMPLEMENTED | **KEEP** (保留) | - |
| **生词标记已认识** | 消除标注并落盘 | 卡片“✓ 认识”按钮 | A. IMPLEMENTED | **KEEP** (保留) | - |
| **AI 解释与取消** | SSE 推流与主动 Abort | 卡片“✨ AI 解释” / “取消” | A. IMPLEMENTED | **KEEP** (保留) | - |
| **Anki 笔记导出** | **明确有意排除 (D3=NO)** | Options `#exportAnki` 按钮与文案 | **C. EXCLUDED (EXPOSED)** | **REMOVE** (彻底移除假入口) | **MUST FIX** |
| **未实现服务商 (11家)**| **延后未实现 (仅 Anthropic)** | Options 11 张服务商卡片 | **D. DEFERRED (EXPOSED)** | **HIDE / REMOVE** (过滤仅留有效项)| **MUST FIX** |
| **Safari 扩展快捷键** | **平台冲突 / 缺少支持** | Safari Extension 系统设置页 | **D. DEFERRED (EXPOSED)** | **REMOVE commands** (消除系统页配置)| **P1** |
| **README Anki 宣称** | **明确有意排除** | `README.md` 第 10 行 | **C. EXCLUDED (PROMISED)** | **REMOVE** (修正文档表述) | **MUST FIX** |
| **README 快捷键宣称**| **Safari 不适用** | `README.md` 键盘章节 | **D. DEFERRED (INCORRECT)**| **UPDATE / REMOVE** (移除 Chrome 说明)| **P1** |
| **README 预置服务商**| **仅 Anthropic 可用** | `README.md` AI 章节 | **D. DEFERRED (INCORRECT)**| **UPDATE** (明确仅支持 Anthropic)| **P1** |
| **AI 重新生成 (Redo)** | **延后未实现** | 卡片 (已隐藏) | D. DEFERRED | **NO CHANGE** (卡片无多余 UI) | - |
| **Markdown / 富文本** | **简化为纯文本** | 设置页/卡片 (无入口) | D. DEFERRED | **NO CHANGE** (保持原生纯文本) | - |
| **第三方 Shadow DOM** | **有意边界 (Opaque)** | 无 UI 入口 | B. BOUNDED | **DOCUMENT ONLY** (文档记录即可) | - |
| **iframe 浏览上下文** | **有意边界 (Opaque)** | 无 UI 入口 | B. BOUNDED | **DOCUMENT ONLY** (文档记录即可) | - |

---

## 5. UI Status Classification (四类 UI 状态归类)

### A. IMPLEMENTED (真实存在且应保留)
- 标注配置：水平滑动条、已过考纲、备考目标、样式四选一、行为开关、站点黑名单。
- 数据管理：已认识词列表及清空、已生成释义列表及清空、JSON 备份与恢复。
- 卡片操作：离线发音小喇叭、✓ 认识消词、✨ AI 解释、推流取消、异常重试。
- 弹窗操作：标注总开关、当前站点开关、水平滑块、考纲选择、直达设置。

### B. INTENTIONALLY BOUNDED (有意边界 / DOCUMENT ONLY)
- **第三方 Shadow DOM 隔离**: 不提供穿透设置，无 UI，文档保留说明。
- **iframe 隔离**: 不提供穿透设置，无 UI，文档保留说明。

### C. INTENTIONALLY EXCLUDED (明确排除 / REMOVE)
- **Anki 笔记导出**:
  - `options/index.html` 中的 `#exportAnki` 按钮与 `#ankiNote` 提示段落。
  - `options/main.ts` 中的点击监听与悬空代码。
  - `README.md` 中关于导出的宣称。

### D. DEFERRED / NOT IMPLEMENTED (延后未实现 / HIDE 或 REMOVE)
- **未支持的 11 家 Provider 卡片**: 在设置页通过 `hasProviderAdapter` 过滤，避免用户误选报错。
- **Manifest commands 声明**: 避免在 Safari 设置中误导用户配置不可靠的 Option 组合键。
- **README 中的 Chrome 专属功能描述**: 移除 `chrome://extensions/shortcuts`、全量服务商列表与 `.output/chrome-mv3` 说明。

---

## 6. Actionable Closure Plan (Step 2 可执行清理计划)

### 6.1 MUST FIX 项 (必须在 Step 2 处理)
1. **清理设置页 Anki 假 UI**:
   - 目标文件: `src/entrypoints/options/index.html`, `src/entrypoints/options/main.ts`
   - 操作: 删除 `#exportAnki` 按钮及 `#ankiNote` 节点；清理 `main.ts` 中的事件监听器与悬空 `loadDict` 代码。
2. **收敛设置页服务商列表 (Provider Selector)**:
   - 目标文件: `src/entrypoints/options/main.ts`
   - 操作: `renderProviderCards()` 中引入 `hasProviderAdapter(id)` 过滤，仅渲染当前具备适配器的服务商（即仅展示 Anthropic），防止选择无效 Provider。
3. **纠正 README.md 宣称与平台描述**:
   - 目标文件: `README.md`, `PRIVACY.md`
   - 操作: 删除 Anki 导出说明；将服务商列表明确标注为 Anthropic (BYOK)；清理 Chrome 专有路径描述。

### 6.2 建议处理项 (P1 / Step 2 建议同步处理)
1. **评估并清理 Manifest `commands`**:
   - 目标文件: `wxt.config.ts`
   - 操作: 在 Safari 构建中禁用 `manifest.commands` 导出，彻底消除 Safari Extension 偏好设置中的快捷键配置项。

### 6.3 保持不变项 (NO CHANGE)
- 卡片内部逻辑与布局保持不变（AI Redo、Markdown 无假 UI，TTS 与 AI Abort 交互健康）。
- Popup 界面保持不变（所有控件均有真实能力支撑）。
- 核心扫描器、缓存、权限逻辑严格不修改。

---

## 7. Verification & Evidence Status (验证与证据状态)

### 7.1 本地工程健康度验证
- **TypeScript 类型检查 (`pnpm exec tsc --noEmit`)**: **PASS** (0 errors)
- **全量自动化测试 (`pnpm test -- --run`)**: **385 / 385 PASS** (0 failed, 0 skipped, 耗时 46.29s)
- **Safari 生产构建 (`pnpm exec wxt build -b safari --mv3`)**: **PASS** (产物 5.92 MB)
- **代码格式与 Git Diff 检查 (`git diff --check`)**: **PASS** (0 whitespace/conflict 异常)

### 7.2 证据状态划分 (Evidence Reality)
- **VERIFIED (已实机/代码核验)**:
  - 选项页 Anki 按钮点击确为无效假提示 (`setAnkiNote` 固化报错文本)；
  - 选项页当前无条件渲染 12 家 Provider 卡片，且选择非 Anthropic 后确会由于 `UnsupportedProviderError` 抛错；
  - Manifest `commands` 确由 `wxt.config.ts` 生成并打包进入产物 `manifest.json`；
  - 卡片中无 AI Redo 或 Markdown 假控件。
- **UNVERIFIED (未独立验证项)**:
  - Safari Technology Preview 偏好设置中系统生成的快捷键在不同 macOS 辅助功能设定下的底层拦截顺序与表现。

---

## 8. Audit Outcome & Readiness

- **UI AUDIT RESULT**: `PASS WITH ACTIONABLE GAPS IDENTIFIED`
- **当前状态**: 第一阶段只读审计已完备完成，生产源码 `src/` 保持 0 修改。
- **下一步行动**: 等待审查确认后，进入 **M5-W11 Step 2 (UI Surface Cleanup Implementation)** 针对上述 MUST FIX 项执行最小代码清理。
