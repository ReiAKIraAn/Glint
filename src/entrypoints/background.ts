import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { APICallError, generateText, type LanguageModel } from 'ai';
import { browser, defineBackground } from '#imports';
import { AI_PORT_NAME, handleAiPortConnection } from '@/lib/ai-port';
import { apiKeysStore, migrateLegacyKey } from '@/lib/keys';
import { fetchProviderModels } from '@/lib/provider-network';
import { redactSecrets, safeErrorMessage, sanitizeUrl } from '@/lib/security';
import { capExplanations, explanationsStore, readSettings } from '@/lib/settings';
import {
  PROVIDERS,
  baseURLOf,
  isConfigured,
  modelOf,
  type Analysis,
  type DictEntry,
  type Effort,
  type Explained,
  type Message,
  type ModelList,
  type Provider,
  type Settings,
} from '@/lib/types';

/**
 * 所有联网和所有涉及 API key 的事情都只发生在这里。
 * content script 跑在页面上下文里，永远拿不到 key，只能发消息过来问。
 */
export default defineBackground(() => {
  void migrateLegacyKey();

  /**
   * 快捷键转给当前标签页的内容脚本。
   *
   * onCommand 的第二个参数就是触发时那个标签页，所以不用 tabs 权限也拿得到 id。
   * 页面上没有内容脚本（chrome:// 之类）时 sendMessage 会拒绝，吞掉就行——
   * 在那种页面上按快捷键本来就不该有任何反应。
   */
  browser.commands?.onCommand.addListener((command, tab) => {
    if (tab?.id === undefined) return;
    const delta = command === 'prev-word' ? -1 : 1;
    void browser.tabs.sendMessage(tab.id, { kind: 'nav:step', delta }).catch(() => {});
  });

  /**
   * **不要在这里返回 Promise。**
   *
   * 「监听器返回 Promise」是 Firefox 的写法，Chromium 上一直没有（crbug.com/1185241）。
   * Chrome 144 短暂开过，2026-01-19 又用服务端配置回滚，145/146 才重新放出——
   * 也就是说它是个**按版本、按 Finch 分组、按浏览器厂商**各不相同的开关：
   * Edge 和各种 Chromium 套壳跟 Chrome 的节奏并不一致。
   *
   * 开关关着的时候，返回的 Promise 会被整个丢掉，发送方**立刻收到 undefined**——
   * 没有报错，没有超时，两边控制台干干净净。内容脚本那边一句
   * `(await send(...)).configured` 就抛在了 undefined 上，
   * 于是首屏扫描不执行、AI 释义永远转圈，而在开关开着的机器上一切正常。
   *
   * 所以走 sendResponse：同步 `return true` 把通道占住，等结果落地再回填。
   * 这条路从 MV2 到今天在所有 Chromium 上都成立，不依赖任何开关。
   */
  browser.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
    const work = dispatch(message);
    if (!work) return undefined; // 不认识的消息：让出去，别占着通道
    void work.then(sendResponse);
    return true;
  });

  browser.runtime.onConnect?.addListener((port) => {
    if (port.name === AI_PORT_NAME) {
      handleAiPortConnection(port);
    }
  });
});

function dispatch(message: Message): Promise<unknown> | undefined {
  switch (message.kind) {
    case 'dict:lookup':
      return guard(() => lookup(message.word), null);
    case 'ai:analyze':
      return guard(() => analyze(message.word, message.lemma, message.sentence), failed);
    case 'exam:words':
      return guard(() => examWords(message.exam), []);
    case 'ai:status':
      return guard(() => status(), { configured: false });
    case 'ai:models':
      return guard(() => models(), failed);
    default:
      return undefined;
  }
}

/**
 * 让每个处理函数都不要 reject。
 *
 * Chrome 146 之前，监听器返回的 Promise 一旦 reject，发送方收到的是一个光秃秃的
 * `undefined`——异常在跨上下文的路上被丢掉了，两边控制台都不会留下任何东西。
 * 那是最难查的一类故障：功能不工作，但没有人报错，问用户也问不出更多。
 *
 * 所以在抛出的这一侧就把它落成一条能看见的结果，同时往后台控制台打一份原始错误，
 * 好让「打开 Service Worker 看一眼」这条路真的有东西可看。
 */
async function guard<T>(run: () => Promise<T>, fallback: T | ((why: string) => T)): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const safeError = safeErrorMessage(error);
    console.error('[glint] 后台处理消息时抛了：', safeError);
    const why = error instanceof Error ? `${error.name}: ${safeError}` : safeError;
    return typeof fallback === 'function' ? (fallback as (why: string) => T)(why) : fallback;
  }
}

/** ok/error 那一族的兜底：把异常原文带回去，卡片和设置页都直接显示它。 */
const failed = (why: string) => ({ ok: false as const, error: `后台出错：${why}` });

// ---------------------------------------------------------------- 本地词库

/**
 * dict.json 有 4MB，只有 hover 才用得上，所以不打进 content script，
 * 放在扩展包里由这里懒加载一次。service worker 被回收后会重新加载，
 * 但读的是扩展本地文件，几十毫秒的事。
 */
let dictPromise: Promise<Record<string, [string, string, string, number]>> | undefined;

function loadDict() {
  dictPromise ??= fetch(browser.runtime.getURL('/data/dict.json'))
    .then((response) => response.json())
    .catch(() => ({}));
  return dictPromise;
}

async function lookup(word: string): Promise<DictEntry | null> {
  const row = (await loadDict())[word.toLowerCase()];
  if (!row) return null;
  const [phonetic, translation, tags, rank] = row;
  return { phonetic, translation, tags: tags ? tags.split(' ').filter(Boolean) : [], rank };
}

/**
 * 备考词表。六份表加起来 0.25MB，而且只有开了备考模式才用得上，
 * 所以跟 dict.json 一样放在扩展包里按需取，不进 content script 的 bundle。
 */
let examsPromise: Promise<Record<string, string>> | undefined;

async function examWords(exam: string): Promise<string[]> {
  examsPromise ??= fetch(browser.runtime.getURL('/data/exams.json'))
    .then((response) => response.json())
    .catch(() => ({}));
  const list = (await examsPromise)[exam];
  return list ? list.split(' ') : [];
}

// ---------------------------------------------------------------- AI 语境释义

const SYSTEM = `你在帮一个中文母语者读英文网页。用户把鼠标停在了某个生词上。
只解释这个词在给定的这一句里的意思，不要罗列词典上的所有义项。
语气像一个懂行的朋友随口讲一句，不要教科书腔。

只输出一个 JSON 对象，前后不要加任何别的话，也不要用代码块包起来。字段：
  sense       这个词在这句话里的意思。中文，一句话，20 字以内。
  en          对应这个义项的英文释义，12 词以内。
  note        词根构词、固定搭配、或容易混淆的近义词，中文一句话。没有真正值得说的就给空字符串，不要硬凑。
  sentenceZh  把给你的那句原句整句译成中文。句子开头或结尾有 … 的说明它是从长句里截出来的一段，照译不用补全。
  example     用同一个义项造一个新例句，英文，15 词以内。
  exampleZh   上面例句的中文翻译。`;

type Result = { ok: true; analysis: Analysis } | { ok: false; error: string };

/** AI SDK 没把这个类型导出来，从 generateText 的参数上取。 */
type ProviderOptions = NonNullable<Parameters<typeof generateText>[0]['providerOptions']>;

async function status() {
  const settings = await readSettings();
  return { configured: !!(settings.aiEnabled && (await ready(settings))) };
}

/** 配齐了才算就绪。判定本身在 types.ts，这里只负责把真 Key 取出来带走。 */
async function ready(settings: Settings): Promise<{ key: string } | null> {
  const key = (await apiKeysStore.getValue())[settings.provider] ?? '';
  return isConfigured(settings, !!key) ? { key } : null;
}

/**
 * 这个地址发得出去吗？
 *
 * 没有 host 权限的话浏览器会在请求出门前就拦掉，而拦掉的样子和断网、和域名写错
 * 一模一样——都是一个光秃秃的 TypeError。所以先自己查一遍，把这三种情况分开说。
 */
async function allowed(url: string): Promise<boolean> {
  try {
    return await browser.permissions.contains({ origins: [`${new URL(url).origin}/*`] });
  } catch {
    return true; // 查不了就别拦着，让请求自己去撞
  }
}

const endpointOf = (settings: Settings): string => {
  const spec = PROVIDERS[settings.provider];
  return spec.kind === 'compatible' ? baseURLOf(settings) : spec.origin.replace('/*', '');
};

async function analyze(word: string, lemma: string, sentence: string): Promise<Result> {
  const settings = await readSettings();
  if (!settings.aiEnabled) return { ok: false, error: 'AI 释义在设置里关着' };

  const configured = await ready(settings);
  if (!configured) {
    return { ok: false, error: `${PROVIDERS[settings.provider].name} 还没配置好，去设置里看一下` };
  }

  const endpoint = endpointOf(settings);
  if (!(await allowed(endpoint))) {
    return { ok: false, error: `没有访问 ${host(endpoint)} 的权限，去设置页重新保存一次 Key` };
  }

  try {
    const { text } = await generateText({
      model: languageModel(settings, configured.key),
      system: SYSTEM,
      prompt: `单词：${word}${lemma !== word.toLowerCase() ? `（原型 ${lemma}）` : ''}
所在句子：${sentence}`,
      maxOutputTokens: 1024 + THINKING_BUDGET[settings.effort],
      providerOptions: effortOptions(settings.provider, settings.effort),
      /**
       * 只重试一次。默认要退避重试三次，最坏情况下卡片上那三个点要转十几秒——
       * 这时候用户早就把鼠标移走了，重试成功也没人看。
       */
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(ANALYZE_TIMEOUT),
    });
    const analysis = parse(text);
    await remember(lemma, { sentence, surface: word, analysis, time: Date.now() });
    return { ok: true, analysis };
  } catch (error) {
    return { ok: false, error: safeErrorMessage(describe(error, settings.provider), [configured.key]) };
  }
}

/**
 * 生成成功就立刻存下来。同一个词不该付第二次——换页面、关浏览器都还算数，
 * 要重新生成得用户自己去设置页删掉那一条。
 *
 * **存盘放在这里，不放在内容脚本里**：钱是在这一行上面那次 generateText 里花掉的，
 * 而内容脚本随时可能连人带上下文一起消失——请求飞着的时候用户点了个链接跳走，
 * 页面一卸载，那边的存盘代码根本不会执行，但这边已经付过了。存在花钱的那一端，
 * 结果就和页面的死活无关。
 *
 * 写之前重新读一次，不要拿任何内存里的镜像去覆盖：存的是整个对象，
 * 而另一个标签页这段时间可能刚生成过几条，那都是花过钱的东西。
 * 不是原子的（storage 没有比较并交换），但重读一次把冲突窗口压到了这两行之间。
 * 真要根治得一词一键存，那会把设置页的列表和清空逻辑一起搅进去（见 settings.ts）。
 */
async function remember(lemma: string, entry: Explained): Promise<void> {
  try {
    const stored = await explanationsStore.getValue();
    await explanationsStore.setValue(capExplanations({ ...stored, [lemma]: entry }));
  } catch {
    /**
     * 存不下也要把释义交出去。
     *
     * 配额满、或者存储这一刻不可用——这些都不该让一次**已经付过钱的**成功生成
     * 变成卡片上的一句报错。代价只是这个词下次还得重新生成，
     * 比起「钱花了、东西也没看到」是明显划算的那一边。
     */
  }
}

/**
 * 四家的差别到这里为止，后面全走 AI SDK 那套统一接口。
 *
 * Anthropic 那个头是必须的：从浏览器直连它默认拒，官方 SDK 的 dangerouslyAllowBrowser
 * 加的也是这一个头。请求从 service worker 发出，key 不进页面上下文。
 */
function languageModel(settings: Settings, apiKey: string): LanguageModel {
  const model = modelOf(settings);
  switch (PROVIDERS[settings.provider].kind) {
    case 'anthropic':
      return createAnthropic({
        apiKey,
        headers: { 'anthropic-dangerous-direct-browser-access': 'true' },
      })(model);
    case 'openai':
      return createOpenAI({ apiKey })(model);
    case 'google':
      return createGoogleGenerativeAI({ apiKey })(model);
    case 'compatible':
      // name 固定成 compatible，下面那张思考强度的表才好按它取到 providerOptions
      return createOpenAICompatible({
        name: 'compatible',
        apiKey,
        baseURL: baseURLOf(settings),
      })(model);
  }
}

/**
 * 网络超时。
 *
 * fetch 自己永远不会超时。请求被中间设备静静丢掉（不是拒绝，是丢）的时候，
 * promise 一直吊着不 settle——卡片上那三个点就转到天荒地老，控制台里一个字都没有，
 * 用户看到的是「坏了」，而我们连一条能往下查的线索都拿不到。
 * 宁可武断地掐断，也要换来一句「超时」。
 */
const MODELS_TIMEOUT = 20_000;
/** 释义得等模型把话说完，高思考强度下正常就要几十秒，给得比拉列表宽得多。 */
const ANALYZE_TIMEOUT = 90_000;

/** 思考预算。上限也跟着涨——Anthropic 要求 max_tokens 必须大于思考预算。 */
const THINKING_BUDGET: Record<Effort, number> = { off: 0, low: 1024, medium: 4096, high: 12000 };

/**
 * 同一个「思考强度」在四家的说法都不一样，这里翻译一遍。
 *
 * compatible 那一路是原样透传 `reasoning_effort`，不认这个字段的服务会直接报 400，
 * 所以选了「不思考」就干脆什么都不发——大多数兼容接口在这条路上才是安全的。
 */
function effortOptions(provider: Provider, effort: Effort): ProviderOptions {
  switch (PROVIDERS[provider].kind) {
    case 'anthropic':
      return {
        anthropic:
          effort === 'off'
            ? { thinking: { type: 'disabled' } }
            : { thinking: { type: 'enabled', budgetTokens: THINKING_BUDGET[effort] } },
      };
    case 'openai':
      return { openai: { reasoningEffort: effort === 'off' ? 'none' : effort } };
    case 'google':
      return {
        google:
          effort === 'off'
            ? { thinkingConfig: { thinkingBudget: 0 } }
            : { thinkingConfig: { thinkingLevel: effort } },
      };
    case 'compatible':
      return effort === 'off' ? {} : { compatible: { reasoningEffort: effort } };
  }
}

/**
 * 问这家有哪些模型。
 *
 * 模型名是这套配置里最容易过时的东西——各家改名比这个扩展发版勤快得多。
 * 与其让用户去翻文档手打，不如配好 Key 之后直接问接口要一份。
 * 四种协议四个说法，跟上面那张思考强度的表一样，差别在这里收口。
 */
async function models(): Promise<ModelList> {
  const settings = await readSettings();
  const configured = await ready(settings);
  const key = configured?.key ?? (await apiKeysStore.getValue())[settings.provider] ?? '';
  return fetchProviderModels(settings, key);
}

/**
 * 宽松地把 JSON 抠出来。
 *
 * 没用 generateObject：那条路在 Anthropic 上是靠强制工具调用实现的，而强制工具调用
 * 和 extended thinking 不能同时开——一开思考就报错。这里的活本来就简单，
 * 让模型直接吐 JSON、这边容忍一层代码块，四家四种思考强度都能跑。
 */
function parse(raw: string): Analysis {
  const text = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new SyntaxError('no json');

  const data = JSON.parse(text.slice(start, end + 1)) as Partial<Analysis>;
  const str = (value: unknown) => (typeof value === 'string' ? value : '');
  return {
    sense: str(data.sense),
    en: str(data.en),
    note: str(data.note),
    sentenceZh: str(data.sentenceZh),
    example: str(data.example),
    exampleZh: str(data.exampleZh),
  };
}

/**
 * AbortSignal.timeout 掐断时抛的是 DOMException（name 为 TimeoutError），
 * 不是 Error 的任何一个常见子类——不单独认一下，它会掉进 describe 最后那条
 * 兜底里，变成一句「signal timed out」，等于什么都没说。
 */
const timedOut = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');

const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** 分类型给出用户能照着做点什么的提示，而不是把报错原文摊在卡片上。 */
function describe(error: unknown, provider: Provider): string {
  const name = PROVIDERS[provider].name;
  if (APICallError.isInstance(error)) {
    switch (error.statusCode) {
      case 401:
        return `${name} 的 API Key 无效，去设置里检查一下`;
      case 403:
        return '这个 Key 没有权限调用该模型';
      case 404:
        return '模型名不对，去设置里换一个';
      case 429:
        return '请求太频繁了，缓一下再试';
      default:
        return error.statusCode && error.statusCode >= 500
          ? `${name} 服务端出错了（${error.statusCode}）`
          : `接口报错 ${error.statusCode ?? ''}`.trim();
    }
  }
  if (timedOut(error)) return `${name} ${ANALYZE_TIMEOUT / 1000} 秒没有响应，请求发出去了但没回来`;
  if (error instanceof SyntaxError) return '模型返回的不是合法 JSON';
  if (error instanceof TypeError) return `连不上 ${name}：${safeErrorMessage(error.message)}`;
  return error instanceof Error ? safeErrorMessage(error.message) : '未知错误';
}
