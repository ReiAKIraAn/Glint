import assert from 'node:assert/strict';
import test from 'node:test';
import {
  customAdapter,
  deepseekAdapter,
  getProviderAdapter,
  hasProviderAdapter,
  openaiAdapter,
  UnsupportedProviderError,
} from '../src/lib/providers';
import {
  MAX_RESPONSE_CHARS,
  ProviderAbortError,
  ProviderError,
  ProviderHttpError,
  ProviderNetworkError,
  ProviderProtocolError,
  ProviderResponseTooLargeError,
  ProviderTimeoutError,
} from '../src/lib/providers/errors';
import { mapProviderError } from '../src/lib/ai-port';
import type { ProviderStreamContext, ProviderStreamPayload } from '../src/lib/providers/types';

function createMockReadableStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index++]));
      } else {
        controller.close();
      }
    },
  });
}

function createMockByteChunksStream(byteArrays: Uint8Array[]): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < byteArrays.length) {
        controller.enqueue(byteArrays[index++]);
      } else {
        controller.close();
      }
    },
  });
}

const mockPayload: ProviderStreamPayload = {
  word: 'ephemeral',
  lemma: 'ephemeral',
  sentence: 'Fame in the digital age is increasingly ephemeral.',
};

const fakeApiKey = 'sk-proj-test-key-1234567890abcdef';

function makeContext(overrides?: Partial<ProviderStreamContext>): ProviderStreamContext {
  const controller = new AbortController();
  return {
    model: 'gpt-4o-mini',
    apiKey: fakeApiKey,
    signal: controller.signal,
    onChunk: () => {},
    ...overrides,
  };
}

// ============================================================================
// 1. Provider Registry Tests
// ============================================================================

test('REGISTRY-01: OpenAI, DeepSeek, and Custom adapters exist and conform to contract', () => {
  assert.ok(openaiAdapter);
  assert.strictEqual(openaiAdapter.id, 'openai');
  assert.strictEqual(typeof openaiAdapter.stream, 'function');
  assert.strictEqual(typeof openaiAdapter.listModels, 'function');

  assert.ok(deepseekAdapter);
  assert.strictEqual(deepseekAdapter.id, 'deepseek');
  assert.strictEqual(typeof deepseekAdapter.stream, 'function');
  assert.strictEqual(typeof deepseekAdapter.listModels, 'function');

  assert.ok(customAdapter);
  assert.strictEqual(customAdapter.id, 'custom');
  assert.strictEqual(typeof customAdapter.stream, 'function');
  assert.strictEqual(typeof customAdapter.listModels, 'function');
});

test('REGISTRY-02: ProviderRegistry resolves OpenAI, DeepSeek, and Custom', () => {
  assert.strictEqual(hasProviderAdapter('openai'), true);
  assert.strictEqual(getProviderAdapter('openai'), openaiAdapter);

  assert.strictEqual(hasProviderAdapter('deepseek'), true);
  assert.strictEqual(getProviderAdapter('deepseek'), deepseekAdapter);

  assert.strictEqual(hasProviderAdapter('custom'), true);
  assert.strictEqual(getProviderAdapter('custom'), customAdapter);
});

test('REGISTRY-03: ProviderRegistry does NOT register Anthropic', () => {
  assert.strictEqual(hasProviderAdapter('anthropic' as any), false);
  assert.throws(
    () => getProviderAdapter('anthropic' as any),
    (err: unknown) => {
      assert.ok(err instanceof UnsupportedProviderError);
      assert.strictEqual((err as UnsupportedProviderError).provider, 'anthropic');
      return true;
    },
  );
});

test('REGISTRY-04: ProviderRegistry rejects unsupported historical providers', () => {
  const unsupported = ['google', 'gemini', 'moonshot', 'kimi', 'ollama', 'groq', 'compatible'];
  for (const prov of unsupported) {
    assert.strictEqual(hasProviderAdapter(prov as any), false, `${prov} should not be registered`);
    assert.throws(
      () => getProviderAdapter(prov as any),
      (err: unknown) => {
        assert.ok(err instanceof UnsupportedProviderError);
        return true;
      },
    );
  }
});

// ============================================================================
// 2. OpenAI Adapter Tests
// ============================================================================

test('OPENAI-01: request construction matches OpenAI Chat Completions protocol', async () => {
  let capturedUrl = '';
  let capturedHeaders: Record<string, string> = {};
  let capturedBody: any = null;

  const mockFetch: typeof fetch = async (url, init) => {
    capturedUrl = String(url);
    capturedHeaders = (init?.headers as Record<string, string>) || {};
    capturedBody = JSON.parse(String(init?.body));
    return new Response(createMockReadableStream(['data: [DONE]\n\n']), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  };

  const ctx = makeContext({
    options: { fetchFn: mockFetch },
    onChunk: () => {},
  });

  // Since it returned [DONE] with 0 chunks, it will throw empty content, but we capture the request!
  await openaiAdapter.stream(mockPayload, ctx).catch(() => {});

  assert.strictEqual(capturedUrl, 'https://api.openai.com/v1/chat/completions');
  assert.strictEqual(capturedHeaders['content-type'], 'application/json');
  assert.strictEqual(capturedHeaders['authorization'], `Bearer ${fakeApiKey}`);
  assert.strictEqual(capturedBody.model, 'gpt-4o-mini');
  assert.strictEqual(capturedBody.stream, true);
  assert.strictEqual(capturedBody.max_tokens, 1024);
  assert.strictEqual(capturedBody.messages.length, 2);
  assert.strictEqual(capturedBody.messages[0].role, 'system');
  assert.strictEqual(capturedBody.messages[1].role, 'user');
  assert.ok(capturedBody.messages[1].content.includes('ephemeral'));
});

test('OPENAI-02: rejects empty API key with ProviderError', async () => {
  const ctx = makeContext({ apiKey: '   ' });
  await assert.rejects(
    () => openaiAdapter.stream(mockPayload, ctx),
    (err: unknown) => {
      assert.ok(err instanceof ProviderError);
      assert.strictEqual((err as ProviderError).message, '先填 API Key');
      return true;
    },
  );
});

test('OPENAI-03: incremental SSE streaming dispatches chunks', async () => {
  const received: string[] = [];
  const sseChunks = [
    'data: {"choices":[{"delta":{"content":"短暂的"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"；转瞬即逝的"}}]}\n\n',
    'data: [DONE]\n\n',
  ];

  const mockFetch: typeof fetch = async () =>
    new Response(createMockReadableStream(sseChunks), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });

  const ctx = makeContext({
    onChunk: (delta) => received.push(delta),
    options: { fetchFn: mockFetch },
  });

  await openaiAdapter.stream(mockPayload, ctx);
  assert.deepStrictEqual(received, ['短暂的', '；转瞬即逝的']);
});

test('OPENAI-04: multi-byte UTF-8 split across chunks decoded cleanly', async () => {
  const received: string[] = [];
  const fullText = 'data: {"choices":[{"delta":{"content":"🌟词义解析"}}]}\n\ndata: [DONE]\n\n';
  const fullBytes = new TextEncoder().encode(fullText);

  const starByte = new TextEncoder().encode('🌟')[0]!;
  const cutPoint = fullBytes.indexOf(starByte) + 2;
  const chunk1 = fullBytes.slice(0, cutPoint);
  const chunk2 = fullBytes.slice(cutPoint);

  const mockFetch: typeof fetch = async () =>
    new Response(createMockByteChunksStream([chunk1, chunk2]), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });

  const ctx = makeContext({
    onChunk: (delta) => received.push(delta),
    options: { fetchFn: mockFetch },
  });

  await openaiAdapter.stream(mockPayload, ctx);
  assert.strictEqual(received.join(''), '🌟词义解析');
});

test('OPENAI-05: HTTP error codes normalized to ProviderHttpError', async () => {
  const mockFetch401: typeof fetch = async () =>
    new Response(JSON.stringify({ error: { message: 'Incorrect API key provided' } }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });

  const ctx401 = makeContext({ options: { fetchFn: mockFetch401 } });
  await assert.rejects(
    () => openaiAdapter.stream(mockPayload, ctx401),
    (err: unknown) => {
      assert.ok(err instanceof ProviderHttpError);
      assert.strictEqual((err as ProviderHttpError).status, 401);
      assert.ok(err.message.includes('401'));
      return true;
    },
  );

  const mockFetch429: typeof fetch = async () =>
    new Response(JSON.stringify({ error: { message: 'Rate limit reached' } }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });

  const ctx429 = makeContext({ options: { fetchFn: mockFetch429 } });
  await assert.rejects(
    () => openaiAdapter.stream(mockPayload, ctx429),
    (err: unknown) => {
      assert.ok(err instanceof ProviderHttpError);
      assert.strictEqual((err as ProviderHttpError).status, 429);
      return true;
    },
  );
});

test('OPENAI-06: abort signal terminates request with ProviderAbortError', async () => {
  const controller = new AbortController();
  const mockFetch: typeof fetch = async (_url, init) => {
    return new Promise((_, reject) => {
      if (init?.signal?.aborted) {
        reject(new DOMException('The user aborted a request.', 'AbortError'));
        return;
      }
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('The user aborted a request.', 'AbortError'));
      });
    });
  };

  const ctx = makeContext({
    signal: controller.signal,
    options: { fetchFn: mockFetch },
  });

  const streamPromise = openaiAdapter.stream(mockPayload, ctx);
  controller.abort();

  await assert.rejects(streamPromise, (err: unknown) => {
    assert.ok(err instanceof ProviderAbortError);
    return true;
  });
});

test('OPENAI-07: 4,000-character limit halts stream with ProviderResponseTooLargeError', async () => {
  const bigChunk = 'a'.repeat(4005);
  const sseChunks = [
    `data: {"choices":[{"delta":{"content":"${bigChunk}"}}]}\n\n`,
    'data: [DONE]\n\n',
  ];

  const mockFetch: typeof fetch = async () =>
    new Response(createMockReadableStream(sseChunks), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });

  let receivedChars = 0;
  const ctx = makeContext({
    onChunk: (delta) => {
      receivedChars += delta.length;
    },
    options: { fetchFn: mockFetch },
  });

  await assert.rejects(
    () => openaiAdapter.stream(mockPayload, ctx),
    (err: unknown) => {
      assert.ok(err instanceof ProviderResponseTooLargeError);
      return true;
    },
  );

  assert.strictEqual(receivedChars, MAX_RESPONSE_CHARS);
});

test('OPENAI-08: listModels fetches and sorts models', async () => {
  let capturedUrl = '';
  let capturedAuth = '';

  const mockFetch: typeof fetch = async (url, init) => {
    capturedUrl = String(url);
    capturedAuth = (init?.headers as Record<string, string>)?.authorization || '';
    return new Response(
      JSON.stringify({
        data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }, { id: 'o3-mini' }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  const result = await openaiAdapter.listModels({
    apiKey: fakeApiKey,
    fetchFn: mockFetch,
  });

  assert.strictEqual(result.ok, true);
  if (result.ok) {
    assert.deepStrictEqual(result.models, ['gpt-4o', 'gpt-4o-mini', 'o3-mini']);
  }
  assert.strictEqual(capturedUrl, 'https://api.openai.com/v1/models');
  assert.strictEqual(capturedAuth, `Bearer ${fakeApiKey}`);
});

// ============================================================================
// 3. DeepSeek Adapter Tests
// ============================================================================

test('DEEPSEEK-01: request construction targets DeepSeek API', async () => {
  let capturedUrl = '';
  let capturedHeaders: Record<string, string> = {};
  let capturedBody: any = null;

  const mockFetch: typeof fetch = async (url, init) => {
    capturedUrl = String(url);
    capturedHeaders = (init?.headers as Record<string, string>) || {};
    capturedBody = JSON.parse(String(init?.body));
    return new Response(
      createMockReadableStream([
        'data: {"choices":[{"delta":{"content":"深度求索释义"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' }, },
    );
  };

  const received: string[] = [];
  const ctx = makeContext({
    model: 'deepseek-chat',
    apiKey: 'sk-deepseek-test-12345',
    options: { fetchFn: mockFetch },
    onChunk: (delta) => received.push(delta),
  });

  await deepseekAdapter.stream(mockPayload, ctx);

  assert.strictEqual(capturedUrl, 'https://api.deepseek.com/chat/completions');
  assert.strictEqual(capturedHeaders['authorization'], 'Bearer sk-deepseek-test-12345');
  assert.strictEqual(capturedBody.model, 'deepseek-chat');
  assert.strictEqual(capturedBody.stream, true);
  assert.strictEqual(received.join(''), '深度求索释义');
});

test('DEEPSEEK-02: listModels queries DeepSeek models endpoint', async () => {
  let capturedUrl = '';
  const mockFetch: typeof fetch = async (url) => {
    capturedUrl = String(url);
    return new Response(
      JSON.stringify({
        data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  const result = await deepseekAdapter.listModels({
    apiKey: 'sk-deepseek-test',
    fetchFn: mockFetch,
  });

  assert.strictEqual(result.ok, true);
  if (result.ok) {
    assert.deepStrictEqual(result.models, ['deepseek-chat', 'deepseek-reasoner']);
  }
  assert.strictEqual(capturedUrl, 'https://api.deepseek.com/models');
});

// ============================================================================
// 4. Custom API Adapter Tests
// ============================================================================

test('CUSTOM-01: requires baseURL to be specified', async () => {
  const ctx = makeContext({ baseURL: '' });
  await assert.rejects(
    () => customAdapter.stream(mockPayload, ctx),
    (err: unknown) => {
      assert.ok(err instanceof ProviderError);
      assert.strictEqual((err as ProviderError).message, '先填接口地址');
      return true;
    },
  );
});

test('CUSTOM-02: endpoint construction preserves or appends chat/completions', async () => {
  let capturedUrl = '';
  let capturedBody: any = null;

  const mockFetch: typeof fetch = async (url, init) => {
    capturedUrl = String(url);
    capturedBody = JSON.parse(String(init?.body));
    return new Response(
      createMockReadableStream([
        'data: {"choices":[{"delta":{"content":"自定义释义"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    );
  };

  // Case A: normal base URL
  const ctxA = makeContext({
    baseURL: 'https://my-proxy.company.internal/v1',
    model: 'my-custom-model',
    options: { fetchFn: mockFetch },
  });
  await customAdapter.stream(mockPayload, ctxA);
  assert.strictEqual(capturedUrl, 'https://my-proxy.company.internal/v1/chat/completions');
  assert.strictEqual(capturedBody.model, 'my-custom-model');

  // Case B: already ends with chat/completions
  const ctxB = makeContext({
    baseURL: 'https://my-proxy.company.internal/v1/chat/completions',
    model: 'my-custom-model',
    options: { fetchFn: mockFetch },
  });
  await customAdapter.stream(mockPayload, ctxB);
  assert.strictEqual(capturedUrl, 'https://my-proxy.company.internal/v1/chat/completions');
});

test('CUSTOM-03: extraBody merges into request payload with thinking_mode: false', async () => {
  let capturedBody: any = null;

  const mockFetch: typeof fetch = async (_url, init) => {
    capturedBody = JSON.parse(String(init?.body));
    return new Response(
      createMockReadableStream([
        'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    );
  };

  const ctx = makeContext({
    baseURL: 'https://custom-ai.internal/v1',
    model: 'llama-3.3-70b',
    extraBody: {
      thinking_mode: false,
      temperature: 0.2,
      custom_param: 'test_val',
    },
    options: { fetchFn: mockFetch },
  });

  await customAdapter.stream(mockPayload, ctx);

  assert.strictEqual(capturedBody.thinking_mode, false);
  assert.strictEqual(capturedBody.temperature, 0.2);
  assert.strictEqual(capturedBody.custom_param, 'test_val');
  assert.strictEqual(capturedBody.model, 'llama-3.3-70b');
  assert.strictEqual(capturedBody.stream, true);
});

test('CUSTOM-04: keyless mode does not send Authorization header', async () => {
  let capturedHeaders: Record<string, string> = {};

  const mockFetch: typeof fetch = async (_url, init) => {
    capturedHeaders = (init?.headers as Record<string, string>) || {};
    return new Response(
      createMockReadableStream([
        'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    );
  };

  const ctx = makeContext({
    baseURL: 'http://localhost:11434/v1',
    apiKey: '',
    model: 'qwen2.5:7b',
    options: { fetchFn: mockFetch },
  });

  await customAdapter.stream(mockPayload, ctx);
  assert.strictEqual(capturedHeaders['authorization'], undefined);
});
