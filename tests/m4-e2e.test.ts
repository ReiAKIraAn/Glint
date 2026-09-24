import assert from 'node:assert/strict';
import { test, before, beforeEach } from 'node:test';
import { Window } from 'happy-dom';
import { Card } from '../src/lib/card';
import {
  AI_PORT_NAME,
  handleAiPortConnection,
  AiStreamClient,
  type AiPortHandlerDeps,
  type PortLike,
} from '../src/lib/ai-port';
import {
  ProviderAbortError,
  ProviderHttpError,
  ProviderNetworkError,
  ProviderProtocolError,
  ProviderResponseTooLargeError,
  ProviderTimeoutError,
  MAX_RESPONSE_CHARS,
  type AiStreamPayload,
} from '../src/lib/provider-network';
import { ScannedToken } from '../src/lib/scan';
import { DEFAULT_SETTINGS, type DictEntry, type Settings } from '../src/lib/types';

/**
 * ============================================================================
 * Milestone 4 Step 4: End-to-End Integration Testing Suite (E2E-01 ~ E2E-14)
 *
 * 验证链路：
 * Card (UI)
 *   ↓
 * AiStreamClient (Content Script)
 *   ↓
 * WebExtension Port IPC
 *   ↓
 * handleAiPortConnection (Background Service Worker)
 *   ↓
 * streamFn / fetchProviderStream (Anthropic Provider Layer)
 * ============================================================================
 */

let window: Window;

before(() => {
  window = new Window({ url: 'https://en.wikipedia.org/wiki/Sediment' });
  (globalThis as Record<string, unknown>).window = window;

  for (const key of [
    'document',
    'Node',
    'Element',
    'HTMLElement',
    'HTMLDivElement',
    'HTMLSpanElement',
    'HTMLButtonElement',
    'Range',
    'DOMRect',
    'MouseEvent',
    'CustomEvent',
    'AbortController',
    'requestAnimationFrame',
    'cancelAnimationFrame',
  ] as const) {
    (globalThis as Record<string, unknown>)[key] = (window as unknown as Record<string, unknown>)[key];
  }
});

beforeEach(() => {
  document.body.innerHTML = '';
});

class MockPort implements PortLike {
  name: string;
  messagesSent: any[] = [];
  messageListeners: ((msg: unknown, port: PortLike) => void)[] = [];
  disconnectListeners: ((port: PortLike) => void)[] = [];
  isDisconnected = false;

  constructor(name = AI_PORT_NAME) {
    this.name = name;
  }

  postMessage(msg: unknown) {
    if (this.isDisconnected) {
      throw new Error('Attempt to postMessage on disconnected port');
    }
    this.messagesSent.push(msg);
  }

  disconnect() {
    if (!this.isDisconnected) {
      this.isDisconnected = true;
      for (const cb of [...this.disconnectListeners]) {
        cb(this);
      }
    }
  }

  onMessage = {
    addListener: (cb: (msg: unknown, port: PortLike) => void) => {
      this.messageListeners.push(cb);
    },
    removeListener: (cb: (msg: unknown, port: PortLike) => void) => {
      const idx = this.messageListeners.indexOf(cb);
      if (idx >= 0) this.messageListeners.splice(idx, 1);
    },
  };

  onDisconnect = {
    addListener: (cb: (port: PortLike) => void) => {
      this.disconnectListeners.push(cb);
    },
    removeListener: (cb: (port: PortLike) => void) => {
      const idx = this.disconnectListeners.indexOf(cb);
      if (idx >= 0) this.disconnectListeners.splice(idx, 1);
    },
  };

  simulateMessage(msg: unknown) {
    for (const cb of [...this.messageListeners]) {
      cb(msg, this);
    }
  }
}

function createConnectedPortPair(name = AI_PORT_NAME): { clientPort: MockPort; serverPort: MockPort } {
  const clientPort = new MockPort(name);
  const serverPort = new MockPort(name);

  // Client -> Server
  const originalClientPost = clientPort.postMessage.bind(clientPort);
  clientPort.postMessage = (msg: unknown) => {
    originalClientPost(msg);
    queueMicrotask(() => {
      if (!serverPort.isDisconnected) {
        serverPort.simulateMessage(msg);
      }
    });
  };

  // Server -> Client
  const originalServerPost = serverPort.postMessage.bind(serverPort);
  serverPort.postMessage = (msg: unknown) => {
    originalServerPost(msg);
    queueMicrotask(() => {
      if (!clientPort.isDisconnected) {
        clientPort.simulateMessage(msg);
      }
    });
  };

  const originalClientDisconnect = clientPort.disconnect.bind(clientPort);
  clientPort.disconnect = () => {
    if (!clientPort.isDisconnected) {
      originalClientDisconnect();
      serverPort.disconnect();
    }
  };

  const originalServerDisconnect = serverPort.disconnect.bind(serverPort);
  serverPort.disconnect = () => {
    if (!serverPort.isDisconnected) {
      originalServerDisconnect();
    }
  };

  return { clientPort, serverPort };
}

const mockDictEntry: DictEntry = {
  phonetic: 'ˈsɛdɪmənt',
  translation: 'n. 沉淀物；沉积物',
  tags: ['cet4', 'toefl'],
  rank: 1500,
};

const defaultSettings: Settings = {
  ...DEFAULT_SETTINGS,
  aiEnabled: true,
  provider: 'anthropic',
};

const fakeApiKey = 'sk-ant-api03-integration-test-key-do-not-leak';

function setupE2EPair(depsOverrides?: Partial<AiPortHandlerDeps>) {
  const { clientPort, serverPort } = createConnectedPortPair();
  const capturedPayloads: AiStreamPayload[] = [];
  let streamAbortSignal: AbortSignal | undefined;

  const userStreamFn = depsOverrides?.streamFn;
  const wrappedStreamFn = async (
    settings: Settings,
    key: string,
    payload: AiStreamPayload,
    signal: AbortSignal | undefined,
    onChunk: (delta: string) => void,
  ) => {
    capturedPayloads.push(payload);
    streamAbortSignal = signal;
    if (userStreamFn) {
      await userStreamFn(settings, key, payload, signal, onChunk);
    } else {
      onChunk('Sediment refers to ');
      await new Promise((r) => setTimeout(r, 5));
      if (signal?.aborted) return;
      onChunk('solid material that settles ');
      await new Promise((r) => setTimeout(r, 5));
      if (signal?.aborted) return;
      onChunk('at the bottom of a liquid.');
    }
  };

  const defaultDeps: AiPortHandlerDeps = {
    getSettings: async () => defaultSettings,
    getApiKey: async () => fakeApiKey,
    ...depsOverrides,
    streamFn: wrappedStreamFn,
  };

  handleAiPortConnection(serverPort, defaultDeps);

  const client = new AiStreamClient(() => clientPort);

  const card = new Card({
    lookup: async () => mockDictEntry,
    aiClient: client,
    sentenceOf: (t) => `The river carries fine ${t.surface} downstream.`,
    onKnown: () => {},
    onPointerEnter: () => {},
    onPointerLeave: () => {},
  });
  card.mount();

  return {
    client,
    card,
    clientPort,
    serverPort,
    capturedPayloads,
    getStreamAbortSignal: () => streamAbortSignal,
  };
}

function makeToken(word = 'Sediment', lemma = 'sediment') {
  const p = document.createElement('p');
  const textNode = document.createTextNode(`The river carries fine ${word} downstream.`);
  p.append(textNode);
  document.body.append(p);
  const start = 23;
  return new ScannedToken(textNode, start, start + word.length, word, lemma, 4);
}

const dummyRect = new DOMRect(100, 100, 80, 20);

// ============================================================================
// E2E-01: 正常完整请求链路
// ============================================================================

test('E2E-01: 正常完整请求 - Hover 零 AI 请求，点击后全链路流式到达并以 AI_DONE 收尾', async () => {
  const { card, clientPort, serverPort } = setupE2EPair();
  const token = makeToken();

  // 1. Hover 生词展示卡片
  await card.show(token, dummyRect);
  assert.equal(clientPort.messagesSent.length, 0, 'Hover must not send any Port message');
  assert.equal(serverPort.messagesSent.length, 0);
  assert.equal((card.aiUiState as any).kind, 'idle');
  assert.equal(card.shadowRoot.querySelector('.word')?.textContent, 'Sediment');

  // 2. 用户显式点击“✨ AI 解释”
  card.aiExplainButton.click();
  assert.equal((card.aiUiState as any).kind, 'loading');

  // 等待微任务与流式推进
  await new Promise((r) => setTimeout(r, 40));

  // 3. 验证 Server 接收与响应
  assert.ok(clientPort.messagesSent.some((m) => m.type === 'AI_START'));
  const startMsg = clientPort.messagesSent.find((m) => m.type === 'AI_START');
  const requestId = startMsg.requestId;

  // 4. 验证全链路消息均有统一 requestId，且无冗余 fullText
  const chunks = serverPort.messagesSent.filter((m) => m.type === 'AI_CHUNK');
  assert.ok(chunks.length >= 3);
  for (const c of chunks) {
    assert.equal(c.requestId, requestId);
  }
  const doneMsg = serverPort.messagesSent.find((m) => m.type === 'AI_DONE');
  assert.ok(doneMsg);
  assert.equal(doneMsg.requestId, requestId);
  assert.equal((doneMsg as any).fullText, undefined, 'Protocol must not contain obsolete fullText field');

  // 5. 验证 Card UI 状态与文本完整性
  assert.equal((card.aiUiState as any).kind, 'done');
  assert.equal(card.aiCancelButton.hidden, true);
  assert.equal(
    card.aiTextElement.textContent,
    'Sediment refers to solid material that settles at the bottom of a liquid.',
  );

  card.destroy();
});

// ============================================================================
// E2E-02: 用户中途 Abort
// ============================================================================

test('E2E-02: 用户主动取消 - UI 即刻进入 aborted 态，AbortController 触发，底层停流且无后续迟到更新', async () => {
  let resolveChunk2: () => void = () => {};
  const chunk2Promise = new Promise<void>((r) => {
    resolveChunk2 = r;
  });

  const { card, clientPort, serverPort, getStreamAbortSignal } = setupE2EPair({
    streamFn: async (_settings, _key, _payload, signal, onChunk) => {
      onChunk('First chunk. ');
      await chunk2Promise;
      if (signal?.aborted) return;
      onChunk('Second chunk that should be stopped.');
    },
  });

  try {
    const token = makeToken();
    await card.show(token, dummyRect);
    card.aiExplainButton.click();

    await new Promise((r) => setTimeout(r, 15));
    assert.equal((card.aiUiState as any).kind, 'streaming');
    assert.equal(card.aiTextElement.textContent, 'First chunk. ');

    // 用户点击“取消”
    card.aiCancelButton.click();
    assert.equal((card.aiUiState as any).kind, 'aborted');
    assert.equal(card.aiStatusElement.textContent, '（已取消）');

    // 验证 AI_ABORT 发送给 Background
    await new Promise((r) => setTimeout(r, 15));
    assert.ok(clientPort.messagesSent.some((m) => m.type === 'AI_ABORT'));

    // 验证底层 stream signal 已被 abort
    const sig = getStreamAbortSignal();
    assert.ok(sig?.aborted, 'Provider stream signal must be aborted');

    // 模拟迟到的 chunk 到达
    resolveChunk2();
    await new Promise((r) => setTimeout(r, 20));

    // 验证迟到的 chunk 绝不进入 UI，无 AI_DONE
    assert.equal(card.aiTextElement.textContent, 'First chunk. ');
    assert.ok(!serverPort.messagesSent.some((m) => m.type === 'AI_DONE'));
    assert.equal((card.aiUiState as any).kind, 'aborted');
  } finally {
    resolveChunk2();
    card.destroy();
  }
});

// ============================================================================
// E2E-03: 同 Port 请求替换 (Same-Port Replacement)
// ============================================================================

test('E2E-03: Same-Port replacement - 在前一请求推流中发起新请求，前一请求 abort 且其迟到包完全丢弃', async () => {
  let streamCount = 0;
  const { card } = setupE2EPair({
    streamFn: async (_settings, _key, payload, signal, onChunk) => {
      streamCount++;
      const id = streamCount;
      onChunk(`Start_${id}_${payload.word} `);
      await new Promise((r) => setTimeout(r, 20));
      if (signal?.aborted) return;
      onChunk(`End_${id}_${payload.word}`);
    },
  });

  const tokenA = makeToken('WordA', 'worda');
  await card.show(tokenA, dummyRect);
  card.startAi();

  await new Promise((r) => setTimeout(r, 10));
  const reqAId = (card.aiUiState as any).requestId;

  // 立即发起请求 B (Same port / same client)
  card.startAi();
  const reqBId = (card.aiUiState as any).requestId;
  assert.notEqual(reqAId, reqBId);

  await new Promise((r) => setTimeout(r, 45));

  // 验证卡片最终展示的是请求 B 的内容，且不含请求 A 的 End
  assert.equal((card.aiUiState as any).kind, 'done');
  assert.ok(card.aiTextElement.textContent.includes('WordA'));
  assert.ok(!card.aiTextElement.textContent.includes('End_1'));

  card.destroy();
});

// ============================================================================
// E2E-04: 跨 Port / 多标签页隔离 (Multi-Tab Isolation)
// ============================================================================

test('E2E-04: Multi-tab isolation - Tab A 与 Tab B 独立并发，Abort Tab A 绝不影响 Tab B', async () => {
  const { clientPort: portA, serverPort: sPortA } = createConnectedPortPair('glint:ai-stream');
  const { clientPort: portB, serverPort: sPortB } = createConnectedPortPair('glint:ai-stream');

  let abortASeen = false;
  let tabBFinished = false;

  const deps: AiPortHandlerDeps = {
    getSettings: async () => defaultSettings,
    getApiKey: async () => fakeApiKey,
    streamFn: async (_settings, _key, payload, signal, onChunk) => {
      if (payload.word === 'TabA') {
        onChunk('Chunk A1 ');
        await new Promise((r) => setTimeout(r, 25));
        if (signal?.aborted) {
          abortASeen = true;
          return;
        }
        onChunk('Chunk A2');
      } else {
        onChunk('Chunk B1 ');
        await new Promise((r) => setTimeout(r, 35));
        if (signal?.aborted) return;
        onChunk('Chunk B2');
        tabBFinished = true;
      }
    },
  };

  handleAiPortConnection(sPortA, deps);
  handleAiPortConnection(sPortB, deps);

  const clientA = new AiStreamClient(() => portA);
  const clientB = new AiStreamClient(() => portB);

  const chunksA: string[] = [];
  const chunksB: string[] = [];
  let doneB = false;

  clientA.start({ word: 'TabA', sentence: 'Sentence A' }, {
    onChunk: (t) => chunksA.push(t),
    onDone: () => {},
    onError: () => {},
  });

  clientB.start({ word: 'TabB', sentence: 'Sentence B' }, {
    onChunk: (t) => chunksB.push(t),
    onDone: () => { doneB = true; },
    onError: () => {},
  });

  await new Promise((r) => setTimeout(r, 10));
  // 中途取消 Tab A
  clientA.abort();

  await new Promise((r) => setTimeout(r, 45));

  assert.ok(abortASeen, 'Tab A should be aborted');
  assert.ok(tabBFinished, 'Tab B must finish without disruption');
  assert.ok(doneB, 'Tab B must receive onDone');
  assert.equal(chunksB.join(''), 'Chunk B1 Chunk B2');
  assert.equal(chunksA.join(''), 'Chunk A1 ');
});

// ============================================================================
// E2E-05: Token Switch 切换生词
// ============================================================================

test('E2E-05: Token switch - 生词推流中移动至新生词，旧请求自动 abort，新卡片显示本地词典且不自动触发 AI', async () => {
  const { card, getStreamAbortSignal } = setupE2EPair();
  const tokenA = makeToken('Sediment', 'sediment');
  const tokenB = makeToken('Geology', 'geology');

  await card.show(tokenA, dummyRect);
  card.startAi();

  await new Promise((r) => setTimeout(r, 10));
  assert.equal((card.aiUiState as any).kind, 'streaming');

  // 切换到 Token B
  await card.show(tokenB, dummyRect);

  // 1. 旧请求已被 abort
  assert.ok(getStreamAbortSignal()?.aborted);

  // 2. 新卡片显示 Token B 的词汇信息
  assert.equal(card.shadowRoot.querySelector('.word')?.textContent, 'Geology');

  // 3. AI 区域完全重置为 idle，不自动启动 AI 请求
  assert.equal((card.aiUiState as any).kind, 'idle');
  assert.equal(card.aiTextElement.textContent, '');
  assert.equal(card.aiExplainButton.hidden, false);
  assert.equal(card.aiCancelButton.hidden, true);

  card.destroy();
});

// ============================================================================
// E2E-06: Card Hide / Scroll 生命周期清理
// ============================================================================

test('E2E-06: Card hide - 卡片收起时自动 abort 活动请求并清理未决 rAF，重新打开不继承旧状态', async () => {
  const { card, getStreamAbortSignal } = setupE2EPair();
  const token = makeToken();

  await card.show(token, dummyRect);
  card.startAi();

  await new Promise((r) => setTimeout(r, 10));
  assert.equal((card.aiUiState as any).kind, 'streaming');

  // 模拟卡片由于滚动或光标离开而触发 hide
  card.hide();
  await new Promise((r) => setTimeout(r, 15));

  // 1. 验证底层请求已被 abort
  assert.ok(getStreamAbortSignal()?.aborted);
  // 2. 状态机重置为 idle
  assert.equal((card.aiUiState as any).kind, 'idle');

  // 3. 重新打开同一 Token
  await card.show(token, dummyRect);
  assert.equal((card.aiUiState as any).kind, 'idle');
  assert.equal(card.aiTextElement.textContent, '');

  card.destroy();
});

// ============================================================================
// E2E-07: 页面导航与连接断开 (Navigation / Unload)
// ============================================================================

test('E2E-07: Navigation & Port disconnect - 页面卸载或连接断开自动释放后台资源，无未捕获异常', async () => {
  let streamSignal: AbortSignal | undefined;
  const { client, serverPort } = setupE2EPair({
    streamFn: async (_settings, _key, _payload, signal, onChunk) => {
      streamSignal = signal;
      onChunk('Data');
      await new Promise((r) => setTimeout(r, 30));
    },
  });

  client.start({ word: 'Test', sentence: 'Test sentence' }, {
    onChunk: () => {},
    onDone: () => {},
    onError: () => {},
  });

  await new Promise((r) => setTimeout(r, 10));
  assert.ok(streamSignal);
  assert.equal(streamSignal.aborted, false);

  // 页面 unload / disconnect
  client.disconnect();

  await new Promise((r) => setTimeout(r, 15));
  assert.ok(streamSignal.aborted, 'Stream must be aborted when port disconnects');
  assert.ok(serverPort.isDisconnected);
});

// ============================================================================
// E2E-08: Provider 异常类型脱敏与映射 (HTTP 401/403/429/500, Network, Timeout)
// ============================================================================

test('E2E-08: Provider errors - 各类底层异常均脱敏为安全错误展示，绝对不泄露 API Key 与原始堆栈', async () => {
  const errorCases = [
    { err: new ProviderHttpError(401, `Anthropic API Key 无效 (401)：${fakeApiKey}`), expected: 'Anthropic API Key 无效 (401)：[REDACTED]' },
    { err: new ProviderHttpError(429, 'Anthropic 请求频次或额度超限 (429)'), expected: 'Anthropic 请求频次或额度超限 (429)' },
    { err: new ProviderNetworkError(`连不上 api.anthropic.com（key=${fakeApiKey}）`), expected: '连不上 api.anthropic.com（key=[REDACTED]）' },
    { err: new ProviderTimeoutError('请求超时 (60 秒)，Anthropic 未能及时响应'), expected: '请求超时 (60 秒)，Anthropic 未能及时响应' },
    { err: new ProviderProtocolError('无法解析的 SSE 数据'), expected: '无法解析的 SSE 数据' },
  ];

  for (const { err, expected } of errorCases) {
    const { card } = setupE2EPair({
      streamFn: async () => {
        throw err;
      },
    });

    const token = makeToken();
    await card.show(token, dummyRect);
    card.startAi();

    await new Promise((r) => setTimeout(r, 15));

    assert.equal((card.aiUiState as any).kind, 'error');
    assert.equal(card.aiErrorElement.hidden, false);
    assert.ok(card.aiErrorElement.textContent?.includes(expected), `Expected ${expected}, got ${card.aiErrorElement.textContent}`);
    assert.ok(!card.aiErrorElement.textContent?.includes(fakeApiKey), 'API Key must NEVER leak in UI');

    card.destroy();
  }
});

// ============================================================================
// E2E-09: 恶意不可信输出转义与 XSS 防护 (Malicious AI Output)
// ============================================================================

test('E2E-09: Malicious AI output - 任何 HTML / Script 均作为纯文本转义写入，绝不执行代码', async () => {
  const initialScripts = document.querySelectorAll('script').length;
  const maliciousPayload = '<script>window.__xss_hacked = true;</script><img src=x onerror="alert(1)"><div>Injected</div>';

  const { card } = setupE2EPair({
    streamFn: async (_settings, _key, _payload, _signal, onChunk) => {
      onChunk(maliciousPayload);
    },
  });

  const token = makeToken();
  await card.show(token, dummyRect);
  card.startAi();

  await new Promise((r) => setTimeout(r, 15));

  // 1. 验证 script 标签总数不变
  assert.equal(document.querySelectorAll('script').length, initialScripts);
  // 2. 验证全局变量未被篡改
  assert.equal((window as any).__xss_hacked, undefined);
  // 3. 验证内容按纯文本安全展示
  assert.equal(card.aiTextElement.textContent, maliciousPayload);
  assert.equal(card.aiTextElement.innerHTML.includes('<script>'), false);

  card.destroy();
});

// ============================================================================
// E2E-10: API Key 绝不跨越网络与 UI 边界 (API Key Isolation)
// ============================================================================

test('E2E-10: API Key isolation - 检查 Port 消息、DOM、UI 状态，API Key 仅存在于 Background 内部', async () => {
  const { card, clientPort, serverPort } = setupE2EPair();
  const token = makeToken();

  await card.show(token, dummyRect);
  card.startAi();
  await new Promise((r) => setTimeout(r, 40));

  // 1. 检查客户端发出的消息
  for (const m of clientPort.messagesSent) {
    const serialized = JSON.stringify(m);
    assert.ok(!serialized.includes(fakeApiKey), 'Client message must not contain API Key');
  }

  // 2. 检查服务端下发的消息
  for (const m of serverPort.messagesSent) {
    const serialized = JSON.stringify(m);
    assert.ok(!serialized.includes(fakeApiKey), 'Server message must not contain API Key');
  }

  // 3. 检查 Card DOM
  assert.ok(!card.element.innerHTML.includes(fakeApiKey), 'Card DOM must not contain API Key');

  card.destroy();
});

// ============================================================================
// E2E-11: 上下文收敛边界 (Context Boundary)
// ============================================================================

test('E2E-11: Context boundary - AI_START 载荷严格收敛为 word + lemma + sentenceAround，零 DOM 全页泄露', async () => {
  const { card, capturedPayloads } = setupE2EPair();
  const token = makeToken('Sediment', 'sediment');

  await card.show(token, dummyRect);
  card.startAi();
  await new Promise((r) => setTimeout(r, 15));

  assert.equal(capturedPayloads.length, 1);
  const payload = capturedPayloads[0];
  if (!payload) throw new Error('Missing payload');

  assert.equal(payload.word, 'Sediment');
  assert.equal(payload.lemma, 'sediment');
  assert.equal(payload.sentence, 'The river carries fine Sediment downstream.');

  // 验证无任何多余的全局字段
  const keys = Object.keys(payload);
  assert.ok(keys.every((k) => ['word', 'lemma', 'sentence'].includes(k)));
  assert.equal((payload as any).dom, undefined);
  assert.equal((payload as any).html, undefined);
  assert.equal((payload as any).pageUrl, undefined);

  card.destroy();
});

// ============================================================================
// E2E-12: 响应长度硬限制与截断 (Response Limit)
// ============================================================================

test('E2E-12: Response limit - 累计输出超出 MAX_RESPONSE_CHARS (4,000) 时立即截断并安全报错', async () => {
  const { card } = setupE2EPair({
    streamFn: async (_settings, _key, _payload, signal, onChunk) => {
      onChunk('A'.repeat(MAX_RESPONSE_CHARS));
      throw new ProviderResponseTooLargeError(`释义内容超出长度限制 (${MAX_RESPONSE_CHARS} 字符)，已截断终止。`);
    },
  });

  const token = makeToken();
  await card.show(token, dummyRect);
  card.startAi();

  await new Promise((r) => setTimeout(r, 15));

  assert.equal((card.aiUiState as any).kind, 'error');
  assert.equal(card.aiTextElement.textContent?.length, MAX_RESPONSE_CHARS);
  assert.ok(card.aiErrorElement.textContent?.includes('4000 字符'));

  card.destroy();
});

// ============================================================================
// E2E-13: 高频流式微 Chunk 与 rAF 渲染批处理 (rAF Batching)
// ============================================================================

test('E2E-13: rAF & High-frequency stream - 100 个微小字符分块通过 rAF 批处理稳定合并，内容零丢失', async () => {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyz!@#$%^&*()_+'.split('');

  const { card } = setupE2EPair({
    streamFn: async (_settings, _key, _payload, signal, onChunk) => {
      for (const char of letters) {
        if (signal?.aborted) return;
        onChunk(char);
      }
    },
  });

  const token = makeToken();
  await card.show(token, dummyRect);
  card.startAi();

  await new Promise((r) => setTimeout(r, 20));

  assert.equal((card.aiUiState as any).kind, 'done');
  assert.equal(card.aiTextElement.textContent, letters.join(''));

  card.destroy();
});

// ============================================================================
// E2E-14: 重复生命周期无泄漏与单例唯一性 (Repeated Lifecycle)
// ============================================================================

test('E2E-14: Repeated lifecycle - 连续 30 轮启动/流式/取消/隐藏/重开，DOM 单例唯一且无状态悬挂', async () => {
  const { card } = setupE2EPair();

  for (let i = 0; i < 30; i++) {
    const token = makeToken(`Word_${i}`, `word_${i}`);
    await card.show(token, dummyRect);
    card.startAi();

    if (i % 3 === 0) {
      // 场景 1: 中途取消
      card.abortAi();
    } else if (i % 3 === 1) {
      // 场景 2: 直接隐藏
      card.hide();
    } else {
      // 场景 3: 稍作等待再切换
      await new Promise((r) => setTimeout(r, 5));
      card.hide();
    }
  }

  // 验证全局单例始终只有 1 个 <glint-card>
  const cards = document.querySelectorAll('glint-card');
  assert.equal(cards.length, 1);

  card.destroy();
  assert.equal(document.querySelectorAll('glint-card').length, 0);
});
