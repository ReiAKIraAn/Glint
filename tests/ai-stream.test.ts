import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchProviderStream,
  ProviderError,
  ProviderHttpError,
  ProviderNetworkError,
  ProviderTimeoutError,
  ProviderAbortError,
  ProviderProtocolError,
  ProviderResponseTooLargeError,
  MAX_RESPONSE_CHARS,
  type AiStreamPayload,
} from '../src/lib/provider-network';
import { DEFAULT_SETTINGS, type Settings } from '../src/lib/types';

/**
 * [Milestone 4 Step 1 Automated Test Suite - OpenAI SSE Stream Network Layer]
 * 严格覆盖 28+ 项场景：
 * A. SSE parsing (1-8)
 * B. Event filtering (9-12)
 * C. HTTP (13-16)
 * D. Abort & Timeout (17-20)
 * E. Response limit (21-24)
 * F. Security (25-28)
 * G. Additional edge cases (29-30)
 */

const TEST_KEY = 'sk-proj-test-token-valid-mock-key-123456';
const OPENAI_SETTINGS: Settings = { ...DEFAULT_SETTINGS, provider: 'openai' };
const DEFAULT_PAYLOAD: AiStreamPayload = {
  word: 'sediment',
  lemma: 'sediment',
  sentence: 'Sediment is a solid material that settles at the bottom of a liquid.',
};

function createMockSseResponse(chunks: (string | Uint8Array)[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        if (typeof chunk === 'string') {
          controller.enqueue(encoder.encode(chunk));
        } else {
          controller.enqueue(chunk);
        }
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function sseDelta(text: string): string {
  return `data: {"choices":[{"delta":{"content":${JSON.stringify(text)}}}]}\n\n`;
}

// ============================================================================
// A. SSE Parsing
// ============================================================================

test('1. 单个 content_block_delta 正常解析并分发', async () => {
  const chunks: string[] = [];
  const mockFetch: typeof fetch = async () =>
    createMockSseResponse([sseDelta('沉淀物')]);

  await fetchProviderStream(
    OPENAI_SETTINGS,
    TEST_KEY,
    DEFAULT_PAYLOAD,
    undefined,
    (delta) => chunks.push(delta),
    { fetchFn: mockFetch },
  );

  assert.deepStrictEqual(chunks, ['沉淀物']);
});

test('2. 多个连续 delta 顺序组装', async () => {
  const chunks: string[] = [];
  const mockFetch: typeof fetch = async () =>
    createMockSseResponse([
      sseDelta('Sediment '),
      sseDelta('refers '),
      sseDelta('to matter.'),
    ]);

  await fetchProviderStream(
    OPENAI_SETTINGS,
    TEST_KEY,
    DEFAULT_PAYLOAD,
    undefined,
    (delta) => chunks.push(delta),
    { fetchFn: mockFetch },
  );

  assert.deepStrictEqual(chunks, ['Sediment ', 'refers ', 'to matter.']);
  assert.strictEqual(chunks.join(''), 'Sediment refers to matter.');
});

test('3. 一个 network chunk 包含多个 SSE event', async () => {
  const chunks: string[] = [];
  const combined = sseDelta('Part 1 ') + sseDelta('Part 2 ') + sseDelta('Part 3');
  const mockFetch: typeof fetch = async () => createMockSseResponse([combined]);

  await fetchProviderStream(
    OPENAI_SETTINGS,
    TEST_KEY,
    DEFAULT_PAYLOAD,
    undefined,
    (delta) => chunks.push(delta),
    { fetchFn: mockFetch },
  );

  assert.deepStrictEqual(chunks, ['Part 1 ', 'Part 2 ', 'Part 3']);
});

test('4. 一个 SSE event 跨多个 network chunk 拆分传输', async () => {
  const chunks: string[] = [];
  const fullEvent = sseDelta('Complete chunk content');
  // 切分为 3 个小片段
  const part1 = fullEvent.slice(0, 15);
  const part2 = fullEvent.slice(15, 40);
  const part3 = fullEvent.slice(40);

  const mockFetch: typeof fetch = async () =>
    createMockSseResponse([part1, part2, part3]);

  await fetchProviderStream(
    OPENAI_SETTINGS,
    TEST_KEY,
    DEFAULT_PAYLOAD,
    undefined,
    (delta) => chunks.push(delta),
    { fetchFn: mockFetch },
  );

  assert.deepStrictEqual(chunks, ['Complete chunk content']);
});

test('5. UTF-8 多字节字符跨 network chunk 拆分 (无乱码)', async () => {
  const chunks: string[] = [];
  const encoder = new TextEncoder();
  // "测试生词" 在 UTF-8 中每个汉字 3 个字节
  const eventStr = sseDelta('测试生词');
  const fullBytes = encoder.encode(eventStr);

  // 寻找中文字符在 bytes 中的位置并将其从中间截断
  const midIndex = Math.floor(fullBytes.length / 2);
  const chunk1 = fullBytes.slice(0, midIndex);
  const chunk2 = fullBytes.slice(midIndex);

  const mockFetch: typeof fetch = async () =>
    createMockSseResponse([chunk1, chunk2]);

  await fetchProviderStream(
    OPENAI_SETTINGS,
    TEST_KEY,
    DEFAULT_PAYLOAD,
    undefined,
    (delta) => chunks.push(delta),
    { fetchFn: mockFetch },
  );

  assert.strictEqual(chunks.join(''), '测试生词');
});

test('6. 多行、空行与 SSE 注释行 (: ping) 安全处理', async () => {
  const chunks: string[] = [];
  const streamData = [
    ': ping\n\n',
    '\n\n\n',
    sseDelta('Word 1'),
    '\r\n\r\n',
    ': another comment\r\n\r\n',
    sseDelta('Word 2'),
  ];

  const mockFetch: typeof fetch = async () =>
    createMockSseResponse(streamData);

  await fetchProviderStream(
    OPENAI_SETTINGS,
    TEST_KEY,
    DEFAULT_PAYLOAD,
    undefined,
    (delta) => chunks.push(delta),
    { fetchFn: mockFetch },
  );

  assert.deepStrictEqual(chunks, ['Word 1', 'Word 2']);
});

test('7. stream 正常结束并处理 message_stop 与 [DONE]', async () => {
  const chunks: string[] = [];
  const streamData = [
    sseDelta('Content'),
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":10}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    'data: [DONE]\n\n',
  ];

  const mockFetch: typeof fetch = async () =>
    createMockSseResponse(streamData);

  await fetchProviderStream(
    OPENAI_SETTINGS,
    TEST_KEY,
    DEFAULT_PAYLOAD,
    undefined,
    (delta) => chunks.push(delta),
    { fetchFn: mockFetch },
  );

  assert.deepStrictEqual(chunks, ['Content']);
});

test('8. 最后一个 event 没有额外 newline 也必须正确解析', async () => {
  const chunks: string[] = [];
  // 尾部不加 \n\n
  const rawNoTrailing = sseDelta('No trailing newline').replace(/\n\n$/, '');

  const mockFetch: typeof fetch = async () =>
    createMockSseResponse([rawNoTrailing]);

  await fetchProviderStream(
    OPENAI_SETTINGS,
    TEST_KEY,
    DEFAULT_PAYLOAD,
    undefined,
    (delta) => chunks.push(delta),
    { fetchFn: mockFetch },
  );

  assert.deepStrictEqual(chunks, ['No trailing newline']);
});

// ============================================================================
// B. Event Filtering
// ============================================================================

test('9. content_block_delta 文本增量分发给 onChunk', async () => {
  const chunks: string[] = [];
  const mockFetch: typeof fetch = async () =>
    createMockSseResponse([sseDelta('Delta text')]);

  await fetchProviderStream(
    OPENAI_SETTINGS,
    TEST_KEY,
    DEFAULT_PAYLOAD,
    undefined,
    (delta) => chunks.push(delta),
    { fetchFn: mockFetch },
  );

  assert.strictEqual(chunks.length, 1);
  assert.strictEqual(chunks[0], 'Delta text');
});

test('10. 非文本 event 不产生用户文本', async () => {
  const chunks: string[] = [];
  const events = [
    ': ping\n\n',
    'data: {"id":"chatcmpl-1","choices":[]}\n\n',
    'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{}}]}\n\n',
    sseDelta('Real text'),
    'data: [DONE]\n\n',
  ];

  const mockFetch: typeof fetch = async () => createMockSseResponse(events);

  await fetchProviderStream(
    OPENAI_SETTINGS,
    TEST_KEY,
    DEFAULT_PAYLOAD,
    undefined,
    (delta) => chunks.push(delta),
    { fetchFn: mockFetch },
  );

  assert.deepStrictEqual(chunks, ['Real text']);
});

test('11. 未知 event 安全忽略不崩溃', async () => {
  const chunks: string[] = [];
  const events = [
    'event: unknown_future_event\ndata: {"custom_field":"val"}\n\n',
    sseDelta('Text after unknown event'),
  ];

  const mockFetch: typeof fetch = async () => createMockSseResponse(events);

  await fetchProviderStream(
    OPENAI_SETTINGS,
    TEST_KEY,
    DEFAULT_PAYLOAD,
    undefined,
    (delta) => chunks.push(delta),
    { fetchFn: mockFetch },
  );

  assert.deepStrictEqual(chunks, ['Text after unknown event']);
});

test('12. data 包含 malformed JSON 时抛出 ProviderProtocolError', async () => {
  const events = [
    'data: {unclosed_invalid_json\n\n',
  ];

  const mockFetch: typeof fetch = async () => createMockSseResponse(events);

  await assert.rejects(
    () =>
      fetchProviderStream(
        OPENAI_SETTINGS,
        TEST_KEY,
        DEFAULT_PAYLOAD,
        undefined,
        () => {},
        { fetchFn: mockFetch },
      ),
    (err: unknown) => {
      assert(err instanceof ProviderProtocolError);
      assert.strictEqual(err.name, 'ProviderProtocolError');
      assert(err.message.includes('无法解析的 SSE 数据'));
      return true;
    },
  );
});

// ============================================================================
// C. HTTP Errors
// ============================================================================

test('13. HTTP 200 正常流式返回', async () => {
  let capturedHeaders: Record<string, string> = {};
  const mockFetch: typeof fetch = async (_, init) => {
    capturedHeaders = (init?.headers as Record<string, string>) ?? {};
    return createMockSseResponse([sseDelta('Success')]);
  };

  await fetchProviderStream(
    OPENAI_SETTINGS,
    TEST_KEY,
    DEFAULT_PAYLOAD,
    undefined,
    () => {},
    { fetchFn: mockFetch },
  );

  assert.strictEqual(capturedHeaders['authorization'], `Bearer ${TEST_KEY}`);
  assert.strictEqual(capturedHeaders['content-type'], 'application/json');
});

test('14. HTTP 401 抛出 ProviderHttpError 并脱敏', async () => {
  const mockFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        error: { message: `Invalid key ${TEST_KEY}` },
      }),
      { status: 401 },
    );

  await assert.rejects(
    () =>
      fetchProviderStream(
        OPENAI_SETTINGS,
        TEST_KEY,
        DEFAULT_PAYLOAD,
        undefined,
        () => {},
        { fetchFn: mockFetch },
      ),
    (err: unknown) => {
      assert(err instanceof ProviderHttpError);
      assert.strictEqual(err.status, 401);
      assert.strictEqual(err.name, 'ProviderHttpError');
      assert.strictEqual(err.message.includes(TEST_KEY), false, '错误信息不得泄露 Key');
      assert(err.message.includes('401'));
      return true;
    },
  );
});

test('15. HTTP 429 限流抛出 ProviderHttpError', async () => {
  const mockFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        type: 'error',
        error: { type: 'rate_limit_error', message: 'Rate limit exceeded' },
      }),
      { status: 429 },
    );

  await assert.rejects(
    () =>
      fetchProviderStream(
        OPENAI_SETTINGS,
        TEST_KEY,
        DEFAULT_PAYLOAD,
        undefined,
        () => {},
        { fetchFn: mockFetch },
      ),
    (err: unknown) => {
      assert(err instanceof ProviderHttpError);
      assert.strictEqual(err.status, 429);
      assert(err.message.includes('429'));
      return true;
    },
  );
});

test('16. HTTP 500 / 503 服务端异常抛出 ProviderHttpError', async () => {
  const mockFetch: typeof fetch = async () =>
    new Response('Internal Server Error', { status: 503 });

  await assert.rejects(
    () =>
      fetchProviderStream(
        OPENAI_SETTINGS,
        TEST_KEY,
        DEFAULT_PAYLOAD,
        undefined,
        () => {},
        { fetchFn: mockFetch },
      ),
    (err: unknown) => {
      assert(err instanceof ProviderHttpError);
      assert.strictEqual(err.status, 503);
      assert(err.message.includes('503'));
      return true;
    },
  );
});

// ============================================================================
// D. Abort & Timeout
// ============================================================================

test('17. 调用者 AbortSignal 触发时 fetch/reader 停止并抛出 ProviderAbortError', async () => {
  const controller = new AbortController();

  const mockFetch: typeof fetch = async (_, init) => {
    const stream = new ReadableStream<Uint8Array>({
      async start(ctrl) {
        ctrl.enqueue(new TextEncoder().encode(sseDelta('Chunk 1')));
        // 等待外部取消
        await new Promise((r) => setTimeout(r, 20));
        ctrl.enqueue(new TextEncoder().encode(sseDelta('Chunk 2')));
        ctrl.close();
      },
    });
    // 监听 init signal
    init?.signal?.addEventListener('abort', () => {
      // 模拟底层 abort
    });
    return new Response(stream, { status: 200 });
  };

  const chunks: string[] = [];
  const promise = fetchProviderStream(
    OPENAI_SETTINGS,
    TEST_KEY,
    DEFAULT_PAYLOAD,
    controller.signal,
    (delta) => {
      chunks.push(delta);
      // 收到第 1 个 chunk 后主动 abort
      controller.abort();
    },
    { fetchFn: mockFetch },
  );

  await assert.rejects(
    () => promise,
    (err: unknown) => {
      assert(err instanceof ProviderAbortError);
      assert.strictEqual(err.name, 'ProviderAbortError');
      return true;
    },
  );
});

test('18. abort 之后绝不再调用 onChunk', async () => {
  const controller = new AbortController();
  const chunks: string[] = [];

  const mockFetch: typeof fetch = async () => {
    return createMockSseResponse([
      sseDelta('Initial'),
      sseDelta('After abort 1'),
      sseDelta('After abort 2'),
    ]);
  };

  const promise = fetchProviderStream(
    OPENAI_SETTINGS,
    TEST_KEY,
    DEFAULT_PAYLOAD,
    controller.signal,
    (delta) => {
      chunks.push(delta);
      controller.abort();
    },
    { fetchFn: mockFetch },
  );

  await assert.rejects(() => promise, ProviderAbortError);
  assert.strictEqual(chunks.length, 1);
  assert.strictEqual(chunks[0], 'Initial');
});

test('19. timeout 发生时抛出 ProviderTimeoutError', async () => {
  const mockFetch: typeof fetch = async (_, init) => {
    // 模拟挂起不返回
    return new Promise((_, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation timed out.', 'TimeoutError'));
      });
    });
  };

  await assert.rejects(
    () =>
      fetchProviderStream(
        OPENAI_SETTINGS,
        TEST_KEY,
        DEFAULT_PAYLOAD,
        undefined,
        () => {},
        { fetchFn: mockFetch, timeoutMs: 30 },
      ),
    (err: unknown) => {
      assert(err instanceof ProviderTimeoutError);
      assert.strictEqual(err.name, 'ProviderTimeoutError');
      assert(err.message.includes('超时'));
      return true;
    },
  );
});

test('20. 正常完成时 timeout timer 被彻底清理 (无挂起 timer)', async () => {
  const mockFetch: typeof fetch = async () =>
    createMockSseResponse([sseDelta('Done quickly')]);

  // timeout 设置为较长时间，如果未被清理，测试进程将被挂起
  await fetchProviderStream(
    OPENAI_SETTINGS,
    TEST_KEY,
    DEFAULT_PAYLOAD,
    undefined,
    () => {},
    { fetchFn: mockFetch, timeoutMs: 60_000 },
  );
  // 能执行到此行说明正常返回并清理了 timer
  assert.ok(true);
});

// ============================================================================
// E. Response Size Limit (MAX_RESPONSE_CHARS = 4000)
// ============================================================================

test('21. response < 4000 字符正常完成', async () => {
  const text = 'a'.repeat(3990);
  const chunks: string[] = [];
  const mockFetch: typeof fetch = async () =>
    createMockSseResponse([sseDelta(text)]);

  await fetchProviderStream(
    OPENAI_SETTINGS,
    TEST_KEY,
    DEFAULT_PAYLOAD,
    undefined,
    (delta) => chunks.push(delta),
    { fetchFn: mockFetch },
  );

  assert.strictEqual(chunks.join('').length, 3990);
});

test('22. response == 4000 字符正好到达上限正常完成', async () => {
  const text = 'b'.repeat(MAX_RESPONSE_CHARS);
  const chunks: string[] = [];
  const mockFetch: typeof fetch = async () =>
    createMockSseResponse([sseDelta(text)]);

  await fetchProviderStream(
    OPENAI_SETTINGS,
    TEST_KEY,
    DEFAULT_PAYLOAD,
    undefined,
    (delta) => chunks.push(delta),
    { fetchFn: mockFetch },
  );

  assert.strictEqual(chunks.join('').length, MAX_RESPONSE_CHARS);
});

test('23. response > 4000 字符时按冻结策略截断剩余字符并抛出 ProviderResponseTooLargeError', async () => {
  // 当前 3995 字符，后续追加 20 字符
  const chunk1 = 'x'.repeat(3995);
  const chunk2 = 'y'.repeat(20);
  const received: string[] = [];

  const mockFetch: typeof fetch = async () =>
    createMockSseResponse([sseDelta(chunk1), sseDelta(chunk2)]);

  await assert.rejects(
    () =>
      fetchProviderStream(
        OPENAI_SETTINGS,
        TEST_KEY,
        DEFAULT_PAYLOAD,
        undefined,
        (delta) => received.push(delta),
        { fetchFn: mockFetch },
      ),
    (err: unknown) => {
      assert(err instanceof ProviderResponseTooLargeError);
      assert.strictEqual(err.name, 'ProviderResponseTooLargeError');
      assert(err.message.includes('4000 字符') || err.message.includes('超出长度限制'));
      return true;
    },
  );

  // 严格验证：总接收字符数正好被截断在 4000 字符，没有把超额的 15 字符漏出去
  const fullText = received.join('');
  assert.strictEqual(fullText.length, 4000);
  assert.strictEqual(fullText.slice(3995), 'yyyyy'); // 恰好只取了前 5 个 'y'
});

test('24. 单个超大 delta (4010 字符) 跨越 4000 边界：截取前 4000 字符并立即超限报错', async () => {
  const hugeText = 'z'.repeat(4010);
  const received: string[] = [];

  const mockFetch: typeof fetch = async () =>
    createMockSseResponse([sseDelta(hugeText)]);

  await assert.rejects(
    () =>
      fetchProviderStream(
        OPENAI_SETTINGS,
        TEST_KEY,
        DEFAULT_PAYLOAD,
        undefined,
        (delta) => received.push(delta),
        { fetchFn: mockFetch },
      ),
    (err: unknown) => {
      assert(err instanceof ProviderResponseTooLargeError);
      return true;
    },
  );

  assert.strictEqual(received.join('').length, 4000);
});

// ============================================================================
// F. Security
// ============================================================================

test('25. API Key 绝不出现在请求 URL 中', async () => {
  let requestedUrl = '';
  const mockFetch: typeof fetch = async (url) => {
    requestedUrl = String(url);
    return createMockSseResponse([sseDelta('OK')]);
  };

  await fetchProviderStream(
    OPENAI_SETTINGS,
    TEST_KEY,
    DEFAULT_PAYLOAD,
    undefined,
    () => {},
    { fetchFn: mockFetch },
  );

  assert.strictEqual(requestedUrl, 'https://api.openai.com/v1/chat/completions');
  assert.strictEqual(requestedUrl.includes(TEST_KEY), false);
  assert.strictEqual(requestedUrl.includes('key='), false);
});

test('26. API Key 绝不出现在 Error message 中 (包括网络报错与服务端回显)', async () => {
  const mockFetch: typeof fetch = async () => {
    throw new Error(`Failed to connect with secret key: ${TEST_KEY}`);
  };

  await assert.rejects(
    () =>
      fetchProviderStream(
        OPENAI_SETTINGS,
        TEST_KEY,
        DEFAULT_PAYLOAD,
        undefined,
        () => {},
        { fetchFn: mockFetch },
      ),
    (err: unknown) => {
      assert(err instanceof ProviderNetworkError);
      assert.strictEqual(err.message.includes(TEST_KEY), false, 'Error message 绝不可包含 API Key');
      assert(err.message.includes('[REDACTED]'), '敏感 Key 必须被脱敏屏蔽');
      return true;
    },
  );
});

test('27. API Key 绝不出现在测试输出与日志中', async () => {
  const logged: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args: unknown[]) => logged.push(args.map(String).join(' '));
  console.error = (...args: unknown[]) => logged.push(args.map(String).join(' '));

  try {
    const mockFetch: typeof fetch = async () => createMockSseResponse([sseDelta('Normal')]);
    await fetchProviderStream(
      OPENAI_SETTINGS,
      TEST_KEY,
      DEFAULT_PAYLOAD,
      undefined,
      () => {},
      { fetchFn: mockFetch },
    );

    for (const line of logged) {
      assert.strictEqual(line.includes(TEST_KEY), false);
    }
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
});

test('28. 恶意 Provider 响应 (<script> 或越狱代码) 作为纯字符串返回，不执行任何代码', async () => {
  const maliciousText = '<script>alert("XSS")</script><img src=x onerror=alert(1)>';
  const received: string[] = [];

  const mockFetch: typeof fetch = async () =>
    createMockSseResponse([sseDelta(maliciousText)]);

  await fetchProviderStream(
    OPENAI_SETTINGS,
    TEST_KEY,
    DEFAULT_PAYLOAD,
    undefined,
    (delta) => received.push(delta),
    { fetchFn: mockFetch },
  );

  assert.strictEqual(received.join(''), maliciousText);
});

// ============================================================================
// G. Additional Edge Cases
// ============================================================================

test('29. 空流响应 (Empty Stream) 抛出 ProviderProtocolError', async () => {
  const mockFetch: typeof fetch = async () => createMockSseResponse([]);

  await assert.rejects(
    () =>
      fetchProviderStream(
        OPENAI_SETTINGS,
        TEST_KEY,
        DEFAULT_PAYLOAD,
        undefined,
        () => {},
        { fetchFn: mockFetch },
      ),
    (err: unknown) => {
      assert(err instanceof ProviderProtocolError);
      assert(err.message.includes('未返回任何文本内容'));
      return true;
    },
  );
});

test('30. Provider 流式错误事件 (event: error) 抛出 ProviderProtocolError 并脱敏', async () => {
  const errorEvent = `data: {"error":{"message":"OpenAI overloaded with key ${TEST_KEY}"}}\n\n`;

  const mockFetch: typeof fetch = async () =>
    createMockSseResponse([errorEvent]);

  await assert.rejects(
    () =>
      fetchProviderStream(
        OPENAI_SETTINGS,
        TEST_KEY,
        DEFAULT_PAYLOAD,
        undefined,
        () => {},
        { fetchFn: mockFetch },
      ),
    (err: unknown) => {
      assert(err instanceof ProviderProtocolError);
      assert.strictEqual(err.message.includes(TEST_KEY), false);
      assert(err.message.includes('[REDACTED]'));
      return true;
    },
  );
});
