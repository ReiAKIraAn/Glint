import {
  baseURLOf,
  modelOf,
  PROVIDERS,
  type ModelList,
  type Settings,
} from './types';
import {
  getProviderAdapter,
  hasProviderAdapter,
} from './providers/registry';
import {
  ProviderAbortError,
  ProviderError,
  STREAM_TIMEOUT,
} from './providers/errors';
import type {
  ProviderModelsContext,
  ProviderStreamContext,
  ProviderStreamPayload,
} from './providers/types';

export * from './providers/errors';
export * from './providers/types';
export * from './providers/registry';

export interface FetchOptions {
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
}

export type AiStreamPayload = ProviderStreamPayload;

export interface StreamOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export type ChunkCallback = (delta: string) => void;

/**
 * 针对指定 Provider 发起模型列表查询请求
 * 委托至静态 ProviderRegistry 对应的 ProviderAdapter
 */
export async function fetchProviderModels(
  settings: Settings,
  apiKey: string,
  options: FetchOptions = {},
): Promise<ModelList> {
  const provider = settings.provider;
  if (!hasProviderAdapter(provider)) {
    return { ok: false, error: '未知的服务商' };
  }

  const adapter = getProviderAdapter(provider);
  if (!adapter.listModels) {
    return {
      ok: false,
      error: `${PROVIDERS[provider]?.name || provider} 不支持查询可用模型`,
    };
  }

  const ctx: ProviderModelsContext = {
    apiKey,
    baseURL: baseURLOf(settings),
    signal: options.signal,
    fetchFn: options.fetchFn,
  };

  return adapter.listModels(ctx);
}

/**
 * 针对当前配置的 Provider 发起流式释义请求
 * 委托至静态 ProviderRegistry 对应的 ProviderAdapter
 */
export async function fetchProviderStream(
  settings: Settings,
  apiKey: string,
  payload: AiStreamPayload,
  signal: AbortSignal | undefined,
  onChunk: ChunkCallback,
  options: StreamOptions = {},
): Promise<void> {
  const adapter = getProviderAdapter(settings.provider);
  const model = modelOf(settings);
  const baseURL = baseURLOf(settings);

  if (signal?.aborted) {
    throw new ProviderAbortError('用户取消了请求');
  }

  const ctx: ProviderStreamContext = {
    model,
    apiKey,
    baseURL,
    signal: signal ?? new AbortController().signal,
    onChunk,
    options: {
      timeoutMs: options.timeoutMs ?? STREAM_TIMEOUT,
      fetchFn: options.fetchFn,
    },
  };

  await adapter.stream(payload, ctx);
}
