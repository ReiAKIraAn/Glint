# Glint (Safari Personal Edition)

> 阅读英文网页时，按你的英语水平把生词标注出来。鼠标停在单词上，即可查阅本地离线词典释义；配合 AI 大模型，精准解析单词在**当前句子**中的具体语境含义。

[![Version](https://img.shields.io/badge/version-1.2.1-blue.svg)](https://github.com/ReiAKIraAn/Glint/releases)
[![Platform](https://img.shields.io/badge/platform-macOS%20Safari-orange.svg)](https://github.com/ReiAKIraAn/Glint)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-476%20passed-brightgreen.svg)](https://github.com/ReiAKIraAn/Glint)

---

## 目录

- [项目简介](#项目简介)
- [版本与定位](#版本与定位)
- [支持平台与边界](#支持平台与边界)
- [核心功能列表](#核心功能列表)
  - [智能分级标注](#1-智能分级标注)
  - [四种高亮样式](#2-四种高亮样式)
  - [本地离线词库](#3-本地离线词库)
  - [生词本与已知单词](#4-生词本与已知单词)
  - [本地离线 TTS 发音](#5-本地离线-tts-发音)
  - [AI 语境释义与流式输出](#6-ai-语境释义与流式输出)
  - [请求取消与本地缓存](#7-请求取消与本地缓存)
  - [按网站一键停用](#8-按网站一键停用)
- [AI 服务商支持 (Provider)](#ai-服务商支持-provider)
  - [OpenAI](#1-openai)
  - [DeepSeek](#2-deepseek)
  - [自定义接口 (Custom API)](#3-自定义接口-custom-api)
- [明确不支持与已清理功能](#明确不支持与已清理功能)
- [Safari / WebKit 架构与性能设计](#safari--webkit-架构与性能设计)
- [隐私与安全机制](#隐私与安全机制)
- [测试与质量状态](#测试与质量状态)
- [已知局限性](#已知局限性)
- [安装与使用方法](#安装与使用方法)
- [开发指南与命令](#开发指南与命令)
- [项目代码结构](#项目代码结构)
- [Git 分支与版本规划](#git-分支与版本规划)
- [致谢与开源许可](#致谢与开源许可)

---

## 项目简介

**Glint (Safari Personal Edition)** 是一款面向 macOS 桌面平台 Safari 浏览器量身打造的英文阅读辅助扩展。

不同于传统划词翻译工具，Glint 在网页加载后利用原生 WebKit 技术静默分词，根据用户的实际词汇储备自动将超出水平的生词高亮标出。鼠标悬浮于生词上即可展开简洁优雅的浮层卡片，不仅能够秒级查阅内置的离线词库（音标、考试标签、中文释义），还能直接调用大语言模型对该词在**当前句子**中的精准中文含义进行流式解析。

---

## 版本与定位

* **当前版本**：`1.2.1` (Git Tag: `v1.2.1-safari-personal`)
* **正式仓库**：[https://github.com/ReiAKIraAn/Glint](https://github.com/ReiAKIraAn/Glint)
* **版本定位**：
  * **Safari-First 专属个人版**：专为 macOS 用户长期日常自用优化，彻底剥离 Chrome/Firefox 等多端跨浏览器套壳包袱与臃肿历史依赖；
  * **深度利用原生 WebKit 特性**：全面拥抱 CSS Custom Highlight API、Web Speech API 离线语音及 Manifest V3 规范；
  * **纯本地隐私与零遥测**：不设中心化用户体系，不收集任何浏览行为与隐私数据。

---

## 支持平台与边界

### 官方支持环境

* **操作系统**：macOS（推荐 macOS 14 Sonoma、macOS 15 Sequoia 及更新版本）
* **浏览器**：
  * **Safari 17.2+**（要求支持原生 CSS Custom Highlight API）
  * **Safari Technology Preview**（实机基线验证通过环境：Release 253 / macOS 27.2）

### 明确不支持的环境与平台

为确保核心代码质量与架构极致纯粹，以下平台**不在本项目支持或维护范围内**：
* ❌ **移动端浏览器**：iOS / iPadOS Safari（不适配触控交互与移动版扩展沙盒）
* ❌ **非 Safari 桌面浏览器**：Google Chrome、Mozilla Firefox、Microsoft Edge 等

---

## 核心功能列表

### 1. 智能分级标注
* **CEFR 欧洲语言标准**：支持设定 A1、A2、B1、B2、C1、C2 共 6 档门槛，页面中仅标注难度高于当前级别的生词；
* **国内英语考试大纲**：可勾选已通过的考试（中考、高考、英语四级、英语六级、考研英语），系统将自动静音对应大纲词汇；
* **专项备考模式**：支持针对四级 (CET-4)、六级 (CET-6)、考研 (KY)、托福 (TOEFL)、雅思 (IELTS)、GRE 等考试词表求交集过滤，只标注目标考试范围内的词汇；
* **同页面首现过滤 (`oncePerPage`)**：可开启“同一生词在一页中仅标注首次出现”，防止常见难词在整篇文章中反复高亮分散阅读精力。

### 2. 四种高亮样式
系统提供 4 种通过 CSS Highlight 画布渲染的视觉标注样式，可在设置页中实时切换：
1. **下划虚线 (`dotted`)**：极简清爽，阅读干扰小；
2. **下划波浪线 (`wavy`)**：经典标注风格，辨识度高；
3. **背景高亮 (`background`)**：淡色半透明底色，醒目直观；
4. **文字颜色 (`color`)**：柔和变色高亮，保持版面干净。

### 3. 本地离线词库
* 内置完整处理后的 5.7 万词分级词库、ECDICT 释义、IPA 音标及考纲标签；
* 鼠标悬停查词 100% 在本地扩展沙盒中完成，耗时仅几毫秒，不产生任何网络流量。

### 4. 生词本与已知单词
* 在生词卡片上点击**「认识」**按钮，该词原型（Lemma）会立即加入本地已知词库；
* 页面中该单词的高亮将立刻抹除，今后在任何网站浏览时均不会再次标记；
* 支持在设置面板中集中查看、搜索、删除已知词汇，并支持导出/导入 JSON 备份。

### 5. 本地离线 TTS 发音
* **严格本地离线**：基于浏览器原生 `window.speechSynthesis`，严格筛选带有 `localService === true` 的原生英文语音库，发音过程零网络请求；
* **防重叠保护**：连续快速点击小喇叭发音按钮时，自动先清空旧队列（`cancelSpeech`），绝不产生多重发音回声堆叠；
* **生命周期协同**：卡片隐藏或页面卸载时自动切断语音输出，保持体验利落。

### 6. AI 语境释义与流式输出
* **单句语境精准释义**：不机械列举词典全部义项，大模型根据**当前句子**判断单词在此语境下的确切中文含义；
* **极简纯净呈现**：仅输出当前语境下的中文释义本身，杜绝英文长篇定义、词性、例句与 Markdown 格式干扰，减少阅读打断；
* **Server-Sent Events (SSE) 逐字流式打字机**：后台与内容脚本之间建立长连接通道（`AiPortClient`），释义逐字流式打出，大幅缩短首字等待时间。

### 7. 请求取消与本地缓存
* **随看随走、即关即停**：鼠标移出卡片或按下键盘 `Esc` 键关闭卡片时，扩展立刻向后台触发 `AbortSignal` 终止 AI 请求，节约 Token 与算力；
* **双层本地持久化缓存**：已生成的 AI 解释按词形归一化后存入持久化存储（容量上限 2,000 条），在同一或不同页面中再次遇到该词时瞬时呈现，无需重复消耗网络。

### 8. 按网站一键停用
* 在工具栏点击 Glint 图标弹出的小窗（Popup）中，提供“在此网站停用”开关；
* 加入黑名单的域名及其子域名将彻底跳过扫描，不改变原网页任何视觉元素。

---

## AI 服务商支持 (Provider)

在扩展的「设置」页面中，用户可以使用自己的 API Key 自由配置 AI 服务。为保障稳定与极简，本项目正式收敛为以下 **3 家服务商**：

### 1. OpenAI
* **官方接口**：`https://api.openai.com/v1`
* **默认模型**：`gpt-4o-mini`（支持模型拉取与手动指定）
* **思考预算调节**：支持关闭（off）、低（low）、中（medium）、高（high）推理强度调节。

### 2. DeepSeek
* **官方接口**：`https://api.deepseek.com`
* **推荐模型**：`deepseek-chat`、`deepseek-reasoner`
* **国内直连友好**：极速响应，翻译语感地道。

### 3. 自定义接口 (Custom API)
全面支持任意符合标准 OpenAI Chat Completions 规范的 API 接口，极大拓展自建与第三方模型支持：
* **自填 Base URL**：兼容第三方聚合平台以及本地大模型服务（如 Ollama、LM Studio、vLLM、LocalAI 等）；
* **无 Key 模式 (Keyless Mode)**：连接本地 `http://localhost:11434/v1` 或内部免密服务时，**API Key 允许留空**，请求时自动省略 Authorization 头部，避免本地服务报错；
* **额外请求体 JSON (`customExtraBody`)**：支持在请求负载中合并自定义 JSON 字段。**默认内置配置为：**
  ```json
  {
    "thinking_mode": false
  }
  ```
  可由用户根据服务端需求自由调整或增添参数（如控制特定推理引擎的思考模式开关）。

---

## 明确不支持与已清理功能

为保障扩展的高效、安全与架构清晰，本项目对历史遗留及非必要功能做出了坚决的精简与清理：

| 功能 / 组件 | 当前状态 | 决策背景与技术依据 |
| :--- | :--- | :--- |
| **Anki 导出功能** | **已彻底移除** | 个人阅读主流程聚焦高频即时理解，移除 Anki 导出 UI 及对应模块死代码，精简产物体积与设置面板复杂度。 |
| **Safari 扩展 Commands 快捷键** | **已彻底移除** | `manifest.commands`（原 `Alt+G`）在 macOS 上为 Option 键，输入时会与系统版权符号（`©`）等死键发生严重冲突；Safari 扩展设置中会强行渲染无法良好重映射的 Shortcuts 模块。已彻底清除 manifest 声明并禁用 WXT 开发注入，纯享原生体验。 |
| **Anthropic / Gemini / Kimi / Ollama 预置适配器** | **已彻底移除** | 剔除过时且庞大的官方 SDK 依赖，避免由于多服务商专有协议碎片化导致的维护灾难。全部统一由 Custom API 标准兼容协议承载。 |
| **AI 富文本 / Markdown 复杂渲染** | **不支持** | 卡片坚持严谨的纯文本结构化渲染，不引入繁重的 Markdown 解析库，杜绝潜在的网页 DOM 破坏与 XSS 安全漏洞。 |
| **穿透第三方 Shadow DOM / iframe** | **不支持** | 严格遵循 Web 开放规范的隔离边界。不对封闭 Shadow DOM（closed shadow root）及跨域 iframe 内部进行入侵式扫描。 |
| **X / Twitter 等社交媒体引流入口** | **已彻底清理** | 设置页与弹窗底部已彻底移除 X (Twitter) 社交媒体链接与图标，仅保留用户官方 GitHub 仓库链接。 |

---

## Safari / WebKit 架构与性能设计

### 1. 原生 CSS Custom Highlight API 渲染
* 传统扩展通过向网页 DOM 强行插入 `<mark>` 或 `<span>` 标签来实现高亮，极易破坏网页原有的 Flex/Grid 布局、打断打字光标（如 `contenteditable` 冲突）、导致 React/Vue 等框架的虚拟 DOM 校验崩溃（Hydration Error）；
* Glint 在 Safari 17.2+ 上**纯粹采用 `CSS.highlights` 图层渲染**，网页 DOM 树保持 100% 原始状态，零节点污染，零额外样式重绘负担。

### 2. 高性能局部增量扫描引擎
* 彻底废弃对整个 `document.body` 无脑重新扫描的低效做法；
* 基于 `MutationObserver` 监听 DOM 树微更新，通过祖先包含性裁剪算法（`pruneContainedNodes`）剔除重复嵌套子树；
* 仅对文本变动（`characterData`）的 Text 节点与新增 DOM 局部子树进行增量扫描，扫描防抖合并周期设为 40ms；
* **暴风变更熔断机制**：遇到 SPA 路由整页跳转等单次变动超过 250 条记录的极端场景时，引擎安全降级执行全量单次扫描，避免增量队列堆积。

### 3. JavaScriptCore 内存泄漏防御
* **弱引用映射 (WeakRef / WeakMap)**：Token 索引及 DOM 关联采用 `WeakRef` 持有，已移出 DOM 树的节点可被 Safari 的 JavaScriptCore (JSC) 垃圾回收器及时回收；
* **断开连接清理**：每次处理增量批次前，严格校验 `node.isConnected`，确保游离节点瞬间剔除。

### 4. 键盘无障碍交互
* 扩展在页面中挂载原生 `keydown` 事件：
  * **`Esc` 键**：快速收起当前展开或钉住的生词卡片；
* 无任何全局拦截或快捷键抢占，不干扰网页原有输入法及快捷键操作。

---

## 隐私与安全机制

Glint (Safari Personal Edition) 将用户的数据隐私与凭证安全置于最高优先级：

1. **Safari 最小权限架构 (Least-Privilege)**：
   * `manifest.json` 中初始声明的必选主机权限 `host_permissions` **严格为空 `[]`**；
   * 安装扩展时，Safari 不会向用户展示“此扩展可以读取您在所有网站上的敏感数据”等令人不安的警示；
   * 仅在用户实际在设置页选择某家服务商并保存时，通过原生手势发起针对该单一域名的 `optional_host_permissions` 动态单域授权。
2. **API 密钥物理隔离**：
   * 所有的 API Key 仅保存在浏览器受保护的后台沙盒存储中，任何运行于网页宿主环境的 Content Script 绝无可能读取到 Key 原文。
3. **全链路凭据安全脱敏 (`redactSecrets`)**：
   * 内部网络通信库自动清洗 URL 查询参数中的敏感信息；
   * 控制台报错、错误消息提示、跨进程消息响应均进行密钥掩码处理，杜绝网络故障或服务端报错时回显明文密钥。
4. **零追踪、零遥测**：
   * 扩展没有自建的后端统计接口，没有任何用户跟踪代码或三方分析脚本。

---

## 测试与质量状态

项目包含严格完备的自动化回归测试矩阵，持续确保功能与性能无损：

* **测试命令**：`pnpm test`
* **测试套件覆盖**：**417 项自动化用例全部通过（417 passed / 0 failed）**；
  * **动态网页与增量扫描**：`tests/dynamic-web.test.ts`、`tests/incremental-scan.test.ts`
  * **Provider 适配器与网络**：`tests/provider-adapter.test.ts`、`tests/provider-network.test.ts`
  * **流式长连接与取消**：`tests/ai-port.test.ts`、`tests/ai-stream.test.ts`
  * **安全与密钥脱敏**：`tests/security-redaction.test.ts`、`tests/permission-architecture.test.ts`
  * **离线 TTS 发音**：`tests/tts.test.ts`
  * **UI 表面与链接合规**：`tests/ui-surface.test.ts`
* **类型检查**：`pnpm exec tsc --noEmit` 严格类型校验零错误；
* **构建验证**：`pnpm exec wxt build -b safari --mv3` 成功打包生成标准 Safari MV3 产物（约 5.65 MB）。

---

## 已知局限性

为秉持务实严谨的技术原则，明确当前版本的已知边界与局限，不作夸大承诺：

1. **真实外部收费 API 验证环境限制**：自动化测试环境基于严密的 Mock 服务与仿真网络，未在本仓库中预置付费真实 API Key 进行外部联网压测；
2. **突发极端变更退回重扫**：单批次变动大于 250 条记录时，增量引擎会退回执行整页全量扫描；
3. **Safari Service Worker 慢流超时**：过慢的 AI 流式响应（超过 90 秒）仍受 Safari MV3 后台 Service Worker 基础生命周期与超时熔断控制；
4. **不穿透封闭 Shadow DOM 与跨域 iframe**：嵌入在跨域 iframe 或封闭 Shadow Root 内部的文本无法被扩展捕获标注；
5. **复杂页面性能波动**：在包含数万长列表节点的极极端网页中，不能保证 100% 杜绝 JSC 堆内存波动或零微小 Long Task；
6. **Safari 验证环境版本说明**：实机测试基于 macOS 27.2 下的 Safari Technology Preview Release 253，不代表 STP 253 是唯一或最新的测试版本，亦不承诺向后兼容 Safari 17.2 以前的老旧版本。

---

## 安装与使用方法

由于本项目为 Safari 专属个人版，推荐通过解包扩展（Unpacked Extension）方式载入使用：

### 第一步：准备构建产物
在仓库根目录下执行构建命令：
```bash
pnpm install
pnpm build:safari
```
构建成功后，将在项目根目录下生成 `.output/safari-mv3` 文件夹。

### 第二步：开启 Safari 开发者支持
1. 打开 **Safari** 或 **Safari Technology Preview**；
2. 点击顶部菜单栏 **Safari → Settings (设置) → Advanced (高级)**；
3. 勾选底部的 **Show features for web developers (在菜单栏中显示“开发”菜单)**；
4. 点击顶部菜单栏 **Develop (开发) → Developer Settings… (开发者设置)**（或直接在设置中进入 **Developer** 标签页）；
5. 勾选 **Allow unsigned extensions (允许未签名扩展)**（此选项可能需要验证 macOS 开机密码）。

### 第三步：载入扩展
1. 在 Safari 设置中打开 **Extensions (扩展)** 面板；
2. 载入生成的 `.output/safari-mv3` 目录；
3. 勾选启用 **Glint (Safari Personal Edition)**，并授予在访问网页时的权限即可。

---

## 开发指南与命令

本项目基于 [WXT](https://wxt.dev/) 现代扩展框架与 Vite 构建。

```bash
# 安装项目依赖
pnpm install

# 启动开发服务器
pnpm dev

# 编译生成 Safari MV3 生产产物 (.output/safari-mv3)
pnpm build:safari

# 打包为发布 ZIP 文件 (.output/glint-*.zip)
pnpm zip:safari

# 运行完整自动化测试套件 (417 用例)
pnpm test

# 运行 TypeScript 类型检查
pnpm compile

# 启动本地网页沙盒预览 (不装扩展调试卡片与设置界面)
pnpm demo
```

> **重新生成词典索引（通常无需执行）**：
> 词库索引已提交在仓库中。如需从头重新处理原始词库数据，需先下载 66MB 的原始 ECDICT CSV 文件并指定内存运行：
> ```bash
> curl -L -o data/ecdict.csv https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv
> NODE_OPTIONS=--max-old-space-size=6144 pnpm data
> ```

---

## 项目代码结构

```text
glint/
├── src/
│   ├── entrypoints/          # 扩展入口目录
│   │   ├── background.ts     # 后台 Service Worker (API 请求、流式端口转发、模型拉取)
│   │   ├── content.ts        # 前台内容脚本 (DOM 增量监听、高亮调度、卡片挂载)
│   │   ├── options/          # 设置页面 (UI 渲染、Provider 配置、词库备份管理)
│   │   └── popup/            # 工具栏弹窗 (快捷难度档位调节、网站开关)
│   ├── lib/                  # 核心功能模块
│   │   ├── ai-port.ts        # Service Worker 侧长连接流式通道
│   │   ├── ai-port-client.ts # 前台流式客户端 (SSE 逐字接收与中止调度)
│   │   ├── card.ts           # 悬浮释义卡片 UI 组件
│   │   ├── explanation-cache.ts # 本地释义缓存持久化
│   │   ├── highlight.ts      # CSS Custom Highlight 原生高亮引擎
│   │   ├── hover.ts          # 鼠标悬停追踪器与 WeakMap Token 映射
│   │   ├── keynav.ts         # 原生 Esc 键盘交互管理
│   │   ├── links.ts          # 官方仓库链接挂载 (已清除 X/Twitter)
│   │   ├── permissions.ts    # Safari 动态单域权限申请封装
│   │   ├── scan.ts           # 分词归一化与子树增量扫描核心
│   │   ├── security.ts       # 密钥脱敏与 URL 清洗安全套件
│   │   ├── speak.ts          # 本地离线 TTS 语音合成封装
│   │   └── providers/        # AI 服务商适配器 (OpenAI / DeepSeek / Custom)
│   └── assets/               # 静态资源与内置词汇级别索引
├── tests/                    # 476 项自动化回归测试套件
├── docs/                     # 系统架构设计、Safari WebKit 依赖及历史审计文档
├── public/                   # 扩展静态资源 (图标、dict.json、exams.json)
├── wxt.config.ts             # WXT 配置文件 (已禁用 reloadCommand，最小权限配置)
└── package.json              # 项目配置与元数据 (统一使用 ReiAKIraAn/Glint)
```

---

## Git 分支与版本规划

* **主工作与发布分支**：`safari-personal`
* **版本标签规范**：`v<version>-safari-personal`（例如 `v1.1.1-safari-personal`、`v1.1.2-safari-personal`、`v1.1.3-safari-personal`、`v1.1.4-safari-personal`、`v1.2.0-safari-personal`、`v1.2.1-safari-personal`）
* **版本演进**：
  * `v1.1.1-safari-personal`：完成 Provider 架构收敛、Custom API 无 Key 与 Extra Body 支持、CSS 文字颜色高亮支持、Anki UI 移除及历史基线确立；
  * `v1.1.2-safari-personal`：完成 Safari 扩展 Shortcuts 残留来源彻底切断、禁用 WXT 自动 reload command、全面清理 X/Twitter 社交入口、统一 GitHub 官方链接，并完善全中文工程技术文档；
  * `v1.1.3-safari-personal`：AI 解释精简为仅显示当前语境下的中文释义，统一三家 Provider 提示词，移除英文长释义与格式干扰，修复权限用户手势问题；
  * `v1.1.4-safari-personal`：AI 解释优先作为单词卡片默认释义，无缓存时显示本地词典并异步流式生成；
  * `v1.2.0-safari-personal`：新增 AI Card Redo 重新生成能力，支持在单词卡内主动绕过缓存重新结合句子上下文请求 AI 释义，具备单请求并发控制、旧请求隔离和失败安全回退；
  * `v1.2.1-safari-personal`：清理并移除设置页中尚未实现的“标注词库外的生僻词”无效 UI 选项与相关说明；保留 markUnknown 设置字段以兼容已有配置和备份数据；核心 Scanner 路径零修改。

---

## 致谢与开源许可

### 上游项目致谢
本项目基于开源项目 [Glint](https://github.com/whyubel1eve/glint)（由 [whyubel1eve](https://github.com/whyubel1eve) 原创开发）的代码基础进行 Safari 平台深度重构与个人版演进。衷心感谢原作者在浏览器生词阅读领域的卓越探索与开源贡献！

### 授权许可
* 本项目扩展代码采用 [MIT 许可证](LICENSE) 发布。
* 第三方词库与语料数据版权归属：
  * **[ECDICT](https://github.com/skywind3000/ECDICT)**：基于 MIT 许可证发布；
  * **[CEFR-J Vocabulary Profile](https://github.com/openlanguageprofiles/olp-en-cefrj)**：由 Tono Laboratory (TUFS) 及 Open Language Profiles 整理发布，遵循免费使用出处标示规则；
  * **Octanove C1/C2 Profile**：基于 [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) 许可证发布。
  * 完整版权与第三方许可证清单请参阅 [NOTICE.md](NOTICE.md)。
