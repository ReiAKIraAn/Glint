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

/**
 * ============================================================================
 * Milestone 4 Step 1: Anthropic SSE 流式网络层实现 (Provider Stream Layer)
 * ============================================================================
 */

export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class ProviderHttpError extends ProviderError {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ProviderHttpError';
    this.status = status;
  }
}

export class ProviderNetworkError extends ProviderError {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderNetworkError';
  }
}

export class ProviderTimeoutError extends ProviderError {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderTimeoutError';
  }
}

export class ProviderAbortError extends ProviderError {
  constructor(message: string = '请求已取消') {
    super(message);
    this.name = 'ProviderAbortError';
  }
}

export class ProviderProtocolError extends ProviderError {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderProtocolError';
  }
}

export class ProviderResponseTooLargeError extends ProviderError {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderResponseTooLargeError';
  }
}

export const MAX_RESPONSE_CHARS = 4_000;
export const STREAM_TIMEOUT = 60_000;

export interface AiStreamPayload {
  word: string;
  lemma?: string;
  sentence: string;
}

export interface StreamOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export type ChunkCallback = (delta: string) => void;

/**
 * 针对单个 Provider (Anthropic) 发起 SSE 流式释义请求 (Milestone 4 Step 1 核心网络层)
 *
 * 核心约束：
 * 1. 纯网络层抽象，零 DOM / Card / Port / Storage 依赖。
 * 2. API Key 仅在 Request Header (x-api-key) 中传递，绝不出现在 URL、Body、Error、Console。
 * 3. 严格遵循 4,000 字符硬限制 (MAX_RESPONSE_CHARS)；超限只发送剩余字符，立即 abort 并抛出 ProviderResponseTooLargeError。
 * 4. 支持外部 AbortSignal，并在读取与推流全程即时响应，abort 后绝不触发 onChunk。
 * 5. 增量解析 SSE，支持跨 chunk 事件、单个 chunk 多事件、UTF-8 多字节拆分。
 * 6. 仅分发真正的 content_block_delta 文本增量；非文本事件安全忽略；错误事件转化为标准异常。
 */
export async function fetchProviderStream(
  settings: Settings,
  apiKey: string,
  payload: AiStreamPayload,
  signal: AbortSignal | undefined,
  onChunk: ChunkCallback,
  options: StreamOptions = {},
): Promise<void> {
  const provider = settings.provider;
  if (provider !== 'anthropic') {
    throw new ProviderError('当前仅支持 Anthropic 流式请求');
  }

  const key = apiKey.trim();
  if (!key) {
    throw new ProviderError('先填 API Key');
  }

  if (signal?.aborted) {
    throw new ProviderAbortError('用户取消了请求');
  }

  const url = sanitizeUrl('https://api.anthropic.com/v1/messages');
  const allowed = await isOriginAllowed(url);
  if (!allowed) {
    throw new ProviderNetworkError('没有访问 api.anthropic.com 的网络权限，请在设置中授权');
  }

  const timeoutMs = options.timeoutMs ?? STREAM_TIMEOUT;
  const controller = new AbortController();
  let isTimeout = false;
  let isCallerAbort = false;
  let isOversized = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      isTimeout = true;
      controller.abort();
    }, timeoutMs);
  }

  const onCallerAbort = () => {
    isCallerAbort = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    controller.abort();
  };

  if (signal) {
    signal.addEventListener('abort', onCallerAbort, { once: true });
  }

  const model = settings.models?.[provider] || PROVIDERS.anthropic.model || 'claude-3-5-sonnet-20241022';
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  };

  const body = JSON.stringify({
    model,
    max_tokens: 1024,
    stream: true,
    system: 'You are an English language tutor. Explain the target word in the given context sentence clearly and concisely.',
    messages: [
      {
        role: 'user',
        content: payload.sentence
          ? `Explain the word "${payload.word}" (lemma: "${payload.lemma || payload.word}") in this sentence: "${payload.sentence}".`
          : `Explain the word "${payload.word}".`,
      },
    ],
  });

  const fetchImpl = options.fetchFn ?? fetch;

  try {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
    } catch (fetchErr) {
      if (isCallerAbort || signal?.aborted) {
        throw new ProviderAbortError('用户取消了请求');
      }
      if (isTimeout) {
        throw new ProviderTimeoutError(`请求超时 (${Math.round(timeoutMs / 1000)} 秒)，Anthropic 未能及时响应`);
      }
      if (fetchErr instanceof Error && fetchErr.name === 'AbortError') {
        throw new ProviderAbortError('请求已取消');
      }
      const safeMsg = safeErrorMessage(fetchErr, [key]);
      throw new ProviderNetworkError(`连不上 api.anthropic.com（${safeMsg}）`);
    }

    if (!response.ok) {
      const rawBody = await response.text().catch(() => '');
      let detail = '';
      try {
        const json = JSON.parse(rawBody);
        if (json.error?.message) {
          detail = String(json.error.message);
        }
      } catch {
        detail = rawBody.slice(0, 100).replace(/\s+/g, ' ').trim();
      }
      const safeDetail = redactSecrets(detail, [key]);
      const status = response.status;
      if (status === 400) {
        throw new ProviderHttpError(400, `Anthropic 请求参数错误 (400)${safeDetail ? `：${safeDetail}` : ''}`);
      }
      if (status === 401) {
        throw new ProviderHttpError(401, `Anthropic API Key 无效或未授权 (401)${safeDetail ? `：${safeDetail}` : ''}`);
      }
      if (status === 403) {
        throw new ProviderHttpError(403, `Anthropic 访问被拒绝 (403)${safeDetail ? `：${safeDetail}` : ''}`);
      }
      if (status === 408) {
        throw new ProviderHttpError(408, `Anthropic 服务端响应超时 (408)`);
      }
      if (status === 429) {
        throw new ProviderHttpError(429, `Anthropic 请求频次或额度超限 (429)${safeDetail ? `：${safeDetail}` : ''}`);
      }
      if (status === 500) {
        throw new ProviderHttpError(500, `Anthropic 服务端内部错误 (500)`);
      }
      if (status === 502) {
        throw new ProviderHttpError(502, `Anthropic 网关错误 (502)`);
      }
      if (status === 503) {
        throw new ProviderHttpError(503, `Anthropic 服务不可用 (503)`);
      }
      throw new ProviderHttpError(status, `Anthropic 接口返回 HTTP ${status}${safeDetail ? `：${safeDetail}` : ''}`);
    }

    if (!response.body) {
      throw new ProviderProtocolError('响应体为空 (No response body)');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let lineBuffer = '';
    let currentEvent = '';
    let currentDataLines: string[] = [];
    let totalChars = 0;
    let totalDeltaCount = 0;

    const dispatchEvent = () => {
      if (currentDataLines.length === 0) {
        currentEvent = '';
        return;
      }
      const rawData = currentDataLines.join('\n');
      currentDataLines = [];
      const eventType = currentEvent;
      currentEvent = '';

      if (rawData === '[DONE]') {
        return;
      }

      let parsed: any;
      try {
        parsed = JSON.parse(rawData);
      } catch (err) {
        throw new ProviderProtocolError(`无法解析的 SSE 数据: ${safeErrorMessage(err, [key])}`);
      }

      if (eventType === 'error' || parsed.type === 'error') {
        const errorMsg = parsed.error?.message || 'Anthropic 流式响应中包含服务错误';
        throw new ProviderProtocolError(redactSecrets(errorMsg, [key]));
      }

      if (
        (eventType === 'content_block_delta' || parsed.type === 'content_block_delta') &&
        parsed.delta?.type === 'text_delta' &&
        typeof parsed.delta?.text === 'string'
      ) {
        const text = parsed.delta.text;
        if (text.length === 0) return;

        totalDeltaCount++;
        const safeText = redactSecrets(text, [key]);

        if (totalChars + safeText.length <= MAX_RESPONSE_CHARS) {
          totalChars += safeText.length;
          if (!controller.signal.aborted && !signal?.aborted) {
            onChunk(safeText);
          }
        } else {
          const remaining = MAX_RESPONSE_CHARS - totalChars;
          if (remaining > 0) {
            totalChars += remaining;
            if (!controller.signal.aborted && !signal?.aborted) {
              onChunk(safeText.slice(0, remaining));
            }
          }
          isOversized = true;
          controller.abort();
          throw new ProviderResponseTooLargeError(
            `释义内容超出长度限制 (${MAX_RESPONSE_CHARS} 字符)，已截断终止。`
          );
        }
      }
    };

    const processLine = (line: string) => {
      const trimmedLine = line.endsWith('\r') ? line.slice(0, -1) : line;
      if (trimmedLine === '') {
        dispatchEvent();
      } else if (trimmedLine.startsWith(':')) {
        return;
      } else if (trimmedLine.startsWith('event:')) {
        currentEvent = trimmedLine.slice(6).trim();
      } else if (trimmedLine.startsWith('data:')) {
        currentDataLines.push(trimmedLine.slice(5).replace(/^ /, ''));
      }
    };

    try {
      while (true) {
        if (controller.signal.aborted || signal?.aborted) {
          break;
        }
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        const chunkText = decoder.decode(value, { stream: true });
        lineBuffer += chunkText;

        let newlineIndex: number;
        while ((newlineIndex = lineBuffer.indexOf('\n')) !== -1) {
          const line = lineBuffer.slice(0, newlineIndex);
          lineBuffer = lineBuffer.slice(newlineIndex + 1);
          processLine(line);
        }
      }

      const rest = decoder.decode();
      if (rest) {
        lineBuffer += rest;
      }
      if (lineBuffer.length > 0) {
        processLine(lineBuffer);
        lineBuffer = '';
      }
      dispatchEvent();
    } catch (readErr) {
      if (isOversized) {
        throw new ProviderResponseTooLargeError(
          `释义内容超出长度限制 (${MAX_RESPONSE_CHARS} 字符)，已截断终止。`
        );
      }
      if (isCallerAbort || signal?.aborted) {
        throw new ProviderAbortError('用户取消了请求');
      }
      if (isTimeout) {
        throw new ProviderTimeoutError(`请求超时 (${Math.round(timeoutMs / 1000)} 秒)，Anthropic 未能及时响应`);
      }
      if (readErr instanceof ProviderError) {
        throw readErr;
      }
      if (readErr instanceof Error && readErr.name === 'AbortError') {
        throw new ProviderAbortError('请求已取消');
      }
      const safeMsg = safeErrorMessage(readErr, [key]);
      throw new ProviderNetworkError(`读取 Anthropic 流失败（${safeMsg}）`);
    } finally {
      reader.releaseLock?.();
    }

    if (isCallerAbort || signal?.aborted) {
      throw new ProviderAbortError('用户取消了请求');
    }
    if (isTimeout) {
      throw new ProviderTimeoutError(`请求超时 (${Math.round(timeoutMs / 1000)} 秒)，Anthropic 未能及时响应`);
    }
    if (totalDeltaCount === 0) {
      throw new ProviderProtocolError('接口未返回任何文本内容');
    }
  } finally {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (signal) {
      signal.removeEventListener('abort', onCallerAbort);
    }
  }
}

