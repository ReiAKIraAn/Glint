/** CEFR 1–6 对应 A1–C2。运行时只比大小，不关心名字。 */
export type Level = 1 | 2 | 3 | 4 | 5 | 6;

/** 词库里查不到的词。不是“简单”，是“连词库都没收录”，按最难处理。 */
export const UNKNOWN_LEVEL = 7;

export const LEVEL_NAMES = ['', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2', '生僻'] as const;

/** 本地词库能给出的东西：不用联网，不花钱。 */
export interface DictEntry {
  /** 音标 */
  phonetic: string;
  /** 中文释义，最多三条，\n 分隔 */
  translation: string;
  /** 考试标签：zk gk cet4 cet6 ky toefl ielts gre */
  tags: string[];
  /** COCA/BNC 词频排名，0 表示未知 */
  rank: number;
}

/** 只有调 AI 才拿得到的东西：这个词在**这一句**里是什么意思。 */
export interface Analysis {
  /** 在当前句子里的意思（中文一句话） */
  sense: string;
  /** 英文释义，尽量短 */
  en: string;
  /** 词根 / 构词 / 搭配 / 易混词，可能为空 */
  note: string;
  /** 原句的中文翻译。老版本存下来的释义里没有这个字段，卡片要容得下它是空的。 */
  sentenceZh: string;
  /** 一个新例句 */
  example: string;
  exampleZh: string;
}

/**
 * 一条已经花钱生成过的语境释义。
 *
 * 连生成时所在的句子一起存——`sense` 是对着那一句给的，换了句子就不一定还对得上，
 * 卡片得知道这一点才能如实说明（见 card.ts 的 stale 态）。
 */
export interface Explained {
  sentence: string;
  /**
   * 页面上那个词的原样写法（strata，而不是原型 stratum）。
   *
   * 存下来是为了设置页能把原句里的那个词准确加粗。老版本存的条目没有这个字段，
   * 所以是可选的——读的地方得容得下它缺席。
   */
  surface?: string;
  analysis: Analysis;
  /** 生成时间，毫秒。设置页按它倒序列出来。 */
  time: number;
}

/**
 * Milestone 5 (D2 & D10) 持久化 AI 释义缓存条目契约。
 * 严格仅包含词汇原型、纯文本释义与 LRU 更新时间戳。
 * 严禁包含句子、网页上下文、DOM、URL 或凭据。
 */
export interface ExplanationCacheEntry {
  word: string;
  explanation: string;
  updatedAt: number;
}

/**
 * 国内考纲阶梯。0 表示不用这个维度。
 * 选了之后，该考纲及以下的词全部静音——相当于一次性把几千个词标成「我认识」。
 */
export type PassedExam = 0 | 1 | 2 | 3 | 4 | 5;

export const EXAM_NAMES = ['不设置', '中考', '高考', '四级', '六级', '考研'] as const;

/** 可以设为备考目标的考纲。空串 = 不开备考模式。 */
export type TargetExam = '' | 'cet4' | 'cet6' | 'ky' | 'toefl' | 'ielts' | 'gre';

export const TARGET_NAMES: Record<Exclude<TargetExam, ''>, string> = {
  cet4: '四级',
  cet6: '六级',
  ky: '考研',
  toefl: '托福',
  ielts: '雅思',
  gre: 'GRE',
};

/**
 * 出释义的服务商。
 *
 * 只有前三家有各自的 SDK，其余全是 OpenAI 兼容接口——差别仅在地址、默认模型和去哪拿 Key。
 * 所以这里是一张表而不是一堆分支：加一家只要多写五行，不用多装一个包，
 * 也不会让后台再胖一圈。表里没有的，选「自定义」把地址填进去就是了。
 */
export type Provider = 'openai' | 'deepseek' | 'custom';

export interface ProviderSpec {
  name: string;
  /** 走哪套 SDK / 适配协议。 */
  kind: 'openai' | 'deepseek' | 'custom';
  /** 兼容接口的默认地址。设置页里可以改，改过的按服务商各存一份。 */
  baseURL?: string;
  /** 默认模型名。空字符串 = 各人装的不一样，必须自己填。 */
  model: string;
  /** 需要的 host 权限。空 = 地址由用户填，保存时现要。 */
  origin: string;
  /** 本机服务，不需要 Key。 */
  keyless?: boolean;
  /** 去哪拿 Key。 */
  keyURL?: string;
  /**
   * @lobehub/icons-static-svg 里的文件名（不含扩展名）。
   */
  icon: string;
}

export const PROVIDERS: Record<Provider, ProviderSpec> = {
  openai: {
    name: 'OpenAI',
    kind: 'openai',
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    origin: 'https://api.openai.com/*',
    keyURL: 'https://platform.openai.com/api-keys',
    icon: 'openai',
  },
  deepseek: {
    name: 'DeepSeek',
    kind: 'deepseek',
    baseURL: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    origin: 'https://api.deepseek.com/*',
    keyURL: 'https://platform.deepseek.com/api_keys',
    icon: 'deepseek-color',
  },
  custom: {
    name: '自定义接口',
    kind: 'custom',
    model: '',
    origin: '',
    icon: '',
    keyless: true,
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as Provider[];

/** 各家的默认模型。模型名更新得比这个扩展快，所以设置页里是个可编辑的输入框。 */
export const DEFAULT_MODELS = Object.fromEntries(
  PROVIDER_IDS.map((id) => [id, PROVIDERS[id].model]),
) as Record<Provider, string>;

/**
 * 思考强度。
 *
 * 默认关着：解释一个词是查词典级别的活，而卡片是鼠标停在那儿等着看的，
 * 多想两秒的收益远不如少等两秒。真遇到难句再往上调。
 */
export type Effort = 'off' | 'low' | 'medium' | 'high';

export const EFFORT_NAMES: Record<Effort, string> = {
  off: '不思考 · 最快',
  low: '低',
  medium: '中',
  high: '高 · 最慢',
};

export interface Settings {
  enabled: boolean;
  /** 标注等级高于此值的词。3 = 我到 B1，B2 以上给我标出来 */
  level: Level;
  /** 词库里没有的生僻词也标 */
  markUnknown: boolean;
  /** 同一个词在一页里只标第一次 */
  oncePerPage: boolean;
  style: 'dotted' | 'tint' | 'underline' | 'color';
  /**
   * 「我已经通过了 X」。该考纲及以下的词不再标注。
   *
   * 存在的理由：频率分级会误伤 crab、husk、pollen 这类具体名词——排名靠后但
   * 任何过了四六级的人都认识。让用户一个个点「认识」要点几百次，
   * 而考纲是他们真正说得出口的自我评估。
   */
  passedExam: PassedExam;
  /**
   * 备考模式：只标这份考纲里的词。
   *
   * 语义是**交集**——既在考纲里、又高于你的水平，才标。考纲里有几千个你早就会的词，
   * 全标出来是纯噪音；两个维度取交集，剩下的正好是备考时最该看的那部分。
   */
  targetExam: TargetExam;
  /**
   * 这些站不标注。
   *
   * 全局开关之外单独有这个，是因为「哪里不想被标」几乎总是按站点分的：
   * 技术文档站上误标最多（黑话、标识符、产品名），而那恰恰是你最不想被打扰的地方。
   * 为此每次去翻全局开关，等于每天开关好几次。
   *
   * 存归一化后的主机名（去掉 www.、转小写），匹配时连子域一起算——
   * 在 wikipedia.org 上关掉，en.wikipedia.org 也跟着关。
   */
  disabledSites: string[];
  /** 关掉就完全不联网，只用本地词库 */
  aiEnabled: boolean;
  provider: Provider;
  /** 每家各记一个模型名，来回切的时候不用重填 */
  models: Record<Provider, string> & Record<string, string>;
  effort: Effort;
  /**
   * 改过的接口地址，按服务商各存一份。没改过的不在这里，读的是 PROVIDERS 里的默认值——
   * 预置地址万一哪天变了（或者我填错了），用户自己改一行就能救，不用等我发版。
   */
  baseURLs: Partial<Record<Provider, string>> & Record<string, string | undefined>;
  /** 自定义接口的额外请求体（JSON 格式字符串） */
  customExtraBody?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  level: 3,
  markUnknown: true,
  oncePerPage: true,
  style: 'dotted',
  passedExam: 0,
  targetExam: '',
  disabledSites: [],
  aiEnabled: true,
  provider: 'openai',
  models: { ...DEFAULT_MODELS },
  effort: 'off',
  baseURLs: {},
  customExtraBody: '{\n  "thinking_mode": false\n}',
};

// ------------------------------------------------------------ content ↔ background

export type Message =
  | { kind: 'dict:lookup'; word: string }
  | { kind: 'ai:analyze'; word: string; lemma: string; sentence: string }
  | { kind: 'ai:status' }
  /** 配好之后去问这家有哪些模型，省得手打 */
  | { kind: 'ai:models' }
  | { kind: 'exam:words'; exam: string }
  /** popup → 当前标签页的内容脚本，问这一页标了多少词 */
  | { kind: 'page:stats' }
  /** 快捷键 → 内容脚本：跳到上/下一个标注的词并弹出卡片（键盘唯一的入口） */
  | { kind: 'nav:step'; delta: number };

/** 内容脚本对 page:stats 的回复。 */
export interface PageStats {
  marked: number;
  /** 页面不是英文、或总开关关着时为 false */
  active: boolean;
  /**
   * 这个浏览器画不画得了标注（CSS Custom Highlight API）。
   *
   * 单独报一个字段，是因为「不支持」和「连不上内容脚本」在 popup 那边长得一样，
   * 但该做的事完全相反：前者无解，后者刷新一下页面就好。
   */
  supported: boolean;
}

// ------------------------------------------------------------ 站点开关

/**
 * 主机名归一化。www 前缀是纯噪音——没人认为 www.example.com 和 example.com
 * 是两个网站，但字符串比较会认。
 */
export function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

/**
 * 这个站关掉了没有。
 *
 * 子域一起算：在 wikipedia.org 上关掉，en.wikipedia.org 也该关掉。
 * 但必须以点号为界比，否则 example.com 会把 notexample.com 一起关了。
 */
export function siteDisabled(host: string, disabled: string[]): boolean {
  const target = normalizeHost(host);
  return disabled.some((entry) => {
    const site = normalizeHost(entry);
    return !!site && (target === site || target.endsWith(`.${site}`));
  });
}

export type ModelList = { ok: true; models: string[] } | { ok: false; error: string };

export type Reply<M extends Message> = M extends { kind: 'dict:lookup' }
  ? DictEntry | null
  : M extends { kind: 'ai:analyze' }
    ? { ok: true; analysis: Analysis } | { ok: false; error: string }
    : M extends { kind: 'ai:models' }
      ? ModelList
      : { configured: boolean };

/** 当前该往哪个地址发。用户改过就用改过的，否则用表里的预置值。 */
export function baseURLOf(settings: Settings, provider = settings.provider): string {
  return settings.baseURLs[provider] ?? PROVIDERS[provider].baseURL ?? '';
}

/** 当前该用哪个模型。每家各记一份，没记过就用表里的预置值。 */
export function modelOf(settings: Settings, provider = settings.provider): string {
  return settings.models[provider] || DEFAULT_MODELS[provider];
}

/**
 * 配齐了没有——Key（本机服务免）、模型名、兼容接口的地址，缺一不可。
 *
 * 这个判断必须只有一处。之前后台、设置页、弹窗各写了一份，而且写得不一样：
 * 后台要模型名，另外两处只看 Key。于是选 Ollama（免 Key，但预置模型名是空的）时，
 * 设置页的预览照常摆出「AI 释义」按钮、弹窗显示「已启用」，点下去后台才说没配好。
 * 三处各自为政，用户看到的是一个假的就绪状态。
 *
 * @param hasKey 这家的 Key 存下来了没有。后台读得到真 Key，页面只知道存没存过，
 *   所以传布尔进来而不是在这里去读存储——顺带保证这个函数是纯的、随处可调。
 */
export function isConfigured(settings: Settings, hasKey: boolean): boolean {
  const spec = PROVIDERS[settings.provider];
  if (!spec) return false;
  if (!hasKey && !spec.keyless) return false;
  if (!modelOf(settings)) return false;
  if (spec.kind === 'custom' && !baseURLOf(settings)) return false;
  return true;
}
