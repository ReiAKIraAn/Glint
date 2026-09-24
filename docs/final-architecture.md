# Glint Safari Personal Edition — Final Reference Architecture

本文档作为 Glint Safari Personal Edition 最终技术冻结基线的**权威系统架构参考手册**。
记录当前冻结源码中真实实现的拓扑结构、子系统契约、网络与安全边界及存储模型。

---

## 1. 核心设计原则 (Architectural Philosophy)

1. **Safari/WebKit-First**: 立足于现代 WebKit / Safari Technology Preview 原生能力（CSS Custom Highlight API、WeakRef 节点引用、Shadow DOM 样式隔离、Web Speech API 离线语音），避免将 Chrome 扩展代码直译所带来的冗余垫片。
2. **最小权限原则 (Least-Privilege)**: 清单 `manifest.json` 声明 `host_permissions: []`，零默认外部域名权限；外部云端服务商仅在用户配置时通过用户手势动态单域授权。
3. **隐私优先数据契约 (Privacy-First Contract)**: 本地持久化缓存仅允许保存 `{ word, explanation, updatedAt }` 三项字段；严禁自动或隐式持久化用户的网页原句、上下文、网页 URL、网页标题或浏览轨迹。
4. **强隔离边界 (Strict Boundary Isolation)**: 前台 Content Script 无论在内存、源码还是通信载荷中均不接触任何 API Key；外部网络请求由 Background Service Worker 统一代理并经过流式 Port 传输。
5. **防御性动态韧性 (Defensive Dynamic Web Robustness)**: 采用子树包含性剪枝 (`pruneContainedNodes`)、零生词守卫以及大批量突发回退机制，确保在复杂 SPA 与高频 DOM 变动页面下的稳定性。

---

## 2. 系统拓扑全景图 (System Component Topology)

```mermaid
flowchart TD
    subgraph WebPage["网页执行上下文 (Page / Isolated World)"]
        DOM["宿主网页 Light DOM"]
        subgraph CS["Content Script (src/entrypoints/content.ts)"]
            Scanner["增量分词扫描器 (src/lib/scan.ts)"]
            Highlight["CSS Custom Highlight 引擎 (src/lib/highlight.ts)"]
            Hover["CaretPosition 光标反查 (src/lib/hover.ts)"]
            CardUI["Web Component 卡片宿主 (<glint-card>)"]
            TTS["本地离线语音合成 (src/lib/speak.ts)"]
            AiPortClient["流式通信客户端 (src/lib/ai-port-client.ts)"]
        end
    end

    subgraph SW["后台服务 (Background Service Worker - src/entrypoints/background.ts)"]
        Router["运行时消息路由 (Message Dispatcher)"]
        AiPortServer["AI Port 会话协调器 (src/lib/ai-port.ts)"]
        PermMgr["单域权限管理器 (src/lib/permissions.ts)"]
        DictLoader["离线字典与考纲加载 (dict.json, exams.json)"]
        
        subgraph ProviderSubsystem["服务商适配器子系统 (src/lib/providers/)"]
            Registry["静态注册表 (ProviderRegistry)"]
            AnthropicAdp["Anthropic 专有适配器 (AnthropicAdapter)"]
        end
    end

    subgraph ExtUI["扩展特权界面 (Extension Pages)"]
        Popup["工具栏快捷弹窗 (src/entrypoints/popup/)"]
        Options["选项设置中心 (src/entrypoints/options/)"]
    end

    subgraph StorageSubsystem["扩展本地存储 (browser.storage.local)"]
        KeyStore[("local:apiKeys (凭据区)")]
        CacheStore[("local:explanations (LRU 2000条)")]
        SettingsStore[("local:settings (偏好设置)")]
        KnownStore[("local:knownWords (已认识词)")]
    end

    DOM -->|DOM 变动 / MutationObserver| Scanner
    Scanner -->|WeakRef 词元 Ranges| Highlight
    Highlight -.->|原生文本上色 ::highlight(glint-mark)| DOM
    DOM -->|光标坐标 (clientX, clientY)| Hover
    Hover -->|命中词元| CardUI
    CardUI -->|点击发音| TTS
    CardUI -->|请求 AI 解释| AiPortClient

    AiPortClient <-->|WebExtension Port (glint:ai-stream)| AiPortServer
    Popup <-->|browser.runtime.sendMessage| Router
    Options <-->|browser.runtime.sendMessage| Router

    AiPortServer --> Registry
    Registry --> AnthropicAdp
    AnthropicAdp -->|HTTPS SSE 请求 (附加 x-api-key)| RemoteAnthropic["Anthropic API (api.anthropic.com)"]

    Router --> DictLoader
    Options --> PermMgr
    Options --> KeyStore
    AiPortServer --> KeyStore
    AiPortServer --> CacheStore
    Scanner --> SettingsStore
    CardUI --> KnownStore
```

---

## 3. 子系统职责与隔离契约 (Subsystem Responsibilities & Contracts)

### 3.1 前台内容脚本 (Content Script)
- **源码入口**: [`src/entrypoints/content.ts`](file:///Users/ada/Downloads/glint-main/src/entrypoints/content.ts)
- **核心职责**:
  1. 页面 Light DOM 正文扫描、CEFR 分级过滤、词形还原与黑名单剔除。
  2. 运用 `CSS.highlights.set('glint-mark', ...)` 原生着色，绝不插入额外 DOM 标签。
  3. 监听鼠标移动与悬停探测（通过 `caretPositionFromPoint` 定位）。
  4. 装配 `<glint-card>` 隔离 ShadowRoot，负责纯文本卡片呈现与用户交互。
  5. 响应发音按钮点击，调用本地离线 TTS。
  6. 通过 `AiPortClient` 向上建立流式推流连接与主动取消请求。
- **安全边界**:
  - **零凭据所有权 (Zero Credential Ownership)**: 无论是打包产物还是内存变量，彻底不包含任何 API Key 或鉴权逻辑。
  - **零 innerHTML**: 卡片内所有展示文本一律使用原生 `.textContent` 写入。

### 3.2 后台服务工人 (Background Service Worker)
- **源码入口**: [`src/entrypoints/background.ts`](file:///Users/ada/Downloads/glint-main/src/entrypoints/background.ts)
- **核心职责**:
  1. 监听 `browser.runtime.onConnect` 并建立多标签页独立的流式通道 (`glint:ai-stream`)。
  2. 读取 `local:apiKeys` 中的模型密钥并执行网络调用。
  3. 协调与外部大模型服务商的 SSE 增量连接、超时熔断与错误脱敏。
  4. 承载 `local:explanations` 本地缓存的串行化写入与 2,000 条 LRU 淘汰维护。
  5. 离线字典 `data/dict.json` (3.76MB) 与 `data/exams.json` 的按需缓存与查询。

### 3.3 服务商适配器子系统 (Provider Adapter Subsystem)
- **源码入口**: [`src/lib/providers/`](file:///Users/ada/Downloads/glint-main/src/lib/providers/)
- **核心职责**:
  1. **ProviderAdapter 契约**: 定义了 `stream(req, ctx)` 与 `listModels(ctx)` 两个纯接口。
  2. **ProviderRegistry 静态注册表**: 采用纯静态查表机制，解耦通用调度层与专有服务商逻辑。
  3. **AnthropicAdapter 实现**: 专有封装 Anthropic `v1/messages` 原生 SSE 流式协议、UTF-8 跨 chunk 多字节解码、4,000 字符超限保护、60 秒超时守卫与错误脱敏 (`redactSecrets`)。
- **边界约束**: 适配器本身不拥有任何存储或权限操作权，所有凭据与选项均由 Background 在调用上下文中单向注入。

---

## 4. 持久化存储契约全量清单 (Storage Contract Inventory)

| Storage Key | 对应数据结构 / Schema | 所属模块 | 是否敏感 | 淘汰 / 保留策略 | 清理与重置行为 |
| :--- | :--- | :--- | :---: | :--- | :--- |
| `local:apiKeys` | `Partial<Record<Provider, string>>` | [`src/lib/keys.ts`](file:///Users/ada/Downloads/glint-main/src/lib/keys.ts) | **YES (凭据)** | 长期保留至用户手动清空或覆盖；仅后台访问 | 清空该字段，并提示用户可同步吊销网络权限 |
| `local:explanations` | `Record<string, { word: string, explanation: string, updatedAt: number }>` | [`src/lib/explanation-cache.ts`](file:///Users/ada/Downloads/glint-main/src/lib/explanation-cache.ts) | **NO (纯词典)** | **LRU 上限 2,000 条**；超出时按 `updatedAt` 淘汰最旧条目 | 选项页提供“清空已生成释义”按钮，一键排空 |
| `local:settings` | `Settings` (包含 CEFR 阈值、考纲静音、选定模型、域名黑名单等) | [`src/lib/settings.ts`](file:///Users/ada/Downloads/glint-main/src/lib/settings.ts) | **NO** | 长期保留；缺失字段通过 `withDefaults` 自动填充 | 恢复为出厂默认设置 (`DEFAULT_SETTINGS`) |
| `local:knownWords` | `string[]` (已标记认识的词根集合) | [`src/lib/settings.ts`](file:///Users/ada/Downloads/glint-main/src/lib/settings.ts) | **NO** | 长期保留；集合去重 | 选项页提供清空或手动移除指定单词入口 |
| `local:apiKey` *(Legacy)* | `string` | [`src/lib/keys.ts`](file:///Users/ada/Downloads/glint-main/src/lib/keys.ts) | **YES** | 仅在启动时一次性迁移至 `local:apiKeys.anthropic`，迁移后即刻删除 | `migrateLegacyKey` 自动删除 (`removeValue`) |

---

## 5. 边界与上下文隔离策略 (Boundary Isolation Policy)

1. **Light DOM Prose Only**:
   - `TreeWalker` 仅扫描标准 HTML 散文文本，严格跳过 `code`, `pre`, `kbd`, `samp`, `textarea`, `input`, `[contenteditable]` 等非自然语言区域。
2. **第三方 Shadow DOM 不透明隔离 (`INTENTIONALLY BOUNDED`)**:
   - 尊重 Web Components 原生标准边界，不穿透任何第三方 open 或 closed ShadowRoot；第三方组件内部变动不唤醒扩展的扫描。
3. **iframe 浏览边界隔离 (`INTENTIONALLY BOUNDED`)**:
   - 内容脚本首行执行 `window.top !== window.self`，直接终止子 frame 执行；主文档遍历时将 `iframe` 视为 `OPAQUE_TAGS` 直接跳过。
4. **扩展自身 UI 隔离**:
   - 词汇卡片使用 `<glint-card>` ShadowRoot 封装；`MutationObserver` 首行拦截包含 `<glint-card>` 的变动记录，彻底消除递归反馈循环。
