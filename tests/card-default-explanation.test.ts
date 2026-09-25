import assert from 'node:assert/strict';
import { test, before, beforeEach } from 'node:test';
import { Window } from 'happy-dom';
import { Card, resolveCardExplanation } from '../src/lib/card';
import { ScannedToken } from '../src/lib/scan';
import type { StreamHandlers } from '../src/lib/ai-port';
import {
  clearExplanations,
  getExplanation,
  putExplanation,
  explanationsStore,
  EXPLANATION_LIMIT,
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
  resilience: {
    phonetic: 'rɪˈzɪliəns',
    translation: 'n. 恢复力；弹力',
    tags: ['toefl'],
    rank: 2000,
  },
};

function createCard(client?: MockAiClient, dictMap = dictData) {
  const card = new Card({
    lookup: async (word) => dictMap[word.toLowerCase()] ?? null,
    aiClient: client,
    sentenceOf: (token) => `Context sentence for ${token.surface}.`,
    getCachedExplanation: async (word) => getExplanation(word),
    putCachedExplanation: async (word, exp) => putExplanation(word, exp),
    onKnown: () => {},
    onPointerEnter: () => {},
    onPointerLeave: () => {},
  });
  card.mount();
  return card;
}

// ============================================================================
// 一、Resolver 纯函数单元测试 (Tests 1 - 4)
// ============================================================================

test('RESOLVER-01: 有 AI cache 时返回 AI explanation', () => {
  const result = resolveCardExplanation({
    localExplanation: 'vt. 遗弃；放弃',
    cachedAIExplanation: '放弃；终止',
  });
  assert.strictEqual(result, '放弃；终止');
});

test('RESOLVER-02: 无 AI cache 时返回 local explanation', () => {
  const result1 = resolveCardExplanation({
    localExplanation: 'vt. 遗弃；放弃',
    cachedAIExplanation: null,
  });
  assert.strictEqual(result1, 'vt. 遗弃；放弃');

  const result2 = resolveCardExplanation({
    localExplanation: 'vt. 遗弃；放弃',
    cachedAIExplanation: undefined,
  });
  assert.strictEqual(result2, 'vt. 遗弃；放弃');
});

test('RESOLVER-03: AI cache 为纯空格或空字符串时回退至 local explanation', () => {
  const result1 = resolveCardExplanation({
    localExplanation: 'vt. 遗弃；放弃',
    cachedAIExplanation: '',
  });
  assert.strictEqual(result1, 'vt. 遗弃；放弃');

  const result2 = resolveCardExplanation({
    localExplanation: 'vt. 遗弃；放弃',
    cachedAIExplanation: '   \n  \t  ',
  });
  assert.strictEqual(result2, 'vt. 遗弃；放弃');
});

test('RESOLVER-04: local 和 AI 都为空时返回空字符串（卡片将展示空/无本地释义状态）', () => {
  assert.strictEqual(resolveCardExplanation({ localExplanation: null, cachedAIExplanation: null }), '');
  assert.strictEqual(resolveCardExplanation({ localExplanation: '', cachedAIExplanation: '' }), '');
  assert.strictEqual(resolveCardExplanation({ localExplanation: '   ', cachedAIExplanation: '   ' }), '');
  assert.strictEqual(resolveCardExplanation({}), '');
});

// ============================================================================
// 二、AI 成功完成流程测试 (Tests 5 - 8)
// ============================================================================

test('AI-SUCCESS-05: AI_DONE 后自动保存 AI explanation 到 local:explanations 缓存', async () => {
  const client = new MockAiClient();
  const card = createCard(client);
  const token = makeToken('abandon');

  await card.show(token, dummyRect);
  await card.startAi();

  const req = client.starts[0]!;
  req.handlers.onChunk('放弃');
  req.handlers.onChunk('；终止');
  await req.handlers.onDone();

  const cached = await getExplanation('abandon');
  assert.strictEqual(cached, '放弃；终止', '必须将完整非空解释存入缓存');
  card.destroy();
});

test('AI-SUCCESS-06: AI_DONE 后当前卡片默认释义立即就地更新为 AI explanation', async () => {
  const client = new MockAiClient();
  const card = createCard(client);
  const token = makeToken('abandon');

  await card.show(token, dummyRect);
  assert.strictEqual(card.translationElement.textContent, 'vt. 遗弃；放弃');

  await card.startAi();
  const req = client.starts[0]!;
  req.handlers.onChunk('放弃；终止');
  await req.handlers.onDone();

  // 当前卡片展示的内容必须直接切为 AI 释义
  assert.strictEqual(card.translationElement.textContent, '放弃；终止');
  card.destroy();
});

test('AI-SUCCESS-07: 再次打开同一个单词时，默认释义直接展示 AI cache', async () => {
  await putExplanation('abandon', '放弃；终止');

  const client = new MockAiClient();
  const card = createCard(client);
  const token = makeToken('abandon');

  // 用户首次打开该卡片
  await card.show(token, dummyRect);

  // 默认直接显示 AI 缓存内容，而非本地词典内容
  assert.strictEqual(card.translationElement.textContent, '放弃；终止');
  // 卡片 AI 状态保持 idle，等待用户显式操作
  assert.strictEqual((card.aiUiState as { kind: string }).kind, 'idle');

  card.destroy();
});

test('AI-SUCCESS-08: cache hit 场景下卡片打开与再次触发均严格为 0 AI network request', async () => {
  await putExplanation('abandon', '放弃；终止');

  const client = new MockAiClient();
  const card = createCard(client);
  const token = makeToken('abandon');

  await card.show(token, dummyRect);
  assert.strictEqual(client.starts.length, 0, '打开已缓存卡片严格不发 AI_START');

  await card.startAi();
  assert.strictEqual(client.starts.length, 0, '点击已缓存卡片 AI 按钮严格不发 AI_START');
  assert.strictEqual((card.aiUiState as { kind: string }).kind, 'done');
  assert.strictEqual(card.aiTextElement.textContent, '放弃；终止');

  card.destroy();
});

// ============================================================================
// 三、AI 失败/取消/异常场景防护测试 (Tests 9 - 12)
// ============================================================================

test('AI-FAILURE-09: AI error 发生后，卡片保持本地词典释义，不写入缓存', async () => {
  const client = new MockAiClient();
  const card = createCard(client);
  const token = makeToken('abandon');

  await card.show(token, dummyRect);
  assert.strictEqual(card.translationElement.textContent, 'vt. 遗弃；放弃');

  await card.startAi();
  const req = client.starts[0]!;
  req.handlers.onError('PROVIDER_HTTP_500', '服务繁忙，请稍后重试');

  // 默认释义保持本地词库内容
  assert.strictEqual(card.translationElement.textContent, 'vt. 遗弃；放弃');
  assert.strictEqual(card.aiErrorElement.textContent, '服务繁忙，请稍后重试');

  const cached = await getExplanation('abandon');
  assert.strictEqual(cached, null, '错误绝不可写入持久化缓存');
  card.destroy();
});

test('AI-FAILURE-10: AI cancel 发生后，卡片保持本地词典释义，不写入不完整内容', async () => {
  const client = new MockAiClient();
  const card = createCard(client);
  const token = makeToken('abandon');

  await card.show(token, dummyRect);
  assert.strictEqual(card.translationElement.textContent, 'vt. 遗弃；放弃');

  await card.startAi();
  const req = client.starts[0]!;
  req.handlers.onChunk('放弃');

  card.abortAi();

  assert.strictEqual(card.translationElement.textContent, 'vt. 遗弃；放弃');
  assert.strictEqual(card.aiStatusElement.textContent, '（已取消）');

  const cached = await getExplanation('abandon');
  assert.strictEqual(cached, null, '取消绝不可写入未完成片段');
  card.destroy();
});

test('AI-FAILURE-11: timeout 发生后，卡片保持本地词典释义，不破坏现有内容', async () => {
  const client = new MockAiClient();
  const card = createCard(client);
  const token = makeToken('abandon');

  await card.show(token, dummyRect);
  assert.strictEqual(card.translationElement.textContent, 'vt. 遗弃；放弃');

  await card.startAi();
  const req = client.starts[0]!;
  req.handlers.onError('TIMEOUT', '请求超时 (60 秒)');

  assert.strictEqual(card.translationElement.textContent, 'vt. 遗弃；放弃');
  assert.strictEqual(card.aiErrorElement.textContent, '请求超时 (60 秒)');

  const cached = await getExplanation('abandon');
  assert.strictEqual(cached, null);
  card.destroy();
});

test('AI-FAILURE-12: 空白/纯空格 AI 输出直接视作失败，不写入缓存，保持本地释义', async () => {
  const client = new MockAiClient();
  const card = createCard(client);
  const token = makeToken('abandon');

  await card.show(token, dummyRect);
  assert.strictEqual(card.translationElement.textContent, 'vt. 遗弃；放弃');

  await card.startAi();
  const req = client.starts[0]!;
  req.handlers.onChunk('   \n  \t  ');
  await req.handlers.onDone();

  assert.strictEqual(card.translationElement.textContent, 'vt. 遗弃；放弃');
  const cached = await getExplanation('abandon');
  assert.strictEqual(cached, null, '空白输出严禁写入缓存');
  card.destroy();
});

// ============================================================================
// 四、单词卡片切换隔离测试 (Tests 13 - 15)
// ============================================================================

test('SWITCH-13: 单词切换 A -> B 时，B 卡片绝不残留 A 的 AI 释义', async () => {
  await putExplanation('abandon', '放弃；终止');

  const client = new MockAiClient();
  const card = createCard(client);
  const tokenA = makeToken('abandon');
  const tokenB = makeToken('sediment');

  await card.show(tokenA, dummyRect);
  assert.strictEqual(card.translationElement.textContent, '放弃；终止');

  // 快速切换至未缓存 AI 的单词 B
  await card.show(tokenB, dummyRect);
  assert.strictEqual(card.translationElement.textContent, 'n. 沉淀物；沉积物');
  assert.strictEqual(String(card.translationElement.textContent).includes('放弃'), false);

  card.destroy();
});

test('SWITCH-14: 单词切换 A -> B -> A 时，能准确恢复 A 的 AI cache', async () => {
  await putExplanation('abandon', '放弃；终止');

  const client = new MockAiClient();
  const card = createCard(client);
  const tokenA = makeToken('abandon');
  const tokenB = makeToken('sediment');

  await card.show(tokenA, dummyRect);
  assert.strictEqual(card.translationElement.textContent, '放弃；终止');

  await card.show(tokenB, dummyRect);
  assert.strictEqual(card.translationElement.textContent, 'n. 沉淀物；沉积物');

  // 切回 A
  await card.show(tokenA, dummyRect);
  assert.strictEqual(card.translationElement.textContent, '放弃；终止');

  card.destroy();
});

test('SWITCH-15: 切换到已有 AI cache 的单词 B 时直接展示 B 的 AI cache', async () => {
  await putExplanation('resilience', '弹性；适应力');

  const client = new MockAiClient();
  const card = createCard(client);
  const tokenA = makeToken('sediment');
  const tokenB = makeToken('resilience');

  await card.show(tokenA, dummyRect);
  assert.strictEqual(card.translationElement.textContent, 'n. 沉淀物；沉积物');

  // 切换到 B
  await card.show(tokenB, dummyRect);
  assert.strictEqual(card.translationElement.textContent, '弹性；适应力');
  assert.strictEqual(client.starts.length, 0);

  card.destroy();
});

// ============================================================================
// 五、数据完整性测试 (Tests 16 - 19)
// ============================================================================

test('INTEGRITY-16: AI cache 覆盖显示优先级时，原始离线本地词典数据对象未被修改', async () => {
  const rawDict = {
    word: 'abandon',
    phonetic: 'əˈbændən',
    translation: 'vt. 遗弃；放弃',
    tags: ['cet4'],
    rank: 1000,
  };

  const card = new Card({
    lookup: async () => rawDict,
    sentenceOf: () => 'Context.',
    getCachedExplanation: async () => '放弃；终止',
    onKnown: () => {},
    onPointerEnter: () => {},
    onPointerLeave: () => {},
  });
  card.mount();

  const token = makeToken('abandon');
  await card.show(token, dummyRect);

  assert.strictEqual(card.translationElement.textContent, '放弃；终止');
  assert.strictEqual(rawDict.translation, 'vt. 遗弃；放弃', '离线词典对象字段严禁被原地覆写');

  card.destroy();
});

test('INTEGRITY-17: 缓存存储严格保持 {word, explanation, updatedAt} schema', async () => {
  await putExplanation('abandon', '放弃；终止');

  const store = await explanationsStore.getValue();
  assert.ok(store.abandon);
  const entry = store.abandon;

  const keys = Object.keys(entry).sort();
  assert.deepStrictEqual(keys, ['explanation', 'updatedAt', 'word']);
  assert.strictEqual(entry.word, 'abandon');
  assert.strictEqual(entry.explanation, '放弃；终止');
  assert.strictEqual(typeof entry.updatedAt, 'number');
});

test('INTEGRITY-18: 缓存容量与 2000 条 LRU 淘汰机制正常工作', async () => {
  const store = await explanationsStore.getValue();
  for (let i = 0; i < EXPLANATION_LIMIT; i++) {
    store[`word_${i}`] = {
      word: `word_${i}`,
      explanation: `exp_${i}`,
      updatedAt: 1000 + i,
    };
  }
  await explanationsStore.setValue(store);

  // 写入第 2001 条
  await putExplanation('new_word', '最新释义');

  const updatedStore = await explanationsStore.getValue();
  const keys = Object.keys(updatedStore);
  assert.strictEqual(keys.length, EXPLANATION_LIMIT);
  assert.strictEqual(updatedStore.word_0, undefined, '最久未访问的 word_0 必须被淘汰');
  assert.strictEqual(updatedStore.new_word?.explanation, '最新释义');
});

test('INTEGRITY-19: 清空缓存后重新打开单词恢复本地词典释义', async () => {
  await putExplanation('abandon', '放弃；终止');

  const client = new MockAiClient();
  const card = createCard(client);
  const token = makeToken('abandon');

  await card.show(token, dummyRect);
  assert.strictEqual(card.translationElement.textContent, '放弃；终止');

  // 清空缓存
  await clearExplanations();

  // 再次打开该卡片
  await card.show(token, dummyRect);
  assert.strictEqual(card.translationElement.textContent, 'vt. 遗弃；放弃');

  card.destroy();
});

// ============================================================================
// 六、安全与 XSS 防护验证 (Tests 20 - 22)
// ============================================================================

test('SECURITY-20: AI 解释始终作为纯文本 (textContent) 渲染，无 innerHTML 注入', async () => {
  await putExplanation('xss_word', '第一行释义\n第二行释义');

  const card = createCard();
  const token = makeToken('xss_word');
  await card.show(token, dummyRect);

  const zhEl = card.translationElement;
  assert.strictEqual(zhEl.children.length, 2);
  assert.strictEqual(zhEl.children[0]?.textContent, '第一行释义');
  assert.strictEqual(zhEl.children[1]?.textContent, '第二行释义');

  card.destroy();
});

test('SECURITY-21: 恶意脚本与 HTML 标签严禁执行，完全作为文本字面量渲染', async () => {
  const payload = '<script>window.__glint_pwned = true;</script><img src="x" onerror="window.__glint_pwned=true">';
  await putExplanation('xss_attack', payload);

  const card = createCard();
  const token = makeToken('xss_attack');
  await card.show(token, dummyRect);

  const zhEl = card.translationElement;
  assert.strictEqual((window as unknown as Record<string, unknown>).__glint_pwned, undefined);
  assert.strictEqual(zhEl.querySelectorAll('script').length, 0);
  assert.strictEqual(zhEl.querySelectorAll('img').length, 0);
  assert.ok(zhEl.textContent?.includes('<script>'));

  card.destroy();
});

test('SECURITY-22: 卡片 DOM 与 dataset 严禁暴露 API Key 或网络凭证', async () => {
  const card = createCard();
  const token = makeToken('sediment');
  await card.show(token, dummyRect);

  const shadow = card.shadowRoot;
  const html = shadow.innerHTML;

  assert.strictEqual(html.includes('Bearer'), false);
  assert.strictEqual(html.includes('sk-'), false);
  assert.strictEqual(html.includes('apiKey'), false);

  card.destroy();
});
