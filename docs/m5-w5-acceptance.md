# M5-W5 Dynamic Web Robustness — Milestone Acceptance

## 1. Scope (范围说明)

本文件为 Milestone 5 / Workstream 5 (M5-W5: Dynamic Web Robustness) 的最终架构验收与关闭报告。
本里程碑的目标是审计并强化现有 Safari-first 增量 DOM 扫描流水线在复杂动态网页（SPA 路由切换、无限滚动、局部文本微更新、超限突发风暴、多层复合 DOM 变更）下的正确性、稳定度与性能边界。

## 2. Baseline (里程碑演进基线)

- **Step 1 Audit Baseline**: Commit `f3c2d12` (`test(safari): establish dynamic web robustness baseline`)
- **Step 2 Implementation**: Commit `462f564` (`fix(safari): harden dynamic scanner lifecycle`)
- **Step 3 Verification**: Commit `b5d6b43` (`test(safari): complete dynamic web regression verification`)
- **Step 4 Acceptance**: 当前闭环阶段 (生产代码严格 0 变更，文档与验收归档)

## 3. Step 1 Audit (审计阶段回顾)

- 确立了 DW-01 至 DW-12 自动化基线测试套件。
- 确证生产扫描器架构流水线在常规动态网页下的健康运转。
- 识别出 3 项关键风险：
  - **RISK-01 (P2)**: `tokens.length === 0` 误作为初始化代理，导致合法零生词页面产生无谓的全量重扫死循环。
  - **RISK-02 (P2)**: `records.length > 250` 超限回退全页扫描在突发大批量 DOM 突变时存在性能退化风险。
  - **RISK-03 (P2)**: `addedNodes` 中祖先与后代节点重叠，导致同一子树被多次重复扫描并在 `oncePerPage: false` 下产生重复 Token。

## 4. Step 2 Targeted Fixes (定向生产修复回顾)

严格遵循最小生产修改原则，仅修复具有确凿证据的 RISK-01 与 RISK-03：
1. **RISK-01 修复**: 在 `src/entrypoints/content.ts` 引入显式生命周期状态 `let hasRunInitialScan = false;`，首屏完成后置为 `true`，将降级判断收窄为 `records.length > 250 || !hasRunInitialScan`。
2. **RISK-03 修复**: 在 `src/lib/scan.ts` 引入 `pruneContainedNodes(nodes: Iterable<Node>): Node[]`，使用原生 `node.contains()` 进行祖先包含性裁剪，并在 `src/entrypoints/content.ts` 中剪除被 `roots` 包含的 `dirtyTextNodes`。
3. **RISK-02 评估**: 增加 `RISK02-EVAL` 基准评估，默认不对 250 阈值进行盲目调整，维持现状。

## 5. Step 3 Full Regression (全量回归验证回顾)

- 自动化测试用例由 323 项扩充至 343 项，100% PASS。
- 完整覆盖 DW-01 至 DW-15 全场景。
- 进行了包含 1 至 1000 次变动的阶梯基准评测。
- 开展了 1,000 段落、10,000 节点与 50,000 节点的大规模 DOM 压力测试。
- 执行了 30 轮 SPA 路由、30 轮增删循环与 30 轮深层嵌套替换的长程生命周期验证。

## 6. RISK-01 Status

```text
STATUS: FIXED

Root cause:
tokens.length === 0 was used as an initialization proxy.

Fix:
explicit hasRunInitialScan lifecycle state.

Verification:
automated regression (RISK01-01..06, DW-13) + real Safari zero-token scenarios.
```

## 7. RISK-03 Status

```text
STATUS: FIXED

Root cause:
ancestor/descendant overlap in addedNodes caused duplicate subtree traversal.

Fix:
containment pruning (pruneContainedNodes) + dirtyTextNodes overlap pruning.

Verification:
unit (RISK03-01..07) + integration (RISK03-08, DW-14, DW-15) + real Safari nested mutation scenarios.
```

## 8. RISK-02 Status & Decision Gate

```text
STATUS: DEFERRED

Current behavior:
records.length > 250 triggers full-page fallback.

Evidence:
251 mutations  ≈ 907.53 ms
500 mutations  ≈ 2290.35 ms
1000 mutations ≈ 7086.57 ms

Interpretation:
fallback is functionally stable in tested scenarios,
but large mutation bursts can incur substantial full-scan cost.

Decision:
No threshold or scheduler redesign in M5-W5.

Reason:
Current evidence establishes a performance risk,
but does not establish the correct replacement architecture or threshold.

Future work:
Dedicated scanner scheduling/performance milestone if required.
```

> **架构警示**:
> - 现有证据未证明“250 是最佳阈值”；
> - 现有证据未证明“250 能完全阻止 Long Task”；
> - 现有证据未证明“fallback 是高性能的”；
> - 决定暂不修改是基于“不以未经严密论证的新架构草率替代稳定兜底策略”的工程审慎原则。

## 9. Real Safari Verification (真实 Safari 运行验证)

### 运行环境
- **宿主系统**: macOS 27.2 (Build 26B5091g)
- **浏览器**: Safari Technology Preview Release 253
- **CFBundleShortVersionString**: 27.0
- **CFBundleVersion**: 22626.1.8.19.2
- **WebKit SourceVersion**: 7626001008019002
- **Latest STP status**: **UNVERIFIED** (当前运行于本地已安装版本，未核对 Apple 官方最新发布状态)

### 回归场景表现 (REG-01 ~ REG-15)
- **REG-01 (Static page)**: PASS — 静态 Wikipedia 词汇精准高亮，代码黑话跳过。
- **REG-02 (SPA replacement)**: PASS — 容器整页替换后旧 Token 立即脱落，新生词上色。
- **REG-03 (Incremental subtree)**: PASS — 仅遍历变动分支，attributes 属性变更零唤醒。
- **REG-04 (Infinite scroll)**: PASS — 追加批次平滑提取，无肉眼卡顿。
- **REG-05 (Rapid text mutation)**: PASS — 文本更迭即时响应，旧词无残留。
- **REG-06 (Mutation storm)**: PASS — >250 记录平稳回退全量重扫，无死循环。
- **REG-07 (Zero-token page)**: PASS — 首屏 0 词，后续微更新保持增量流水线。
- **REG-08 (Token lifecycle)**: PASS — 节点被拔除后 Token 集合同步清理。
- **REG-09 (Nested insertion)**: PASS — 包含性裁剪生效，零重复 Token 与零重叠高亮。
- **REG-10 (Code/pre handling)**: PASS — pre/code 内词汇豁免且收录黑话。
- **REG-11 (Extension DOM)**: PASS — glint-card 变动被 MutationObserver 忽略。
- **REG-12 (Shadow DOM boundary)**: PASS — 保持架构决策：不穿透外部 ShadowRoot。
- **REG-13 (iframe boundary)**: PASS — 保持架构决策：iframe 视为不透明标签。
- **REG-14 (Combined dynamic)**: PASS — 首屏+路由+无限滚动+打字复合场景健康运转。
- **REG-15 (Long-lived page)**: PASS — 30 轮循环后 Token 账本与实际挂载节点严格对齐。

## 10. Performance Evidence (最终性能量化证据)

### 扫描与变动扩展性基准 (Step 3 实测数据)
```text
Initial scan:
56.96 ms (fallback/full, tokens: 401)

Incremental path (records <= 250):
1 mutation   : 48.34 ms (tokens: 399)
10 mutations : 54.49 ms (tokens: 409)
50 mutations : 89.48 ms (tokens: 459)
100 mutations: 179.18 ms (tokens: 559)
250 mutations: 566.24 ms (tokens: 809)

Fallback path (records > 250):
251 mutations : 907.53 ms (tokens: 1060)
500 mutations : 2290.35 ms (tokens: 1560)
1000 mutations: 7086.57 ms (tokens: 2500, MAX_TOKENS 硬上限生效)
```

### 大规模 DOM 压力基准
- `~10,000 DOM nodes`: 初始扫描耗时约 `88 ms`。
- `~50,000 DOM nodes`: Traversal completed without stack overflow in the tested scenario. Formal Long Task and heap performance remain unverified.

## 11. Evidence Classification (证据分类法体系)

- **VERIFIED**:
  - 343 / 343 项自动化单元与集成测试全部 PASS；
  - TypeScript strict 模式检查 0 报错；
  - Safari MV3 生产构建 PASS (5.92 MB)；
  - RISK-01 回归行为（零词状态微更新保持增量流水线）；
  - RISK-03 回归行为（复合父子嵌套单次扫描，零重复 Token 与零重叠高亮）；
  - 真实 Safari Technology Preview 核心功能实际运行通过。
- **OBSERVED**:
  - 人工交互与滚动过程中未观察到肉眼可见的 UI 冻结（No obvious UI freeze observed）；
  - 滚动流畅度与视觉高亮对齐正常（Smooth scrolling）；
  - 30 轮长程测试中未见 Token、高亮 Range 或 Card 元素单调递增堆积（No observed monotonic growth in the tested token/highlight/card state across the tested cycles）。
- **UNVERIFIED**:
  - **Formal Long Task timeline tracing**: WebExtension 自动化测试环境下无法直接获取精确 WebKit Timeline 分片追踪；
  - **JavaScriptCore heap snapshot / GC behavior**: 无法获取底层 GC 回收时刻与堆对象释放的确证；
  - **Formal memory leak proof**: 仅基于对象计数未见增长，不作绝对零内存泄漏断言；
  - **Latest STP status**: 本地运行于 Release 253，是否为 Apple 最新版本保持未验证。

## 12. Security Regression (安全边界对账)

| 安全要求 | 实测与证据 | 判定 |
| :--- | :--- | :---: |
| **DOM 变动触发自动 AI 调用** | 严格确认：DOM 变动仅触发本地词表扫描，绝不向 Background 发送 `AI_START`，零自动网络外发 | **PASS** |
| **凭据暴露防范** | 增量扫描逻辑完全运行于 Content Script，零接触 `local:apiKeys`，产物零密钥注入 | **PASS** |
| **不安全 DOM 节点注入** | 原生 `Range` + `CSS.highlights` 上色，彻底消除 `innerHTML` 拼接与 XSS 注入通道 | **PASS** |
| **卡片 Shadow DOM 隔离** | 单例卡片自建隔离 ShadowRoot，页面脚本与样式无法污染或劫持扩展卡片 | **PASS** |

## 13. Feature Parity Matrix (功能对等矩阵更新)

| 功能切面 | 状态 | 说明 |
| :--- | :---: | :--- |
| **Dynamic SPA updates** | **COMPLETE** | 容器内容整页替换时旧 Token 即时脱落，新内容正常高亮 |
| **Incremental subtree scanning** | **COMPLETE** | 局部 DOM 节点增删仅遍历对应变动子树 |
| **Zero-token lifecycle** | **COMPLETE** | RISK-01 修复，零生词页面微更新维持增量流水线 |
| **Nested mutation deduplication** | **COMPLETE** | RISK-03 修复，包含性裁剪消除父子祖孙重复扫描 |
| **Infinite-scroll handling** | **COMPLETE** | 长列表滚动追加批次平稳增量提取 |
| **Mutation storm fallback** | **COMPLETE WITH KNOWN PERFORMANCE LIMITATION** | >250 记录自适应回退全量扫描，超大突变具备性能开销 |
| **Large DOM traversal** | **VERIFIED WITH TESTED LIMITS** | 10k 节点约 88ms，50k 节点无栈溢出，受 2500 MAX_TOKENS 保护 |
| **Shadow DOM traversal** | **BOUNDARY PRESERVED** | 保持架构决策：第三方 Shadow DOM 保持不透明，不予穿透 |
| **iframe traversal** | **BOUNDARY PRESERVED** | 保持架构决策：iframe 标签视为不透明元素，不跨帧扫描 |

## 14. Known Limitations (已知限制归档)

1. **大批量 Mutation 突发全量重扫性能退化 (RISK-02)**:
   - 单批次 Mutation 超过 250 条时回退至 `run()`，在超大规模 DOM 上全量 TreeWalker 遍历存在明显主线程开销。该行为在 M5-W5 中维持现状（DEFERRED）。
2. **形式化 Long Task 追踪与堆快照未验证**:
   - 缺乏真实的 WebKit Performance Timeline 分片度量与 JavaScriptCore 垃圾回收堆快照证明。
3. **Safari Technology Preview 版本权威性未验证**:
   - Release 253 是否为当前 Apple 发布的最新版本保持为 UNVERIFIED。

## 15. Final Acceptance (最终里程碑验收决议)

```text
M5-W5 STATUS: PASS WITH KNOWN LIMITATIONS
```

### 决议依据 (Rationale):
- **RISK-01 fixed and verified**: 引入 `hasRunInitialScan`，彻底消除了零生词页面微更新死循环问题。
- **RISK-03 fixed and verified**: 引入 `pruneContainedNodes` 与脏文本重叠修剪，彻底杜绝了新增多层嵌套节点的重复扫描与重叠高亮。
- **Existing dynamic-web regression suite passes**: 343 / 343 项自动化回归用例 100% 通过。
- **Real Safari dynamic-web scenarios pass**: 在真实 Safari Technology Preview 中完成 15 项动态交互全场景回归。
- **No production regression identified**: Card、Hover、TTS、AI Port、Provider Adapter、Cache、权限模型严格 0 接触与 0 回归。
- **RISK-02 remains deferred**: 现有的 `> 250` 回退机制在功能层面确定且稳定，但大批量突变开销较大；当前证据不足以支撑设计新的替换调度策略，留待专用性能里程碑处置。
- **Formal limitations explicitly retained**: 明确记录 Long Task 与 JSC Heap/GC 的未验证边界，不作过度断言。
- **Latest STP status remains unverified**: 严格如实记录本地环境。
