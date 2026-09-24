# Glint Safari Personal Edition — Safari/WebKit Dependency Inventory

本文档详细记录 Glint Safari Personal Edition 所依赖的所有 Safari / WebKit 专有或特定行为。
建立本清单的目的是：在长期不主动维护的背景下，为未来维护者提供精确的排查地图，明确“项目依赖了 WebKit 的哪些特性、当前观察到的表现、已知限制，以及 WebKit 变更时可能受影响的源码位置”。

---

## 1. CSS Custom Highlight API (`::highlight(glint-mark)`, `CSS.highlights`)

- **依赖原因 (Why project depends on it)**:
  - 核心生词高亮引擎摒弃了传统的 DOM 包装标签（如 `<mark>` 或 `<span>`），改用原生 CSS Custom Highlight API。
  - 该机制实现了零 DOM 树修改、零虚拟 DOM / 前端框架（React, Vue, Svelte）状态破坏、以及零文本选区干扰。
- **当前实测表现 (Current observed behavior)**:
  - Safari 17.2+ 及 Safari Technology Preview (Release 253) 原生支持 `CSS.highlights` 全局注册表。
  - 高亮样式规则在独立样式表中正常解析并生效，文本上色平滑无闪烁。
- **已知限制 (Known limitation)**:
  - 在跨上下文或动态插入的 iframe 中，`document.adoptedStyleSheets` 可能会因所有权问题抛出异常。
  - Glint 实现了双轨容灾策略：优先使用 `adoptedStyleSheets`，抛错时无缝降级为动态 `<style>` 标签挂载。
- **WebKit 行为变更时的失效模式 (What would break if WebKit changes)**:
  - 若 `CSS.highlights` 规范变更或实现冻结，页面上所有生词将失去高亮色彩，但底层 Range 和悬停拾取不受影响。
- **源码排查位置 (Where to investigate in source)**:
  - [`src/lib/highlight.ts`](file:///Users/ada/Downloads/glint-main/src/lib/highlight.ts) (`ensureHighlightStyle`, `paintHighlight`)

---

## 2. 光标坐标反查与字符边界定位 (`document.caretPositionFromPoint`)

- **依赖原因 (Why project depends on it)**:
  - 当用户鼠标在页面文本上方移动时，需要根据屏幕坐标 `(clientX, clientY)` 快速定位到具体的 Text 节点及其字符偏移量 (`offset`)，进而反查命中的词元 (`ScannedToken`)。
- **当前实测表现 (Current observed behavior)**:
  - WebKit 原生支持 `document.caretPositionFromPoint`，返回包含 `offsetNode` 与 `offset` 的 `CaretPosition` 对象。
  - 在绝大多数标准正文段落中，能够精准定位至目标生词所在的 Range。
- **已知限制 (Known limitation)**:
  - 当光标悬停在段落外边距、内边距或行尾空白处时，WebKit 返回的 `offsetNode` 可能是父级 `Element` 节点而非 `Text` 节点。
  - Glint 实现了 `resolveTextCaret` 边界探测回退算法，遍历子节点并校验边界几何矩形 (`getBoundingClientRect`)。
- **WebKit 行为变更时的失效模式 (What would break if WebKit changes)**:
  - 若 `caretPositionFromPoint` 返回格式或坐标投影算法变动，悬停弹出卡片可能会在边缘区域失灵或无法命中生词。
- **源码排查位置 (Where to investigate in source)**:
  - [`src/lib/hover.ts`](file:///Users/ada/Downloads/glint-main/src/lib/hover.ts) (`resolveTextCaret`, `findTokenAtPoint`)

---

## 3. Web Speech API 原生离线语音 (`speechSynthesis`, `localService === true`)

- **依赖原因 (Why project depends on it)**:
  - 提供生词纯离线、零权限、零网络依赖的标准美式/英式英文发音。
- **当前实测表现 (Current observed behavior)**:
  - macOS 宿主系统自带高质量离线英文语音包（如 Samantha, Daniel 等），其 `SpeechSynthesisVoice.localService` 严格标示为 `true`。
  - 调用 `window.speechSynthesis.speak(utterance)` 正常发音，网络面板确认零 HTTP/TCP 请求。
- **已知限制 (Known limitation)**:
  - 在纯纯无头环境（CI/CD 无声卡驱动）或极度精简的特定系统配置下，系统可能不包含任何离线语音。此时 `getOfflineVoices()` 列表为空，卡片上的发音喇叭会自动隐藏，执行安全优雅降级。
- **WebKit 行为变更时的失效模式 (What would break if WebKit changes)**:
  - 若 WebKit 移除了 `localService` 属性或改变了返回值，为保护用户隐私，Glint 的严格离线守卫将拒绝播放外部网络语音。
- **源码排查位置 (Where to investigate in source)**:
  - [`src/lib/speak.ts`](file:///Users/ada/Downloads/glint-main/src/lib/speak.ts) (`getOfflineVoices`, `speak`)
  - [`src/lib/card.ts`](file:///Users/ada/Downloads/glint-main/src/lib/card.ts) (`setupPronunciation`)

---

## 4. WebKit Service Worker 运行时与生命周期

- **依赖原因 (Why project depends on it)**:
  - 遵循 Manifest V3 架构规范，Background 逻辑运行于无 DOM 的 Service Worker 隔离上下文中。
  - 负责 API 密钥管理、单域权限控制、本地字典按需查询及大模型 SSE 流式推流。
- **当前实测表现 (Current observed behavior)**:
  - WebKit 在后台空闲约 30 秒后会自动终止 Service Worker；在收到新的 Port 连接或消息时即时唤醒。
- **已知限制 (Known limitation)**:
  - 在极端弱网或大模型超长等待（耗时数分钟的慢流）下，WebKit 可能会错误判定 Service Worker 处于空闲状态并强行冻结连接。
  - Glint 实现了应用层 60 秒硬超时中断机制 (`ProviderTimeoutError`)，坚决不采用高耗电的伪心跳保活 hack。
- **WebKit 行为变更时的失效模式 (What would break if WebKit changes)**:
  - 若 WebKit 进一步缩短 SW 挂起阈值且不识别活跃的 fetch reader，超长长文流式推流可能被中途截断。
- **源码排查位置 (Where to investigate in source)**:
  - [`src/entrypoints/background.ts`](file:///Users/ada/Downloads/glint-main/src/entrypoints/background.ts)
  - [`src/lib/ai-port.ts`](file:///Users/ada/Downloads/glint-main/src/lib/ai-port.ts)
  - [`src/lib/providers/anthropic-adapter.ts`](file:///Users/ada/Downloads/glint-main/src/lib/providers/anthropic-adapter.ts)

---

## 5. Safari WebExtension 权限模型与动态单域授权

- **依赖原因 (Why project depends on it)**:
  - 践行最小权限原则 (Least-Privilege)：`manifest.json` 声明 `host_permissions: []`，不在安装时向用户索取广泛网络权限。
  - 仅在用户于选项页配置特定服务商（如 Anthropic）时，通过用户点击手势动态申请单一域名 (`api.anthropic.com`)。
- **当前实测表现 (Current observed behavior)**:
  - 调用 `browser.permissions.request({ origins: ['https://api.anthropic.com/*'] })` 触发 Safari 系统原生权限授权弹窗；用户同意后即刻生效，无需重启浏览器。
- **已知限制 (Known limitation)**:
  - 权限申请必须严格绑定于由用户手势（如点击“保存”按钮）派发的同步或直接异步调用栈中，否则 Safari 会静默拒绝授权请求。
- **WebKit 行为变更时的失效模式 (What would break if WebKit changes)**:
  - 若 Safari 变更了 WebExtension permissions API 的 origin 匹配规则或调用上下文要求，配置保存时的权限申请可能失败。
- **源码排查位置 (Where to investigate in source)**:
  - [`src/lib/permissions.ts`](file:///Users/ada/Downloads/glint-main/src/lib/permissions.ts) (`ensureProviderPermission`)
  - [`wxt.config.ts`](file:///Users/ada/Downloads/glint-main/wxt.config.ts) (`manifest.optional_host_permissions`)

---

## 6. 扩展本地存储 (`browser.storage.local`)

- **依赖原因 (Why project depends on it)**:
  - 持久化保存用户偏好设置 (`local:settings`)、已认识单词集合 (`local:knownWords`)、模型提供商 API 密钥 (`local:apiKeys`) 以及 AI 释义本地缓存 (`local:explanations`)。
- **当前实测表现 (Current observed behavior)**:
  - 读写稳定确定，重启 Safari 或系统后数据完整保留。
- **已知限制 (Known limitation)**:
  - WebKit `browser.storage.local` 在不同版本中存在隐性配额约束（通常为 5MB ~ 10MB）。
  - Glint 实现了 2,000 条稳定 LRU 淘汰机制 (`EXPLANATION_LIMIT = 2000`)，实测 2,000 条真实记录序列化体积仅约 506 KB，留有充裕的安全边界。
- **WebKit 行为变更时的失效模式 (What would break if WebKit changes)**:
  - 若存储配额被严格下调或写入时抛出 `QuotaExceededError`，Glint 的 `enqueue` 写入队列捕获异常并降级，不阻塞前台 UI 渲染。
- **源码排查位置 (Where to investigate in source)**:
  - [`src/lib/explanation-cache.ts`](file:///Users/ada/Downloads/glint-main/src/lib/explanation-cache.ts)
  - [`src/lib/settings.ts`](file:///Users/ada/Downloads/glint-main/src/lib/settings.ts)
  - [`src/lib/keys.ts`](file:///Users/ada/Downloads/glint-main/src/lib/keys.ts)

---

## 7. 隔离世界执行上下文 (Isolated World) 与边界隔离

- **依赖原因 (Why project depends on it)**:
  - Content Script 必须在 WebKit 隔离世界中执行，确保网页自身的脚本或注入脚本无法访问扩展内部的任何变量或 WebExtension API。
- **当前实测表现 (Current observed behavior)**:
  - 页面全局变量与扩展隔离世界互不影响，共享同一个 Light DOM 树。
- **已知限制 (Known limitation)**:
  - 无法且不应直接调用网页上下文中的私有 JS 对象。
  - 为防止广告 iframe、嵌套跨域 iframe 造成的重复执行与竞态，Glint 顶部首行设立了 `window.top !== window.self` 阻断守卫。
- **WebKit 行为变更时的失效模式 (What would break if WebKit changes)**:
  - 若 Safari 改变扩展 Content Script 注入策略或默认向所有 subframe 注入脚本，`window.top !== window.self` 守卫仍将确保子 frame 安全退出。
- **源码排查位置 (Where to investigate in source)**:
  - [`src/entrypoints/content.ts`](file:///Users/ada/Downloads/glint-main/src/entrypoints/content.ts)

---

## 8. Web Component 与 Shadow DOM 样式隔离 (`<glint-card>`)

- **依赖原因 (Why project depends on it)**:
  - 词汇卡片采用单例自定义元素 `<glint-card>` 并挂载 `ShadowRoot`，确保卡片的排版、字体与毛玻璃视觉效果不受宿主网页全局 CSS 污染。
- **当前实测表现 (Current observed behavior)**:
  - 原生 `attachShadow({ mode: 'open' })` 工作良好，内部样式与外部宿主样式完全隔离。
- **已知限制 (Known limitation)**:
  - 卡片内部 DOM 变动会触发浏览器的 DOM 树调整。
  - Glint 在 `MutationObserver` 顶层建立了守卫：变动目标若为 `<glint-card>` 或其子节点，直接过滤跳过，杜绝自反馈死循环。
- **WebKit 行为变更时的失效模式 (What would break if WebKit changes)**:
  - 若 WebKit 修改 ShadowRoot 事件分发或样式隔离规则，卡片排版可能受到外部样式影响，但纯文本渲染安全性不会降低。
- **源码排查位置 (Where to investigate in source)**:
  - [`src/lib/card.ts`](file:///Users/ada/Downloads/glint-main/src/lib/card.ts)
  - [`src/entrypoints/content.ts`](file:///Users/ada/Downloads/glint-main/src/entrypoints/content.ts)

---

## 9. 扩展工具栏弹窗通信机制 (Browser Action Popup)

- **依赖原因 (Why project depends on it)**:
  - 供用户随时查看当前页面高亮词数统计、一键关闭当前站点、切换等级与快速跳转设置。
- **当前实测表现 (Current observed behavior)**:
  - 点击扩展图标弹出独立微型界面 (`popup.html`)，向激活标签页发送 `page:stats` 消息获取实时统计。
- **已知限制 (Known limitation)**:
  - 在部分 WebKit 版本中，内容脚本中的异步 `sendResponse`（返回 Promise）在 Popup 瞬间关闭时可能导致通道静默断开。
  - Glint 内容脚本严格采用同步 `sendResponse({ highlightCount: ... })` 模式，确保数据即时返回。
- **WebKit 行为变更时的失效模式 (What would break if WebKit changes)**:
  - 若 Safari 修改了 Action 弹窗打开生命周期或活动标签页定位逻辑，Popup 可能显示默认状态（0 词），但不影响正文的高亮与生词识别。
- **源码排查位置 (Where to investigate in source)**:
  - [`src/entrypoints/popup/main.ts`](file:///Users/ada/Downloads/glint-main/src/entrypoints/popup/main.ts)
  - [`src/entrypoints/content.ts`](file:///Users/ada/Downloads/glint-main/src/entrypoints/content.ts)
