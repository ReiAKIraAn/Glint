import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { Card } from '../src/lib/card';
import { canSpeak, cancelSpeech, speak } from '../src/lib/speak';
import { ScannedToken } from '../src/lib/scan';
import type { DictEntry } from '../src/lib/types';

/**
 * [Automated Regression Test - Milestone 5 / Workstream 1: TTS Restoration]
 * 涵盖 TTS-01 到 TTS-10 全部严密断言
 */

let window: Window;
let mockSpeechSynthesis: {
  getVoices: () => Array<{ lang: string; localService: boolean; name: string }>;
  cancel: () => void;
  speak: (u: unknown) => void;
  speaking: boolean;
  paused: boolean;
  pending: boolean;
};
let cancelCallCount = 0;
let speakCallCount = 0;
let lastSpokenUtterance: { text: string; lang: string; rate: number; voice: unknown } | null = null;
let fetchCallCount = 0;

class MockSpeechSynthesisUtterance {
  text: string;
  lang = '';
  rate = 1;
  voice: unknown = null;
  constructor(text: string) {
    this.text = text;
  }
}

function setupMockSpeech(voices: Array<{ lang: string; localService: boolean; name: string }> = [
  { lang: 'en-US', localService: true, name: 'Samantha (Local)' },
  { lang: 'en-GB', localService: true, name: 'Daniel (Local)' },
]) {
  cancelCallCount = 0;
  speakCallCount = 0;
  lastSpokenUtterance = null;
  fetchCallCount = 0;

  mockSpeechSynthesis = {
    getVoices: () => voices,
    cancel: () => {
      cancelCallCount++;
    },
    speak: (u: unknown) => {
      speakCallCount++;
      lastSpokenUtterance = u as { text: string; lang: string; rate: number; voice: unknown };
    },
    speaking: false,
    paused: false,
    pending: false,
  };

  (globalThis as Record<string, unknown>).speechSynthesis = mockSpeechSynthesis;
  (globalThis as Record<string, unknown>).SpeechSynthesisUtterance = MockSpeechSynthesisUtterance;
}

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
  ] as const) {
    (globalThis as Record<string, unknown>)[key] = (window as unknown as Record<string, unknown>)[key];
  }

  // 监控全局 fetch
  (globalThis as Record<string, unknown>).fetch = async () => {
    fetchCallCount++;
    throw new Error('TTS must never make network requests');
  };
});

beforeEach(() => {
  setupMockSpeech();
});

test('TTS-01: 当本机存在离线英文语音时，卡片展示发音小喇叭按钮', async () => {
  assert.strictEqual(canSpeak(), true, 'canSpeak 必须返回 true');

  const card = new Card({
    lookup: async () => ({
      phonetic: 'ˈsɛdɪmənt',
      translation: 'n. 沉淀物',
      tags: [],
      rank: 100,
    }),
    onKnown: () => {},
    onPointerEnter: () => {},
    onPointerLeave: () => {},
  });

  card.mount();
  const textNode = document.createTextNode('Sediment rocks');
  document.body.append(textNode);
  const token = new ScannedToken(textNode, 0, 8, 'Sediment', 'sediment', 3);

  await card.show(token, new DOMRect(10, 20, 30, 40));

  const speakBtn = card.speakButton;
  assert.ok(speakBtn, 'speakButton 必须存在');
  assert.strictEqual(speakBtn.hidden, false, '发音按钮在支持环境下必须可见');
  assert.strictEqual(speakBtn.getAttribute('title'), '朗读');
  assert.strictEqual(speakBtn.getAttribute('aria-label'), '朗读 Sediment');
  assert.strictEqual(speakBtn.dataset.act, 'speak');
  assert.ok(speakBtn.querySelector('svg'), '发音按钮内必须包含清晰的喇叭矢量图标');

  card.destroy();
});

test('TTS-02: 用户点击发音按钮，直接触发原生 speak() 朗读单词', async () => {
  const card = new Card({
    lookup: async () => ({
      phonetic: 'ˈsɛdɪmənt',
      translation: 'n. 沉淀物',
      tags: [],
      rank: 100,
    }),
    onKnown: () => {},
    onPointerEnter: () => {},
    onPointerLeave: () => {},
  });

  card.mount();
  const textNode = document.createTextNode('Sediment');
  document.body.append(textNode);
  const token = new ScannedToken(textNode, 0, 8, 'Sediment', 'sediment', 3);

  await card.show(token, new DOMRect(10, 20, 30, 40));

  const speakBtn = card.speakButton;
  assert.strictEqual(speakCallCount, 0);

  // 模拟用户手势点击小喇叭
  speakBtn.click();

  assert.strictEqual(speakCallCount, 1, '点击后必须调用一次 speechSynthesis.speak');
  assert.ok(lastSpokenUtterance, '必须创建 utterance 实例');
  assert.strictEqual(lastSpokenUtterance.text, 'Sediment', '发音文本必须为词面 surface');
  assert.strictEqual(lastSpokenUtterance.lang, 'en-US', '兜底语言必须设置为 en-US');
  assert.strictEqual(lastSpokenUtterance.rate, 0.9, '发音语速必须设置为 0.9');

  card.destroy();
});

test('TTS-03: 连续多次点击小喇叭，先 cancel 清空队列，不产生多重发音堆叠', () => {
  speak('apple');
  assert.strictEqual(cancelCallCount, 1);
  assert.strictEqual(speakCallCount, 1);
  assert.strictEqual(lastSpokenUtterance?.text, 'apple');

  // 第二次点击
  speak('apple');
  assert.strictEqual(cancelCallCount, 2, '第二次调用前必须先 cancel');
  assert.strictEqual(speakCallCount, 2);

  // 第三次连续点击另一个词
  speak('banana');
  assert.strictEqual(cancelCallCount, 3, '第三次调用前必须先 cancel');
  assert.strictEqual(speakCallCount, 3);
  assert.strictEqual(lastSpokenUtterance?.text, 'banana');
});

test('TTS-04: 严格离线原则 - 仅选取 localService === true 的本地语音，拒绝网络语音', () => {
  // 模拟只有 Google 网络语音的情况 (localService: false)
  setupMockSpeech([
    { lang: 'en-US', localService: false, name: 'Google US English (Remote Network)' },
  ]);

  assert.strictEqual(canSpeak(), false, '在只有远程网络语音的环境下，canSpeak 必须返回 false');

  speak('privacy');
  assert.strictEqual(speakCallCount, 0, '没有本地离线语音时，speak 必须静默退出，严禁把单词发往远程');

  // 模拟同时有网络语音和离线语音
  setupMockSpeech([
    { lang: 'en-US', localService: false, name: 'Google Network Voice' },
    { lang: 'en-US', localService: true, name: 'Samantha (macOS System Local)' },
  ]);

  assert.strictEqual(canSpeak(), true, '只要存在本地离线语音即返回 true');
  speak('local');
  assert.strictEqual(speakCallCount, 1);
  assert.strictEqual((lastSpokenUtterance?.voice as { localService: boolean }).localService, true);
});

test('TTS-05: 朗读过程零网络请求 (Zero Network Request)', async () => {
  fetchCallCount = 0;

  speak('network_free');
  assert.strictEqual(fetchCallCount, 0, 'speak() 绝对不发起任何网络请求');

  const card = new Card({
    lookup: async () => ({ phonetic: 'test', translation: '测试', tags: [], rank: 1 }),
    onKnown: () => {},
    onPointerEnter: () => {},
    onPointerLeave: () => {},
  });
  card.mount();
  const textNode = document.createTextNode('test');
  document.body.append(textNode);
  await card.show(new ScannedToken(textNode, 0, 4, 'test', 'test', 2), new DOMRect(0, 0, 10, 10));

  card.speakButton.click();
  assert.strictEqual(fetchCallCount, 0, '点击小喇叭绝对不发起任何网络请求');

  card.destroy();
});

test('TTS-06: 朗读期间或朗读后隐藏卡片 card.hide() 安全不抛错', async () => {
  const card = new Card({
    lookup: async () => ({ phonetic: 'hide_test', translation: '测试', tags: [], rank: 1 }),
    onKnown: () => {},
    onPointerEnter: () => {},
    onPointerLeave: () => {},
  });
  card.mount();
  const textNode = document.createTextNode('hide_test');
  document.body.append(textNode);
  await card.show(new ScannedToken(textNode, 0, 9, 'hide_test', 'hide_test', 2), new DOMRect(0, 0, 10, 10));

  card.speakButton.click();
  assert.strictEqual(speakCallCount, 1);

  // 隐藏卡片
  assert.doesNotThrow(() => {
    card.hide();
  }, 'card.hide() 绝不抛出任何异常');

  assert.strictEqual(card.currentToken, undefined);
  card.destroy();
});

test('TTS-07: 页面卸载或卡片销毁时触发 cancelSpeech() 清空语音队列', async () => {
  const card = new Card({
    lookup: async () => ({ phonetic: 'cancel_test', translation: '测试', tags: [], rank: 1 }),
    onKnown: () => {},
    onPointerEnter: () => {},
    onPointerLeave: () => {},
  });
  card.mount();
  const textNode = document.createTextNode('cancel_test');
  document.body.append(textNode);
  await card.show(new ScannedToken(textNode, 0, 11, 'cancel_test', 'cancel_test', 2), new DOMRect(0, 0, 10, 10));

  card.speakButton.click();
  const countBefore = cancelCallCount;

  // 卡片销毁
  card.destroy();
  assert.ok(cancelCallCount > countBefore, 'card.destroy() 必须调用 cancelSpeech() 排空队列');

  // 直接调用 cancelSpeech()
  cancelSpeech();
  assert.ok(cancelCallCount > countBefore + 1, 'cancelSpeech() 正常调用 speechSynthesis.cancel()');
});

test('TTS-08: 网页恶意 Token 文本 XSS 防护与纯文本安全性', async () => {
  const maliciousSurface = '<script>alert("xss")</script>';
  const card = new Card({
    lookup: async () => ({
      phonetic: 'evil',
      translation: '恶意',
      tags: [],
      rank: 1,
    }),
    onKnown: () => {},
    onPointerEnter: () => {},
    onPointerLeave: () => {},
  });
  card.mount();
  const textNode = document.createTextNode(maliciousSurface);
  document.body.append(textNode);
  const maliciousToken = new ScannedToken(textNode, 0, maliciousSurface.length, maliciousSurface, 'evil', 7);

  await card.show(maliciousToken, new DOMRect(0, 0, 10, 10));

  const speakBtn = card.speakButton;
  // 验证 aria-label 包含纯文本，未创建 script 标签
  assert.strictEqual(speakBtn.getAttribute('aria-label'), `朗读 ${maliciousSurface}`);
  assert.strictEqual(card.shadowRoot.querySelectorAll('script').length, 0, '严禁生成 script 标签');

  // 点击朗读
  speakBtn.click();
  assert.strictEqual(lastSpokenUtterance?.text, maliciousSurface, 'Utterance 接收纯文本字符串');

  card.destroy();
});

test('TTS-09: 键盘可访问性与语义无障碍 (Accessibility & Keyboard)', async () => {
  const card = new Card({
    lookup: async () => ({ phonetic: 'a11y', translation: '无障碍', tags: [], rank: 1 }),
    onKnown: () => {},
    onPointerEnter: () => {},
    onPointerLeave: () => {},
  });
  card.mount();
  const textNode = document.createTextNode('a11y');
  document.body.append(textNode);
  await card.show(new ScannedToken(textNode, 0, 4, 'a11y', 'a11y', 2), new DOMRect(0, 0, 10, 10));

  const speakBtn = card.speakButton;
  assert.strictEqual(speakBtn.tagName.toLowerCase(), 'button', '必须采用原生 button 元素');
  assert.strictEqual(speakBtn.type, 'button', 'type 必须为 button');
  assert.ok(speakBtn.hasAttribute('aria-label'), '必须具有 aria-label');
  assert.ok(speakBtn.hasAttribute('title'), '必须具有 title 属性');

  // 内部 SVG 包含 aria-hidden="true" 避免读屏器误读图标无用路径
  const svg = speakBtn.querySelector('svg');
  assert.ok(svg);
  assert.strictEqual(svg.getAttribute('aria-hidden'), 'true');

  card.destroy();
});

test('TTS-10: Web Speech API 不存在或抛错时的安全优雅降级', async () => {
  // 模拟没有 Speech API 的环境
  delete (globalThis as Record<string, unknown>).speechSynthesis;
  delete (globalThis as Record<string, unknown>).SpeechSynthesisUtterance;

  assert.strictEqual(canSpeak(), false, 'API 缺失时 canSpeak 返回 false');

  // 调用 speak 不抛出任何异常
  assert.doesNotThrow(() => {
    speak('test');
    cancelSpeech();
  });

  // 卡片在不支持 TTS 的环境下仍能正常展示词典与音标，喇叭按钮安全隐藏
  const card = new Card({
    lookup: async () => ({ phonetic: 'no_tts', translation: '无发音', tags: [], rank: 1 }),
    onKnown: () => {},
    onPointerEnter: () => {},
    onPointerLeave: () => {},
  });
  card.mount();
  const textNode = document.createTextNode('no_tts');
  document.body.append(textNode);

  await card.show(new ScannedToken(textNode, 0, 6, 'no_tts', 'no_tts', 2), new DOMRect(0, 0, 10, 10));

  assert.strictEqual(card.speakButton.hidden, true, 'TTS 不可用时小喇叭必须隐藏');
  assert.strictEqual(card.shadowRoot.querySelector('.phonetic-text')?.textContent, '/no_tts/');

  card.destroy();
});
