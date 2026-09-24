# Glint Safari Personal Edition — Final Release Baseline

本文档确立了 Glint Safari Personal Edition 的最终不可变发布基线 (Immutable Release Baseline)。
本基线标志着项目正式完成全部既定技术演进，进入**仅限维护 (Maintenance-Only)** 状态。

---

## 1. 最终发布元数据 (Final Release Metadata)

```text
Project:                 Glint Safari Personal Edition
Platform:                macOS (Darwin arm64)
Target Browser:          Safari Technology Preview (Verified on Release 253)
Architecture:            Safari/WebKit-first WebExtension (MV3)
Primary Provider:        Anthropic (Claude 3.5 Sonnet / Haiku via SSE Stream)
Manifest Version:        MV3 (host_permissions: [])

Release Version Identity: v1.0.0-safari-personal
Final Git Tag:           v1.0.0-safari-personal
Repository Branch:       safari-personal

Automated Tests:         368 / 368 PASS (0 failed, 0 skipped, 16 suites)
TypeScript Strict Check: 0 errors (pnpm exec tsc --noEmit)
Safari MV3 Build:        PASS (Total Bundle Size: 5.92 MB)
Production Source State: FROZEN (git diff -- src/ = 0)
Working Tree:            Clean
```

---

## 2. 最终架构与组件边界 (Architecture Boundary Summary)

- **前台内容脚本 (Content Script)**:
  - 核心职责：轻量 Light DOM 散文分词、CEFR 过滤、CSS Custom Highlight 原生文本上色 (`::highlight(glint-mark)`)、光标命中定位 (`caretPositionFromPoint`)、Shadow DOM 词汇卡片呈现、本地离线 TTS 发音。
  - **凭据边界**: 彻底不持有任何模型 API Key 或鉴权网络请求代码。
  - **DOM 安全**: 100% 采用原生 `.textContent` 写入，零 `innerHTML`，避免 HTML 标记解析与 XSS 风险。
- **后台服务 (Background Service Worker)**:
  - 核心职责：提供商 API 密钥安全隔离存储、单域动态授权中转、本地 5.7 万词离线字典查询、Anthropic SSE 增量推流与主动取消、`local:explanations` 本地缓存 LRU 维护。
- **服务商适配器 (Provider Adapter)**:
  - 采用解耦的 `ProviderRegistry` 与 `ProviderAdapter` 接口规范；当前唯一激活并实现的是 `AnthropicAdapter`，第二服务商（OpenAI/Gemini）按指示推迟。
- **边界策略**:
  - 第三方 open/closed Shadow DOM 和嵌套 iframe 上下文保持完全不透明隔离，不进行穿透扫描，零跨 Frame 消息交互。

---

## 3. 最终隐私与存储契约 (Privacy & Storage Contract)

### 持久化存储全量定义 (Storage Inventory)
1. `local:apiKeys`: 存储模型服务商 API 密钥。敏感数据，仅 Background 访问，绝不发送给 Content Script。
2. `local:explanations`: **本地持久化的 AI 语境释义缓存 (Locally persisted AI-generated explanation cache)**。
   - **已持久化字段 (Stored)**:
     - `word`: 目标生词小写规范化字符串
     - `explanation`: 模型生成的语境中文释义纯文本
     - `updatedAt`: 毫秒级时间戳 (用于 LRU 淘汰)
   - **绝对排除字段 (NOT Stored)**:
     - 用户阅读的网页段落原句 (`sentence`)
     - 上下文片段 (`raw context`)
     - 网页链接 (`URL`)
     - 网页标题 (`title`)
     - 用户光标选区 (`selection`)
     - 浏览历史与时间轴 (`history`)
     - 标签页标识符 (`tabId`)
     - 原始网页 DOM 节点 (`raw DOM`)
   - **容量限制**: 严格限制最大 2,000 条条目；实测序列化载荷约 506 KB，留有充足安全余量。
3. `local:settings`: 用户偏好配置（CEFR 阈值、考纲静音、选定模型、域名黑名单等），长期保留。
4. `local:knownWords`: 用户标记“认识”的词根集合，集合去重，长期保留。
5. `local:apiKey` *(Legacy)*: 早期单密钥历史键，启动时自动迁移至 `local:apiKeys` 并即刻物理删除。

---

## 4. 最终已知限制归档 (Documented Known Limitations)

以下限制经实测与形式化审计已全面记录于文档，不构成阻塞，长期冻结期间保持现状：
1. **大批量 Mutation 突发全量重扫性能退化 (`RISK-02`)**: 单批次突变超过 250 条时回退至 `run()`，在大规模 DOM 页面上存在明显的 TreeWalker 遍历耗时（251 条突变 ≈ 0.91s，500 条 ≈ 2.29s，1000 条 ≈ 7.09s）。该策略在功能层面确保了数据一致性，但极端大批量突发存在性能损耗。
2. **WebKit Service Worker 慢流生命周期边界**: WebKit Service Worker 在极端慢流或长时间空闲下存在被系统挂起的潜在风险，由应用层 60s 硬超时兜底。
3. **macOS 平台快捷键与字符输入合成冲突**: 在 macOS 上 `Alt` 键即 `Option` 键，在文本输入区域可能与系统特殊字符输入（如 `Option+G` -> `©`）产生平台级键位冲突。
4. **第三方 Shadow DOM 与 iframe 封闭隔离**: 第三方 open/closed Shadow DOM 和嵌套 iframe 内容保持完全不透明，不进行穿透扫描与跨 Frame 消息交互。
5. **形式化 Long Task 追踪与堆快照未自动化验证**: 无头自动化测试环境下缺少毫秒级 WebKit Performance Timeline 分片连续追踪以及底层 JavaScriptCore GC 真实代际回收证明。
6. **Safari Technology Preview 版本权威性未独立核验**: 实测环境为本地安装的 STP Release 253，该版本是否为 Apple 当前发布的最新版本保持为未独立核验状态。

---

## 5. 产物校验摘要 (Artifact SHA-256 Checksums)

完整哈希详见 [`docs/release-checksums.txt`](file:///Users/ada/Downloads/glint-main/docs/release-checksums.txt)。关键核心产物：
- `manifest.json`: `4b116ace4bd70f81817ce1faeadc07bd6ed3830c2b37a23e74799ac87f01cdb9`
- `background.js`: `ee7cf07b22bf56643d970c64a8a807b7e97e6b775a2e37c0be06b3f2c1a18a06`
- `content.js`: `242a8d314ebbdfc85bda612b0f802d682bdf2e54b886ab33eaf978b7c90cb8db`
- `dict.json`: `507559910650ea526e6c6c7d9767a4c778665ff2fd969d992c735d43251e156b`
- `exams.json`: `2977d2d03d9e563432be847b8699cf009749f31e2ed0b6b352f1f65a0238b713`

---

## 6. 长期冻结声明 (Final Freeze Statement)

```text
This release is frozen for long-term personal use.

No feature development is planned after this baseline.

Maintenance should be limited to:
- Critical bugs
- Major bugs affecting core workflows
- Security/privacy defects
- Breaking Safari/WebKit changes
- Breaking provider/API changes

Optional backlog items do not automatically reopen development.
```

---

## 7. 项目最终状态 (Maintenance-Only State)

```text
DEVELOPMENT:             CLOSED
FEATURE DEVELOPMENT:     CLOSED
ARCHITECTURE EXPANSION:  CLOSED
PERFORMANCE OPTIMIZATION:CLOSED

MAINTENANCE:             OPEN (Restricted to Critical / Major Defect Triage)
```
