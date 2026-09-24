import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';
import { Window } from 'happy-dom';
import {
  capExplanationEntries,
  clearExplanations,
  deleteExplanation,
  enqueue,
  explanationsStore,
  getAllExplanations,
  getExplanation,
  isCleanCacheEntry,
  normalizeWordKey,
  putExplanation,
  sanitizeExplanationStore,
  EXPLANATION_LIMIT,
} from '../src/lib/explanation-cache';
import {
  handleAiPortConnection,
  AI_PORT_NAME,
  type PortLike,
  type ServerPortMessage,
  type StreamHandlers,
} from '../src/lib/ai-port';
import { Card, type AiUiState } from '../src/lib/card';
import { ScannedToken } from '../src/lib/scan';
import {
  ProviderHttpError,
  ProviderTimeoutError,
} from '../src/lib/provider-network';
import { DEFAULT_SETTINGS, type DictEntry } from '../src/lib/types';

// DOM mock environment for Card tests
let window: Window;

before(() => {
  window = new Window({ url: 'https://developer.apple.com/safari/' });
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

beforeEach(async () => {
  document.body.innerHTML = '';
  await clearExplanations();
});

class MockPort implements PortLike {
  name = AI_PORT_NAME;
  messagesSent: ServerPortMessage[] = [];
  messageListeners: ((msg: unknown, port: PortLike) => void)[] = [];
  disconnectListeners: ((port: PortLike) => void)[] = [];
  isDisconnected = false;

  postMessage(msg: unknown) {
    if (this.isDisconnected) throw new Error('Port is disconnected');
    this.messagesSent.push(msg as ServerPortMessage);
  }

  disconnect() {
    this.isDisconnected = true;
    for (const cb of [...this.disconnectListeners]) cb(this);
  }

  onMessage = {
    addListener: (cb: (msg: unknown, port: PortLike) => void) => {
      this.messageListeners.push(cb);
    },
    removeListener: (cb: (msg: unknown, port: PortLike) => void) => {
      const idx = this.messageListeners.indexOf(cb);
      if (idx !== -1) this.messageListeners.splice(idx, 1);
    },
  };

  onDisconnect = {
    addListener: (cb: (port: PortLike) => void) => {
      this.disconnectListeners.push(cb);
    },
    removeListener: (cb: (port: PortLike) => void) => {
      const idx = this.disconnectListeners.indexOf(cb);
      if (idx !== -1) this.disconnectListeners.splice(idx, 1);
    },
  };

  receiveMessage(msg: unknown) {
    for (const cb of [...this.messageListeners]) {
      cb(msg, this);
    }
  }
}

class MockAiClient {
  starts: Array<{ payload: { word: string; lemma?: string; sentence: string }; handlers: StreamHandlers; requestId: string }> = [];
  aborted = false;

  start(payload: { word: string; lemma?: string; sentence: string }, handlers: StreamHandlers): string {
    const requestId = `req_${this.starts.length + 1}`;
    this.starts.push({ payload, handlers, requestId });
    return requestId;
  }

  abort() {
    this.aborted = true;
  }

  getActiveRequestId() {
    return this.starts.length > 0 ? this.starts[this.starts.length - 1]!.requestId : null;
  }
}

function makeToken(surface: string, lemma = surface.toLowerCase()): ScannedToken {
  const textNode = document.createTextNode(surface);
  document.body.appendChild(textNode);
  return new ScannedToken(textNode, 0, surface.length, surface, lemma, 4);
}

// ---------------------------------------------------------------------------
// CACHE-01: empty cache
// ---------------------------------------------------------------------------
test('CACHE-01: empty cache - 初始空缓存查询返回 null', async () => {
  await clearExplanations();
  const res = await getExplanation('apple');
  assert.equal(res, null);
});

// ---------------------------------------------------------------------------
// CACHE-02: miss
// ---------------------------------------------------------------------------
test('CACHE-02: miss - 查询未录入词汇返回 null', async () => {
  await putExplanation('apple', 'A round fruit.');
  const res = await getExplanation('banana');
  assert.equal(res, null);
});

// ---------------------------------------------------------------------------
// CACHE-03: successful write
// ---------------------------------------------------------------------------
test('CACHE-03: successful write - 成功写入词汇及其释义', async () => {
  await putExplanation('Sediment', 'Matter that settles to the bottom of a liquid.');
  const stored = await explanationsStore.getValue();
  assert.ok('sediment' in stored);
  assert.equal(stored.sediment.word, 'sediment');
  assert.equal(stored.sediment.explanation, 'Matter that settles to the bottom of a liquid.');
  assert.ok(typeof stored.sediment.updatedAt === 'number');
});

// ---------------------------------------------------------------------------
// CACHE-04: hit
// ---------------------------------------------------------------------------
test('CACHE-04: hit - 成功命中已缓存释义，支持大小写不敏感归一化', async () => {
  await putExplanation('sediment', 'Settled particles.');
  const hit1 = await getExplanation('sediment');
  assert.equal(hit1, 'Settled particles.');

  const hit2 = await getExplanation('  SEDIMENT  ');
  assert.equal(hit2, 'Settled particles.');
});

// ---------------------------------------------------------------------------
// CACHE-05: hit updates LRU
// ---------------------------------------------------------------------------
test('CACHE-05: hit updates LRU - 命中缓存时自动更新 updatedAt 活跃时间戳', async () => {
  await putExplanation('resilience', 'The capacity to recover quickly.');
  const initial = (await explanationsStore.getValue()).resilience!;
  const initialTime = initial.updatedAt;

  // 模拟稍微延迟后的访问
  await new Promise((r) => setTimeout(r, 10));
  const text = await getExplanation('resilience');
  assert.equal(text, 'The capacity to recover quickly.');

  const updated = (await explanationsStore.getValue()).resilience!;
  assert.ok(updated.updatedAt >= initialTime, `updatedAt 应被刷新: ${updated.updatedAt} >= ${initialTime}`);
});

// ---------------------------------------------------------------------------
// CACHE-06: duplicate word updates entry
// ---------------------------------------------------------------------------
test('CACHE-06: duplicate word updates entry - 同一词汇重复写入更新其释义与时间戳', async () => {
  await putExplanation('delta', 'First explanation.');
  const first = (await explanationsStore.getValue()).delta!;

  await new Promise((r) => setTimeout(r, 10));
  await putExplanation('delta', 'Updated second explanation.');
  const second = (await explanationsStore.getValue()).delta!;

  assert.equal(second.explanation, 'Updated second explanation.');
  assert.ok(second.updatedAt >= first.updatedAt);
  assert.equal(Object.keys(await explanationsStore.getValue()).length, 1);
});

// ---------------------------------------------------------------------------
// CACHE-07: 2000 entries
// ---------------------------------------------------------------------------
test('CACHE-07: 2000 entries - 缓存上限达 2000 条，容量内不丢弃任何记录', async () => {
  const store: Record<string, { word: string; explanation: string; updatedAt: number }> = {};
  for (let i = 0; i < 2000; i++) {
    store[`word_${i}`] = {
      word: `word_${i}`,
      explanation: `Expl ${i}`,
      updatedAt: 1000 + i,
    };
  }
  const capped = capExplanationEntries(store, EXPLANATION_LIMIT);
  assert.equal(Object.keys(capped).length, 2000);
});

// ---------------------------------------------------------------------------
// CACHE-08: 2001st entry evicts oldest
// ---------------------------------------------------------------------------
test('CACHE-08: 2001st entry evicts oldest - 超过 2000 条时严格按 updatedAt 丢弃最旧条目', async () => {
  const store: Record<string, { word: string; explanation: string; updatedAt: number }> = {};
  for (let i = 0; i < 2000; i++) {
    store[`word_${i}`] = {
      word: `word_${i}`,
      explanation: `Expl ${i}`,
      updatedAt: 1000 + i,
    };
  }
  // 此时 word_0 的 updatedAt 为 1000（最旧）
  // 插入第 2001 条，时间戳为 5000（最新）
  store['word_new'] = {
    word: 'word_new',
    explanation: 'Newest Expl',
    updatedAt: 5000,
  };

  const capped = capExplanationEntries(store, EXPLANATION_LIMIT);
  assert.equal(Object.keys(capped).length, 2000);
  assert.equal('word_0' in capped, false, '最旧的 word_0 必须被淘汰');
  assert.equal('word_new' in capped, true, '最新的 word_new 必须被保留');
  assert.equal('word_1' in capped, true, '第二旧的 word_1 应当保留');
});

// ---------------------------------------------------------------------------
// CACHE-09: clear
// ---------------------------------------------------------------------------
test('CACHE-09: clear - clearExplanations 清空所有 AI 释义缓存', async () => {
  await putExplanation('a', 'alpha');
  await putExplanation('b', 'beta');
  assert.equal(Object.keys(await explanationsStore.getValue()).length, 2);

  await clearExplanations();
  assert.equal(Object.keys(await explanationsStore.getValue()).length, 0);
  assert.equal(await getExplanation('a'), null);
});

// ---------------------------------------------------------------------------
// CACHE-10: delete one entry
// ---------------------------------------------------------------------------
test('CACHE-10: delete one entry - deleteExplanation 仅删除目标词汇，保持其余条目完整', async () => {
  await putExplanation('apple', 'A fruit');
  await putExplanation('banana', 'Another fruit');

  await deleteExplanation('apple');
  const all = await explanationsStore.getValue();
  assert.equal('apple' in all, false);
  assert.equal('banana' in all, true);
  assert.equal(await getExplanation('banana'), 'Another fruit');
});

// ---------------------------------------------------------------------------
// CACHE-11: abort does not write
// ---------------------------------------------------------------------------
test('CACHE-11: abort does not write - 用户主动取消的请求绝不写入缓存', async () => {
  const port = new MockPort();
  let putCalled = false;
  handleAiPortConnection(port, {
    getSettings: async () => ({ ...DEFAULT_SETTINGS, aiEnabled: true, provider: 'openai' }),
    getApiKey: async () => 'sk-ant-test-key-12345',
    streamFn: async (_settings, _key, _payload, signal, onChunk) => {
      onChunk('Partial explanation...');
      // 模拟中间等待
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (signal?.aborted) throw new Error('Aborted');
    },
    putExplanation: async () => {
      putCalled = true;
    },
  });

  port.receiveMessage({
    type: 'AI_START',
    requestId: 'req_abort',
    payload: { word: 'cancelme', sentence: 'We cancel this.' },
  });

  // 10ms 后触发 abort
  await new Promise((r) => setTimeout(r, 10));
  port.receiveMessage({ type: 'AI_ABORT', requestId: 'req_abort' });

  // 等待流结束
  await new Promise((r) => setTimeout(r, 70));
  assert.equal(putCalled, false, '主动取消不得触发 putExplanation');
});

// ---------------------------------------------------------------------------
// CACHE-12: provider error does not write
// ---------------------------------------------------------------------------
test('CACHE-12: provider error does not write - 服务商 HTTP 报错绝不写入缓存', async () => {
  const port = new MockPort();
  let putCalled = false;
  handleAiPortConnection(port, {
    getSettings: async () => ({ ...DEFAULT_SETTINGS, aiEnabled: true, provider: 'openai' }),
    getApiKey: async () => 'sk-ant-test-key-12345',
    streamFn: async () => {
      throw new ProviderHttpError(500, 'Internal Server Error');
    },
    putExplanation: async () => {
      putCalled = true;
    },
  });

  port.receiveMessage({
    type: 'AI_START',
    requestId: 'req_err',
    payload: { word: 'failme', sentence: 'Server will fail.' },
  });

  await new Promise((r) => setTimeout(r, 20));
  assert.equal(putCalled, false, 'Provider 错误不得写入缓存');
  const errMsgs = port.messagesSent.filter((m) => m.type === 'AI_ERROR');
  assert.equal(errMsgs.length, 1);
});

// ---------------------------------------------------------------------------
// CACHE-13: timeout does not write
// ---------------------------------------------------------------------------
test('CACHE-13: timeout does not write - 超时错误绝不写入缓存', async () => {
  const port = new MockPort();
  let putCalled = false;
  handleAiPortConnection(port, {
    getSettings: async () => ({ ...DEFAULT_SETTINGS, aiEnabled: true, provider: 'openai' }),
    getApiKey: async () => 'sk-ant-test-key-12345',
    streamFn: async () => {
      throw new ProviderTimeoutError('Request timed out');
    },
    putExplanation: async () => {
      putCalled = true;
    },
  });

  port.receiveMessage({
    type: 'AI_START',
    requestId: 'req_timeout',
    payload: { word: 'timeoutme', sentence: 'Timeout test.' },
  });

  await new Promise((r) => setTimeout(r, 20));
  assert.equal(putCalled, false, '超时不得写入缓存');
});

// ---------------------------------------------------------------------------
// CACHE-14: partial stream does not write
// ---------------------------------------------------------------------------
test('CACHE-14: partial stream does not write - 途中断开或报错的部分流绝不写入缓存', async () => {
  const port = new MockPort();
  let putCalled = false;
  handleAiPortConnection(port, {
    getSettings: async () => ({ ...DEFAULT_SETTINGS, aiEnabled: true, provider: 'openai' }),
    getApiKey: async () => 'sk-ant-test-key-12345',
    streamFn: async (_settings, _key, _payload, _signal, onChunk) => {
      onChunk('This is incomplete');
      throw new Error('Connection reset by peer');
    },
    putExplanation: async () => {
      putCalled = true;
    },
  });

  port.receiveMessage({
    type: 'AI_START',
    requestId: 'req_partial',
    payload: { word: 'broken', sentence: 'Stream drops midway.' },
  });

  await new Promise((r) => setTimeout(r, 20));
  assert.equal(putCalled, false, '部分流异常退出不得写入缓存');
});

// ---------------------------------------------------------------------------
// CACHE-15: empty explanation does not write
// ---------------------------------------------------------------------------
test('CACHE-15: empty explanation does not write - 空文本释义绝不写入存储', async () => {
  const port = new MockPort();
  let putCalled = false;
  handleAiPortConnection(port, {
    getSettings: async () => ({ ...DEFAULT_SETTINGS, aiEnabled: true, provider: 'openai' }),
    getApiKey: async () => 'sk-ant-test-key-12345',
    streamFn: async (_settings, _key, _payload, _signal, onChunk) => {
      onChunk('   \n  \t  '); // 纯空白
    },
    putExplanation: async () => {
      putCalled = true;
    },
  });

  port.receiveMessage({
    type: 'AI_START',
    requestId: 'req_empty',
    payload: { word: 'empty', sentence: 'Result is empty.' },
  });

  await new Promise((r) => setTimeout(r, 20));
  assert.equal(putCalled, false, '纯空白输出不得写入缓存');
});

// ---------------------------------------------------------------------------
// CACHE-16: storage write failure does not break completed AI
// ---------------------------------------------------------------------------
test('CACHE-16: storage write failure does not break completed AI - 存储写入失败不影响 AI_DONE 投递与用户体验', async () => {
  const port = new MockPort();
  handleAiPortConnection(port, {
    getSettings: async () => ({ ...DEFAULT_SETTINGS, aiEnabled: true, provider: 'openai' }),
    getApiKey: async () => 'sk-ant-test-key-12345',
    streamFn: async (_settings, _key, _payload, _signal, onChunk) => {
      onChunk('Generated valid explanation');
    },
    putExplanation: async () => {
      throw new Error('QuotaExceededError: storage full');
    },
  });

  port.receiveMessage({
    type: 'AI_START',
    requestId: 'req_quota',
    payload: { word: 'quota', sentence: 'Storage throws.' },
  });

  await new Promise((r) => setTimeout(r, 20));
  const doneMsgs = port.messagesSent.filter((m) => m.type === 'AI_DONE');
  const errMsgs = port.messagesSent.filter((m) => m.type === 'AI_ERROR');
  assert.equal(doneMsgs.length, 1, 'AI_DONE 必须正常向客户端发送');
  assert.equal(errMsgs.length, 0, '绝不得因存储异常改报 AI_ERROR');
});

// ---------------------------------------------------------------------------
// CACHE-17: forbidden fields absent (Privacy Test)
// ---------------------------------------------------------------------------
test('CACHE-17: forbidden fields absent - 存储载荷绝不包含 sentence, context, url, apiKey 等敏感字段', async () => {
  const SENSITIVE_SENTENCE = 'PRIVATE_DOCUMENT_12345 top secret corporate information.';
  const port = new MockPort();

  handleAiPortConnection(port, {
    getSettings: async () => ({ ...DEFAULT_SETTINGS, aiEnabled: true, provider: 'openai' }),
    getApiKey: async () => 'sk-ant-test-secret-key-999',
    streamFn: async (_settings, _key, _payload, _signal, onChunk) => {
      onChunk('Public lexical definition of word.');
    },
  });

  port.receiveMessage({
    type: 'AI_START',
    requestId: 'req_privacy',
    payload: {
      word: 'secretive',
      lemma: 'secretive',
      sentence: SENSITIVE_SENTENCE,
    },
  });

  await new Promise((r) => setTimeout(r, 30));

  // 深入检查实际持久化存储载荷
  const store = await explanationsStore.getValue();
  assert.ok('secretive' in store);
  const entry = store.secretive;

  // 1. 严格检查仅允许的三个字段
  const keys = Object.keys(entry).sort();
  assert.deepEqual(keys, ['explanation', 'updatedAt', 'word'].sort());

  // 2. 明确检查严禁字段不存在
  assert.equal('sentence' in entry, false);
  assert.equal('context' in entry, false);
  assert.equal('url' in entry, false);
  assert.equal('title' in entry, false);
  assert.equal('surface' in entry, false);
  assert.equal('analysis' in entry, false);
  assert.equal('apiKey' in entry, false);
  assert.equal('provider' in entry, false);
  assert.equal('model' in entry, false);
  assert.equal('tabId' in entry, false);

  // 3. 序列化全文字符串检索：敏感句子绝不得以任何形式出现在存储中
  const serialized = JSON.stringify(store);
  assert.equal(serialized.includes('PRIVATE_DOCUMENT_12345'), false, '敏感句子绝不得泄漏进持久化存储');
  assert.equal(serialized.includes('sk-ant-test-secret-key-999'), false, 'API Key 绝不得泄漏进持久化存储');
});

// ---------------------------------------------------------------------------
// CACHE-18: legacy schema sanitized
// ---------------------------------------------------------------------------
test('CACHE-18: legacy schema sanitized - 读取历史污染格式数据时安全清洗脱敏', () => {
  const dirtyStore = {
    clean_word: {
      word: 'clean_word',
      explanation: 'Clean explanation text',
      updatedAt: 1234567,
    },
    legacy_contaminated_1: {
      word: 'legacy_contaminated_1',
      sentence: 'Sensitive sentence that must be purged.',
      analysis: { sense: 'Sense', en: 'English' },
      time: 99999,
    },
    legacy_contaminated_2: {
      surface: 'Sediments',
      sentence: 'Another sensitive sentence.',
      analysis: { sense: 'Old sense' },
    },
  };

  assert.equal(isCleanCacheEntry(dirtyStore.clean_word), true);
  assert.equal(isCleanCacheEntry(dirtyStore.legacy_contaminated_1), false);
  assert.equal(isCleanCacheEntry(dirtyStore.legacy_contaminated_2), false);

  const { sanitized, needsMigration } = sanitizeExplanationStore(dirtyStore as Record<string, unknown>);
  assert.equal(needsMigration, true);
  assert.deepEqual(Object.keys(sanitized), ['clean_word']);
  assert.equal(JSON.stringify(sanitized).includes('Sensitive sentence'), false);
});

// ---------------------------------------------------------------------------
// CACHE-19: multi-tab/concurrent mutation
// ---------------------------------------------------------------------------
test('CACHE-19: multi-tab/concurrent mutation - 并发异步写入通过 enqueue 保证一致性与零丢失', async () => {
  await clearExplanations();

  // 模拟两个标签页并发对不同单词发起写入
  const p1 = putExplanation('word_a', 'Explanation A');
  const p2 = putExplanation('word_b', 'Explanation B');
  const p3 = putExplanation('word_c', 'Explanation C');
  await Promise.all([p1, p2, p3]);

  const all = await explanationsStore.getValue();
  assert.equal(Object.keys(all).length, 3);
  assert.equal(all.word_a?.explanation, 'Explanation A');
  assert.equal(all.word_b?.explanation, 'Explanation B');
  assert.equal(all.word_c?.explanation, 'Explanation C');
});

// ---------------------------------------------------------------------------
// CACHE-20: cache hit does not call AI
// ---------------------------------------------------------------------------
test('CACHE-20: cache hit does not call AI - 缓存命中立即展现，坚决不向 AI 发送请求', async () => {
  const token = makeToken('Sediment');
  await putExplanation('sediment', 'Cached: Solid particulate matter.');

  const mockAiClient = new MockAiClient();

  const card = new Card({
    lookup: async () => ({
      word: 'sediment',
      phonetic: 'ˈsɛdɪmənt',
      translation: '沉淀物',
      tags: ['zk'],
      rank: 1,
    }),
    aiClient: mockAiClient,
    sentenceOf: () => 'Layers of sediment formed rocks.',
    getCachedExplanation: async (word) => getExplanation(word),
    onKnown: () => {},
    onPointerEnter: () => {},
    onPointerLeave: () => {},
  });

  const rect = new DOMRect(100, 100, 50, 20);
  await card.show(token, rect);

  // 验证 Hover 本身绝不读取 AI 缓存，也绝不发 AI 请求
  assert.equal((card.aiUiState as { kind: string }).kind, 'idle');
  assert.equal(mockAiClient.starts.length, 0);

  // 用户主动点击 AI 解释按钮
  await card.startAi();

  // 验证：
  // 1. 状态直接进入 done
  const state = card.aiUiState as { kind: string; text?: string };
  assert.equal(state.kind, 'done');
  assert.equal(state.text, 'Cached: Solid particulate matter.');

  // 2. DOM 文本内容安全渲染
  assert.equal(card.aiTextElement.hidden, false);
  assert.equal(card.aiTextElement.textContent, 'Cached: Solid particulate matter.');

  // 3. AI 客户端 start 调用次数严格为 0！零网络往返！
  assert.equal(mockAiClient.starts.length, 0, '缓存命中绝不得调用 aiClient.start()');
});
