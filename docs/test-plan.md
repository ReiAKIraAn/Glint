# 测试策略与验证计划 (Test Plan & Verification Checklist)

## 一、测试核心原则：区分自动化环境与 Safari TP 运行环境

1. **环境分工明确**:
   - Node / Vite 自动化测试环境用于高频验证核心算法、分词、词形还原、断句、序列化与状态机。
   - **Safari Technology Preview 是最终运行与验收环境**。自动化通过绝不等于 Safari 已验证。
2. **严禁虚构 Safari 验证结果**:
   - 任何涉及 Safari 原生行为（CSS Custom Highlight 渲染视觉、`-webkit-backdrop-filter` 硬件加速、`document.caretPositionFromPoint` 真实交互、Web Speech 离线发音）必须在真实 STP 环境中根据 Checklist 进行实测。

---

## 二、自动化单元与集成测试套件

| 测试套件 | 测试文件 | 覆盖的核心场景与边界条件 |
| :--- | :--- | :--- |
| **词形还原算法** | `tests/lemma.test.ts`, `lemma-cases.ts` | 双写还原 (`running` → `run`)、不发音 e (`hoping` → `hope`, `singing` → `sing`)、复数/三单、时态、比较级、副词 (`happily` → `happy`) |
| **断句与缩写消歧**| `tests/sentence.test.ts` | 20+ 缩写词 (`e.g.`, `i.e.`, `etc.`) 识别、小数点与 URL 保护、带括号收尾 (`etc.)`)、长句智能窗口截取 |
| **DOM 分词扫描** | `tests/scan.test.ts` | 标识符前后缀 (`@user`, `file.ext`)、句首/句中专有名词大写区分、代码块领域黑话排查、考纲交集过滤 |
| **卡片定位与比对**| `tests/card-side.test.ts` | 视口边界空间选边计算、鼠标踩在卡片时的锁边防抖、新旧句子归一化比对 (`sameSentence`) |
| **Anki TSV 导出** | `tests/anki.test.ts` | 字段换行转义、双引号安全过滤、单引号内联样式、分层标签生成 |
| **数据备份与恢复**| `tests/backup.test.ts` | Schema 版本校验、非法数据字段容错、双机时间戳冲突智能合并、API Key 排除检验 |
| **站点与设置存储**| `tests/site.test.ts`, `settings.test.ts` | 子域名继承匹配 (`en.wikipedia.org` ↔ `wikipedia.org`)、默认配置补充与老字段平滑升级 |
| **增量扫描批处理**| `tests/incremental-scan.test.ts` | 局部 DOM 节点添加/删除/文本变更时，校验是否仅扫描变动子树，增量计算是否准确 |
| **高亮渲染与样式注入**| `tests/highlight.test.ts` | `CSS.highlights` 范围注册、`document.adoptedStyleSheets` 动态挂载、WebKit 隔离环境异常降级回退 `<style>` |
| **悬浮定位与卡片生命周期**| `tests/hover-card.test.ts` (新增) | WebKit Element 边界解析、Token 词头/词中/词尾 hit-test、脱离 DOM 节点过滤、单例 DOM 复用、XSS 注入纯文本安全校验 |

---

## 三、Mutation 压力测试与稳定性测试

在自动化或沙盒脚本中执行以下高强度测试：
1. **React / Vue 动态更新压力测试**:
   - 快速向 DOM 插入与替换 500 个复杂元素，验证 MutationObserver 增量扫描不产生掉帧，无递归循环触发。
2. **打字机流式输出测试**:
   - 模拟 LLM 50ms 一次的文本追加，持续 20 秒，验证主线程批处理耗时稳定在 `< 5ms`。
3. **内存泄露回收验证**:
   - 动态创建并高亮 1000 个段落，随后彻底从 DOM 树中移除；手动触发垃圾回收后检查 WeakMap 索引自动清空，Detached DOM 节点数归零。

---

## 四、Safari Technology Preview 手工验证 Checklist

在最新 Safari Technology Preview 中逐步执行以下专项检查，必须全量通过：

### 1. 临时扩展载入与初始化
- [ ] 在 STP 中打开“开发 > 允许未签名的扩展”。
- [ ] 载入构建目录，扩展成功列入扩展列表，控制台零报错。
- [ ] 工具栏出现 Glint 图标，高分屏 (Retina) 下图标清晰无模糊。

### 2. 网页高亮渲染与视觉效果
- [ ] 打开 Wikipedia 英文长文（如 `https://en.wikipedia.org/wiki/Sediment`）。
- [ ] 页面生词被准确认出，下划线/底色通过 `CSS.highlights` 正常渲染。
- [ ] 切换至暗黑模式，高亮颜色自动适应当前文本深浅。
- [ ] 切换高亮样式（点状、实线、底色），页面实时平滑变更。

### 3. 悬浮词义卡片与交互 (Milestone 2 验收已完成)
- [x] 鼠标悬停在标注词上 220ms，卡片顺畅浮现，呈现原生 macOS 毛玻璃质感 (STP 253 实机通过)。
- [x] 快速掠过词汇不会产生闪烁或卡顿 (STP 253 实机通过)。
- [x] 原型还原提示准确（如扫描到变形词提示原形 lemma）(STP 253 实机通过)。
- [ ] 点击喇叭按钮，正常调用本地系统语音清晰朗读，无网络外发 (后续里程碑)。
- [ ] 点击“✓ 认识”，该词高亮即时消失，且刷新后不再标注 (后续里程碑)。

#### Milestone 2 实测验证矩阵 (Safari Technology Preview Release 253 / WebKit 22626.1.8.19.2)
*实机测试地址：`https://en.wikipedia.org/wiki/Sediment`*

| 序号 | 验证项 | 预期行为 | 实测结果 | 判定 |
| :--- | :--- | :--- | :--- | :--- |
| 1 | 英文页面加载 | 正常载入 Wikipedia Sediment 页面，无卡顿 | 页面秒级加载完毕，DOM 树完整稳定 | **PASS** |
| 2 | 高亮标注显示 | 页面高亮渲染，`glint-mark` 高亮集正常填充 | 控制台显示标注 470 词，`CSS.highlights.size === 470` | **PASS** |
| 3 | 词头/词中/词尾 hit-test | 鼠标分别在词头、词中、词尾移动，命中同一 Token | 验证 `particles` 词头(132, 287)、词中(158, 287)、词尾(186, 287)均解析为同一 Text 节点及 `[35, 44]` 范围 | **PASS** |
| 4 | 卡片内容动态更新 | 鼠标移动到另一高亮词，复用现有卡片单例更新内容 | 移动至 `eventually`，卡片单例内容即时更新为 A2 / `/iˈventʃuəli/`，未创建第二张卡片 (`count === 1`) | **PASS** |
| 5 | 鼠标移入卡片驻留 | 鼠标移入卡片区域，卡片不会意外消失 | 鼠标进入 `glint-card` 边界 `[116, 516] x [304, 444]`，清除关闭定时器，卡片持续保持 open 状态 | **PASS** |
| 6 | 鼠标离开卡片隐藏 | 鼠标离开卡片区域，卡片在延迟后平滑收起 | 离开卡片触发 `pointerleave`，40ms 延迟防抖后卡片淡出，`is-open` 移除并置 `display: none` | **PASS** |
| 7 | 空白区域防误触 | 鼠标移至无高亮词的空白区域或普通文本，不弹出卡片 | 移动至空白区域坐标 `(50, 50)` 与普通非高亮文本 `(200, 200)`，卡片维持隐藏 | **PASS** |
| 8 | 页面滚动防错位与残影 | 页面发生滚动时，卡片即时收起，滚动后再悬停坐标精准 | 页面触发滚动事件后卡片即时收回，无脱节漂浮与残影；滚动后再次悬停重新基于当前视口 rect 精准定位 | **PASS** |
| 9 | 快速划过多词压力 | 鼠标快速连续掠过多词，不闪烁、不卡死、无多卡片堆叠 | 20ms 间隔快速掠过多词，无异常抛错，卡片单例严格保持为 1，平滑过渡至最终停留词 | **PASS** |
| 10 | 恶意文本与 XSS 注入免疫 | 词汇含有 `<script>`、`<img>` 或超长文本时不产生 DOM 注入与崩溃 | 词面、原形与释义一律经由 `.textContent` 写入 Shadow DOM，脚本不执行，HTML 标签被实体转义 (`&lt;script&gt;`) | **PASS** |


### 4. 键盘无障碍操作
- [ ] 按 `Alt+G`，页面自动平滑滚动至下一个生词并居中弹出卡片。
- [ ] 按 `Alt+Shift+G`，平滑回退至上一个生词。
- [ ] 按 `Esc`，当前弹出的卡片立即收起。

### 5. AI 语境释义端到端实测
- [ ] 在选项页配置好有效的 API Key（如 Anthropic / Gemini / DeepSeek）。
- [ ] 在文章中点击“AI 释义”，按钮切换为打字提示状态，等待几秒后成功返回：
  - 中文当前句义项
  - 英文释义
  - 原句高亮翻译
  - 新例句与助记
- [ ] 重新将鼠标悬停在同一个词上，卡片直接秒显历史释义，不消耗二次网络额度。

### 6. 数据备份与 Anki 导出
- [ ] 点击导出 Anki，生成 `.txt` TSV 文件。
- [ ] 打开 Anki 客户端执行“导入文件”，确认卡片自动建入 `Glint` 牌组，正反面格式完好。
- [ ] 导出 JSON 备份，确认文件不含 API Key。

### 7. 生命周期稳定性
- [ ] 连续开启 10 个英文标签页，各页面高亮与卡片均正常工作。
- [ ] 网页前进/后退/SPA 路由切换，扩展稳定响应。
- [ ] Safari 休眠并唤醒，扩展功能保持正常。
