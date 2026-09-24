import { browser } from '#imports';
import { redactSecrets, safeErrorMessage, sanitizeUrl } from './security';
import { PROVIDERS, baseURLOf, type ModelList, type Settings } from './types';

export const MODELS_TIMEOUT = 20_000;

export interface FetchOptions {
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
}

/**
 * 校验某 Provider 的 API 地址是否已获得网络权限
 */
export async function isOriginAllowed(url: string): Promise<boolean> {
  if (!browser?.permissions?.contains) return true;
  try {
    const origin = `${new URL(url).origin}/*`;
    return await browser.permissions.contains({ origins: [origin] });
  } catch {
    return true; // 无法检查时不阻拦，由底层网络沙盒捕获
  }
}

/**
 * 针对单个 Provider 发出最小 HTTPS 模型列表请求（Milestone 3 核心 Vertical Slice）
 *
 * 安全约束：
 * 1. API Key 仅在 Request Header 中发送，绝不出现在 URL Query 参数。
 * 2. 任何异常、错误日志、错误响应均经过 redactSecrets 脱敏处理，绝对不泄露 Key。
 * 3. 严格处理五条路径：成功、HTTP 错误、网络错误、超时、非标准格式响应。
 */
export async function fetchProviderModels(
  settings: Settings,
  apiKey: string,
  options: FetchOptions = {},
): Promise<ModelList> {
  const provider = settings.provider;
  const spec = PROVIDERS[provider];
  if (!spec) return { ok: false, error: '未知的服务商' };

  const key = apiKey.trim();
  if (!key && !spec.keyless) return { ok: false, error: '先填 API Key' };

  // 1. 构建安全的请求 URL（无敏感 query 参数）
  let rawUrl = '';
  if (spec.kind === 'anthropic') {
    rawUrl = 'https://api.anthropic.com/v1/models?limit=1000';
  } else if (spec.kind === 'google') {
    rawUrl = 'https://generativelanguage.googleapis.com/v1beta/models';
  } else if (spec.kind === 'openai') {
    rawUrl = 'https://api.openai.com/v1/models';
  } else {
    rawUrl = `${baseURLOf(settings).replace(/\/$/, '')}/models`;
  }

  const url = sanitizeUrl(rawUrl);

  // 2. 仅在 Request Header 中鉴权
  const headers: Record<string, string> = {};
  if (spec.kind === 'anthropic') {
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  } else if (spec.kind === 'google') {
    headers['x-goog-api-key'] = key;
  } else {
    headers['Authorization'] = `Bearer ${key}`;
  }

  // 3. 权限预检（仅允许已授权的单一 origin）
  const allowed = await isOriginAllowed(url);
  if (!allowed) {
    const host = getHost(url);
    return { ok: false, error: `没有访问 ${host} 的网络权限，请在设置中重新授权` };
  }

  const fetchImpl = options.fetchFn ?? fetch;
  const timeoutSignal = options.signal ?? AbortSignal.timeout(MODELS_TIMEOUT);

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers,
      signal: timeoutSignal,
    });

    // 路径二：HTTP 错误响应处理 (401, 403, 404, 429, 500 等)
    if (!response.ok) {
      const rawBody = await response.text().catch(() => '');
      const safeDetail = redactSecrets(rawBody.slice(0, 150), [key]);
      const host = getHost(url);
      if (response.status === 401) {
        return {
          ok: false,
          error: `${spec.name} API Key 无效或未授权 (401)${safeDetail ? `：${safeDetail}` : ''}`,
        };
      }
      return {
        ok: false,
        error: `${host} 接口返回 HTTP ${response.status}${safeDetail ? `：${safeDetail}` : ''}`,
      };
    }

    // 路径五：格式畸形响应处理 (非合法 JSON)
    let body: {
      data?: { id?: string }[];
      models?: { name?: string }[];
    };
    try {
      body = (await response.json()) as typeof body;
    } catch {
      return { ok: false, error: `${getHost(url)} 返回了非 JSON 格式数据` };
    }

    // 路径一：成功响应解析并最小化提取
    const list = body.models
      ? body.models.map((item) => (item.name ?? '').replace(/^models\//, ''))
      : (body.data ?? []).map((item) => item.id ?? '');
    const cleaned = [...new Set(list.filter(Boolean))].sort();

    return cleaned.length
      ? { ok: true, models: cleaned }
      : { ok: false, error: '接口未返回任何可用模型' };
  } catch (error) {
    // 路径四：超时中断
    if (isTimeout(error)) {
      return { ok: false, error: `${getHost(url)} 请求超时，未能及时响应` };
    }
    // 路径三：网络连通性异常 (DNS 解析失败、离线、SSL 握手错误等)
    const safeMsg = safeErrorMessage(error, [key]);
    return { ok: false, error: `连不上 ${getHost(url)}（${safeMsg}）` };
  }
}

function getHost(rawUrl: string): string {
  try {
    return new URL(rawUrl).host;
  } catch {
    return rawUrl;
  }
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}
