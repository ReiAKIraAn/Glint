# ADR 001: Safari WebExtension 最小权限与网络安全架构 (Milestone 3)

## 状态
已接受 (Accepted) — 基于 Safari Technology Preview (Release 253, WebKit 22626.1.8.19.2) 实机验证

## 背景与上下文
在 Chrome WebExtension 环境中，扩展通常在 manifest 中预置广泛的 `host_permissions` 或依赖 `https://*/*` 通配符。然而在 macOS Safari Technology Preview 中，过度申请权限会导致严重的系统级隐私警告弹窗，且违背了 Safari-first、最小权限原则 (Least-Privilege)。

此外，Milestone 3 的核心目标是建立一个受控的、单 Provider 的最小安全网络切片（Vertical Slice），必须杜绝 API Key 在传输链路、日志、错误对象、DOM 节点中的任何形式泄露。

## 关键实机验证发现 (Safari TP 253)
1. **用户手势强制约束**：
   - Safari 原生实现了标准 `browser.permissions.request()`。
   - WebKit 强制要求 `request()` 必须在**可信直接用户手势 (trusted user gesture)** 的同步生命周期内调用。
   - 任何在异步 `await` 或定时器之后调用的 `request()` 均会被 WebKit 拒绝并抛出：
     `Invalid call to permissions.request(). Must be called during a user gesture.`
2. **通配符隔离约束**：
   - 若在 `optional_host_permissions` 中声明 `https://*/*`，将导致用户在单域授权时无意获取全网权限。因此 Safari Manifest 必须彻底剔除 `https://*/*`，仅保留离散预置 Provider 的专属 origin（例如 `https://api.anthropic.com/*`）。
3. **权限撤销 (Revoke) 行为边界**：
   - 当调用 `browser.permissions.remove({ origins: [origin] })` 时，若该 origin 与扩展的必备声明（如 Content Script 的 `<all_urls>` 匹配树）存在交集，WebKit 会拒绝撤销并抛出：
     `Invalid call to permissions.remove(). The 'origins' value is invalid, because required permissions cannot be removed.`
   - 架构决策：扩展应安全尝试撤销并如实记录结果，严禁伪造成功状态。

## 决策
1. **构建清单隔离**：
   - Safari 构建配置中，`host_permissions` 保持严格为空数组 `[]`。
   - `optional_host_permissions` 仅包含显式列出的云端 Provider 单独 Origin（如 `https://api.anthropic.com/*`），彻底移除 `https://*/*`。
2. **手势前置鉴权**：
   - 在 Options 页面的用户点击事件（`#saveKey`、`#fetchModels`）触发的首行，在任何异步存盘（`await`）之前，立即发起单域权限请求 `requestHostPermission(origin)`。
   - 若用户拒绝权限，立即终止流程，严禁将 API Key 落盘，严禁发出网络请求。
3. **网络与凭证安全边界**：
   - 仅允许由 Background 统一发起对外 HTTPS 请求，Content Script 永远接触不到 API Key。
   - Provider 认证一律走 HTTP Request Header（如 Anthropic `x-api-key`、Google `x-goog-api-key`、OpenAI `Authorization: Bearer`），严禁将 secret 作为 URL Query 参数传递。
   - 所有网络响应处理（200 成功、401/403/500 HTTP 错误、网络故障、超时、畸形响应）均经过 `redactSecrets` 脱敏处理，返回给 UI 的错误信息绝不携带原始凭证。
4. **单例复用与模型最小化**：
   - Background 仅向 Options / Popup 传递最小化的结果数据（模型名称列表字符串数组），不携带任何敏感元数据。

## 结果与影响
- **正面影响**：Safari 安装时零弹窗警示；网络请求只发往用户明确授权并配置的单个服务商；API Key 全生命周期受控脱敏。
- **限制说明**：由于 WebKit 内部将 Content Script 的 `<all_urls>` 视为必备匹配项，清除 Key 时的 `permissions.remove` 可能被 WebKit 拦截并抛出受限异常，扩展对此进行了安全捕获与日志记录。
