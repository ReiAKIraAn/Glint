# 变更日志 (Changelog)

本项目所有重要架构演进、性能优化与代码变更均记录于此。

---

## [Unreleased] - Safari Personal Edition 重构开发中

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

