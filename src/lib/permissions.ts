import { browser } from '#imports';
import { PROVIDERS, baseURLOf, type Provider, type Settings } from './types';
import { safeErrorMessage } from './security';

/**
 * 确定某个 Provider 所需的网络访问 Origin 规则。
 */
export function originForProvider(settings: Settings, provider: Provider): string | null {
  const spec = PROVIDERS[provider];
  if (!spec) return null;
  // 如果用户显式覆盖了该 Provider 的接口地址，以覆盖地址为准
  if (settings.baseURLs[provider]) {
    try {
      const parsed = new URL(settings.baseURLs[provider]!);
      return `${parsed.origin}/*`;
    } catch {
      return null;
    }
  }
  // 否则优先使用预置的标准 Origin 规则
  if (spec.origin) return spec.origin;
  const rawUrl = baseURLOf({ ...settings, provider });
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.origin}/*`;
  } catch {
    return null;
  }
}

/**
 * 检查当前扩展是否已经获得指定 Origin 的访问权限。
 */
export async function hasHostPermission(origin: string): Promise<boolean> {
  if (!browser?.permissions?.contains) return true;
  try {
    return await browser.permissions.contains({ origins: [origin] });
  } catch {
    return false;
  }
}

/**
 * 在用户手势（如点击保存、测试连接、拉取模型）中动态向 Safari / 浏览器申请单个 Origin 的权限。
 */
export async function requestHostPermission(origin: string): Promise<{ ok: boolean; error?: string }> {
  if (!browser?.permissions?.request) return { ok: true };
  try {
    const granted = await browser.permissions.request({ origins: [origin] });
    return granted ? { ok: true } : { ok: false, error: `浏览器未授予 ${origin} 的网络访问权限` };
  } catch (err) {
    return { ok: false, error: safeErrorMessage(err) };
  }
}

/**
 * 撤销某个 Origin 的访问权限（例如当用户清除 Key 时，遵循最小权限原则）。
 * 若底层浏览器引擎（如 WebKit）因权限性质限制撤销，如实记录原因，不伪造成功状态。
 */
export async function revokeHostPermission(origin: string): Promise<{ ok: boolean; reason?: string }> {
  if (!browser?.permissions?.remove) return { ok: true };
  try {
    const success = await browser.permissions.remove({ origins: [origin] });
    return { ok: success };
  } catch (err) {
    return { ok: false, reason: safeErrorMessage(err) };
  }
}
