# ADR 002: AI Provider Adapter 架构设计 (Milestone 5 / Workstream 8)

## 状态
**提议 (Proposed) / 架构审计就绪 (Architecture Ready - Step 1)**  
本 ADR 为 Milestone 5 Workstream 8 的架构设计依据。在用户确认前，**生产代码 (`src/`) 保持 0 修改**。

---

## 1. Context (背景与上下文)

在 Milestone 4 中，Glint 完成了针对 Anthropic SSE 的端到端 AI 流式释义切片（Vertical Slice），并通过了 Safari Technology Preview (Release 253, WebKit 22626.1.8.19.2) 的实机验证：
- **M4 Step 1**: Anthropic SSE 网络层 (`fetchProviderStream`)。
- **M4 Step 2**: Content Script ↔ Background Service Worker 基于 WebExtension Port 的流式通信管道 (`handleAiPortConnection`)。
- **M4 Step 3**: Hover Card 纯文本流式安全渲染与状态机。
- **M4 Step 4**: 真实 Safari TP 端到端集成验证。

随后在 Milestone 5 中：
- **M5-W1**: 系统级原生离线 TTS 完成。
- **M5-W2**: 纯净 AI 释义本地持久化 (`local:explanations`, 2,000 条 LRU 缓存，仅存储 `word`、`explanation`、`updatedAt`) 完成，并通过跨会话实机验证。

当前 Glint 的流式 AI 释义链路与 Anthropic 深度绑定。随着后续可能的扩展（如 OpenAI、Gemini、DeepSeek、Ollama 等兼容接口），现有代码暴露出模块耦合问题：流式调度层、网络层、协议解析层与具体的 Anthropic 格式紧密缠绕。

Milestone 5 / Workstream 8 (M5-W8) 的核心目标：
> **在不改变当前 Anthropic 功能行为的前提下，设计并验证一个轻量、可扩展、Safari/WebKit 友好的 Provider Adapter Architecture。**

---

## 2. Current Anthropic Architecture (现有 Anthropic 架构拓扑)

当前流式释义调用链路如下：

```text
[Hover Card (Shadow DOM)]
       │ (显式点击 AI 解释)
       ▼
[AiStreamClient (content.ts)]
       │ (port.postMessage({ type: 'AI_START', requestId, payload }))
       ▼
[WebExtension Port: "glint:ai-stream"]
       │ (IPC 跨上下文传输)
       ▼
[handleAiPortConnection (ai-port.ts)]  <-- 当前包含硬编码检查与错误映射
       │ (读取 local:settings 与 local:apiKeys)
       ▼
[fetchProviderStream (provider-network.ts)]  <-- 当前包含完整的 Anthropic 网络与 SSE 解析
       │ (HTTPS POST https://api.anthropic.com/v1/messages)
       ▼
[Anthropic API Server]
```

### 既有实现中的耦合点审查 (Coupling Audit)

| 架构切面 | 当前实现位置 | 耦合度评级 | 具体耦合表现 |
| :--- | :--- | :---: | :--- |
| **Provider 判断** | `src/lib/ai-port.ts:238-248` | **高耦合** | 硬编码 `if (settings.provider !== 'anthropic')`，并返回 `UNSUPPORTED_PROVIDER`。 |
| **API 凭证读取** | `src/lib/ai-port.ts:254` | **良好** | 从 `local:apiKeys` 按 `s.provider` 索引读取，已具备按服务商隔离的数据结构。 |
| **缺失凭证提示** | `src/lib/ai-port.ts:267` | **中耦合** | 硬编码错误文案 `未配置 Anthropic API Key`。 |
| **网络流调用** | `src/lib/ai-port.ts:275` | **中耦合** | 默认直接绑定单例函数 `fetchProviderStream`。 |
| **Endpoint 构造** | `src/lib/provider-network.ts:254` | **强耦合** | 硬编码 `https://api.anthropic.com/v1/messages`。 |
| **鉴权与请求头** | `src/lib/provider-network.ts:288-294` | **强耦合** | 硬编码 Anthropic 专属头：`x-api-key`、`anthropic-version: 2023-06-01`、`anthropic-dangerous-direct-browser-access: true`。 |
| **请求 Payload** | `src/lib/provider-network.ts:295-308` | **强耦合** | 硬编码 Anthropic 专属消息结构（顶级 `system` 字段与 `messages` 数组）。 |
| **SSE 协议解析** | `src/lib/provider-network.ts:408-444` | **强耦合** | 硬编码解析 `content_block_delta` 事件及 `delta.type === 'text_delta'`。 |
| **错误分类与映射** | `src/lib/provider-network.ts:348-372` | **良好** | 虽在网络层硬编码了 Anthropic 报错前缀，但已形成标准 `ProviderError` 子类层次。 |
| **超时与长度限制** | `src/lib/provider-network.ts:205-207` | **标准** | `STREAM_TIMEOUT = 60_000` 与 `MAX_RESPONSE_CHARS = 4_000` 为通用保护措施。 |

---

## 3. Problem (核心问题陈述)

1. **不可扩展性**: 若要在当前架构下支持第二个服务商（如 OpenAI 或 Gemini），开发者必须在 `fetchProviderStream` 内部堆叠 `if-else` 分支，或者在 `ai-port.ts` 中根据 `provider` 分发给不同的独立函数，破坏单一职责原则。
2. **测试维护负担**: 现有的 `ai-port.test.ts` 与 `ai-stream.test.ts` 中包含大量 Anthropic 专属的 mock SSE 数据块。缺乏统一 Adapter 接口，无法通过统一契约套件（Contract Test Suite）验证不同服务商的符合度。
3. **协议与配置边界不清**: Background Port 通信层 (`ai-port.ts`) 不应感知任何具体 HTTP Header、SSE 事件格式或服务商专有报错格式。

---

## 4. Goals & Non-goals (目标与非目标)

### Goals (目标)
1. **最小接口契约**: 提炼出小巧、精炼、无冗余抽象的 `ProviderAdapter` 接口。
2. **零行为变更与零回归**: 现有 Anthropic 完整功能行为 100% 保持不变，现存 297 项自动化测试继续 100% PASS。
3. **彻底隔离**: UI / Card / Content Script / Port IPC 协议 / AI Cache 绝对不依赖任何 Provider 专属字段。
4. **统一归一化错误**: 底层专有错误一律在 Adapter 内部收口为统一的 `ProviderError` 体系。
5. **静态安全注册**: 建立基于构建期静态注册表的 `ProviderRegistry`，杜绝任何动态代码执行。
6. **本阶段零生产代码修改**: M5-W8 Step 1 严格限定为架构审计与 ADR 设计，`src/` 变更数为 0。

### Non-goals (非目标)
1. **不实现第二 Provider**: 本阶段严禁编码实现 OpenAI、Gemini、Ollama 等次要服务商。
2. **不修改 Storage Schema**: 不修改 `local:settings`、`local:apiKeys` 或 `local:explanations` 的结构。
3. **不引入动态插件系统**: 禁止从网络动态拉取 Provider 配置、禁止远程脚本注入、禁止 `eval()`。
4. **不引入复杂 Capabilities 系统**: 不设计 Vision、Tools、Embeddings 等与查词释义无关的复杂特性枚举。
5. **不破坏 Safari 最小权限模型**: 不放宽 Safari manifest 中的 host 权限，坚持单 Origin 按需授权。

---

## 5. Considered Options (候选架构方案评估)

针对 Provider Adapter 抽象方案，重点评估以下三种设计：

### 方案 A: 继承式/多层 SDK 封装模式 (SDK Heavy Abstraction)
- **思路**: 引入类似 LangChain / Vercel AI SDK 的重型多层抽象，提供统一 Client、Model Provider、Tool Registry。
- **优点**: 概念完整，业界有现成范式。
- **缺点**: 
  - 包体积剧增，违背 Safari Personal Edition 极简原生原则。
  - Service Worker 环境对内存敏感，多层包装增加 GC 开销。
  - 许多 Provider 的 SDK 会破坏 Safari 的 Header 鉴权规范（例如将密钥或参数写入不兼容配置）。
- **结论**: **否决 (REJECTED)**。

### 方案 B: AsyncIterable 异步迭代器模式 (AsyncIterable Generator)
- **思路**: Adapter 接口定义为 `stream(req): AsyncIterable<string>`。
- **优点**: 语法现代，与 ES2018 异步生成器标准对齐。
- **缺点**: 
  - **WebKit Service Worker 微任务开销**: 每个 chunk 产生额外的 Generator 挂起/恢复与微任务调度。
  - **Push 转 Pull 错配**: 底层网络 `ReadableStream` 与 SSE 是典型的推模式（Push Event），将其包装为 `AsyncIterable` 需要额外维护异步事件队列，增加了内存分配和丢流风险。
  - **IPC 无背压收益**: WebExtension `port.postMessage` 是基于消息管道的无背压投递，UI 侧已经通过 `requestAnimationFrame` 实现了帧对齐批处理，底层的异步拉取背压无法传导至浏览器进程。
- **结论**: **否决 (REJECTED)**。

### 方案 C: 极简回调与生命周期受控契约模式 (Callback with Promise Completion)
- **思路**: Adapter 接口定义为 `stream(payload, context): Promise<void>`，通过 `context.onChunk(delta)` 进行增量推流，通过 `context.signal` 监听取消。
- **优点**:
  - **零额外抽象层**: 现有的 `fetchProviderStream` 已经天然具备此结构，重构成本近乎为零，风险极低。
  - **直通式性能**: `reader.read()` 解析出合法 delta 后立即同步回调 `onChunk`，直接进入 `port.postMessage`，零队列堆积、零内存开销。
  - **取消与异常确定性**: `Promise` 的 resolve/reject 精准对应流的完成与异常，与 `try/catch/finally` 及 `AbortController` 无缝配合。
- **结论**: **采纳 (ACCEPTED)**。

---

## 6. Decision (核心架构决策)

### 6.1 核心决策点
1. **采用方案 C (Callback-based ProviderAdapter)**: 适配器负责将抽象生词请求转换为具体厂商的 HTTP/SSE 调用，并在获得纯文本增量时调用 `onChunk`。
2. **静态 ProviderRegistry**: 采用编译期静态映射表（`Map<Provider, ProviderAdapter>`），按 Provider ID 快速检索。
3. **单向依赖原则**:
   - `ai-port.ts` 仅依赖 `ProviderAdapter` 接口与 `ProviderRegistry`。
   - `ProviderAdapter` 不得反向依赖 `ai-port.ts`、`Card`、`DOM` 或 `Storage`。
4. **保留现有通用保护机制**:
   - `MAX_RESPONSE_CHARS = 4_000` 与 `STREAM_TIMEOUT = 60_000` 作为标准网络安全底线，由具体 Adapter 或抽象基类严格维系。

---

## 7. Interface Boundary (接口边界定义)

设计的最小化 Adapter 接口契约如下：

```typescript
import type { Provider, ModelList } from './types';

/**
 * 跨服务商通用的释义请求载荷（纯语言语境，零专有字段）
 */
export interface ProviderStreamPayload {
  readonly word: string;
  readonly lemma?: string;
  readonly sentence: string;
}

/**
 * 流式执行上下文（包含鉴权、控制信号与回调）
 */
export interface ProviderStreamContext {
  readonly model: string;
  readonly apiKey: string;
  readonly baseURL?: string;
  readonly signal: AbortSignal;
  readonly onChunk: (delta: string) => void;
  readonly options?: {
    readonly timeoutMs?: number;
    readonly fetchFn?: typeof fetch;
  };
}

/**
 * Provider 适配器统一契约
 */
export interface ProviderAdapter {
  /** 唯一厂商标识符 */
  readonly id: Provider;

  /**
   * 发起流式文本释义生成
   * 成功完成时 resolve，发生错误时 reject 标准化的 ProviderError，取消时 reject ProviderAbortError
   */
  stream(payload: ProviderStreamPayload, ctx: ProviderStreamContext): Promise<void>;

  /**
   * 可选：查询该厂商当前凭据可用的模型列表
   */
  listModels?(
    apiKey: string,
    baseURL?: string,
    options?: { signal?: AbortSignal; fetchFn?: typeof fetch }
  ): Promise<ModelList>;
}
```

### 严格禁止进入 Adapter 的职责
- ❌ **DOM / Shadow DOM / CSS**: 严禁引用页面元素或渲染逻辑。
- ❌ **Card UI / TTS**: 严禁感知卡片状态或语音播放。
- ❌ **WebExtension Port 管理**: 严禁直接调用 `port.postMessage`。
- ❌ **Safari 权限申请**: 严禁调用 `browser.permissions.request()`（非用户直接手势环境）。
- ❌ **Storage / Cache**: 严禁读写 `local:settings` 或 `local:explanations`。
- ❌ **分词与上下文截取**: 仅消费已经精准切好的 `sentence`。

---

## 8. Error Boundary (错误归一化边界)

所有进入 Adapter 的专有异常必须在出界前完成归一化：

```text
[Provider-Specific Error]
(如 Anthropic 400 invalid_request, 401 authentication_error, 429 rate_limit)
          │
          ▼
[Adapter Error Normalizer]
          │ (包装为标准 ProviderError 子类)
          ▼
[Normalized ProviderError Hierarchy]
  ├─ ProviderHttpError (status: 401 / 403 / 429 / 500 等)
  ├─ ProviderNetworkError (DNS / 离线 / 连接断开)
  ├─ ProviderTimeoutError (60s 超时)
  ├─ ProviderAbortError (用户主动取消)
  ├─ ProviderProtocolError (畸形 SSE / 空文本)
  └─ ProviderResponseTooLargeError (> 4,000 字符硬截断)
          │
          ▼
[mapProviderError (ai-port.ts)]  <-- 统一脱敏 (safeErrorMessage)
          │
          ▼
[AI_ERROR IPC Message]  <-- 稳定的 safe code 与 safe message
          │
          ▼
[Hover Card UI]  <-- 安全纯文本渲染，零凭据回显
```

**安全守则**: 无论厂商报错中是否回显原始 API Key 或请求 Header，必须在 `mapProviderError` 与 Adapter 内部经过 `redactSecrets` 过滤，坚决杜绝明文凭据流入错误消息。

---

## 9. Permission Boundary (Safari 权限边界)

遵循 `docs/adr/001-safari-permissions-network.md` 的既定决策：
1. **网络层与权限编排分离**:
   - `ProviderAdapter` **不负责申请权限**。
   - Safari 要求 `browser.permissions.request()` 必须由 Options 页面的直接用户点击手势发起。
2. **按需检查机制**:
   - Background 在调用 `adapter.stream()` 之前，根据 `originForProvider(settings, provider)` 检查 `hasHostPermission(origin)`。
   - 若未获得权限，直接阻断并下发 `UNAUTHORIZED_ORIGIN` 错误，避免底层网络抛出模糊的 `TypeError`。
3. **保持 Least-Privilege**:
   - 未选中的 Provider 域名坚决不预先申请权限。

---

## 10. Credential Boundary (凭据安全边界)

1. **凭证隔离存储**:
   - API Key 保持由 `src/lib/keys.ts` 独占管理（存储在 `local:apiKeys`）。
   - 内容脚本完全不包含任何访问 `local:apiKeys` 的模块代码。
2. **上下文按需注入**:
   - Background 调度器根据当前的 `settings.provider`，从 `apiKeysStore` 取出对应的凭证，作为 `ProviderStreamContext.apiKey` 传入 Adapter。
   - 彻底避免将 Provider A 的凭证错传给 Provider B。
3. **传输安全**:
   - 所有 Adapter 严格只能通过 HTTP Request Header 进行鉴权（如 `x-api-key`、`Authorization: Bearer`、`x-goog-api-key`）。
   - **绝对禁止将 API Key 拼接至 URL Query 参数中**（防范针对 Gemini 等接口的历史漏洞复发）。

---

## 11. Cache Interaction (AI 缓存兼容性分析)

在引入 Multi-Provider 架构时，针对 `local:explanations` 缓存有两种策略：

### Option A: 全局词汇共享缓存 (Global Word Cache)
- **定义**: 缓存条目契约保持 M5-W2 的冻结结构：
  ```typescript
  export interface ExplanationCacheEntry {
    word: string;
    explanation: string;
    updatedAt: number;
  }
  ```
- **机制**: 缓存 Key 仅为小写归一化后的 `normalizeWordKey(word)`。无论当前选择 Anthropic、OpenAI 还是 Gemini，命中即直接展示已缓存的释义。
- **优缺点分析**:
  - *隐私与存储*: 存储开销最小（实测 2,000 条约 506 KB），完全不引入冗余条目。
  - *契约兼容*: 100% 兼容 M5-W2 已上线并通过 Safari TP 实机验证的缓存系统，无需进行任何存储迁移与数据升级。
  - *用户体验*: 符合词汇学习的核心认知——“解释的是单词在特定语境中的词义”，用户不关心具体是由 Claude 还是 GPT 输出的；省 Token、零延迟。
  - *局限性*: 当用户切换 Provider 时，已缓存的词不会自动用新 Provider 重新生成（除非执行清空缓存或缓存自然 LRU 淘汰）。

### Option B: Provider/Model 绑定的隔离缓存 (Scoped Cache)
- **定义**: 扩展缓存结构为包含厂商与模型元数据：
  ```typescript
  export interface ExplanationCacheEntry {
    word: string;
    provider: Provider;
    model: string;
    explanation: string;
    updatedAt: number;
  }
  ```
- **优缺点分析**:
  - *独立性*: 不同 Provider 的生成结果独立保存，切换 Provider 后展示各自的解释。
  - *破坏性*: 严重破坏 M5-W2 刚刚冻结的“仅存储 word, explanation, updatedAt”的产品决策；缓存容量扩大 N 倍，逼近 Safari 存储配额；需要复杂的历史数据迁移逻辑；LRU 淘汰复杂度翻倍。

### 架构推荐与决策分流
- **架构组推荐**: **采用 Option A (全局共享缓存)**。
- **状态声明**: 鉴于产品与数据策略的严肃性，本项作为 **USER DECISION REQUIRED** 明确呈报给用户，在用户明确批准前，**M5-W8 严格不修改现有 M5-W2 缓存 Schema**。

---

## 12. Testing Strategy (测试与验证架构)

实施 Adapter Architecture 后，测试矩阵规划如下：

1. **Unit Tests (单元测试)**:
   - `tests/anthropic-adapter.test.ts`: 验证 AnthropicAdapter 完整实现 `ProviderAdapter` 契约。
   - 验证各种网络异常（401, 403, 429, 500, 网络断开, 超时, 畸形 JSON, >4000 字符超限）被精准转换为标准 `ProviderError`。
   - 验证 `AbortSignal` 触发时底层连接立即中断且后续无 `onChunk` 触发。
2. **Contract / Fake Provider Tests (契约测试)**:
   - 编写 `FakeProviderAdapter`，注入 `handleAiPortConnection`。
   - 验证 `handleAiPortConnection` 在不同 Provider 下的消息分发、Same-Port Replacement、取消与错误下发完全一致。
3. **Regression Tests (回归测试)**:
   - 保证既有的 **297 项自动化测试全部保持 PASS**，无任何破坏性修改。

---

## 13. Safari/WebKit Considerations (WebKit 特异性考虑)

1. **Service Worker 内存管理**:
   - 回调推流模式避免了长寿命生成器对象的创建，有助于降低 WebKit Service Worker 垃圾回收压力。
2. **硬性超时兜底**:
   - Adapter 内置 `STREAM_TIMEOUT = 60_000` 超时控制器，防止 WebKit NetworkProcess 挂起时导致的无限期挂起。
3. **Content Security Policy (CSP)**:
   - 采用纯静态代码打包与静态 Registry，完全符合 Safari WebExtension 的 CSP 规范（无动态导入、无 `unsafe-eval`）。

---

## 14. Rejected Alternatives (已否决方案汇总)

| 方案 | 否决原因 |
| :--- | :--- |
| **AsyncIterable 生成器流** | 增加 WebKit SW 微任务切换开销，Push-to-Pull 缓冲复杂度高，对无背压的 Port IPC 无实际价值。 |
| **动态插件加载 (Dynamic Loading)** | 违反 Safari 扩展安全审查政策，存在严重的代码注入安全隐患。 |
| **全能 Capability 抽象系统** | 当前产品定位极其清晰（仅限生词文本语境释义），引入工具调用、视觉、音频等多模态抽象属于过度工程。 |
| **修改 Cache Schema 增加 Provider 维度** | 违背 M5-W2 刚刚确认的产品决策，增加存储碎片与配额溢出风险。 |

---

## 15. Open Questions (待确认事项)

1. **缓存策略确认**:
   - 是否维持 Option A（所有 Provider 共享已生成的生词释义缓存），还是未来有明确需求切换为 Option B？（建议维持 Option A）。
2. **Step 2 实施范围确认**:
   - Step 2 是否仅将现有的 Anthropic 重构成 `AnthropicAdapter` 并接入 `ProviderRegistry`，而暂不引入任何外部新 Provider？（建议严格遵循本原则）。

---

## 16. 结论与下一步

本架构设计在实现服务商解耦的同时，保持了最小的抽象开销、极高的安全性以及对 Safari WebKit 的良好亲和度。

- **当前状态**: `ARCHITECTURE READY`
- **下一步行动**: 等待用户确认 ADR 及相关决策后，进入 **M5-W8 Step 2: Provider Adapter Implementation**。
