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
- [ ] 切换高亮样式（虚线、下划线、底色、文字变色），页面实时平滑变更。

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

### 13. Milestone 5 Workstream 2: AI 释义本地持久化与缓存 (M5-W2 AI Persistence - tests/explanation-cache.test.ts)
*自动化运行环境：Node.js v22.14.0 + Happy-DOM (20 项全覆盖测试 100% PASS)*

| 场景 ID | 测试名称与要点 | 核心断言与覆盖边界 | 结果 |
| :--- | :--- | :--- | :--- |
| **CACHE-01** | 空缓存查询 | 初始空缓存查询返回 `null`，不抛错 | ✅ PASS |
| **CACHE-02** | 缓存未命中 (Miss) | 查询未录入词汇返回 `null`，保持正常未命中状态 | ✅ PASS |
| **CACHE-03** | 成功写入 (Write) | `putExplanation` 成功持久化，规范化小写 key，写入纯净契约 `{ word, explanation, updatedAt }` | ✅ PASS |
| **CACHE-04** | 缓存命中 (Hit) | 查询已缓存词汇成功返回释义文本，大小写与空格归一化 | ✅ PASS |
| **CACHE-05** | 命中刷新 LRU | 缓存命中时同步刷新 `updatedAt` 时间戳并持久化写回 | ✅ PASS |
| **CACHE-06** | 重复词汇更新 | 相同词汇再次写入时，更新 explanation 并刷新时间戳，容量不虚增 | ✅ PASS |
| **CACHE-07** | 2000 条上限容量 | 严格支持最多 2,000 条释义记录，容量内完整保持 | ✅ PASS |
| **CACHE-08** | LRU 淘汰最旧条目 | 写入第 2,001 条时，按 `updatedAt` 升序淘汰最旧记录，保留最新 2,000 条 | ✅ PASS |
| **CACHE-09** | 清空全部缓存 | `clearExplanations` 清空 `local:explanations`，绝不触碰 API Keys 或设置项 | ✅ PASS |
| **CACHE-10** | 删除单条记录 | `deleteExplanation` 仅移除目标词条，其余条目与配额不受影响 | ✅ PASS |
| **CACHE-11** | 用户取消不写入 | 用户主动 `AI_ABORT` 的请求绝对不写入缓存 | ✅ PASS |
| **CACHE-12** | 服务商错误不写入 | Provider HTTP 500/401/429 报错时绝对不写入缓存 | ✅ PASS |
| **CACHE-13** | 网络超时不写入 | 请求发生超时错误时绝对不写入缓存 | ✅ PASS |
| **CACHE-14** | 局部部分流不写入 | 途中断开或异常退出的 partial stream 绝对不写入缓存 | ✅ PASS |
| **CACHE-15** | 空释义不写入 | 推流完成但内容纯空白时绝对不写入缓存 | ✅ PASS |
| **CACHE-16** | 存储写入失败容错 | 即使底层 storage 抛出异常（配额超限），`AI_DONE` 仍正常发至客户端，UX 不受阻 | ✅ PASS |
| **CACHE-17** | 敏感字段绝对隔离 | 严格断言 storage 仅有 3 个允许字段，`PRIVATE_DOCUMENT_12345` 句子及 API Key 绝对零泄露 | ✅ PASS |
| **CACHE-18** | 旧 Schema 安全清洗 | 检测到包含 `sentence`/`analysis` 的历史数据自动丢弃清洗，保证敏感原句不残留 | ✅ PASS |
| **CACHE-19** | 并发变更单运行时串行 | 单 JS 运行时内部并发执行 `putExplanation`，通过 Promise 任务队列保证同运行时串行执行 | ✅ PASS |
| **CACHE-20** | 缓存命中零 AI 调用 | 命中缓存时卡片直接进入 `done` 态并通过 `textContent` 展现，`aiClient.start()` 调用严格为 0 | ✅ PASS |

### 14. Milestone 5 Workstream 2 验证闭环与核查记录 (M5-W2 Verification Closure)
*自动化运行环境：Node.js v22.14.0 + Happy-DOM (297/297 PASS)*
*实机目标环境：macOS 27.2 (Build 26B5091g) / Safari Technology Preview Release 253 (CFBundleVersion 22626.1.8.19.2, WebKit 22626.1.8.19.2)*

#### 1. 验证基线与范围
- **Production Code Changes**: 0 行变更，严格保持工作区纯净。
- **Automated Tests**: 全量 297 项自动化测试（含 5 项验证与测算测试）全部通过。
- **Typecheck & Build**: TypeScript strict 检查 0 错误，Safari Extension 构建无 warning/error 打包成功。

#### 2. 核心核查矩阵 (VC-01 至 VC-08)

| 场景 ID | 核查维度与要点 | 核心证据与边界说明 | 判定 |
| :--- | :--- | :--- | :--- |
| **VC-01** | Real Safari MISS → 写入存储 | 待实机端到端手动验证：未缓存生词点击 AI 解释，推流完成写入 `local:explanations`，且仅含 3 项字段 | ⚠️ UNVERIFIED (实机待测) / ✅ PASS (自动化 CACHE-03, 17) |
| **VC-02** | Real Safari HIT → 零请求 | 待实机端到端手动验证：再次点击已缓存词汇，秒级展现，网络面板 0 个 `api.anthropic.com` 请求 | ⚠️ UNVERIFIED (实机待测) / ✅ PASS (自动化 CACHE-04, 20) |
| **VC-03** | Real Safari Clear → MISS | 待实机端到端手动验证：Options 页面清空释义后，重新请求该词再次发起网络流，且不触碰 API Keys | ⚠️ UNVERIFIED (实机待测) / ✅ PASS (自动化 CACHE-09, 10) |
| **VC-04** | Real Safari 跨 Tab 持久化 | 待实机端到端手动验证：Tab A 解释词汇 A，Tab B 悬停点击直接命中；双 Tab 并发解释不覆盖 | ⚠️ UNVERIFIED (实机待测) / ✅ PASS (自动化 CACHE-19, VC-08-A) |
| **VC-05** | Real Safari 进程重启持久化 | 待实机端到端手动验证：完全退出 Safari TP 进程并重新启动后，已缓存释义依然有效 | ⚠️ UNVERIFIED (实机待测) |
| **VC-06** | Real Safari 真实隐私核查 | 待实机端到端手动验证：Web Inspector 搜索 `local:explanations`，断言无网页原句与上下文残留 | ⚠️ UNVERIFIED (实机待测) / ✅ PASS (自动化 CACHE-17) |
| **VC-07** | LRU 同毫秒时间戳行为 | `capExplanationEntries` 面对 2005 条同毫秒条目，按 ECMAScript stable sort 严格截断至 2000 条，行为确定无随机丢失 | ✅ PASS (VC-07-A, B, C) |
| **VC-08** | 并发边界与队列作用域 | A: 单 JS 运行时内部串行化 (VERIFIED)；B: AI 流完成写入统一集中在 SW (VERIFIED)；C: 跨 Context 存储原子性 (UNVERIFIED) | ✅ PASS (架构核查闭环) |

#### 3. 存储容量与 Safari 配额声明修正
- **实测数据体积 (Empirical Measurement)**:
  - 测算 2,000 条包含典型双语地学/社科/自然科学释义（每条约 200~300 字符）的完整 `local:explanations` 序列化 JSON 载荷。
  - **实测总字节数**: `518,281 字节` (约为 `506.13 KB` / `0.49 MB`)。
- **Safari 存储配额说明**:
  - WebKit 对 `browser.storage.local` 的真实配额上限因 WebKit 具体版本与平台策略而异，目前官方未公开硬性保证值。
  - 因此本阶段将“Safari 配额一定为 5MB/10MB”的断言修正为：**Storage quota: UNVERIFIED**。
  - 506 KB 的实际数据体积在常规浏览器本地存储中处于极轻量水准，但不能推导为 Safari 的绝对上限保证。

---

### 15. Milestone 5 Workstream 8 Provider Adapter 测试矩阵与回归核验 (M5-W8 Adapter & Regression)
*自动化运行环境：Node.js v22.14.0 + Happy-DOM (311/311 PASS)*  
*实机目标环境：macOS 27.2 (Build 26B5091g) / Safari Technology Preview Release 253 (CFBundleVersion 22626.1.8.19.2, WebKit 22626.1.8.19.2)*

#### 1. 架构覆盖面与证据分类总览 (Architecture Coverage & Evidence Matrix)

| 架构切面 / 模块 | 核心断言与覆盖范围 | 证据类型 | 判定 |
| :--- | :--- | :---: | :---: |
| **Provider Adapter** | 接口契约符合性，实现 `stream` 与 `listModels`，剥离外部非必要依赖 | Unit / automated | ✅ PASS |
| **Provider Registry** | 编译期静态注册表映射，`has` / `get` 正常解析，未注册服务商安全阻断 | Unit / automated | ✅ PASS |
| **Anthropic Adapter** | Anthropic 专属网络逻辑收敛，端点构造与 Header 鉴权标准 | Unit / automated + Real Safari | ✅ PASS |
| **SSE Parsing** | 增量事件解析、多行行缓冲、空行分隔、非文本事件安全忽略 | Unit / automated | ✅ PASS |
| **UTF-8 Streaming** | 跨 chunk 多字节截断无乱码、流式解码完整性 | Unit / automated | ✅ PASS |
| **Abort Control** | 用户主动取消即刻释放 reader，终止后续 `onChunk` 推流 | Unit / automated + Real Safari | ✅ PASS |
| **Provider Errors** | 网络/HTTP(401, 429, 500)/超时/协议畸形/4000 字符超限归一化与脱敏 | Unit / automated | ✅ PASS |
| **Model Discovery** | `listModels` 凭据鉴权、模型数据提取与纯净字符串数组排序 | Unit / automated | ✅ PASS |
| **Permission Boundary** | 权限申请严格保留在 Adapter 外层，Adapter 仅在无权限时抛出友好错误 | Static artifact inspection | ✅ PASS |
| **Credential Isolation** | Content Script 产物零 Key，`local:apiKeys` 仅驻留 Background 内部 | Static artifact inspection | ✅ PASS |
| **Cache Interaction** | 维持 Option A 全局共享缓存，缓存命中阻断 AI 网络流，无 Provider 字段污染 | Unit / automated + Observed | ✅ PASS |
| **Provider-Independent Layer** | Card UI、Port 通信、缓存层零 Provider 专属分支与专有字段 | Static artifact inspection | ✅ PASS |
| **Slow-Stream SW Lifecycle** | 极端慢流与长空闲下的 WebKit Service Worker 存活机制（应用层 60s 超时兜底） | Safari TP Real | ⚠️ **UNVERIFIED** |

#### 2. Provider Adapter 契约测试矩阵 (ADAPTER-01 至 ADAPTER-14)

| 用例 ID | 测试项名称 | 验证行为与预期断言 | 证据类型 | 判定 |
| :--- | :--- | :--- | :---: | :---: |
| **ADAPTER-01** | Anthropic 适配器存在性 | `anthropicAdapter` 具备有效 `id === 'anthropic'` 并完整实现 `stream` 与 `listModels` | Unit / automated | ✅ PASS |
| **ADAPTER-02** | 静态注册表解析成功 | `hasProviderAdapter('anthropic') === true` 且 `getProviderAdapter('anthropic')` 准确解析至实例 | Unit / automated | ✅ PASS |
| **ADAPTER-03** | 未注册服务商安全阻断 | 传入未注册的 `'openai'` 时确定性抛出强类型 `UnsupportedProviderError` | Unit / automated | ✅ PASS |
| **ADAPTER-04** | 正常 SSE 增量推流分发 | Mock SSE 响应切片平滑触发 `ctx.onChunk` 增量回调并组装完整文本 | Unit / automated | ✅ PASS |
| **ADAPTER-05** | UTF-8 多字节跨 chunk 拼接 | 故意在多字节字符中间截断网络 chunk，解码器无乱码无字节丢失 | Unit / automated | ✅ PASS |
| **ADAPTER-06** | 网络异常归一化 | 底层网络 `TypeError` 被精准映射为 `ProviderNetworkError` | Unit / automated | ✅ PASS |
| **ADAPTER-07** | 协议畸形与空流防护 | 破损 JSON 与零 delta 空流被转换为 `ProviderProtocolError` | Unit / automated | ✅ PASS |
| **ADAPTER-08** | HTTP 状态码归一化 | 401、429、500 等状态码精准转换为带 `status` 的 `ProviderHttpError` | Unit / automated | ✅ PASS |
| **ADAPTER-09** | 用户主动取消停止读取 | `ctx.signal` 触发 abort 后立即释放 reader，后续绝不再调用 `onChunk` | Unit / automated | ✅ PASS |
| **ADAPTER-10** | 网络流超时阻断 | 超出配置的 `timeoutMs` 阈值时触发 `ProviderTimeoutError` | Unit / automated | ✅ PASS |
| **ADAPTER-11** | 4,000 字符硬截断限制 | 累计字符数超出限制时仅分发剩余字符，立即 abort 并抛出 `ProviderResponseTooLargeError` | Unit / automated | ✅ PASS |
| **ADAPTER-12** | URL 零密钥安全防护 | 校验请求 URL 绝对不含 API Key 或 `?key=` 查询参数，Header 正常鉴权 | Unit / automated | ✅ PASS |
| **ADAPTER-13** | 错误脱敏与无异常泄漏 | 抛出包含密钥的错误在 `mapProviderError` 经过 `redactSecrets` 脱敏为 `[REDACTED]` | Unit / automated | ✅ PASS |
| **ADAPTER-14** | 模型列表发现契约 | `adapter.listModels()` 正确获取模型列表并排序返回纯净字符串数组 | Unit / automated | ✅ PASS |

#### 3. 全链路架构与回归核查矩阵 (REG-01 至 REG-10)

| 回归项 ID | 回归切面 | 验证内容与核心证据 | 证据类型 | 判定 |
| :--- | :--- | :--- | :---: | :---: |
| **REG-01** | Hover/本地词典 | 悬停生词仅查询本地 5.7 万词离线字典，零 AI 网络请求 | Real Safari + Automated | ✅ PASS |
| **REG-02** | 显式点击触发 | 必须由用户在悬浮卡片内显式点击“✨ AI 解释”才发起流式调用 | Real Safari + Automated | ✅ PASS |
| **REG-03** | 流式渲染 UI | Shadow DOM 内部纯原生 `textContent` 写入，结合 rAF 帧合并，零 HTML/Markdown 依赖 | Real Safari + Automated | ✅ PASS |
| **REG-04** | 主动取消控制 | 点击“取消”即刻下发 `AI_ABORT`，底层 reader 中止，卡片退出 loading 且不写缓存 | Real Safari + Automated | ✅ PASS |
| **REG-05** | 生词切换隔离 | 切换至新生词时上一请求立即 abort，`requestId` 世代守卫阻断迟到旧 chunk | Real Safari + Automated | ✅ PASS |
| **REG-06** | 缓存命中秒级返回 | 同一词再次点击优先命中 `local:explanations`，完全跳过 AI 网络流 | Real Safari + Automated | ✅ PASS |
| **REG-07** | 缓存未命中完整写入 | 仅当流式完整成功 (`AI_DONE`) 且非空时写入 3 项纯净字段，异常/取消不写入 | Real Safari + Automated | ✅ PASS |
| **REG-08** | 缓存清空不越权 | 设置页“清空 AI 释义缓存”仅重置 `local:explanations`，绝不触碰 API Keys 与设置 | Real Safari + Automated | ✅ PASS |
| **REG-09** | 错误安全脱敏 | 401 鉴权失败、离线、服务端故障等均通过 `redactSecrets` 脱敏后展现，零明文凭证 | Real Safari + Automated | ✅ PASS |
| **REG-10** | 凭据单向隔离 | API Key 独占保存在 Background `local:apiKeys`，Content Script 依赖树彻底切断 | Static artifact inspection | ✅ PASS |

#### 4. 里程碑状态与已知边界 (Milestone Parity & Known Limitations)

```text
M5-W8 Step 1 — ARCHITECTURE READY
M5-W8 Step 2 — PASS WITH VERIFICATION LIMITATION
M5-W8 Step 3 — PASS WITH KNOWN LIMITATION
M5-W8 Overall — PASS WITH KNOWN LIMITATION
```

- **Second Provider**: `NOT IMPLEMENTED` (故意保持单一 Provider，架构已就绪，未引入第二实现)。
- **Known Limitations**:
  1. **WebKit Service Worker 慢流生命周期**: 极端慢流/长空闲下 WebKit Service Worker 生命周期行为保持为 `UNVERIFIED`，已通过应用层 60s 硬超时兜底。
  2. **Safari TP 版本状态**: 实测环境为 STP Release 253 (WebKit 22626.1.8.19.2)；该版本是否为 Apple 当前发布的最新 STP 版本保持为 `UNVERIFIED`。

---

### 16. Milestone 5 Workstream 5 动态网页扫描韧性硬化与全量验证核验 (M5-W5 Dynamic Web Robustness & Acceptance)
*自动化运行环境：Node.js v22.14.0 + Happy-DOM (343/343 PASS)*<br>
*实机目标环境：macOS 27.2 (Build 26B5091g) / Safari Technology Preview Release 253 (CFBundleVersion 22626.1.8.19.2, WebKit 22626.1.8.19.2)*

#### 1. 架构覆盖面与证据分类总览 (Architecture Coverage & Evidence Matrix)

| 架构切面 / 场景 | 核心断言与覆盖范围 | 证据类型 | 判定 |
| :--- | :--- | :---: | :---: |
| **RISK-01 零生词页面重扫防护** | `hasRunInitialScan` 显式守卫，初次扫描 0 生词后增量变更严格走增量扫描，零无谓整页重扫 | Automated + Observed | ✅ PASS |
| **RISK-03 祖先/后代包含剪枝** | `pruneContainedNodes` 剪枝算法，过滤已被祖先覆盖的后代元素及 `dirtyTextNodes`，杜绝重复扫描与重复 token | Automated + Observed | ✅ PASS |
| **RISK-02 突发突变全量回退** | `records.length > 250` 触发安全全量回退；功能行为稳定，但大批量突发存在较重 TreeWalker 耗时 | Automated + Measured | ⏸️ **DEFERRED** |
| **SPA 路由重置** | URL/Title 路由切换触发状态完全重置并重新初始扫描 | Automated + Real Safari | ✅ PASS |
| **连续动态增量追加** | 无限滚动/列表追加增量识别新增词元，不影响现有已发现词元 | Automated + Real Safari | ✅ PASS |
| **DOM 移除与高亮清理** | 节点移除后对应词元安全清理或废弃，不产生悬挂高亮或卡片漂移 | Automated + Real Safari | ✅ PASS |
| **非文本属性变更过滤** | class/style/id 等非文本属性变更不触发无谓词元重算 | Automated | ✅ PASS |
| **防抖批处理** | 50ms 防抖合并连续突变，避免频繁重算 | Automated | ✅ PASS |
| **超大 DOM 极端压力** | 10,000 节点 ~88ms；50,000 节点深层树安全遍历完成，无堆栈溢出 | Benchmark / Automated | ✅ PASS |
| **30 轮循环生命周期** | 连续 30 轮 SPA 路由切换与增量追加，未观察到 token/highlight/card 状态单调递增 | Automated / Stress | ✅ PASS |
| **Shadow DOM / iframe 边界** | 严格保留开放/封闭 Shadow DOM 与 cross-origin iframe 安全边界，不非法穿透 | Real Safari + Static | ✅ PASS |
| **可交互元素安全排除** | `input`, `textarea`, `select`, `[contenteditable]` 等严格排除，不干扰用户输入 | Real Safari + Automated | ✅ PASS |
| **Long Task 时间线追踪** | 真实 Safari 下连续毫秒级 Long Task 追踪数据（依赖 Safari Web Inspector Timeline 手动导出） | Safari Profiling | ⚠️ **UNVERIFIED** |
| **JSC 堆内存与 GC 回收证明** | JavaScriptCore 底层堆快照及 Garbage Collection 绝对回收证明 | Safari Memory Profiler | ⚠️ **UNVERIFIED** |
| **Safari TP 最新版本状态** | 实测环境为 STP Release 253；该版本是否为 Apple 当前发布的最新 STP 版本保持未核实 | Environment audit | ⚠️ **UNVERIFIED** |

#### 2. 动态扫描测试矩阵 (DW-01 至 DW-15)

| 用例 ID | 测试项名称 | 验证行为与预期断言 | 证据类型 | 判定 |
| :--- | :--- | :--- | :---: | :---: |
| **DW-01** | SPA 路由导航重置 | 路由变更后清理旧词元并重新扫描新页面 | Automated | ✅ PASS |
| **DW-02** | 连续增量追加 | 动态列表追加新子节点，仅增量扫描新节点且无重复词元 | Automated | ✅ PASS |
| **DW-03** | 嵌套祖先后代剪枝 | 包含父子关系的新增节点被修剪为仅保留顶层祖先根节点 | Automated | ✅ PASS |
| **DW-04** | 包含文本节点剪枝 | `dirtyTextNodes` 位于新增元素内部时自动修剪 | Automated | ✅ PASS |
| **DW-05** | 属性突变忽略 | 仅修改 class / style 等属性不触发扫描 | Automated | ✅ PASS |
| **DW-06** | 快速突变防抖 | 50ms 内多次突变合并为单次扫描 | Automated | ✅ PASS |
| **DW-07** | 节点移除清理 | 删除包含生词的节点后，不残留悬挂引用 | Automated | ✅ PASS |
| **DW-08** | 活动卡片不被增量扫描销毁 | 增量扫描不重置/销毁正在展示的悬浮卡片 | Automated | ✅ PASS |
| **DW-09** | 滚动与无限加载 | 模拟快速滚动与无限内容注入，扫描平稳防抖执行 | Automated | ✅ PASS |
| **DW-10** | 10k 节点大 DOM 压力 | 10,000 节点 DOM 树扫描耗时 < 300ms（实测 ~88ms） | Automated / Benchmark | ✅ PASS |
| **DW-11** | 50k 节点深度 DOM 压力 | 50,000 节点超深 DOM 树遍历完成无堆栈溢出 | Automated / Benchmark | ✅ PASS |
| **DW-12** | 突变风暴回退触发 | >250 条突变触发全量回退，状态完整一致 | Automated | ✅ PASS |
| **DW-13** | 30 轮 SPA 路由循环稳定性 | 连续 30 轮路由切换，状态正常重置，无观察到的状态泄露 | Automated / Stress | ✅ PASS |
| **DW-14** | 30 轮增删循环稳定性 | 连续 30 轮动态节点挂载与卸载，词元计数精准收敛 | Automated / Stress | ✅ PASS |
| **DW-15** | 30 轮嵌套子树循环稳定性 | 连续 30 轮嵌套祖先后代增删，剪枝逻辑幂等无异常 | Automated / Stress | ✅ PASS |

#### 3. RISK 专项验证矩阵 (RISK-01 / 02 / 03)

| 场景 ID | 场景描述 | 行为与断言 | 证据类型 | 判定 |
| :--- | :--- | :--- | :---: | :---: |
| **RISK-01-A** | 初始空页面 + 增量追加含生词节点 | 增量追加后走增量扫描，`run()` 零调用，`tokens.length` 准确更新 | Automated | ✅ PASS |
| **RISK-01-B** | 初始空页面 + 增量追加无生词节点 | 增量追加后走增量扫描，`run()` 零调用，`tokens.length === 0` | Automated | ✅ PASS |
| **RISK-01-C** | 初始有词页面 + 增量追加含生词节点 | 正常增量扫描，`run()` 零调用，新词元平滑追加 | Automated | ✅ PASS |
| **RISK-01-D** | 初始空页面 + 路由切换到含生词页面 | 路由切换触发显式 reset，新页面正确触发初次扫描 | Automated | ✅ PASS |
| **RISK-03-A** | 父节点与直接子节点同时在 addedNodes | 仅父节点保留在扫描根节点列表，子节点被剪枝 | Automated | ✅ PASS |
| **RISK-03-B** | 祖父节点与孙子节点同时在 addedNodes | 仅祖父节点保留在扫描根节点列表，孙子节点被剪枝 | Automated | ✅ PASS |
| **RISK-03-C** | 兄弟节点同时在 addedNodes | 兄弟节点彼此无包含关系，全部保留在根节点列表 | Automated | ✅ PASS |
| **RISK-03-D** | 新增元素包含 dirtyTextNode | dirtyTextNode 被修剪，避免重复扫描与分词 | Automated | ✅ PASS |
| **RISK-03-E** | 独立 dirtyTextNode 不在新增元素内 | 独立 dirtyTextNode 正常保留并执行扫描 | Automated | ✅ PASS |
| **RISK-02-A** | 250 条以下增量突变性能梯度 | 1: 48ms, 10: 54ms, 50: 89ms, 100: 179ms, 250: 566ms | Measured / Benchmark | ✅ PASS |
| **RISK-02-B** | 251 条突变风暴全量回退耗时 | 251 条突变触发全量回退，耗时 ~907ms | Measured / Benchmark | ⚠️ OBSERVED |
| **RISK-02-C** | 500 条突变风暴全量回退耗时 | 500 条突变触发全量回退，耗时 ~2290ms | Measured / Benchmark | ⚠️ OBSERVED |
| **RISK-02-D** | 1000 条突变风暴全量回退耗时 | 1000 条突变触发全量回退，耗时 ~7086ms | Measured / Benchmark | ⚠️ OBSERVED |

#### 4. 全链路架构与回归核查矩阵 (REG-01 至 REG-15)

| 回归项 ID | 回归切面 | 验证内容与核心证据 | 证据类型 | 判定 |
| :--- | :--- | :--- | :---: | :---: |
| **REG-01** | 初次扫描生词识别 | 页面加载完成平稳执行初次扫描，生词正确识别并建立索引 | Real Safari + Automated | ✅ PASS |
| **REG-02** | 增量追加平滑挂载 | 动态增量节点注入后增量扫描追加词元，页面无闪烁 | Real Safari + Automated | ✅ PASS |
| **REG-03** | SPA 路由导航重置 | 虚拟路由切换后词元全部清理，新页面重新扫描并渲染 | Real Safari + Automated | ✅ PASS |
| **REG-04** | 悬停展示本地卡片 | 悬停生词秒级展现 Shadow DOM 卡片，本地 5.7 万词离线字典驱动 | Real Safari + Automated | ✅ PASS |
| **REG-05** | 本地离线发音朗读 | 点击发音小喇叭正常调用本地 SpeechSynthesis，零网络请求 | Real Safari + Automated | ✅ PASS |
| **REG-06** | 显式点击触发 AI | 点击“✨ AI 解释”发起流式网络请求，卡片进入 loading 态 | Real Safari + Automated | ✅ PASS |
| **REG-07** | AI 流式推流平滑渲染 | SSE 流式切片平滑由 Background 推向前台，卡片原生 textContent 渲染 | Real Safari + Automated | ✅ PASS |
| **REG-08** | 用户主动取消推流 | 点击“取消”即刻下发 AI_ABORT，reader 释放，卡片退出 loading | Real Safari + Automated | ✅ PASS |
| **REG-09** | 释义结果缓存命中 | 再次点击已解释生词直接命中 local:explanations，跳过网络调用 | Real Safari + Automated | ✅ PASS |
| **REG-10** | 动态增量下卡片存活 | 卡片展示期间发生后台增量扫描，卡片不关闭、不抖动、不重新挂载 | Real Safari + Automated | ✅ PASS |
| **REG-11** | 节点移除卡片清理 | 正在展示卡片的宿主节点被从 DOM 移除时，卡片安全收起不报错 | Real Safari + Automated | ✅ PASS |
| **REG-12** | 输入控件严格排除 | input / textarea / contenteditable 内容严格不扫描不打扰 | Real Safari + Automated | ✅ PASS |
| **REG-13** | Shadow DOM 边界隔离 | open/closed Shadow DOM 边界严格尊重，不非法注入与破坏宿主封装 | Real Safari + Static | ✅ PASS |
| **REG-14** | iframe 跨域边界隔离 | cross-origin iframe 不非法穿透，遵循安全上下文沙箱 | Real Safari + Static | ✅ PASS |
| **REG-15** | 内存循环泄露防护 | 30 轮循环生命周期测试未观察到 token/card 状态单调递增 | Automated / Stress | ✅ PASS |

#### 5. 里程碑状态与已知边界 (Milestone Parity & Known Limitations)

```text
M5-W5 Step 1 — PASS WITH OBSERVATIONS
M5-W5 Step 2 — PASS WITH DESIGNATED FIXES
M5-W5 Step 3 — PASS WITH KNOWN LIMITATIONS
M5-W5 Final Milestone Status — PASS WITH KNOWN LIMITATIONS
```

- **Fixed Issues**:
  - `RISK-01`: 零生词页面增量突变导致无谓整页重扫已彻底修复（引入 `hasRunInitialScan` 显式守卫）。
  - `RISK-03`: 祖先与后代节点同时突变导致重复扫描与词元重叠已彻底修复（`pruneContainedNodes` 剪枝 + 文本节点过滤）。
- **Deferred Issues & Known Limitations**:
  - `RISK-02`: `records.length > 250` 的全量回退策略维持为 `DEFERRED`。当前回退机制在极端压力下确保了数据一致性，但大批量突变（如 251/500/1000 records）会引发较重 TreeWalker 耗时（~900ms 至 ~7000ms）。不宣称 250 阈值是最优解，亦不宣称其能杜绝 Long Task。
  - **Long Task Profiling**: 缺少真实 Safari 下毫秒级 Long Task 连续时间线追踪数据，标记为 `UNVERIFIED`。
  - **JSC 堆内存与 GC 回收**: JavaScriptCore 底层堆快照及 Garbage Collection 绝对回收证明无法在自动化环境中证明，标记为 `UNVERIFIED`。
  - **Safari TP 版本状态**: 实测环境为 STP Release 253 (WebKit 22626.1.8.19.2)；该版本是否为 Apple 当前发布的最新 STP 版本保持为 `UNVERIFIED`。
