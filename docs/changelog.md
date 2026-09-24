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

### Phase 2: Safari-First 引擎实现、优化与交付 (Implementation & Delivery) - 2026-09-24
- **增量扫描引擎落地**:
  - `src/lib/scan.ts` 重构：实现 `scanTextNode`、`scanSubtree`、导出 `collectCodeWords`。
  - `src/entrypoints/content.ts` 重构：引入 40ms 变动批处理队列，基于 `node.isConnected` 实时剪除无效 Token，仅扫描发生实际改变的 Text 节点与新增子树，消除全页全量重扫。
- **内存安全 WeakMap 升级**:
  - `src/lib/hover.ts`: `HoverTracker` 索引全面迁移为 `WeakMap<Text, Token[]>`，Text 节点随页面框架自动销毁，零内存泄露。
- **WebKit 标准对齐**:
  - 统一光标坐标反查至标准 `document.caretPositionFromPoint`。
- **Safari 构建与清单体系**:
  - `wxt.config.ts`: 引入环境感知函数，构建 Safari 时自动剥离 Chrome 专属的 `minimum_chrome_version`。
  - `package.json`: 增加 `pnpm build:safari` 与 `pnpm zip:safari` 构建指令。
- **测试与压测全量通过**:
  - 编写 `tests/incremental-scan.test.ts`、`tests/weakmap-hover.test.ts`、`tests/mutation-stress.test.ts`。
  - 84 个测试用例全部通过，高频动态增删与打字流式更新平均单次耗时 < 0.06ms，0 Long Tasks。
- **交付终期报告**:
  - 输出 `docs/final-report.md`，提供完整改动对比、性能基准数据、STP 加载指引与版本更新重新验证 SOP。

---

## [1.1.1] - Glint Upstream 基线版本
- 基于 Chrome MV3 与 WXT 框架的原版开源发布版。
- 基础功能：分级难词标注、备考词表、悬浮卡片、ECDICT 本地音标释义、AI 语境释义、Anki 导出、JSON 备份。
