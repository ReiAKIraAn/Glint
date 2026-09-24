import assert from 'node:assert/strict';
import test from 'node:test';
import {
  anthropicAdapter,
  getProviderAdapter,
  hasProviderAdapter,
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

const fakeApiKey = 'sk-ant-api03-test-key-1234567890abcdef';

function makeContext(overrides?: Partial<ProviderStreamContext>): ProviderStreamContext {
  const controller = new AbortController();
  return {
    model: 'claude-3-5-sonnet-20241022',
    apiKey: fakeApiKey,
    signal: controller.signal,
    onChunk: () => {},
    ...overrides,
  };
}

// ============================================================================
// ADAPTER-01 to ADAPTER-14 Tests
// ============================================================================

test('ADAPTER-01: Anthropic adapter exists and conforms to ProviderAdapter contract', () => {
  assert.ok(anthropicAdapter);
  assert.strictEqual(anthropicAdapter.id, 'anthropic');
  assert.strictEqual(typeof anthropicAdapter.stream, 'function');
  assert.strictEqual(typeof anthropicAdapter.listModels, 'function');
});

test('ADAPTER-02: ProviderRegistry resolves anthropic adapter', () => {
  assert.strictEqual(hasProviderAdapter('anthropic'), true);
  const adapter = getProviderAdapter('anthropic');
  assert.strictEqual(adapter, anthropicAdapter);
});

test('ADAPTER-03: ProviderRegistry rejects unknown or unregistered provider', () => {
  assert.strictEqual(hasProviderAdapter('openai' as any), false);
  assert.throws(
    () => getProviderAdapter('openai' as any),
    (err: unknown) => {
      assert.ok(err instanceof UnsupportedProviderError);
      assert.strictEqual((err as UnsupportedProviderError).provider, 'openai');
      return true;
    },
  );
});

test('ADAPTER-04: normal SSE stream chunks are incrementally dispatched', async () => {
  const received: string[] = [];
  const sseChunks = [
    'event: message_start\ndata: {"type":"message_start"}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"短暂的"}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"；转瞬即逝的"}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
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

  await anthropicAdapter.stream(mockPayload, ctx);

  assert.deepStrictEqual(received, ['短暂的', '；转瞬即逝的']);
});

test('ADAPTER-05: UTF-8 multi-byte characters split across network chunks are decoded cleanly', async () => {
  const received: string[] = [];
  const fullText = 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"🌟词义解析"}}\n\n';
  const fullBytes = new TextEncoder().encode(fullText);

  // 故意在多字节字符中间切割
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

  await anthropicAdapter.stream(mockPayload, ctx);

  assert.strictEqual(received.join(''), '🌟词义解析');
});

test('ADAPTER-06: network boundary failures are normalized to ProviderNetworkError', async () => {
  const mockFetch: typeof fetch = async () => {
    throw new TypeError('Failed to fetch (DNS lookup failed)');
  };

  const ctx = makeContext({
    options: { fetchFn: mockFetch },
  });

  await assert.rejects(
    () => anthropicAdapter.stream(mockPayload, ctx),
    (err: unknown) => {
      assert.ok(err instanceof ProviderNetworkError);
      assert.ok(err.message.includes('连不上 api.anthropic.com'));
      return true;
    },
  );
});

test('ADAPTER-07: malformed protocol and empty streams are rejected with ProviderProtocolError', async () => {
  // 1. 畸形 JSON 数据行
  const malformedFetch: typeof fetch = async () =>
    new Response(createMockReadableStream(['data: {broken json\n\n']), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });

  const ctx1 = makeContext({ options: { fetchFn: malformedFetch } });
  await assert.rejects(
    () => anthropicAdapter.stream(mockPayload, ctx1),
    (err: unknown) => {
      assert.ok(err instanceof ProviderProtocolError);
      assert.ok(err.message.includes('无法解析的 SSE 数据'));
      return true;
    },
  );

  // 2. 正常关闭但 0 文本 delta
  const emptyFetch: typeof fetch = async () =>
    new Response(createMockReadableStream(['event: ping\ndata: {}\n\n']), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });

  const ctx2 = makeContext({ options: { fetchFn: emptyFetch } });
  await assert.rejects(
    () => anthropicAdapter.stream(mockPayload, ctx2),
    (err: unknown) => {
      assert.ok(err instanceof ProviderProtocolError);
      assert.ok(err.message.includes('未返回任何文本内容'));
      return true;
    },
  );
});

test('ADAPTER-08: provider HTTP status codes are normalized to ProviderHttpError', async () => {
  const fetchStatus = (status: number, message: string) => async () =>
    new Response(JSON.stringify({ error: { message } }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  // 401
  const ctx401 = makeContext({
    options: { fetchFn: fetchStatus(401, 'Invalid API key provided') },
  });
  await assert.rejects(
    () => anthropicAdapter.stream(mockPayload, ctx401),
    (err: unknown) => {
      assert.ok(err instanceof ProviderHttpError);
      assert.strictEqual(err.status, 401);
      assert.ok(err.message.includes('401'));
      return true;
    },
  );

  // 429
  const ctx429 = makeContext({
    options: { fetchFn: fetchStatus(429, 'Rate limit exceeded') },
  });
  await assert.rejects(
    () => anthropicAdapter.stream(mockPayload, ctx429),
    (err: unknown) => {
      assert.ok(err instanceof ProviderHttpError);
      assert.strictEqual(err.status, 429);
      assert.ok(err.message.includes('429'));
      return true;
    },
  );

  // 500
  const ctx500 = makeContext({
    options: { fetchFn: fetchStatus(500, 'Internal server error') },
  });
  await assert.rejects(
    () => anthropicAdapter.stream(mockPayload, ctx500),
    (err: unknown) => {
      assert.ok(err instanceof ProviderHttpError);
      assert.strictEqual(err.status, 500);
      return true;
    },
  );
});

test('ADAPTER-09: caller abort immediately stops reading without further onChunk calls', async () => {
  const controller = new AbortController();
  const received: string[] = [];

  const mockFetch: typeof fetch = async () =>
    new Response(
      createMockReadableStream([
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"chunk 1"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"chunk 2"}}\n\n',
      ]),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    );

  const ctx = makeContext({
    signal: controller.signal,
    onChunk: (delta) => {
      received.push(delta);
      controller.abort();
    },
    options: { fetchFn: mockFetch },
  });

  await assert.rejects(
    () => anthropicAdapter.stream(mockPayload, ctx),
    (err: unknown) => {
      assert.ok(err instanceof ProviderAbortError);
      return true;
    },
  );

  assert.strictEqual(received.length, 1);
});

test('ADAPTER-10: stream timeout rejects with ProviderTimeoutError', async () => {
  const mockFetch: typeof fetch = async (_url, init) => {
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const timeoutErr = new Error('The operation was aborted due to timeout');
        timeoutErr.name = 'TimeoutError';
        reject(timeoutErr);
      });
    });
  };

  const ctx = makeContext({
    options: {
      fetchFn: mockFetch,
      timeoutMs: 20, // 20ms 极短超时
    },
  });

  await assert.rejects(
    () => anthropicAdapter.stream(mockPayload, ctx),
    (err: unknown) => {
      assert.ok(err instanceof ProviderTimeoutError);
      assert.ok(err.message.includes('请求超时'));
      return true;
    },
  );
});

test('ADAPTER-11: 4,000-character limit halts stream with ProviderResponseTooLargeError', async () => {
  const bigChunk = 'A'.repeat(2500);
  const sseChunks = [
    `event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"${bigChunk}"}}\n\n`,
    `event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"${bigChunk}"}}\n\n`,
  ];

  const mockFetch: typeof fetch = async () =>
    new Response(createMockReadableStream(sseChunks), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });

  let totalReceivedChars = 0;
  const ctx = makeContext({
    onChunk: (delta) => {
      totalReceivedChars += delta.length;
    },
    options: { fetchFn: mockFetch },
  });

  await assert.rejects(
    () => anthropicAdapter.stream(mockPayload, ctx),
    (err: unknown) => {
      assert.ok(err instanceof ProviderResponseTooLargeError);
      assert.ok(err.message.includes(String(MAX_RESPONSE_CHARS)));
      return true;
    },
  );

  assert.strictEqual(totalReceivedChars, MAX_RESPONSE_CHARS);
});

test('ADAPTER-12: API Key is never passed in URL or query params', async () => {
  let capturedUrl = '';
  let capturedHeaders: Record<string, string> = {};

  const mockFetch: typeof fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedHeaders = (init?.headers as Record<string, string>) ?? {};
    return new Response(
      createMockReadableStream([
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\n',
      ]),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    );
  };

  const ctx = makeContext({
    apiKey: fakeApiKey,
    options: { fetchFn: mockFetch },
  });

  await anthropicAdapter.stream(mockPayload, ctx);

  assert.strictEqual(capturedUrl, 'https://api.anthropic.com/v1/messages');
  assert.strictEqual(capturedUrl.includes(fakeApiKey), false);
  assert.strictEqual(capturedHeaders['x-api-key'], fakeApiKey);
});

test('ADAPTER-13: no provider-specific error leaks and mapProviderError scrubs keys', () => {
  const errWithKey = new ProviderHttpError(401, `Failed with key ${fakeApiKey}`);
  const mapped = mapProviderError(errWithKey, fakeApiKey);

  assert.strictEqual(mapped.code, 'HTTP_ERROR');
  assert.strictEqual(mapped.message.includes(fakeApiKey), false);
  assert.ok(mapped.message.includes('[REDACTED]'));

  const unsupported = new UnsupportedProviderError('unknown-ai');
  const mappedUnsupported = mapProviderError(unsupported);
  assert.strictEqual(mappedUnsupported.code, 'UNSUPPORTED_PROVIDER');
});

test('ADAPTER-14: model discovery returns sorted available models', async () => {
  let requestedHeaders: Record<string, string> = {};
  const mockFetch: typeof fetch = async (_url, init) => {
    requestedHeaders = (init?.headers as Record<string, string>) ?? {};
    return new Response(
      JSON.stringify({
        data: [
          { id: 'claude-3-5-sonnet-20241022' },
          { id: 'claude-3-5-haiku-20241022' },
          { id: 'claude-3-opus-20240229' },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  assert.ok(anthropicAdapter.listModels);
  const result = await anthropicAdapter.listModels({
    apiKey: fakeApiKey,
    fetchFn: mockFetch,
  });

  assert.strictEqual(result.ok, true);
  if (result.ok) {
    assert.deepStrictEqual(result.models, [
      'claude-3-5-haiku-20241022',
      'claude-3-5-sonnet-20241022',
      'claude-3-opus-20240229',
    ]);
  }
  assert.strictEqual(requestedHeaders['x-api-key'], fakeApiKey);
});
