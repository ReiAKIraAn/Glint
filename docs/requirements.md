# Glint Safari Personal Edition - 需求规格与迁移矩阵 (Requirements & Migration Matrix)

## 一、项目定位与目标范围

* **项目名称**: Glint Safari Personal Edition
* **项目性质**: 个人长期自用、开源参考源为 [Glint](https://github.com/whyubel1eve/glint)。
* **明确限定范围**:
  - **运行平台**: 仅限 macOS。
  - **目标浏览器**: 仅限最新 **Safari Technology Preview (STP)**。
  - **非目标范围**:
    - 不考虑任何旧版 Safari（如 Safari 16 及更早版本）。
    - 不考虑 iOS / iPadOS。
    - 不考虑 Chrome / Firefox / Edge 或跨浏览器抽象层。
    - 不考虑 Mac App Store / TestFlight / 公开发布。
    - 不考虑用户账号、登录鉴权、Telemetry / Analytics 收集。
    - 不购买 Apple Developer Program，不使用复杂的 Xcode App Wrapper。
  - **发布与安装方式**: 采用 Safari Technology Preview 支持的 **Temporary Extension (未打包/未签名扩展文件夹)** 载入工作流。

---

## 二、一级质量与性能原则

1. **页面零干扰 (Zero Footprint)**: 扩展注入不应显著拖慢网页的首屏加载 (`DOMContentLoaded`, `FCP`, `LCP`)，不阻碍主线程渲染。
2. **零布局破坏 (Zero DOM Mutation for Highlighting)**: 全面基于现代 Web 标准 **CSS Custom Highlight API**，绝不允许向宿主页面文本注入 `<span>` 标签。
3. **彻底防范 MutationObserver 风暴**: 坚决杜绝在复杂 SPA (React, Vue)、长推文流、聊天打字机等动态页面中触发重复全页全量重扫。
4. **内存绝对安全 (Leak-free)**: 文本节点索引使用 `WeakMap`，元素销毁即自动 GC，保证在多标签页、长会话中内存平稳。
5. **绝对安全边界 (Secure by Design)**: 所有网页文本视为不可信输入；API Key 永不进入页面或 Content Script；杜绝 innerHTML 注入与 Prompt Injection 引起的 XSS。

---

## 三、功能迁移矩阵 (Migration Matrix)

| 功能项 (Feature) | 原始功能行为 (Original Behavior) | Chrome 原始实现 (Chrome Implementation) | Safari 重构设计 (Safari Implementation) | 迁移状态 (Status) | 设计决策与权衡说明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **分级难词高亮** | 根据 CEFR (A1~C2) 等级标记高于用户水平的词，同页可去重 | Content Script 扫描 + CSS Custom Highlight API | 增量脏节点扫描引擎 + CSS Custom Highlight API | `Intentionally Redesigned` | 算法复用，但将扫描机制由“全页重扫”重构为“增量扫描与脏节点批处理”，大幅降低 CPU 占用 |
| **国内考纲静音门槛** | 标记已通过中考/高考/四级/六级/考研，静音对应词表 | `lexicon.ts` 的 `exams` 字典比对 | 保持原算法逻辑，优化字典展开与查询性能 | `Implemented` | 完全保留该功能，优化其内存数据结构 |
| **备考模式过滤** | 仅高亮特定考试考纲范围内的超纲生词 | 从 `exams.json` 按需加载单词集合求交集 | 保持原行为，与增量扫描无缝融合 | `Implemented` | 功能与交互 100% 保持一致 |
| **悬浮词义卡片** | 鼠标悬停 220ms 弹出毛玻璃卡片，显示原型/音标/释义/难度徽章 | `<glint-card>` Custom Element + Shadow DOM | Custom Element + Shadow DOM + WebKit 原生硬件加速毛玻璃 | `Implemented` | 样式细节充分运用 WebKit 的 `-webkit-backdrop-filter` 与 `oklch` 广色域 |
| **鼠标文字坐标反查** | 根据光标位置计算落在哪个文本节点和字符偏移 | `caretPositionFromPoint` 降级 `caretRangeFromPoint` | 优先使用标准 `document.caretPositionFromPoint` | `Implemented` | STP 253 原生支持标准 API，去除历史遗留兼容垫片 |
| **原生离线单词发音** | 点击卡片小喇叭朗读当前单词 | Web Speech API `speechSynthesis` 筛选 `localService` | 优先调用 macOS WebKit 本地优质英文语音库 | `Implemented` | 零权限、零网络，保护用户隐私 |
| **AI 语境深度解析** | 主动点击后调用大模型解析当前句中的特定词义并提供例句 | Background Service Worker 统一调用 Vercel AI SDK | Safari MV3 Background 路由调度与安全超时控制 | `Implemented` | API Key 严格驻留后台，Content Script 仅接收序列化结果 |
| **AI 释义本地持久化** | 自动记录生成结果，相同句子秒显免费，不同句子标记为“另一句” | `chrome.storage.local` 存储，上限 2000 条 LRU 淘汰 | 采用原生类型安全 `browser.storage.local` Store | `Implemented` | 保持 2000 条上限及相同句子模糊比对机制 |
| **生词掌握标记** | 点击“✓ 认识”，以后全站不再标注 | 写入 `knownWordsStore` 并动态更新全页高亮 | 原生存储同步，增量更新受影响的 Text 节点 | `Implemented` | 优化更新粒度，无需推倒重建整页高亮 |
| **键盘遍历与无障碍** | `Alt+G` / `Alt+Shift+G` / `Esc` 导航并定位词义卡片 | `browser.commands` 转发至 Content Script | `browser.commands` 监听 + 页面事件平滑滚动定位 | `Implemented` | 保留完整键盘导航体验 |
| **工具栏弹窗** | 快速查看本页统计、总开关、当前站点禁用 | HTML Popup + `activeTab` 权限查询 Content Script | 纯标准原生 WebExtension Action Popup | `Implemented` | 极简原生响应，零冗余框架依赖 |
| **当前网站独立黑名单** | 记忆特定站点禁用状态，子域名自动联动 | URL 域名归一化匹配与 Storage 监听 | 纯标准算法复用，严格域名比对 | `Implemented` | 完全保留该能力 |
| **Anki 卡片一键导出** | 将已生成的释义导出为无需插件的 Anki TSV 格式 | 纯文本生成器，支持分层标签和默认 Deck | 纯函数复用，浏览器原生 Blob 下载 | `Implemented` | 完全保留 Anki 格式逻辑 |
| **配置与词表备份导入** | JSON 文件导入导出，支持版本校验与双机合并 | JSON 序列化与严格 Schema 校验 | 纯函数复用，强化类型校验与错误提示 | `Implemented` | 绝不备份 API Key，保障资产安全 |
| **实时预览配置沙盒** | 设置页右侧实时展示高亮和卡片互动 | 复用 Content Script 内部组件 | 原生组件嵌入设置面板，保证与实际网页行为绝对一致 | `Implemented` | 零模拟，直接跑真实逻辑 |
| **服务商与模型列表拉取** | 动态从 API 接口获取可用模型并填入列表 | Background 发起网络请求并解析各家格式 | 标准 fetch 代理与网络超时处理 | `Implemented` | 保持 11+ 家服务商预置配置与自定义兼容能力 |

---

## 四、非功能性需求与性能指标

### 1. 性能指标 (SLA)
* **首屏扫描耗时**:
  - 常规页面 (文本 < 1 万词): 扫描分词及 Range 提交耗时 `< 10ms`。
  - 大型长篇文档 (文本 5~10 万词): 扫描耗时 `< 35ms`。
* **DOM 变动处理延时**:
  - 聊天打字机与无限滚动时，增量批处理耗时 `< 5ms`，**零 Long Task (> 50ms)**。
* **内存占用**:
  - Content Script 运行时内存驻留降低至 `< 3MB`，单页标签关闭后 DOM 节点垃圾回收率 100%。

### 2. 安全合规要求
* **CSP 严格隔离**: 扩展页面与后台脚本启用严格 CSP，禁用 `unsafe-eval`。
* **文本注入防御**: 卡片内所有展示的文本均经过强制 HTML 实体转义或以 `textContent` 写入，彻底阻断 XSS。
* **密钥存储边界**: API Key 绝不以任何形式暴露至 `document`、DOM 属性或可被页面 JavaScript 访问的存储空间中。
