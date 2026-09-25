import { ProviderError } from './errors';
import { mergeRequestBody } from './extra-body';
import { listOpenAIModels, streamOpenAICompatible } from './openai-stream-helper';
import { buildProviderMessages } from './prompt';
import type { ModelList } from '../types';
import type {
  ProviderAdapter,
  ProviderModelsContext,
  ProviderStreamContext,
  ProviderStreamPayload,
} from './types';

export function resolveCustomEndpoints(rawBaseURL?: string): {
  chatUrl: string;
  modelsUrl: string;
} {
  const base = (rawBaseURL || '').trim().replace(/\/+$/, '');
  if (!base) {
    throw new ProviderError('先填接口地址');
  }

  if (base.endsWith('/chat/completions')) {
    const root = base.replace(/\/chat\/completions$/, '');
    return {
      chatUrl: base,
      modelsUrl: `${root}/models`,
    };
  }

  return {
    chatUrl: `${base}/chat/completions`,
    modelsUrl: `${base}/models`,
  };
}

export class CustomAdapter implements ProviderAdapter {
  readonly id = 'custom' as const;

  async stream(payload: ProviderStreamPayload, ctx: ProviderStreamContext): Promise<void> {
    const { chatUrl } = resolveCustomEndpoints(ctx.baseURL);
    const key = ctx.apiKey.trim();

    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (key) {
      headers.authorization = `Bearer ${key}`;
    }

    const model = ctx.model.trim();
    if (!model && (!ctx.extraBody || !ctx.extraBody.model)) {
      throw new ProviderError('先填模型名');
    }

    const baseSystemFields: Record<string, unknown> = {
      model: model || (ctx.extraBody?.model as string) || '',
      stream: true,
      max_tokens: 1024,
      messages: buildProviderMessages(payload),
    };

    const body = mergeRequestBody(baseSystemFields, ctx.extraBody);

    await streamOpenAICompatible(chatUrl, headers, body, ctx, { providerName: '自定义接口' });
  }

  async listModels(ctx: ProviderModelsContext): Promise<ModelList> {
    let endpoints: { modelsUrl: string };
    try {
      endpoints = resolveCustomEndpoints(ctx.baseURL);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : '先填接口地址' };
    }

    const key = ctx.apiKey.trim();
    const headers: Record<string, string> = {};
    if (key) {
      headers.authorization = `Bearer ${key}`;
    }

    return listOpenAIModels(endpoints.modelsUrl, headers, ctx, '自定义接口');
  }
}

export const customAdapter = new CustomAdapter();
