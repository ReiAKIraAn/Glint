import { LEVEL_NAMES, UNKNOWN_LEVEL, type Analysis, type DictEntry, type Explained } from './types';
import type { Token } from './scan';
import { OWN_ELEMENT, sentenceAround } from './scan';
import { canSpeak, speak } from './speak';

/** ECDICT 的考试标签，展示成人话。 */
const TAG_LABELS: Record<string, string> = {
  zk: '中考',
  gk: '高考',
  cet4: '四级',
  cet6: '六级',
  ky: '考研',
  toefl: '托福',
  ielts: '雅思',
  gre: 'GRE',
};

export interface CardDeps {
  /** 本地词库，秒回 */
  lookup(word: string): Promise<DictEntry | null>;
  /** 调 AI 做语境释义，慢，可能失败 */
  analyze(token: Token): Promise<{ ok: true; analysis: Analysis } | { ok: false; error: string }>;
  /** AI 是否已配置好（没有 key 就别显示加载中） */
  aiReady(): Promise<boolean>;
  /**
   * 这个词之前生成过的释义。有就直接摆出来，一分钱不花。
   *
   * 存下来的东西归调用方管（内容脚本写进扩展存储，设置页删）——卡片只负责问一句。
   */
  cached(lemma: string): Explained | null;
  onKnown(lemma: string): void;
  /** 鼠标进出卡片本身，用来抑制 HoverTracker 的关闭逻辑 */
  onPointerEnter(): void;
  onPointerLeave(): void;
}

/**
 * AI 那一栏的状态机。
 *
 * stale 是「有，但不是这一句的」——释义存的时候连句子一起存了，换一篇文章遇到同一个词，
 * 拿旧的出来是对的（不花钱），但不能假装它讲的是眼前这一句。所以它单独一态：
 * 照常显示，但说明白它来自哪一句，想要针对当前这句的就再点一次。
 */
type AiState =
  | { kind: 'off' }
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; analysis: Analysis }
  | { kind: 'stale'; analysis: Analysis; sentence: string };

const GAP = 8;
/**
 * 加了原句和译文之后，340px 的卡片一句话要折四五行，整张卡拉得老长。
 * 宽一点，行数就下来了——12px 正文在 400px 宽里一行 55 字上下，正好在耐读的区间。
 */
const WIDTH = 400;
/** 视口再挤也别把卡片压到没法读。 */
const MIN_HEIGHT = 180;
/** 退出动画时长，要和 CSS 里 .card 基础态的 transition 对上。 */
const EXIT_MS = 110;

export class Card {
  private host: HTMLElement;
  private shadow: ShadowRoot;
  private box: HTMLDivElement;
  private token?: Token;
  /** 卡片当前挂在哪个词的位置上，重画之后还要按它重新摆一次 */
  private rect?: DOMRect;
  private entry: DictEntry | null = null;
  private ai: AiState = { kind: 'idle' };
  /** 每次 show 换一个，用来丢弃迟到的异步结果 */
  private epoch = 0;
  /** 鼠标此刻在不在卡片上。重画时能不能换边要看它，见 position() */
  private pointerInside = false;
  /** 上一次摆在词的哪一边。鼠标踩在卡片上时重画要沿用它 */
  private below = true;
  /** 退出动画放完之后才真正 display:none */
  private unmountTimer?: ReturnType<typeof setTimeout>;

  constructor(private deps: CardDeps) {
    this.host = document.createElement(OWN_ELEMENT);
    this.host.style.cssText = 'all: initial; position: fixed; z-index: 2147483646;';
    this.shadow = this.host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = CSS_TEXT;
    this.box = document.createElement('div');
    this.box.className = 'card';
    /**
     * 键盘那条路要用：卡片是 hover 出来的，本身不在 Tab 序列里，
     * 所以先把焦点放到容器上，之后 Tab 才能走到里面那两个按钮。
     */
    this.box.tabIndex = -1;
    this.box.setAttribute('role', 'dialog');
    this.box.setAttribute('aria-label', '词义卡片');
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

  /** 键盘唤出来的时候把焦点送进去，否则 Tab 还是走页面上的元素。 */
  focus() {
    this.box.focus({ preventScroll: true });
  }

  /** 给 MutationObserver 用：认出我们自己插进页面的那个节点。 */
  get element(): HTMLElement {
    return this.host;
  }

  mount() {
    if (!this.host.isConnected) document.body.append(this.host);
    this.host.style.display = 'none';
  }

  destroy() {
    this.host.remove();
  }

  hide() {
    this.token = undefined;
    this.epoch++; // 作废还在飞的异步结果
    if (this.host.style.display === 'none') return;
    this.box.classList.remove('is-open');
    clearTimeout(this.unmountTimer);
    this.unmountTimer = setTimeout(() => {
      this.host.style.display = 'none';
    }, EXIT_MS);
  }

  async show(token: Token, rect: DOMRect) {
    this.token = token;
    this.rect = rect;
    this.entry = null;
    this.ai = { kind: 'idle' };
    const epoch = ++this.epoch;

    clearTimeout(this.unmountTimer); // 上一次的退场还没放完就被叫回来了
    this.box.innerHTML = skeleton(token);
    this.host.style.display = 'block';
    /**
     * position() 内部读了 offsetHeight，已经强制浏览器把「透明 + 位移」这个初始状态
     * 算出来了，所以紧接着加 class 就能触发过渡，不需要等下一帧。
     *
     * 这里原先用 requestAnimationFrame 隔一帧，有两个问题：rAF 在不渲染的标签页里
     * 根本不触发；而且 CSS 过渡在那种情况下也不会推进——两条路都会让卡片永远停在
     * opacity:0，鼠标停上去什么都看不见。所以页面不可见时干脆跳过动画直接给终态。
     */
    const animate = document.visibilityState === 'visible';
    this.box.style.transition = animate ? '' : 'none';
    this.position(rect);
    this.box.classList.add('is-open');

    const [entry, aiReady] = await Promise.all([this.deps.lookup(token.lemma), this.deps.aiReady()]);
    if (epoch !== this.epoch) return;

    /**
     * 词典是本地的，白给，所以自动查；AI 要花钱，所以等用户点。
     *
     * 鼠标从一段文字上扫过去会连着经过好几个标注的词，每个都自动调一次 AI 的话，
     * 绝大多数请求的结果用户根本没看就被下一次 hover 作废了——钱花在了没人读的答案上。
     */
    this.entry = entry;
    this.ai = this.recall(token, aiReady);
    this.render();
  }

  /**
   * 已经买过的先拿出来，没有才显示那个按钮。
   *
   * 存货优先于 aiReady：用户就算把 Key 删了，之前花钱换来的东西也该照样能看。
   */
  private recall(token: Token, aiReady: boolean): AiState {
    const saved = this.deps.cached(token.lemma);
    if (saved) {
      return sameSentence(saved.sentence, sentenceAround(token))
        ? { kind: 'done', analysis: saved.analysis }
        : { kind: 'stale', analysis: saved.analysis, sentence: saved.sentence };
    }
    return aiReady ? { kind: 'idle' } : { kind: 'off' };
  }

  /** 用户点了按钮才走到这里——这是整个扩展唯一花钱的地方。 */
  private async explain() {
    const token = this.token;
    if (!token) return;
    const epoch = this.epoch;

    this.ai = { kind: 'loading' };
    this.render();

    /**
     * analyze 走的是 sendMessage，它会 reject——service worker 被回收、消息通道断掉，
     * 都算。不接住的话这个方法就在 await 上死掉，而 this.ai 停在上面那行设的
     * loading 上再也不动：用户盯着三个点转到关页面，卡片上一个字的解释都没有。
     * 有一句话总比转圈强，哪怕那句话只是「后台没回」。
     */
    let result: Awaited<ReturnType<CardDeps['analyze']>>;
    try {
      result = await this.deps.analyze(token);
      if (!result || typeof result.ok !== 'boolean') throw new Error('后台没有返回结果');
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.ai = {
        kind: 'error',
        message: `没拿到释义：${error instanceof Error ? error.message : String(error)}`,
      };
      this.render();
      return;
    }
    if (epoch !== this.epoch) return; // 请求飞着的时候鼠标已经走了

    this.ai = result.ok
      ? { kind: 'done', analysis: result.analysis }
      : { kind: 'error', message: result.error };
    this.render();
  }

  private render() {
    if (!this.token) return;
    this.box.innerHTML = body(this.token, this.entry, this.ai);
    if (this.rect) this.position(this.rect);
  }

  /**
   * 优先放在词的下方，放不下就翻到上面。
   *
   * 两边都放不下的时候不能硬塞——那样卡片会盖住正在读的那个词，而那个词恰恰是
   * 你需要一边看释义一边回看上下文的东西。所以选更宽敞的一侧，把卡片压进可用高度里
   * 让它自己滚动。宁可滚，也不要挡住原文。
   */
  private position(rect: DOMRect) {
    this.box.style.maxHeight = ''; // 先解除上次的限制，否则量到的是被压过的高度
    const height = this.box.offsetHeight || 200;
    // 量出来的，不是常量——窄窗口里卡片会被 CSS 压到比 WIDTH 小
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

    // 卡片在词下方就从上往下展开，在上方就反过来——动画方向跟它的来处一致
    this.box.style.setProperty('--enter-from', below ? '-6px' : '6px');
    this.box.style.setProperty('--enter-origin', below ? 'top' : 'bottom');

    const top = below ? rect.bottom + GAP : Math.max(GAP, rect.top - Math.min(height, room) - GAP);
    const left = Math.min(Math.max(GAP, rect.left - 12), window.innerWidth - width - GAP);
    this.host.style.top = `${top}px`;
    this.host.style.left = `${left}px`;
  }

  private onClick = (event: Event) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (!action || !this.token) return;
    // 这个按钮是在卡片里换内容，不是收尾操作，点完卡片得留在原地
    if (action === 'explain') {
      void this.explain();
      return;
    }
    // 同理：听一遍不是收尾操作，多半还要接着看释义
    if (action === 'speak') {
      speak(this.token.surface);
      return;
    }
    if (action === 'known') this.deps.onKnown(this.token.lemma);
    this.hide();
  };
}

/**
 * 卡片该摆在词的哪一边。抽成纯函数是为了能测——这条判断错了不会抛异常，
 * 只会让卡片在某些屏幕位置上行为怪异，而那要靠手动 hover 到对的地方才碰得到。
 *
 * `locked` 有值就照它来，那是**鼠标已经踩在卡片上**的意思。
 *
 * 为什么必须锁：AI 释义回来的时候卡片会长高一大截（多出释义、原句、译文、例句
 * 四段）。原本每次重画都重新选边，于是「词落在视口下半部」这个很常见的情形下——
 * 骨架矮，词下方放得下，卡片摆在下面；你把鼠标移上去点了「AI 释义」，停在那儿等；
 * 结果回来，下方放不下了而上方更宽敞，卡片整个跳到词上面，从你鼠标底下跑掉。
 * 浏览器立刻发一个 pointerleave，40ms 后卡片就没了，你刚花钱买到的那段释义
 * 看都没看见。所以规则是：脚下的东西不许移动。挤一点没关系，调用处的 maxHeight
 * 本来就是干这个的——宁可让它自己滚，也不能在鼠标底下换边。
 *
 * 鼠标不在卡片上时（show() 里查完词典的那次重画，此刻鼠标还在词上）照常选更宽敞的
 * 一侧：那时候没人会被甩掉，而选错边的代价是白白挤一张本来能摊开的卡片。
 */
export function pickSide(opts: {
  height: number;
  roomBelow: number;
  roomAbove: number;
  /** 鼠标踩在卡片上时，上一次摆的那一边；不在就是 undefined */
  locked?: boolean;
}): boolean {
  if (opts.locked !== undefined) return opts.locked;
  return opts.height <= opts.roomBelow || opts.roomBelow >= opts.roomAbove;
}

// ---------------------------------------------------------------- 模板

const escape = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function levelBadge(token: Token) {
  const label = token.level === UNKNOWN_LEVEL ? '生僻' : LEVEL_NAMES[token.level];
  return `<span class="badge" data-level="${token.level}">${label}</span>`;
}

/**
 * 页面上是变形时，把词典里查的那个原形亮出来。
 *
 * 只说「原形」，不说「复数 / 过去式」——运行时拿不到词性，-s 可能是复数也可能是
 * 第三人称单数，-er 可能是比较级也可能是 teacher→teach。说不准就别说，
 * 标错词法比不标更糟。
 */
function head(token: Token) {
  const lemma =
    token.lemma !== token.surface.toLowerCase()
      ? `<span class="lemma" title="页面上这个词是变形，下面的释义查的是它的原形">原形 ${escape(token.lemma)}</span>`
      : '';
  return `<div class="head"><span class="word">${escape(token.surface)}</span>${lemma}${levelBadge(token)}</div>`;
}

/**
 * 音标那一行，外加一颗喇叭。
 *
 * 两样东西并排是因为它们回答的是同一个问题——这词怎么念。音标给读得懂 IPA 的人，
 * 喇叭给读不懂的人，而中文母语者里后者是多数：这一行原来只服务了少数派。
 *
 * 词库外的生僻词没有音标，照样给喇叭——合成器不查词典也能念，
 * 而那批词恰恰是最不知道该怎么读的。
 */
function pronounce(token: Token, entry: DictEntry | null) {
  const phonetic = entry?.phonetic ? `<span>/${escape(entry.phonetic)}/</span>` : '';
  // 两样都没有就整行不要，别留一条空的占位
  const speakable = canSpeak();
  if (!phonetic && !speakable) return '';
  const button = speakable
    ? `<button class="speak" data-act="speak" title="朗读" aria-label="朗读 ${escape(token.surface)}">${SPEAKER}</button>`
    : '';
  return `<div class="phonetic">${phonetic}${button}</div>`;
}

/** 喇叭。画成 SVG 而不是 emoji：emoji 在各系统上大小和配色都不一样，压不进这行灰字里。 */
const SPEAKER = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
  <path d="M7.2 3.4 4.3 5.9H2.3v4.2h2l2.9 2.5z" fill="currentColor" stroke-linejoin="round"/>
  <path d="M9.9 6.2a2.7 2.7 0 0 1 0 3.6" stroke-linecap="round"/>
  <path d="M11.9 4.3a5.3 5.3 0 0 1 0 7.4" stroke-linecap="round"/>
</svg>`;

function skeleton(token: Token) {
  return `${head(token)}<div class="skeleton"></div>`;
}

function body(token: Token, entry: DictEntry | null, ai: AiState) {
  const parts = [head(token)];

  parts.push(pronounce(token, entry));

  const tags = (entry?.tags ?? []).map((t) => TAG_LABELS[t]).filter(Boolean);
  if (tags.length) {
    parts.push(`<div class="tags">${tags.map((t) => `<span>${t}</span>`).join('')}</div>`);
  }

  if (entry?.translation) {
    const lines = entry.translation.split('\n').map((l) => `<div>${escape(l)}</div>`);
    parts.push(`<div class="zh">${lines.join('')}</div>`);
  } else {
    parts.push(`<div class="zh muted">本地词库里没有这个词</div>`);
  }

  parts.push(aiSection(ai, token, sentenceAround(token)));
  parts.push(foot(ai));
  return parts.join('');
}

/**
 * AI 那一栏里「有内容」的部分。没内容的状态（还没点、没配 Key、正在转）返回空串，
 * 它们在页脚那一行里露面就够了——为了一个按钮单开一块区域，卡片会凭空长高一截。
 */
function aiSection(ai: AiState, token: Token, sentence: string) {
  switch (ai.kind) {
    case 'off':
    case 'idle':
    case 'loading':
      return '';
    case 'error':
      return `<div class="ai error">${escape(ai.message)}</div>`;
    case 'done':
      return `<div class="ai">${analysisBlock('这句里的意思', ai.analysis, sentence, token)}</div>`;
    case 'stale':
      /**
       * 这里的原句要给存下来的那一句，不是眼前这一句——释义讲的是它，
       * 摆一句它没解释过的话在旁边只会让人对不上号。
       */
      return `<div class="ai">
        ${analysisBlock('另一句里的意思', ai.analysis, ai.sentence, token)}
        <div class="from">这条是在另一句里生成的</div>
      </div>`;
  }
}

/**
 * 卡片底下那一行。
 *
 * 原来是上下两条满宽按钮，六十来点高，而且把两个完全不同量级的动作画成了同一个东西：
 * 左边那个要花钱、是你 hover 上来的理由；右边那个是「以后别再标它」的清理动作，
 * 一百次里用不上一次。所以现在左边留一颗药丸按钮（唯一花钱的入口，配一点点主色，
 * 看得见但不喧哗），右边退成一句灰字，中间靠 auto 撑开——一行装下两件事。
 */
function foot(ai: AiState) {
  return `<div class="foot">${footLead(ai)}
    <button class="known" data-act="known" title="以后全站不再标注这个词">✓ 认识</button>
  </div>`;
}

function footLead(ai: AiState) {
  switch (ai.kind) {
    case 'off':
      return `<span class="hint">配置 API Key 后可用 AI 释义</span>`;
    case 'idle':
      return askButton('AI 释义');
    case 'loading':
      // 和上一态的药丸占同一个位置，所以从「点下去」到「转起来」卡片不会跳
      return `<span class="hint">正在读这一句<span class="dots"><i></i><i></i><i></i></span></span>`;
    case 'error':
      return askButton('重试');
    case 'stale':
      // 这一态点下去和 idle 不是一回事——它要覆盖掉已有的那条，所以标签得说清按的是哪一句
      return askButton('按<b>这一句</b>重新释义');
    case 'done':
      /**
       * 已经有释义了还想再要一次：做成一句灰字，不是药丸。
       * 它和「看意思」花的是同样的钱，但绝大多数时候你只是在读，
       * 不该有个显眼的东西一直邀请你再花一次。
       */
      return `<button class="redo" data-act="explain" title="再调一次 AI，会覆盖存下来的这一条">
        <span aria-hidden="true">✦</span> 重新生成
      </button>`;
  }
}

/** 唯一会花钱的入口，所以几个用到它的地方共用一个样子。 */
function askButton(label: string) {
  return `<button class="ask" data-act="explain" title="调一次 AI，用掉一次额度">
    <span aria-hidden="true">✦</span> ${label}
  </button>`;
}

function analysisBlock(label: string, a: Analysis, sentence: string, token: Token) {
  const note = a.note ? `<div class="note">${escape(a.note)}</div>` : '';
  return `<div class="label">${label}</div>
    <div class="sense">${escape(a.sense)}</div>
    <div class="en">${escape(a.en)}</div>
    ${note}
    <div class="tag">原句</div>
    <div class="quote">
      ${mark(sentence, token)}
      ${a.sentenceZh ? `<span>${escape(a.sentenceZh)}</span>` : ''}
    </div>
    <div class="tag">例句</div>
    <div class="example">${escape(a.example)}<span>${escape(a.exampleZh)}</span></div>`;
}

/**
 * 存的那句和眼前这句算不算同一句。
 *
 * 不能直接比字符串：取句子的规则本身会变（改过一次断句、又加了长句截断），
 * 规则一变，所有存量释义就会集体变成「另一句里的意思」——明明讲的就是这一句。
 * 所以去掉标点空格大小写之后，谁包含谁都算同一句。
 */
function sameSentence(a: string, b: string): boolean {
  const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return x === y;
  return x.includes(y) || y.includes(x);
}

/**
 * 把原句里的那个词加粗。
 *
 * 卡片十有八九正盖着你在读的那一行（它就是贴着那个词弹出来的），所以把原句带进来，
 * 不用为了对照上下文去挪鼠标。这一句本来就在手边，一分钱不花。
 *
 * 页面上的写法和原型可能不一样（strata / stratum），两个都试；都没命中就原样输出，
 * 不加粗而已，不至于为这个丢掉整句话。
 */
function mark(sentence: string, token: Token): string {
  const lower = sentence.toLowerCase();
  for (const needle of [token.surface, token.lemma]) {
    const at = lower.indexOf(needle.toLowerCase());
    if (at < 0) continue;
    return (
      escape(sentence.slice(0, at)) +
      `<b>${escape(sentence.slice(at, at + needle.length))}</b>` +
      escape(sentence.slice(at + needle.length))
    );
  }
  return escape(sentence);
}

const CSS_TEXT = `
:host { all: initial; }
* { box-sizing: border-box; margin: 0; }

.card {
  /* 窗口比卡片还窄的时候（手机、分屏）让它自己缩，别顶出屏幕 */
  width: min(${WIDTH}px, calc(100vw - ${GAP * 2}px));

  /*
   * 能滚，但不画滚动条。
   *
   * 这张卡片是鼠标停一下就出现的东西，多数时候根本不需要滚；为了那少数情况
   * 在玻璃右边常驻一条灰槽，等于每次都付这个代价。装不下的时候最后一行会被
   * 切在半路上，那本身就是「下面还有」的信号，不用再加一条线来说同一件事。
   */
  overflow-y: auto;
  scrollbar-width: none;
  outline: none;

  /* 基础态 = 退出态。退出比进入快一点，收得干脆才不拖沓。 */
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

  /*
   * 玻璃：底色留一点透，把后面的页面糊开当背景。
   *
   * 糊得重是为了能读——blur 半径给到 24px，后面那行字就散成一片均匀的色块，
   * 不会有笔画穿过卡片正文。saturate 是把糊掉的那片提回一点颜色，
   * 否则透出来的东西会灰得像脏玻璃。
   *
   * 上面那层渐变 + 顶边那道 inset 高光是「玻璃有厚度」的全部来源：
   * 光从上面来，所以上沿亮、往下收掉。没有它就只是个半透明方块。
   */
  background: var(--gloss), var(--bg);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  box-shadow:
    inset 0 1px 0 var(--sheen),
    0 1px 2px rgb(0 0 0 / .05),
    0 16px 40px -12px rgb(0 0 0 / .30);
}

/*
 * 不支持 backdrop-filter 就退回不透明——半透明卡片配一片没糊过的原文，
 * 是这套设计里唯一真正读不了的状态，宁可不要玻璃。
 */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .card { background: var(--bg-solid); }
}

/* scrollbar-width 之外，老一点的 Chromium / Safari 还得走这条 */
.card::-webkit-scrollbar { width: 0; height: 0; }

/*
 * 玻璃是透明度的游戏，所以除了文字，其余颜色全部改成半透明的——
 * 边框、分隔线、卡片里的小色块都跟着底下的页面走，才像是同一块玻璃上的东西。
 * 只有 --fg / --muted 保持实色：字必须始终是自己的颜色。
 *
 * --bg 的透明度是有下限的：72% 是在深色照片、代码块、彩色 banner 上试出来的
 * 「还能一眼读完一段中文」的位置。再透就开始需要眯眼睛了。
 */
:host {
  --bg: rgb(255 255 255 / .72);
  --bg-solid: #fff;
  --fg: #1a1d21;
  /* 比原来深一档：底下透上来的东西会吃掉一点对比度，灰字最先遭殃 */
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
  /* 进入用带一点回弹的曲线，位移比透明度慢一档，看起来是「浮上来」而不是「弹出来」 */
  transition: opacity 140ms ease-out, transform 190ms cubic-bezier(.22, .9, .3, 1);
}

@media (prefers-reduced-motion: reduce) {
  .card, .card.is-open { transition: none; transform: none; }
}

.head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.word { font-size: 18px; font-weight: 600; letter-spacing: -.01em; }
.lemma { font-size: 12px; color: var(--muted); }
/**
 * 等级徽章是「这个词有多难」的唯一出口——页面上的标注全部一个样，深浅不再传达难度。
 * 所以这里按等级换色相：冷色是你够得着的，暖色是 C 级，词库外的那档退成中性灰
 * （它不是「更难」，是「连词库都没收录」，另一件事）。亮度和彩度只在暗色模式换一次。
 */
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
/* 喇叭跟着音标那档灰字走，hover 才亮起来——它是个随时可用的东西，不是要人去注意的东西 */
.speak {
  display: inline-flex; padding: 2px; border: 0; border-radius: 4px;
  background: none; color: inherit; cursor: pointer;
}
.speak svg { display: block; width: 13px; height: 13px; }
.speak:hover { color: var(--fg); background: var(--soft); }

.tags { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 8px; }
.tags span {
  padding: 1px 6px; border-radius: 4px; font-size: 11px;
  color: var(--muted); background: var(--soft);
}

.zh { margin-top: 10px; }
.zh div + div { margin-top: 2px; }
.zh.muted { color: var(--muted); font-size: 12px; }

.ai {
  margin-top: 12px; padding-top: 11px;
  border-top: 1px dashed var(--line);
}
.ai.error { color: var(--muted); font-size: 12px; }
.from { margin-top: 10px; font-size: 11.5px; color: var(--muted); }

/* ---------------------------------------------------------------- 页脚 */

/*
 * 一行装下「花钱看释义」和「以后别标它」。gap 那一格是空的——中间没有分隔线，
 * 靠距离和轻重把两件事分开就够了，玻璃上多一条线就多一分脏。
 */
.foot {
  display: flex; align-items: center; gap: 10px;
  margin-top: 12px; padding-top: 10px;
  border-top: 1px solid var(--line);
}
.foot > :last-child { margin-left: auto; }

/* 药丸：整张卡片上唯一带主色的可点区域 */
.ask {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 11px;
  border: 1px solid color-mix(in oklch, var(--accent) 22%, var(--line));
  border-radius: 999px;
  background: color-mix(in oklch, var(--accent) 7%, transparent);
  color: var(--muted);
  font: inherit; font-size: 11.5px; cursor: pointer;
  transition: background .12s, color .12s, border-color .12s;
}
.ask b { color: var(--fg); font-weight: 600; }
.ask > span { color: var(--accent); }
.ask:hover {
  color: var(--fg);
  border-color: color-mix(in oklch, var(--accent) 45%, var(--line));
  background: color-mix(in oklch, var(--accent) 14%, transparent);
}

/* 认识 / 重新生成 / 提示语：同一档灰字，谁也别抢戏 */
.known, .redo {
  flex: none; padding: 3px 0;
  border: none; background: transparent; color: var(--muted);
  font: inherit; font-size: 11.5px; cursor: pointer;
  transition: color .12s;
}
.known:hover { color: var(--fg); }
.redo:hover { color: var(--accent); }
.redo span { color: var(--accent); }

.hint { font-size: 11.5px; color: var(--muted); }
.hint b { color: var(--fg); font-weight: 600; }
.label {
  font-size: 11px; font-weight: 600; letter-spacing: .06em;
  color: var(--accent); text-transform: uppercase;
}
.sense { margin-top: 5px; font-size: 13.5px; }
.en { margin-top: 3px; font-size: 12px; color: var(--muted); font-style: italic; }
.note {
  margin-top: 8px; padding: 7px 9px; border-radius: 7px;
  background: var(--soft); font-size: 12px; color: var(--muted);
}
/* 原句和例句共用一套排版：小标签 + 正文，两块并排好对照 */
.tag { margin-top: 10px; font-size: 11px; color: var(--muted); }
/* 原句给正文色，译文压成灰的——和下面例句那两行是同一套关系 */
.quote { margin-top: 2px; font-size: 12px; line-height: 1.55; }
.quote b { font-weight: 600; }
.quote span { display: block; margin-top: 2px; color: var(--muted); }
.example { margin-top: 2px; font-size: 12px; line-height: 1.55; }
.example span { display: block; color: var(--muted); }

.skeleton { height: 76px; margin-top: 12px; border-radius: 8px; background: var(--soft); }

.dots { display: inline-flex; gap: 3px; margin-left: 5px; vertical-align: middle; }
.dots i {
  width: 4px; height: 4px; border-radius: 50%;
  background: var(--muted); opacity: .35;
  animation: pulse 1.1s ease-in-out infinite;
}
.dots i:nth-child(2) { animation-delay: .15s; }
.dots i:nth-child(3) { animation-delay: .3s; }
@keyframes pulse { 50% { opacity: 1; transform: translateY(-2px); } }

@media (prefers-reduced-motion: reduce) {
  .dots i { animation: none; opacity: .6; }
}
`;
