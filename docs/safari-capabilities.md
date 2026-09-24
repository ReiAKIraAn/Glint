# Safari Technology Preview & WebKit 能力调研报告 (Safari Capabilities)

## 一、基线运行环境定义

* **目标浏览器**: 最新 **Safari Technology Preview (STP)**（基线：Release 253，WebKit 构建号 `320113@main ~ 321067@main`，对应 macOS Tahoe 27.2 / Golden Gate）。
* **开发策略原则**:
  - 始终以“当前最新 Safari Technology Preview”作为开发、性能基准与测试基线。
  - 不永久锁定某个 STP 版本号，版本升级时按官方 Release Notes 即时校准。
  - **不为旧版 Safari / WebKit 保留兼容或降级代码**。
  - **不为未发生的未来兼容问题提前添加 fallback**。
  - 充分发挥最新 WebKit 的标准现代 Web API 能力。

---

## 二、WebKit 核心特性与标准 Web API 支持度分析

### 1. CSS Custom Highlight API (W3C CSS Custom Highlight API Level 1)
* **支持状态**: 
  - WebKit 自 Safari 17.2 起已完整实现 `CSS.highlights`、`Highlight` 接口以及 `::highlight()` 伪元素。在最新 STP 253 中高度成熟稳定。
* **特性与优势**:
  - 真正实现“零 DOM 结构修改”的高亮标注。无需在 DOM 树中插入任何 `<span>` 或其他元素，完全避免破坏宿主网页的布局、文本选择和框架事件监听（如 React/Vue 的虚拟 DOM 差分算法）。
  - 支持多个 `Range` 对象批量提交给同一命名的高亮组（如 `glint-mark`），由 WebKit 渲染引擎在绘制流水线直接合成。
* **WebKit 样式约束 (严格遵守标准)**:
  - 仅支持对文本修饰相关的 CSS 属性进行渲染：`color`、`background-color`、`text-decoration`、`text-shadow`、`text-transform`。
  - 不支持 `margin`、`padding`、`border` 等盒模型排版属性（规范禁止，防止引起 Layout Thrashing）。
  - 高亮样式表必须挂载在文档根层级，最佳实践为使用 `document.adoptedStyleSheets`，避免在 `<head>` 中插入额外 DOM 标签。

### 2. 屏幕坐标文字命中探测 (Caret Hit Testing)
* **标准 API (`document.caretPositionFromPoint`)**:
  - **支持状态**: WebKit 在 **Safari 26.2 (STP 226+)** 中正式按 W3C 标准引入了 `document.caretPositionFromPoint(x, y)`。
  - **返回值规范**: 返回标准 `CaretPosition` 对象，包含 `offsetNode` (对应的 DOM 节点，通常为 `Text` 节点) 和 `offset` (字符在节点中的索引位置)。
* **历史私有 API (`document.caretRangeFromPoint`)**:
  - 仅作为旧 WebKit 的历史遗留实现（返回 `Range` 对象）。在最新的 STP 环境中，直接使用标准 `document.caretPositionFromPoint` 即可。
* **性能特征与注意点**:
  - `caretPositionFromPoint` 会在 DOM 或样式处于脏状态时触发同步布局计算 (Forced Synchronous Layout)。
  - **优化策略**: 必须在 `mousemove` 事件上施加节流（建议 40~50ms），并且当鼠标移动距离未超出阈值或处于正在划词选择状态 (`hasSelection()`) 时跳过探测。

### 3. Web Speech API (原生离线语音合成)
* **支持状态**: WebKit 深度集成 macOS 系统的 SpeechSynthesis 引擎。
* **行为特征**:
  - `speechSynthesis.getVoices()` 在 macOS 上可获取高质量离线系统语音（如 `Samantha`, `Alex`, `Daniel` 等），其 `localService` 属性明确为 `true`。
  - 首次调用 `getVoices()` 可能由于系统语音表异步加载返回空数组，因此需在扩展初始化阶段提前调用一次以触发系统预热。
  - 严格遵守隐私原则：仅选取 `localService === true` 的本地语音，杜绝向任何第三方发送发音音频请求。

### 4. 样式系统与色彩模型
* **`color-mix()` 与 `oklch()`**:
  - WebKit 完整支持现代 CSS 颜色函数 `color-mix(in oklch, ...)` 与广色域 `oklch()`。
  - 优势：可通过 `color-mix(in oklch, oklch(...) 60%, currentColor)` 实现完美契合宿主网页亮暗主题的动态着色，深色网站自动变亮，浅色网站自动变暗，无需感知宿主主题即可保证对比度。
* **毛玻璃滤镜 (`backdrop-filter`)**:
  - WebKit 是 `backdrop-filter` 的先驱，在 macOS 上拥有极高的硬件加速效率，`-webkit-backdrop-filter` 与 `backdrop-filter` 均可流畅呈现 60fps 动效。

---

## 三、Safari Web Extension (MV3) 机制与限制

### 1. Manifest 规范要求 (针对 STP)
* `manifest_version: 3`
* 禁用/不应声明的属性：
  - `minimum_chrome_version`（Chrome 专属，Safari 会报警告）。
  - `offline_enabled` 等 Chromium 专属标签。
* 推荐声明：
  - `permissions`: `["storage", "activeTab"]`。
  - `host_permissions`: 预置 AI 服务商的域名列表。
  - `action`: 工具栏按钮与弹出窗口。
  - `commands`: 快捷键配置。

### 2. Background 运行形态对比：Service Worker vs Background Page
* **Safari MV3 的支持情况**:
  - Safari 支持 `background.service_worker`（Safari 15.4+）。
  - 同时支持 `background.scripts`（页面型背景页，在未开启某些安全沙箱时生效）。
* **选择分析**:
  - 在个人使用、无复杂持久长连接的场景下，采用标准 `service_worker` 规范不仅体积轻量，且生命周期明确。
  - 注意事项：由于 Service Worker 在空闲时会被 WebKit 挂起，后台内存缓存（如大字典）在唤醒时需按需加载，状态持久化必须依靠 `browser.storage.local`。

### 3. Temporary Extension 加载工作流 (免 Xcode / 免开发者账号)
* **Apple 官方支持的临时加载流程**:
  1. 打开 **Safari Technology Preview**。
  2. 菜单栏选择 **Safari Technology Preview > 设置 (Settings) > 高级 (Advanced)**，勾选 **“为网页开发者显示功能” (Show features for web developers)**。
  3. 菜单栏点击 **开发 (Develop) > 允许未签名的扩展 (Allow Unsigned Extensions)**。
  4. 打开 **开发 (Develop) > 扩展构建器 (Show Extension Builder)** 或在扩展设置中直接点击 **“载入未打包的扩展文件夹...”** 选择构建产物目录。
* **生命周期特征**:
  - 临时载入的未签名扩展在 Safari 彻底退出后、或持续运行达到约 24 小时后，会被系统自动移除。
  - 对于个人日常开发与使用，只需在开启浏览器时重新载入一次（或通过开发脚本保持加载），完全无需每年花费 99 美元购买 Apple 开发者计划，也无需经过繁琐的 Xcode 打包签名。

### 4. 权限与跨域网络安全模型 (Host Permissions)
* **用户授权体验**:
  - 在 Chrome 中，`host_permissions` 在安装扩展时一次性静默或弹窗授权；
  - 在 Safari 中，当扩展试图向未直接批准的域名发起 `fetch`（例如用户在 Options 中填入了自定义的兼容 API 地址）时，WebKit 会根据隐私设置弹出授权条或拦截。
  - **设计要求**: 在 Options 页面保存自定义接口前，必须通过 `browser.permissions.request({ origins: [...] })` 明确向用户索取权限，且该调用必须严格发生在直接的用户点击事件同步调用栈中。

---

## 四、Safari 独有优化契机

1. **避免 Chromium 的 IPC 缺陷**: 原版 Chrome 中由于 Finch 实验开关不稳定导致 `browser.runtime.onMessage` 返回 Promise 偶尔被直接丢弃的问题，在 Safari WebKit 中遵循标准的 WebExtension Promise 机制。
2. **纯净的 Shadow DOM 隔离**: WebKit 的 Shadow DOM 对外部 CSS 污染具有极其强大的隔离能力，且 `<style>` 挂载在 ShadowRoot 中不会造成宿主全局重算。
3. **原生硬件加速色彩与模糊**: 毛玻璃卡片无需使用沉重的 JavaScript 动画库，纯 CSS 硬件加速即可实现细腻顺滑的展开效果。
