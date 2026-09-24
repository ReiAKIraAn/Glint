import { redactSecrets, safeErrorMessage, sanitizeUrl } from '../security';
import {
  MAX_RESPONSE_CHARS,
  MODELS_TIMEOUT,
  STREAM_TIMEOUT,
  isOriginAllowed,
  ProviderAbortError,
  ProviderError,
  ProviderHttpError,
  ProviderNetworkError,
  ProviderProtocolError,
  ProviderResponseTooLargeError,
  ProviderTimeoutError,
} from './errors';
import type { ModelList } from '../types';
import type { ProviderModelsContext, ProviderStreamContext } from './types';

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

export interface StreamOpenAIOptions {
  providerName: string;
}

/**
 * 通用 OpenAI 兼容协议 SSE 流式处理器
 * 统一处理网络沙盒权限检查、流式解包、UTF-8 字符边界对齐、超时/取消控制与凭据脱敏
 */
export async function streamOpenAICompatible(
  rawUrl: string,
  headers: Record<string, string>,
  bodyObject: Record<string, unknown>,
  ctx: ProviderStreamContext,
  options: StreamOpenAIOptions,
): Promise<void> {
  const key = ctx.apiKey.trim();
  const providerName = options.providerName;

  if (ctx.signal?.aborted) {
    throw new ProviderAbortError('用户取消了请求');
  }

  const url = sanitizeUrl(rawUrl);
  const allowed = await isOriginAllowed(url);
  const host = getHost(url);

  if (!allowed) {
    throw new ProviderNetworkError(`没有访问 ${host} 的网络权限，请在设置中授权`);
  }

  const timeoutMs = ctx.options?.timeoutMs ?? STREAM_TIMEOUT;
  const controller = new AbortController();
  let isTimeoutFlag = false;
  let isCallerAbort = false;
  let isOversized = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      isTimeoutFlag = true;
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

  if (ctx.signal) {
    if (ctx.signal.aborted) {
      onCallerAbort();
    } else {
      ctx.signal.addEventListener('abort', onCallerAbort, { once: true });
    }
  }

  if (isCallerAbort || ctx.signal?.aborted) {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    throw new ProviderAbortError('用户取消了请求');
  }

  const body = JSON.stringify(bodyObject);
  const fetchImpl = ctx.options?.fetchFn ?? fetch;

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
      if (isCallerAbort || ctx.signal?.aborted) {
        throw new ProviderAbortError('用户取消了请求');
      }
      if (isTimeoutFlag) {
        throw new ProviderTimeoutError(
          `请求超时 (${Math.round(timeoutMs / 1000)} 秒)，${providerName} 未能及时响应`,
        );
      }
      if (fetchErr instanceof Error && fetchErr.name === 'AbortError') {
        throw new ProviderAbortError('请求已取消');
      }
      const safeMsg = safeErrorMessage(fetchErr, key ? [key] : []);
      throw new ProviderNetworkError(`连不上 ${host}（${safeMsg}）`);
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
      const safeDetail = key ? redactSecrets(detail, [key]) : detail;
      const status = response.status;

      if (status === 400) {
        throw new ProviderHttpError(
          400,
          `${providerName} 请求参数错误 (400)${safeDetail ? `：${safeDetail}` : ''}`,
        );
      }
      if (status === 401) {
        throw new ProviderHttpError(
          401,
          `${providerName} API Key 无效或未授权 (401)${safeDetail ? `：${safeDetail}` : ''}`,
        );
      }
      if (status === 403) {
        throw new ProviderHttpError(
          403,
          `${providerName} 访问被拒绝 (403)${safeDetail ? `：${safeDetail}` : ''}`,
        );
      }
      if (status === 404) {
        throw new ProviderHttpError(
          404,
          `${providerName} 请求地址或模型未找到 (404)${safeDetail ? `：${safeDetail}` : ''}`,
        );
      }
      if (status === 408) {
        throw new ProviderHttpError(408, `${providerName} 服务端响应超时 (408)`);
      }
      if (status === 429) {
        throw new ProviderHttpError(
          429,
          `${providerName} 请求频次或额度超限 (429)${safeDetail ? `：${safeDetail}` : ''}`,
        );
      }
      if (status === 500) {
        throw new ProviderHttpError(500, `${providerName} 服务端内部错误 (500)`);
      }
      if (status === 502) {
        throw new ProviderHttpError(502, `${providerName} 网关错误 (502)`);
      }
      if (status === 503) {
        throw new ProviderHttpError(503, `${providerName} 服务不可用 (503)`);
      }
      throw new ProviderHttpError(
        status,
        `${providerName} 接口返回 HTTP ${status}${safeDetail ? `：${safeDetail}` : ''}`,
      );
    }

    if (!response.body) {
      throw new ProviderProtocolError('响应体为空 (No response body)');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let lineBuffer = '';
    let currentDataLines: string[] = [];
    let totalChars = 0;
    let totalDeltaCount = 0;

    const dispatchEvent = () => {
      if (currentDataLines.length === 0) {
        return;
      }
      const rawData = currentDataLines.join('\n');
      currentDataLines = [];

      if (rawData === '[DONE]') {
        return;
      }

      let parsed: any;
      try {
        parsed = JSON.parse(rawData);
      } catch (err) {
        throw new ProviderProtocolError(
          `无法解析的 SSE 数据: ${safeErrorMessage(err, key ? [key] : [])}`,
        );
      }

      if (parsed.error) {
        const errorMsg = parsed.error?.message || `${providerName} 流式响应中包含服务错误`;
        throw new ProviderProtocolError(key ? redactSecrets(errorMsg, [key]) : errorMsg);
      }

      const deltaContent = parsed.choices?.[0]?.delta?.content;
      if (typeof deltaContent === 'string' && deltaContent.length > 0) {
        totalDeltaCount++;
        const safeText = key ? redactSecrets(deltaContent, [key]) : deltaContent;

        if (totalChars + safeText.length <= MAX_RESPONSE_CHARS) {
          totalChars += safeText.length;
          if (!controller.signal.aborted && !ctx.signal?.aborted) {
            ctx.onChunk(safeText);
          }
        } else {
          const remaining = MAX_RESPONSE_CHARS - totalChars;
          if (remaining > 0) {
            totalChars += remaining;
            if (!controller.signal.aborted && !ctx.signal?.aborted) {
              ctx.onChunk(safeText.slice(0, remaining));
            }
          }
          isOversized = true;
          controller.abort();
          throw new ProviderResponseTooLargeError(
            `释义内容超出长度限制 (${MAX_RESPONSE_CHARS} 字符)，已截断终止。`,
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
      } else if (trimmedLine.startsWith('data:')) {
        currentDataLines.push(trimmedLine.slice(5).replace(/^ /, ''));
      }
    };

    try {
      while (true) {
        if (controller.signal.aborted || ctx.signal?.aborted) {
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
          `释义内容超出长度限制 (${MAX_RESPONSE_CHARS} 字符)，已截断终止。`,
        );
      }
      if (isCallerAbort || ctx.signal?.aborted) {
        throw new ProviderAbortError('用户取消了请求');
      }
      if (isTimeoutFlag) {
        throw new ProviderTimeoutError(
          `请求超时 (${Math.round(timeoutMs / 1000)} 秒)，${providerName} 未能及时响应`,
        );
      }
      if (readErr instanceof ProviderError) {
        throw readErr;
      }
      if (readErr instanceof Error && readErr.name === 'AbortError') {
        throw new ProviderAbortError('请求已取消');
      }
      const safeMsg = safeErrorMessage(readErr, key ? [key] : []);
      throw new ProviderNetworkError(`读取 ${providerName} 流失败（${safeMsg}）`);
    } finally {
      reader.releaseLock?.();
    }

    if (isCallerAbort || ctx.signal?.aborted) {
      throw new ProviderAbortError('用户取消了请求');
    }
    if (isTimeoutFlag) {
      throw new ProviderTimeoutError(
        `请求超时 (${Math.round(timeoutMs / 1000)} 秒)，${providerName} 未能及时响应`,
      );
    }
    if (totalDeltaCount === 0) {
      throw new ProviderProtocolError('接口未返回任何文本内容');
    }
  } finally {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (ctx.signal) {
      ctx.signal.removeEventListener('abort', onCallerAbort);
    }
  }
}

/**
 * 查询 OpenAI 兼容协议的模型列表
 */
export async function listOpenAIModels(
  rawUrl: string,
  headers: Record<string, string>,
  ctx: ProviderModelsContext,
  providerName: string,
): Promise<ModelList> {
  const key = ctx.apiKey.trim();
  const url = sanitizeUrl(rawUrl);
  const host = getHost(url);

  const allowed = await isOriginAllowed(url);
  if (!allowed) {
    return { ok: false, error: `没有访问 ${host} 的网络权限，请在设置中重新授权` };
  }

  const fetchImpl = ctx.fetchFn ?? fetch;
  const timeoutSignal = ctx.signal ?? AbortSignal.timeout(MODELS_TIMEOUT);

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers,
      signal: timeoutSignal,
    });

    if (!response.ok) {
      const rawBody = await response.text().catch(() => '');
      const safeDetail = key ? redactSecrets(rawBody.slice(0, 150), [key]) : rawBody.slice(0, 150);
      if (response.status === 401) {
        return {
          ok: false,
          error: `${providerName} API Key 无效或未授权 (401)${safeDetail ? `：${safeDetail}` : ''}`,
        };
      }
      return {
        ok: false,
        error: `${host} 接口返回 HTTP ${response.status}${safeDetail ? `：${safeDetail}` : ''}`,
      };
    }

    let body: {
      data?: { id?: string }[];
      models?: { name?: string }[];
    };
    try {
      body = (await response.json()) as typeof body;
    } catch {
      return { ok: false, error: `${host} 返回了非 JSON 格式数据` };
    }

    const list = body.models
      ? body.models.map((item) => (item.name ?? '').replace(/^models\//, ''))
      : (body.data ?? []).map((item) => item.id ?? '');
    const cleaned = [...new Set(list.filter(Boolean))].sort();

    return cleaned.length
      ? { ok: true, models: cleaned }
      : { ok: false, error: '接口未返回任何可用模型' };
  } catch (error) {
    if (isTimeout(error)) {
      return { ok: false, error: `${host} 请求超时，未能及时响应` };
    }
    const safeMsg = safeErrorMessage(error, key ? [key] : []);
    return { ok: false, error: `连不上 ${host}（${safeMsg}）` };
  }
}
