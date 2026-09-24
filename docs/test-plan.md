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

### 7. 数据备份与 Anki 导出
- [ ] 点击导出 Anki，生成 `.txt` TSV 文件。
- [ ] 打开 Anki 客户端执行“导入文件”，确认卡片自动建入 `Glint` 牌组，正反面格式完好。
- [ ] 导出 JSON 备份，确认文件不含 API Key。

### 8. 生命周期稳定性
- [ ] 连续开启 10 个英文标签页，各页面高亮与卡片均正常工作。
- [ ] 网页前进/后退/SPA 路由切换，扩展稳定响应。
- [ ] Safari 休眠并唤醒，扩展功能保持正常。
