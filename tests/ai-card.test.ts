import assert from 'node:assert/strict';
import { test, before, beforeEach } from 'node:test';
import { Window } from 'happy-dom';
import { Card, type AiUiState } from '../src/lib/card';
import { ScannedToken } from '../src/lib/scan';
import type { DictEntry } from '../src/lib/types';
import type { StreamHandlers } from '../src/lib/ai-port';

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

class MockAiClient {
  starts: Array<{ payload: { word: string; lemma?: string; sentence: string }; handlers: StreamHandlers; requestId: string }> = [];
  abortedIds: string[] = [];
  activeRequestId: string | null = null;
  lastHandlers: StreamHandlers | null = null;

  start(payload: { word: string; lemma?: string; sentence: string }, handlers: StreamHandlers): string {
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

const mockDictEntry: DictEntry = {
  phonetic: 'ˈsɛdɪmənt',
  translation: 'n. 沉淀物；沉积物',
  tags: ['cet4', 'toefl'],
  rank: 1500,
};

function createTestCard(client?: MockAiClient) {
  const card = new Card({
    lookup: async () => mockDictEntry,
    aiClient: client,
    sentenceOf: (t) => `The river deposits ${t.surface} over time.`,
    onKnown: () => {},
    onPointerEnter: () => {},
    onPointerLeave: () => {},
  });
  card.mount();
  return card;
}

function makeToken(word = 'Sediment', lemma = 'sediment') {
  const textNode = document.createTextNode(`The ${word} layer`);
  document.body.append(textNode);
  return new ScannedToken(textNode, 4, 4 + word.length, word, lemma, 4);
}

const dummyRect = new DOMRect(100, 100, 80, 20);

// ============================================================================
// A. Trigger (1-5)
// ============================================================================

test('A1: hover does not send AI_START - 仅悬停展示卡片绝不发送 AI 请求', async () => {
  const client = new MockAiClient();
  const card = createTestCard(client);
  const token = makeToken();

  await card.show(token, dummyRect);
  assert.equal(client.starts.length, 0, 'Hovering must NOT send AI_START');
  assert.equal(card.aiUiState.kind, 'idle');
  card.destroy();
});

test('A2: card open does not send AI_START - 卡片处于 open 状态依然零 AI 请求', async () => {
  const client = new MockAiClient();
  const card = createTestCard(client);
  const token = makeToken();

  await card.show(token, dummyRect);
  assert.equal(card.element.style.display, 'block');
  assert.equal(client.starts.length, 0);
  card.destroy();
});

test('A3: click AI explanation sends exactly one AI_START - 显式点击按钮发出单次请求', async () => {
  const client = new MockAiClient();
  const card = createTestCard(client);
  const token = makeToken();

  await card.show(token, dummyRect);
  const btn = card.aiExplainButton;
  assert.ok(btn);
  btn.click();

  assert.equal(client.starts.length, 1);
  assert.equal(client.starts[0]?.payload.word, 'Sediment');
  assert.equal(client.starts[0]?.payload.lemma, 'sediment');
  assert.equal(client.starts[0]?.payload.sentence, 'The river deposits Sediment over time.');
  card.destroy();
});

test('A4: repeated click follows frozen behavior - 进行中点击取消或重试遵循单一请求原则', async () => {
  const client = new MockAiClient();
  const card = createTestCard(client);
  const token = makeToken();

  await card.show(token, dummyRect);
  card.aiExplainButton.click();
  assert.equal(client.starts.length, 1);

  // loading/streaming 时 explainButton 隐藏，无法重复点击造成并发
  assert.equal(card.aiExplainButton.hidden, true);
  assert.equal(card.aiCancelButton.hidden, false);
  card.destroy();
});

test('A5: dictionary remains visible before AI - AI 未触发或处理期间本地词库内容立即可见', async () => {
  const client = new MockAiClient();
  const card = createTestCard(client);
  const token = makeToken();

  await card.show(token, dummyRect);
  const shadow = card.shadowRoot;
  assert.equal(shadow.querySelector('.word')?.textContent, 'Sediment');
  assert.equal(shadow.querySelector('.phonetic')?.textContent, '/ˈsɛdɪmənt/');
  assert.ok(shadow.querySelector('.zh')?.textContent?.includes('沉淀物'));
  card.destroy();
});

// ============================================================================
// B. Loading (6-8)
// ============================================================================

test('B6: AI_START → loading state - 发起请求后 UI 状态进入 loading', async () => {
  const client = new MockAiClient();
  const card = createTestCard(client);
  const token = makeToken();

  await card.show(token, dummyRect);
  card.aiExplainButton.click();

  assert.equal(card.aiUiState.kind, 'loading');
  assert.ok(card.aiUiState.requestId);
  card.destroy();
});

test('B7: button state changes correctly - loading 态下按钮与状态条展示正确', async () => {
  const client = new MockAiClient();
  const card = createTestCard(client);
  const token = makeToken();

  await card.show(token, dummyRect);
  card.aiExplainButton.click();

  assert.equal(card.aiExplainButton.hidden, true);
  assert.equal(card.aiCancelButton.hidden, false);
  assert.equal(card.aiStatusElement.hidden, false);
  assert.equal(card.aiStatusElement.textContent, 'AI 正在分析语境...');
  card.destroy();
});

test('B8: no duplicate active request - 同一卡片同一时刻绝对只有唯一活动请求', async () => {
  const client = new MockAiClient();
  const card = createTestCard(client);
  const token = makeToken();

  await card.show(token, dummyRect);
  card.startAi();
  const firstReq = client.activeRequestId;

  // 再次调用 startAi 会自动 abort 之前请求
  card.startAi();
  assert.equal(client.starts.length, 2);
  assert.ok(client.abortedIds.includes(firstReq!));
  assert.equal(client.activeRequestId, 'req_2');
  card.destroy();
});

// ============================================================================
// C. Streaming (9-14)
// ============================================================================

test('C9: first AI_CHUNK → streaming - 接收到第一个 chunk 后进入 streaming 态', async () => {
  const client = new MockAiClient();
  const card = createTestCard(client);
  const token = makeToken();

  await card.show(token, dummyRect);
  card.aiExplainButton.click();
  const handlers = client.lastHandlers!;

  handlers.onChunk('Sediment refers to ');
  assert.equal(card.aiUiState.kind, 'streaming');
  assert.equal(card.aiTextElement.hidden, false);
  assert.equal(card.aiStatusElement.hidden, true);
  card.destroy();
});

test('C10: multiple chunks accumulate correctly - 多个 chunk 文本正确累加', async () => {
  const client = new MockAiClient();
  const card = createTestCard(client);
  const token = makeToken();

  await card.show(token, dummyRect);
  card.aiExplainButton.click();
  const handlers = client.lastHandlers!;

  handlers.onChunk('Part 1. ');
  handlers.onChunk('Part 2. ');
  handlers.onChunk('Part 3.');

  handlers.onDone(); // flush
  assert.equal(card.aiTextElement.textContent, 'Part 1. Part 2. Part 3.');
  card.destroy();
});

test('C11: chunk order preserved - 严格保持 chunk 接收顺序', async () => {
  const client = new MockAiClient();
  const card = createTestCard(client);
  const token = makeToken();

  await card.show(token, dummyRect);
  card.aiExplainButton.click();
  const handlers = client.lastHandlers!;

  for (let i = 1; i <= 5; i++) {
    handlers.onChunk(`[${i}]`);
  }
  handlers.onDone();

  assert.equal(card.aiTextElement.textContent, '[1][2][3][4][5]');
  card.destroy();
});

test('C12: rAF batching works - 流式渲染使用 rAF 合并微小高频 chunk', async () => {
  const client = new MockAiClient();
  const card = createTestCard(client);
  const token = makeToken();

  await card.show(token, dummyRect);
  card.aiExplainButton.click();
  const handlers = client.lastHandlers!;

  handlers.onChunk('a');
  handlers.onChunk('b');
  handlers.onChunk('c');

  handlers.onDone();
  assert.equal(card.aiTextElement.textContent, 'abc');
  card.destroy();
});

test('C13: final pending buffer flushed - onDone 时强制 flush 保证内容零遗漏', async () => {
  const client = new MockAiClient();
  const card = createTestCard(client);
  const token = makeToken();

  await card.show(token, dummyRect);
  card.aiExplainButton.click();
  const handlers = client.lastHandlers!;

  handlers.onChunk('tail chunk');
  handlers.onDone();

  assert.equal(card.aiTextElement.textContent, 'tail chunk');
  card.destroy();
});

test('C14: AI_DONE → done - 收到完成通知后转为 done 状态并隐藏取消按钮', async () => {
  const client = new MockAiClient();
  const card = createTestCard(client);
  const token = makeToken();

  await card.show(token, dummyRect);
  card.aiExplainButton.click();
  const handlers = client.lastHandlers!;

  handlers.onChunk('all done.');
  handlers.onDone();

  assert.equal(card.aiUiState.kind, 'done');
  assert.equal(card.aiCancelButton.hidden, true);
  card.destroy();
});

// ============================================================================
// D. requestId (15-19)
// ============================================================================

test('D15: correct requestId accepted - 当前 requestId 的消息正常接受', async () => {
  const client = new MockAiClient();
  const card = createTestCard(client);
  const token = makeToken();

  await card.show(token, dummyRect);
  card.aiExplainButton.click();
  const handlers = client.lastHandlers!;

  handlers.onChunk('valid chunk');
  handlers.onDone();

  assert.equal(card.aiTextElement.textContent, 'valid chunk');
  card.destroy();
});

test('D16: stale chunk ignored - 过期请求的迟到 chunk 严禁写入 UI', async () => {
  const client = new MockAiClient();
  const card = createTestCard(client);
  const token = makeToken();

  await card.show(token, dummyRect);
  card.startAi();
  const handlersA = client.lastHandlers!;

  // 启动新请求 B
  card.startAi();
  const handlersB = client.lastHandlers!;

  // A 迟到
  handlersA.onChunk('stale chunk A');
  handlersB.onChunk('fresh chunk B');
  handlersB.onDone();

  assert.equal(card.aiTextElement.textContent, 'fresh chunk B');
  card.destroy();
});

test('D17: stale done ignored - 过期请求的迟到 done 不改变当前 UI 状态', async () => {
  const client = new MockAiClient();
  const card = createTestCard(client);
  const token = makeToken();

  await card.show(token, dummyRect);
  card.startAi();
  const handlersA = client.lastHandlers!;

  card.startAi();
  handlersA.onDone();

  assert.equal(card.aiUiState.kind, 'loading');
  assert.equal(card.aiUiState.requestId, 'req_2');
  card.destroy();
});

test('D18: stale error ignored - 过期请求的迟到 error 不报错污染新请求', async () => {
  const client = new MockAiClient();
  const card = createTestCard(client);
  const token = makeToken();

  await card.show(token, dummyRect);
  card.startAi();
  const handlersA = client.lastHandlers!;

  card.startAi();
  handlersA.onError('HTTP_ERROR', 'old error');

  assert.equal(card.aiErrorElement.hidden, true);
  assert.equal(card.aiUiState.kind, 'loading');
  card.destroy();
});

test('D19: new request replaces old UI state - 发起新请求时老 UI 内容完全重置', async () => {
  const client = new MockAiClient();
  const card = createTestCard(client);
  const token = makeToken();

  await card.show(token, dummyRect);
  card.startAi();
  client.lastHandlers!.onChunk('old content');
  client.lastHandlers!.onDone();
  assert.equal(card.aiTextElement.textContent, 'old content');

  // 再次调用 startAi
  card.startAi();
  assert.equal(card.aiTextElement.textContent, '');
  assert.equal(card.aiStatusElement.hidden, false);
  card.destroy();
});

// ============================================================================
// E. Abort (20-24)
// ============================================================================

test('E20: cancel invokes abort - 点击取消调用底层 client.abort()', async () => {
  const client = new MockAiClient();
  const card = createTestCard(client);
  const token = makeToken();

  await card.show(token, dummyRect);
  card.aiExplainButton.click();
  assert.equal(client.activeRequestId, 'req_1');

  card.aiCancelButton.click();
  assert.ok(client.abortedIds.includes('req_1'));
  card.destroy();
});

test('E21: abort updates UI immediately - 点击取消后 UI 立即离开 streaming 状态', async () => {
  const client = new MockAiClient();
  const card = createTestCard(client);
  const token = makeToken();

  await card.show(token, dummyRect);
  card.aiExplainButton.click();
  client.lastHandlers!.onChunk('partial text ');

  card.aiCancelButton.click();
  assert.equal(card.aiUiState.kind, 'aborted');
  assert.equal(card.aiCancelButton.hidden, true);
  assert.equal(card.aiStatusElement.textContent, '（已取消）');
  card.destroy();
});

test('E22: no post-abort text appears - 取消后迟到的 chunk 不得追加进文本', async () => {
  const client = new MockAiClient();
  const card = createTestCard(client);
  const token = makeToken();

  await card.show(token, dummyRect);
  card.aiExplainButton.click();
  const handlers = client.lastHandlers!;
  handlers.onChunk('initial');

  card.abortAi();
  handlers.onChunk(' post abort late chunk');

  assert.equal(card.aiTextElement.textContent, 'initial');
  card.destroy();
});

test('E23: pending rAF cancelled - 取消操作立即清理未决 rAF 定时器', async () => {
  const client = new MockAiClient();
  const card = createTestCard(client);
  const token = makeToken();

  await card.show(token, dummyRect);
  card.aiExplainButton.click();
  client.lastHandlers!.onChunk('chunk');

  card.abortAi();
  assert.equal(card.aiUiState.kind, 'aborted');
  card.destroy();
});

test('E24: no stale completion changes UI - 取消后迟到的 onDone 不改变 aborted 状态', async () => {
  const client = new MockAiClient();
  const card = createTestCard(client);
  const token = makeToken();

  await card.show(token, dummyRect);
  card.aiExplainButton.click();
  const handlers = client.lastHandlers!;
  handlers.onChunk('first');

  card.abortAi();
  handlers.onDone();

  assert.equal(card.aiUiState.kind, 'aborted');
  assert.equal(card.aiTextElement.textContent, 'first');
  card.destroy();
});

// ============================================================================
// F. Error (25-28)
// ============================================================================

test('F25: AI_ERROR displays safe message - 错误时展示脱敏安全报错信息', async () => {
  const client = new MockAiClient();
  const card = createTestCard(client);
  const token = makeToken();

  await card.show(token, dummyRect);
  card.aiExplainButton.click();

  client.lastHandlers!.onError('HTTP_ERROR', 'Anthropic API 凭证无效，请检查 Key');
  assert.equal(card.aiUiState.kind, 'error');
  assert.equal(card.aiErrorElement.hidden, false);
  assert.equal(card.aiErrorElement.textContent, 'Anthropic API 凭证无效，请检查 Key');
  assert.equal(card.aiExplainButton.textContent, '重试 AI 解释');
  card.destroy();
});

test('F26: existing streamed text remains consistent - 发生错误时保留已接收到的局部文本', async () => {
  const client = new MockAiClient();
  const card = createTestCard(client);
  const token = makeToken();

  await card.show(token, dummyRect);
  card.aiExplainButton.click();

  client.lastHandlers!.onChunk('Partial definition...');
  client.lastHandlers!.onError('NETWORK_ERROR', '网络连接中断');

  assert.equal(card.aiTextElement.textContent, 'Partial definition...');
  assert.equal(card.aiErrorElement.textContent, '网络连接中断');
  card.destroy();
});

test('F27: internal stack is not rendered - 严禁在错误区域回显原始内部堆栈', async () => {
  const client = new MockAiClient();
  const card = createTestCard(client);
  const token = makeToken();

  await card.show(token, dummyRect);
  card.aiExplainButton.click();

  client.lastHandlers!.onError('UNKNOWN_ERROR', 'Safe sanitized error');
  assert.equal(card.aiErrorElement.textContent?.includes('Error: at Object.'), false);
  card.destroy();
});

test('F28: API Key never appears - 验证任何错误状态绝无 API Key 泄露', async () => {
  const fakeKey = 'sk-ant-test-key-should-not-leak';
  const client = new MockAiClient();
  const card = createTestCard(client);
  const token = makeToken();

  await card.show(token, dummyRect);
  card.aiExplainButton.click();

  client.lastHandlers!.onError('HTTP_ERROR', 'Safe message without key');
  const rendered = card.shadowRoot.innerHTML;
  assert.equal(rendered.includes(fakeKey), false);
  card.destroy();
});

// ============================================================================
// G. Security (29-32)
// ============================================================================

test('G29: <script> displayed as text - 恶意 script 标签一律作为普通纯文本呈现', async () => {
  const client = new MockAiClient();
  const card = createTestCard(client);
  const token = makeToken();

  await card.show(token, dummyRect);
  card.aiExplainButton.click();

  client.lastHandlers!.onChunk('<script>alert("xss")</script>');
  client.lastHandlers!.onDone();

  assert.equal(card.aiTextElement.textContent, '<script>alert("xss")</script>');
  assert.equal(card.shadowRoot.querySelectorAll('script').length, 0);
  card.destroy();
});

test('G30: <img onerror> displayed as text - 恶意 img 注入一律作为普通纯文本', async () => {
  const client = new MockAiClient();
  const card = createTestCard(client);
  const token = makeToken();

  await card.show(token, dummyRect);
  card.aiExplainButton.click();

  client.lastHandlers!.onChunk('<img src="x" onerror="alert(1)">');
  client.lastHandlers!.onDone();

  assert.equal(card.aiTextElement.textContent, '<img src="x" onerror="alert(1)">');
  assert.equal(card.shadowRoot.querySelectorAll('img').length, 0);
  card.destroy();
});

test('G31: HTML payload never becomes DOM - 绝不使用 innerHTML 解析 HTML 标签', async () => {
  const client = new MockAiClient();
  const card = createTestCard(client);
  const token = makeToken();

  await card.show(token, dummyRect);
  card.aiExplainButton.click();

  client.lastHandlers!.onChunk('<div class="injected"><p>hello</p></div>');
  client.lastHandlers!.onDone();

  assert.equal(card.shadowRoot.querySelectorAll('.injected').length, 0);
  assert.equal(card.aiTextElement.textContent, '<div class="injected"><p>hello</p></div>');
  card.destroy();
});

test('G32: malicious AI output cannot execute code - 网页 script 节点计数绝不增长', async () => {
  const initialScripts = document.querySelectorAll('script').length;
  const client = new MockAiClient();
  const card = createTestCard(client);
  const token = makeToken();

  await card.show(token, dummyRect);
  card.aiExplainButton.click();

  client.lastHandlers!.onChunk('<script>window.__hacked = true;</script>');
  client.lastHandlers!.onDone();

  assert.equal(document.querySelectorAll('script').length, initialScripts);
  assert.equal((window as any).__hacked, undefined);
  card.destroy();
});

// ============================================================================
// H. Token switch (33-37)
// ============================================================================

test('H33-H35: Token switch aborts old request and drops stale chunks', async () => {
  const client = new MockAiClient();
  const card = createTestCard(client);
  const tokenA = makeToken('Sediment', 'sediment');
  const tokenB = makeToken('Geology', 'geology');

  // A 开始推流
  await card.show(tokenA, dummyRect);
  card.aiExplainButton.click();
  const handlersA = client.lastHandlers!;
  handlersA.onChunk('Sediment definition');

  // 33 & 34: 切换到 Token B，自动中止 A
  await card.show(tokenB, dummyRect);
  assert.ok(client.abortedIds.includes('req_1'));
  assert.equal(card.aiUiState.kind, 'idle');

  // 35: A 迟到 chunk 坚决不进入卡片
  handlersA.onChunk(' late chunk A');
  assert.equal(card.aiTextElement.textContent, '');

  card.destroy();
});

test('H36: B dictionary remains correct - 切换后 Token B 的本地词典准确无误', async () => {
  const client = new MockAiClient();
  const card = createTestCard(client);
  const tokenA = makeToken('Sediment', 'sediment');
  const tokenB = makeToken('Geology', 'geology');

  await card.show(tokenA, dummyRect);
  await card.show(tokenB, dummyRect);

  assert.equal(card.shadowRoot.querySelector('.word')?.textContent, 'Geology');
  card.destroy();
});

test('H37: B can start independent AI request - Token B 可以独立发起全新 AI 请求', async () => {
  const client = new MockAiClient();
  const card = createTestCard(client);
  const tokenA = makeToken('Sediment', 'sediment');
  const tokenB = makeToken('Geology', 'geology');

  await card.show(tokenA, dummyRect);
  card.aiExplainButton.click();

  await card.show(tokenB, dummyRect);
  card.aiExplainButton.click();

  assert.equal(client.starts.length, 2);
  assert.equal(client.starts[1]?.payload.word, 'Geology');
  card.destroy();
});

// ============================================================================
// I. Card lifecycle (38-42)
// ============================================================================

test('I38: card remains singleton - 多次展示与 AI 请求下全局单例始终唯一', async () => {
  const client = new MockAiClient();
  const card = createTestCard(client);
  const token1 = makeToken('Word1', 'word1');
  const token2 = makeToken('Word2', 'word2');

  await card.show(token1, dummyRect);
  card.startAi();
  await card.show(token2, dummyRect);
  card.startAi();

  assert.equal(document.querySelectorAll('glint-card').length, 1);
  card.destroy();
});

test('I39: hide aborts active request - 卡片隐藏时自动取消进行中的 AI 请求', async () => {
  const client = new MockAiClient();
  const card = createTestCard(client);
  const token = makeToken();

  await card.show(token, dummyRect);
  card.startAi();
  assert.equal(client.activeRequestId, 'req_1');

  card.hide();
  assert.ok(client.abortedIds.includes('req_1'));
  assert.equal(card.aiUiState.kind, 'idle');
  card.destroy();
});

test('I40: scroll cleanup - 触发 hide 时自动清理', async () => {
  const client = new MockAiClient();
  const card = createTestCard(client);
  const token = makeToken();

  await card.show(token, dummyRect);
  card.startAi();

  // 滚动导致 hide 触发
  card.hide();
  assert.equal(card.currentToken, undefined);
  assert.ok(client.abortedIds.length > 0);
  card.destroy();
});

test('I41: pagehide cleanup - 页面卸载时 destroy 释放一切资源', async () => {
  const client = new MockAiClient();
  const card = createTestCard(client);
  const token = makeToken();

  await card.show(token, dummyRect);
  card.startAi();

  card.destroy();
  assert.equal(card.element.isConnected, false);
  assert.ok(client.abortedIds.includes('req_1'));
});

test('I42: no detached UI reference - destroy 彻底脱离 DOM', async () => {
  const card = createTestCard(new MockAiClient());
  card.destroy();
  assert.equal(card.element.isConnected, false);
});

// ============================================================================
// J. Context (43-47)
// ============================================================================

test('J43-J47: AI_START payload boundary - 验证上下文边界严格收敛', async () => {
  const client = new MockAiClient();
  const card = createTestCard(client);
  const token = makeToken('Rocks', 'rock');

  await card.show(token, dummyRect);
  card.aiExplainButton.click();

  const payload = client.starts[0]?.payload;
  assert.ok(payload);
  assert.equal(payload.word, 'Rocks');
  assert.equal(payload.lemma, 'rock');
  assert.equal(payload.sentence, 'The river deposits Rocks over time.');

  // 绝不包含整页、绝不包含 API Key
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes('Wikipedia'), false);
  assert.equal(serialized.includes('key'), false);
  card.destroy();
});

// ============================================================================
// K. Accessibility / UI semantics (48-51)
// ============================================================================

test('K48: AI action is a real button - 交互入口必须为原生 button 标签', () => {
  const card = createTestCard(new MockAiClient());
  assert.equal(card.aiExplainButton.tagName, 'BUTTON');
  assert.equal(card.aiCancelButton.tagName, 'BUTTON');
  card.destroy();
});

test('K49: button has accessible name - 按钮必须具有清晰的无障碍名称', () => {
  const card = createTestCard(new MockAiClient());
  assert.equal(card.aiExplainButton.getAttribute('aria-label'), 'AI 语境释义');
  assert.equal(card.aiCancelButton.getAttribute('aria-label'), '取消 AI 释义');
  card.destroy();
});

test('K50-K51: streaming and error states are distinguishable - 状态语义明确可区分', async () => {
  const client = new MockAiClient();
  const card = createTestCard(client);
  const token = makeToken();

  await card.show(token, dummyRect);
  card.aiExplainButton.click();

  client.lastHandlers!.onChunk('part');
  assert.equal(card.aiUiState.kind, 'streaming');
  assert.equal(card.aiTextElement.hidden, false);

  client.lastHandlers!.onError('HTTP_ERROR', 'error state');
  assert.equal(card.aiUiState.kind, 'error');
  assert.equal(card.aiErrorElement.hidden, false);
  card.destroy();
});

// ============================================================================
// Performance Test: High-frequency stream batching (52)
// ============================================================================

test('Performance 52: 高频流式打字机压力测试 (100, 500, 1000 chunks batching)', async () => {
  const client = new MockAiClient();
  const card = createTestCard(client);
  const token = makeToken();

  await card.show(token, dummyRect);
  card.aiExplainButton.click();
  const handlers = client.lastHandlers!;

  const startMs = Date.now();

  // 模拟 1,000 个高频连续 chunk (每个 chunk 约 4 个字符)
  for (let i = 0; i < 1000; i++) {
    handlers.onChunk('word ');
  }
  handlers.onDone();

  const elapsedMs = Date.now() - startMs;
  const fullText = card.aiTextElement.textContent ?? '';

  assert.equal(fullText.length, 5000);
  assert.equal(fullText.startsWith('word word word '), true);
  assert.ok(elapsedMs < 200, `1,000 chunks 处理耗时应在 200ms 以内 (实际: ${elapsedMs}ms)`);

  card.destroy();
});
