# 变更日志 (Changelog)

本项目所有重要架构演进、性能优化与代码变更均记录于此。

---

## [Unreleased] - Safari Personal Edition 重构开发中

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

