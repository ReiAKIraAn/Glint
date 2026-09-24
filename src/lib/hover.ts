import type { Token } from './scan';

/**
 * highlight 是画上去的，不是 DOM，收不到鼠标事件。
 * 所以反过来做：拿鼠标坐标问浏览器「这个位置落在哪个文本节点的第几个字符上」，
 * 再回查这个字符属不属于某个被标注的词。
 */
function caretAt(x: number, y: number): { node: Node; offset: number } | undefined {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(x, y);
    return pos ? { node: pos.offsetNode, offset: pos.offset } : undefined;
  }
  // Safari 和老一点的 Chrome
  const range = doc.caretRangeFromPoint?.(x, y);
  return range ? { node: range.startContainer, offset: range.startOffset } : undefined;
}

/**
 * 页面上有没有正在生效的选区。
 * 只看 isCollapsed，不碰 toString()——后者在大段选区上要拼接整段文本，
 * 而这个判断每次 mousemove 都要跑。
 */
function hasSelection(): boolean {
  const selection = document.getSelection();
  return !!selection && selection.rangeCount > 0 && !selection.isCollapsed;
}

export interface HoverHandlers {
  onEnter(token: Token, rect: DOMRect): void;
  onLeave(): void;
}

/** 鼠标停多久才弹卡片。太短会在扫读时乱闪。 */
const DWELL_MS = 220;

/**
 * 离开词之后的缓冲。卡片就贴在词下方 8px，鼠标够过去只要几十毫秒，
 * 这段时间纯粹是给这个位移留的余量。
 */
const LEAVE_WORD_MS = 110;

/** 离开卡片本身。这是个明确的「我看完了」动作，不需要犹豫。 */
const LEAVE_CARD_MS = 40;

export class HoverTracker {
  private index = new Map<Text, Token[]>();
  private current?: Token;
  private showTimer?: number;
  private hideTimer?: number;
  private lastMove = 0;
  private held = false;
  private dragging = false;
  /** 键盘钉住的：滚动不收，鼠标一动才解除 */
  private pinned = false;
  private abort = new AbortController();

  constructor(private handlers: HoverHandlers) {}

  setTokens(tokens: Token[]) {
    this.index.clear();
    for (const token of tokens) {
      const list = this.index.get(token.node);
      if (list) list.push(token);
      else this.index.set(token.node, [token]);
    }
  }

  start() {
    const { signal } = this.abort;
    document.addEventListener('mousemove', this.onMouseMove, { passive: true, signal });
    document.addEventListener('mousedown', this.onMouseDown, { passive: true, signal });
    document.addEventListener('mouseup', this.onMouseUp, { passive: true, signal });
    // 滚动时词的位置在变，卡片跟着漂很难看，直接收掉
    document.addEventListener('scroll', this.onScroll, { passive: true, capture: true, signal });
    window.addEventListener('blur', this.onScroll, { signal });
  }

  stop() {
    this.abort.abort();
    this.abort = new AbortController();
    this.dragging = false;
    this.dismiss();
    this.index.clear();
  }

  /**
   * 鼠标进了卡片本身。卡片就贴在词下面，鼠标移过去的路上会先离开词，
   * 不挡一下的话卡片会在够到它之前就消失。
   */
  hold() {
    this.held = true;
    this.cancelHide();
  }

  /** 鼠标离开卡片，恢复正常的关闭流程。 */
  release() {
    if (this.pinned) return; // 键盘钉住的时候，鼠标掠过卡片不该把它带走
    this.held = false;
    this.scheduleHide(LEAVE_CARD_MS);
  }

  /**
   * 键盘把卡片钉在某个词上。
   *
   * 标注是画上去的，不是 DOM，Tab 键根本走不到——所以键盘用户只能靠这条路。
   * 钉住之后要挡掉两件会把它立刻收走的事：跳过去时的那次滚动，以及鼠标恰好
   * 停在页面某处产生的 mousemove。鼠标真正动起来才交还控制权。
   */
  pin(token: Token) {
    this.pinned = true;
    this.held = true; // 复用「鼠标在卡片上」那条抑制路径
    this.cancelHide();
    window.clearTimeout(this.showTimer);
    this.current = token;
    const rect = rectOf(token);
    if (rect) this.handlers.onEnter(token, rect);
  }

  /** 松开键盘钉住（Esc、或者鼠标动了）。 */
  unpin() {
    if (!this.pinned) return;
    this.pinned = false;
    this.held = false;
    this.dismiss();
  }

  get isPinned() {
    return this.pinned;
  }

  /** 滚动/失焦要收卡片——但键盘钉住的那次滚动是我们自己发起的，不算。 */
  private onScroll = () => {
    if (!this.pinned) this.dismiss();
  };

  dismiss = () => {
    this.pinned = false;
    this.cancelHide();
    window.clearTimeout(this.showTimer);
    this.showTimer = undefined;
    if (this.current) {
      this.current = undefined;
      this.handlers.onLeave();
    }
  };

  private cancelHide() {
    window.clearTimeout(this.hideTimer);
    this.hideTimer = undefined;
  }

  /**
   * 关键：**已经在倒计时了就不要重置。**
   *
   * 这里原本每次都 clearTimeout 再重开。而鼠标移开的过程本身是连续移动的，
   * 每 50ms 就会重置一次倒计时，结果卡片要等鼠标彻底停下才开始计时——
   * 手感上就是「怎么甩都甩不掉」。倒计时必须从离开的那一刻单向走完。
   */
  private scheduleHide(delay: number) {
    if (this.hideTimer !== undefined) return;
    this.hideTimer = window.setTimeout(this.dismiss, delay);
  }

  private onMouseDown = () => {
    // 在卡片上按下（点按钮、或想复制卡片里的释义）不算划词
    if (this.held) return;
    this.dragging = true;
    this.dismiss();
  };

  private onMouseUp = () => {
    this.dragging = false;
  };

  private onMouseMove = (event: MouseEvent) => {
    // 鼠标真动了，键盘那套让位
    if (this.pinned) {
      this.pinned = false;
      this.held = false;
    }
    if (this.held) return;

    /**
     * 划词的时候别弹卡片。卡片就贴在光标下方，正好盖住你要选的那几行。
     *
     * 拖拽中和拖拽结束后都要让位：松开鼠标时选区还在，这时候弹出来一样碍事。
     * 选区在用户点击任意位置后自然消失，届时自动恢复。
     */
    if (this.dragging || hasSelection()) {
      this.dismiss();
      return;
    }

    // mousemove 一秒能触发上百次，caretPositionFromPoint 又要走布局，必须节流
    const now = performance.now();
    if (now - this.lastMove < 50) return;
    this.lastMove = now;

    const token = this.tokenAt(event.clientX, event.clientY);
    if (token === this.current) return;

    if (!token) {
      this.scheduleHide(LEAVE_WORD_MS);
      return;
    }

    // 直接从一个词滑到另一个词：取消关闭，重新计时
    this.cancelHide();
    window.clearTimeout(this.showTimer);
    this.current = token;
    this.showTimer = window.setTimeout(() => {
      const rect = rectOf(token);
      if (rect) this.handlers.onEnter(token, rect);
    }, DWELL_MS);
  };

  private tokenAt(x: number, y: number): Token | undefined {
    const caret = caretAt(x, y);
    if (!caret || caret.node.nodeType !== Node.TEXT_NODE) return undefined;
    const tokens = this.index.get(caret.node as Text);
    if (!tokens) return undefined;
    // caret 落在词的任意一个字符区间内就算命中
    return tokens.find((t) => caret.offset >= t.start && caret.offset <= t.end);
  }
}

function rectOf(token: Token): DOMRect | undefined {
  try {
    const range = new Range();
    range.setStart(token.node, token.start);
    range.setEnd(token.node, token.end);
    const rect = range.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0 ? rect : undefined;
  } catch {
    return undefined;
  }
}
