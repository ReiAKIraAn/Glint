import { LEVEL_NAMES, UNKNOWN_LEVEL, type Analysis, type DictEntry, type Explained } from './types';
import type { Token } from './scan';
import { OWN_ELEMENT } from './scan';
import type { AiStreamClient } from './ai-port';
import { canSpeak, cancelSpeech, speak } from './speak';
import { putExplanation } from './explanation-cache';

function createSpeakerSvg(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.4');
  svg.setAttribute('aria-hidden', 'true');

  const p1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p1.setAttribute('d', 'M7.2 3.4 4.3 5.9H2.3v4.2h2l2.9 2.5z');
  p1.setAttribute('fill', 'currentColor');
  p1.setAttribute('stroke-linejoin', 'round');

  const p2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p2.setAttribute('d', 'M9.9 6.2a2.7 2.7 0 0 1 0 3.6');
  p2.setAttribute('stroke-linecap', 'round');

  const p3 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p3.setAttribute('d', 'M11.9 4.3a5.3 5.3 0 0 1 0 7.4');
  p3.setAttribute('stroke-linecap', 'round');

  svg.append(p1, p2, p3);
  return svg;
}

function createRedoSvg(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');

  const p1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p1.setAttribute('d', 'M13.5 8a5.5 5.5 0 1 1-1.6-3.9L14 6');

  const p2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p2.setAttribute('d', 'M14 2.5V6h-3.5');

  svg.append(p1, p2);
  return svg;
}



/** ECDICT 的考试标签，展示成人话。 */
export const TAG_LABELS: Record<string, string> = {
  zk: '中考',
  gk: '高考',
  cet4: '四级',
  cet6: '六级',
  ky: '考研',
  toefl: '托福',
  ielts: '雅思',
  gre: 'GRE',
};

export interface ResolveCardExplanationParams {
  localExplanation?: string | null;
  cachedAIExplanation?: string | null;
}

/**
 * 确定卡片应展示的最终释义（纯函数）
 *
 * 优先级规范：
 * 1. AI 缓存存在且非空 -> 返回 AI explanation；
 * 2. 否则，本地词典存在且非空 -> 返回 local explanation；
 * 3. 否则 -> 返回空字符串 ''（触发卡片现有的 empty/unavailable 提示状态）。
 */
export function resolveCardExplanation(params: ResolveCardExplanationParams): string {
  const ai = (params.cachedAIExplanation ?? '').trim();
  if (ai) {
    return ai;
  }
  const local = (params.localExplanation ?? '').trim();
  if (local) {
    return local;
  }
  return '';
}

export type AiUiState =
  | { kind: 'idle' }
  | { kind: 'loading'; requestId: string }
  | { kind: 'streaming'; requestId: string; text: string }
  | { kind: 'done'; requestId: string; text: string }
  | { kind: 'error'; requestId: string; code: string; message: string; text: string }
  | { kind: 'aborted'; requestId: string; text: string };

export interface CardDeps {
  /** 本地词库，秒回 */
  lookup(word: string): Promise<DictEntry | null>;
  /** AI 流式客户端 (Milestone 4 Step 3) */
  aiClient?: Pick<AiStreamClient, 'start' | 'abort' | 'getActiveRequestId'>;
  /** 提取 Token 所在单句 (Milestone 4 Step 3) */
  sentenceOf?(token: Token): string;
  /** 调 AI 做语境释义（预留给后续里程碑） */
  analyze?(token: Token): Promise<{ ok: true; analysis: Analysis } | { ok: false; error: string }>;
  /** AI 是否已配置好 */
  aiReady?(): Promise<boolean>;
  /** M5-W2: 本地缓存释义查询 */
  getCachedExplanation?(word: string): Promise<string | null>;
  /** M5-W15: 写入本地缓存释义 */
  putCachedExplanation?(word: string, explanation: string): Promise<void>;
  /** 缓存释义 */
  cached?(lemma: string): Explained | null;
  onKnown(lemma: string): void;
  /** 鼠标进出卡片本身，用来抑制 HoverTracker 的关闭逻辑 */
  onPointerEnter(): void;
  onPointerLeave(): void;
}

const GAP = 8;
const WIDTH = 400;
const MIN_HEIGHT = 120;
const EXIT_MS = 110;

/**
 * 悬浮卡片组件 (Safari Technology Preview 专有优化版)
 *
 * 核心设计：
 * 1. 结构复用：单例 DOM 节点在构造时一次性创建完毕，后续 hover 仅更新 textContent，
 *    零 DOM 销毁重建、零 DOM 碎片泄露、零垃圾回收（GC）抖动。
 * 2. 绝对安全：所有展示内容（包括网页提取的 surface、lemma 以及词典文本）一律通过
 *    .textContent 注入，严禁 innerHTML，将外部文本一律视作不可信数据。
 * 3. 布局稳定：自适应视口上下侧空间（pickSide），避免遮挡目标词汇与视口溢出。
 */
export class Card {
  private host: HTMLElement;
  private shadow: ShadowRoot;
  private box: HTMLDivElement;

  // 固化的可复用子 DOM 节点
  private headEl: HTMLDivElement;
  private wordEl: HTMLSpanElement;
  private lemmaEl: HTMLSpanElement;
  private badgeEl: HTMLSpanElement;
  private phoneticEl: HTMLDivElement;
  private phoneticTextEl: HTMLSpanElement;
  private speakBtn: HTMLButtonElement;
  private tagsEl: HTMLDivElement;
  private transEl: HTMLDivElement;
  private aiSectionEl: HTMLDivElement;
  private aiActionsEl: HTMLDivElement;
  private aiExplainBtn: HTMLButtonElement;
  private aiRedoBtn: HTMLButtonElement;
  private aiCancelBtn: HTMLButtonElement;
  private aiStatusEl: HTMLDivElement;
  private aiTextEl: HTMLDivElement;
  private aiErrorEl: HTMLDivElement;
  private footEl: HTMLDivElement;
  private knownBtn: HTMLButtonElement;

  private aiState: AiUiState = { kind: 'idle' };
  private pendingAiText = '';
  private rafId: number | null = null;

  private token?: Token;
  private rect?: DOMRect;
  private entry: DictEntry | null = null;
  private cachedAi: string | null = null;
  private epoch = 0;
  private pointerInside = false;
  private below = true;
  private unmountTimer?: ReturnType<typeof setTimeout>;

  constructor(private deps: CardDeps) {
    this.host = document.createElement(OWN_ELEMENT);
    this.host.style.cssText = 'all: initial; position: fixed; z-index: 2147483646;';
    this.shadow = this.host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = CSS_TEXT;

    this.box = document.createElement('div');
    this.box.className = 'card';
    this.box.tabIndex = -1;
    this.box.setAttribute('role', 'dialog');
    this.box.setAttribute('aria-label', '词义卡片');

    // 1. 头部：单词、原形、等级徽章
    this.headEl = document.createElement('div');
    this.headEl.className = 'head';
    this.wordEl = document.createElement('span');
    this.wordEl.className = 'word';
    this.lemmaEl = document.createElement('span');
    this.lemmaEl.className = 'lemma';
    this.lemmaEl.title = '页面上这个词是变形，下面的释义查的是它的原形';
    this.badgeEl = document.createElement('span');
    this.badgeEl.className = 'badge';
    this.headEl.append(this.wordEl, this.lemmaEl, this.badgeEl);

    // 2. 音标行与发音朗读按钮 (Milestone 5 M5-W1)
    this.phoneticEl = document.createElement('div');
    this.phoneticEl.className = 'phonetic';

    this.phoneticTextEl = document.createElement('span');
    this.phoneticTextEl.className = 'phonetic-text';

    this.speakBtn = document.createElement('button');
    this.speakBtn.type = 'button';
    this.speakBtn.className = 'speak';
    this.speakBtn.dataset.act = 'speak';
    this.speakBtn.title = '朗读';
    this.speakBtn.setAttribute('aria-label', '朗读发音');
    this.speakBtn.hidden = true;
    this.speakBtn.append(createSpeakerSvg());

    this.phoneticEl.append(this.phoneticTextEl, this.speakBtn);

    // 3. 标签行
    this.tagsEl = document.createElement('div');
    this.tagsEl.className = 'tags';

    // 4. 中文释义行
    this.transEl = document.createElement('div');
    this.transEl.className = 'zh';

    // 5. AI 语境释义区域 (Milestone 4 Step 3)
    this.aiSectionEl = document.createElement('div');
    this.aiSectionEl.className = 'ai-section';

    this.aiActionsEl = document.createElement('div');
    this.aiActionsEl.className = 'ai-actions';

    this.aiExplainBtn = document.createElement('button');
    this.aiExplainBtn.type = 'button';
    this.aiExplainBtn.className = 'ai-btn ai-explain-btn';
    this.aiExplainBtn.dataset.act = 'ai-explain';
    this.aiExplainBtn.setAttribute('aria-label', 'AI 语境释义');
    this.aiExplainBtn.textContent = '✨ AI 解释';

    this.aiRedoBtn = document.createElement('button');
    this.aiRedoBtn.type = 'button';
    this.aiRedoBtn.className = 'ai-btn ai-redo-btn';
    this.aiRedoBtn.dataset.act = 'ai-redo';
    this.aiRedoBtn.setAttribute('aria-label', '重新生成 AI 释义');
    this.aiRedoBtn.title = '重新生成';
    this.aiRedoBtn.hidden = true;
    this.aiRedoBtn.append(createRedoSvg());

    this.aiCancelBtn = document.createElement('button');
    this.aiCancelBtn.type = 'button';
    this.aiCancelBtn.className = 'ai-btn ai-cancel-btn';
    this.aiCancelBtn.dataset.act = 'ai-cancel';
    this.aiCancelBtn.setAttribute('aria-label', '取消 AI 释义');
    this.aiCancelBtn.textContent = '取消';
    this.aiCancelBtn.hidden = true;

    this.aiActionsEl.append(this.aiExplainBtn, this.aiRedoBtn, this.aiCancelBtn);

    this.aiStatusEl = document.createElement('div');
    this.aiStatusEl.className = 'ai-status';
    this.aiStatusEl.hidden = true;

    this.aiTextEl = document.createElement('div');
    this.aiTextEl.className = 'ai-text';
    this.aiTextEl.setAttribute('role', 'region');
    this.aiTextEl.setAttribute('aria-label', 'AI 语境释义结果');
    this.aiTextEl.hidden = true;

    this.aiErrorEl = document.createElement('div');
    this.aiErrorEl.className = 'ai-error';
    this.aiErrorEl.setAttribute('role', 'alert');
    this.aiErrorEl.hidden = true;

    this.aiSectionEl.append(this.aiActionsEl, this.aiStatusEl, this.aiTextEl, this.aiErrorEl);
    this.aiSectionEl.hidden = !this.deps.aiClient;

    // 6. 底部栏：认识按钮
    this.footEl = document.createElement('div');
    this.footEl.className = 'foot';
    this.knownBtn = document.createElement('button');
    this.knownBtn.className = 'known';
    this.knownBtn.dataset.act = 'known';
    this.knownBtn.title = '以后全站不再标注这个词';
    this.knownBtn.textContent = '✓ 认识';
    this.footEl.append(this.knownBtn);

    this.box.append(this.headEl, this.phoneticEl, this.tagsEl, this.transEl, this.aiSectionEl, this.footEl);
    this.shadow.append(style, this.box);

    this.host.addEventListener('pointerenter', () => {
      this.pointerInside = true;
      this.deps.onPointerEnter();
    });
    this.host.addEventListener('pointerleave', () => {
      this.pointerInside = false;
      this.deps.onPointerLeave();
    });
    this.box.addEventListener('click', this.onClick);
  }

  /** 键盘导航把焦点送入卡片容器 */
  focus() {
    this.box.focus({ preventScroll: true });
  }

  /** 供外部或 MutationObserver 识别扩展专属容器 */
  get element(): HTMLElement {
    return this.host;
  }

  /** 供测试用例检查当前展示的 Token */
  get currentToken(): Token | undefined {
    return this.token;
  }

  /** 供测试用例检查发音朗读按钮 */
  get speakButton(): HTMLButtonElement {
    return this.speakBtn;
  }

  /** 供测试用例检查 ShadowRoot 中的子节点状态 */
  get shadowRoot(): ShadowRoot {
    return this.shadow;
  }

  /** 供测试用例检查卡片释义区域 DOM 节点 */
  get translationElement(): HTMLDivElement {
    return this.transEl;
  }

  mount() {
    if (!this.host.isConnected) document.body.append(this.host);
    this.host.style.display = 'none';
  }

  destroy() {
    this.abortAi();
    this.cancelPendingRaf();
    clearTimeout(this.unmountTimer);
    cancelSpeech();
    this.host.remove();
  }


  hide() {
    this.abortAi();
    this.resetAiUi();
    this.token = undefined;
    this.cachedAi = null;
    this.entry = null;
    this.epoch++; // 作废正在进行的异步查词
    if (this.host.style.display === 'none') return;
    this.box.classList.remove('is-open');
    clearTimeout(this.unmountTimer);
    this.unmountTimer = setTimeout(() => {
      this.host.style.display = 'none';
    }, EXIT_MS);
  }

  async show(token: Token, rect: DOMRect) {
    if (this.token !== token) {
      this.abortAi();
      this.resetAiUi();
      this.cachedAi = null;
    }
    this.token = token;
    this.rect = rect;
    this.entry = null;
    const epoch = ++this.epoch;

    clearTimeout(this.unmountTimer);

    // 1. 同步即时更新头部（安全 textContent 写入）
    this.wordEl.textContent = token.surface;
    if (token.lemma && token.lemma.toLowerCase() !== token.surface.toLowerCase()) {
      this.lemmaEl.textContent = `原形 ${token.lemma}`;
      this.lemmaEl.hidden = false;
    } else {
      this.lemmaEl.textContent = '';
      this.lemmaEl.hidden = true;
    }

    const levelName = token.level === UNKNOWN_LEVEL ? '生僻' : LEVEL_NAMES[token.level] || '';
    this.badgeEl.textContent = levelName;
    this.badgeEl.dataset.level = String(token.level);

    // 2. 初始化重置下方词典内容区域
    this.phoneticTextEl.textContent = '';
    const speakable = canSpeak();
    this.speakBtn.hidden = !speakable;
    if (speakable) {
      this.speakBtn.setAttribute('aria-label', `朗读 ${token.surface}`);
    }
    this.phoneticEl.hidden = !speakable;
    this.tagsEl.replaceChildren();
    this.tagsEl.hidden = true;
    this.transEl.className = 'zh muted';
    this.transEl.textContent = '查询中...';

    // 3. AI 语境释义区域初始化（不自动请求，仅显式展示入口）
    this.aiSectionEl.hidden = !this.deps.aiClient;
    if (this.aiState.kind === 'idle') {
      this.aiExplainBtn.hidden = false;
      this.aiRedoBtn.hidden = true;
      this.aiCancelBtn.hidden = true;
      this.aiStatusEl.hidden = true;
      this.aiTextEl.hidden = true;
      this.aiErrorEl.hidden = true;
    }

    // 4. 展现并初步定位
    this.host.style.display = 'block';
    const animate = document.visibilityState === 'visible';
    this.box.style.transition = animate ? '' : 'none';
    this.position(rect);
    this.box.classList.add('is-open');

    // 5. 异步并行拉取本地词典数据与 AI 缓存
    const lookupKey = token.lemma || token.surface;
    const [entry, cachedAi] = await Promise.all([
      this.deps.lookup(token.lemma),
      this.deps.getCachedExplanation
        ? this.deps.getCachedExplanation(lookupKey).catch(() => null)
        : Promise.resolve(null),
    ]);
    if (epoch !== this.epoch) return;

    this.entry = entry;
    this.cachedAi = cachedAi && cachedAi.trim() ? cachedAi.trim() : null;
    this.renderEntry(entry);

    if (this.aiState.kind === 'idle') {
      if (this.cachedAi) {
        this.aiExplainBtn.hidden = true;
        this.aiRedoBtn.hidden = false;
      } else {
        this.aiExplainBtn.hidden = false;
        this.aiRedoBtn.hidden = true;
      }
    }

    // 词典数据填充后高度可能变化，平滑重定位一次
    if (this.rect) this.position(this.rect);
  }

  get aiUiState(): AiUiState {
    return this.aiState;
  }

  get aiExplainButton(): HTMLButtonElement {
    return this.aiExplainBtn;
  }

  get aiRedoButton(): HTMLButtonElement {
    return this.aiRedoBtn;
  }

  get aiCancelButton(): HTMLButtonElement {
    return this.aiCancelBtn;
  }

  async redoAi(): Promise<void> {
    return this.startAi({ bypassCache: true });
  }

  get aiStatusElement(): HTMLDivElement {
    return this.aiStatusEl;
  }

  get aiTextElement(): HTMLDivElement {
    return this.aiTextEl;
  }

  get aiErrorElement(): HTMLDivElement {
    return this.aiErrorEl;
  }

  async startAi(opts?: { bypassCache?: boolean }) {
    if (!this.token) return;
    if (!this.deps.aiClient) return;

    if (this.aiState.kind === 'loading' || this.aiState.kind === 'streaming') {
      this.abortAi();
    }

    this.cancelPendingRaf();
    const token = this.token;
    const lookupKey = token.lemma || token.surface;

    // M5-W2: Cache Read
    // 优先本地缓存，若命中则立即显示并切换至 done 态，坚决不发送 AI_START
    if (!opts?.bypassCache && this.deps.getCachedExplanation) {
      try {
        const cached = await this.deps.getCachedExplanation(lookupKey);
        if (this.token !== token) return;
        if (cached && cached.trim()) {
          const trimmed = cached.trim();
          this.cachedAi = trimmed;
          this.renderExplanation(trimmed);
          this.aiState = { kind: 'done', requestId: 'cached', text: trimmed };
          this.aiExplainBtn.hidden = true;
          this.aiRedoBtn.hidden = false;
          this.aiCancelBtn.hidden = true;
          this.aiStatusEl.hidden = true;
          this.aiStatusEl.textContent = '';
          this.aiErrorEl.hidden = true;
          this.aiErrorEl.textContent = '';
          this.aiTextEl.hidden = false;
          this.aiTextEl.textContent = trimmed;
          if (this.rect) this.position(this.rect);
          return;
        }
      } catch (err) {
        console.warn('[Glint] Failed to read explanation cache:', err);
      }
    }

    if (this.token !== token) return;
    const sentence = this.deps.sentenceOf ? this.deps.sentenceOf(token) : token.surface;

    // 清除上一轮 AI 内容并切换至 loading
    this.aiExplainBtn.hidden = true;
    this.aiRedoBtn.hidden = true;
    this.aiCancelBtn.hidden = false;
    this.aiStatusEl.hidden = false;
    this.aiStatusEl.textContent = 'AI 正在分析语境...';
    this.aiTextEl.hidden = true;
    this.aiTextEl.textContent = '';
    this.aiErrorEl.hidden = true;
    this.aiErrorEl.textContent = '';

    const requestId = this.deps.aiClient.start(
      {
        word: token.surface,
        lemma: token.lemma,
        sentence,
      },
      {
        onChunk: (text: string) => {
          if (this.aiState.kind !== 'loading' && this.aiState.kind !== 'streaming') return;
          if (this.aiState.requestId !== requestId) return;
          if (this.aiState.kind === 'loading') {
            this.aiState = { kind: 'streaming', requestId, text: '' };
            this.aiStatusEl.hidden = true;
            this.aiTextEl.hidden = false;
          }
          this.pendingAiText += text;
          this.scheduleAiRender();
        },
        onDone: async () => {
          if (this.aiState.kind !== 'loading' && this.aiState.kind !== 'streaming') return;
          if (this.aiState.requestId !== requestId) return;
          this.flushAiRender();
          const finalText = this.aiState.kind === 'streaming' ? this.aiState.text : '';
          this.aiState = { kind: 'done', requestId, text: finalText };
          this.aiCancelBtn.hidden = true;
          this.aiStatusEl.hidden = true;

          const trimmed = finalText.trim();
          if (trimmed) {
            this.cachedAi = trimmed;
            this.renderExplanation(trimmed);
            const putCache = this.deps.putCachedExplanation ?? putExplanation;
            try {
              await putCache(lookupKey, trimmed);
            } catch (err) {
              console.warn('[Glint] Failed to save AI explanation cache:', err);
            }
            this.aiRedoBtn.hidden = false;
            this.aiExplainBtn.hidden = true;
          } else {
            // 空白输出视作失败：恢复先前释义，旧缓存保持不变
            this.renderExplanation(this.cachedAi ?? undefined);
            if (this.cachedAi) {
              this.aiRedoBtn.hidden = false;
              this.aiExplainBtn.hidden = true;
            } else {
              this.aiRedoBtn.hidden = true;
              this.aiExplainBtn.hidden = false;
              this.aiExplainBtn.textContent = '重试 AI 解释';
            }
          }

          if (this.rect) this.position(this.rect);
        },
        onError: (_code: string, message: string) => {
          if (this.aiState.kind !== 'loading' && this.aiState.kind !== 'streaming') return;
          if (this.aiState.requestId !== requestId) return;
          this.flushAiRender();
          const textSoFar = this.aiState.kind === 'streaming' ? this.aiState.text : '';
          this.aiState = { kind: 'error', requestId, code: _code, message, text: textSoFar };
          this.aiCancelBtn.hidden = true;
          this.aiStatusEl.hidden = true;
          this.aiErrorEl.hidden = false;
          this.aiErrorEl.textContent = message;

          // 恢复旧释义（Redo 前的 AI 释义，或若无则恢复本地词典）
          this.renderExplanation(this.cachedAi ?? undefined);

          if (this.cachedAi) {
            this.aiRedoBtn.hidden = false;
            this.aiExplainBtn.hidden = true;
          } else {
            this.aiRedoBtn.hidden = true;
            this.aiExplainBtn.hidden = false;
            this.aiExplainBtn.textContent = '重试 AI 解释';
          }
          if (this.rect) this.position(this.rect);
        },
      },
    );

    this.aiState = { kind: 'loading', requestId };
    if (this.rect) this.position(this.rect);
  }

  abortAi() {
    if (this.aiState.kind === 'loading' || this.aiState.kind === 'streaming') {
      const reqId = this.aiState.requestId;
      this.flushAiRender();
      this.cancelPendingRaf();
      this.deps.aiClient?.abort();
      const textSoFar = this.aiState.kind === 'streaming' ? this.aiState.text : '';
      this.aiState = { kind: 'aborted', requestId: reqId, text: textSoFar };
      this.aiCancelBtn.hidden = true;
      this.aiStatusEl.hidden = false;
      this.aiStatusEl.textContent = '（已取消）';

      // 恢复旧释义（Redo 前的 AI 释义，或若无则恢复本地词典）
      this.renderExplanation(this.cachedAi ?? undefined);

      if (this.cachedAi) {
        this.aiRedoBtn.hidden = false;
        this.aiExplainBtn.hidden = true;
      } else {
        this.aiRedoBtn.hidden = true;
        this.aiExplainBtn.hidden = false;
        this.aiExplainBtn.textContent = textSoFar ? '重新解释' : '✨ AI 解释';
      }
      if (this.rect) this.position(this.rect);
    }
  }

  private resetAiUi() {
    this.cancelPendingRaf();
    this.aiState = { kind: 'idle' };
    this.aiExplainBtn.hidden = false;
    this.aiExplainBtn.textContent = '✨ AI 解释';
    this.aiRedoBtn.hidden = true;
    this.aiCancelBtn.hidden = true;
    this.aiStatusEl.hidden = true;
    this.aiStatusEl.textContent = '';
    this.aiTextEl.hidden = true;
    this.aiTextEl.textContent = '';
    this.aiErrorEl.hidden = true;
    this.aiErrorEl.textContent = '';
  }

  private scheduleAiRender() {
    if (this.rafId !== null) return;
    if (typeof requestAnimationFrame === 'function') {
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        this.flushAiRender();
      });
    } else {
      this.flushAiRender();
    }
  }

  private flushAiRender() {
    if (this.rafId !== null) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this.rafId);
      }
      this.rafId = null;
    }
    if (this.aiState.kind === 'streaming' && this.pendingAiText) {
      this.aiState.text += this.pendingAiText;
      this.pendingAiText = '';
      this.aiTextEl.textContent = this.aiState.text;
      if (this.rect) this.position(this.rect);
    }
  }

  private cancelPendingRaf() {
    if (this.rafId !== null) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this.rafId);
      }
      this.rafId = null;
    }
    this.pendingAiText = '';
  }

  private renderEntry(entry: DictEntry | null) {
    const hasPhonetic = Boolean(entry?.phonetic);
    if (hasPhonetic) {
      this.phoneticTextEl.textContent = `/${entry!.phonetic}/`;
      this.phoneticTextEl.hidden = false;
    } else {
      this.phoneticTextEl.textContent = '';
      this.phoneticTextEl.hidden = true;
    }

    const speakable = canSpeak();
    this.speakBtn.hidden = !speakable;
    if (speakable && this.token) {
      this.speakBtn.setAttribute('aria-label', `朗读 ${this.token.surface}`);
    }

    this.phoneticEl.hidden = !hasPhonetic && !speakable;

    const tags = (entry?.tags ?? []).map((t) => TAG_LABELS[t]).filter((t): t is string => Boolean(t));
    this.tagsEl.replaceChildren();
    if (tags.length > 0) {
      for (const tag of tags) {
        const span = document.createElement('span');
        span.textContent = tag;
        this.tagsEl.append(span);
      }
      this.tagsEl.hidden = false;
    } else {
      this.tagsEl.hidden = true;
    }

    this.renderExplanation();
  }

  private renderExplanation(overrideText?: string) {
    const explanation =
      overrideText !== undefined
        ? overrideText
        : resolveCardExplanation({
            localExplanation: this.entry?.translation,
            cachedAIExplanation: this.cachedAi,
          });

    this.transEl.replaceChildren();
    if (explanation) {
      this.transEl.className = 'zh';
      const lines = explanation.split('\n').filter((l) => l.trim());
      for (const line of lines) {
        const div = document.createElement('div');
        div.textContent = line;
        this.transEl.append(div);
      }
    } else {
      this.transEl.className = 'zh muted';
      this.transEl.textContent = '本地词库里没有这个词';
    }
  }

  private position(rect: DOMRect) {
    this.box.style.maxHeight = '';
    const height = this.box.offsetHeight || 140;
    const width = this.box.offsetWidth || WIDTH;

    const roomBelow = window.innerHeight - rect.bottom - GAP * 2;
    const roomAbove = rect.top - GAP * 2;
    const below = pickSide({
      height,
      roomBelow,
      roomAbove,
      locked: this.pointerInside ? this.below : undefined,
    });
    this.below = below;

    const room = Math.max(MIN_HEIGHT, below ? roomBelow : roomAbove);
    this.box.style.maxHeight = `${room}px`;

    this.box.style.setProperty('--enter-from', below ? '-6px' : '6px');
    this.box.style.setProperty('--enter-origin', below ? 'top' : 'bottom');

    const top = below ? rect.bottom + GAP : Math.max(GAP, rect.top - Math.min(height, room) - GAP);
    const left = Math.min(Math.max(GAP, rect.left - 12), Math.max(GAP, window.innerWidth - width - GAP));
    this.host.style.top = `${top}px`;
    this.host.style.left = `${left}px`;
  }

  private onClick = (event: Event) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (!action || !this.token) return;
    if (action === 'known') {
      this.deps.onKnown(this.token.lemma);
      this.hide();
    } else if (action === 'speak') {
      speak(this.token.surface);
    } else if (action === 'ai-explain') {
      this.startAi();
    } else if (action === 'ai-redo') {
      this.redoAi();
    } else if (action === 'ai-cancel') {
      this.abortAi();
    }
  };
}

/**
 * 视口上下选边纯函数
 */
export function pickSide(opts: {
  height: number;
  roomBelow: number;
  roomAbove: number;
  locked?: boolean;
}): boolean {
  if (opts.locked !== undefined) return opts.locked;
  return opts.height <= opts.roomBelow || opts.roomBelow >= opts.roomAbove;
}

const CSS_TEXT = `
:host { all: initial; }
* { box-sizing: border-box; margin: 0; }

.card {
  width: min(${WIDTH}px, calc(100vw - ${GAP * 2}px));
  overflow-y: auto;
  scrollbar-width: none;
  outline: none;

  opacity: 0;
  transform: translateY(var(--enter-from, -6px)) scale(.985);
  transform-origin: var(--enter-origin, top) center;
  transition: opacity ${EXIT_MS}ms ease-in, transform ${EXIT_MS}ms ease-in;
  pointer-events: none;
  padding: 14px 16px;
  border-radius: 16px;
  border: 1px solid var(--line);
  color: var(--fg);
  font: 400 13px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
        "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;

  background: var(--gloss), var(--bg);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  box-shadow:
    inset 0 1px 0 var(--sheen),
    0 1px 2px rgb(0 0 0 / .05),
    0 16px 40px -12px rgb(0 0 0 / .30);
}

@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .card { background: var(--bg-solid); }
}

.card::-webkit-scrollbar { width: 0; height: 0; }

:host {
  --bg: rgb(255 255 255 / .72);
  --bg-solid: #fff;
  --fg: #1a1d21;
  --muted: #5b6472;
  --line: rgb(16 24 40 / .10);
  --soft: rgb(16 24 40 / .05);
  --sheen: rgb(255 255 255 / .70);
  --gloss: linear-gradient(180deg, rgb(255 255 255 / .38), rgb(255 255 255 / 0) 42%);
  --accent: oklch(56% 0.17 258);
}
@media (prefers-color-scheme: dark) {
  :host {
    --bg: rgb(24 27 32 / .72);
    --bg-solid: #1c1f24;
    --fg: #e8eaed;
    --muted: #a3abb7;
    --line: rgb(255 255 255 / .12);
    --soft: rgb(255 255 255 / .07);
    --sheen: rgb(255 255 255 / .10);
    --gloss: linear-gradient(180deg, rgb(255 255 255 / .07), rgb(255 255 255 / 0) 42%);
    --accent: oklch(76% 0.14 258);
  }
}

.card.is-open {
  opacity: 1;
  transform: none;
  pointer-events: auto;
  transition: opacity 140ms ease-out, transform 190ms cubic-bezier(.22, .9, .3, 1);
}

@media (prefers-reduced-motion: reduce) {
  .card, .card.is-open { transition: none; transform: none; }
}

.head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.word { font-size: 18px; font-weight: 600; letter-spacing: -.01em; }
.lemma { font-size: 12px; color: var(--muted); }

.badge {
  margin-left: auto; flex: none;
  padding: 1px 7px; border-radius: 999px;
  font-size: 11px; font-weight: 600; letter-spacing: .02em;
  --l: 56%; --c: 0.15; --h: 258;
  color: oklch(var(--l) var(--c) var(--h));
  background: oklch(var(--l) var(--c) var(--h) / 12%);
}
.badge[data-level="1"] { --h: 150; }             /* A1 绿 */
.badge[data-level="2"] { --h: 195; }             /* A2 青 */
.badge[data-level="3"] { --h: 250; }             /* B1 蓝 */
.badge[data-level="4"] { --h: 305; }             /* B2 紫 */
.badge[data-level="5"] { --h: 55; }              /* C1 橙 */
.badge[data-level="6"] { --h: 25; }              /* C2 红 */
.badge[data-level="7"] { --c: 0.02; }            /* 生僻：词库外，退成中性 */
@media (prefers-color-scheme: dark) {
  .badge { --l: 76%; --c: 0.13; }
  .badge[data-level="7"] { --c: 0.02; }
}

.phonetic {
  display: flex; align-items: center; gap: 5px;
  margin-top: 2px; font-size: 12px; color: var(--muted); font-family: ui-monospace, Menlo, monospace;
}

.speak {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  border: 0;
  border-radius: 4px;
  background: none;
  color: inherit;
  cursor: pointer;
  outline: none;
  transition: color .12s, background .12s;
}
.speak svg {
  display: block;
  width: 13px;
  height: 13px;
}
.speak:hover, .speak:focus-visible {
  color: var(--fg);
  background: var(--soft);
}


.tags { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 8px; }
.tags span {
  padding: 1px 6px; border-radius: 4px; font-size: 11px;
  color: var(--muted); background: var(--soft);
}

.zh { margin-top: 10px; }
.zh div + div { margin-top: 2px; }
.zh.muted { color: var(--muted); font-size: 12px; }

.ai-section {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
}

.ai-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ai-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: var(--soft);
  color: var(--fg);
  font: inherit;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  outline: none;
  transition: background .12s, border-color .12s, color .12s;
}

.ai-btn:hover {
  background: var(--line);
  border-color: var(--line);
}

.ai-btn.ai-cancel-btn {
  color: var(--muted);
  border-color: transparent;
  background: transparent;
  padding: 4px 6px;
}

.ai-btn.ai-cancel-btn:hover {
  color: var(--fg);
  background: var(--soft);
}

.ai-btn.ai-redo-btn {
  padding: 4px 7px;
  min-width: 26px;
  min-height: 24px;
  color: var(--muted);
}

.ai-btn.ai-redo-btn:hover {
  color: var(--fg);
}

.ai-btn.ai-redo-btn svg {
  width: 13px;
  height: 13px;
  display: block;
}

.ai-status {
  margin-top: 8px;
  font-size: 11.5px;
  color: var(--muted);
}

.ai-text {
  margin-top: 8px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--fg);
  white-space: pre-wrap;
  word-break: break-word;
}

.ai-error {
  margin-top: 8px;
  font-size: 11.5px;
  color: oklch(55% 0.22 25);
  background: oklch(55% 0.22 25 / 8%);
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid oklch(55% 0.22 25 / 20%);
}

@media (prefers-color-scheme: dark) {
  .ai-error {
    color: oklch(75% 0.18 25);
    background: oklch(75% 0.18 25 / 12%);
    border-color: oklch(75% 0.18 25 / 25%);
  }
}

.foot {
  display: flex; align-items: center; gap: 10px;
  margin-top: 12px; padding-top: 10px;
  border-top: 1px solid var(--line);
}
.foot > :last-child { margin-left: auto; }

.known {
  flex: none; padding: 3px 0;
  border: none; background: transparent; color: var(--muted);
  font: inherit; font-size: 11.5px; cursor: pointer;
  transition: color .12s;
}
.known:hover { color: var(--fg); }
`;
