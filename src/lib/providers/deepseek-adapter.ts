import { ProviderError } from './errors';
import { listOpenAIModels, streamOpenAICompatible } from './openai-stream-helper';
import type { ModelList } from '../types';
import type {
  ProviderAdapter,
  ProviderModelsContext,
  ProviderStreamContext,
  ProviderStreamPayload,
} from './types';

const SYSTEM_PROMPT =
  'You are an English language tutor. Explain the target word in the given context sentence clearly and concisely.';

export class DeepSeekAdapter implements ProviderAdapter {
  readonly id = 'deepseek' as const;

  async stream(payload: ProviderStreamPayload, ctx: ProviderStreamContext): Promise<void> {
    const key = ctx.apiKey.trim();
    if (!key) {
      throw new ProviderError('先填 API Key');
    }

    const baseURL = (ctx.baseURL?.trim() || 'https://api.deepseek.com').replace(/\/+$/, '');
    const url = `${baseURL}/chat/completions`;

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
    };

    const model = ctx.model || 'deepseek-chat';
    const body = {
      model,
      stream: true,
      max_tokens: 1024,
      messages: [
        {
          role: 'system',
          content: SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: payload.sentence
            ? `Explain the word "${payload.word}" (lemma: "${payload.lemma || payload.word}") in this sentence: "${payload.sentence}".`
            : `Explain the word "${payload.word}".`,
        },
      ],
    };

    await streamOpenAICompatible(url, headers, body, ctx, { providerName: 'DeepSeek' });
  }

  async listModels(ctx: ProviderModelsContext): Promise<ModelList> {
    const key = ctx.apiKey.trim();
    if (!key) {
      return { ok: false, error: '先填 API Key' };
    }

    const baseURL = (ctx.baseURL?.trim() || 'https://api.deepseek.com').replace(/\/+$/, '');
    const url = `${baseURL}/models`;

    const headers: Record<string, string> = {
      authorization: `Bearer ${key}`,
    };

    return listOpenAIModels(url, headers, ctx, 'DeepSeek');
  }
}

export const deepseekAdapter = new DeepSeekAdapter();
