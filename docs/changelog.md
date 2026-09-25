# 变更日志 (Changelog)

本项目所有重要架构演进、性能优化与代码变更均记录于此。

---

## [1.1.1] - Safari Personal Edition - 2026-09-25

### Release Highlights (版本核心特性与闭环总结)
- **外观与标注样式**: 新增第四种「文字变色」标注样式（`color`），纯文字着色无下划线或底色，完整保留宿主版面样式。
- **AI Provider 架构收敛**: 核心 Provider 收敛为 **OpenAI**、**DeepSeek** 与 **自定义接口（Custom API）** 3 家；彻底移除 Anthropic runtime adapter 及相关 SDK 依赖。
- **Custom API 强化与 Extra Body**: 自定义接口支持标准 OpenAI 兼容 Chat Completions 协议；支持免 Key（keyless）与自填 Key 模式；新增「额外请求体（JSON）」配置项，默认值为 `{"thinking_mode": false}`。
- **API Key 隔离安全**: 所有服务商 API Key 严格保持 background-only 单向隔离，绝不暴露至 content-script 或持久化至网页上下文。
- **UI Surface 闭环清理**:
  - 彻底删除设置页中已废弃的 Anki 导出 UI（`#exportAnki` 与 `#ankiNote`）；
  - 从 `wxt.config.ts` 清单中移除 Safari 快捷键 `commands`（`next-word`, `prev-word`），消除系统热键冲突；
  - 清理设置页中未使用的历史 Provider 图标死代码（Anthropic、Gemini、Ollama 等）；
  - 达成 UI / Runtime / Manifest / Documentation consistency closure（用户界面、运行时、清单与文档四位一体严格对齐）。

### Known Limitations (已知边界与限制说明)
- **External Provider 网络验证边界**: OpenAI / DeepSeek / Custom API 的真实外部网络请求在本次环境中未使用真实 API Key 完成验证（协议构建、请求头规范、流式解包与错误映射由自动化 Mock 测试覆盖）。
- **DOM 扫描极端回退**: 当单批次 Mutation 超过 250 条记录时（mutation storm >250 records），仍可能触发整页回退全量扫描并产生较高计算成本。
- **WebKit 慢流生命周期**: Safari MV3 slow stream 生命周期风险仍保留（由应用层 60s 超时兜底，坚决不引入伪造心跳 hack）。
- **DOM 边界隔离**: 第三方网页的 Shadow DOM 与 `<iframe>` 严格保持 opaque，TreeWalker 绝不穿透网页 ShadowRoot。
- **性能基准度量边界**: formal Long Task / JSC heap / GC automation 未建立。
- **实机运行环境说明**: 当前实际 Safari 验证环境为 STP Release 253 / macOS 27.2；该版本是否为 Apple 当前发布的最新 STP 版本保持为 `UNVERIFIED`，不得写成“Release 253 是当前最新 STP”。

### Phase 20: Milestone 5 / Workstream 12 — UI Feature Surface 闭环与一致性审计 (UI Feature Surface Closure & Consistency Review) - 2026-09-25
- **虚假 UI 与死代码清理 (`src/entrypoints/options/`, `wxt.config.ts`, `src/entrypoints/background.ts`)**:
  - 彻底移除 `options/index.html` 中的 `#exportAnki` 按钮与 `#ankiNote` 提示文本；移除 `main.ts` 中的 `toAnkiTSV` 依赖、点击监听与 Options 内的 `loadDict()`。
  - 从 `wxt.config.ts` 剥离 `manifest.commands` (`next-word`, `prev-word`)，同步清除 `background.ts` 中的 `browser.commands?.onCommand` 监听。
  - 清理 `options/main.ts` 中 9 个废弃图标的静态导入，`ICONS` 仅保留 `openai` 与 `deepseek-color`，`custom` 采用内置 `PLUG_ICON`。
- **文档与元数据对齐 (`README.md`, `PRIVACY.md`)**:
  - 修正 `README.md`，删除 Anki 导出、11 家 Provider 描述与 `chrome://extensions/shortcuts` 改键说明，更新为 Safari MV3 构建与使用规范。
  - 修正 `PRIVACY.md`，明确 AI 释义缓存仅存储单词原型与纯文本释义，绝不持久化任何网页原文句子或上下文。
- **专项测试与一致性审查 (`tests/ui-surface.test.ts`, `docs/ui-feature-surface-final-review.md`)**:
  - 新增 `UI-ANKI-01`、`UI-PROVIDER-01`、`UI-SHORTCUT-01` 与 `UI-MIGRATION-01` 4 项自动化回归测试。
  - 全量 412/412 项测试 100% 通过，Safari MV3 构建零错误。

### Phase 19: Milestone 5 / Workstream 11.1 — Custom API Keyless 状态收敛与依赖清理 (Keyless Status & Cleanup) - 2026-09-25
- **Custom API Keyless 状态规范化 (`src/lib/types.ts`)**:
  - 调整 `isConfigured` 逻辑：当 Provider 为 `custom` 时，若具备合法 Base URL 与 Model，即使无 API Key 亦判定为就绪（`isConfigured === true`）。
  - 新增 `CONFIG-CUSTOM-KEYLESS-01..03` 与 `CONFIG-OPENAI-DEEPSEEK-KEY-REQUIRED` 自动化测试。
- **废弃依赖彻底清理 (`package.json`, `pnpm-lock.yaml`)**:
  - 移除 `@ai-sdk/anthropic` 与 `@ai-sdk/google` 依赖，释放包体积并消除潜在安全漏洞。

### Phase 18: Milestone 5 / Workstream 11 — AI Provider 体系重构：OpenAI、DeepSeek 与 Custom API (AI Provider Modernization) - 2026-09-25
- **Provider 体系收敛 (`src/lib/providers/`, `src/lib/types.ts`)**:
  - 实现 `OpenAIAdapter`、`DeepSeekAdapter` 与 `CustomAdapter`，统一基于 OpenAI Chat Completions 协议规范与 SSE 流式解包。
  - 注册表严格收敛为 `openai`、`deepseek`、`custom`；彻底移除 `AnthropicAdapter` 及其静态注册。
  - 设置自动平滑迁移：历史 `anthropic` 安全降级为默认 `openai`，历史 `compatible` 平滑迁移至 `custom`。
- **自定义接口 Extra Body 扩展 (`src/lib/providers/extra-body.ts`)**:
  - 新增 `customExtraBody` 设置字段，默认值为 `JSON.stringify({ thinking_mode: false }, null, 2)`。
  - 增加严格的 JSON Object 校验器 `parseAndValidateExtraBody`，在前端与请求构建时阻止数组或非法 JSON。

### Phase 17: Milestone 5 / Workstream 10 — 新增「文字变色」标注样式 (Text Color Annotation Style) - 2026-09-25
- **功能特性 (`src/lib/types.ts`, `src/lib/highlight.ts`, `src/entrypoints/options/`)**:
  - 新增第四种生词标注样式 `color`（文字变色）。
  - Light 模式着色 `#D9622B`，Dark 模式着色 `#FF9A5C`（采用统一的 `@media (prefers-color-scheme: dark)`）。
  - 显式声明 `text-decoration: none;` 与 `background-color: transparent;`，不产生下划线或底色，完全保留宿主原有字体排版样式。
  - 设置面板外观模块新增第四张均分单选卡片，文案为 `reading` + `文字变色`。
- **兼容性与性能契约**:
  - 旧设置缺少 `style` 时自动回退至默认值 `dotted`，存量用户偏好完整保留。
  - 沿用既有单实例 `CSSStyleSheet` + `replaceSync()` 样式原子覆写机制，微基准测试单次覆写耗时 < 0.3 ms。
  - 零新增 DOM wrapper、零 TreeWalker 重新扫描、零 MutationObserver，样式切换未触发 AI 释义请求。
- **测试与验证覆盖**:
  - 全量自动化测试保持 385 / 385 PASS。
  - 专项新增 17 个自动化测试用例（包括 `tests/annotation-color.test.ts` 中 COLOR-01 至 COLOR-16 对应 16 项测试，以及 `tests/settings.test.ts` 中 1 项 `style: "color"` 读取保留测试）。
  - Safari Technology Preview (Release 253) 实机执行验证 ENV-01 与 COLOR-SAFARI-01..06 全量 PASS。

### Phase 16: Milestone 5 / Workstream 5 — 动态网页扫描韧性硬化与全量验证闭环 (Dynamic Web Robustness & Acceptance) - 2026-09-25
- **扫描器动态韧性硬化与正确性修复 (`src/entrypoints/content.ts`, `src/lib/scan.ts`)**:
  - **RISK-01 修复（零生词页面非必要全量重扫）**: 废弃脆弱的 `tokens.length === 0` 作为“是否已初次扫描”的判定条件，引入显式生命周期标志 `hasRunInitialScan`；确保初次页面若无生词，后续发生 DOM 增量变更时严格执行增量扫描，绝不退化为整页全量重扫。
  - **RISK-03 修复（重叠祖先/后代节点导致重复扫描与词元重叠）**: 在 `src/lib/scan.ts` 中新增 `pruneContainedNodes` 祖先/后代包含剪枝算法，并在 `src/entrypoints/content.ts` 收集 `dirtyTextNodes` 时自动修剪已被新增根节点覆盖的文本节点；彻底杜绝嵌套 DOM 增量变更下的重复扫描与重复 token 生成。
- **RISK-02 评估与策略决定 (DEFERRED)**:
  - 对 `records.length > 250` 的全量回退阈值进行了实机多梯度压力评测（251: 907ms, 500: 2290ms, 1000: 7086ms）；当前策略在测试场景下功能行为稳定，但大批量突变存在较重 TreeWalker 耗时。维持策略 DEFERRED，不盲目调整阈值，不宣称 250 为最优解或能够杜绝 Long Task。
- **专项自动化回归套件与覆盖扩充 (`tests/content-scanner.test.ts`, 343/343 PASS)**:
  - 新增 DW-01 至 DW-15 全场景测试，涵盖 SPA 路由重置、增量追加、祖先后代嵌套修剪、属性变更过滤、短时间防抖合并、DOM 移除清理、卡片生命周期保护、连续快速滚动、超大 DOM 极端压力（10,000 / 50,000 节点深层树遍历）与 30 轮循环生命周期无异常。
  - 全量自动化测试用例由 311 项扩充至 343 项，100% 保持 PASS。
- **真实 Safari Technology Preview 实机全量回归与证据分类**:
  - 实机验证覆盖 macOS 27.2 (Build 26B5091g) / Safari Technology Preview Release 253 (WebKit 22626.1.8.19.2)。
  - REG-01 至 REG-15 全部核验通过（涵盖初次扫描、增量追加、SPA 路由导航、悬停卡片保持、TTS 朗读、AI 流式推流、用户取消、缓存命中、输入框/textarea/Shadow DOM/iframe 边界安全等）。
  - 严格规范证据分类，清晰标注 VERIFIED、OBSERVED 与 UNVERIFIED 项（将 Long Task 连续时间线追踪、JavaScriptCore 堆快照/GC 绝对回收证明及 Latest STP 状态明确列为 UNVERIFIED）。
- **里程碑状态与已知边界**:
  - **M5-W5 最终状态**: `PASS WITH KNOWN LIMITATIONS`。

### Phase 15: Milestone 5 / Workstream 8 — Provider Adapter 架构解耦与架构验收 (Provider Adapter Architecture & Acceptance) - 2026-09-24
- **Provider Adapter Architecture 架构解耦与统一抽象**:
  - **Anthropic-specific network logic isolated in AnthropicAdapter**: 将原 `fetchProviderStream` 中高度绑定的 Anthropic 网络请求、Header 组装、Payload 组织、SSE 事件流解析与 4,000 字符限制完整收敛至 `AnthropicAdapter`。
  - **Static ProviderRegistry introduced**: 建立编译期静态注册表体系 (`ProviderRegistry`)，提供统一 `getProviderAdapter` 与 `hasProviderAdapter` 解析，严禁动态脚本引入与 `eval()`，对未注册服务商安全阻断。
  - **Generic AI application lifecycle no longer branches directly on Anthropic**: 消除 `ai-port.ts` 中硬编码的 `settings.provider !== 'anthropic'` 分支，通用流式调度与 Port 协议彻底脱钩具体服务商。
  - **Model discovery routed through provider adapter**: 模型列表查询 (`fetchProviderModels`) 统一委托给 `adapter.listModels()`，保持纯净数组输出。
  - **Credentials remain Background-only**: API Key 严格由 Background `keys.ts` (`local:apiKeys`) 管理，仅在发起流时作为上下文参数传入 Adapter；Content Script 生产产物中彻底移除 `local:apiKeys`、`x-api-key` 与 `AnthropicAdapter`。
  - **Permission orchestration remains outside adapters**: Safari 域名权限申请与管理 (`src/lib/permissions.ts`) 严格位于 Adapter 之外，由用户手势驱动。
  - **Cache and AI Port protocol unchanged**: AI 缓存严格维持 M5-W2 Option A 契约 (`{ word, explanation, updatedAt }`)，不保存 Provider/Model 字段；Port 协议帧 (`AI_START`, `AI_CHUNK`, `AI_DONE`, `AI_ERROR`) 保持 100% 稳定不变。
  - **No second provider implemented**: 严格限定重构范围，当前仅实现 AnthropicAdapter，坚决不实现第二 Provider（Second provider: NOT IMPLEMENTED）。
- **专项契约测试与全量回归 (ADAPTER-01 至 ADAPTER-14, 311/311 PASS)**:
  - 覆盖适配器契约符合性、注册表解析、未注册防护、正常推流、UTF-8 跨 chunk 解码、网络异常归一化、协议畸形防护、HTTP 状态码映射、用户中止释放 reader、60s 超时、4,000 字符超限、URL 零密钥、错误信息脱敏与模型发现。
  - 既有回归项 REG-01 至 REG-10 全部稳定保持 PASS。
- **构建体积优化**:
  - 提取 `ai-port-client.ts` 隔离 Content Script 与 Background 依赖，`content.js` 产物体积从 504.25 kB 降至 496.63 kB。
- **里程碑状态与已知限制 (Known Limitations)**:
  - **M5-W8 最终状态**: `PASS WITH KNOWN LIMITATION`。
  - **已知限制**:
    1. **WebKit Service Worker 慢流生命周期**: 极端慢流/长空闲下的 Service Worker 生命周期行为保持为 `UNVERIFIED`（已通过应用层 60s 超时兜底，坚决不引入伪造心跳等 keep-alive hack）。
    2. **Safari TP 版本状态**: 实测运行于 Safari Technology Preview Release 253 (WebKit 22626.1.8.19.2)；该版本是否为 Apple 最新版本保持为 `UNVERIFIED`。

### Phase 14: Milestone 5 / Workstream 2 — AI 释义本地持久化与缓存 (AI Explanation Persistence) - 2026-09-24
- **持久化契约与隐私保护 (`src/lib/types.ts`, `src/lib/explanation-cache.ts`)**:
  - 确立 M5-W2 最终持久化契约 `ExplanationCacheEntry`，严格限定仅包含 `{ word: string, explanation: string, updatedAt: number }` 三项字段。
  - 严禁持久化 `sentence`, `context`, `surface`, `analysis`, `sentenceZh`, `example`, `url`, `title`, `dom`, `selection`, `tabId`, `frameId`, `requestId`, `provider`, `model`, `apiKey`。
  - 实现了 `isCleanCacheEntry` 严格校验器与 `sanitizeExplanationStore` 历史污染清洗机制，历史数据中若包含网页原句或旧版 `analysis` 自动丢弃，绝不残留敏感信息。
- **核心本地缓存模块 (`src/lib/explanation-cache.ts`)**:
  - 实现基于 `local:explanations` 的 2,000 条上限容量与 LRU 淘汰机制 (`capExplanationEntries`)，超过容量时按 `updatedAt` 倒序截断淘汰最旧记录。
  - 统一词汇规范化 Key (`normalizeWordKey`)：统一小写并裁剪前后空格，确保同一单词不同大小写形态命中同一槽位。
  - 串行化任务队列 (`enqueue`)：在单个 JavaScript 运行时（如 Background Service Worker）内部将读-改-写任务加入 Promise 队列串行化执行；明确跨 Context（如 Background 与 Options 同时并发写）底层 WebExtension storage 不提供数据库事务级原子性。
  - 提供了 `getExplanation`, `putExplanation`, `deleteExplanation`, `clearExplanations`, `getAllExplanations` 纯净 API。
- **Background 持久化写入边界 (`src/lib/ai-port.ts`, `src/entrypoints/background.ts`)**:
  - 将 Background 设为核心持久化写入入口：当且仅当 Provider SSE 推流完整完成、非空且未发生 Abort / 错误时，调用 `putExplanation` 写入。
  - 存储写入故障容错（Section 7）：底层 storage 写入异常时仅记录控制台告警，绝不破坏前台已成功的 `AI_DONE` 响应与用户体验。
  - 废弃 `background.ts` 中的旧 `remember` 逻辑，消除敏感字段写入隐患。
- **悬浮卡片缓存读取与零网络命中 (`src/lib/card.ts`, `src/entrypoints/content.ts`)**:
  - `startAi()` 接入 `getCachedExplanation(lookupKey)`：优先读取本地缓存，命中后立即切换至 `done` 态并通过安全 `textContent` 渲染，彻底阻断 `aiClient.start()` 与网络请求。
  - 保持 Hover 零网络与零持久化读取原则：仅在用户显式点击“✨ AI 解释”后才触发单词缓存查询，页面加载与 Hover 不会读取 2000 条缓存。
  - 移除了 `content.ts` 页面加载时无谓全量读取 `explanationsStore` 的冗余逻辑。
- **设置页兼容与 Anki 隔离 (`src/entrypoints/options/main.ts`)**:
  - `refreshCounts` 与 `entryRow` 升级为直接消费 `getAllExplanations()` 与 `ExplanationCacheEntry`，展现纯文本 AI 释义。
  - 单条“删除”按钮与“清空全部释义缓存”按钮平滑接入 `deleteExplanation` 与 `clearExplanations`，绝不影响 API Keys 或设置项。
  - 严格落实产品决策 D3 = NO，禁用并隔离 Anki 导出，不恢复旧格式兼容。
- **持久化专项测试套件与回归核验 (`tests/explanation-cache.test.ts`)**:
  - 新增 20 项全场景自动化测试（CACHE-01 至 CACHE-20），覆盖空缓存、未命中、成功写入、命中刷新 LRU、重复词汇更新、2000 条容量、第 2001 条 LRU 淘汰、清空缓存、单条删除、用户取消不写、错误不写、超时不写、局部流不写、空文本不写、存储失败容错、敏感字段绝对隔离 (`PRIVATE_DOCUMENT_12345` 零泄露)、旧数据清洗、并发写入串行化及缓存命中零网络调用。
  - 全量自动化测试用例由 272 项增长至 292 项，100% 保持 PASS。
  - TypeScript 严格类型检查 (`tsc --noEmit`) 零报错，Safari 生产构建 (`pnpm build:safari`) 成功打包。

### Phase 13: Milestone 5 / Workstream 1 — 原生离线单词发音恢复 (Native Offline TTS Restoration) - 2026-09-24
- **悬浮卡片离线发音 UI 与事件绑定 (`src/lib/card.ts`)**:
  - 音标行 `<div class="phonetic">` 恢复小喇叭按钮 `<button class="speak" data-act="speak">`，使用纯原生 `document.createElementNS` 构建 SVG 矢量喇叭图标，彻底杜绝 `innerHTML` 与 XSS 隐患。
  - 直接绑定 `src/lib/speak.ts` 的 `speak(token.surface)`，点击立即播放发音；点击发音不会关闭卡片，亦不触发任何 AI 网络请求或 hover 干扰。
  - 动态适配与无障碍增强：具备标准 `title="朗读"` 与 `aria-label="朗读 [单词]"`，内部 SVG 标记 `aria-hidden="true"`；支持键盘 Tab 聚焦与回车触发。
  - 卡片销毁与页面卸载清理：`card.destroy()` 联动调用 `cancelSpeech()`，排空语音队列。
- **离线语音模块动态环境兼容升级 (`src/lib/speak.ts`)**:
  - 将 `hasAPI` 升级为动态环境检测函数，增强对运行时动态加载、Safari Technology Preview 及各类测试环境的自适应能力。
  - 严格保持“零权限、零体积、离线可用”承诺：仅选取系统预装的本机离线英文语音 (`localService === true`)，坚决过滤远程网络语音。
  - 新增导出 `cancelSpeech()` 函数，便于外部生命周期安全停止播放。
- **TTS 专项自动化测试套件 (`tests/tts.test.ts`)**:
  - 新增 10 项全维度自动化测试（TTS-01 至 TTS-10），覆盖按钮渲染、朗读调用、连续点击取消、本地语音过滤、零网络请求断言、隐藏不报错、销毁排空队列、XSS 安全防护、无障碍属性及 API 缺失平滑降级。
  - 全量自动化测试用例由 262 项增长至 272 项，100% 保持 PASS。
- **构建与 Safari 验证**:
  - TypeScript 严格类型检查 (`tsc --noEmit`) 零报错，Safari 生产构建 (`pnpm build:safari`) 成功打包。

### Phase 12: Milestone 5 / Preflight — 功能完备性与架构差距审计 (Feature Completeness & Architecture Gap Audit) - 2026-09-24
- **功能完备性与架构差距全景审计 (`docs/m5-feature-gap-audit.md`)**:
  - 全面比对 Original Glint upstream (commit `6927753` / `main` 分支) 与当前 Safari Personal Edition (HEAD `caa4c91` / `safari-personal` 分支)。
  - 梳理 16 项核心功能全量迁移矩阵，明确状态标记：`COMPLETE`、`PARTIAL`、`MISSING`、`INTENTIONALLY EXCLUDED`、`BLOCKED`、`UNVERIFIED`。
  - 深度识别被推迟/暂未启用的功能：
    - 原生离线单词发音 (`src/lib/speak.ts` Web Speech API 已就绪但卡片暂无按钮)
    - AI 释义本地持久化 (`local:explanations` 2000 条 LRU 缓存未接入流式结果，导致刷新丢失且 Anki 导出无数据)
    - 多服务商流式网络扩展 (目前仅打通 Anthropic SSE 流式网络层)
    - macOS 平台快捷键冲突 (`Alt+G` / `Alt+Shift+G` 在 macOS 上为 Option 键，存在特殊字符输入冲突)
  - 梳理扫描算法、高亮渲染、卡片生命周期、存储与缓存全景以及 WebKit 能力矩阵。
  - 汇总 5 大客观候选工作流与 5 项需用户明确裁决的核心架构决策。
- **测试计划与回归核验**:
  - `docs/test-plan.md` 注册 Section 11（Milestone 5 预检差距审计记录）。
  - 全量自动化测试 262/262 项 100% 保持通过，TypeScript 严格检查零报错。
  - 生产代码 (`src/`) 保持 100% 零修改。

### Phase 11: Milestone 4 / Step 4 — 端到端集成验证与整体验收 (End-to-End Integration & M4 Final Verification) - 2026-09-24
- **端到端集成测试套件 (`tests/m4-e2e.test.ts`)**:
  - 新增 14 项全链路闭环 E2E 测试，覆盖完整链路：`Card UI` ↔ `AiStreamClient` ↔ `runtime.Port IPC` ↔ `handleAiPortConnection` ↔ `fetchProviderStream` ↔ `Anthropic SSE`。
  - E2E-01 正常完整流式请求：验证从显式点击、loading 切换、SSE 多 chunk 接收、rAF 批处理到 `AI_DONE` 结束全链路，确认无 `fullText` 冗余字段。
  - E2E-02 用户中途 Abort：验证点击取消即刻切入 aborted 态，底层 `AbortController` 掐断网络流，迟到 chunk 静默丢弃。
  - E2E-03 同 Port 请求替换：验证同一卡片快速连续触发生词时，前序请求被 abort 并标记 stale，后续新请求独立完整流式输出。
  - E2E-04 跨 Port / 多标签页隔离：验证 Tab A 与 Tab B 独立并发推流，Abort Tab A 绝不影响 Tab B。
  - E2E-05 Token 快速切换：验证鼠标移至新 Token 自动 abort 旧请求，新卡片显示本地词典且不自动启动 AI。
  - E2E-06 卡片收起与滚动：验证 `card.hide()` 触发自动 abort 活动请求并清理未决 rAF。
  - E2E-07 页面导航与卸载：验证页面卸载触发 Port disconnect 时后台自动释放网络流，无悬挂异常。
  - E2E-08 Provider 异常脱敏：验证 HTTP 401/403/429/500、网络故障、超时等脱敏展示，无 Key 与堆栈回显。
  - E2E-09 恶意输出转义：验证 `<script>` 与 `<img onerror>` 100% 作为纯文本转义写入，无脚本执行与新节点创建。
  - E2E-10 API Key 隔离核查：确认 API Key 绝未跨越 Background 边界进入 Content Script、Port、DOM 或控制台。
  - E2E-11 上下文收敛边界：确认 `AI_START` 仅携带目标词、lemma 与 `sentenceAround` 单句，无全页 HTML 或无关数据。
  - E2E-12 响应 4000 字符截断：验证超出 `MAX_RESPONSE_CHARS` 立即中止底层推流，保留局部文本并标记截断。
  - E2E-13 rAF 高频打字机合并：验证 100 个微小字符分块通过 rAF 批处理稳定合并，内容零丢失，顺序完全一致。
  - E2E-14 循环生命周期无泄漏：验证连续 30 轮启动/流式/取消/隐藏/重开，DOM 单例唯一，无状态残留与监听器累积。
- **自动化测试回归全绿**:
  - 全量自动化测试用例由 248 项增长至 262 项，全量 100% PASS (pnpm test 1627ms)。
  - TypeScript 严格类型检查 (`tsc --noEmit`) 零报错，Safari 生产构建 (`pnpm build:safari`) 成功打包。
- **Safari Technology Preview 实机端到端验证**:
  - 在 STP Release 253 (CFBundleVersion 22626.1.8.19.2) 上完成 Tests 1~14 全面实测，全部 PASS。
  - 生成专项验收文档 `docs/m4-integration-verification.md`。

### Phase 10: Milestone 4 / Step 3 — AI Card UI 与流式安全渲染 (Streaming Card UI Integration) - 2026-09-24
- **悬浮卡片 AI 流式交互与状态机架构 (`src/lib/card.ts`)**:
  - 接入 `AiStreamClient`，实现类型安全的六态 UI 状态机（`idle`、`loading`、`streaming`、`done`、`error`、`aborted`），每态严格携带 `requestId` 进行世代守卫。
  - 触发原则严格受控：Hover 仅展示本地即时词典，AI 区域仅展示“✨ AI 解释”操作按钮，绝对零自动预取与零后台流量开销。
  - 用户显式点击后切换 `loading` 态并展示“取消”按钮，禁止多重并发触发；首个 chunk 到达后切换 `streaming` 打字机态；`AI_DONE` 时隐藏取消按钮并自适应微调卡片定位。
  - rAF 节流批处理机制：SSE 文本微更新分块暂存入 `pendingAiText`，对齐单一 `requestAnimationFrame` 句柄更新 DOM；在 `onDone`、`onError`、`abortAi` 时执行 `flushAiRender()` 强制排空，确保尾部文字零遗漏。
  - 不可信文本绝对安全防护：所有 AI 文本增量、状态文案、报错提示 100% 经由 `.textContent` 写入 Shadow DOM，彻底杜绝 `innerHTML`；零外部 Markdown / HTML parser 依赖，天然阻断 XSS。
  - 单例 DOM 架构复用与世代隔离：维持 `<glint-card>` 全局单例，AI 容器与节点在构造阶段一次性创建；用户切换生词时即刻 abort 旧请求并重置状态，旧请求迟到回调完全被 UI 丢弃。
- **内容脚本生命周期与连接对齐 (`src/entrypoints/content.ts`)**:
  - 统合卡片与流式客户端：单例 `AiStreamClient` 直接注入 `Card` 依赖，提供 `sentenceOf` 单句提取函数。
  - 页面卸载联动：在 `pagehide` 事件中统一触发 `card.destroy()` 与客户端 `disconnect()`，释放所有引用与 DOM 节点。
- **Step 3 自动化测试套件 (`tests/ai-card.test.ts`)**:
  - 新增 45 项全维度专项自动化测试：覆盖触发边界 (A1-A5)、Loading 态 (B6-B8)、Streaming 打字机与 rAF (C9-C14)、Stale / Epoch 守卫 (D15-D19)、用户取消与未决 rAF 清理 (E20-E24)、错误安全脱敏与无 Key 泄露 (F25-F28)、XSS 纯文本安全转义 (G29-G32)、Token 切换隔离 (H33-H37)、卡片生命周期单例与销毁 (I38-I42)、Payload 上下文收敛 (J43-J47)、可访问性与语义无障碍 (K48-K51) 及 1,000 chunks 高频压力测试 (Perf 52)。
  - 自动化回归测试用例总数由 203 项增长至 248 项，全部 PASS (1385ms)。
  - TypeScript 严格类型检查 (`tsc --noEmit`) 零报错，Safari 生产构建 (`pnpm build:safari`) 成功构建。

### Phase 9: Milestone 4 / Step 2 — Background Port 联调与连接隔离架构 (Connection-Isolated Port Integration) - 2026-09-24
- **Port 流式通信协议与连接调度器 (`src/lib/ai-port.ts`)**:
  - 冻结最小化 Port 协议：客户端消息 `AI_START`、`AI_ABORT`；服务端消息 `AI_CHUNK`、`AI_DONE`、`AI_ERROR`。每条消息强制绑定 `requestId: string`。
  - 核心架构收敛：实现按 Port 隔离的单请求生命周期（one active request per Port / Content Script connection），彻底杜绝全局请求单例。不同标签页（不同 Port）并发运行，Tab A abort 绝不影响 Tab B。
  - `WeakMap<PortLike, PortState>` 存储连接局部状态，断开连接后即刻清理，无全局强引用或内存泄漏。
  - 双重 `requestId` 过期过滤：Background 拦截非当前请求的迟到 chunk/done/error；Content Script `AiStreamClient` 丢弃非当前请求的所有在途消息，双保险保证绝无陈旧响应渗透。
  - Same-Port 请求替换：同一 Port 连续触发时自动 abort 旧请求并设为 stale，平滑切换至新请求。
  - 断开与卸载处理：`port.onDisconnect` 立即中断活跃请求并释放网络资源，断开后不再向 Port 发送任何消息。
  - API Key 绝对隔离：Key 仅在 Background 内部由安全存储读取并传入 `streamFn`，绝不进入 Port 载荷、URL、Console 或 DOM。
  - 规范错误映射：`mapProviderError` 将各类底层异常脱敏为 `HTTP_ERROR`、`NETWORK_ERROR`、`TIMEOUT`、`ABORTED`、`PROTOCOL_ERROR`、`RESPONSE_TOO_LARGE` 等标准错误。
- **后台与内容脚本无缝对接 (`src/entrypoints/background.ts`, `src/entrypoints/content.ts`)**:
  - `background.ts`: 注册 `browser.runtime.onConnect` 监听 `glint:ai-stream` 端口，委托给 `handleAiPortConnection(port)`。
  - `content.ts`: 暴露最小测试句柄 `window.__glintAiStreamClient`（`AiStreamClient`），在 `pagehide` 时触发 `disconnect()`，卡片正式 UI 保持 100% 未动。
- **Step 2 自动化测试套件 (`tests/ai-port.test.ts`)**:
  - 新增 54 项专项自动化测试：覆盖连接建立与断开 (1-5)、流式输出时序 (6-9)、requestId 路由与丢弃 (10-14)、同 Port 替换 (15-20)、跨 Port 隔离并发 (21-26)、Abort 掐断 (27-31)、API Key 绝对隔离 (32-38)、生命周期断开清理 (39-43)、竞态安全 (44-47)、错误类型安全映射 (48-52) 及客户端 harness 测试。
  - 自动化回归测试用例总数由 149 项增长至 203 项，全部 PASS。
  - TypeScript 严格类型检查 (`tsc --noEmit`) 零报错，Safari 生产构建 (`pnpm build:safari`) 成功打包。
- **零 Keep-Alive Hack 原则与 Safari 状态澄清**:
  - 坚决不引入 `setInterval`、fake heartbeat 或 dummy traffic。
  - 极端慢流/停流状态客观标记为 `SAFARI TP REAL SLOW-STREAM UNVERIFIED`。

### Phase 8: Milestone 4 / Step 1 — Anthropic SSE 流式网络层实现 (Provider Stream Layer) - 2026-09-24
- **Anthropic SSE 纯网络层抽象 (`src/lib/provider-network.ts`)**:
  - 新增 `fetchProviderStream(settings, apiKey, payload, signal, onChunk, options)`：实现最小、纯粹、无 DOM / UI / Port 依赖的底层流式请求函数。
  - 严格采用官方规范 Header 鉴权 (`x-api-key`, `anthropic-version: 2023-06-01`, `anthropic-dangerous-direct-browser-access: true`)，URL Query 与 Request Body 零 Key 泄露。
  - 自研增量轻量 SSE 解析器：支持单个 chunk 多事件、单个事件跨多 chunk、行缓冲、空行分隔、无换行尾部兼容及 UTF-8 多字节拆分 (`TextDecoder({ stream: true })`)。
  - 仅向回调派发真正的 `content_block_delta` 文本增量；安全忽略非文本元数据与生命周期事件；捕获 `event: error` 协议报错。
  - 落地硬性 4,000 字符限制 (`MAX_RESPONSE_CHARS`)：超限仅分发剩余字符，立即 abort 并抛出 `ProviderResponseTooLargeError`。
  - 完整的错误类型体系：`ProviderHttpError` (覆盖 400/401/403/408/429/500/502/503)、`ProviderNetworkError`、`ProviderTimeoutError`、`ProviderAbortError`、`ProviderProtocolError`、`ProviderResponseTooLargeError`。
- **Step 1 自动化测试套件 (`tests/ai-stream.test.ts`)**:
  - 新增 30 项专项覆盖：包含单/多 delta、跨 chunk、UTF-8 字符拆分、未知事件忽略、畸形 JSON、HTTP 状态码、双向 Abort、60s Timeout 清理、4000 字符超限截断、URL/Error/日志零 Key 泄露。
  - 自动化回归测试用例由 119 项增长至 149 项，全部通过 (Node.js 1120ms)。
  - TypeScript 严格类型检查 (`tsc --noEmit`) 零报错，Safari 生产构建 (`pnpm build:safari`) 正常打包。
- **Safari 验证状态明确界定**:
  - 底层网络层 Node.js 自动化测试已通过 (`AUTOMATED VERIFIED`)。
  - 真实 Safari Technology Preview 实机端到端流式请求与 Service Worker 存活机制保持为 `SAFARI TP UNVERIFIED`，保留至后续 Step 联调完成后实测。

### Phase 7: Milestone 4 — AI 语境释义架构设计与协议冻结审查 (Architecture & Protocol Freeze Review) - 2026-09-24
- **产品决策正式冻结 (Frozen Product Decisions - 方案 B)**:
  - 确认采用**卡片内点击“AI 解释”按钮**作为唯一触发路径；Hover 本身绝对零网络外发，本地词典秒级即时展示。
  - 第一版严格保证**全局至多单一活动请求**，杜绝多路复用；用户切换 Token 即刻掐断旧请求。
  - 明确“八不”收敛边界：不做预取、不做快捷键、不做重新生成、暂不做持久化/LRU 缓存、不引入 Markdown/HTML 富文本库、不引入新第三方依赖、无 Swift bridge、单一 Provider (Anthropic)。
- **Safari TP Service Worker 生命周期客观评级与纠偏**:
  - 对 WebKit SW 行为客观分类：`fetch/ReadableStream` 保持存活与活跃连接防挂起评为 **UNVERIFIED**（必须通过真实 STP 慢流/停流实验验证）；`AbortController` TCP 释放与约 30s 空闲挂起评为 **PARTIALLY VERIFIED**。
- **协议极简化与载荷严密化 (IPC Protocol Freeze)**:
  - `docs/adr/002-ai-explanation-architecture.md` 更新为冻结版规范。
  - 剔除 `AI_DONE` 中的冗余 `fullText` 字段，杜绝重复传输已在本地累加的字符串。
  - 明确硬性长度限制 `MAX_RESPONSE_CHARS = 4,000` 字符，超限立即 abort，卡片保留已输出文本并标记截断。
  - 保留单调递增 `requestId` 作为单请求下的世代守卫 (Epoch Guard)，彻底过滤网络迟到残余 chunk。
- **安全模型澄清与上下文冻结 (Security & Context Boundary)**:
  - 明确澄清：XML 实体标签与分隔符仅为输入组织手段，**绝非安全边界**。真实安全边界为凭据隔离、工具隔离 (No Tool Use)、语境最小化与纯 `textContent` 输出处理。
  - 上下文严格锁定为 `word + current sentence`（源自 `scan.ts` 中 `sentenceAround` 算法，最大 260 字符，严禁跨越块级元素，不支持 iframe 与外部 shadow DOM）。
- **测试矩阵与文档同步 (19 项场景规划)**:
  - `docs/test-plan.md` 与 `docs/architecture.md` 全面同步，明确区分 Node 自动化与 Safari TP 实机必须项。
  - **生产代码 (`src/`) 保持 100% 未修改，静待下一阶段指令**。

### Phase 6: Milestone 3 — 最小安全网络切片与 Safari 权限闭环 (Secure Provider Network Slice) - 2026-09-24
- **Safari-First 最小权限与清单严密化 (Least-Privilege)**:
  - `wxt.config.ts`: Safari 构建从 `optional_host_permissions` 中彻底移除 `https://*/*` 全站通配符，仅保留预置商业 AI Provider 的独立单域规则；`host_permissions` 维持为空数组 `[]`。
  - `src/lib/permissions.ts`: 完善 `revokeHostPermission`，如实返回 `{ ok, reason }` 并捕获 WebKit `required permissions cannot be removed` 异常限制，杜绝伪造成功状态。
- **独立安全的 Provider 网络模块 (provider-network.ts)**:
  - 新增 `src/lib/provider-network.ts`: 实现单 Provider 最小 HTTPS 模型请求切片 (`fetchProviderModels`)。严格采用 Header 鉴权（`x-api-key`、`x-goog-api-key`、`Authorization: Bearer`），绝不拼接 URL Query；统一走 `sanitizeUrl` 与 `redactSecrets`。
  - 健壮实现并覆盖五条路径：成功响应 (200)、HTTP 错误 (401/403/500)、网络故障 (TypeError)、请求超时 (TimeoutError) 与畸形响应 (非标准 JSON)。
- **选项页与后台安全对接 (Options & Background Integration)**:
  - `src/entrypoints/options/main.ts`: 用户点击 `#saveKey` 时在前置直接用户手势内触发单一 Origin 权限校验 (`hasHostPermission` / `requestHostPermission`)，用户拒绝时安全阻断且不落盘 Key；保存成功后输入框立即圆点掩码 (`KEY_MASK`)，并立即触发最小网络探测。
  - `src/entrypoints/background.ts`: `models()` 委托至 `fetchProviderModels` 发出安全 HTTPS 请求，Content Script 永远无法读取 API Key。
- **Milestone 3 自动化测试套件 (12 项专项覆盖)**:
  - 新增 `tests/provider-network.test.ts`: 全面覆盖正常 API 请求、URL 零 Key、日志零泄露、报错回显脱敏、Content Script 隔离、单一 Origin 权限申请/拒绝/已授权、HTTP 错误、网络故障、超时、畸形响应、Key 清除与撤销。
  - 自动化测试用例由 107 项增长至 119 项，全部通过 (pnpm test 1269ms)。
- **Safari MV3 生产构建与打包更新**:
  - 构建产物 `.output/safari-mv3/` (5.88MB) 与 `.output/glint-1.1.1-safari.zip` (2.22MB) 打包更新完毕。
- **架构决策记录 (ADR)**:
  - 新增 `docs/adr/001-safari-permissions-network.md`，沉淀 Safari TP 用户手势约束、全站通配符剥离与权限撤销行为边界。

### Phase 5: Milestone 2 — 交互与悬浮卡片闭环 (Hover & Card Engine) - 2026-09-24
- **WebKit 边界 Text 节点精准反查 (resolveTextCaret)**:
  - `src/lib/hover.ts`: 实现 `resolveTextCaret`，在 WebKit / Safari 命中元素边缘返回 Element 容器与子节点索引时，平滑解析定位至真实目标 Text 节点与字符偏移，消除段落开头/结尾的命中盲区。
  - `tokenAt`: 增加 `node.isConnected` 活性检验，确保从 DOM 树移除的孤立节点绝对不会被误命中。
- **单例 DOM 架构与绝对安全渲染 (Strict textContent Sanitization)**:
  - `src/lib/card.ts`: 彻底重构悬浮卡片生命周期。卡片内部所有 DOM 节点在构造函数中一次性建立完毕，后续所有的 hover 展示（词汇、原形、等级、音标、考试标签、本地中文释义）100% 采用 `textContent` 与 `replaceChildren` 动态填充，彻底废弃 `innerHTML` 与模板字符串拼接。
  - 杜绝针对网页不可信输入（Untrusted Content）的任何 XSS 或样式注入风险；彻底消除高频 hover 下创建/销毁 DOM 的 GC 抖动与内存碎片。
- **Hover & Card 核心回归测试套件**:
  - 新增 `tests/hover-card.test.ts`: 覆盖 Element 边界解析、Token 词头/词中/词尾 hit-test、空白区域/未标注节点防护、脱离 DOM 节点过滤、卡片 show/update/hide 状态流转、单例 DOM 节点复用验证以及 XSS 恶意载荷纯文本转义安全验证。
  - 自动化回归测试用例由 101 项增长至 107 项，全量通过 (pnpm test 1095ms)。
- **Safari MV3 生产构建与打包更新**:
  - 构建目录 `.output/safari-mv3/` (5.88MB) 与压缩包 `.output/glint-1.1.1-safari.zip` (2.22MB) 打包就绪。

### Phase 4: Milestone 1 — 扫描与高亮渲染闭环 (Scan & Highlight Engine) - 2026-09-24
- **CSS Custom Highlight 样式注入双轨容灾机制**:
  - `src/lib/highlight.ts`: 在采用 `document.adoptedStyleSheets` 的基础上，增加 WebKit 隔离上下文 (Isolated World) 异常捕获与 `<style id="glint-mark-style">` 自动降级回退机制，确保在任何 WebKit 权限约束下样式均可稳定注入渲染。
  - `removeStyle`: 同步清空 `adoptedStyleSheets` 与 DOM 中的 fallback `<style>` 元素。
- **Web Inspector 诊断日志**:
  - `src/entrypoints/content.ts`: 引入非侵入式控制台诊断输出（`[glint] Highlighted X words` 与能力告警），方便在 Safari 开发者工具中即时定位脚本注入状态与高亮命中数量。
- **高亮渲染与样式生命周期测试套件**:
  - 新增 `tests/highlight.test.ts`: 完整覆盖 `isSupported` 能力检测、Token 范围录入 `CSS.highlights`、`adoptedStyleSheets` 动态挂载与跨上下文异常平滑降级。
  - 自动化回归测试用例由 97 项增加至 101 项，全部通过 (pnpm test 1011ms)。
- **Safari MV3 生产构建与打包**:
  - `.output/safari-mv3/` (5.90MB) 与 `.output/glint-1.1.1-safari.zip` (2.22MB) 构建就绪，TypeScript 零错误。

### Phase 1: 完整审计与 Safari-First 架构规划 (Audit & Architecture) - 2026-09-24
- **代码库导入与分支管理**:
  - 保留原始 upstream Glint 代码于 `main` 分支。
  - 创建专有重构分支 `safari-personal`。
  - 严格执行“第一阶段禁止修改生产代码”原则。
- **全面源码审计 (Audit)**:
  - 深入分析全部源码结构、依赖链、构建脚本与运行机制。
  - 详细解答 18 项关于可见功能、Chrome 专有基建、核心算法、性能瓶颈、Long Task、MutationObserver 风暴、内存泄露与安全隐患的深度问题。
  - 输出 `docs/audit-report.md`。
- **WebKit / Safari Technology Preview 能力调研**:
  - 确立以最新 Safari Technology Preview (Release 253+, WebKit 320113@main+, macOS Tahoe 27.2) 为动态基线。
  - 深度调研 CSS Custom Highlight API、`document.caretPositionFromPoint`、Web Speech API、Temporary Extension 载入机制。
  - 输出 `docs/safari-capabilities.md`。
- **需求规格与迁移矩阵构建**:
  - 明确个人自用范围约束（macOS only, STP only, 免 Xcode 临时扩展流, 零遥测, 零 App Store 复杂度）。
  - 制定 16 项功能迁移矩阵，确保核心能力不减配。
  - 输出 `docs/requirements.md`。
- **核心系统架构重构设计**:
  - 确立 Safari-first / WebKit-first 架构理念。
  - 创新设计“增量脏节点扫描引擎 (Incremental DOM Scanner)”取代原版全页暴力重扫机制。
  - 引入 `WeakMap` 存储 Text 节点索引，彻底杜绝孤立 DOM 树内存泄露。
  - 输出系统架构图与时序图，编写 `docs/architecture.md`。
- **性能基准与测试计划**:
  - 确立“性能是一级目标”，制定首屏加载零阻塞、扫描耗时、增量变动耗时、0 Long Task 等量化指标。
  - 制定自动化单元测试、Mutation 压力测试及 Safari TP 手工验收 Checklist。
  - 输出 `docs/performance-baseline.md` 与 `docs/test-plan.md`。

### Phase 2: Safari-First 增量扫描初版与基线构建 (Initial Incremental Scanner & Baseline) - 2026-09-24
- **增量扫描引擎初版**:
  - `src/lib/scan.ts`: 实现 `scanTextNode`、`scanSubtree`、导出 `collectCodeWords`。
  - `src/entrypoints/content.ts`: 引入 40ms 变动批处理队列，基于 `node.isConnected` 过滤无效 Token，仅扫描实际改变的 Text 节点与新增子树。
- **HoverTracker 映射升级**:
  - `src/lib/hover.ts`: `HoverTracker` 索引使用 `WeakMap<Text, Token[]>`。
- **Safari 构建与清单体系**:
  - `wxt.config.ts`: 引入环境感知函数，Safari 构建剥离 `minimum_chrome_version`。
  - `package.json`: 增加 `pnpm build:safari` 与 `pnpm zip:safari` 构建指令。
- **Node.js 单元测试**:
  - 编写 `tests/incremental-scan.test.ts`、`tests/weakmap-hover.test.ts`、`tests/mutation-stress.test.ts`。
  - *(纠偏注：所有 84 项测试均为 Node.js + Happy-DOM mock 环境，此前关于 0 Long Task、100% GC 及真实 Safari 性能的断言已正式撤回并标记为 UNVERIFIED)*。

### Phase 3: 深度安全修复、Safari 最小权限架构与 WeakRef DOM 引用解耦 (Security, Least-Privilege & WeakRef Decoupling) - 2026-09-24
- **Gemini API Key 泄露漏洞彻底修复**:
  - `src/entrypoints/background.ts`: 废除 `generativelanguage.googleapis.com` 的 `?key=${key}` URL Query 传参，全面改用官方标准请求头 `x-goog-api-key: ${key}`。
- **统一敏感信息脱敏边界 (Secret Redaction Boundary)**:
  - 新增 `src/lib/security.ts`：提供 `sanitizeUrl`、`redactSecrets`、`safeErrorMessage` 工具函数。
  - 全局过滤网络请求 URL、异常抛出、控制台日志与前端 UI 报错回显中的所有 API Key、Bearer Token 与敏感 Query 参数。
- **Popup 密钥内存隔离**:
  - `src/lib/keys.ts`: 导出 `hasApiKey` 轻量状态查询函数。
  - `src/entrypoints/popup/main.ts`: 彻底废除全量读取 `apiKeysStore.getValue()`，明文密钥不再进入 popup 进程内存空间。
- **Safari 最小权限架构落地 (Least-Privilege)**:
  - `wxt.config.ts`: Safari 目标下声明 `host_permissions: []`，彻底清除安装阶段向用户索要 10+ 商业 AI 网站访问权的警告。
  - 将所有外部云端 API（OpenAI, Anthropic, Gemini, DeepSeek 等）以及本地地址转移至 `optional_host_permissions`。
  - 新增 `src/lib/permissions.ts`：提供 `originForProvider`、`hasHostPermission`、`requestHostPermission`、`revokeHostPermission`。
  - `src/entrypoints/options/main.ts`: 在保存 Key / 拉取模型的用户手势中按需申请当前 Provider 单一域名授权；清除 Key 时同步调用 `browser.permissions.remove` 自动撤销权限。
- **Token / DOM 生命周期弱引用解耦**:
  - `src/lib/scan.ts`: 引入 `ScannedToken` 实现类与更新 `Token` 接口，使用 `nodeRef: WeakRef<Text>` 解除长期驻留集合对脱离 DOM 树 Text 节点的强引用保持。
  - `src/lib/highlight.ts`、`src/lib/hover.ts`、`src/lib/keynav.ts`、`src/entrypoints/content.ts`: 增加对 `!node || !node.isConnected` 的防护与安全退回；并在变动批处理中维护 `removedNodes` 状态。
- **Core Regression 测试套件补充**:
  - 新增 `tests/security-redaction.test.ts`、`tests/token-lifecycle.test.ts`、`tests/permission-architecture.test.ts`。
  - 测试用例总数提升至 97 项，Node.js 运行全量通过 (耗时 876ms)。
  - TypeScript 严格类型检查 (`tsc --noEmit`) 零报错。
  - Safari MV3 打包产物 `.output/safari-mv3` 与 zip 包验证完整。
- **真实浏览器验收状态**:
  - 确证开发机未安装 `Safari Technology Preview.app`，真实端到端手工验收标记为 `BLOCKED / UNVERIFIED`，提供官方安装与载入指引。

---

## [1.1.1] - Glint Upstream 基线版本
- 基于 Chrome MV3 与 WXT 框架的原版开源发布版。
- 基础功能：分级难词标注、备考词表、悬浮卡片、ECDICT 本地音标释义、AI 语境释义、Anki 导出、JSON 备份。

