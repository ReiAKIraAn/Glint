# Glint Safari Personal Edition — Final Report (项目最终收口与发布候选报告)

## 1. Project Scope (项目定位与范围定义)

Glint Safari Personal Edition 是为 macOS 平台的 Safari 浏览器（优先适配 Safari Technology Preview）量身定制的轻量、隐私优先、Safari/WebKit 原生架构的英文生词标注与流式 AI 辅助阅读扩展。

### 核心定位边界 (Canonical Scope Definition)
- **目标操作系统**: macOS (当前测试基准环境 macOS 27.2)。
- **目标浏览器**: Safari / Safari Technology Preview (当前测试基准 Release 253)。
- **产品形态**: 单用户个人版 (Personal Edition)，纯本地离线词典 + BYOK (Bring Your Own Key) 云端大模型流式释义。
- **架构哲学**: Safari/WebKit-first 架构（采用原生 `CSS.highlights` 纯文本上色、WeakRef 节点引用、Shadow DOM 原生样式隔离、原生 Web Speech API 离线发音、精简 Provider Adapter 架构）。
- **非目标与显式排除范围 (Explicit Non-Goals)**:
  - 不支持 iOS / iPadOS（移动端 WebKit 交互与扩展架构迥异）；
  - 不发布至 Chrome Web Store / Firefox Add-ons / Edge Store；
  - 零远程遥测与埋点 (Zero Telemetry)；
  - 零中心化账号体系与云端同步数据库；
  - 零商业化基础设施。

---

## 2. Current Commit & Baseline (代码基线与演进记录)

```text
Final Release Candidate HEAD:  Current Working Tree (Production Code Strictly Frozen)
Audit Closure:                e1bf003 docs(m5): add feature parity closure audit
Boundary Audit:               cdc50bb docs(m5): audit Safari boundary capabilities
Dynamic Web Acceptance:       a164791 docs(m5): close dynamic web robustness milestone
Dynamic Web Regression:       b5d6b43 test(safari): complete dynamic web regression verification
Dynamic Web Fixes:            462f564 fix(safari): harden dynamic scanner lifecycle
Dynamic Web Baseline:         f3c2d12 test(safari): establish dynamic web robustness baseline
Provider Adapter Acceptance:  f7012ad docs(m5): close provider adapter architecture acceptance
Provider Adapter Regression:  a2817a2 docs(m5): record provider adapter safari regression verification
Provider Adapter Refactor:    4fece3e refactor(safari): introduce provider adapter architecture
M5-W2 Verification Closure:   7ddae36 docs(m5): complete M5-W2 verification closure and reporting corrections
M5-W2 AI Persistence:         42cccf7 feat(safari): persist AI explanations locally
M5-W1 Native Offline TTS:     9068d13 feat(safari): restore native offline TTS
```

- **Production Source Changes**: **0** (`git diff -- src/ = 0`, 生产源码严格冻结).
- **Automated Test Suite**: **368 / 368 PASS** (0 failed, 0 skipped).
- **TypeScript Strict Check**: **0 errors** (`pnpm exec tsc --noEmit`).
- **Safari MV3 Build**: **PASS** (总包体积 5.92 MB).

---

## 3. Milestone History (里程碑演进历程)

1. **Milestone 1 — Core Scanning & CSS Highlights**:
   - 移植 CEFR-J (A1~B2) 与 Octanove (C1~C2) 词典分词算法；
   - 实现 Safari 原生 `CSS Custom Highlight API` (`::highlight(glint-mark)`) 无侵入文本着色与 WeakRef 弱引用解耦。
2. **Milestone 2 — Hover Card & Shadow DOM Architecture**:
   - 实现 220ms 悬停反查定位（`caretPositionFromPoint` + `resolveTextCaret`）；
   - 使用 `<glint-card>` 单例 Shadow DOM 实现原生样式沙箱与纯 `textContent` 安全渲染。
3. **Milestone 3 — Least-Privilege Permissions & Offline Dict**:
   - 实现 Safari 最小权限模型（`host_permissions = []`，用户手势按需单域授权）；
   - 将 3.76MB 离线词库与考纲收敛至扩展包本地。
4. **Milestone 4 — Streaming Typewriter & Abort Lifecycle**:
   - 基于 Anthropic SSE 原生协议实现实时增量流式打字机；
   - 建立完备的 `AI_ABORT`、超时兜底与多标签页并发通道隔离。
5. **Milestone 5 / Workstream 1 — Native Offline TTS Restoration**:
   - 恢复卡片音标旁原生发音小喇叭；
   - 基于 Web Speech API 严格筛选 `localService === true` 本地离线语音，零权限零网络请求。
6. **Milestone 5 / Workstream 2 — AI Explanation Persistence**:
   - 确立隐私最小化数据契约：`local:explanations` 严格限定 `{ word, explanation, updatedAt }` 三项字段；
   - 实现 2,000 条稳定 LRU 淘汰机制与 Background Service Worker 单向持久化写入。
7. **Milestone 5 / Workstream 8 — Provider Adapter Architecture**:
   - 引入静态编译期 `ProviderRegistry` 与 `ProviderAdapter` 接口抽象；
   - 将 Anthropic 专有网络/SSE 逻辑收敛至 `AnthropicAdapter`，解除通用调度层硬编码。
8. **Milestone 5 / Workstream 5 — Dynamic Web Robustness**:
   - 修复合法零生词页面引发的无谓全量重扫死循环 (`RISK-01`);
   - 引入 `pruneContainedNodes` 祖先/后代包含剪枝，根治嵌套 DOM 突变重复扫描与高亮重叠 (`RISK-03`);
   - 实测建立 >250 条突变风暴全量回退性能基准 (`RISK-02: DEFERRED`).
9. **Milestone 5 / Workstream 6 — Boundary Capability & Feature Parity Audit**:
   - 验证第三方 Shadow DOM 与 iframe 不透明隔离策略的稳健性 (`INTENTIONALLY BOUNDED`);
   - 系统化核对 20 项功能特性，确认收口清单无真阻断缺陷 (`PASS WITH KNOWN OPTIONAL GAPS`).
10. **Milestone 5 / Workstream 7 — Final Closure & Release Candidate**:
    - 完成代码冻结核查、安全/隐私/性能综合审定与最终发布候选归档。

---

## 4. Feature Parity Matrix (功能对等全景矩阵)

对标 Original Glint (Upstream Chrome `main` 分支):

| 功能模块 / 特性 | 行为对比与实现 | 证据类型 | 最终状态 (Status) |
| :--- | :--- | :---: | :---: |
| **CEFR 单词扫描识别** | 按 A1~C2 难度过滤、词形还原、缩写/代码黑话过滤；WeakRef 防止内存泄漏 | Automated (50+ tests) + Real Safari | **COMPLETE** |
| **国内考纲静音/备考** | 中考、高考、四级、六级、考研静音；备考模式交集过滤 | Automated + Real Safari | **COMPLETE** |
| **CSS Custom Highlight 高亮** | `::highlight(glint-mark)` 着色；双轨容灾机制 (`adoptedStyleSheets` + `<style>`) | Automated + Real Safari | **COMPLETE** |
| **光标生词命中反查** | `caretPositionFromPoint` + `resolveTextCaret` 元素边界文本解析 | Automated + Real Safari | **COMPLETE** |
| **悬浮卡片展示本地词典** | 单例 DOM + ShadowRoot 原生隔离 + 纯 `textContent` 安全渲染，零 innerHTML | Automated + Real Safari | **COMPLETE** |
| **熟词标记与动态消词** | 点击“✓ 认识”全站消词并存盘，当前与后续页面即时去高亮 | Automated + Real Safari | **COMPLETE** |
| **原生离线发音 (TTS)** | 点击小喇叭调用系统预装离线语音朗读，零网络流量，切换排空队列 | Automated (TTS-01..10) + Real Safari | **COMPLETE** |
| **AI 流式打字机** | Anthropic SSE 增量推流 + rAF 帧合并 + textContent 安全写入 | Automated (E2E-01..14) + Real Safari | **COMPLETE** |
| **AI 请求主动取消与隔离** | 点击“取消”即刻释放底层 reader，多标签页 Port 独立通信与状态隔离 | Automated + Real Safari | **COMPLETE** |
| **AI 释义本地持久化** | 2000 条 LRU 缓存，同词优先秒显，底层 storage 写入故障容错 | Automated (CACHE-01..20) + Real Safari | **COMPLETE** |
| **AI 缓存重新生成 (Redo)** | 缓存命中后直接展示释义，当前未在卡片上提供二次重新生成按钮 | Inspection | **INTENTIONALLY DEFERRED** |
| **AI 释义结构化排版** | 采用纯原生 `textContent` 纯文本打字机流式输出，杜绝 Markdown/HTML 注入 | Inspection | **INTENTIONALLY SIMPLIFIED** |
| **Anki 笔记导出** | 恪守隐私决议 D3=NO，坚决不持久化用户浏览原句，故禁用该导出 | Inspection + UI Assertion | **INTENTIONALLY EXCLUDED** |
| **多服务商生态 (BYOK)** | Provider Adapter 架构解耦完备，Anthropic 已实现，第二服务商按指示暂不实现 | Automated (ADAPTER-01..14) | **COMPLETE WITH KNOWN LIMITATION** |
| **动态单域权限申请** | 最小权限原则 (`host_permissions = []`)，选项页用户手势驱动单域授权与回收 | Automated + Real Safari | **COMPLETE** |
| **键盘导航与遍历** | `Alt+G` / `Alt+Shift+G` 遍历并钉住卡片，`Esc` 关闭；macOS Option 键平台约束 | Automated + Real Safari | **COMPLETE WITH KNOWN LIMITATION** |
| **工具栏弹窗 (Popup)** | 同步 `page:stats` 高亮词数查询，主开关、域名黑名单联动、等级调节 | Automated + Real Safari (Manual) | **COMPLETE** |
| **动态网页增量扫描** | 局部子树与 Text 脏节点增量扫描，零生词守卫与祖先剪枝，突发回退机制 | Automated (DW-01..15) + Real Safari | **COMPLETE WITH KNOWN LIMITATION** |
| **Shadow DOM 边界隔离** | 第三方 open/closed Shadow DOM 不穿透，扩展自身卡片隔离且零观察者递归 | Automated (SHADOW-01..07) + Real Safari | **INTENTIONALLY BOUNDED** |
| **iframe 边界隔离** | `window.top !== window.self` 顶层守卫 + `OPAQUE_TAGS` 拒绝，零跨 Frame 消息 | Automated (IFRAME-01..06) + Real Safari | **INTENTIONALLY BOUNDED** |

---

## 5. Intentional Differences (与原版架构的主动差异说明)

1. **AI 释义纯文本流式渲染 vs 结构化 JSON 模版 (`INTENTIONALLY SIMPLIFIED`)**:
   - 原版 Chrome 使用 Vercel AI SDK 非流式返回 JSON，前端拼装多个 DOM 标签。
   - Safari 版升级为真实 SSE 流式打字机，采用纯原生 `textContent` 增量追加。此举不仅规避了第三方 Markdown 解析库带来的 XSS 注入风险，还消除了 WebKit 在高频流式推流下的样式重排与 DOM 抖动开销。
2. **Anki 笔记导出禁用 (`INTENTIONALLY EXCLUDED`)**:
   - 原版 Chrome 在本地存储中明文记录用户阅读网页的完整原句 (`sentence`)。
   - Safari Personal Edition 在 M5-W2 中执行了隐私强化：`local:explanations` 仅允许存储 `{ word, explanation, updatedAt }`，严禁保存用户访问的原句与上下文。用户正式裁决 **D3 = NO**。由于无原句数据，Anki 导出被明确隔离并提示不支持。
3. **第二服务商推迟实现 (`INTENTIONALLY DEFERRED`)**:
   - M5-W8 建立了通用的 `ProviderAdapter` 架构，将网络通信与 SSE 逻辑彻底从核心解耦，并完成了 `AnthropicAdapter` 的生产验证。
   - 第二服务商（OpenAI、Gemini 等）按项目范围收窄指令暂不引入实现代码，架构已完全具备后续低成本接入能力。
4. **第三方 Shadow DOM 与 iframe 封闭隔离 (`INTENTIONALLY BOUNDED`)**:
   - 遵循 Web 标准与浏览器安全沙箱边界，TreeWalker 不穿透 Web Components 内部封装，内容脚本不在 iframe 中初始化。

---

## 6. Boundary Policy (隔离与边界策略归档)

根据 M5-W6 Step 1 的深度审计与 25 项专有测试验证：
- **Top-level document**: 完整支持标准 Light DOM 散文分词与高亮。
- **Third-party open/closed Shadow DOM**: 保持不透明，不主动穿透；内部突变不触发顶级 MutationObserver 唤醒。
- **iframe (same-origin / cross-origin / nested)**: 保持不透明，`OPAQUE_TAGS` 拦截，`window.top !== window.self` 阻断执行。
- **Glint Card ShadowRoot**: 仅用于扩展卡片 UI 的样式封装与 DOM 隔离，MutationObserver 首行过滤阻断任何自反馈递归。

---

## 7. Security Review (安全架构最终审定)

通过静态代码依赖审计、产物解包审查与全量自动化安全用例核验：

1. **凭据单向隔离 (Credential Isolation)**:
   - API Key 独占保存于 Background Service Worker 的 `local:apiKeys` 中。
   - Content Script 生产产物中彻底移除任何 API Key、Header 鉴权逻辑或服务商客户端代码。
2. **凭据零泄露 (Zero Credential Leakage)**:
   - 校验确认：API Key **绝不进入页面 DOM 树**；**绝不进入 Content Script UI**；**绝不进入 AI Prompt 语境**；**绝不出现在请求 URL 或 Query 参数中**；在日志与错误呈现中一律经过 `redactSecrets` 强力脱敏为 `[REDACTED]`。
3. **DOM 注入防护 (XSS Surface Mitigation)**:
   - 悬浮卡片所有展示内容（单词、变形、音标、释义、例句、错误信息）一律使用原生 `.textContent` 写入。
   - 全代码库彻底消除 `innerHTML`、`outerHTML` 与 `eval()`，消除脚本注入通道。
4. **通信沙箱安全性 (IPC Boundary)**:
   - 页面与后台通信仅采用强类型单向消息与 WebExtension Port 长连接，零 `window.postMessage`，零跨 Frame 消息穿透。
5. **最小权限原则 (Least-Privilege)**:
   - `manifest.json` 中 `host_permissions` 声明为空数组；外部云端服务商域名仅在用户保存配置时通过用户手势进行单域动态授权。

> **安全审定结论**:
> **No security issue identified in the audited scope.**

---

## 8. Privacy Review (隐私保护最终审定)

1. **持久化数据契约 (Privacy Contract)**:
   - 最终本地存储 `local:explanations` 每条记录仅包含：
     ```ts
     {
       word: string;
       explanation: string;
       updatedAt: number;
     }
     ```
2. **敏感信息绝对排除 (Strict Exclusions)**:
   - 确认绝不自动持久化：用户浏览的完整网页正文、段落原句 (`sentence`)、上下文 (`context`)、网页标题 (`title`)、网页 URL、用户光标选区 (`selection`)、Tab 信息或历史记录。
3. **历史污染清洗 (Sanitization)**:
   - 实现了 `sanitizeExplanationStore`，在扩展启动与读写时自动过滤并清洗包含原句或旧版 `analysis` 的受污染条目。
4. **零远程回传 (Zero Telemetry)**:
   - 扩展无任何分析 SDK、行为打点或第三方追踪脚本，网络流仅在用户显式触发时直连配置的服务商 API。

> **隐私审定结论**:
> **PASS — Privacy-first data contract fully preserved.**

---

## 9. Performance Evidence (性能证据与已知限制)

### 量化基准数据
- **初始全量扫描耗时**: `56.96 ms` (约 400 生词).
- **增量扫描路径 (`records.length <= 250`)**:
  - 1 条突变: `48.34 ms`
  - 10 条突变: `54.49 ms`
  - 50 条突变: `89.48 ms`
  - 100 条突变: `179.18 ms`
  - 250 条突变: `566.24 ms`
- **突变风暴全量回退路径 (`records.length > 250`)**:
  - 251 条突变: `~907.53 ms`
  - 500 条突变: `~2290.35 ms`
  - 1000 条突变: `~7086.57 ms` (触发 2500 MAX_TOKENS 硬上限熔断)
- **大规模 DOM 树基准**:
  - ~10,000 DOM 节点：初始扫描约 `88 ms`。
  - ~50,000 DOM 节点：深度树遍历完成，无堆栈溢出。
- **边界突变观察者开销**:
  - Open ShadowRoot 50 节点插入：主文档 observer 唤醒 **0 次**。
  - iframe 独立文档 50 节点插入：主文档 observer 唤醒 **0 次**。
  - Glint Card 50 次内部修改：增量扫描 **0 次**（首行守卫阻断）。

### 性能声明与限制规范
- **已知性能限制 (Known Performance Limitation)**:
  - 单批次突变超过 250 条时回退至 `run()`，在大规模 DOM 页面上存在明显的 TreeWalker 主线程遍历开销。此项在 M5-W5 中维持现状（DEFERRED）。
- **未验证项声明 (Unverified Claims Policy)**:
  - **Formal Long Task timeline tracing**: 无头 CLI 测试环境下无法获取真实 WebKit Performance Timeline 分片连续追踪，标记为 **UNVERIFIED**。
  - **JSC 堆内存与 GC 绝对证明**: 标记为 **UNVERIFIED**（准确陈述：*No observed monotonic growth in the tested token/highlight/card state across the tested cycles. Formal heap/GC leak verification was not available.*）。

---

## 10. Real Safari Technology Preview Evidence (实机验证记录)

### 实机测试环境
- **操作系统**: macOS 27.2 (Build 26B5091g)
- **浏览器**: Safari Technology Preview Release 253
- **CFBundleShortVersionString**: 27.0
- **CFBundleVersion**: 22626.1.8.19.2
- **WebKit SourceVersion**: 7626001008019002
- **Latest STP Status**: **UNVERIFIED** (运行于本地已安装版本，未核验 Apple 官方最新发布状态).

### Critical-Path 用户全链路回归 (RC-01 至 RC-13)
| 编号 | 关键交互路径 | 实测表现 | 判定 |
| :--- | :--- | :--- | :---: |
| **RC-01** | Core scan | 静态长文标准生词分词精准，代码块黑话自动跳过 | **PASS** |
| **RC-02** | Highlight | CSS Custom Highlight 文本高亮上色正常，无 DOM 节点包裹侵入 | **PASS** |
| **RC-03** | Vocabulary card | 悬停生词秒级弹出 Shadow DOM 卡片，本地 5.7 万词离线字典即时展示 | **PASS** |
| **RC-04** | Native TTS | 点击发音喇叭正常触发本地离线语音朗读，零网络请求 | **PASS** |
| **RC-05** | AI streaming | 点击“✨ AI 解释”发起流式网络请求，平滑打字机逐字输出 | **PASS** |
| **RC-06** | AI cancellation | 流式期间点击“取消”即刻掐断网络 reader 并退出 loading 态 | **PASS** |
| **RC-07** | AI cache hit | 已解释生词再次点击优先命中 `local:explanations`，网络面板 0 请求 | **PASS** |
| **RC-08** | SPA navigation | 单页虚拟路由切换后词元全部安全重置，新页面重新扫描 | **PASS** |
| **RC-09** | Dynamic mutation | 动态插入段落或列表增量捕获新词，已存在词元不闪烁 | **PASS** |
| **RC-10** | Permissions | 设置页输入 API Key 用户手势触发单域权限申请，拒绝时安全阻断 | **PASS** |
| **RC-11** | Popup | 工具栏点击展开弹窗，当前页面高亮词数与黑名单状态准确呈现 | **PASS (Manual)** |
| **RC-12** | Shadow DOM boundary | 第三方 open/closed Shadow DOM 保持不透明，卡片自身样式完全隔离 | **PASS** |
| **RC-13** | iframe boundary | 同源/跨域/广告 iframe 保持不透明，零跨 Frame 消息与零 AI 调用 | **PASS** |

---

## 11. Test Coverage & Inventory (测试资产清单)

全项目共有 **368 项** 自动化测试，分布于 16 个测试套件中，通过率 **100% (368/368 PASS)**：

1. **核心算法与生命周期**:
   - `scan.test.ts` (14 项): 词形还原、考纲静音、代码标识符过滤、专有名词与缩写判定。
   - `lemma.test.ts` (1 项) & `lemma-cases.ts`: 词形还原与不规则动词变化表覆盖。
   - `sentence.test.ts` (11 项): 标点断句、缩写点号容错、单句上下文裁剪。
   - `token-lifecycle.test.ts` (3 项): WeakRef 弱引用持有、Detached DOM 节点安全访问、增量失效清理。
2. **高亮与交互**:
   - `highlight.test.ts`: CSS Custom Highlight API 双轨容灾机制。
   - `hover-card.test.ts` & `card-side.test.ts`: 悬停防抖、坐标反查、上下自适应选边。
   - `weakmap-hover.test.ts` (2 项): HoverTracker WeakMap 索引存储与排空。
   - `tts.test.ts` (10 项): TTS-01..10 原生离线语音筛选、朗读、取消、无障碍与容灾。
3. **AI 流式与适配器**:
   - `ai-stream.test.ts` & `ai-port.test.ts`: SSE 事件流解析、UTF-8 跨 chunk 解码、Abort 信号链路。
   - `provider-adapter.test.ts` (14 项): ADAPTER-01..14 接口契约、静态注册表、网络归一化、超时与字符超限。
   - `m4-e2e.test.ts` (14 项): E2E-01..14 全链路端到端流式推流、并发隔离、卡片隐藏与页面导航清理。
4. **存储与持久化**:
   - `explanation-cache.test.ts` (20 项): CACHE-01..20 缓存读写、LRU 淘汰、串行化队列、历史污染清洗。
   - `m5-w2-verification.test.ts` (7 项): VC-07..08 同毫秒稳定截断、506KB 载荷测算、50 读写并发串行化。
   - `settings.test.ts` & `backup.test.ts`: 设置默认值补齐、JSON 备份与恢复。
5. **动态网页韧性 (Dynamic Web)**:
   - `dynamic-web.test.ts` (15 项): DW-01..15 SPA 路由、增量追加、嵌套剪枝、属性忽略、10k/50k 大 DOM 压力。
   - `mutation-stress.test.ts` (3 项): 500 次动态增删、100 次打字机微更新、50 次无限滚动批处理压力。
6. **安全与权限**:
   - `security-redaction.test.ts` (12 项): URL 零密钥、控制台/错误脱敏、Content Script 消息零凭据。
   - `permission-architecture.test.ts` (12 项): 最小权限原则、单域授权、权限拒绝与吊销状态。
   - `site.test.ts` (7 项): 域名规范化、子域联动关闭匹配规则。
7. **边界能力审计**:
   - `boundary-audit.test.ts` (25 项): SHADOW-01..07, IFRAME-01..06, BOUNDARY-DW-01..10, 性能度量与凭据隔离。

---

## 12. Known Limitations (已知限制汇总)

1. **大批量 Mutation 突发全量重扫性能退化 (`RISK-02`)**:
   - 单批次突变超过 250 条时回退至 `run()`，在超大规模 DOM 页面上存在明显的 TreeWalker 遍历耗时。该策略在功能层面确保了数据一致性，但极端大批量突发存在性能损耗。
2. **WebKit Service Worker 慢流生命周期边界**:
   - 在极端慢流或长时间空闲下，WebKit Service Worker 存在被系统冻结或挂起的潜在风险。当前已通过应用层 60s 硬超时兜底，坚决不引入伪造心跳等 keep-alive hack。
3. **macOS 平台快捷键约束**:
   - 在 macOS 上 `Alt` 键即 `Option` 键，在文本输入区域可能与系统特殊字符输入（如 `Option+G` -> `©`）产生平台级键位冲突。
4. **形式化 Long Task 追踪与堆快照未自动化验证**:
   - 无头自动化测试环境下缺少毫秒级 WebKit Performance Timeline 分片连续追踪以及底层 JavaScriptCore GC 真实回收证明。
5. **Safari Technology Preview 版本权威性**:
   - 实测环境为 STP Release 253，该版本是否为 Apple 当前发布的最新版本保持为未验证状态。

---

## 13. Optional Post-Closure Work (发布收口后可选演进项)

以下项目均属于**非阻断性**的可选演进方向，明确列为收口后（Post-Closure）规划：
1. **AI 卡片“重新生成” (Redo) 按钮**: 在展示缓存的卡片 UI 上增加可选重调按钮，方便用户强制刷新释义。
2. **多服务商第二实现落地**: 在已完备的 `ProviderAdapter` 架构下，逐步实例化 `OpenAiAdapter` 或 `GeminiAdapter`。
3. **macOS 快捷键自定义指引**: 在选项页或说明文档中增设 macOS Safari 扩展快捷键设置指南。

---

## 14. Build Artifact Review (构建产物审定)

执行 `pnpm exec wxt build -b safari --mv3` 产物结构如下：

```text
.output/safari-mv3/
  ├─ manifest.json                1.18 kB   (MV3 标准清单，host_permissions 为空)
  ├─ options.html                 13.11 kB  (设置与配置中心)
  ├─ popup.html                   3.02 kB   (工具栏浮窗)
  ├─ background.js                813.65 kB (Service Worker，包含 AnthropicAdapter 与 Key 管理)
  ├─ chunks/links-BnowTkuk.js     15.91 kB
  ├─ chunks/options-CwNUdxL2.js   510.81 kB
  ├─ chunks/popup--WtrLse4.js     2.30 kB
  ├─ content-scripts/content.js   496.91 kB (前台内容脚本，零 API Key 依赖)
  ├─ assets/options-B4eJbnxl.css  15.40 kB
  ├─ assets/popup-BfmTgoaj.css    7.65 kB
  ├─ data/dict.json               3.76 MB   (5.7 万词离线字典)
  ├─ data/exams.json              261.36 kB (考纲词表)
  └─ icon/ (16/32/48/128)         16.55 kB  (应用矢量图标)
Σ Total size: 5.92 MB (构建耗时约 550ms)
```

- **Manifest 验证**: 符合 Safari WebExtension MV3 标准规范。
- **无多余调试文件**: 生产包中无 sourcemap、无测试文件、无临时日志。

---

## 15. Git & Repository Hygiene (版本库整洁度审定)

- **Working Tree**: clean (零未暂存文件、零未跟踪冗余文件).
- **Whitespace / Linting**: `git diff --check` 通过，无行尾空白或换行异常。
- **No Secrets / Credentials**: 全仓库已验证无任何真 API Key 或明文私密信息写入。

---

## 16. Final Closure Decision (最终收口裁决)

```text
=============================================================================
         RELEASE CANDIDATE — READY WITH DOCUMENTED LIMITATIONS
=============================================================================
```

### 决议依据 (Rationale):
1. **核心工作流 100% 畅通**: 分词扫描、文本高亮、悬浮卡片、本地词典、离线发音、AI 流式推流、主动取消、本地持久化缓存、动态增量扫描全链路功能完备，无崩溃无阻塞。
2. **生产代码严格冻结**: `src/` 生产代码零变动，代码质量经过全量 368 项自动化测试与 TypeScript 严格检查验证。
3. **架构边界清晰严密**: 第三方 Shadow DOM 与 iframe 设立了深思熟虑的产品边界；最小权限与 Background 凭据单向隔离彻底消除了明文泄漏风险。
4. **已知限制透明归档**: 完整量化并如实记录了大批量突发回退性能开销、WebKit Service Worker 生命周期及测试环境边界，不作未经证实的过度断言。
5. **候选收口清单无真阻塞项**: `MUST FIX BEFORE CLOSURE = NONE`。

**Glint Safari Personal Edition 正式达到 Release Candidate (发布候选) 状态，准备进行最终签收。**
