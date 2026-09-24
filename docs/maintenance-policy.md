# Glint Safari Personal Edition — Future Bug Triage & Maintenance Policy

本文档定义了 Glint Safari Personal Edition 在长期技术冻结期间的**缺陷定级标准、维护准入准则与范围防蔓延契约**。
作为单用户个人专属工具，本项目的核心目标是“长期保持高可用与极简可靠”，坚决杜绝因无休止的“功能扩张”或“非阻断性小瑕疵”而破坏当前已验证的稳定基线。

---

## 1. 缺陷定级与处置策略 (Defect Classification Matrix)

### 🔴 Critical (严重缺陷 — 立即重开维护周期)
满足以下任一条件时，属于破坏项目根基的严重事故，必须立即重开代码维护，定位根因并发布靶向修复：
1. **API 凭据泄漏 (Credential Exposure)**: API Key 在任何情况下出现在页面 DOM、网络请求 URL、Query 参数、控制台明文日志或发送给前台 Content Script 的通信载荷中。
2. **隐私契约违背 (Privacy Violation)**: 本地持久化缓存意外保存了用户的浏览原句 (`sentence`)、上下文 (`context`)、网页标题 (`title`)、网页 URL、选区或浏览历史。
3. **扩展完全瘫痪 (Total Failure to Load)**: 浏览器升级导致扩展核心包无法加载、扩展进程在所有页面崩溃或报严重不可恢复错误。
4. **鉴权通道破坏 (Broken Auth Path)**: 扩展向服务商发起的鉴权请求失效、头字段丢失或单域动态授权机制完全中断。
5. **持久化严重损毁 (Persistent Storage Corruption)**: 读写存储导致用户现有配置或缓存大规模清空且无法通过内置回退逻辑恢复。
6. **核心流程阻断 (Core Workflow Blocked)**: Safari 引擎级更新导致划词扫描与卡片唤起在绝大多数标准网页上彻底失效。

---

### 🟡 Major (主要缺陷 — 评估后安排受控修复)
满足以下条件时，属于核心体验受损，在有明确复现证据的前提下可安排靶向修复：
1. **分词全局失效 (Scanning Completely Fails)**: 标准英文散文页面完全不识别任何生词。
2. **高亮全局失效 (Highlighting Universally Fails)**: 文本能够命中但 CSS Custom Highlight 在所有页面均无法呈现颜色。
3. **卡片交互阻断 (Card Interaction Blocked)**: 鼠标悬停生词后卡片无法弹出或无法点击关闭。
4. **TTS 全局失灵 (Universal TTS Failure)**: 宿主系统具备离线英文语音包但点击发音按钮在所有页面均无法发声。
5. **AI 推流不可用 (AI Streaming Unusable)**: 凭据与网络正常的前提下，流式推流在首个 chunk 即发生异常断连且重试无效。
6. **动态单页路由失效 (Dynamic SPA Lifecycle Breaks)**: 常见主流 SPA（如 GitHub, YouTube, Wikipedia）切换页面时词元彻底混乱或不再重新扫描。

---

### 🟢 Minor (次要问题 / 边缘限制 — 记录为已知限制，不盲目开工)
属于轻微体验瑕疵或罕见场景边界，**默认记录于文档中，不轻易触碰生产代码**：
1. **孤立页面视觉微调**: 个别高度定制化 CSS 网页上的微小卡片阴影错位或字体微调。
2. **边缘键位冲突**: 个别网页自身劫持了 `Option+G` 导致的快捷键响应迟滞。
3. **极端突发性能损耗**: 超过 250 条 DOM 突变时的回退遍历开销（由 2,500 MAX_TOKENS 兜底保护）。
4. **可选控件缺失**: 如未在卡片上提供二次重新生成（AI Redo）按钮。

---

## 2. 范围防蔓延契约 (Scope-Creep Gate & Explicit Non-Bugs)

> **铁律: Optional backlog items are not bugs. (可选积压项绝非缺陷)**

在长期冻结状态下，**严禁**因为以下任何需求而自动启动代码重构或重新开发：

| 事项 / 提案 | 为什么不得自动启动开发? |
| :--- | :--- |
| **实现 AI Redo 按钮** | 属于非关键优化，用户关闭卡片重新划词即可重新生成，不阻断核心使用。 |
| **接入第二模型服务商 (OpenAI/Gemini)** | 架构层 `ProviderAdapter` 已完全解耦就绪；在单用户个人使用场景下 Anthropic 运行良好，无紧急业务驱动。 |
| **恢复 Anki 笔记导出** | 属于违反 **D3=NO** 隐私决策的高风险需求；若要导出必须持久化网页原句，严重侵害个人浏览隐私。 |
| **引入 Markdown 复杂排版** | 会引入第三方解析器和极高的 XSS 逃逸风险，并在 WebKit 下引发严重的流式重排与卡顿。 |
| **穿透第三方 Shadow DOM** | 破坏 Web Components 原生封装规范，会带来指数级递归观察者性能开销。 |
| **穿透跨域 / 同源 iframe** | 会引入跨 Frame 脚本竞态、广告污染与多重权限滥用风险。 |
| **微小的微基准性能调优** | 当前核心扫描已达到 30ms 级别，微秒级的算法微调对实际体感无帮助，反易引入新的回归缺陷。 |

---

## 3. 维护流程准则 (Maintenance Workflow Rules)

当满足 **Critical** 或 **Major** 标准确需修复时，维护者必须遵守以下流程：
1. **最小靶向修复 (Minimal Targeted Fix)**: 仅修改引起故障的最小代码行数，绝不附带执行“代码整理”、“样式优化”或“更新周边依赖”。
2. **先写复现测试 (Reproduction Test First)**: 先编写能够稳定复现该 Bug 的失败测试用例，确认重现。
3. **保持既有安全与隐私边界不变**: 严禁为了修复功能而放松最小权限、弱化凭据隔离或扩张存储契约。
4. **执行全量回归**: 修复后必须保证 `pnpm test -- --run` 全量通过、TypeScript 严格检查 0 错误、生产打包通过且体积无异常膨胀。
5. **归档文档**: 在 `docs/changelog.md` 中如实记录缺陷原因与修复方案。
