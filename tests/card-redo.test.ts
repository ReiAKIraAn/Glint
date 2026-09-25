import assert from 'node:assert/strict';
import { test, before, beforeEach } from 'node:test';
import { Window } from 'happy-dom';
import { Card } from '../src/lib/card';
import { ScannedToken } from '../src/lib/scan';
import type { StreamHandlers } from '../src/lib/ai-port';
import {
  clearExplanations,
  getExplanation,
  putExplanation,
  explanationsStore,
} from '../src/lib/explanation-cache';
import type { DictEntry } from '../src/lib/types';

let window: Window;

before(() => {
  window = new Window({ url: 'https://en.wikipedia.org/wiki/Testing' });
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

class MockAiClient {
  starts: Array<{
    payload: { word: string; lemma?: string; sentence: string };
    handlers: StreamHandlers;
    requestId: string;
  }> = [];
  abortedIds: string[] = [];
  activeRequestId: string | null = null;
  lastHandlers: StreamHandlers | null = null;

  start(
    payload: { word: string; lemma?: string; sentence: string },
    handlers: StreamHandlers,
  ): string {
    if (this.activeRequestId) {
      this.abortedIds.push(this.activeRequestId);
    }
    const requestId = `req_${this.starts.length + 1}`;
    this.activeRequestId = requestId;
    this.lastHandlers = handlers;
    this.starts.push({ payload, handlers, requestId });
    return requestId;
  }

  abort(): void {
    if (this.activeRequestId) {
      this.abortedIds.push(this.activeRequestId);
      this.activeRequestId = null;
      this.lastHandlers = null;
    }
  }

  getActiveRequestId(): string | null {
    return this.activeRequestId;
  }
}

const dummyRect = new DOMRect(100, 100, 50, 20);

function makeToken(word: string, lemma = word): ScannedToken {
  const textNode = document.createTextNode(`This is a sentence containing ${word}.`);
  return new ScannedToken(textNode, 0, word.length, word, lemma, 2);
}

const dictData: Record<string, DictEntry> = {
  abandon: {
    phonetic: 'əˈbændən',
    translation: 'vt. 遗弃；放弃',
    tags: ['cet4'],
    rank: 1000,
  },
  sediment: {
    phonetic: 'ˈsɛdɪmənt',
    translation: 'n. 沉淀物；沉积物',
    tags: ['zk'],
    rank: 1500,
  },
};

function createCard(
  client?: MockAiClient,
  overrides?: {
    sentenceOf?: (token: ScannedToken) => string;
  },
) {
  const card = new Card({
    lookup: async (word: string) => dictData[word] || null,
    aiClient: client,
    sentenceOf: overrides?.sentenceOf || ((token) => `Context sentence for ${token.surface}.`),
    getCachedExplanation: (word) => getExplanation(word),
    putCachedExplanation: (word, exp) => putExplanation(word, exp),
    aiReady: async () => true,
    onKnown: () => {},
    onPointerEnter: () => {},
    onPointerLeave: () => {},
  });
  card.mount();
  return card;
}

// ============================================================================
// 一、REDO-01 ~ REDO-06: 缓存绕过与成功更新
// ============================================================================

test('REDO-01: 有 cache → Redo 必须发送 AI request', async () => {
  await putExplanation('abandon', '旧 AI 释义内容');

  const client = new MockAiClient();
  const card = createCard(client);
  const token = makeToken('abandon');

  await card.show(token, dummyRect);
  assert.strictEqual(card.translationElement.textContent, '旧 AI 释义内容');
  assert.strictEqual(client.starts.length, 0, '打开卡片时绝不发送请求');
  assert.strictEqual(card.aiRedoButton.hidden, false, '存在缓存时 Redo 按钮可见');
  assert.strictEqual(card.aiExplainButton.hidden, true, '存在缓存时初次解释按钮隐藏');

  // 用户点击 Redo 按钮
  card.aiRedoButton.click();
  assert.strictEqual(client.starts.length, 1, 'Redo 必须触发新的 AI_START');
  assert.strictEqual(client.starts[0]?.payload.word, 'abandon');

  card.destroy();
});

test('REDO-02: Redo 不得使用已有 cache 直接返回', async () => {
  await putExplanation('abandon', '旧 AI 释义内容');

  const client = new MockAiClient();
  const card = createCard(client);
  const token = makeToken('abandon');

  await card.show(token, dummyRect);
  await card.redoAi();

  // 必须进入 loading / request 发送状态，绝不可直接切换为 done 并使用旧缓存
  assert.strictEqual((card.aiUiState as { kind: string }).kind, 'loading');
  assert.strictEqual(client.starts.length, 1, '已向 AI 客户端派发实际网络请求');

  card.destroy();
});

test('REDO-03: Redo 使用当前 word 与 lemma', async () => {
  await putExplanation('sediment', '沉淀物');

  const client = new MockAiClient();
  const card = createCard(client);
  const token = makeToken('sediments', 'sediment');

  await card.show(token, dummyRect);
  card.aiRedoButton.click();

  assert.strictEqual(client.starts[0]?.payload.word, 'sediments');
  assert.strictEqual(client.starts[0]?.payload.lemma, 'sediment');

  card.destroy();
});

test('REDO-04: Redo 使用当前 sentence/context 而非陈旧上下文', async () => {
  await putExplanation('abandon', '旧释义');

  let currentContext = 'First sentence context.';
  const client = new MockAiClient();
  const card = createCard(client, {
    sentenceOf: () => currentContext,
  });
  const token = makeToken('abandon');

  await card.show(token, dummyRect);

  // 模拟页面上下文动态变化
  currentContext = 'Dynamically updated sentence context on the page.';
  card.aiRedoButton.click();

  assert.strictEqual(
    client.starts[0]?.payload.sentence,
    'Dynamically updated sentence context on the page.',
    'Redo 必须读取当前最新上下文',
  );

  card.destroy();
});

test('REDO-05: Redo 成功 → 新 explanation 写入 cache 并更新卡片显示', async () => {
  await putExplanation('abandon', '旧 AI 释义');

  const client = new MockAiClient();
  const card = createCard(client);
  const token = makeToken('abandon');

  await card.show(token, dummyRect);
  card.aiRedoButton.click();

  const req = client.starts[0]!;
  req.handlers.onChunk('全新 AI 语境释义结果');
  await req.handlers.onDone();

  // 验证卡片就地显示新释义
  assert.strictEqual(card.translationElement.textContent, '全新 AI 语境释义结果');

  // 验证缓存已被覆写
  const cached = await getExplanation('abandon');
  assert.strictEqual(cached, '全新 AI 语境释义结果');

  // 验证 Redo 按钮依然可用供后续再次触发
  assert.strictEqual(card.aiRedoButton.hidden, false);
  assert.strictEqual(card.aiExplainButton.hidden, true);

  card.destroy();
});

test('REDO-06: Redo 成功 → updatedAt 更新', async () => {
  const t0 = 1000000;
  await explanationsStore.setValue({
    abandon: {
      word: 'abandon',
      explanation: '旧 AI 释义',
      updatedAt: t0,
    },
  });

  const client = new MockAiClient();
  const card = createCard(client);
  const token = makeToken('abandon');

  await card.show(token, dummyRect);
  card.aiRedoButton.click();

  const req = client.starts[0]!;
  req.handlers.onChunk('更新后的 AI 释义');
  await req.handlers.onDone();

  const raw = (await explanationsStore.getValue()) as Record<
    string,
    { word: string; explanation: string; updatedAt: number }
  >;
  assert.ok(raw['abandon']!.updatedAt > t0, 'updatedAt 必须更新为当前最新时间戳');
  assert.strictEqual(raw['abandon']!.explanation, '更新后的 AI 释义');

  card.destroy();
});

// ============================================================================
// 二、REDO-07 ~ REDO-09: 取消与异常回退
// ============================================================================

test('REDO-07: Redo cancel → 恢复旧 AI explanation', async () => {
  await putExplanation('abandon', '原有的 AI 释义');

  const client = new MockAiClient();
  const card = createCard(client);
  const token = makeToken('abandon');

  await card.show(token, dummyRect);
  assert.strictEqual(card.translationElement.textContent, '原有的 AI 释义');

  card.aiRedoButton.click();
  const req = client.starts[0]!;
  req.handlers.onChunk('进行中的部分流式文本...');

  // 用户主动点击取消按钮
  card.aiCancelButton.click();

  // 必须立即恢复 Redo 前的旧 AI 释义
  assert.strictEqual(card.translationElement.textContent, '原有的 AI 释义');
  assert.strictEqual(card.aiStatusElement.textContent, '（已取消）');
  assert.strictEqual(card.aiRedoButton.hidden, false);

  // 持久化存储不受影响
  const cached = await getExplanation('abandon');
  assert.strictEqual(cached, '原有的 AI 释义');

  card.destroy();
});

test('REDO-08: Redo error → 恢复旧 AI explanation 并展示报错', async () => {
  await putExplanation('abandon', '原有的 AI 释义');

  const client = new MockAiClient();
  const card = createCard(client);
  const token = makeToken('abandon');

  await card.show(token, dummyRect);
  card.aiRedoButton.click();

  const req = client.starts[0]!;
  req.handlers.onError('PROVIDER_TIMEOUT', '请求超时 (60 秒)');

  // 必须恢复旧 AI 释义
  assert.strictEqual(card.translationElement.textContent, '原有的 AI 释义');
  assert.strictEqual(card.aiErrorElement.hidden, false);
  assert.strictEqual(card.aiErrorElement.textContent, '请求超时 (60 秒)');
  assert.strictEqual(card.aiRedoButton.hidden, false);

  // 持久化存储绝不被错误污染
  const cached = await getExplanation('abandon');
  assert.strictEqual(cached, '原有的 AI 释义');

  card.destroy();
});

test('REDO-09: 无旧 AI explanation + Redo cancel → 恢复 local dictionary', async () => {
  const client = new MockAiClient();
  const card = createCard(client);
  const token = makeToken('abandon');

  await card.show(token, dummyRect);
  assert.strictEqual(card.translationElement.textContent, 'vt. 遗弃；放弃');

  // 直接调用 redoAi() 发起无缓存场景下的请求
  await card.redoAi();
  card.abortAi();

  // 恢复本地离线词典内容
  assert.strictEqual(card.translationElement.textContent, 'vt. 遗弃；放弃');
  assert.strictEqual(card.aiStatusElement.textContent, '（已取消）');
  assert.strictEqual(card.aiExplainButton.hidden, false);
  assert.strictEqual(card.aiRedoButton.hidden, true);

  card.destroy();
});

// ============================================================================
// 三、REDO-10 ~ REDO-14: 请求隔离与竞态保护
// ============================================================================

test('REDO-10: 旧 requestId 的 AI_CHUNK 不得污染 Redo', async () => {
  await putExplanation('abandon', '初始释义');

  const client = new MockAiClient();
  const card = createCard(client);
  const token = makeToken('abandon');

  await card.show(token, dummyRect);

  // 发起第 1 次 Redo
  await card.redoAi();
  const req1 = client.starts[0]!;

  // 紧接着发起第 2 次 Redo
  await card.redoAi();
  const req2 = client.starts[1]!;

  // req1 的迟到 chunk 严禁写入
  req1.handlers.onChunk('stale chunk from req 1');
  assert.strictEqual(card.aiTextElement.textContent, '');

  // req2 的有效 chunk 正常写入
  req2.handlers.onChunk('valid chunk from req 2');
  assert.strictEqual((card.aiUiState as { kind: string }).kind, 'streaming');
  await req2.handlers.onDone();
  assert.strictEqual(card.aiTextElement.textContent, 'valid chunk from req 2');

  card.destroy();
});

test('REDO-11: 旧 requestId 的 AI_DONE 不得覆盖 Redo', async () => {
  await putExplanation('abandon', '初始释义');

  const client = new MockAiClient();
  const card = createCard(client);
  const token = makeToken('abandon');

  await card.show(token, dummyRect);

  await card.redoAi();
  const req1 = client.starts[0]!;

  await card.redoAi();
  const req2 = client.starts[1]!;

  // req1 迟到的 onDone
  await req1.handlers.onDone();

  // 卡片当前依然处于 req2 的 loading/streaming 态
  assert.strictEqual((card.aiUiState as { kind: string }).kind, 'loading');

  // req2 完成
  req2.handlers.onChunk('最新完整释义');
  await req2.handlers.onDone();

  assert.strictEqual(card.translationElement.textContent, '最新完整释义');
  const cached = await getExplanation('abandon');
  assert.strictEqual(cached, '最新完整释义');

  card.destroy();
});

test('REDO-12: Redo 中关闭 Card → abort', async () => {
  await putExplanation('abandon', '初始释义');

  const client = new MockAiClient();
  const card = createCard(client);
  const token = makeToken('abandon');

  await card.show(token, dummyRect);
  await card.redoAi();

  assert.strictEqual(client.activeRequestId, 'req_1');
  card.hide();

  assert.ok(client.abortedIds.includes('req_1'), 'hide 必须中止当前 Redo 请求');

  card.destroy();
});

test('REDO-13: Redo 中切换 word → 旧 response 不得污染新 word', async () => {
  await putExplanation('abandon', 'Abandon 初始释义');

  const client = new MockAiClient();
  const card = createCard(client);
  const tokenA = makeToken('abandon');
  const tokenB = makeToken('sediment');

  await card.show(tokenA, dummyRect);
  await card.redoAi();
  const reqA = client.starts[0]!;

  // 快速切换至单词 B
  await card.show(tokenB, dummyRect);
  assert.strictEqual(card.translationElement.textContent, 'n. 沉淀物；沉积物');

  // 单词 A 的迟到 response 到达
  reqA.handlers.onChunk('Late abandon chunk');
  await reqA.handlers.onDone();

  // 单词 B 绝对不被污染
  assert.strictEqual(card.translationElement.textContent, 'n. 沉淀物；沉积物');
  const cachedB = await getExplanation('sediment');
  assert.strictEqual(cachedB, null, '单词 B 绝不被 A 的内容写入缓存');

  card.destroy();
});

test('REDO-14: Redo 不产生第二个并发 request', async () => {
  await putExplanation('abandon', '初始释义');

  const client = new MockAiClient();
  const card = createCard(client);
  const token = makeToken('abandon');

  await card.show(token, dummyRect);

  await card.redoAi();
  assert.strictEqual(client.starts.length, 1);
  assert.strictEqual(client.getActiveRequestId(), 'req_1');

  // 再次触发 Redo
  await card.redoAi();
  assert.strictEqual(client.starts.length, 2);
  assert.ok(client.abortedIds.includes('req_1'), '前一请求必须被 abort');
  assert.strictEqual(client.getActiveRequestId(), 'req_2', '只有最新的唯一活跃请求');

  card.destroy();
});

// ============================================================================
// 四、REDO-15 ~ REDO-18: 缓存完整性与持久化验证
// ============================================================================

test('REDO-15: AI_CHUNK 不写 persistent cache', async () => {
  await putExplanation('abandon', '旧释义');

  const client = new MockAiClient();
  const card = createCard(client);
  const token = makeToken('abandon');

  await card.show(token, dummyRect);
  await card.redoAi();

  const req = client.starts[0]!;
  req.handlers.onChunk('部分 chunk 1');
  req.handlers.onChunk('部分 chunk 2');

  // 中间 chunk 到达时，缓存中必须依然是完整旧释义
  const cached = await getExplanation('abandon');
  assert.strictEqual(cached, '旧释义', '中间 chunk 绝不写入持久化存储');

  card.destroy();
});

test('REDO-16: Redo error 不修改旧 cache', async () => {
  await putExplanation('abandon', '牢固的旧 AI 释义');

  const client = new MockAiClient();
  const card = createCard(client);
  const token = makeToken('abandon');

  await card.show(token, dummyRect);
  await card.redoAi();

  const req = client.starts[0]!;
  req.handlers.onChunk('错误发生前的部分碎片');
  req.handlers.onError('HTTP_502', '网关错误');

  const cached = await getExplanation('abandon');
  assert.strictEqual(cached, '牢固的旧 AI 释义', '发生错误时旧缓存原封不动');

  card.destroy();
});

test('REDO-17: Redo cancel 不修改旧 cache', async () => {
  await putExplanation('abandon', '牢固的旧 AI 释义');

  const client = new MockAiClient();
  const card = createCard(client);
  const token = makeToken('abandon');

  await card.show(token, dummyRect);
  await card.redoAi();

  const req = client.starts[0]!;
  req.handlers.onChunk('取消发生前的部分碎片');
  card.abortAi();

  const cached = await getExplanation('abandon');
  assert.strictEqual(cached, '牢固的旧 AI 释义', '取消时旧缓存原封不动');

  card.destroy();
});

test('REDO-18: Redo 成功后再次打开同 word → 使用新的 cached AI meaning', async () => {
  await putExplanation('abandon', '第 1 代 AI 释义');

  const client = new MockAiClient();
  const card = createCard(client);
  const token = makeToken('abandon');

  await card.show(token, dummyRect);
  assert.strictEqual(card.translationElement.textContent, '第 1 代 AI 释义');

  // 执行 Redo
  await card.redoAi();
  const req = client.starts[0]!;
  req.handlers.onChunk('第 2 代全新 AI 释义');
  await req.handlers.onDone();

  assert.strictEqual(card.translationElement.textContent, '第 2 代全新 AI 释义');

  // 关闭卡片
  card.hide();

  // 再次打开同一个词
  await card.show(token, dummyRect);
  assert.strictEqual(
    card.translationElement.textContent,
    '第 2 代全新 AI 释义',
    '重新打开必须优先展示新生成的 AI 释义',
  );
  assert.strictEqual(client.starts.length, 1, '重新打开时严格为 0 次网络请求');

  card.destroy();
});

// ============================================================================
// 五、关键不变量验证 (Section 十四)
// ============================================================================

test('INVARIANT: OLD CACHE -> Redo -> request fails -> OLD CACHE STILL EXISTS', async () => {
  const INITIAL = 'Stable baseline AI explanation.';
  await putExplanation('abandon', INITIAL);

  const client = new MockAiClient();
  const card = createCard(client);
  const token = makeToken('abandon');

  await card.show(token, dummyRect);
  assert.strictEqual(card.translationElement.textContent, INITIAL);

  // Redo 触发
  await card.redoAi();
  const req = client.starts[0]!;
  req.handlers.onChunk('Flaky partial response...');
  req.handlers.onError('NETWORK_FAILURE', '连接超时');

  // 不变量：旧缓存必须完整存在，且卡片恢复旧释义
  const stored = await getExplanation('abandon');
  assert.strictEqual(stored, INITIAL, '失败后 OLD CACHE STILL EXISTS');
  assert.strictEqual(card.translationElement.textContent, INITIAL);

  card.destroy();
});

test('INVARIANT: OLD CACHE -> Redo -> request succeeds -> NEW CACHE', async () => {
  const OLD_CACHE = 'Version 1 meaning.';
  const NEW_CACHE = 'Version 2 refreshed meaning.';
  await putExplanation('abandon', OLD_CACHE);

  const client = new MockAiClient();
  const card = createCard(client);
  const token = makeToken('abandon');

  await card.show(token, dummyRect);
  assert.strictEqual(card.translationElement.textContent, OLD_CACHE);

  // Redo 触发
  await card.redoAi();
  const req = client.starts[0]!;
  req.handlers.onChunk(NEW_CACHE);
  await req.handlers.onDone();

  // 不变量：新缓存必须覆盖旧缓存
  const stored = await getExplanation('abandon');
  assert.strictEqual(stored, NEW_CACHE, '成功后 NEW CACHE SAVED');
  assert.strictEqual(card.translationElement.textContent, NEW_CACHE);

  card.destroy();
});
