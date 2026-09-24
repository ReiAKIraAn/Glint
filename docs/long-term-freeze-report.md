# Glint Safari Personal Edition — Long-Term Technical Sign-Off & Freeze Report

## 1. Final Baseline Commit (最终技术基线提交)

- **Audit Baseline Commit**: `87cbb5aeacbbb2f0d9b13a2d9c9af0b7202628ab` (`docs(m5): correct final closure evidence wording`)
- **Production Source Changes**: **0** (`git diff -- src/ = 0`, 生产源码严格冻结)
- **Branch**: `safari-personal`

---

## 2. Test Results (全量自动化测试结果)

- **测试套件数量**: 16 个测试套件 (`tests/*.test.ts`)
- **测试用例总数**: **368 项**
- **通过率**: **全量通过 (368 / 368 PASS)**
  - `pass`: 368
  - `fail`: 0
  - `skipped`: 0
  - `cancelled`: 0
- **执行耗时**: 约 46.1 秒 (`duration_ms: ~46084ms`)

---

## 3. Build Results (可复现生产构建结果)

执行命令：`pnpm exec wxt build -b safari --mv3`
- **构建状态**: **PASS** (耗时约 596 ms)
- **总包体积**: **5.92 MB**
- **产物文件清单**:
  ```text
  .output/safari-mv3/
    ├─ manifest.json                1.18 kB   (MV3 规范清单，host_permissions 声明为空数组)
    ├─ options.html                 13.11 kB  (选项设置与权限管理页面)
    ├─ popup.html                   3.02 kB   (工具栏快捷弹窗界面)
    ├─ background.js                813.65 kB (Service Worker，包含 ProviderRegistry 与 AnthropicAdapter)
    ├─ chunks/links-BnowTkuk.js     15.91 kB
    ├─ chunks/options-CwNUdxL2.js   510.81 kB
    ├─ chunks/popup--WtrLse4.js     2.30 kB
    ├─ content-scripts/content.js   496.91 kB (前台内容脚本，零 API Key 依赖)
    ├─ assets/options-B4eJbnxl.css  15.40 kB
    ├─ assets/popup-BfmTgoaj.css    7.65 kB
    ├─ data/dict.json               3.76 MB   (5.7 万词离线字典)
    ├─ data/exams.json              261.36 kB (国内考纲词表)
    └─ icon/ (16/32/48/128)         16.55 kB  (应用矢量图标)
  ```
- **构建环境版本**:
  - `Node`: v22.14.0
  - `pnpm`: 10.34.5
  - `WXT`: 0.21.4
  - `Vite`: 8.3.0
  - `TypeScript`: 5.9.3

---

## 4. Dependency State & Reproducibility (依赖状态与可复现性)

- **Lockfile 锁定状态**: `pnpm-lock.yaml` 严格保持最新，执行 `pnpm install --frozen-lockfile` 0 差异跳过解析，依赖树 100% 确定。
- **无隐式运行时依赖**: 生产运行时仅依赖浏览器标准 Web API（CSS Highlights, Web Speech, WebExtension, Fetch, DOM）；构建依赖与测试依赖收敛于 `package.json` 中的 `devDependencies`。
- **依赖审计结论**: 依赖项完整固化，长期放置无需任何网络拉取或未固定版本重解。

---

## 5. Architecture Verification (架构一致性核准)

经过对全部源码与文档的对照审查：
- **Content Script**: 严格收敛于页面分词扫描、CSS Custom Highlight 着色、坐标命中反查、Shadow DOM 词汇卡片呈现、本地离线 TTS 与 WebExtension Port 通信。代码中彻底不持有任何凭据。
- **Background Service Worker**: 独占负责提供商凭据读取、动态单域权限请求中转、离线词典加载、大模型 SSE 推流与主动取消。
- **Provider Adapter**: 架构已完成接口解耦与静态注册；生产环境中仅激活并实现了 `AnthropicAdapter`，第二提供商推迟实现。
- **架构文档归档**: 详见最新 [`docs/final-architecture.md`](file:///Users/ada/Downloads/glint-main/docs/final-architecture.md)。

---

## 6. Security Verification (安全机制审定)

通过全仓库安全关键字静态遍历与 12 项安全自动化测试核验：
1. **凭据隔离边界**: API Key 仅在 Background Service Worker 内存中按需读取，绝不进入 Content Script 产物或内存；
2. **传输与上下文边界**: 凭据绝不出现在请求 URL 或 Query 参数中；绝不通过 UI 消息发送；绝不注入页面 Light DOM 或 Shadow DOM 树；
3. **脱敏保护**: 日志与报错信息中所有敏感字符串经 `redactSecrets` 脱敏为 `[REDACTED]`；
4. **DOM 注入防护**: 悬浮卡片展示文本一律使用原生 `.textContent` 写入，避免 HTML 标记解析；在审计范围内未引入 `innerHTML`、`outerHTML` 或 `eval()`；
5. **最小权限**: `host_permissions: []`，仅在用户显式配置提供商时通过用户手势进行单域动态申请。

> **安全审定结论**:
> **No security issue was identified in the audited credential, DOM rendering, messaging, permission, and AI request paths.**

---

## 7. Privacy Verification (隐私保护审定)

对照隐私契约审查：
1. **零原句记录**: 最终本地持久化缓存 `local:explanations` 仅允许保存 `{ word, explanation, updatedAt }`，绝不持久化用户阅读的网页原句 (`sentence`)、上下文 (`context`)、网页标题 (`title`)、网页 URL 或选区。
2. **历史污染清洗**: `sanitizeExplanationStore` 在扩展启动与读写时自动过滤并清洗任何旧版本遗留字段。
3. **零远程遥测**: 扩展零埋点、零用户行为统计、零第三方分析脚本。
4. **Anki 导出排除**: 恪守 **D3 = NO** 用户决议，坚决隔离 Anki 导出，不向本地存储增加原句存储通道。

> **隐私审定结论**:
> **PASS — Privacy-first data contract fully preserved.**

---

## 8. Storage Contract (存储契约清单)

| Storage Key | 数据结构 | 作用说明 | 敏感级别 | 淘汰策略 |
| :--- | :--- | :--- | :---: | :--- |
| `local:apiKeys` | `Partial<Record<Provider, string>>` | 存储模型服务商 API 密钥 | **高 (凭据)** | 长期保留至用户手动清空；仅后台访问 |
| `local:explanations` | `Record<string, { word, explanation, updatedAt }>` | AI 释义本地缓存 | **无 (纯词典)** | **LRU 上限 2,000 条**；超出时按更新时间淘汰 |
| `local:settings` | `Settings` (阈值/考纲/模型等) | 用户偏好配置 | **无** | 长期保留；缺失字段自动填充默认值 |
| `local:knownWords` | `string[]` | 已认识单词集合 | **无** | 长期保留；集合自动去重 |
| `local:apiKey` | `string` *(Legacy)* | 老版本单 Key 历史存储 | **高** | 启动时一次性迁移至 `local:apiKeys` 后即刻删除 |

---

## 9. Safari/WebKit Dependency Inventory (WebKit 引擎依赖清单)

已在 [`docs/safari-webkit-dependencies.md`](file:///Users/ada/Downloads/glint-main/docs/safari-webkit-dependencies.md) 中完整归档了以下 9 项专有行为：
1. CSS Custom Highlight API (`::highlight(glint-mark)`, `CSS.highlights`)
2. `document.caretPositionFromPoint` 光标字符边界反查
3. Web Speech API 原生离线语音 (`localService === true`)
4. WebKit Service Worker 空闲生命周期与 60s 硬超时兜底
5. Safari WebExtension 用户手势单域授权模型
6. 扩展本地存储 (`browser.storage.local`) 配额与 LRU 控制
7. 隔离世界执行上下文 (Isolated World) 与 `window.top !== window.self` 守卫
8. `<glint-card>` Shadow DOM 样式隔离与递归事件阻断
9. 工具栏弹窗同步应答通信机制

---

## 10. Recovery Scenarios (灾难与异常恢复机制)

已在 [`docs/recovery-guide.md`](file:///Users/ada/Downloads/glint-main/docs/recovery-guide.md) 中归档了 12 种异常场景（热重载、浏览器重启、SW 终止、坏数据注入、401 密钥失效、权限拒绝/撤回、断网离线、用户主动取消、标签页意外关闭、SPA 单页跳转等）下的系统表现与实操恢复指引。

---

## 11. Future Safari Upgrade Procedure (未来 Safari 升级指引)

已在 [`docs/future-safari-upgrade.md`](file:///Users/ada/Downloads/glint-main/docs/future-safari-upgrade.md) 中建立标准化 13 步排查与验证作业流，确立了“**严禁仅因存在更高版本 Safari 而盲目修改生产代码**”的升级原则。

---

## 12. Maintenance Policy (维护与缺陷准入政策)

已在 [`docs/maintenance-policy.md`](file:///Users/ada/Downloads/glint-main/docs/maintenance-policy.md) 中确立了 Critical / Major / Minor 三级缺陷准入标准，并明确将 AI Redo、第二提供商、Anki、Markdown 排版等明确列为“不得自动触发重新开发的非阻断积压项”。

---

## 13. Known Limitations (已知限制全量归档)

1. **大批量 Mutation 突发全量重扫性能退化 (`RISK-02`)**: 单批次突变超过 250 条时回退至 `run()`，在大规模 DOM 页面上存在明显的 TreeWalker 遍历耗时（251 条突变 ≈ 0.91s，500 条 ≈ 2.29s，1000 条 ≈ 7.09s）。
2. **WebKit Service Worker 慢流生命周期边界**: WebKit Service Worker 在极端慢流或长时间空闲下存在被系统挂起的潜在风险，由应用层 60s 硬超时兜底。
3. **macOS 平台快捷键与字符输入合成冲突**: 在 macOS 上 `Alt` 键即 `Option` 键，在文本输入区域可能与系统特殊字符输入（如 `Option+G` -> `©`）产生平台级键位冲突。
4. **第三方 Shadow DOM 与 iframe 封闭隔离**: 第三方 open/closed Shadow DOM 和嵌套 iframe 内容保持完全不透明，不进行穿透扫描与跨 Frame 消息交互。
5. **形式化 Long Task 追踪与堆快照未自动化验证**: 无头自动化测试环境下缺少毫秒级 WebKit Performance Timeline 分片连续追踪以及底层 JavaScriptCore GC 真实代际回收证明。
6. **Safari Technology Preview 版本权威性未独立核验**: 实测环境为本地安装的 STP Release 253，该版本是否为 Apple 当前发布的最新版本保持为未独立核验状态。

---

## 14. Optional Backlog (收口后可选演进项)

1. 在卡片 UI 上提供可选的 AI 释义重新生成 (AI Redo) 按钮；
2. 实例化第二提供商适配器 (`OpenAiAdapter` / `GeminiAdapter`)；
3. 针对 `records.length > 250` 的极端突变风暴探索时间切片 (Time-slicing) 增量遍历；
4. 若未来用户隐私决议调整，再评估符合新契约的生词导出方案。

---

## 15. Evidence Classification (证据分级体系)

- **VERIFIED (形式化验证)**: 368 项自动化测试通过、TypeScript 严格检查 0 错误、MV3 生产打包通过、存储容量与清洗逻辑验证、安全脱敏与权限模型全覆盖。
- **OBSERVED (实机交互观察)**: 在 macOS 27.2 + Safari Technology Preview (Release 253) 环境下实测验证 RC-01 至 RC-13 链路，文本高亮、悬停弹出、离线发音、流式打字、主动取消、同词缓存秒显、SPA 路由重置、Popup 弹窗均真实生效。
- **UNVERIFIED (明确未验证项)**: 毫秒级 WebKit Long Task 连续追踪、底层 JSC 堆快照代际回收分析、以及本地 STP Release 253 相对 Apple 上游最新版本的权威状态。

---

## 16. Final Acceptance Decision (最终签收裁决)

```text
=============================================================================
                 FINAL BASELINE — READY FOR LONG-TERM FREEZE
=============================================================================
```

- **MUST FIX BEFORE CLOSURE**: **NONE**
- **生产代码状态**: **严格冻结 (0 changes to `src/`)**
- **结论**: Glint Safari Personal Edition 已达到完备、自洽、安全、隐私优先且具备长期可恢复性的最终个人专属版本基线，正式进入长期冻结状态。
