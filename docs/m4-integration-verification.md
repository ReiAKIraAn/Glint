# Glint Safari Personal Edition — Milestone 4 端到端集成验证与整体验收报告 (M4 Integration & Verification Report)

**审查与测试日期**: 2026-09-24  
**审查阶段**: Milestone 4 / Step 4 — End-to-End Integration Testing & M4 Final Verification  
**性质**: 全链路集成测试、真实平台验证、安全与上下文边界审计  

---

## 1. 验证范围 (Scope)

本阶段对 Milestone 4 产出的全链路进行端到端黑盒与集成测试验证，覆盖：
- **Step 1**: Anthropic SSE 流式网络层 (`src/lib/provider-network.ts`)
- **Step 2**: Background Service Worker Port 调度与多连接隔离 (`src/lib/ai-port.ts`)
- **Step 3**: 悬浮卡片 UI 状态机与 rAF 流式渲染 (`src/lib/card.ts`, `src/entrypoints/content.ts`)
- **Step 4**: 全链路 E2E 场景覆盖 (E2E-01 至 E2E-14)

### 严格冻结的产品契约
- **单一触发入口**: 仅在悬浮卡片内用户显式点击“✨ AI 解释”后触发；hover、卡片打开、页面加载、文本扫描均不产生任何 AI 网络请求。
- **零额外能力**: 无快捷键触发、无自动预取、无重新生成按钮、无持久化/LRU 缓存、单一 Provider (Anthropic)。
- **上下文最小化**: 仅发送目标词 (`word`)、词元原型 (`lemma`) 与当前单句 (`sentenceAround`)，不上传整页 DOM、不跨块级元素、不抓取其他标签页。
- **纯文本输出**: 所有模型生成内容 100% 经由 `.textContent` 写入 Shadow DOM，绝不解析 HTML，零引入 Markdown parser 或第三方依赖。
- **单活动请求原则**: 每个 Port (标签页连接) 严格至多一个活动 AI 请求；不同 Port 独立并发。
- **世代守卫与双端丢弃**: 每个 AI 消息均强制携带 `requestId`，过期或被取消的消息被双端立即丢弃。

---

## 2. 运行与验证环境 (Environment)

* **操作系统**: macOS 27.2 (Build 26B5091g)
* **Safari Technology Preview**:
  - `CFBundleShortVersionString`: 27.0
  - `CFBundleVersion`: 22626.1.8.19.2
  - `ProjectName`: Safari
  - `SourceVersion`: 7626001008019002
  - *注：关于本机安装版本是否为 Apple 最新发布的 STP 版本，当前记录为 `LATEST STP STATUS: UNVERIFIED`*
* **Node.js 运行时**: v22.14.0 (darwin-arm64)
* **打包工具**: WXT 0.21.4 + Vite 8.3.0 (Rollup/Rolldown)
* **构建产物大小**: 5.91 MB (`.output/safari-mv3`)

---

## 3. 代码基线 (Baseline)

* **分支**: `safari-personal`
* **基础 Commit**: `2367332 feat(safari): add streaming AI explanation card`
* **提交链溯源**:
  - `2367332`: feat(safari): add streaming AI explanation card (Step 3)
  - `892cef2`: feat(safari): integrate AI stream with background port (Step 2)
  - `4e6166a`: feat(safari): implement Anthropic SSE provider stream (Step 1)
  - `a89f3a1`: docs(m4): freeze v1 streaming protocol and lifecycle specifications
  - `07d62fa`: docs(m4): establish ai explanation architecture and risk review (ADR 002)

---

## 4. 全链路架构路径核对 (Architecture Path Tested)

针对端到端数据流向与边界控制进行全面审查：

```text
[网页 User Pointer] 
       ↓ (Explicit Click "✨ AI 解释")
[Card UI (card.ts)]
       ↓ (startAi → start({ word, lemma, sentence }, handlers))
[AiStreamClient (ai-port.ts)]
       ↓ (postMessage({ type: 'AI_START', requestId, payload }))
[WebExtension Port IPC (glint:ai-stream)]
       ↓ (port.onMessage)
[handleAiPortConnection (background)]
       ↓ (apiKeysStore 读取 API Key，不进入 IPC 负载)
[fetchProviderStream (provider-network.ts)]
       ↓ (HTTPS POST /v1/messages, Header 鉴权, AbortSignal)
[Anthropic SSE API]
       ↓ (SSE 文本增量分块)
[fetchProviderStream Parser]
       ↓ (onChunk 回调，4000 字符硬限制校验)
[handleAiPortConnection]
       ↓ (safePost({ type: 'AI_CHUNK', requestId, text }))
[WebExtension Port IPC]
       ↓ (port.onMessage)
[AiStreamClient]
       ↓ (requestId 世代校验，丢弃陈旧包，触发 onChunk)
[Card UI]
       ↓ (pendingAiText += text, rAF 节流批处理)
[Shadow DOM (.ai-text)]
       ↓ (textContent 纯文本写入)
[Card Position / Layout] (自适应视口微调)
```

### 关键边界判定审查
1. **输入/输出类型约束**: 所有 IPC 消息仅支持受控的 5 种结构化数据包，纯纯数据对象，无内部 Error 实例传递。
2. **错误向上传播**: 底层网络异常统一通过 `mapProviderError` 映射为标准错误码（`HTTP_ERROR`, `NETWORK_ERROR`, `TIMEOUT`, `PROTOCOL_ERROR`, `RESPONSE_TOO_LARGE`），脱敏后经由 `AI_ERROR` 下发。
3. **取消向下传播**: 用户点击取消触发 `card.abortAi()` → `client.abort()` → 发送 `AI_ABORT` → 后台 `AbortController.abort()` → 立即掐断底层 `fetch` 与 `reader`。
4. **陈旧响应丢弃**: 后台与客户端双层校验 `activeRequestId === forRequestId`，旧请求的残留包被静默丢弃。
5. **凭据隔离红线**: API Key 仅存在于 Background 发起的 Request Header，Content Script、Port IPC、DOM 均无法读取。
6. **不可信文本防护**: AI 生成文本均通过 `.textContent` 写入，不执行 HTML 解析，不解析脚本。

---

## 5. 端到端测试场景矩阵 (Test Matrix)

| 场景编号 | 场景名称 | 测试类别 | 关键验证点 | 判定结论 |
| :--- | :--- | :--- | :--- | :--- |
| **E2E-01** | 正常完整请求 | Integration & STP | Hover 零请求，显式点击发起流式，按序累加并以 `AI_DONE` 收尾 | **VERIFIED** |
| **E2E-02** | 用户主动 Abort | Integration & STP | 点击取消立即进入 aborted 态，AbortController 触发底层停止推流，迟到包完全丢弃 | **VERIFIED** |
| **E2E-03** | 同 Port 请求替换 | Integration & STP | 连续触发生词 A 与 B，A 立即 abort 并判定 stale，B 顺利推流完成且不混入 A 内容 | **VERIFIED** |
| **E2E-04** | 多标签页跨 Port 隔离 | Integration & STP | 两个独立标签页并发流式，Tab A abort 绝不影响 Tab B，双端状态无串扰 | **VERIFIED** |
| **E2E-05** | Token 快速切换 | Integration & STP | 流式进行中鼠标移动到新 Token，旧请求中止，新卡片显示本地词典且不自动启动 AI | **VERIFIED** |
| **E2E-06** | 卡片收起与滚动 | Integration & STP | 卡片隐藏时自动中止活动请求并清理未决 rAF，重新打开不继承旧状态 | **VERIFIED** |
| **E2E-07** | 页面导航与卸载 | Integration & STP | 页面跳转或标签关闭触发 Port disconnect，后台自动释放网络流，无悬挂异常 | **VERIFIED** |
| **E2E-08** | Provider 异常脱敏 | Integration & STP | HTTP 401/403/429/500、网络故障、超时等脱敏展示，无 Key 与堆栈回显 | **VERIFIED** |
| **E2E-09** | 恶意输出纯文本防护 | Integration & STP | `<script>`、`<img onerror>` 100% 作为纯文本转义呈现，无脚本执行与新节点创建 | **VERIFIED** |
| **E2E-10** | API Key 隔离核查 | Integration & STP | 检查 IPC、DOM、window、控制台，确认 API Key 绝未跨越 Background 边界 | **VERIFIED** |
| **E2E-11** | 上下文收敛边界 | Integration & STP | 抓取载荷确认仅含 `word`, `lemma`, `sentence`，无全页 HTML 或无关数据 | **VERIFIED** |
| **E2E-12** | 响应 4000 字符截断 | Integration & STP | 超出 `MAX_RESPONSE_CHARS` 立即中止底层推流，保留局部文本并标记截断 | **VERIFIED** |
| **E2E-13** | rAF 高频打字机合并 | Integration & STP | 100~1000 个高频微小 chunk 经由 rAF 批处理稳定更新，顺序一致且尾部零遗漏 | **VERIFIED** |
| **E2E-14** | 循环生命周期无泄漏 | Integration & STP | 30 轮启动/流式/取消/隐藏/重开，DOM 单例唯一，无状态残留与监听器累积 | **VERIFIED** |

---

## 6. 自动化测试结果 (Automated Test Results)

* **TypeScript 严格类型检查 (`tsc --noEmit`)**:
  - 退出码: `0`
  - 错误数: `0`
* **自动化测试套件全量执行 (`pnpm test`)**:
  - 总测试数: `262` 项
  - 通过数: `262` 项
  - 失败数: `0` 项
  - 耗时: `1627 ms`
* **各专项测试分布**:
  - `tests/highlight.test.ts`: CSS Custom Highlight API 样式与回退验证 (4 项)
  - `tests/hover-card.test.ts`: WebKit 边界 Caret 解析与单例卡片生命周期 (6 项)
  - `tests/provider-network.test.ts`: Provider 最小网络切片与权限架构 (12 项)
  - `tests/ai-stream.test.ts`: Anthropic SSE 流式解析与网络层 (30 项)
  - `tests/ai-port.test.ts`: Background Port 协议调度与跨连接隔离 (54 项)
  - `tests/ai-card.test.ts`: 悬浮卡片 AI UI 状态机与安全渲染 (45 项)
  - `tests/m4-e2e.test.ts`: **M4 全链路端到端集成测试 (14 项全部通过)**
  - 原始词法扫描与增量引擎测试: (97 项全部通过)

---

## 7. Safari Technology Preview 实机验证结果 (Real Safari TP)

*测试环境：macOS 27.2 (26B5091g) / Safari Technology Preview CFBundleVersion 22626.1.8.19.2 (Release 253)*

| 测试场景 | 实测现象记录 | 判定 |
| :--- | :--- | :--- |
| **E2E-01 正常流式** | 悬停 Wikipedia 页面生词“Sediment”，卡片即时弹出本地词典，AI 区域仅展示按钮；点击后变为“取消”并进入 loading；约 400ms 后文字以打字机平滑流出；收到 `AI_DONE` 后取消按钮收起，释义完整呈现，卡片自适应下移。 | **PASS** |
| **E2E-02 用户取消** | 释义生成约 3 行时点击“取消”，流式即刻中断，网络面板显示连接关闭，卡片文字保留当前进度并标记“（已取消）”，未出现迟到文本追加。 | **PASS** |
| **E2E-03 请求替换** | 点击生词 A 的“AI 解释”后快速在同一卡片内触发生词 B，请求 A 立即中止，卡片清空并开始输出生词 B 的释义，未混入 A 的尾部文字。 | **PASS** |
| **E2E-04 多标签隔离** | 在两个 Safari 标签页（Tab 1: Wikipedia Sediment, Tab 2: Geology）同时触发 AI 解释；中途取消 Tab 1，Tab 2 持续平稳输出直至完整结束。 | **PASS** |
| **E2E-05 切换生词** | 生词 A 推流中将鼠标移动至另一生词 B，卡片平滑切换并展示 B 的本地词典，请求 A 中止，AI 区域恢复为未触发状态，无自发外发请求。 | **PASS** |
| **E2E-06 隐藏与滚动** | 推流中向下滑动网页使鼠标离开卡片，卡片平滑淡出，活动流式请求即刻中止；重新悬停生词后卡片展示初始词典，无旧请求内容污染。 | **PASS** |
| **E2E-07 导航与断开** | 推流中直接按下 `Cmd+R` 刷新或跳转页面，原 Port 断开，后台捕获 disconnect 并释放网络连接，控制台无未捕获异常。 | **PASS** |
| **E2E-08 异常脱敏** | 模拟网络离线或 401 鉴权失败，卡片安全展示脱敏后的简明错误，保留已推流内容，无明文 Key、堆栈或未清洗 URL 回显。 | **PASS** |
| **E2E-09 恶意输出转义** | 模拟返回包含 `<script>alert(1)</script>` 与 `<img onerror=...>` 的 payload，卡片按纯文本转义展示字符，Web Inspector 确认无 script 注入与弹窗。 | **PASS** |
| **E2E-10 凭据隔离** | 检查 Web Inspector 的 Elements、Console、Network、Storage，确认 API Key 仅存在于 Background 发起的 Request Header，页面环境完全不可见。 | **PASS** |
| **E2E-11 语境边界** | 检查实际发送的 `AI_START` payload，严格限定为目标词、lemma 与 `sentenceAround` 截取的单句（< 260 字符），无全页 DOM。 | **PASS** |
| **E2E-12 长度超限截断** | 模拟超过 4,000 字符的超长流式响应，卡片在 4,000 字符处安全截断停止，展示长度超限提示，无内存暴涨或页面卡死。 | **PASS** |
| **E2E-13 高频打字机批处理** | 连续快速到达的增量 chunk 视觉呈现平滑自然，无肉眼可见的卡顿或丢字，Web Inspector 确认 DOM 更新合并为帧对齐。 | **PASS** |
| **E2E-14 循环生命周期** | 连续执行 30+ 轮词汇悬停、AI 生成、取消与关闭，页面仅驻留单一 `<glint-card>` 自定义元素，无幽灵卡片与内存悬挂。 | **PASS** |

---

## 8. 安全机制核查 (Security Verification)

1. **凭据安全 (API Key Isolation)**:
   - 存储：API Key 仅存放于 `browser.storage.local` 的 `local:apiKeys` 命名空间。
   - 读取：仅 Background Service Worker 具备读取权限。
   - 传输：直接作为局部变量传入 `fetchProviderStream`，仅在发送给 Anthropic 的 HTTPS POST Header (`x-api-key`) 中体现。
   - 脱敏：`security.ts` 中的 `redactSecrets` 与 `safeErrorMessage` 作为统一安全边界，拦截所有 URL、错误日志与 UI 回显。
   - 判定结论: **VERIFIED**。
2. **不可信文本与 XSS 防护 (XSS Protection)**:
   - 静态审计确认：`src/lib/card.ts`、`src/lib/ai-port.ts`、`src/entrypoints/content.ts` 中针对外部数据与 AI 生成内容的写入全部采用 `.textContent`，完全杜绝 `innerHTML`、`insertAdjacentHTML` 与 `outerHTML`。
   - 判定结论: **VERIFIED**。
3. **权限最小化原则 (Least-Privilege)**:
   - `manifest.json` 保持 `host_permissions: []`。
   - `optional_host_permissions` 仅包含各个具体商业 Provider 域名（如 `https://api.anthropic.com/*`），彻底移除了 `https://*/*` 全站通配符。
   - 判定结论: **VERIFIED**。

---

## 9. 上下文收敛边界核查 (Context Boundary Verification)

- **单句截取算法**: 核心依赖 `src/lib/scan.ts` 中的 `sentenceAround` 与 `sliceSentence`。
- **边界约束核查**:
  - 最大字符上限：`MAX_SENTENCE = 260` 字符，词前保留至多 90 字符，词后保留至多 120 字符。
  - 容器收敛：向上查找受限于最近的块级容器 (`p, li, td, th, dd, dt, blockquote, h1..h6, div`)，严禁跨越父级或同级段落。
  - 特殊符号兼容：包含缩写词表 (`e.g.`, `etc.`, `mr.`) 防断句保护，小数点与域名点号保护。
  - 跨域与隔离：不支持 iframe 穿透，不穿透外部 Shadow DOM。
- 判定结论: **VERIFIED**。

---

## 10. 取消与中止核查 (Abort/Cancellation Verification)

- **UI 触发**: 点击卡片内取消按钮，卡片状态机同步转为 `aborted`，文案变为“（已取消）”。
- **未决 rAF 调度**: `cancelPendingRaf()` 立即释放排队的帧句柄，`flushAiRender()` 排空尾部字符。
- **网络中断**: Content Script 向 Background 投递 `AI_ABORT`，Background 调度器立即执行 `activeAbortController.abort()`。
- **底层资源释放**: WebKit 的 `ReadableStreamDefaultReader` 释放锁并退出循环，底层 TCP/TLS 流式连接即刻关闭。
- **迟到消息阻断**: 无论因 microtask 排队或网络延迟产生何种残留数据包，因 `activeRequestId` 已重置，后续回调全部静默丢弃。
- 判定结论: **VERIFIED**。

---

## 11. 多标签页隔离核查 (Multi-Tab Isolation)

- **连接结构**: 每个 Tab 的 Content Script 与 Background 之间建立独立的 `browser.runtime.Port`。
- **状态存储**: Background 使用 `WeakMap<PortLike, PortState>` 存储连接局部状态，彻底废弃扩展级全局单例。
- **并发与独立**: Tab A 与 Tab B 的推流任务由各自的 Port 独立驱动；Tab A 取消或替换请求，Tab B 的推流不受丝毫影响；Tab A 关闭触发 `port.onDisconnect`，Tab B 连接完全维持。
- 判定结论: **VERIFIED**。

---

## 12. 生命周期稳定性核查 (Lifecycle Verification)

- **DOM 单例复用**: `<glint-card>` 自定义元素在页面中一次性挂载，隐藏时仅切换 `style.display = 'none'`，展示时更新 `textContent`，杜绝重复创建/销毁 DOM 节点。
- **页面卸载清理**: `content.ts` 监听 `pagehide` 事件，统一触发 `card.destroy()` 与 `aiStreamClient.disconnect()`，释放所有引用。
- **循环测试**: 自动化与实机均完成 30+ 轮高频开闭与请求切换，无残留 DOM 元素，无悬挂定时器。
- 判定结论: **VERIFIED**。

---

## 13. 性能观察记录 (Performance Observations)

- **自动化性能测试 (`AUTOMATED PERFORMANCE TEST`)**:
  - `tests/ai-card.test.ts` (Perf 52): 100 / 500 / 1000 个高频微小 chunk 灌入，rAF 批处理稳定更新，耗时 0.65ms。
  - `tests/highlight.test.ts` (Stress 1~3): 500 次动态增删耗时 24.81ms (平均 0.050ms/次)；100 次打字机微更新耗时 2.48ms (平均 0.025ms/次)；50 次长列表滚动耗时 37.21ms (平均 0.744ms/次)。
- **真实 Safari TP 观察 (`SAFARI TP REAL PROFILE`)**:
  - 打字机流式渲染平滑，文本容器自适应展开无明显闪烁与跳跃。
  - 长时间停留与多次展开卡片，Web Inspector Memory 显示无持续上升的脱离 DOM 节点积累。
  - 卡片关闭与生词切换时，无残留的 background task 或未释放的连接。

---

## 14. Service Worker 生命周期与慢流状态 (Service Worker Status)

在当前 Milestone 4 阶段中，对 Safari Technology Preview 的 Service Worker 行为进行审慎核对：
- **正常流式保持 (`NORMAL STREAM`)**: 正常 2~5 秒的 Anthropic SSE 推流过程中，活动的 `ReadableStream` 与持续的 Port 消息交换保持了连接活跃，推流未发生异常中断。判定为 **VERIFIED**。
- **主动断开清理 (`DISCONNECT`)**: 页面导航与标签关闭时，`port.onDisconnect` 及时触发并释放后台资源，无孤儿请求悬挂。判定为 **VERIFIED**。
- **极端慢流与大停顿 (`SLOW-STREAM`)**: 在网络极端缓慢、长达 30 秒以上完全没有收到任何 chunk 的极端异常场景下，WebKit 是否会强杀 Background Service Worker，缺乏明确规范保证。
  - **坚持零 Keep-Alive Hack 原则**: 绝不引入虚假的 `setInterval` 心跳或虚假流量。
  - **客观评级**: 此类极端超长停流状态保持标记为 **`SAFARI TP REAL SLOW-STREAM UNVERIFIED`**。

---

## 15. 已知限制说明 (Known Limitations)

1. **单 Provider 限制**: 当前 v1 契约严格仅支持 Anthropic (Claude 3.5 Sonnet)，不支持其他服务商流式输出。
2. **纯文本无格式**: 输出不支持 Markdown 加粗、列表、表格或高亮语法渲染，仅支持纯文本与段落折行。
3. **无离线缓存**: 生成的释义暂未持久化存盘（不做 LRU 缓存），刷新页面或切换生词后需重新生成。
4. **单句视野**: 仅支持提取目标词所在单句，无法理解整篇文章或跨段落上下文。
5. **Safari 宿主权限限制**: 用户首次在 Options 中配置 Anthropic 时，必须通过一次性用户手势授权 `api.anthropic.com` 域名。

---

## 16. 差异与纠偏核对 (Discrepancies & Audit Corrections)

- **代码与早期草案差异**: 早期概念曾提及全局单个活动请求，Step 2 中已严格纠偏定型为**每个 Port (标签页) 独立一个活动请求**，后台完全支持跨标签页并发；实际代码实现与 ADR-002 完全对齐。
- **测试环境声明**: 明确区分 Node.js Happy-DOM 自动化测试 (`AUTOMATED VERIFIED`) 与 Safari Technology Preview 实机测试 (`SAFARI TP VERIFIED`)，杜绝以纯 Node 结果替代浏览器实测。

---

## 17. 最终分类与判定 (Final Classification)

* **Step 4 验收判定**: **PASS WITH LIMITATIONS**  
  *(核心 E2E 场景 E2E-01 至 E2E-14 全部验证通过，无任何 P0/P1 缺陷；明确标注 SLOW-STREAM 为已知环境限制)*
* **Milestone 4 整体判定**: **PASS**  
  *(Step 1、Step 2、Step 3、Step 4 完整交付，代码与文档完全对齐，工作区 clean)*
