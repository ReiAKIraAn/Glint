# Glint Safari Personal Edition — Future Safari Upgrade Procedure

本文档定义了当未来 macOS 或 Safari / Safari Technology Preview (STP) 发生跨大版本升级，或者项目在长期搁置后重新打开时的**标准化验证与升级排查作业指南**。

---

## 核心原则 (Core Upgrading Principle)

> **严禁仅因为“存在更高版本的 Safari/STP”而盲目修改生产代码或升级依赖包。**
> 只有当升级后的 Safari 环境中出现了**经实测复现的不兼容性、崩溃、安全缺陷或核心工作流阻塞**时，才允许启动针对性的维护周期。

---

## 标准升级检验作业流 (13-Step Verification Protocol)

### 步骤 1: 确认当前安装的 Safari / STP 版本
在终端执行以下命令，记录宿主系统与浏览器的精确版本元数据：
```bash
# 查看 macOS 系统版本与架构
sw_vers
uname -m

# 查看 Safari Technology Preview 的版本与 WebKit Build
mdls -name kMDItemVersion /Applications/Safari\ Technology\ Preview.app
/Applications/Safari\ Technology\ Preview.app/Contents/MacOS/Safari\ Technology\ Preview --version 2>/dev/null || true
defaults read /Applications/Safari\ Technology\ Preview.app/Contents/Info.plist CFBundleVersion
defaults read /Applications/Safari\ Technology\ Preview.app/Contents/Info.plist WebKitSourceVersion 2>/dev/null || true
```

### 步骤 2: 查阅 WebKit 官方发行说明 (Release Notes)
访问 [WebKit Feature Status & Blog](https://webkit.org/blog/) 与 [Safari Technology Preview Release Notes](https://developer.apple.com/safari/technology-preview/release-notes/)，重点检索自当前基线 (Release 253) 以来的以下关键词：
- `WebExtension`
- `CSS Custom Highlight API` 或 `::highlight`
- `caretPositionFromPoint`
- `Web Speech` / `speechSynthesis`
- `Service Worker`
- `Permissions`

### 步骤 3: 审查 WebExtension API 变动
- 核查 `browser.runtime.connect` / `Port` 消息通信机制是否有破坏性改动；
- 核查 `browser.permissions.request` 用户手势（User Gesture）传递规范是否收紧；
- 核查 MV3 Service Worker 的空闲终止（Idle Timeout）策略是否变化。

### 步骤 4: 校验 CSS Custom Highlight API 渲染
- 在新版 Safari 中打开包含文本高亮的页面，审查 `CSS.highlights.set('glint-mark', ...)` 是否仍能正常着色；
- 检查是否存在高亮失真、重叠闪烁或样式丢失现象。

### 步骤 5: 校验光标定位与命中反查 (Caret Hit-Testing)
- 移动鼠标悬停于英文生词正上方与边缘空白处；
- 验证 `document.caretPositionFromPoint` 是否能稳定解析出正确的 Text 节点与字符偏移量。

### 步骤 6: 校验原生 Web Speech 离线发音
- 打开词义卡片，点击音标旁的发音小喇叭；
- 确认系统预装的英文离线语音包能够正常播放；
- 确认发音过程不会发起任何外网流量（网络面板抓包请求为 0）。

### 步骤 7: 校验 Service Worker 慢推流生命周期
- 发起一次真实的 AI 解释请求；
- 观察打字机推流耗时超过 15 秒时的连续性，确认 Service Worker 不会被浏览器提前休眠中断。

### 步骤 8: 执行全量自动化测试套件
在项目根目录下执行当前测试套件，确认基线完全通过：
```bash
pnpm test -- --run
```
- **通过标准**: **368 / 368 PASS** (0 failed, 0 skipped)。任何测试失败均需先行定位原因。

### 步骤 9: 执行构建与类型检查
确认编译流水线纯净确定：
```bash
pnpm exec tsc --noEmit
pnpm exec wxt build -b safari --mv3
git diff --check
```
- **通过标准**: TypeScript 0 错误；Safari MV3 构建成功，总包体积约为 5.92 MB。

### 步骤 10: 执行 Safari 实机 Smoke 回归 (RC-01 至 RC-13)
重新加载扩展至 Safari Technology Preview，逐项验证 13 条关键路径：
1. `RC-01`: 核心长文分词与等级过滤
2. `RC-02`: CSS Custom Highlight 文本上色
3. `RC-03`: 悬停 220ms 弹出 Shadow DOM 词汇卡片
4. `RC-04`: 原生离线发音播放
5. `RC-05`: Anthropic SSE 流式打字机推流
6. `RC-06`: 流式推流期间主动点击“取消”中断
7. `RC-07`: 同一单词再次悬停命中 `local:explanations` 本地秒显
8. `RC-08`: SPA 单页虚拟路由跳转后扫描状态安全重置
9. `RC-09`: 动态插入 DOM 段落增量识别
10. `RC-10`: 设置页单域权限申请与保存
11. `RC-11`: 工具栏点击展开 Popup 界面并呈现词数统计
12. `RC-12`: 第三方 Shadow DOM 不透明隔离
13. `RC-13`: iframe 上下文不透明隔离与零跨 Frame 消息

### 步骤 11: 执行动态网页极端突变回归
运行动态网页极端测试用例，核实包含性裁剪与防抖稳定性：
```bash
pnpm test -- tests/dynamic-web.test.ts tests/mutation-stress.test.ts
```

### 步骤 12: 对比性能基准
确保未发生明显的性能退化：
- 静态长文初次扫描基准约为 30ms ~ 60ms；
- 单个元素增量更新耗时 < 1ms；
- 突变风暴阈值仍维持在 `records.length > 250`。

### 步骤 13: 裁决是否需要生产代码调整 (Decision Gate)
- **分支 A (无兼容性问题)**:
  - 13 项路径全部正常，自动化测试全绿 -> **冻结维持，不修改任何生产源码，不提交任何冗余 Commit**。
- **分支 B (发现真正的引擎破坏性变更)**:
  - 严格对照 [`docs/maintenance-policy.md`](file:///Users/ada/Downloads/glint-main/docs/maintenance-policy.md) 评估严重级别（Critical / Major）；
  - 仅针对 WebKit 行为变化编写最小靶向补丁与回归用例；
  - 坚决杜绝顺手重构或非必要依赖升级。
