# ADR 002: AI Provider Adapter 架构设计 (Milestone 5 / Workstream 8)

## 状态
**已采纳并验收通过 (Accepted & Verified - M5-W8 Step 4: PASS WITH KNOWN LIMITATION)**
本 ADR 为 Milestone 5 Workstream 8 的核心架构规范与决策沉淀。在完成架构重构（Commit `4fece3e`）、Safari 实机回归（Commit `a2817a2`）与最终架构验收后，正式确立为生产架构基准。

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
1. **采用静态 Provider Adapter + Registry 架构 (Callback-based ProviderAdapter)**: 适配器负责将抽象生词请求转换为具体厂商的 HTTP/SSE 调用，并在获得纯文本增量时调用 `onChunk`。
2. **静态 ProviderRegistry**: 采用编译期静态映射表（`Map<Provider, ProviderAdapter>`），按 Provider ID 快速检索。
   ```text
   Provider
     ↓
   ProviderRegistry
     ↓
   ProviderAdapter (当前仅实现 AnthropicAdapter)
   ```
3. **单向依赖原则与严格分工**:
   - **Application Layer 负责**:
     - WebExtension Port 通信生命周期与连接管理 (`src/lib/ai-port.ts`)
     - 用户凭证安全读取与注入 (`local:apiKeys`, `src/lib/keys.ts`)
     - Safari Origin 权限前置检查与申请编排 (`src/lib/permissions.ts`，严格位于 Adapter 之外)
     - 本地释义缓存检索与写入 (`local:explanations`, `src/lib/explanation-cache.ts`)
     - IPC 协议消息帧封装 (`AI_START`, `AI_CHUNK`, `AI_DONE`, `AI_ERROR`)
     - 悬浮卡片 UI 渲染、Shadow DOM 与生命周期 (`src/lib/card.ts`, `src/lib/hover.ts`)
   - **Provider Adapter 负责**:
     - 目标服务商 HTTP 请求构建与专属 Request Header 组装 (`x-api-key` 等)
     - 响应 ReadableStream 读取、SSE 增量事件行解析与 UTF-8 多字节解码
     - 服务商专有错误/状态码向标准 `ProviderError` 层次的归一化转换
     - 服务商可用模型列表发现与解析 (`listModels`)
   - **Provider Adapter 严格不负责**:
     - ❌ `browser.permissions.request()` 权限申请编排
     - ❌ `browser.storage` 存储与缓存读写
     - ❌ 任何页面 DOM / Shadow DOM / CSS 访问
     - ❌ WebExtension Port 生命周期与跨进程 IPC 协议
     - ❌ 悬浮卡片 UI 状态机与音频朗读
     - ❌ API Key 的持久化与多服务商密钥管理
4. **当前 Provider 范围**:
   - **当前仅实现 Anthropic** (`AnthropicAdapter`)。
   - **严禁虚构或声称已支持多个 Provider**。其他服务商（OpenAI, Gemini 等）当前保持未实现状态（NOT IMPLEMENTED）。
5. **扩展路径 (Extension Path)**:
   - 未来增加第二 Provider 时，原则上应仅需要：
     - 新建对应 `ProviderAdapter` 实现；
     - 在 `ProviderRegistry` 进行静态注册；
     - 在设置页进行对应服务商的 UI 配置项、密钥存储与 Origin 权限映射。
   - 增加新 Provider 时，**严禁重新设计或侵入修改**:
     - Hover Card UI 及其状态机；
     - AI Port 通信协议；
     - 本地缓存架构与 Schema；
     - Content Script 运行时；
     - 通用生命周期调度器。
   - *(注：此架构扩展路径为设计原则，不构成任何“仅需 N 行代码”的定量代码行数承诺)*。
6. **保留现有通用安全机制**:
   - `MAX_RESPONSE_CHARS = 4_000` 与 `STREAM_TIMEOUT = 60_000` 作为标准网络安全底线，由 Adapter 严格维系。

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
- ❌ **API 凭证持久化**: 仅通过上下文参数被动接收 `ctx.apiKey`，不触碰 `local:apiKeys`。

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

### Option A: 全局词汇共享缓存 (Global Word Cache) — **已采纳 (APPROVED)**
- **定义**: 缓存条目契约严格维持 M5-W2 的冻结结构：
  ```typescript
  export interface ExplanationCacheEntry {
    word: string;
    explanation: string;
    updatedAt: number;
  }
  ```
- **机制**: 缓存 Key 仅为小写归一化后的 `normalizeWordKey(word)`。无论当前选择 Anthropic 还是未来可能扩展的 Provider，命中即直接展示已缓存的释义。
- **产品策略确定**:
  - **用户裁决**: 用户于 M5-W8 Step 2 决策正式批准 **Option A**。
  - **Schema 严格冻结**: Provider 与 Model 字段坚决不进入 Cache Schema。
  - **行为一致性**: 切换 Provider/Model 后，已有生词命中缓存继续直接展示现有释义，不发送 AI 网络请求；若用户需要重新获取，需在设置中显式清空缓存或等待 LRU 淘汰。
  - **隐私边界**: 缓存绝不保存 `sentence`、`context`、`API key`、`raw request` 或 `raw response metadata`。

### Option B: Provider/Model 绑定的隔离缓存 (Scoped Cache) — **已否决 (REJECTED)**
- 扩展缓存结构包含 Provider/Model 字段会打破 M5-W2 的最小化隐私契约，大幅增加存储占用并引入复杂的版本迁移逻辑，已被正式否决。

---

## 12. Testing Strategy & Verification Matrix (测试与验证架构)

实施 Adapter Architecture 后，建立了多层验证矩阵：

1. **Unit / Automated Tests (自动化契约测试套件)**:
   - `tests/provider-adapter.test.ts`: 新增 14 项全维度自动化测试 (ADAPTER-01 至 ADAPTER-14)。
   - 验证 AnthropicAdapter 完整实现 `ProviderAdapter` 契约。
   - 验证各种网络异常（401, 403, 429, 500, 网络断开, 60s 超时, 畸形 JSON, >4,000 字符超限）被精准转换为标准 `ProviderError`。
   - 验证 `AbortSignal` 触发时底层连接立即中断且后续无 `onChunk` 触发。
   - 验证 UTF-8 多字节拆分解码。
   - 全量 311 项自动化测试 100% PASS。
2. **Regression Verification (回归核查)**:
   - 保证既有的 REG-01 至 REG-10 全链路行为（Hover 零请求、点击流式、纯文本 Shadow DOM 渲染、主动取消、生词切换、缓存命中零网络、完整写入、清空不越权、错误脱敏、密钥隔离）100% 保持正常。
3. **Evidence Classification (证据分类标准)**:
   - **VERIFIED (已确证)**: 具有直接测试证据（单元测试或已验证的确定性机制）。
   - **AUTOMATED (自动化测试)**: 在 Node / Happy-DOM 环境下通过代码断言验证。
   - **OBSERVED (观察到)**: 在目标测试场景下未见明显异常，但不作普遍性绝对推导。
   - **UNVERIFIED (未验证)**: 缺乏直接证据，保留为已知边界或限制。

---

## 13. Safari/WebKit Considerations (WebKit 特异性考虑)

1. **Service Worker 内存管理**:
   - 回调推流模式避免了长寿命生成器对象的创建，有助于降低 WebKit Service Worker 垃圾回收压力。
2. **硬性超时兜底**:
   - Adapter 内置 `STREAM_TIMEOUT = 60_000` 超时控制器，防止 WebKit NetworkProcess 挂起时导致的无限期挂起。
3. **Content Security Policy (CSP)**:
   - 采用纯静态代码打包与静态 Registry，完全符合 Safari WebExtension 的 CSP 规范（无动态导入、无 `unsafe-eval`）。
4. **Content Script 打包隔离**:
   - 将 `AiStreamClient` 抽离为 `ai-port-client.ts` 后，构建产物 `content.js` 体积由 504.25 kB 降至 496.63 kB，静态审计确证产物中零 `local:apiKeys`、零 `x-api-key`、零 `AnthropicAdapter`。

---

## 14. Rejected Alternatives (已否决方案汇总)

| 方案 | 否决原因 |
| :--- | :--- |
| **AsyncIterable 生成器流** | 增加 WebKit SW 微任务切换开销，Push-to-Pull 缓冲复杂度高，对无背压的 Port IPC 无实际价值。 |
| **动态插件加载 (Dynamic Loading)** | 违反 Safari 扩展安全审查政策，存在严重的代码注入安全隐患。 |
| **全能 Capability 抽象系统** | 当前产品定位极其清晰（仅限生词文本语境释义），引入工具调用、视觉、音频等多模态抽象属于过度工程。 |
| **修改 Cache Schema 增加 Provider 维度 (Option B)** | 违背 M5-W2 刚刚确认的产品决策，增加存储碎片与配额溢出风险。 |
| **在 Adapter 内实现 Permission 申请** | 违背 Safari 权限模型要求（`permissions.request` 必须在用户直接手势上下文）。 |

---

## 15. Closed Decisions (已关闭事项与决策决议)

1. **缓存策略确认**:
   - **决议**: **维持 Option A (APPROVED)**。所有 Provider 共享已生成的生词释义缓存，Schema 严格维持 `{ word, explanation, updatedAt }` 不变。
2. **实施范围确认**:
   - **决议**: **仅实施 Provider Adapter 架构解耦 (APPROVED)**。重构 Anthropic 为 `AnthropicAdapter` 并接入 `ProviderRegistry`。坚决不实现第二 Provider（Second provider: NOT IMPLEMENTED）。

---

## 16. Verification Status & Architecture Acceptance (验收结论)

### 16.1 验证结论分级沉淀

#### VERIFIED (已确证)
- Provider Adapter 架构解耦边界完整；
- Anthropic SSE 正常流式接收与解析；
- UTF-8 多字节跨 chunk 截断解码无乱码；
- 用户主动 Abort 路径立即释放底层 reader；
- 错误类型归一化为统一 `ProviderError` 体系；
- API Key 严格仅通过 Request Header 传输；
- URL Query 中绝对无 API Key；
- Safari Origin 权限编排严格保持在 Adapter 外部；
- 缓存命中阻断 AI_START 与网络外发；
- Content Script 生产产物中凭据与适配器代码彻底隔离；
- REG-01 至 REG-10 既有回归行为保持稳定。

#### OBSERVED (已观察)
- 测试场景下无明显性能回退；
- 正常 Safari 流式响应与 UI 打字机渲染平滑；
- 卡片展开与生命周期切换正常。
*(注：不作“零 Long Tasks”、“100% GC 回收”、“绝对无内存泄漏”等未经直接测量的过度断言)*。

#### UNVERIFIED (已知限制与未验证项)
- **极端慢流 / 长空闲 Service Worker 生命周期**: 在网络极端停顿或超长空闲时，WebKit Service Worker 是否会被浏览器进程提前挂起仍缺乏官方确定性保证；系统采用应用层 60s 超时兜底，坚决不引入伪造心跳等 keep-alive hack。
- **Safari TP 版本状态**: 本机实测运行于 Safari Technology Preview Release 253 (WebKit 22626.1.8.19.2)；该版本是否为 Apple 当前发布的最新 STP 版本未经验证。

---

### 16.2 最终里程碑状态

```text
M5-W8 Step 1 — ARCHITECTURE READY
M5-W8 Step 2 — PASS WITH VERIFICATION LIMITATION
M5-W8 Step 3 — PASS WITH KNOWN LIMITATION
M5-W8 Overall — PASS WITH KNOWN LIMITATION
```

- **Second Provider**: `NOT IMPLEMENTED` (符合 M5-W8 范围约束，非遗漏缺陷)。
- **Final Decision**: `M5-W8 — PASS WITH KNOWN LIMITATION`。
