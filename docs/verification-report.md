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
| **Manifest 剥离 Chrome 字段** | **VERIFIED** | `.output/safari-mv3/manifest.json` 中已无 `minimum_chrome_version` | 剥离无误，Manifest 语法校验合法 |
| **Node.js 自动化单元测试** | **VERIFIED** | `pnpm test` 84 个测试全部通过 (耗时 660ms) | 仅验证纯算法与 Happy-DOM mock，不代表浏览器渲染 |
| **Gemini Key 在 URL 泄露漏洞** | **VERIFIED** | `background.ts:351` 拼接 `?key=...`，`background.ts:376` 异常时将 URL 传给前端 | **已确证存在安全漏洞**，需改为 Header 鉴权 |
| **Content Script 与 Key 隔离**| **VERIFIED** | Content script 依赖图未包含 `keys.ts`，无跨上下文密钥泄露 | 密钥安全边界在 Content Script 端有效 |
| **Safari host_permissions 适配** | **UNVERIFIED** | 12 家域名全量硬编码在 required host_permissions | Safari 强管控机制下大概率触发权限弹窗或静默断网 |
| **`browser.permissions.request`** | **UNVERIFIED** | 源码在 `options/main.ts:649` 挂在点击事件直接调用 | 未在 Safari TP 临时扩展下实测过授权弹窗交互 |
| **`caretPositionFromPoint` 支持** | **PARTIALLY VERIFIED** | WebKit 官方 Release Notes (STP 226+) 明确声明支持该 API | 边界场景（如 CSS Transform、局部 Shadow）未在真实 WebKit 实测 |
| **CSS Custom Highlight 渲染** | **PARTIALLY VERIFIED** | WebKit 官方确认自 Safari 17.2+ 支持 `CSS.highlights` | 真实长篇渲染与连续重绘性能未经 WebKit Web Inspector Profiling |
| **WeakMap 内存安全** | **CLAIM WITHDRAWN** | `content.ts` 内 `tokens: Token[]` 依然强引用 `Text` 节点 | 无法证明达到 100% 内存无泄漏，存在引用滞留 |
| **Safari 零长任务 (0 Long Tasks)** | **CLAIM WITHDRAWN** | 数据来自 Node.js 运行 Happy-DOM，Happy-DOM 不做真实页面排版渲染 | 真实 Safari TP 渲染性能完全未经实测 |
| **Safari TP 253 实测运行** | **CLAIM WITHDRAWN** | 本地机器未安装 Safari Technology Preview | 无法在真实 STP 253 进程中完成功能验收 |

---

## 十、遗留风险与重构建议清单 (Remaining Risks & Actionable Advice)

以下问题均已查实，属于下一步重构必须解决的实质性技术隐患（**当前阶段严格不修改代码，仅记录供决策**）：

### 1. 致命缺陷 (Critical)
* **漏洞描述**: `background.ts` 第 351 行在向 Google Gemini 请求可用模型时，将 API Key 拼接至 URL Query (`?key=...`)，且在请求失败时将该 URL 原样输出并展示在设置页文本中。
* **修复建议**:
  - Google Gemini API 支持通过 HTTP 请求头 `x-goog-api-key: ${key}` 传递鉴权凭证，彻底废除 URL Query 传参。
  - 改造错误处理机制，全局过滤任何可能包含密钥的 URL 或请求头字符串，防止报错信息反吐前端。

### 2. 权限架构失衡 (Major)
* **问题描述**: 在 Manifest 中预置了 10 家外部商业 AI API 域名的 `host_permissions`，直接触发 Safari 的多站点敏感权限警告。
* **修复建议**:
  - 废除 Manifest 中 10 家 API 域名的静态 `host_permissions`。
  - 仅保留 `http://localhost/*` 与 `http://127.0.0.1/*`（Ollama 免配置）。
  - 所有外部云端 API 统一走 `optional_host_permissions`。当用户在设置页点击“保存 Key”时，按需申请当前 Provider 的单个 Origin 授权。

### 3. 内存滞留隐患 (Moderate)
* **问题描述**: `content.ts` 内部维持的 `tokens: Token[]` 数组持有 DOM `Text` 节点的直接强引用。
* **修复建议**:
  - 简化 `Token` 结构，或在 `content.ts` 维护一个按需清理机制，在页面空闲时主动扫描并剔除 `node.isConnected === false` 的无效项，或者让 `Token` 仅保存节点标识而非长期持有直接引用。

### 4. macOS 快捷键冲突 (Minor)
* **问题描述**: `commands` 配置的 `Alt+G` / `Alt+Shift+G` 与 macOS 系统输入法字符产生冲突。
* **修复建议**:
  - 考虑为 macOS 用户调整推荐键位（例如 `Alt+Command+G`，或使用 `Ctrl+Shift+G`），并在弹窗或设置页增加按键说明。

---

## 十一、进入下一阶段前必须由用户裁定的事项 (Required Decisions)

1. **开发与测试基线环境确认**:
   - 本机当前未安装 **Safari Technology Preview**。
   - 是否需要在开发机上下载安装 Safari Technology Preview (当前最新为 Release 253)，还是允许阶段性使用系统自带 Safari 27.2 (WebKit 22625.2.5.11.1) 进行初步验证？
2. **API 权限策略选择**:
   - 方案 A（当前方案）：Manifest 预置 12 个域名，用户在 Safari 扩展管理中手动开启全站访问。
   - 方案 B（Safari-First 推荐方案）：Manifest 仅声明最小权限，用户在设置页填哪家 Key，就仅申请哪 1 家的域名权限，完全消除多余授权警告。
