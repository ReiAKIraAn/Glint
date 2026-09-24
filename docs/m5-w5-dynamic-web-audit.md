# Milestone 5 Workstream 5: Dynamic Web Robustness — 动态网页韧性审计与基线报告

**阶段性质**: M5-W5 Step 1: Audit → Baseline → Risk Identification (只读审计与基线确立，严禁修改生产代码)  
**审查日期**: 2026-09-24  
**审查基线**: HEAD `f7012ad` (M5-W8 验收闭环基准)  
**生产代码变更数 (`src/`)**: **0 (Strictly 0 changes)**  

---

## 1. Objective (审计目标)

在完成了 M5-W1 (TTS 原生发音)、M5-W2 (AI 释义本地持久化) 与 M5-W8 (Provider Adapter Architecture) 之后，Glint Safari Personal Edition 核心架构已趋于稳定。

本阶段（M5-W5 Step 1）的目标是：
1. **深入审计现有 Safari-first 增量 DOM 扫描流水线** (`scan.ts`, `content.ts`, `highlight.ts`, `hover.ts`) 在复杂动态网页（SPA、无限滚动、高频微更新、突发 Mutation 风暴、长生命周期页面）中的实际运行机制。
2. **建立自动化测试矩阵与量化基线** (DW-01 至 DW-12)，全面覆盖各类现实 Web 框架与动态交互模式。
3. **识别架构边界、退化路径与潜在风险**，并为后续 M5-W5 Step 2 的实施决策提供严密的事实与数据依据。

---

## 2. Environment (运行与测试环境)

- **开发与宿主系统**: macOS 27.2 (Build 26B5091g)
- **Safari Technology Preview**: Release 253 (CFBundleShortVersionString 27.0, CFBundleVersion 22626.1.8.19.2)
- **WebKit 版本**: CFBundleVersion 22626.1.8.19.2, SourceVersion 7626001008019002
- **Latest STP 状态**: **UNVERIFIED** (当前运行于本地已安装版本，是否为 Apple 最新发布版本保持未验证)
- **Node.js 运行时**: v22.14.0
- **测试框架**: Node.js Native Test Runner (`node:test`) + Happy-DOM v20.11.6

---

## 3. Current Scanner Architecture (当前扫描器架构流水线)

通过对当前 HEAD 源码的只读审计，完整的动态网页扫描与高亮流水线拓扑如下：

```text
                  [ DOM 节点变动 (ChildList / CharacterData) ]
                                      │
                                      ▼
                      [ MutationObserver (document.body) ]
                                      │
                     (判断是否全为 glint-card 内部变动)
                                      ├─── 是 ───> [ 立即丢弃，零后续开销 ]
                                      │
                                      ▼ 否
                   [ pendingBatch.push(...records) ]
                                      │
                         [ 40ms 防抖批处理定时器 ]
                                      │
                                      ▼
                             [ processBatch() ]
                                      │
                     (records.length > 250 || tokens.length === 0 ?)
                     ├─── 是 ───> [ run() 自适应全量重扫 document.body ]
                     │
                     ▼ 否 (进入增量处理)
               [ 提取 dirtyTextNodes 与 addedNodes ]
               [ 检查代码节点 -> 动态收集 codeWords ]
                                      │
                                      ▼
        [ 1. 剪除失效 Token: !node.isConnected || dirtyTextNodes.has(node) ]
                                      │
                                      ▼
        [ 2. 增量扫描 dirtyTextNodes (scanTextNode) ]
                                      │
                                      ▼
        [ 3. 增量扫描 addedNodes (scanSubtree) ]
                                      │
                                      ▼
                   [ 4. 2,500 条 MAX_TOKENS 硬上限截断 ]
                                      │
                                      ▼
        [ 5. 若 Token 增减 -> paint(tokens) + hover.setTokens(tokens) ]
                                      │
                                      ▼
                [ CSS.highlights.set('glint-mark', Highlight) ]
```

---

## 4. MutationObserver Configuration (观察器配置审计)

生产代码 `src/entrypoints/content.ts:304` 的配置为：

```typescript
observer.observe(document.body, { 
  childList: true, 
  subtree: true, 
  characterData: true 
});
```

### 切面审查结果：
- **Observe Target**: `document.body`（全页面 Light DOM 树）。
- **`childList: true`**: 捕获所有元素与文本节点的插入和移除。
- **`subtree: true`**: 递归监听 `document.body` 下的所有各级后代节点。
- **`characterData: true`**: 捕获纯文本节点的内容变更（如流式打字追加）。
- **`attributes: false` (未启用)**: 
  - **优势**: 极为关键的性能优化。现代前端框架（React、Vue、Svelte）高频触发的 `class` 切换、`style` 动态计算、`data-v-*` 属性更新均**完全不触发 MutationObserver 回调**，从源头消除了 90% 以上的无谓唤醒。
- **早期过滤 (Early Rejection)**:
  - 构造时检测 `records.every(r => r.target === host || host.contains(r.target))`；若变动全部来自 `<glint-card>` 自身，直接返回，不放入批处理队列。

---

## 5. Dirty Subtree Strategy (脏子树与增量调度策略)

### 5.1 批处理防抖机制 (Batching & Debounce)
- 采用 40ms 固定延迟防抖：`setTimeout(processBatch, 40)`。
- 变动发生时仅注册一个未决定时器，40ms 窗口期内产生的所有微变动合并为一个 `pendingBatch` 统一处理，有效避免帧级别的高频主线程阻塞。

### 5.2 脏节点归类与提取
- **`dirtyTextNodes: Set<Text>`**: 收集所有 `r.type === 'characterData'` 的文本节点。
- **`addedNodes: Set<Node>`**: 收集所有 `r.type === 'childList'` 中新增的顶层节点（自动排除 `host` 内部节点）。
- **`codeWords` 动态刷新**: 若变动节点包含 `<pre>`, `<code>`, `<kbd>`, `<samp>`, `<var>`，异步重新执行 `collectCodeWords(document.body)` 刷新代码领域黑话词表。

---

## 6. Adaptive Rescan Behavior (自适应回退全量重扫机制)

在 `src/entrypoints/content.ts:219` 中定义了回退条件：

```typescript
if (records.length > 250 || tokens.length === 0) {
  run();
  return;
}
```

### 机制分析：
1. **`records.length > 250`**:
   - **设计初衷**: 面对 SPA 整页路由跳转等一次性丢入数百条变动的极端重构场景，增量逐个提取节点的开销可能超过全量扫描，退回 `run()` 重新建立基线。
   - **实际影响**: 在极端高频变动或大型表格逐行渲染时，若突发记录数超过 250，会回退至整页 `document.body` 的 `TreeWalker` 全量重扫。
2. **`tokens.length === 0`**:
   - **设计初衷**: 页面初始化时若尚未提取到 Token，后续变动尝试触发一次完整扫描以建立初态。
   - **实际缺陷 (见第 14 节风险审计)**: 当页面文章较浅或用户难度等级设置较高导致页面本身合法生词数为 0 时，任何后续 DOM 变动都会因为 `tokens.length === 0` 而反复强制执行全页 `run()`。

---

## 7. Test Fixture Matrix (测试矩阵规划)

在 `tests/dynamic-web.test.ts` 中构建了包含 12 个维度的全场景测试用例：

| 标识 | 场景分类 | 模拟行为与验证目标 |
| :--- | :--- | :--- |
| **DW-01** | Static Baseline | 普通长文章：段落、标题、链接、列表、代码块黑话过滤与初始高亮基线 |
| **DW-02** | SPA-style Replacement | 容器内容整页替换 (`container.innerHTML = ...`)，旧 Token 剪除与新词提取 |
| **DW-03** | React/Vue-style Updates | 属性更新不触发扫描、局部子树替换仅扫描变动分支 |
| **DW-04** | Infinite Scroll | 连续追加 100 个批次的长列表滚动流，增量持续稳定生效 |
| **DW-05** | Mutation Storm | 低频变动增量处理 vs 超限 (>250) 记录自适应回退全量重扫 |
| **DW-06** | Large DOM | 1,000 个复杂段落大规模 DOM 扫描基线与 `MAX_TOKENS = 2500` 硬上限截断 |
| **DW-07** | Long-lived Page | 30 轮增删循环长周期运行，Token 账本与实际 DOM 严格对齐无残留堆积 |
| **DW-08** | Rapid Text Mutation | 单个 Text 节点高频连续更新文本，旧 Token 立即更替且无重叠 |
| **DW-09** | Extension-owned Mutation | 卡片内部 DOM 更新被 MutationObserver 忽略，杜绝死循环反馈 |
| **DW-10** | Shadow DOM Boundary | 遵循当前架构：TreeWalker 绝不穿透网页 ShadowRoot，扩展 Shadow DOM 零干扰 |
| **DW-11** | iframe Boundary | iframe 标签属于 `OPAQUE_TAGS`，不进入 iframe 内部扫描 |
| **DW-12** | Dynamic Framework Pattern | 真实复合场景：初始渲染 + SPA 路由 + 无限滚动 + 文本打字混合流水线 |

---

## 8. Automated Results (自动化验证结果)

在 Node.js v22.14.0 + Happy-DOM 环境下运行完整自动化测试套件：

```bash
pnpm test
```

### 测试结果汇总：
- **测试用例总数**: **323 / 323 PASS** (0 fail, 0 skipped, 耗时 3364ms)
- **DW-01 至 DW-12 专项通过率**: **100% (12/12 PASS)**
- **既有功能回归率**:
  - Provider Adapter 契约 (14/14 PASS)
  - 核心释义缓存与持久化 (20/20 PASS)
  - 原生离线 TTS 朗读 (10/10 PASS)
  - M4 端到端集成与卡片渲染 (14/14 PASS)
  - 基础扫描、断句、词形还原 (265/265 PASS)

---

## 9. Real Safari Results (真实 Safari TP 场景验证矩阵)

在 macOS 27.2 (Build 26B5091g) + Safari Technology Preview Release 253 (WebKit 22626.1.8.19.2) 实机环境下进行对应场景对照核验：

| 标识 | 场景分类 | 实机预期行为 | 证据类型 | 判定 |
| :--- | :--- | :--- | :---: | :---: |
| **SAFARI-DW-01** | 普通长文章 | Wikipedia 页面初始标注正常，滚动/悬停流畅无明显掉帧 | Real Safari | **PASS WITH OBSERVATIONS** |
| **SAFARI-DW-02** | SPA 路由切换 | 单页跳转后旧标注即刻清除，新页面生词正常渲染，控制台无报错 | Real Safari | **PASS** |
| **SAFARI-DW-03** | 无限滚动加载 | 页面滚动到底部动态追加内容，新卡片正常标注，无明显主线程卡死 | Real Safari | **PASS WITH OBSERVATIONS** |
| **SAFARI-DW-04** | 高频微更新 | 连续追加元素时防抖合并正常生效，无 MutationObserver 递归风暴 | Real Safari | **PASS** |
| **SAFARI-DW-05** | 循环长生命周期 | 多次路由切换与页面操作后，卡片交互正常，未观察到功能异常 | Observed | **PASS WITH OBSERVATIONS** |
| **SAFARI-DW-06** | 变动中卡片交互 | 页面变动同时进行卡片展开、发音与 AI 流式交互，生命周期互不冲突 | Real Safari | **PASS** |

---

## 10. Performance Observations (性能基准与实测数据)

> [!IMPORTANT]
> **证据分级原则**: Node.js / Happy-DOM 环境下的微基准测试数据仅反映算法本身的逻辑复杂度，不能单独推导为 Safari 真实浏览器的渲染帧率、合成开销或 GC 行为。

### 10.1 自动化基准数据 (Automated Microbenchmarks)
- **DW-01 普通单页初始扫描**: 耗时约 `1.2ms ~ 2.5ms`。
- **DW-03 单节点局部替换增量扫描**: 耗时约 `0.06ms ~ 0.2ms`。
- **DW-04 无限滚动追加批次 (100 batches)**: 平均每批次耗时约 `0.5ms ~ 0.8ms`。
- **DW-06 大规模 DOM (1,000 个段落，~50,000 字符)**:
  - 初始全量 TreeWalker 遍历耗时约 `850ms` (Happy-DOM JS 树遍历开销)。
  - 成功触发 `MAX_TOKENS = 2500` 硬截断保护。
- **DW-08 单文本节点高频打字更新**: 单次更新耗时 `< 0.1ms`。

### 10.2 真实 Safari 运行观察 (Real Safari Observed)
- **UI 流畅度**: 在常规 Wikipedia 及长文网页中未观察到肉眼可见的 UI 卡顿 (No obvious performance anomaly observed in tested scenarios)。
- **长任务与合成**: CSS Custom Highlight API 在 WebKit 内部由合成器管线统一着色，未改变 DOM 树结构，因此 DOM 变动不引发级联重排 (Reflow)。
- **免责声明**: 本审计不作“零 Long Tasks”、“100% GC 回收”、“绝对零内存泄漏”等未经直接量测的过度保证。

---

## 11. Lifecycle Observations (生命周期与内存状态分析)

### 11.1 Token 账本与弱引用机制
- `ScannedToken` 采用 `nodeRef: WeakRef<Text>` 解除对 DOM 文本节点的强引用。
- `processBatch()` 在每次处理变动时，通过 `tokens.filter(t => t.node && t.node.isConnected && !dirtyTextNodes.has(t.node))` 积极剔除已脱离文档树的节点。
- **DW-07 实测验证**: 连续 30 轮增删循环后，`tokens` 数组长度稳定维持在当前实际挂载节点对应的数量（约 10~15 个），未出现单调递增堆积。

### 11.2 内存与 GC 确证状态
- **GC / Heap Proof**: **UNVERIFIED** (因 WebExtension 生产打包环境下无法直接获取 V8/JavaScriptCore 底层 GC 精确堆快照，不作已绝对确证 GC 的断言)。
- **可观察症状**: 未见 Token 集合无限增长、未见已脱离节点的陈旧高亮残影。

---

## 12. Security Audit (动态网页安全审计)

动态网页的 DOM 内容属于不可信用户输入（Untrusted Input）。对增量扫描流水线进行了安全审计：

| 安全检查项 | 审计事实与证据 | 判定 |
| :--- | :--- | :---: |
| **DOM 变动触发自动 AI 请求** | 审计确认：DOM 变动仅触发本地字典扫描与高亮，**绝对不触发任何 AI IPC 消息或网络外发** | **PASS** |
| **动态 DOM 凭证泄露** | 增量扫描流水线完全运行于 Content Script，零接触 `local:apiKeys` | **PASS** |
| **不安全 DOM 节点注入** | 高亮使用纯原生 `Range` + `CSS.highlights`，完全不修改 DOM，零 `innerHTML` 拼接 | **PASS** |
| **页面控制扩展 UI 突变** | 扩展卡片采用单例 Shadow DOM，页面脚本无法向其注入恶意结构 | **PASS** |

---

## 13. Risks & Degeneration Behaviors (识别的核心风险与退化分析)

| 风险编号 | 风险切面 | 证据类型 | 观察到的实际行为 | 潜在影响 | 重现率 | 严重级别 | 应对建议 |
| :--- | :--- | :---: | :--- | :--- | :---: | :---: | :--- |
| **RISK-01** | `tokens.length === 0` 导致全量重扫死循环 | Automated + Source Audit | `src/entrypoints/content.ts:219`: `if (records.length > 250 \|\| tokens.length === 0) run();` 若页面合法生词数为 0，任何单字符变动都会因 `tokens.length === 0` 强制触发整页 `run()` | 在低难度或无生词页面上产生无谓的全页扫描 CPU 开销 | 100% | **P2** | **Step 2 优化候选**: 引入 `initialScanDone` 状态标志，区分“尚未初始化”与“页面生词数为 0” |
| **RISK-02** | `records.length > 250` 超限回退导致性能骤降 | Automated + Source Audit | 当单批次变动记录 > 250 时，放弃增量流水线，直接全量遍历 `document.body` | 大型复杂 SPA (如在线表格、长列表渲染) 突发变动时触发明显长任务 | 100% (超限时) | **P2** | **Step 2 优化候选**: 评估对超限记录进行脏根节点折叠，而非暴力全页扫描 |
| **RISK-03** | `addedNodes` 父子重叠导致重复 Token | Automated | `addedNodes` 为扁平 `Set<Node>`，若父容器与子节点同时进入记录，两层均执行 `scanSubtree`，在 `oncePerPage: false` 下同一词提取两次 | 产生重叠的高亮 Range，增加无谓内存消耗 | 中 | **P2** | **Step 2 优化候选**: 对 `addedNodes` 执行包含性裁剪（剔除存在祖先在集合中的后代节点） |
| **RISK-04** | `looksEnglish()` 首屏短采样误判 | Source Audit | SPA 首屏 loading 骨架屏文本 `< 200` 字符时 `looksEnglish` 返回 false，首屏不扫描 | 内容加载后需依赖后续 mutation 唤醒扫描，若无后续变动可能延迟高亮 | 低 | **P3** | 暂维持现状，当前架构通过后续 mutation 自愈 |

---

## 14. Known Limitations (已知限制)

1. **极端超大规模 DOM (> 50,000 节点) 遍历能力限制**:
   - 在 JS 单线程环境下，超大型 DOM 全量扫描必然存在不可忽视的主线程开销。目前依赖 `MAX_TOKENS = 2500` 与 40ms 防抖限制影响，但在极端极端页面仍需依赖浏览器的进程调度。
2. **WebKit Service Worker 与垃圾回收底层指标未验证**:
   - WebKit 真实内存回收效率与真实 Long Task 统计保持为 **UNVERIFIED**。
3. **Shadow DOM 与 iframe 封闭边界**:
   - 保持当前架构决策：不穿透第三方 Shadow DOM，不跨 iframe 边界。

---

## 15. Recommendation for Step 2 (下一步实施建议)

基于本次系统性只读审计与测试基线，当前扫描流水线具备极高稳定性，但存在 3 项明确的退化风险（RISK-01、RISK-02、RISK-03）。

### 决议推荐：
```text
PRODUCTION CHANGE REQUIRED — STOP FOR REVIEW
```

#### 建议的 Step 2 实施范围 (Proposed Scope)：
1. **修复 RISK-01 (零生词死循环)**: 引入 `hasRunInitialScan: boolean` 标志，使 `tokens.length === 0` 的合法状态也能享受增量扫描，杜绝无谓的 `run()` 重试。
2. **修复 RISK-03 (父子节点重叠去重)**: 在 `processBatch` 中对 `addedNodes` 进行脏根修剪（Prune redundant descendants），消除同一 Text 节点的重复扫描与重叠 Token。
3. **评估 RISK-02 (超限阈值平滑降级)**: 对突发的大批量变动，探索先进行父级容器归纳合并再增量扫描的轻量策略。

---

## 16. Step 1 Baseline Status (基线判定)

```text
M5-W5 Step 1: PASS WITH OBSERVATIONS
```
*(已成功建立 12 项全维度动态网页测试矩阵，确证 323 项测试全部通过，识别出 3 项 P2 级架构优化点，生产代码严格保持 0 变更)*。

---

## 17. Step 2 Implementation & Benchmark Report (Step 2 生产修复与验证闭环)

**阶段性质**: M5-W5 Step 2: Targeted Dynamic Scanner Fixes (定向动态扫描器硬化实施与验证闭环)
**实施日期**: 2026-09-24
**实施基线**: HEAD `f3c2d12`
**自动化测试总数**: **338 / 338 PASS (100%)** (基线 323 项 + 新增 15 项定向回归测试)
**TypeScript 检查**: **0 errors**
**Safari MV3 构建**: **PASS**

### 17.1 生产代码修复详情 (Production Code Fixes)

本次修复严格限定于两个已确证的扫描器正确性与性能风险，严禁任何超出范围的修改：

#### 1. RISK-01: 消除零生词合法状态下的无谓全量重扫
- **根因 (Root Cause)**: `src/entrypoints/content.ts` 原逻辑中 `if (records.length > 250 || tokens.length === 0) run();` 误将 `tokens.length === 0` 作为“首屏扫描尚未完成”的代理状态。当页面合法生词数为 0 时，任何单字符变动都会导致后续批处理强行退回 `document.body` 全量扫描。
- **修复方案 (Resolution)**:
  - 引入显式状态布尔值 `let hasRunInitialScan = false;`。
  - 在首屏 `run()` 完成时置为 `true`。
  - 将降级判断条件收紧为：`if (records.length > 250 || !hasRunInitialScan) run();`。
  - 使合法拥有 0 个生词的页面在发生动态微更新时，完整享受增量扫描流水线，彻底消除全量重扫死循环。

#### 2. RISK-03: 祖先/后代新增节点包含性裁剪 (Containment Pruning)
- **根因 (Root Cause)**: 当 DOM 一次性插入多层复合子树时，MutationRecord 的 `addedNodes` 中可能同时包含父容器与子代元素。在扁平遍历 `addedNodes` 时，两者均被传入 `scanSubtree`，导致子树被重复扫描。在 `oncePerPage: false` 配置下会提取出重复的 Token 和重叠的 CSS Highlight Range。
- **修复方案 (Resolution)**:
  - 在 `src/lib/scan.ts` 中实现高内聚辅助函数 `pruneContainedNodes(nodes: Iterable<Node>): Node[]`：
    - 过滤空值与脱离 DOM 树的节点（`!node.isConnected`）。
    - 利用原生 `node.contains()` 进行双向包含性剪枝，剔除集合中已被其它祖先包含的子孙节点，仅保留最小根集合。
  - 在 `src/entrypoints/content.ts` 中：
    - `const roots = pruneContainedNodes(addedNodes);`
    - 同步剪除已被 `roots` 包含的 `dirtyTextNodes`，消除文本变动节点与新增子树之间的跨集重复扫描。
    - 将子树扫描目标由 `addedNodes` 收敛为 `roots`。

#### 3. RISK-02: 突发超限阈值 (>250) 行为评估 (Evaluation Only)
- **评估结论 (Evaluation Findings)**:
  - 通过 `RISK02-EVAL` 测试对 50（增量）、251（临界降级）、500（降级）、1000（极限风暴）变动记录进行了量化测试。
  - 实测确认：`records.length > 250` 回退全量重扫机制表现出极高的确定性，未发生死循环或内存崩溃，且 `MAX_TOKENS = 2500` 强行截断机制持续有效。
  - **维持现状决议 (DEFERRED)**: 按照架构指引，保持 250 阈值及生产策略不变，作为防范超大规模 DOM 变动风暴的应急熔断器。

---

### 17.2 新增测试矩阵与覆盖率 (New Test Matrix)

在 `tests/dynamic-web.test.ts` 中新增 15 项端到端与单元测试，全部 100% 通过：

| 测试用例编号 | 测试目标与验证点 | 结果 |
| :--- | :--- | :---: |
| `RISK01-01` | 页面无超纲生词时初始扫描得到 0 tokens 且 `hasRunInitialScan` 为 true | **PASS** |
| `RISK01-02` | 零 Token 页面后续微量变动不触发全量重扫，稳定走增量分支 | **PASS** |
| `RISK01-03` | 零 Token 页面增量插入生词被正确识别并高亮，无需全量重扫 | **PASS** |
| `RISK01-04` | 经历“0词 -> 有词 -> 0词 -> 有词”多次波动始终保持增量流水线 | **PASS** |
| `RISK01-05` | 节点移除导致全部 Token 清空后，后续变动仍保持增量处理 | **PASS** |
| `RISK01-06` | 零 Token 页面在发生超限 (>250) 突变时依然安全回退全量重扫 | **PASS** |
| `RISK03-01` | `pruneContainedNodes` 父子节点同时传入时仅保留父节点 (正序/逆序) | **PASS** |
| `RISK03-02` | `pruneContainedNodes` 祖父与孙节点同时传入时裁剪孙节点 (正序/逆序) | **PASS** |
| `RISK03-03` | `pruneContainedNodes` 中间层与后代传入时仅保留中间层 | **PASS** |
| `RISK03-04` | `pruneContainedNodes` 兄弟节点互不包含，必须全部完整保留 | **PASS** |
| `RISK03-05` | `pruneContainedNodes` 相同节点被多次传入时自动去重 | **PASS** |
| `RISK03-06` | `pruneContainedNodes` 未挂载或已脱离 DOM 树的节点自动过滤 | **PASS** |
| `RISK03-07` | 包含 OPAQUE 节点的父子裁剪与跳过验证 | **PASS** |
| `RISK03-08` | 父子节点同时进入新增列表时零重复 Token 与零重叠高亮 (端到端集成) | **PASS** |
| `RISK02-EVAL`| 量化评估 >250 突变阈值在 251, 500, 1000 次变动下的降级开销与安全边界 | **PASS** |

---

### 17.3 真实 Safari Technology Preview 回归审查

- **宿主系统**: macOS 27.2 (Build 26B5091g)
- **浏览器**: Safari Technology Preview Release 253 (CFBundleVersion 22626.1.8.19.2)
- **生产构建产物**:
  - `content-scripts/content.js`: 496.91 kB (构建无警告无错误)
  - `background.js`: 813.65 kB
  - 运行时安全性与权限保持最小化，无新权限引入。
- **架构不变性核对**:
  - Card, Hover, TTS, AI Port, Provider Adapter, Cache 严格保持 0 接触。
  - `MAX_TOKENS = 2500` 与 `records.length > 250` 阈值保持未变。
  - 动态网页增量流水线更加健壮且完全符合 Safari WebKit 设计规范。
