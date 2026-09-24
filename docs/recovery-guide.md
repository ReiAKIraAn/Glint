# Glint Safari Personal Edition — Disaster Recovery & Failure Handling Guide

本文档系统化分析与归档 Glint Safari Personal Edition 在各种异常、灾难或中断场景下的内置恢复机制与现有行为表现。
作为长期运行的个人扩展，其设计哲学是**故障域局部化与安全优雅降级**——任何单点异常（如网络断开、坏数据、扩展重启）均被阻断在局部通道内，坚决不导致宿主网页崩溃、不破坏用户长期数据。

---

## 异常场景与恢复机制全景图

| 场景编号 | 异常场景 (Disaster Scenario) | 现有系统行为与恢复机制 (Existing Recovery Mechanism) | 影响与安全边界 (Impact & Boundary) |
| :---: | :--- | :--- | :--- |
| **REC-01** | **扩展热重载 (Extension Reload)** | 内容脚本与旧 Background 的 Port 物理断开；卡片若处于流式中，`port.onDisconnect` 捕获断开事件并平滑退出加载态。刷新网页后自动重新加载最新扩展。 | 零数据损坏，不残留悬挂的死循环请求。 |
| **REC-02** | **Safari 浏览器重启 (Safari Restart)** | 扩展生命周期随浏览器正常唤醒。已存储的 `local:settings`, `local:knownWords`, `local:apiKeys`, `local:explanations` 由底层存储完整恢复。未发生任何原句上下文持久化。 | 用户配置完好，同词缓存立即可用。 |
| **REC-03** | **Service Worker 运行时休眠或重启** | 在无网络请求约 30 秒后 WebKit 会主动终止 SW。下一次内容脚本发起 Port 连接或 Popup 唤起时，WebKit 事件循环自动拉起 SW，字典与状态按需初始化。 | 对用户完全透明，资源零空闲驻留。 |
| **REC-04** | **持久化存储中存在损坏/畸形数据** | `sanitizeExplanationStore` 拦截所有条目；凡是不符合 `{ word, explanation, updatedAt }` 严格三字段或携带旧版本 `sentence/analysis` 的条目被直接剔除丢弃，并自动回写清洗后的整洁集合。 | 自动清洗，杜绝类型不一致与隐私遗留。 |
| **REC-05** | **API Key 过期或填写错误 (HTTP 401)** | Anthropic 服务端返回 401 Unauthorized；`AnthropicAdapter` 将其归一化为 `ProviderHttpError`，经过 `redactSecrets` 脱敏后抛出；卡片展示友好的纯文本错误提示：“API 认证失败，请检查 API Key”。 | 密钥在错误信息中自动打码为 `[REDACTED]`。 |
| **REC-06** | **用户拒绝服务商域名权限申请** | 选项页保存时若用户在 Safari 系统弹窗中点击“拒绝”，`ensureProviderPermission` 捕获并返回 `false`；系统阻断保存并提示权限缺失，不发起未经授权的网络请求。 | 严格尊重用户选择，零非授权网络连接。 |
| **REC-07** | **用户事后撤回已授予的域名权限** | 用户在 Safari 扩展管理中手动吊销权限；下次发起 AI 请求时，网络请求直接被 WebKit 底层拦截；适配器捕获并返回网络不可达错误，卡片清晰提示。 | 扩展优雅提示，无未捕获异常。 |
| **REC-08** | **服务端故障 / DNS 失败 / 离线断网** | `fetch` 抛出 `TypeError: Failed to fetch`；适配器捕获并转换为 `ProviderNetworkError`，提示用户检查网络或 DNS 设置。 | 零假死，卡片退出 loading 并允许关闭。 |
| **REC-09** | **用户主动点击“取消”中断 AI 推流** | 卡片点击“取消” -> 通过 Port 发送 `AI_ABORT` 消息 -> Background 立即调用 `reader.cancel()` 并中止底层 AbortController -> 服务器断开连接 -> 卡片 UI 立即恢复就绪态。 | 即刻停止消耗 Token 与下行流量，资源完全释放。 |
| **REC-10** | **推流期间用户导航离开或关闭标签页** | 标签页销毁导致 Port 触发 `disconnect`；Background 监听到连接关闭自动触发 `abortController.abort()`，后台流式读取随之终止。 | 无孤儿后台网络任务继续消耗系统 CPU/网络。 |
| **REC-11** | **SPA 客户端单页路由跳转** | 内容脚本监听 URL 与 DOM 大规模置换，`tokenMap` 自动清理失效 WeakRef 节点，清空当前页面高亮并重新执行新路由正文扫描。 | 绝无旧页面残留高亮污染新路由界面。 |
| **REC-12** | **正在活跃页面上扩展突然被禁用/卸载** | 内容脚本失去扩展上下文（`Extension context invalidated`）；已有高亮保持为纯静态 Range，DOM 节点完好；卡片无法再发起新的 AI 请求，不再执行任何背景操作。 | 网页正文阅读不受干扰，不导致页面崩溃。 |

---

## 灾难恢复实操指引 (Disaster Recovery Procedures)

### 故障 1: 缓存异常膨胀或出现未定义错误
- **症状**: 悬停生词后卡片展示空白，或者控制台报存储解析失败。
- **恢复操作**:
  1. 打开 Safari 扩展选项页 (Options Page)；
  2. 切换至“数据” (Data) 选项卡；
  3. 点击“清空已生成的 AI 释义”按钮；
  4. 存储将重置为 `{}`，后续释义将重新发起干净生成。

### 故障 2: API 密钥无法保存或权限状态错乱
- **症状**: 输入了正确的 API Key 但总是提示权限不足。
- **恢复操作**:
  1. 打开 macOS 系统设置 -> Safari 浏览器 -> 扩展 (Extensions)；
  2. 找到 Glint 扩展，检查其“网站权限”设置；
  3. 确认已允许访问 `api.anthropic.com`；
  4. 返回选项页重新点击保存。

### 故障 3: 动态网页频繁更新导致偶发打字卡顿
- **症状**: 在极其复杂的富文本编辑网页或实时数据流监控页面上，打字有轻微延迟。
- **恢复操作**:
  1. 点击 Safari 工具栏上的 Glint 扩展图标展开 Popup；
  2. 点击“在当前域名停用”开关；
  3. 该域名将被加入黑名单，内容脚本立即停止对该站点的扫描与监听。
