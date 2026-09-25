import { browser } from '#imports';
import { PROVIDERS, baseURLOf, type Provider, type Settings } from './types';
import { safeErrorMessage } from './security';
import { parseAndValidateExtraBody } from './providers/extra-body';

/** 本机的几种写法。这些走 http 没问题——请求根本不出这台机器。 */
export const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function isAllowedEndpoint(baseURL: string): boolean {
  let url: URL;
  try {
    url = new URL(baseURL);
  } catch {
    return false;
  }
  return url.protocol === 'https:' || LOCAL_HOSTS.has(url.hostname);
}

export function overrideBaseURLForProvider(
  currentBaseURLs: Settings['baseURLs'],
  provider: Provider,
  url: string,
): Settings['baseURLs'] {
  const next = { ...currentBaseURLs };
  if (url && url !== PROVIDERS[provider]?.baseURL) {
    next[provider] = url;
  } else {
    delete next[provider];
  }
  return next;
}

export interface SaveInputParams {
  provider: Provider;
  apiKey: string;
  baseURL: string;
  extraBody: string;
  savedKeys: Record<string, boolean>;
  currentSettings: Settings;
}

export type SaveValidationResult =
  | {
      ok: true;
      targetOrigin: string | null;
      keyToSave: string | null;
      customExtraBodyToSave?: string;
      customBaseURLToSave?: string;
    }
  | {
      ok: false;
      error: string;
      field?: 'apiKey' | 'baseURL' | 'extraBody';
    };

/**
 * 同步校验保存表单的所有输入并确定需要申请的 targetOrigin。
 * 纯同步逻辑，绝不返回 Promise，绝无 await，保证在后续请求权限时 user gesture call stack 完好无损。
 */
export function validateSaveForm(params: SaveInputParams): SaveValidationResult {
  const spec = PROVIDERS[params.provider];
  if (!spec) return { ok: false, error: '未知的服务商' };

  const typed = params.apiKey.trim();
  const key = typed === '••••••••' ? '' : typed;

  if (!key && !spec.keyless && !params.savedKeys[params.provider]) {
    return { ok: false, error: '先粘贴一个 Key', field: 'apiKey' };
  }

  if (spec.kind === 'custom') {
    const rawExtra = params.extraBody.trim();
    const parsedExtra = parseAndValidateExtraBody(rawExtra);
    if (!parsedExtra.ok) {
      return { ok: false, error: parsedExtra.error, field: 'extraBody' };
    }

    const rawBaseURL = params.baseURL.trim();
    if (!rawBaseURL) {
      return { ok: false, error: '先填接口地址', field: 'baseURL' };
    }

    let url: URL;
    try {
      url = new URL(rawBaseURL);
    } catch {
      return { ok: false, error: '接口地址不是合法 URL', field: 'baseURL' };
    }

    if (url.protocol !== 'https:' && !LOCAL_HOSTS.has(url.hostname)) {
      return {
        ok: false,
        error: '非本机地址请用 https——http 会把 API Key 明文发出去',
        field: 'baseURL',
      };
    }

    return {
      ok: true,
      targetOrigin: `${url.origin}/*`,
      keyToSave: key || null,
      customExtraBodyToSave: rawExtra,
      customBaseURLToSave: rawBaseURL,
    };
  }

  const origin = originForProvider(params.currentSettings, params.provider);
  return {
    ok: true,
    targetOrigin: origin,
    keyToSave: key || null,
  };
}

export interface SaveWorkflowCallbacks {
  requestPermission: (origin: string) => Promise<{ ok: boolean; error?: string }>;
  saveSettings: (changes: Partial<Settings>) => Promise<void>;
  saveApiKey: (provider: Provider, key: string) => Promise<void>;
}

export type SaveWorkflowResult =
  | { ok: true }
  | { ok: false; error: string; field?: 'apiKey' | 'baseURL' | 'extraBody' };

/**
 * 执行设置保存主流程：
 * 1. 同步参数校验（零 Promise，保证在进入权限申请前 user gesture 绝不丢失）；
 * 2. 权限门禁（user gesture 启动后的首个异步 API 调用，严禁在此之前插入任何 await）；
 * 3. 存储落盘与凭证持久化（仅在权限授予成功后执行）。
 */
export async function executeSaveWorkflow(
  params: SaveInputParams,
  callbacks: SaveWorkflowCallbacks,
): Promise<SaveWorkflowResult> {
  // 1. 同步校验
  const validation = validateSaveForm(params);
  if (!validation.ok) {
    return validation;
  }

  // 2. 同步权限门禁（user gesture 初始调用）
  if (validation.targetOrigin) {
    const granted = await callbacks.requestPermission(validation.targetOrigin);
    if (!granted.ok) {
      return {
        ok: false,
        error: granted.error ?? `浏览器未授予 ${validation.targetOrigin} 的网络访问权限`,
      };
    }
  }

  // 3. 存储落盘（权限授予成功后才允许写入）
  if (
    validation.customExtraBodyToSave !== undefined &&
    validation.customBaseURLToSave !== undefined
  ) {
    await callbacks.saveSettings({
      customExtraBody: validation.customExtraBodyToSave,
      baseURLs: overrideBaseURLForProvider(
        params.currentSettings.baseURLs,
        params.provider,
        validation.customBaseURLToSave,
      ),
    });
  }

  if (validation.keyToSave) {
    await callbacks.saveApiKey(params.provider, validation.keyToSave);
  }

  return { ok: true };
}

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
