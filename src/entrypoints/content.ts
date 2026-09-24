import { browser, defineContentScript } from '#imports';
import {
  explanationsStore,
  knownWordsStore,
  readSettings,
  settingsStore,
  withDefaults,
} from '@/lib/settings';
import { collectCodeWords, scanSubtree, scanTextNode, sentenceAround, type Token } from '@/lib/scan';
import { applyStyle, clear, isSupported, paint, removeStyle } from '@/lib/highlight';
import { HoverTracker } from '@/lib/hover';
import { Card } from '@/lib/card';
import { createWordNav, type WordNav } from '@/lib/keynav';
import { DEFAULT_SETTINGS, siteDisabled } from '@/lib/types';
import type { Analysis, DictEntry, Explained, Message, PageStats } from '@/lib/types';

/** 页面再长也不至于要标这么多词。超过说明大概率是误判，别把页面搞成筛子。 */
const MAX_TOKENS = 2500;

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  async main() {
    /**
     * iframe 里直接退出，而且**不能**注册监听器。
     *
     * 内容脚本在每个 frame 里都跑一遍，而 tabs.sendMessage 是广播给整个标签页的，
     * 谁先应答算谁的——iframe 也应答的话，popup 拿到的就可能是某个广告位的数据。
     */
    if (window.top !== window.self) return;

    // 先给同步默认值，下一行才去读真正的设置——因为紧接着要注册消息监听器，
    // 它必须在任何 await 之前挂上（理由见下）。
    let settings = DEFAULT_SETTINGS;
    let tokens: Token[] = [];
    /** 见 highlight.ts：这版只走 CSS Custom Highlight API，画不了就整个不干活。 */
    const supported = isSupported();
    /**
     * 键盘遍历。要在监听器之前声明：监听器挂得比它早（那是有意的，理由见下），
     * 而且浏览器不支持时下面会直接 return，nav 永远不会被赋值——
     * 不留这个 undefined 的口子的话，那种页面上按一次快捷键就是一个 ReferenceError。
     */
    let nav: WordNav | undefined;

    /**
     * popup 打开时会问这一页标了多少词。
     *
     * **必须在第一个 await 之前注册，也必须在能力检查之前。**
     *
     * 挂在 await 后面的话，那一步慢一拍或者抛错，监听器就永远挂不上；而挂在
     * `if (!isSupported()) return` 后面的话，老浏览器上根本不会注册——两种情况下
     * popup 收到的都是「连不上接收端」，于是提示「刷新一下页面就能用了」，
     * 而刷新永远不会有用。所以能力检查的结果作为一个字段如实报上去。
     *
     * 用 activeTab 权限，只在用户点击扩展图标后才可达。
     */
    browser.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
      if (message.kind === 'nav:step') {
        nav?.step(message.delta);
        return undefined;
      }
      if (message.kind !== 'page:stats') return undefined;
      /**
       * 和 background 里同一个道理：返回 Promise 在一部分 Chromium 上会被丢掉，
       * popup 拿到 undefined，「标了多少词」就永远是空的。这几个数现成就在手里，
       * 同步回一次即可，连通道都不用占。
       */
      sendResponse({
        marked: tokens.length,
        active: settings.enabled && !siteDisabled(location.hostname, settings.disabledSites),
        supported,
      } satisfies PageStats);
      return undefined;
    });

    if (!supported) {
      console.warn('[glint] CSS Custom Highlight API not supported in this environment.');
      return;
    }

    settings = await readSettings();
    let known = new Set(await knownWordsStore.getValue());
    /** 存储里那份释义的内存镜像。hover 是同步问的，不能每次都去 await 存储。 */
    let explained: Record<string, Explained> = await explanationsStore.getValue();

    /**
     * 卡片有没有能力解释词库外的词。扫描时就要知道——没有这个能力就干脆别标，
     * 否则用户点开只会看到一张「本地词库里没有这个词」的空卡片。
     */
    /** 当前备考词表。没开备考模式就是 undefined。 */
    let examWords: Set<string> | undefined;
    let loadedExam = '';
    async function refreshExamWords() {
      if (settings.targetExam === loadedExam) return;
      loadedExam = settings.targetExam;
      if (!loadedExam) {
        examWords = undefined;
        return;
      }
      const list = (await send({ kind: 'exam:words', exam: loadedExam })) as string[];
      // 加载期间用户可能又换了目标，这一份就作废
      if (loadedExam === settings.targetExam) examWords = new Set(list);
    }

    let canExplain = false;
    async function refreshAiStatus() {
      /**
       * 这一行曾经是整个扩展最脆的地方：后台回了 undefined（见 background 里那段注释），
       * `.configured` 就抛在这儿，而它的调用点在 `Promise.all` 里、没有 catch——
       * 于是后面的首屏扫描、MutationObserver、设置监听**全都不执行**，
       * 表现成「扩展装了但整页一个词都不标」，且控制台只有一句看不出所以然的 TypeError。
       *
       * 后台那边已经改成 sendResponse 了，但这里仍然自己站稳：
       * 拿不到状态就当作「不能释义」，标注该照常工作——AI 是加分项，不是前提。
       */
      try {
        const reply = (await send({ kind: 'ai:status' })) as { configured?: boolean } | undefined;
        canExplain = settings.aiEnabled && !!reply?.configured;
      } catch {
        canExplain = false;
      }
    }

    const card = new Card({
      lookup: (word) => send({ kind: 'dict:lookup', word }) as Promise<DictEntry | null>,
      analyze: async (token) => {
        const sentence = sentenceAround(token);
        const result = (await send({
          kind: 'ai:analyze',
          word: token.surface,
          lemma: token.lemma,
          sentence,
        })) as { ok: true; analysis: Analysis } | { ok: false; error: string };
        /**
         * 存盘在 background 那边做（钱在那儿花的，页面被关掉也不影响，见 remember）。
         * 这里只把内存镜像顺手更新一下。
         *
         * 不能等 storage 的变更通知绕回来再更新：那中间隔着一次事件派发，
         * 而这段时间里鼠标可能已经又停回同一个词上了——镜像还是空的，
         * 卡片就会再摆出一次「AI 释义」按钮，请用户为刚买过的东西再付一次。
         * 这一份稍后会被 watch 里那份权威的覆盖掉，时间戳差几毫秒无所谓。
         */
        if (result.ok) {
          explained = {
            ...explained,
            [token.lemma]: {
              sentence,
              surface: token.surface,
              analysis: result.analysis,
              time: Date.now(),
            },
          };
        }
        return result;
      },
      aiReady: async () => canExplain,
      cached: (lemma) => explained[lemma] ?? null,
      onKnown: async (lemma) => {
        known.add(lemma);
        await knownWordsStore.setValue([...known]);
      },
      onPointerEnter: () => hover.hold(),
      onPointerLeave: () => hover.release(),
    });

    const hover = new HoverTracker({
      onEnter: (token, rect) => void card.show(token, rect),
      onLeave: () => card.hide(),
    });

    let codeWords = new Set<string>();
    const seen = new Set<string>();

    function refreshSeen() {
      seen.clear();
      for (const t of tokens) seen.add(t.lemma);
    }

    function run() {
      if (
        !settings.enabled ||
        siteDisabled(location.hostname, settings.disabledSites) ||
        !looksEnglish()
      ) {
        tokens = [];
        seen.clear();
        clear();
        hover.setTokens([]);
        card.hide();
        return;
      }
      codeWords = collectCodeWords(document.body);
      seen.clear();
      tokens = scanSubtree(document.body, settings, known, canExplain, codeWords, examWords, seen).slice(0, MAX_TOKENS);
      paint(tokens);
      hover.setTokens(tokens);
      console.info(`[glint] Highlighted ${tokens.length} words (user level: ${settings.level}).`);
    }

    /** 键盘唯一能唤出卡片的入口，见 keynav.ts。 */
    nav = createWordNav({ tokens: () => tokens, hover, card });
    document.addEventListener('keydown', nav.onKeydown);

    card.mount();
    applyStyle(settings.style);
    hover.start();
    await Promise.all([refreshAiStatus(), refreshExamWords()]);
    schedule(run);

    /**
     * Safari-First 高性能增量扫描引擎：
     * 废弃原版每次变动都 100% 重扫整页 document.body 的方案。
     * 只处理真正发生变化的局部子树与 Text 节点，内存与主线程消耗下降两个数量级。
     */
    let pendingBatch: MutationRecord[] = [];
    let batchTimer: ReturnType<typeof setTimeout> | undefined;

    function isCodeNode(node: Node): boolean {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element;
        const tag = el.tagName;
        if (tag === 'CODE' || tag === 'PRE' || tag === 'KBD' || tag === 'SAMP' || tag === 'VAR') return true;
        if (el.querySelector?.('code, pre, kbd, samp, var')) return true;
      }
      return false;
    }

    function processBatch() {
      batchTimer = undefined;
      if (!pendingBatch.length) return;
      const records = pendingBatch;
      pendingBatch = [];

      if (
        !settings.enabled ||
        siteDisabled(location.hostname, settings.disabledSites) ||
        !looksEnglish()
      ) {
        return;
      }

      // 极端大幅度重构（如 SPA 路由整页切换，一次性扔进来上百条记录），退回全量重扫
      if (records.length > 250 || tokens.length === 0) {
        run();
        return;
      }

      let codeChanged = false;
      const dirtyTextNodes = new Set<Text>();
      const addedNodes = new Set<Node>();

      const host = card.element;
      for (const r of records) {
        if (r.target === host || host.contains(r.target)) continue;

        if (isCodeNode(r.target)) codeChanged = true;

        if (r.type === 'characterData' && r.target.nodeType === Node.TEXT_NODE) {
          dirtyTextNodes.add(r.target as Text);
        } else if (r.type === 'childList') {
          for (let i = 0; i < r.addedNodes.length; i++) {
            const node = r.addedNodes[i]!;
            if (node === host || host.contains(node)) continue;
            if (isCodeNode(node)) codeChanged = true;
            addedNodes.add(node);
          }
          for (let i = 0; i < r.removedNodes.length; i++) {
            const node = r.removedNodes[i]!;
            if (isCodeNode(node)) codeChanged = true;
          }
        }
      }

      if (codeChanged) {
        codeWords = collectCodeWords(document.body);
      }

      // 1. 剪除已脱离 DOM 树的旧 Token，以及文本已发生变动的 Text 节点中的旧 Token
      const prevLength = tokens.length;
      tokens = tokens.filter((t) => {
        const node = t.node;
        return !!node && node.isConnected && !dirtyTextNodes.has(node);
      });

      if (settings.oncePerPage) refreshSeen();

      let hasNewTokens = false;

      // 2. 增量扫描发生文本变动的 Text 节点
      for (const textNode of dirtyTextNodes) {
        if (!textNode.isConnected) continue;
        const newTokens = scanTextNode(textNode, settings, known, canExplain, codeWords, examWords, seen);
        if (newTokens.length) {
          tokens.push(...newTokens);
          hasNewTokens = true;
        }
      }

      // 3. 增量扫描新增的 DOM 子树
      for (const node of addedNodes) {
        if (!node.isConnected) continue;
        const newTokens = scanSubtree(node, settings, known, canExplain, codeWords, examWords, seen);
        if (newTokens.length) {
          tokens.push(...newTokens);
          hasNewTokens = true;
        }
      }

      if (tokens.length > MAX_TOKENS) {
        tokens = tokens.slice(0, MAX_TOKENS);
      }

      // 仅当 Token 发生增减时才重新提交高亮与更新索引，零冗余重绘
      if (hasNewTokens || tokens.length !== prevLength) {
        paint(tokens);
        hover.setTokens(tokens);
      }
    }

    const observer = new MutationObserver((records) => {
      const host = card.element;
      if (records.every((r) => r.target === host || host.contains(r.target))) return;
      pendingBatch.push(...records);
      if (batchTimer === undefined) {
        batchTimer = setTimeout(processBatch, 40);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    settingsStore.watch(async (stored) => {
      const next = withDefaults(stored);
      const styleChanged = next.style !== settings.style;
      settings = next;
      if (styleChanged) applyStyle(next.style);
      // 刚填上 Key 的话，生僻词的标注策略也跟着变，所以要在重扫之前刷新
      await Promise.all([refreshAiStatus(), refreshExamWords()]);
      schedule(run);
    });
    knownWordsStore.watch((next) => {
      known = new Set(next);
      schedule(run);
    });
    // 设置页删了某条释义，这边的镜像跟着变。不用重扫，标注不受它影响。
    explanationsStore.watch((next) => {
      explained = next;
    });

    window.addEventListener('pagehide', () => {
      observer.disconnect();
      hover.stop();
      card.destroy();
      removeStyle();
    });
  },
});

function send(message: unknown) {
  return browser.runtime.sendMessage(message);
}

/** 空闲时再扫，别和页面自己的首屏渲染抢主线程。 */
function schedule(fn: () => void) {
  if ('requestIdleCallback' in window) requestIdleCallback(() => fn(), { timeout: 1500 });
  else setTimeout(fn, 200);
}

/**
 * 中文站、日文站上跑一遍全文扫描是纯浪费。
 * textContent 不触发布局，采样前几千字看看拉丁字母占比就够判断了。
 */
function looksEnglish(): boolean {
  const sample = (document.body.textContent ?? '').slice(0, 4000);
  if (sample.length < 200) return false;
  let latin = 0;
  let cjk = 0;
  for (const ch of sample) {
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) latin++;
    else if (ch >= '一' && ch <= '鿿') cjk++;
  }
  return latin > sample.length * 0.3 && latin > cjk * 2;
}
