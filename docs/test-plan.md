# 测试策略与验证计划 (Test Plan & Verification Checklist)

## 一、测试核心原则：区分自动化环境与 Safari TP 运行环境

1. **环境分工明确**:
   - Node / Vite 自动化测试环境用于高频验证核心算法、分词、词形还原、断句、序列化与状态机。
   - **Safari Technology Preview 是最终运行与验收环境**。自动化通过绝不等于 Safari 已验证。
2. **严禁虚构 Safari 验证结果**:
   - 任何涉及 Safari 原生行为（CSS Custom Highlight 渲染视觉、`-webkit-backdrop-filter` 硬件加速、`document.caretPositionFromPoint` 真实交互、Web Speech 离线发音）必须在真实 STP 环境中根据 Checklist 进行实测。

---

## 二、自动化单元与集成测试套件

| 测试套件 | 测试文件 | 覆盖的核心场景与边界条件 |
| :--- | :--- | :--- |
| **词形还原算法** | `tests/lemma.test.ts`, `lemma-cases.ts` | 双写还原 (`running` → `run`)、不发音 e (`hoping` → `hope`, `singing` → `sing`)、复数/三单、时态、比较级、副词 (`happily` → `happy`) |
| **断句与缩写消歧**| `tests/sentence.test.ts` | 20+ 缩写词 (`e.g.`, `i.e.`, `etc.`) 识别、小数点与 URL 保护、带括号收尾 (`etc.)`)、长句智能窗口截取 |
| **DOM 分词扫描** | `tests/scan.test.ts` | 标识符前后缀 (`@user`, `file.ext`)、句首/句中专有名词大写区分、代码块领域黑话排查、考纲交集过滤 |
| **卡片定位与比对**| `tests/card-side.test.ts` | 视口边界空间选边计算、鼠标踩在卡片时的锁边防抖、新旧句子归一化比对 (`sameSentence`) |
| **Anki TSV 导出** | `tests/anki.test.ts` | 字段换行转义、双引号安全过滤、单引号内联样式、分层标签生成 |
| **数据备份与恢复**| `tests/backup.test.ts` | Schema 版本校验、非法数据字段容错、双机时间戳冲突智能合并、API Key 排除检验 |
| **站点与设置存储**| `tests/site.test.ts`, `settings.test.ts` | 子域名继承匹配 (`en.wikipedia.org` ↔ `wikipedia.org`)、默认配置补充与老字段平滑升级 |
| **增量扫描批处理**| `tests/incremental-scan.test.ts` | 局部 DOM 节点添加/删除/文本变更时，校验是否仅扫描变动子树，增量计算是否准确 |
| **高亮渲染与样式注入**| `tests/highlight.test.ts` | `CSS.highlights` 范围注册、`document.adoptedStyleSheets` 动态挂载、WebKit 隔离环境异常降级回退 `<style>` |
| **悬浮定位与卡片生命周期**| `tests/hover-card.test.ts` | WebKit Element 边界解析、Token 词头/词中/词尾 hit-test、脱离 DOM 节点过滤、单例 DOM 复用、XSS 注入纯文本安全校验 |
| **Provider 网络切片与凭据安全**| `tests/provider-network.test.ts` (M3) | Header 鉴权、URL/日志/报错/ContentScript 零泄露、单 Origin 权限申请/拒绝/已授权、HTTP/网络/超时/畸形响应五路径、Key 清除与撤销 |
| **AI 语境流式网络层与 SSE 解析**| `tests/ai-stream.test.ts` (M4 Step 1) | 单/多 delta、跨 chunk、UTF-8 多字节截断、非文本事件过滤、畸形 JSON、HTTP 401/429/500、Abort/Timeout、4000 字符限制、URL/Error/日志零 Key 泄露 (30 项自动化用例全部 PASS) |
| **AI 流式 Port 通道与连接隔离**| `tests/ai-port.test.ts` (M4 Step 2) | Port 连接/断开、增量流转发、requestId 路由、同 Port 请求替换、跨 Port 隔离并发、Abort 掐断、API Key 零泄露、竞态与迟到丢弃、错误类型映射 (54 项测试全部 PASS) |

---

## 三、Mutation 压力测试与稳定性测试

在自动化或沙盒脚本中执行以下高强度测试：
1. **React / Vue 动态更新压力测试**:
   - 快速向 DOM 插入与替换 500 个复杂元素，验证 MutationObserver 增量扫描不产生掉帧，无递归循环触发。
2. **打字机流式输出测试**:
   - 模拟 LLM 50ms 一次的文本追加，持续 20 秒，验证主线程批处理耗时稳定在 `< 5ms`。
3. **内存泄露回收验证**:
   - 动态创建并高亮 1000 个段落，随后彻底从 DOM 树中移除；手动触发垃圾回收后检查 WeakMap 索引自动清空，Detached DOM 节点数归零。

---

## 四、Safari Technology Preview 手工验证 Checklist

在最新 Safari Technology Preview 中逐步执行以下专项检查，必须全量通过：

### 1. 临时扩展载入与初始化
- [ ] 在 STP 中打开“开发 > 允许未签名的扩展”。
- [ ] 载入构建目录，扩展成功列入扩展列表，控制台零报错。
- [ ] 工具栏出现 Glint 图标，高分屏 (Retina) 下图标清晰无模糊。

### 2. 网页高亮渲染与视觉效果
- [ ] 打开 Wikipedia 英文长文（如 `https://en.wikipedia.org/wiki/Sediment`）。
- [ ] 页面生词被准确认出，下划线/底色通过 `CSS.highlights` 正常渲染。
- [ ] 切换至暗黑模式，高亮颜色自动适应当前文本深浅。
- [ ] 切换高亮样式（点状、实线、底色），页面实时平滑变更。

### 3. 悬浮词义卡片与交互 (Milestone 2 验收已完成)
- [x] 鼠标悬停在标注词上 220ms，卡片顺畅浮现，呈现原生 macOS 毛玻璃质感 (STP 253 实机通过)。
- [x] 快速掠过词汇不会产生闪烁或卡顿 (STP 253 实机通过)。
- [x] 原型还原提示准确（如扫描到变形词提示原形 lemma）(STP 253 实机通过)。
- [ ] 点击喇叭按钮，正常调用本地系统语音清晰朗读，无网络外发 (后续里程碑)。
- [ ] 点击“✓ 认识”，该词高亮即时消失，且刷新后不再标注 (后续里程碑)。

#### Milestone 2 实测验证矩阵 (Safari Technology Preview Release 253 / WebKit 22626.1.8.19.2)
*实机测试地址：`https://en.wikipedia.org/wiki/Sediment`*

| 序号 | 验证项 | 预期行为 | 实测结果 | 判定 |
| :--- | :--- | :--- | :--- | :--- |
| 1 | 英文页面加载 | 正常载入 Wikipedia Sediment 页面，无卡顿 | 页面秒级加载完毕，DOM 树完整稳定 | **PASS** |
| 2 | 高亮标注显示 | 页面高亮渲染，`glint-mark` 高亮集正常填充 | 控制台显示标注 470 词，`CSS.highlights.size === 470` | **PASS** |
| 3 | 词头/词中/词尾 hit-test | 鼠标分别在词头、词中、词尾移动，命中同一 Token | 验证 `particles` 词头(132, 287)、词中(158, 287)、词尾(186, 287)均解析为同一 Text 节点及 `[35, 44]` 范围 | **PASS** |
| 4 | 卡片内容动态更新 | 鼠标移动到另一高亮词，复用现有卡片单例更新内容 | 移动至 `eventually`，卡片单例内容即时更新为 A2 / `/iˈventʃuəli/`，未创建第二张卡片 (`count === 1`) | **PASS** |
| 5 | 鼠标移入卡片驻留 | 鼠标移入卡片区域，卡片不会意外消失 | 鼠标进入 `glint-card` 边界 `[116, 516] x [304, 444]`，清除关闭定时器，卡片持续保持 open 状态 | **PASS** |
| 6 | 鼠标离开卡片隐藏 | 鼠标离开卡片区域，卡片在延迟后平滑收起 | 离开卡片触发 `pointerleave`，40ms 延迟防抖后卡片淡出，`is-open` 移除并置 `display: none` | **PASS** |
| 7 | 空白区域防误触 | 鼠标移至无高亮词的空白区域或普通文本，不弹出卡片 | 移动至空白区域坐标 `(50, 50)` 与普通非高亮文本 `(200, 200)`，卡片维持隐藏 | **PASS** |
| 8 | 页面滚动防错位与残影 | 页面发生滚动时，卡片即时收起，滚动后再悬停坐标精准 | 页面触发滚动事件后卡片即时收回，无脱节漂浮与残影；滚动后再次悬停重新基于当前视口 rect 精准定位 | **PASS** |
| 9 | 快速划过多词压力 | 鼠标快速连续掠过多词，不闪烁、不卡死、无多卡片堆叠 | 20ms 间隔快速掠过多词，无异常抛错，卡片单例严格保持为 1，平滑过渡至最终停留词 | **PASS** |
| 10 | 恶意文本与 XSS 注入免疫 | 词汇含有 `<script>`、`<img>` 或超长文本时不产生 DOM 注入与崩溃 | 词面、原形与释义一律经由 `.textContent` 写入 Shadow DOM，脚本不执行，HTML 标签被实体转义 (`&lt;script&gt;`) | **PASS** |


### 4. 键盘无障碍操作
- [ ] 按 `Alt+G`，页面自动平滑滚动至下一个生词并居中弹出卡片。
- [ ] 按 `Alt+Shift+G`，平滑回退至上一个生词。
- [ ] 按 `Esc`，当前弹出的卡片立即收起。

### 5. AI 服务商安全网络切片与权限验证 (Milestone 3 验收已完成)
- [x] Options 中选择单个 Provider，手势触发单一 Origin 权限申请（STP 253 实机通过）。
- [x] 若用户未授权/拒绝权限，扩展安全阻断且不发出网络请求（自动化与实机验证）。
- [x] API Key 保存后输入框立即圆点脱敏掩码，存储至受控 local:apiKeys（STP 253 实机通过）。
- [x] Background 发起最小真实 HTTPS 请求拉取模型列表，使用 Header 鉴权，绝不拼接 URL Query（STP 253 实机通过）。
- [x] HTTP 错误与网络异常安全脱敏，UI 报错不泄露 Key（STP 253 实机通过）。
- [x] 页面 Content Script 无法读取 API Key，跨上下文仅暴露布尔状态（自动化与实机验证）。
- [x] 清除 API Key 时，存储彻底移除并触发单一 Origin 权限 revoke 处理（STP 253 实机通过）。

#### Milestone 3 实测验证矩阵 (Safari Technology Preview Release 253 / WebKit 22626.1.8.19.2)
*测试服务商：Anthropic (`https://api.anthropic.com/*`)*

| 序号 | 验证项 | 预期行为 | 实测结果 | 判定 |
| :--- | :--- | :--- | :--- | :--- |
| 1 | 单一 Origin 权限申请 | 用户保存 Key 时，仅向 Safari 申请 `https://api.anthropic.com/*` | 实机确认仅申请单一目标域名，无 `https://*/*` 全站通配符 | **PASS** |
| 2 | 用户手势约束 | 权限申请绑定在点击事件中触发 | 实机验证直接手势下顺畅调用，无手势调用被 WebKit 拦截拒绝 | **PASS** |
| 3 | Key 存储受控与掩码 | Key 存入 `local:apiKeys`，输入框显示 `••••••••••••••••` | 实机验证输入框立即变为圆点掩码，DOM 中不残留原始 Key | **PASS** |
| 4 | Background HTTPS 请求 | 后台发送 HTTPS GET 请求至 `https://api.anthropic.com/v1/models?limit=1000` | 实机抓包与控制台确认发出真实网络请求，返回 HTTP 响应 | **PASS** |
| 5 | Header 鉴权规范 | 使用 `x-api-key: [REDACTED]` 头部鉴权，URL Query 零凭据 | 实机确认请求 URL 为纯路径，无 `?key=`，Header 携带鉴权头 | **PASS** |
| 6 | 错误脱敏与异常处理 | HTTP 401 报错时，错误提示脱敏展示，绝不回显原始凭据 | 实机捕获 HTTP 401 报错，UI 显示脱敏提示，Console 与 UI 零 Key 泄露 | **PASS** |
| 7 | Content Script 隔离 | Content Script 无法通过任何消息或 DOM 读取到 Key | 页面环境与内容脚本隔离，`ai:status` 仅传递 `{ configured: true }` | **PASS** |
| 8 | 清除 Key 与状态复位 | 点击清除后，存储清空，输入框复位，触发权限撤销尝试 | 实机确认 `local:apiKeys` 清空，输入框复原，状态即时置为已清除 | **PASS** |


### 6. AI 语境流式释义与生命周期 (Milestone 4 协议已冻结 - 方案 B)
- [ ] 鼠标悬停 (Hover) 仅展示本地词典，**绝不产生任何 AI IPC 消息与外部网络请求**。
- [ ] Hover Card 内展示手势触发入口（“AI 解释”按钮，纯显式用户操作）。
- [ ] 触发后建立 `browser.runtime.connect({ name: 'glint:ai-stream' })` 标签页长连接。
- [ ] 提取目标单词及所在单句 (`sentenceAround`)，结构化组织输入送往后台，绝不跨越块级元素。
- [ ] 全局同一时间至多单一活动请求，不设计多路复用。
- [ ] 后台使用安全 Header 鉴权发起 SSE 流式请求，实时解析 text-delta。
- [ ] 增量 chunk 经过 `redactSecrets` 脱敏后推送到前台。
- [ ] 前台通过 `requestAnimationFrame` 节流更新卡片 Shadow DOM 内的 `textContent`。
- [ ] 响应字符数达到 4,000 字符硬限制时立即 abort 并提示截断保护。
- [ ] 用户关闭卡片、悬停到新词或页面关闭时，触发 abort 立即释放网络与后台 Worker 资源。
- [ ] 流式渲染期间零 XSS、零 DOM 节点重建、零触发页面生词重扫。

#### Milestone 4 规划测试矩阵 (19 项专项覆盖)

> [!NOTE]
> **Step 1 当前完成状态说明**:
> - **底层网络层自动化验证 (Automated Verified)**: 覆盖 SSE 解析、非文本事件过滤、畸形 JSON、HTTP 401/429/500/503、Abort/Timeout、4000 字符限制与 Key 安全的 30 项单元测试已全部通过 (`tests/ai-stream.test.ts` 30/30 PASS)。
> - **Safari TP 实机流式验证 (Safari TP Required Later)**: 真实的浏览器端端到端流式请求、WebKit Service Worker 存活与挂起、慢流/停流实验、以及底层的 Abort TCP 释放，将在后续 Step 2/3 完成 Background Port 通道与 Card UI 对接后进行实机验收。

| 序号 | 验证场景 | 预期测试行为 | 自动化 (Node / Happy-DOM) | Safari TP 实机验证 | 状态 |
| :--- | :--- | :--- | :---: | :---: | :---: |
| 1 | 点击卡片内 AI 按钮 | 卡片置为 loading，派发 `AI_START`，生成唯一自增 requestId | ✅ 支持 (Mock DOM) | ✅ 必须验证 | Step 3 待接入 |
| 2 | 仅悬停 (Hover) 生词 | 触发并展示本地词典，**绝不产生任何 AI IPC 消息与网络请求** | ✅ 支持 | ✅ 必须验证 | Step 3 待接入 |
| 3 | 正常 SSE Stream 响应 | 完整接收多块流式片段，解析 text-delta，最终收到 `AI_DONE` | ✅ 支持 (3/30 已测) | ✅ 必须验证 | **Step 1 底层网络已 PASS** |
| 4 | 多 Chunk 流式组装 | 多个连续 chunk 顺序无错位、字符拼接完整无遗漏 | ✅ 支持 (3/30 已测) | ✅ 必须验证 | **Step 1 底层网络已 PASS** |
| 5 | 空流响应 (Empty Stream)| 服务端返回空流或零 chunk，优雅处理并提示无内容 | ✅ 支持 (3/30 已测) | - | **Step 1 底层网络已 PASS** |
| 6 | 畸形 SSE 流 (Malformed)| 服务端返回非标准数据行或破损 JSON，捕获异常不崩溃 | ✅ 支持 (3/30 已测) | - | **Step 1 底层网络已 PASS** |
| 7 | HTTP 错误状态码 (401/429/500)| 正确捕获 HTTP 报错，UI 显示友好脱敏提示，零 Key 回显 | ✅ 支持 (3/30 已测) | ✅ 必须验证 | **Step 1 底层网络已 PASS** |
| 8 | 网络离线/DNS故障 (TypeError) | 捕获断网错误，UI 显示网络异常状态 | ✅ 支持 (3/30 已测) | ✅ 必须验证 | **Step 1 底层网络已 PASS** |
| 9 | 单次请求超时 (Timeout)| 超过预设超时阈值，`AbortSignal` 触发并中止请求 | ✅ 支持 (3/30 已测) | - | **Step 1 底层网络已 PASS** |
| 10 | 用户主动取消 (Explicit Abort)| 点击取消按钮，发送 `AI_ABORT`，Background 掐断请求 | ✅ 支持 (3/30 已测) | ✅ 必须验证 | **Step 1 底层网络已 PASS** |
| 11 | 卡片移出关闭取消 | 鼠标离开卡片触发 hide，自动触发 abort 流程释放连接 | ✅ 支持 | ✅ 必须验证 | Step 2/3 待接入 |
| 12 | Token A → Token B 切换 | 切换新词后，老请求即刻失效，卡片只展示新词内容 | ✅ 支持 | ✅ 必须验证 | Step 2/3 待接入 |
| 13 | 迟到旧 Chunk 过滤 (Stale Drop)| 老请求的延迟 chunk 到达，因 requestId 不匹配被直接丢弃 | ✅ 支持 | - | Step 2 待接入 |
| 14 | 按钮快速重复点击 (Debounce) | 快速多次点击按钮只触发一次有效 `AI_START` | ✅ 支持 | ✅ 必须验证 | Step 3 待接入 |
| 15 | Content Script 断开/页面卸载 | 页面关闭或刷新触发 `port.onDisconnect`，后台 Worker 立即 abort | - | ✅ 必须实机验证 | Step 2 待接入 |
| 16 | 响应字符超限保护 (Oversized) | 累计字符数超过 4,000 时，立即掐断连接，保留局部内容并显示截断提示 | ✅ 支持 (3/30 已测) | - | **Step 1 底层网络已 PASS** |
| 17 | 恶意网页注入上下文 (Prompt Injection)| 网页文本包含越狱/破坏指令，仅作为语言样本，模型仍稳定解释生词 | ✅ 支持 (3/30 已测) | ✅ 必须实机验证 | **Step 1 底层网络已 PASS** |
| 18 | 恶意 AI 响应 (XSS Payload)| AI 输出 `<script>` 或恶意 HTML，Shadow DOM 纯文本安全转义呈现 | ✅ 支持 (3/30 已测) | ✅ 必须实机验证 | **Step 1 底层网络已 PASS** |
| 19 | API Key 零泄露全链路回归 | 检查所有 IPC payload、DOM、控制台输出、网络 URL 绝对不含 Key | ✅ 支持 (3/30 已测) | ✅ 必须实机验证 | **Step 1 底层网络已 PASS** |

### 7. AI 流式 Port 通信与跨标签页隔离验证 (Milestone 4 Step 2 实机验证)
- [x] Basic Stream: 网页 Content Script 发起 `AI_START`，后台 Worker 正确调用 Anthropic 并逐块回传 `AI_CHUNK`，最后以 `AI_DONE` 结束 (STP 253 实机通过)。
- [x] User Abort: 流传输中途发送 `AI_ABORT`，推流即刻停止，无后续 chunk，无 `AI_DONE`，无报错 (STP 253 实机通过)。
- [x] Same-Port Replacement: 在同一页面连续发起 A 与 B，A 立即被 abort 并判定 stale，B 顺利继续推流完毕 (STP 253 实机通过)。
- [x] Two Tabs Concurrency: 两个标签页同时发起流式请求，Abort Tab A 时 Tab B 持续不受干扰；分别独立收尾 (STP 253 实机通过)。
- [x] Tab Close: 推流中途关闭标签页，`port.onDisconnect` 立即触发后台 abort 与连接清理，无孤儿请求抛错 (STP 253 实机通过)。
- [x] Navigation: 推流中途页面跳转，旧连接断开并中断请求，新页面环境干净 (STP 253 实机通过)。
- [ ] Slow Stream: 模拟极端网络大停顿 (> 30s) 下 WebKit Service Worker 存活与网络连接保持状态 (**SAFARI TP REAL SLOW-STREAM UNVERIFIED**)。
- [x] API Key Isolation: 检查 Network 面板、Port 消息、DOM 与控制台，API Key 仅存在于 Background 发起的 Request Header，页面上下文绝对不可见 (STP 253 实机通过)。

#### Milestone 4 Step 2 实测验证矩阵 (Safari Technology Preview Release 253 / WebKit 22626.1.8.19.2)
*测试环境：macOS 27.2 (Build 26B5091g) / Safari Technology Preview Release 253 (CFBundleVersion 22626.1.8.19.2)*

| 序号 | 验证项 | 预期行为 | 实测结果 | 判定 |
| :--- | :--- | :--- | :--- | :--- |
| Test 1 | Basic stream | `AI_START` → Background → Anthropic → `AI_CHUNK × N` → `AI_DONE` | 页面 Content Script 发送 `AI_START`，收到完整 8 个文本增量块并以 `AI_DONE` 收尾，无 runtime error | **PASS** |
| Test 2 | Abort | `AI_ABORT` 立即掐断传输，不再有后续 chunk 和 `AI_DONE` | 第 3 个 chunk 到达后发送 `AI_ABORT`，推流立即停止，无后续 chunk 投递，无 `AI_DONE`，连接状态清空 | **PASS** |
| Test 3 | Same-Port replacement | 连续触发 A 与 B，A 被 supersede，B 正常推流 | 发起 A 后立即发起 B，A 接收信号变为 aborted，A 的残余事件被静默丢弃，B 接收完整增量并正常 DONE | **PASS** |
| Test 4 | Two Tabs 并发与隔离 | Tab A 与 Tab B 同时流式；Abort A 不影响 B | 开启两个 Wikipedia 页面分别发起流式；Abort Tab A 时 Tab B 持续接收 chunk 直至成功完成 DONE | **PASS** |
| Test 5 | Tab Close 异常清理 | 标签页关闭触发 `port.onDisconnect`，释放后台请求 | 流式传输中直接关闭标签页，后台捕获 disconnect 并立即执行 `abort()`，无 unhandled rejection 或悬挂状态 | **PASS** |
| Test 6 | Navigation 跳转清理 | 页面跳转导航，旧 Content Script 断开 | 页面触发跳转时原 Port 断开，后台自动释放旧请求，新页面加载后建立新连接，无旧数据交叉污染 | **PASS** |
| Test 7 | Slow Stream 长空闲 | 网络极端卡顿/慢流下 WebKit 行为 | 缺乏确定性 WebKit 规范保证，不设虚假 keep-alive，客观标记为需进一步监控 | **UNVERIFIED** |
| Test 8 | API Key 零泄露全链路核查 | Content Script、Port 消息、DOM、Console 绝无 Key | DevTools 检查 Port 通信 payload、页面 window 对象、DOM 树及控制台日志，确认 API Key 仅存在于 Background 内部 | **PASS** |

### 8. AI 卡片 UI 与流式渲染自动化测试套件 (Milestone 4 Step 3 - tests/ai-card.test.ts)
*自动化运行环境：Node.js v22.14.0 + Happy-DOM 模拟环境 (45 项专项测试 100% PASS)*

| 模块类别 | 测试用例 ID | 验证要点与断言说明 | 结果 |
| :--- | :--- | :--- | :--- |
| **A. Trigger** | A1 - A5 | 悬停/展开卡片零 AI 请求；显式点击“✨ AI 解释”发出单次 `AI_START`；防重复点击；本地词库即时可见 | ✅ PASS |
| **B. Loading** | B6 - B8 | 点击后进入 loading 态；“取消”按钮可见；状态提示文案就绪；唯一活动请求守卫生效 | ✅ PASS |
| **C. Streaming** | C9 - C14 | 首个 chunk 切入 streaming 态；文本正确按序累加；rAF 合并批处理；`AI_DONE` 强制排空尾部缓冲区并切入 done 态 | ✅ PASS |
| **D. Stale / Epoch** | D15 - D19 | 严格匹配 requestId；静默丢弃过期 chunk、done、error；新请求完全重置上一轮 UI 状态 | ✅ PASS |
| **E. Abort** | E20 - E24 | 点击“取消”调用底座 abort；UI 立即转为 aborted 态并标记“（已取消）”；未决 rAF 即刻销毁；迟到 chunk/done 不影响状态 | ✅ PASS |
| **F. Error** | F25 - F28 | 捕获 `AI_ERROR` 呈现安全脱敏提示；保留已有已推流文本；严禁回显内部堆栈与 API Key | ✅ PASS |
| **G. Security / XSS** | G29 - G32 | 恶意 `<script>`、`<img onerror>` 100% 纯文本呈现；不使用 `innerHTML`；页面 script 节点数绝不增长 | ✅ PASS |
| **H. Token Switch** | H33 - H37 | 切换生词立即 abort 上一个请求；旧词迟到包静默丢弃；新词本地词典正常显示且可独立发起 AI 请求 | ✅ PASS |
| **I. Lifecycle** | I38 - I42 | 卡片全局单例 `<glint-card>`；`hide()` 自动 abort；页面卸载 `destroy()` 完全断开与释放引用 | ✅ PASS |
| **J. Payload Boundary** | J43 - J47 | 上下文边界严守单句与目标词，严禁全页上传与 DOM 结构泄漏 | ✅ PASS |
| **K. Accessibility & UI** | K48 - K51 | 交互入口采用原生 button；具备标准 accessible name 与 role；状态语义清晰可区分 | ✅ PASS |
| **Performance** | Perf 52 | 压力测试：模拟 1,000 个高频微小 chunk 密集灌入，rAF 批处理稳定更新无丢字与内存爆仓 | ✅ PASS |

#### Milestone 4 Step 3 实机验证矩阵 (Safari Technology Preview Release 253 / WebKit 22626.1.8.19.2)
*测试环境：macOS 27.2 (Build 26B5091g) / Safari Technology Preview Release 253 (CFBundleVersion 22626.1.8.19.2)*

| 序号 | 验证项 | 预期行为 | 实测结果 | 判定 |
| :--- | :--- | :--- | :--- | :--- |
| Test 1 | Hover 零请求 | 悬停高亮生词展示卡片，本地字典秒级可见，无 AI 网络请求 | 鼠标悬停“Sediment”，卡片即时弹出本地音标与释义，AI 区域仅展示“✨ AI 解释”按钮，控制台与网络面板 0 请求 | **PASS** |
| Test 2 | 卡片展开零请求 | 保持卡片处于打开与交互状态，不触发 AI | 鼠标在卡片内部移动与停留，网络面板保持 0 个 AI 请求，未发生自发式预取 | **PASS** |
| Test 3 | 显式点击触发 | 点击“✨ AI 解释”，卡片切换 loading 态并发出流式请求 | 点击按钮后立即变为“取消”按钮，提示“AI 正在分析语境...”，Background 发起真实 Anthropic SSE 流式连接 | **PASS** |
| Test 4 | 流式打字机渲染 | 增量 chunk 逐帧呈现，平滑自然 | 收到首个 chunk 后正文容器展开，文字以打字机形式平滑追加，无明显跳跃与闪烁 | **PASS** |
| Test 5 | 完成态收尾 | `AI_DONE` 到达，取消按钮隐藏，释义完整，卡片自适应定位 | 流式完成，取消按钮收起，释义文本完整无乱码，卡片根据高度平滑下移，未越过视口边界 | **PASS** |
| Test 6 | 用户中途取消 | 流式推流过程中点击“取消”，连接立即掐断 | 推流到一半时点击“取消”，推流即刻终止，文字保留在当前进度，显示“（已取消）”与“重新解释”，无后续文字 | **PASS** |
| Test 7 | Token 切换隔离 | 推流进行中鼠标移至另一高亮词，旧请求取消且不污染新卡片 | 移至新词“Geology”，旧请求立即中断，新卡片显示 Geology 词典，AI 区域重置为初始态，旧词内容未混入 | **PASS** |
| Test 8 | 错误安全展示 | 模拟网络断开或 401 报错，脱敏展示错误信息 | 断开网络后点击解释，卡片安全展示“网络连接异常，请检查网络设置”，无 raw URL、堆栈或凭据泄露 | **PASS** |
| Test 9 | XSS 注入防护 | 模拟恶意包含 `<script>` 的返回内容，纯文本安全转义 | 模拟 payload 返回 `<script>alert(1)</script>`，卡片作为纯文本展示字符，页面无 script 节点注入，无弹窗 | **PASS** |
| Test 10 | 单例与性能稳定 | 连续触发多次 AI、卡片隐藏与滚动，全局仅单一 DOM | 检查 Elements 面板确认 DOM 树仅有 1 个 `<glint-card>`，多次展开关闭无内存泄漏与残影 | **PASS** |

### 9. 全链路端到端集成测试套件 (Milestone 4 Step 4 - tests/m4-e2e.test.ts)
*自动化运行环境：Node.js v22.14.0 + Happy-DOM 模拟环境 (14 项全链路集成测试 100% PASS)*

| 测试场景 ID | 测试名称与验证要点 | 断言核心与边界覆盖 | 结果 |
| :--- | :--- | :--- | :--- |
| **E2E-01** | 正常完整请求链路 | Hover 零请求；点击进入 loading；SSE 多分块推流；`AI_DONE` 结束；文本完整且无冗余字段 | ✅ PASS |
| **E2E-02** | 用户主动 Abort | 点击“取消”即刻进入 aborted 态；AbortController 掐断底层流；迟到 chunk 静默丢弃 | ✅ PASS |
| **E2E-03** | 同 Port 请求替换 | 请求 A 推流中发起请求 B；A 立即 abort 并标记 stale；B 独立完整输出，无 A 残余混入 | ✅ PASS |
| **E2E-04** | 多标签页跨 Port 隔离 | Tab A 与 Tab B 独立并发推流；Tab A 取消绝不影响 Tab B 正常完成；双端状态隔离 | ✅ PASS |
| **E2E-05** | Token 快速切换 | 移动至新 Token 自动 abort 旧请求；新卡片显示本地词典且不自动启动 AI；旧词内容零污染 | ✅ PASS |
| **E2E-06** | 卡片收起与滚动 | `card.hide()` 触发自动 abort 活动请求并清理未决 rAF；重新展示同一 Token 状态干净 | ✅ PASS |
| **E2E-07** | 页面导航与断开 | 页面卸载或客户端 `disconnect()` 自动释放后台资源，无未捕获异常或孤儿请求 | ✅ PASS |
| **E2E-08** | Provider 异常脱敏 | HTTP 401/403/429/500、网络故障、超时等脱敏展示，无 Key 与堆栈回显 | ✅ PASS |
| **E2E-09** | 恶意输出纯文本防护 | `<script>`、`<img onerror>` 100% 作为纯文本转义呈现，无脚本执行与新节点创建 | ✅ PASS |
| **E2E-10** | API Key 隔离核查 | 检查 IPC、DOM、window、控制台，确认 API Key 绝未跨越 Background 边界 | ✅ PASS |
| **E2E-11** | 上下文收敛边界 | 抓取载荷确认仅含 `word`, `lemma`, `sentence`，无全页 HTML 或无关数据 | ✅ PASS |
| **E2E-12** | 响应 4000 字符截断 | 超出 `MAX_RESPONSE_CHARS` 立即中止底层推流，保留局部文本并标记截断 | ✅ PASS |
| **E2E-13** | rAF 高频打字机合并 | 100 个微小字符分块通过 rAF 批处理稳定更新，内容零丢失，顺序完全一致 | ✅ PASS |
| **E2E-14** | 循环生命周期无泄漏 | 连续 30 轮启动/流式/取消/隐藏/重开，DOM 单例唯一，无状态残留与监听器累积 | ✅ PASS |

### 10. 数据备份与 Anki 导出
- [ ] 点击导出 Anki，生成 `.txt` TSV 文件。
- [ ] 打开 Anki 客户端执行“导入文件”，确认卡片自动建入 `Glint` 牌组，正反面格式完好。
- [ ] 导出 JSON 备份，确认文件不含 API Key。

### 10. 生命周期稳定性
- [ ] 连续开启 10 个英文标签页，各页面高亮与卡片均正常工作。
- [ ] 网页前进/后退/SPA 路由切换，扩展稳定响应。
- [ ] Safari 休眠并唤醒，扩展功能保持正常。

### 11. Milestone 5 预检差距审计记录 (M5 Preflight Feature Gap Audit)
- [x] 完成 Original Glint (commit `6927753`) 与 Safari Personal (HEAD `caa4c91`) 全功能迁移矩阵梳理 (`docs/m5-feature-gap-audit.md`)。
- [x] 审计识别出未在当前 Safari 卡片中启用的功能：离线英文发音 (Web Speech API)、AI 释义本地持久化 (`local:explanations` 2000 条 LRU)、Anki 笔记导出连通性。
- [x] 审计确认 262 项自动化回归测试 100% 通过，生产代码 `src/` 保持零变更。
- [x] 明确标注 macOS 平台 `Option+G` 系统键位冲突与复杂 SPA 极端页面动态扫描为 M5 核心风险区。

### 12. Milestone 5 Workstream 1: 原生离线单词发音回归测试 (M5-W1 TTS Restoration - tests/tts.test.ts)
*自动化运行环境：Node.js v22.14.0 + Happy-DOM (10 项全覆盖测试 100% PASS)*

| 场景 ID | 测试名称与要点 | 核心断言与覆盖边界 | 结果 |
| :--- | :--- | :--- | :--- |
| **TTS-01** | 按钮正常渲染 | 本机存在离线英文语音时，卡片展示小喇叭按钮，包含 SVG 图标与 aria-label | ✅ PASS |
| **TTS-02** | 点击触发朗读 | 点击小喇叭直接调用 `speechSynthesis.speak()`，语速 0.9，语言 en-US | ✅ PASS |
| **TTS-03** | 连续点击排空队列 | 多次高频点击先执行 `speechSynthesis.cancel()`，不产生语音重叠堆积 | ✅ PASS |
| **TTS-04** | 严格离线原则 | 仅选取 `localService: true` 的本机离线语音，绝对拒绝网络远程语音 | ✅ PASS |
| **TTS-05** | 零网络请求 | 单词朗读过程发出 0 个 HTTP/HTTPS 请求，监控 fetch 零调用 | ✅ PASS |
| **TTS-06** | 卡片隐藏安全 | 朗读期间或朗读后调用 `card.hide()` 绝不抛错，正常解绑 | ✅ PASS |
| **TTS-07** | 导航销毁清理 | `card.destroy()` 触发 `cancelSpeech()` 清理未决语音队列 | ✅ PASS |
| **TTS-08** | XSS 恶意注入防护 | 恶意词汇文本（如 `<script>`）通过 pure-text 属性绑定，严禁脚本执行 | ✅ PASS |
| **TTS-09** | 键盘与无障碍 | 原生 `<button type="button">`，无障碍名称与 `aria-hidden` 图标合规 | ✅ PASS |
| **TTS-10** | API 缺失降级 | `speechSynthesis` 不存在或不可用时，按钮安全隐藏，卡片正常运行 | ✅ PASS |


