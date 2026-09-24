# Glint Safari Personal Edition - 详细审计报告 (Audit Report)

## 一、审计概述

本审计报告针对原始开源项目 [Glint](https://github.com/whyubel1eve/glint) (Chrome Extension MV3 版，基于 WXT 框架) 进行全面深入的代码级审计与架构解构。
审计目标为后续打造 **Safari-first / WebKit-first** 的个人定制版本（运行于最新 macOS Safari Technology Preview）奠定准确依据，坚持“第一阶段禁止修改生产代码”原则。

---

## 二、源码与技术栈全景图

| 模块 | 原版实现 | 核心依赖 / 文件 | 职责说明 |
| :--- | :--- | :--- | :--- |
| **工程构建** | WXT + Vite + TS | `package.json`, `wxt.config.ts`, `tsconfig.json` | 针对 Chrome MV3 的扩展打包，包含模块预载关闭、Chrome 专有参数配置 |
| **静态词库** | JSON 静态资源 | `src/assets/lexicon.json` (435KB), `public/data/dict.json` (3.6MB), `public/data/exams.json` (255KB) | 包含 5.7 万词分级词库、ECDICT 释义/音标/考纲、备考大纲词表 |
| **内容脚本** | Content Script | `src/entrypoints/content.ts`, `src/lib/scan.ts`, `src/lib/highlight.ts`, `src/lib/hover.ts` | 网页文本遍历扫描、CSS Custom Highlight 渲染、鼠标坐标反查、悬浮词义卡片挂载 |
| **后台服务** | Background SW | `src/entrypoints/background.ts`, `src/lib/keys.ts` | ECDICT 词典按需加载查询、大模型统一接口封装 (AI SDK)、API Key 安全保管、快捷键中继 |
| **卡片与交互** | Custom Element | `src/lib/card.ts`, `src/lib/keynav.ts`, `src/lib/speak.ts` | Shadow DOM 隔离的毛玻璃卡片、Web Speech 本地发音、键盘导航 |
| **选项与配置** | Options Page | `src/entrypoints/options/main.ts`, `src/lib/settings.ts`, `src/lib/anki.ts` | 实时配置沙盒、11+ 服务商管理、模型列表动态拉取、Anki TSV 导出、JSON 备份与合并 |
| **工具栏弹窗** | Action Popup | `src/entrypoints/popup/main.ts` | 总开关、当前站点黑名单快捷切换、等级滑块、本页标注统计 |

---

## 三、18 项核心审计问题详细回答

### 1. Glint 有哪些用户可见功能？
1. **分级划词高亮 (Highlighting)**: 按 CEFR 等级 (A1~C2) 或国内考试静音门槛 (中考/高考/四级/六级/考研)，自动高亮超出用户词汇量的难词及生僻词。
2. **备考模式 (Exam Target Mode)**: 限制高亮仅针对四级、六级、考研、托福、雅思、GRE 考纲词表。
3. **悬浮毛玻璃词义卡片 (Hover Card)**: 鼠标悬停 220ms 呼出，展示单词原形、音标、考试标签、本地中文释义。
4. **原生离线发音 (TTS)**: 点击卡片内小喇叭，通过 Web Speech API 调用 macOS 本地优质语音离线朗读单词。
5. **AI 语境深度释义 (Contextual AI Sense)**: 主动点击“AI 释义”后，调用已配置的大模型针对当前句子深度解析词义、给出中文一句话义项、原句翻译、新例句与助记。
6. **生词标记与记忆 (Known Words)**: 点击“✓ 认识”后该词进入已知词库，之后全站永久静音不再标注。
7. **快捷键无障碍导航 (Keyboard Nav)**: `Alt+G` (下一个标注词并弹出卡片)、`Alt+Shift+G` (上一个)、`Esc` (收起卡片)。
8. **站点黑名单管理 (Site Blacklist)**: 弹窗与设置页中一键禁用当前域名（自动包含子域名）。
9. **学习数据导出与同步 (Anki Export & Backup)**: 已生成的 AI 语境卡片一键导出为 Anki TSV 格式（自动建 Deck 并带分层标签）；设置与词表 JSON 导出导入。
10. **实时交互预览沙盒 (Options Sandbox)**: 设置页右侧实时展示高亮样式与卡片交互，设置项改动即时生效。

### 2. 每个功能的输入、处理、输出是什么？
* **全页分词 (`scan`)**:
  - *输入*: DOM 树 (`document.body`)、`Settings`、`knownWords`、`examWords`。
  - *处理*: 4000 字符拉丁文占比启发式检查 → 过滤非英文区块与代码块 → `TreeWalker` 过滤不可见标签 → 正则单词匹配 → 标识符过滤 → 词形归一化与还原消歧 → 考纲与已知词过滤。
  - *输出*: `Token[]`（Text 节点、起始终止偏移、原词、词根、等级）。
* **高亮绘制 (`paint`)**:
  - *输入*: `Token[]`。
  - *处理*: 遍历构造 `Range` 对象，提交至 `CSS.highlights.set('glint-mark', new Highlight(...ranges))`。通过 `adoptedStyleSheets` 动态更新 `::highlight(glint-mark)` 样式。
  - *输出*: 浏览器原生渲染下划线或背景，零 DOM 结构改变。
* **悬浮检测 (`HoverTracker`)**:
  - *输入*: `mousemove` 坐标 `(x, y)`。
  - *处理*: 50ms 节流 → 判断是否有选中区域 → `caretPositionFromPoint` 转换屏幕坐标为 Text 节点及偏移 → 倒排索引检索 `Token` → 220ms 延时防抖。
  - *输出*: 触发 `onEnter(token, rect)` 或 `onLeave()`。
* **词义卡片 (`Card`)**:
  - *输入*: `Token`、边界矩形 `DOMRect`。
  - *处理*: 挂载 `<glint-card>` (Shadow DOM) → 选边避让 (`pickSide`) → 骨架屏 → 并行读取本地词库与 AI 缓存 → 语境一致性比对 (`sameSentence`) → 渲染内容与动效。
  - *输出*: 页面指定坐标处弹出毛玻璃卡片。
* **AI 语境分析 (`analyze`)**:
  - *输入*: 单词表面形式、词根原型、原句文本。
  - *处理*: Background 鉴权 → Vercel AI SDK 构造 prompt 请求选定的大模型 → 90s 超时与 1 次重试控制 → JSON 容错解析 → 写入 `explanationsStore`（带 2000 条上限自动 LRU 淘汰）。
  - *输出*: 结构化 `Analysis` 对象。

### 3. 哪些代码属于 Chrome-specific infrastructure？
1. `wxt.config.ts`: `minimum_chrome_version: '128'` 声明、Chrome 专用的模块预加载调整 (`modulePreload: false`)、WXT 框架的 Chrome 专有 runner。
2. `background.ts`: Service Worker 生命周期防御逻辑（针对 Chromium Service Worker 随时回收做的 `dictPromise` 内存重构，以及应对 Chromium `runtime.onMessage` 返回 Promise 丢弃 bug 的 `sendResponse(true)` 强占通道模式）。
3. `content.ts`: 针对 Chromium iframe 消息竞争添加的 `window.top !== window.self` 判定。
4. `package.json`: 对 WXT 工具链和 `#imports` 虚拟模块的强耦合依赖。

### 4. 哪些代码属于核心算法？
1. `src/lib/lemma.ts`: 纯规则英语词形还原算法 (`ruleLemma`)，涵盖双写还原 (`undouble`)、不发音 e 丢失判定 (`dropsSilentE`)、时态/复数/比较级/副词还原状态机。
2. `src/lib/lexicon.ts`: 词形归一化与基于词库反查消歧的原型判定决策树。
3. `src/lib/scan.ts`: 英文文本启发式检测 (`looksEnglish`)、上下文标识符识别 (`inIdentifier`)、句子智能边界探测与 20+ 缩写词消歧截断算法 (`sliceSentence`, `boundaryAt`, `clipAround`)。
4. `src/lib/hover.ts`: 倒排索引与坐标反查的高性能命中检测。
5. `src/lib/card.ts`: 视口空间自适应选边与防抖避让算法 (`pickSide`)、句子归一化模糊比对算法 (`sameSentence`)。
6. `src/lib/text.ts`: 词语边界加粗与 HTML 安全转义 (`boldWord`, `escapeHtml`)。
7. `src/lib/settings.ts`: 备份 Schema 严格校验与双机时间戳合并算法 (`parseBackup`, `mergeBackup`)。

### 5. 哪些部分可以直接复用？
* **完全无平台依赖的核心业务模块**:
  - `src/lib/lemma.ts` (词形还原算法)
  - `src/lib/text.ts` (文本转义与安全加粗)
  - `src/lib/types.ts` (核心类型定义与服务商规范)
  - `src/lib/anki.ts` (Anki TSV 导出生成器)
  - `src/lib/controls.ts` (自定义滑块轨道比例计算)
  - `src/assets/lexicon.json`、`public/data/dict.json`、`public/data/exams.json` (核心词典数据)
  - `tests/*.test.ts` (除 WXT 替身外的绝大部分单元测试用例)

### 6. 哪些部分必须重新设计？
1. **DOM 高亮与 MutationObserver 架构 (重大性能隐患)**:
   - 原版在 `content.ts` 监听 `document.body` 的任何 DOM 变动，一旦触发就在 500ms 后对**整页全量重新扫描** (`scan(document.body)`)，并彻底重置全页所有 Range。
   - 在复杂 SPA、长推文流、动态新闻页面上，这会造成频繁的全页遍历与 Long Task。必须设计**增量扫描与脏子树局部更新**机制。
2. **构建系统 (去除 WXT，转向 Safari-first 现代工程)**:
   - 移除针对 Chrome 的 WXT 依赖，基于 Vite + TypeScript 构建纯粹标准的 WebExtension，输出可直接在 Safari TP 中无需 Xcode 即可载入的目录结构。
3. **存储与通信层**:
   - 剔除 WXT 的 `storage.defineItem` 抽象，改用原生 WebExtension `browser.storage.local`，建立轻量类型安全的 Store。
4. **Content Script 内存占用**:
   - 原版直接将 435KB JSON 在首屏解压并构建 57,000 个词的 3 个巨大 Map，导致每个打开的标签页都额外吃掉 ~15MB 内存。需要设计惰性解析或紧凑结构。

### 7. 哪些 Chrome API 在 Safari 中不存在？
1. `chrome.offscreen`: Safari 不支持离线文档。
2. `minimum_chrome_version`: Safari manifest 会报警或忽略。
3. `chrome.commands`: Safari 支持 `browser.commands`，但在 macOS 上系统保留快捷键很多，需确保提示清晰。
4. `document.caretRangeFromPoint`: WebKit 历史上支持此私有 API，但在现代 STP 中已标准支持 `document.caretPositionFromPoint`。

### 8. 哪些功能可能受到 Safari/WebKit 限制？
1. **Temporary Extension 生命周期**: Safari 退出或约 24 小时后，未签名的临时扩展会被自动移除，这是 Apple 官方机制，完全符合个人使用场景，但应在文档中明确记录。
2. **Host 权限与跨域 Fetch**: Safari 对扩展后台发起的外网请求执行非常严格的隐私权限控制，用户需在 Safari 设置中允许访问对应域名。
3. **CSS Custom Highlight API 限制**: WebKit 严格按照 W3C 规范仅允许高亮伪元素使用文字修饰、背景色与文本阴影，禁止使用可能引起 layout thrashing 的盒模型属性（Glint 的已有设计完全符合此规范）。

### 9. 哪些地方可能导致页面加载变慢？
1. Content script 在每个页面载入时执行 `ensureLoaded()`，同步展开 5.7 万个单词进 Map。
2. 首次全量 `scan(document.body)` 使用 `TreeWalker` 遍历大型页面所有文本节点。
3. `collectCodeWords(root)` 在深层 DOM 树上执行 `querySelectorAll` 并执行全局正则匹配。

### 10. 哪些地方可能产生 Long Task？
1. 初次字典反序列化（在低性能机器或超长文档上可能达到 20~40ms）。
2. 在含有数十万字的大型技术文档/维基百科上执行一次全量 `scan()`。
3. 一次性向 `Highlight` 提交数千个 `Range` 对象时触发的样式重算。

### 11. 哪些地方可能造成 MutationObserver 风暴？
1. SPA 框架（React、Vue）状态频繁变更或虚拟列表滚动。
2. 社交媒体无限加载（Twitter/X、Reddit）。
3. 聊天打字机流式输出（ChatGPT、Claude 网页端）：每秒产生几十次 `characterData` 变动，原版的 500ms debounce 在持续流式输出中会不断推迟或在停止后突然引发一次巨大的全页全量重扫。

### 12. 哪些地方造成大量 DOM 修改？
* 原版通过 CSS Custom Highlight API 已避免了最恶劣的 `<span>` 包裹。
* 但存在隐患：如果悬浮卡片 `<glint-card>` 在 DOM 变动时被误判为页面自身内容，或者 `document.adoptedStyleSheets` 频繁重新赋值数组，会引发全局样式重算 (Recalculate Style)。

### 13. 哪些地方可能产生 memory leak？
1. **HoverTracker 的强引用 Map**: 原版 `index = new Map<Text, Token[]>()`。如果被扫描过的 DOM 文本节点随后被宿主页面框架删除（如 React 组件销毁），由于 `index` 仍然持有该 Text 节点的强引用，导致孤立 DOM 树 (Detached DOM Tree) 无法被 GC 回收！
2. **多次创建的 Range 实例**: 全量重扫若未显式清理旧 Highlight 中的 Range 集合，可能滞留 Text 引用。

### 14. 哪些地方存在重复扫描？
1. 页面仅仅在底部插入一条评论或一条消息，原版却将前文已经扫描并确定难度的成千上万个段落重新遍历、正则匹配、词形还原一次。
2. 每次重扫都重新对页面所有 `<code>` 和 `<pre>` 重新提取代码黑话。

### 15. 哪些地方存在不必要的 network request？
1. 原版每次 hover 本地词典词条都通过跨进程 `sendMessage` 询问 Background，在高频移动时产生 IPC 序列化损耗。
2. 每次发请求前重复通过 `browser.permissions.contains` 进行异步跨进程权限校验。

### 16. AI/API key 是否存在暴露风险？
* 原版在此处的边界划分非常优良：API Key 保存在独立的 `local:apiKeys` 中，且仅由 Background 和 Options 引用；Content Script 严禁引入 `keys.ts`。
* Safari 重构必须严格保持此隔离，严禁将 Key 泄露给页面或 Content Script 上下文。

### 17. 是否存在 XSS / DOM injection / message injection 等安全问题？
1. **卡片 innerHTML 拼接风险**: 原版 `Card.render()` 和 `Options` 大量使用模板字符串拼装 HTML。虽然有 `escape` 转义，但如果 AI 模型返回的 JSON 中夹带恶意构造的 HTML 或利用提示词注入 (Prompt Injection) 诱导输出伪造字段，一旦有字段漏转义或通过属性注入，就会在 Shadow DOM 内产生 XSS 漏洞。
2. **Message 来源校验**: Background 的 `onMessage` 必须校验发送者是否确为扩展自身内部页面，防止宿主网页注入消息冒充。

### 18. 哪些地方值得在 Safari 重构时重新设计？
1. **构建工程现代化**: 建立轻量直观的 Vite + TypeScript Safari-first 结构，直出符合 Safari Temporary Extension 标准的解包目录。
2. **增量增量 DOM 扫描引擎 (Incremental Scanner)**:
   - 记录已扫描节点与版本号，只扫描新增或发生 `characterData` 变动的局部子树。
   - 避免 SPA 页面和无限滚动的全量重扫。
3. **WeakMap 内存安全索引**:
   - `HoverTracker` 使用 `WeakMap<Text, Token[]>`，Text 节点一旦被宿主页面删除，索引自动释放，零内存泄露。
4. **词典数据内存优化**:
   - 探索词库按需解压或共享结构，降低多标签页并发时的常驻内存。
5. **卡片安全性升级**:
   - 关键文本采用 `textContent` 或安全的 DOM 生成器装配，彻底杜绝 innerHTML 注入风险。
6. **Safari 视觉与交互原生化**:
   - 充分发挥 WebKit 的 `-webkit-backdrop-filter` 硬件加速毛玻璃与 `oklch` 广色域。

---

## 四、审计结论与迁移建议

Glint 原版的算法基础（词形还原、断句、CSS Custom Highlight 思路、API Key 隔离）非常扎实且优秀，但原版的 **DOM 变动监听策略（全量重扫）、Text 节点强引用机制、以及针对 Chrome/WXT 的构建体系** 不适合直接搬进 Safari。
必须在保留其全部核心功能与算法精髓的前提下，进行以 **Safari-first / WebKit-first** 为核心的高性能重构。
