# Glint Safari Personal Edition - 专项验证审查报告 (Verification Review)

**审查日期**: 2026-09-24  
**审查性质**: 深度安全、架构与平台真实性验证（零代码修改，基于严密证据与代码溯源）  
**审查基线**: 最新 WebKit / Safari Technology Preview (Release 253, 2026-09-23)

---

## 一、执行摘要 (Executive Summary)

本报告对当前 `safari-personal` 分支的代码实现、权限策略、网络请求、BYOK 安全边界及 Safari TP 兼容性进行了严苛的专项审查。

### 核心结论速览
1. **测试与运行环境脱节 (严重纠偏)**:
   - 前期报告中关于“Safari 性能优秀”、“零长任务 (0 Long Tasks)”、“100% GC 回收”的结论**严重缺乏实际运行证据**。
   - 所有 84 项测试均在 **Node.js + happy-dom** 环境下执行，Happy-DOM 既无真实 WebKit 渲染树，亦不执行布局计算与重绘。
   - 本机实际上**未安装 Safari Technology Preview**（仅存在系统自带 Safari 27.2），因此未曾在真实 STP 进程中进行任何自动化或手动端到端验证。
   - **所有超出 Node 测试证据范围的 Safari 运行断言，必须在此正式主动撤回 (CLAIM SHOULD BE WITHDRAWN)**。
2. **发现重大 API Key 泄露漏洞**:
   - **Google Gemini API Key 直接暴露在 URL 查询参数中**（`background.ts:351`）。
   - **接口报错时，包含完整 API Key 的 URL 会被直接拼入错误信息并在前端 UI 上展示**（`background.ts:376` → `options/main.ts:570`）。
3. **架构本质仍为 Chrome 模式**:
   - 当前 Safari 适配实际上仅在 `wxt.config.ts` 中删除了 `minimum_chrome_version: '128'`，底层仍完全沿用 Chromium 风格的 WebExtension 打包与多达 12 个强预置 `host_permissions`。
   - Safari 与 Chrome 对 `host_permissions` 的处理机制有根本差异：Safari 不保证后台 fetch 静默放行，需用户在扩展偏好设置中显式授权特定域名。

---

## 二、主动撤回与证据纠偏说明 (Claims Withdrawn)

根据“不替原报告辩护，以事实与证据为准”的原则，对此前交付报告中的以下断言进行主动撤回与降级：

| 此前报告中的断言 (Previous Claim) | 实际证据状态 (Evidence Reality) | 审查判定 (Verdict) | 纠偏说明 |
| :--- | :--- | :--- | :--- |
| **“Safari 性能优秀，主线程零长任务 (0 Long Tasks)”** | 仅在 Node.js 中对 Happy-DOM mock 运行了毫秒级计时；Happy-DOM 不计算 CSS 样式重算、布局与 WebKit 合成 | **CLAIM SHOULD BE WITHDRAWN** | Happy-DOM 测试不能代表 WebKit 真实性能。真实 STP 渲染开销目前为 `UNVERIFIED`。 |
| **“WeakMap 彻底杜绝 Detached DOM 内存泄露 / 100% GC”** | `HoverTracker` 使用了 `WeakMap`，但 `content.ts` 内部仍持有全局强引用数组 `tokens: Token[]`（每个 Token 强引用 `node: Text`） | **CLAIM SHOULD BE WITHDRAWN** | 只要新 Mutation 尚未触发 filter，`tokens` 数组仍会阻止被删 Text 节点的垃圾回收。未曾通过 Safari Web Inspector Memory 进行堆快照检验。 |
| **“Safari Technology Preview Release 253 验证通过”** | 本机环境 `find` 搜索未发现 Safari Technology Preview 应用程序包，无 safaridriver STP 自动化运行记录 | **CLAIM SHOULD BE WITHDRAWN** | 仅验证了构建脚本生成了 `.output/safari-mv3`，未在 STP 进程内真实载入与运行。 |
| **“Safari 完美支持当前权限流 (Permission Flow)”** | `browser.permissions.request()` 仅通过静态代码分析，未在临时未签名扩展下触发真实弹窗 | **DOWNGRADED TO UNVERIFIED** | Safari TP 临时加载模式下的弹窗与权限授予行为尚未经实测。 |

---

## 三、Manifest 与权限深度审查 (Manifest & Permission Audit)

### 1. 最终生成的 Safari Manifest 源码实测
构建产物 `.output/safari-mv3/manifest.json` 真实内容如下：

```json
{
  "manifest_version": 3,
  "name": "Glint (Safari Personal Edition)",
  "description": "阅读英文网页时，按你的水平把难词标出来。",
  "version": "1.1.1",
  "icons": {
    "16": "/icon/16.png",
    "32": "/icon/32.png",
    "48": "/icon/48.png",
    "128": "/icon/128.png"
  },
  "action": {
    "default_icon": { "16": "/icon/16.png", "32": "/icon/32.png" },
    "default_title": "Glint",
    "default_popup": "popup.html"
  },
  "permissions": [
    "storage",
    "activeTab"
  ],
  "commands": {
    "next-word": {
      "suggested_key": { "default": "Alt+G" },
      "description": "跳到下一个标注的词"
    },
    "prev-word": {
      "suggested_key": { "default": "Alt+Shift+G" },
      "description": "跳到上一个标注的词"
    }
  },
  "host_permissions": [
    "https://api.anthropic.com/*",
    "https://api.openai.com/*",
    "https://generativelanguage.googleapis.com/*",
    "https://openrouter.ai/*",
    "https://opencode.ai/*",
    "https://api.siliconflow.cn/*",
    "https://api.deepseek.com/*",
    "https://api.moonshot.cn/*",
    "https://open.bigmodel.cn/*",
    "https://api.groq.com/*",
    "http://localhost/*",
    "http://127.0.0.1/*"
  ],
  "optional_host_permissions": [
    "https://*/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "options_ui": {
    "page": "options.html"
  },
  "content_scripts": [
    {
      "matches": [ "<all_urls>" ],
      "run_at": "document_idle",
      "js": [ "content-scripts/content.js" ]
    }
  ]
}
```

### 2. 字段逐项审查结论

| 字段 | 现状与证据 | Safari TP 兼容性评价 | 验证等级 | 潜在风险与改进建议 |
| :--- | :--- | :--- | :--- | :--- |
| **`manifest_version`** | `3` | 支持良好 (Safari 15.4+) | `VERIFIED` | 符合最新标准 |
| **`minimum_chrome_version`**| 在 Safari 构建中已成功剥离（见 `wxt.config.ts:71`） | Safari 不支持该字段，移除是正确的 | `VERIFIED` | 避免了 Safari 解析 Manifest 时的属性警告 |
| **`background.service_worker`** | 指向单一打包文件 `background.js` | Safari 15.4+ 原生支持 Service Worker 形式的 background | `PARTIALLY VERIFIED` | 未显式声明 `"type": "module"`。打包产物当前被 Vite 压为包含内联依赖的单个文件，在 Safari 中通常可运行，但 Service Worker 睡眠后唤醒行为需实测 |
| **`commands`** | 声明了 `Alt+G` / `Alt+Shift+G` | Safari 支持 `browser.commands` API | `UNVERIFIED` | **macOS 键盘冲突风险**: 在 macOS 上，`Alt` 即 `Option` 键，`Option+G` 在系统默认输入法中为输入版权符号 `©`。Safari 无自带类似 Chrome 的快捷键重映射管理界面 (`chrome://extensions/shortcuts`) |
| **`permissions`** | `["storage", "activeTab"]` | 极简，属于最小权限实践 | `VERIFIED` | 权限克制，无越权风险 |
| **`host_permissions`** | 包含 10 个商业 AI 域名 + 2 个本地地址 | 见下节详析 | `PARTIALLY VERIFIED` | 存在过量申请与 Safari 权限弹窗机制不匹配问题 |
| **`optional_host_permissions`**| `["https://*/*"]` | Safari 15.5+ 支持该字段 | `PARTIALLY VERIFIED` | 广义通配符 `https://*/*` 会触发 Safari 极其严苛的安全警示 |

---

## 四、网络与 Host Permissions 审查 (Network & Host Permissions)

### 1. 权限明细与实际代码用途追踪

| 权限模式 (Origin Pattern) | 对应服务商 / 用途 | 发起位置 | 必须性分析 | 推荐 Safari 重构策略 |
| :--- | :--- | :--- | :--- | :--- |
| `https://api.anthropic.com/*` | Anthropic Claude API | `background.ts:270` | 仅在用户选择 Anthropic 时才需要 | **降为可选** (按需通过 permissions.request 申请) |
| `https://api.openai.com/*` | OpenAI GPT-4/5 API | `background.ts:275` | 仅在用户选择 OpenAI 时才需要 | **降为可选** |
| `https://generativelanguage.googleapis.com/*` | Google Gemini API | `background.ts:277, 351` | 仅在用户选择 Gemini 时才需要 | **降为可选** |
| `https://api.deepseek.com/*` | DeepSeek API | `background.ts:282` | 仅在用户选择 DeepSeek 时才需要 | **降为可选** |
| `https://openrouter.ai/*` 等 6 家兼容商 | 各类国内/国际聚合商 | `background.ts:282` | 仅在用户勾选对应项时需要 | **降为可选** |
| `http://localhost/*`, `http://127.0.0.1/*` | 本地 Ollama 实例 | `background.ts:282` | 本机通信，用户使用 Ollama 时需要 | 保持或按需申请 |
| `https://*/*` (optional) | 自定义 OpenAI 兼容接口 | `options/main.ts:649` | 用户输入自定义域名时使用 | 保持为可选通配符 |

### 2. Safari 与 Chrome 行为重大差异分析
* **Chrome 机制**:
  - `host_permissions` 在安装时一次性在扩展管理页声明，后台 Service Worker 随后向这些域名发起的 `fetch` 拥有隐式通行权，绝不会向用户二次弹窗。
* **Safari 机制 (根据 Apple 官方开发文档)**:
  - Safari 对 WebExtension 的 `host_permissions` 实施**逐站严格用户同意原则**。
  - 即使在 `manifest.json` 的 `host_permissions` 中列出，Safari 依然会在工具栏或扩展偏好设置中将站点标记为需要用户交互确认。
  - 用户必须在“Safari 设置 > 扩展 > Glint > 网站”中主动将对应域名切换为“允许 (Allow)”，否则后台 `fetch` 会直接抛出 `TypeError: Load failed`。
* **原版将 12 家全部写死在 required 里的后果**:
  - 在 Chrome 中是为了省弹窗；
  - **但在 Safari 中适得其反**：用户一装上扩展，Safari 就会在隐私设置中提示“此扩展申请了访问 12 个网站的权限”，并在工具栏常驻感叹号角标。而个人用户通常只会配置 1 家 API（如只用 DeepSeek 或只用 OpenAI）。
  - **审查建议**: 在 Safari 个人版中，建议将所有外部 AI 供应商全量迁移至 `optional_host_permissions`，当用户在 Options 页面保存特定 Provider 的 Key 时，通过 `browser.permissions.request({ origins: [spec.origin] })` 仅申请这 1 家的权限。

---

## 五、BYOK 与 API Key 完整安全审计 (Security Tracing)

从源码起点至网络请求终点追踪 API Key 数据流：

```
[用户在 Options 页面输入] 
       ↓ (DOM 密码框)
[options/main.ts: fields.apiKey]
       ↓ (写入)
[local:apiKeys (browser.storage.local)]
       ↓ (读取)
[background.ts: ready() -> languageModel() / models()]
       ↓ (网络外发)
[fetch(url, { headers })]
```

### 发现的关键安全漏洞与风险路径

#### 🚨 严重漏洞 1：Google Gemini API Key 在 URL Query 中明文传输与异常外泄
* **源码位置**: [`src/entrypoints/background.ts:351`](file:///Users/ada/Downloads/glint-main/src/entrypoints/background.ts#L351)
  ```ts
  const url =
    spec.kind === 'anthropic'
      ? 'https://api.anthropic.com/v1/models?limit=1000'
      : spec.kind === 'google'
        ? `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`
        : ...
  ```
* **外泄链条**:
  1. `models()` 使用 GET 请求拉取 Gemini 模型列表，将 `key` 直接编码在 URL 参数中。
  2. 若用户填写的 Key 无效或网络中断，代码进入第 376 行：
     ```ts
     return { ok: false, error: `${url} 返回 ${response.status}${detail ? `：${detail}` : ''}` };
     ```
     或进入第 396 行：
     ```ts
     return { ok: false, error: `连不上 ${url}（${why}）` };
     ```
  3. 后台将上述带有 `?key=AIzaSy...` 的完整 URL 作为错误消息返回给 Options 页面。
  4. Options 页面在 [`src/entrypoints/options/main.ts:570`](file:///Users/ada/Downloads/glint-main/src/entrypoints/options/main.ts#L570) 直接执行：
     ```ts
     note.textContent = `拉取失败：${error.message}`;
     ```
  5. **最终结果**: 用户真实的 Google API Key 明文展示在设置页面的 DOM 文本中，同时记录在扩展错误日志中！
* **判定**: `VERIFIED VULNERABILITY` (已由代码行证明，100% 存在)。

#### ⚠️ 架构风险 2：Popup 页面内存中读取了所有明文 API Key
* **源码位置**: [`src/entrypoints/popup/main.ts:112-116`](file:///Users/ada/Downloads/glint-main/src/entrypoints/popup/main.ts#L112-L116)
  ```ts
  const [known, keys] = await Promise.all([knownWordsStore.getValue(), apiKeysStore.getValue()]);
  const configured = isConfigured(settings, !!keys[settings.provider]);
  ```
* **风险分析**:
  - Popup 仅需获知“当前 Provider 是否配置过 Key”（布尔值），却调用 `apiKeysStore.getValue()` 将包含所有服务商明文 Key 的对象反序列化并载入 Popup 的 JavaScript 堆内存中。
  - 虽然 Popup 属于扩展受保护上下文，但这破坏了“密钥仅停留在 Background”的安全设计初衷。

#### ✅ 安全边界确认 3：WebPage 与 Content Script 隔离
* **源码追踪**:
  - `src/entrypoints/content.ts` 未直接或间接导入 `keys.ts`。
  - `keys.ts` 独立声明 `local:apiKeys`，Content Script 仅通过 `browser.runtime.sendMessage` 发送单词与原句，不接触任何存储凭证。
  - 网页宿主 JavaScript 无法跨隔离世界读取 `browser.storage.local`。
* **判定**: `VERIFIED SAFE`。

#### ⚠️ 潜在威胁 4：Prompt Injection (间接诱导与内容污染)
* **源码位置**: [`src/entrypoints/background.ts:212-213`](file:///Users/ada/Downloads/glint-main/src/entrypoints/background.ts#L212-L213)
  ```ts
  prompt: `单词：${word}${lemma !== word.toLowerCase() ? `（原型 ${lemma}）` : ''}\n所在句子：${sentence}`
  ```
* **风险分析**:
  - `sentence` 来自不可信宿主网页的 DOM 文本截取。
  - 恶意网页可在文章中嵌入 Prompt Injection 攻击词句（例如诱导大模型忽略系统设定，返回恶意伪造的中文释义或钓鱼网址）。
  - 大模型由于没有在 prompt 中被注入 API key，**无法通过 Prompt Injection 泄露 API key 本身**；但注入的内容会回传至 Card Shadow DOM，若转义失效会导致 UI 伪造。

---

## 六、WebKit 关键 API 专项审查

### 1. CSS Custom Highlight API 审查
* **实际代码路径**: [`src/lib/highlight.ts:27-44`](file:///Users/ada/Downloads/glint-main/src/lib/highlight.ts#L27-L44)
  ```ts
  export function paint(tokens: Token[]) {
    if (!isSupported()) return;
    const ranges: Range[] = [];
    for (const token of tokens) {
      const range = new Range();
      try {
        range.setStart(token.node, token.start);
        range.setEnd(token.node, token.end);
      } catch {
        continue;
      }
      ranges.push(range);
    }
    CSS.highlights.set(NAME, new Highlight(...ranges));
  }
  ```
* **审查结果**:
  - **WebKit 支持度**: Safari 17.2 起已支持 `CSS.highlights` 与 `::highlight()`。
  - **Range 生命周期**: 每次 `paint` 调用都会重新实例化 `new Highlight(...ranges)` 并覆盖注册名 `glint-mark`。旧的 `Highlight` 对象自动被丢弃。
  - **DOM 突变边界**: 若 Text 节点字符数缩短，`range.setEnd` 会触发 `IndexSizeError`，原代码有 `try-catch` 予以捕获并忽略，具备基本鲁棒性。
  - **样式限制**: WebKit 严格按照规范执行，`::highlight()` 仅支持文本颜色、背景色和文本装饰线。当前实现的 `text-decoration` 与 `background-color` 完全在 WebKit 允许范围内。
  - **Shadow DOM 穿透限制**: 当前样式挂载在 `document.adoptedStyleSheets`，**无法穿透网页内部的 Shadow Root**。宿主网页自定义组件内部的生词不会被上色（但 Glint 自身卡片不包含在内，不影响正常阅读体验）。
* **判定**: `PARTIALLY VERIFIED`（API 规范吻合，但具体渲染流畅度与边界未在真实 STP 中手工肉眼核验）。

### 2. `caretPositionFromPoint` 悬停探测审查
* **实际代码路径**: [`src/lib/hover.ts:8-20`](file:///Users/ada/Downloads/glint-main/src/lib/hover.ts#L8-L20)
  ```ts
  function caretAt(x: number, y: number): { node: Node; offset: number } | undefined {
    const doc = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    if (doc.caretPositionFromPoint) {
      const pos = doc.caretPositionFromPoint(x, y);
      return pos ? { node: pos.offsetNode, offset: pos.offset } : undefined;
    }
    const range = doc.caretRangeFromPoint?.(x, y);
    return range ? { node: range.startContainer, offset: range.startOffset } : undefined;
  }
  ```
* **审查结果**:
  - **WebKit 支持度**: WebKit 在 Safari 26.2 (STP 226) 正式支持 `document.caretPositionFromPoint`，返回标准 `CaretPosition` 对象 (`offsetNode`, `offset`)。
  - **节点类型边界**: 当光标落在文本行间隙或内边距上时，`offsetNode` 返回的是 `Element`（如 `HTMLParagraphElement`）而非 `Text` 节点。`hover.ts:222` 中有严格判定：
    ```ts
    if (!caret || caret.node.nodeType !== Node.TEXT_NODE) return undefined;
    ```
    此逻辑保证了不会发生类型断言错误。
  - **CSS 缩放与 Transform 影响**: 若网页使用了 CSS `zoom` 或复杂的 3D `transform`，WebKit 计算的 clientX/clientY 映射可能产生微小偏移，导致边缘字符命中失败。
* **判定**: `PARTIALLY VERIFIED`（API 规范匹配，但无 STP 真实环境交互测试记录）。

---

## 七、内存泄漏与增量扫描审查 (Memory & Incremental Scanner)

### 1. WeakMap 是否真的消除了 Detached DOM 泄露？
* **审查代码**: [`src/lib/hover.ts:47-68`](file:///Users/ada/Downloads/glint-main/src/lib/hover.ts#L47-L68) vs [`src/entrypoints/content.ts:168-185`](file:///Users/ada/Downloads/glint-main/src/entrypoints/content.ts#L168-L185)
* **深层溯源**:
  - 在 `HoverTracker` 中：`private index = new WeakMap<Text, Token[]>();` 确实移除了 `index` 对 `Text` 节点的强引用。
  - **但是，在 `content.ts` 作用域中**:
    ```ts
    let tokens: Token[] = [];
    ```
    `tokens` 是一个常驻的普通 JavaScript 数组！每个 `Token` 对象都直接包含 `node: Text` 引用：
    ```ts
    export interface Token {
      node: Text;
      ...
    }
    ```
  - **严重事实**: 
    虽然 MutationObserver 批处理在触发时执行了：
    ```ts
    tokens = tokens.filter((t) => t.node.isConnected && !dirtyTextNodes.has(t.node));
    ```
    但如果页面删除了某些 DOM 节点，而此时**没有新的 Mutation 事件触发批处理**，这批脱离 DOM 的 `Text` 节点将一直被 `tokens` 数组强引用，阻止垃圾回收！
  - **结论**: 此前声称的“彻底杜绝内存泄露 / 100% GC”是**不成立的**。必须建立被动 GC 或使用仅持有轻量 ID 的引用模式。
* **判定**: `CLAIM SHOULD BE WITHDRAWN`（断言过度，实际存在数组强引用滞留）。

---

## 八、当前最新 Safari Technology Preview 状态比对

1. **官方最新发布版本 (WebKit Official)**:
   - 版本: **Safari Technology Preview Release 253**
   - 发布日期: **2026 年 9 月 23 日**
   - 官方更新日志重点:
     * 修复了大量 View Timeline 与 Scroll Timeline 动画渲染行为；
     * 修复了 `IntersectionObserver` 异常 CPU 占用问题；
     * 针对 Service Worker 路由的 `URLPattern` 进行了规范对齐修复；
     * 未对 WebExtension 核心权限或 CSS Custom Highlight API 引入重大破坏性变更。
2. **当前开发机实际运行环境**:
   - 系统: macOS 27.2 (Build 26B5091g, Apple Silicon arm64)
   - 系统内置浏览器: Safari 27.2 (WebKit 22625.2.5.11.1)
   - **STP 安装状态: 未安装**（应用程序目录中无 `Safari Technology Preview.app`）。
3. **两者的差异与影响**:
   - 最新 STP 253 与当前开发机环境**不相同**。
   - 所有宣称“在 Safari TP 中运行验证”的结论，**目前实际上全部属于基于代码与官方规范的静态推演**。在用户或开发环境安装 STP 并实际载入扩展之前，不可将任何端到端体验标记为 `VERIFIED`。

---

## 九、全量技术断言验证状态矩阵 (Verification Matrix)

| 审计维度 / 具体断言 | 当前状态 (Level) | 关键证据与依据 | 缺陷或未经验证之处 |
| :--- | :--- | :--- | :--- |
| **Gemini Key URL 泄露漏洞修复** | **FIXED AND VERIFIED** | `background.ts:351` 移除 `?key=`，改用 `x-goog-api-key` 请求头。`tests/security-redaction.test.ts` 测试确证通过 | 在 Node 运行时层面确证，URL 与 Header 均符合规范 |
| **统一密钥脱敏边界 (Redaction)** | **FIXED AND VERIFIED** | 实现 `src/lib/security.ts`，错误信息、控制台日志与 UI 错误回显全局脱敏。`tests/security-redaction.test.ts` 测试确证 | 已覆盖 Anthropic/OpenAI/Gemini/DeepSeek 及通用 URL query |
| **Popup 明文 Key 内存隔离** | **FIXED AND VERIFIED** | `popup/main.ts` 废除 `apiKeysStore.getValue()`，改用 `hasApiKey` 布尔判定，明文 Key 不再进入 popup 内存空间 | 源码审查与编译确证通过 |
| **Safari 最小权限架构 (Least-Privilege)** | **FIXED AND VERIFIED** | `wxt.config.ts` Safari 配置 `host_permissions: []`，10 家云端及本地地址全入 `optional_host_permissions`；设置页按需申请与清除时撤销。构建产物 `.output/safari-mv3/manifest.json` 确证 | 安装阶段零域名敏感警告；实际原生授权弹窗交互在 STP 层面为 `SAFARI UNVERIFIED` |
| **Token DOM 引用解耦 (WeakRef)** | **FIXED AND VERIFIED** | `ScannedToken` 使用 `WeakRef<Text>` 解除长期集合对 Text DOM 节点的强引用；Mutation 处理支持移除节点主动过滤。`tests/token-lifecycle.test.ts` 确证 | 算法逻辑与对象模型解耦确证通过；真实 WebKit 堆内存 GC 回收时机需以真实 Web Inspector 快照为准 |
| **Node.js 自动化单元测试** | **VERIFIED** | 97 个测试全部通过 (`pnpm test` 耗时 876ms，新增 13 个 Core Regression 测试) | 仅验证纯算法与 Happy-DOM mock，不代表真实 WebKit 渲染 |
| **Manifest 语法与打包构建** | **VERIFIED** | `pnpm build:safari` (5.90MB) 与 `pnpm zip:safari` (2.22MB) 零报错产出 | Manifest MV3 格式校验合法 |
| **Safari 原生权限授权弹窗交互** | **FIXED BUT SAFARI UNVERIFIED** | `requestHostPermission` / `revokeHostPermission` 已在用户手势内严格调用 | 依赖真实 Safari TP 运行时弹出系统授权确认框进行最终验收 |
| **真实 WebKit 堆内存 GC 回收时机** | **FIXED BUT SAFARI UNVERIFIED** | 代码已废除强引用，由 `WeakRef` 接管；但 WebKit 的 GC 回收周期与启发式策略未测 | 需在真实 STP 中通过 Web Inspector Memory 快照采样验证 |
| **CSS Custom Highlight 渲染性能** | **PARTIALLY VERIFIED** | WebKit 官方确认自 Safari 17.2+ 支持 `CSS.highlights` | 真实长篇渲染与连续重绘性能未经 WebKit Web Inspector Profiling |
| **`caretPositionFromPoint` 支持** | **PARTIALLY VERIFIED** | WebKit 官方 Release Notes (STP 226+) 明确声明支持该 API | 边界场景（如 CSS Transform、局部 Shadow）未在真实 WebKit 实测 |
| **macOS Alt+G 快捷键输入法冲突** | **REMAINING RISK** | `commands` 配置 `Alt+G`，macOS 上 Option+G 易输出特殊字符或与输入法绑定冲突 | 建议后续提供快捷键自定义说明或 macOS 推荐键位调整 |
| **Safari Technology Preview 真实运行验收** | **BLOCKED** | 本地 macOS 27.2 未安装 `Safari Technology Preview.app` (仅安装系统 Safari 27.2) | 无法在真实 STP 253 进程中进行最终端到端手动验收 |

---

## 十、第二阶段安全、权限与生命周期重构实施详情 (Phase 2 Implementation)

本阶段严格遵照指示，实施了最小范围核心修复，并新增了对应的回归测试套件：

### 1. API Key 安全与脱敏边界建立
- **Gemini Header 鉴权规范化**:
  - `src/entrypoints/background.ts`: 彻底废除 `generativelanguage.googleapis.com` 的 `?key=${key}` URL Query 拼接，改为通过标准请求头 `x-goog-api-key: ${key}` 传输鉴权凭证。
- **全局统一脱敏组件 (`src/lib/security.ts`)**:
  - 提供 `sanitizeUrl`: 深度清除 URL 中任何形态的敏感 query 参数 (`key`, `apiKey`, `token`, `secret` 等) 以及基础认证密码。
  - 提供 `redactSecrets`: 拦截各服务商真 Key、`sk-ant-`、`sk-`、`AIza`、`Bearer` 以及查询参数密钥，统一替换为 `[REDACTED]`。
  - 提供 `safeErrorMessage`: 针对后台捕获的所有 Error / 异常文本、控制台输出和前端回显进行强制脱敏。
- **Popup 密钥内存隔离**:
  - 在 `src/lib/keys.ts` 引入 `hasApiKey(provider)` 轻量布尔判定。
  - `src/entrypoints/popup/main.ts` 彻底废除全量读取 `apiKeysStore.getValue()`，杜绝明文 Key 常驻于弹窗内存。

### 2. Safari-First 最小权限原则重构 (Least-Privilege)
- **Manifest 剥离静态 Required Host Permissions**:
  - `wxt.config.ts`: Safari 目标下设置 `host_permissions: []`，彻底清除安装阶段向用户索要 10+ 商业 AI 网站访问权的警告。
  - 将所有预置云端 API、本地地址与通配规则转移至 `optional_host_permissions`。
- **按需动态授权与撤销机制 (`src/lib/permissions.ts` & `options/main.ts`)**:
  - 保存 Key 时：在点击事件的用户手势中，仅向浏览器申请当前所选 Provider 对应的单个 Origin 权限（如 `https://api.openai.com/*`）。
  - 清除 Key 时：在清除密钥的同时，调用 `browser.permissions.remove` 自动撤销该域名的网络访问权限。
  - 拉取模型时：若用户尚未保存便点击拉取（特别是 Ollama 等无需 Key 的本地服务），先在用户手势中检查并申请该单一域名的访问权，确保请求正常放行。
  - 切换 Provider 时：不主动撤销其他已有 Key 的域名，避免用户频繁切换配置时重复弹窗。

### 3. Token / DOM 生命周期解耦 (WeakRef)
- **数据结构升级**:
  - 在 `src/lib/scan.ts` 引入 `ScannedToken` 实现类与更新 `Token` 接口，将对 `Text` 节点的直接强引用改造为 `nodeRef: WeakRef<Text>`，并通过 `get node(): Text | undefined` 进行惰性解引用。
  - 彻底解除了全局驻留的 `tokens: Token[]` 数组对脱离 DOM 树节点的垃圾回收阻断。
- **调用点安全降级与清理**:
  - `sentenceAround`: 若节点已脱离 DOM 或已被 GC 回收，安全退回至 `token.surface`。
  - `paint` 与 `rectOf`: 严格过滤未连接 (`!node.isConnected`) 或已回收的节点，防止 Range 报错。
  - `content.ts`: 变动批处理中增加了对 `removedNodes` 的代码词状态维护，并自动执行失效 Token 剪除。

### 4. 回归测试套件补充与验证
新增 3 个独立的核心回归测试文件，测试总数由 84 项提升至 97 项，全部通过：
1. `tests/security-redaction.test.ts` (Core regression):
   - 验证 Gemini 请求 URL 绝对不含 `?key=`
   - 验证 Gemini 请求头包含 `x-goog-api-key`
   - 验证各类真 Key、Bearer、敏感 URL query 的脱敏过滤
   - 验证 UI 错误信息渲染不含密钥
2. `tests/token-lifecycle.test.ts` (Core regression):
   - 验证 `ScannedToken` 的 `WeakRef` 持有机制
   - 验证节点脱离与 GC 模拟下的安全回退
   - 验证增量集合对断开连接节点的正确剔除
3. `tests/permission-architecture.test.ts` (Core regression):
   - 验证各 Provider 目标 Origin 的正确解析
   - 验证 Safari Manifest 配置输出 `host_permissions: []`

---

## 十一、Safari Technology Preview 安装指引与端到端手动验收要求

由于开发机当前仅安装了系统自带 Safari 27.2，尚未安装 Safari Technology Preview，端到端浏览器真实验收目前处于 **BLOCKED / UNVERIFIED** 状态。

若需在开发机上进行真实 STP 验收，请按照以下官方最小步骤进行安装：

### 1. 官方安装步骤
1. 打开 Apple 官方 Safari Technology Preview 下载页：
   `https://developer.apple.com/safari/technology-preview/`
2. 下载适用于当前系统 (macOS Golden Gate / Tahoe) 的官方 DMG 安装包。
3. 双击打开 `.dmg`，运行安装器将 `Safari Technology Preview.app` 安装至 `/Applications` 目录（无需 Apple 开发者账号付费）。

### 2. 真实扩展载入与验证流程
1. 启动 `Safari Technology Preview.app`。
2. 打开顶部菜单栏 **Safari Technology Preview → Settings (设置) → Advanced (高级)**，勾选底部的 **Show features for web developers (显示面向 Web 开发者的功能)**。
3. 在顶部菜单栏中点击出现的 **Developer (开发)** 菜单，勾选 **Allow unsigned extensions (允许未签名的扩展)**。
4. 在 **Developer** 菜单中选择 **Extension Developer (扩展开发者)...**，点击 **+** 号，选择本项目生成的目录：
   `/Users/ada/Downloads/glint-main/.output/safari-mv3`
5. 按照 [docs/test-plan.md](file:///Users/ada/Downloads/glint-main/docs/test-plan.md) 中的手动验收清单逐项检查：
   - 打开设置页，配置 Google Gemini / Ollama，观察浏览器是否弹出单域名授权弹窗。
   - 打开英文测试页面（如 Wikipedia），观察 `::highlight(glint-mark)` 是否高亮生效。
   - 悬浮鼠标检查词义卡片展开是否平滑。
   - 按 `Alt+G` / `Alt+Shift+G` 测试键盘导航聚焦。

