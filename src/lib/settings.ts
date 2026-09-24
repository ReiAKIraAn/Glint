import { storage } from '#imports';
import {
  DEFAULT_MODELS,
  DEFAULT_SETTINGS,
  type Explained,
  type Settings,
} from './types';

/**
 * 设置分两处存，不是为了整洁，是为了 API key 不进内容脚本。
 *
 * content script 会读 `local:settings`（每个页面都读），所以 key 绝不能放在里面。
 * key 存在 `local:apiKeys`，而且**连访问它的代码都在另一个模块**（keys.ts）——
 * defineItem 是模块级副作用，同一个文件里放一份就会被打进内容脚本的 bundle。
 * 只有 background 和设置页 import 那一个模块，请求也只从后台发出去。
 */
export const settingsStore = storage.defineItem<Settings>('local:settings', {
  fallback: DEFAULT_SETTINGS,
});

/**
 * 存进去的设置是当时那个版本的形状，读出来的时候可能缺字段。
 *
 * WXT 的 fallback 只在「一次都没存过」时生效，存过之后拿到的就是那份旧对象——
 * 加了新字段而不补默认值的话，老用户升上来读到的是 undefined，
 * 然后在 `settings.models[provider]` 这种地方炸掉。所有读取都过一遍这里。
 */
export function withDefaults(
  stored: Partial<Settings> & { model?: string; baseURL?: string },
): Settings {
  // model / baseURL 是老版本的字段，搬进新结构之后就不再往下传，否则用户改了
  // Anthropic 的模型名，下次读取又会被那个旧值盖回去。
  const { model: legacyModel, baseURL: legacyBaseURL, ...rest } = stored;
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    ...rest,
    models: { ...DEFAULT_MODELS, ...rest.models },
    baseURLs: { ...rest.baseURLs },
  };
  if (legacyModel && !rest.models?.anthropic) settings.models.anthropic = legacyModel;
  if (legacyBaseURL && !settings.baseURLs.compatible) settings.baseURLs.compatible = legacyBaseURL;
  return settings;
}

export async function readSettings(): Promise<Settings> {
  return withDefaults(await settingsStore.getValue());
}

/**
 * 已经生成过的语境释义，按原型存。
 *
 * AI 那一步是这个扩展唯一花钱的地方，所以生成过就不再生成第二次——换页面、关浏览器
 * 都还在。要重新生成只有一条路：用户自己去设置页把那条删掉。
 */
export const explanationsStore = storage.defineItem<Record<string, Explained>>(
  'local:explanations',
  { fallback: {} },
);

/**
 * 存量上限。
 *
 * 定这个数的依据是配额：chrome.storage.local 不申请 unlimitedStorage 时是 10MB，
 * 一条释义连原句带译文大约 0.8KB，2000 条约 1.6MB，占配额的一成六，留足余量。
 * 没有上限的话它只会一直涨，涨到写不进去为止——而那时报错发生在「点了释义、
 * 等了几秒、结果没存下来」，最难查。
 *
 * 没有为此去申请 unlimitedStorage：为一个存量问题多要一项权限，
 * 换来的是安装时多一行吓人的说明和商店审核多一道解释，不划算。
 *
 * 代价是每存一条要重写整个对象（最坏 1.6MB）。可接受：这一步只在用户主动点了
 * 「AI 释义」之后发生，而那本来就要等一次网络往返。真嫌慢的话下一步是拆成
 * 一词一键存，但那会把设置页的列表和清空逻辑一起搅进去，现在不值当。
 */
export const EXPLANATION_LIMIT = 2000;

/**
 * 超出上限就丢掉最旧的几条。
 *
 * 按生成时间淘汰，不是按访问时间——这里存的是花过钱的东西，而「最近生成的」
 * 比「最近看过的」更接近「还用得上的」：你正在读的那批文章里的词都是新生成的。
 */
export function capExplanations(all: Record<string, Explained>): Record<string, Explained> {
  const words = Object.keys(all);
  if (words.length <= EXPLANATION_LIMIT) return all;
  const kept = words
    .sort((a, b) => (all[b]?.time ?? 0) - (all[a]?.time ?? 0))
    .slice(0, EXPLANATION_LIMIT);
  return Object.fromEntries(kept.map((word) => [word, all[word]!]));
}

/** 用户手动标记「我认识这个词」的原型集合，之后全站不再标注。 */
export const knownWordsStore = storage.defineItem<string[]>('local:knownWords', { fallback: [] });

// ---------------------------------------------------------------- 备份

/**
 * 备份文件的形状。
 *
 * **API Key 不在里面，而且永远不该在。** 备份是个会被随手拷进网盘、转发给自己的
 * 文件；密钥进去一次就再也收不回来了。少这一样，换机器时多填一次 Key，
 * 换来的是这个文件泄漏了也不至于让人损失额度。
 */
export interface Backup {
  /** 形状变了就涨。导入时据此判断认不认得。 */
  version: 1;
  exportedAt: number;
  settings: Partial<Settings>;
  knownWords: string[];
  explanations: Record<string, Explained>;
}

export const BACKUP_VERSION = 1;

/**
 * 校验一个来路不明的 JSON 是不是备份。
 *
 * 这是整个扩展里唯一一处接收外部文件的地方，所以每个字段都得自己验一遍——
 * 一个字段形状不对，写进存储之后受害的是设置页而不是这里，那时候查不回来。
 * 宁可整份拒掉，也不要「大部分能用」。
 */
export function parseBackup(raw: unknown): { ok: true; backup: Backup } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: '这不是一个备份文件' };
  const data = raw as Record<string, unknown>;
  if (data.version !== BACKUP_VERSION) {
    return { ok: false, error: `备份版本是 ${String(data.version)}，这个版本认不了` };
  }

  const knownWords = Array.isArray(data.knownWords)
    ? data.knownWords.filter((w): w is string => typeof w === 'string' && !!w)
    : [];

  const explanations: Record<string, Explained> = {};
  if (typeof data.explanations === 'object' && data.explanations !== null) {
    for (const [word, value] of Object.entries(data.explanations as Record<string, unknown>)) {
      const item = value as Partial<Explained>;
      if (typeof item?.sentence !== 'string' || typeof item.analysis !== 'object' || !item.analysis) {
        continue; // 单条坏了就丢这一条，不牵连整份备份
      }
      explanations[word] = {
        sentence: item.sentence,
        surface: typeof item.surface === 'string' ? item.surface : undefined,
        analysis: item.analysis,
        time: typeof item.time === 'number' ? item.time : 0,
      };
    }
  }

  const settings =
    typeof data.settings === 'object' && data.settings !== null
      ? (data.settings as Partial<Settings>)
      : {};

  return {
    ok: true,
    backup: {
      version: BACKUP_VERSION,
      exportedAt: typeof data.exportedAt === 'number' ? data.exportedAt : 0,
      settings,
      knownWords,
      explanations,
    },
  };
}

/**
 * 合并，不是覆盖。
 *
 * 两台机器各用各的，导入的目的是「把那边攒的也拿过来」，不是「把这边清掉」。
 * 已认识的词取并集；同一个词两边都有释义时留较新的那条——两条都是花过钱的，
 * 但新的那条对应的是更近的一次阅读。
 */
export function mergeBackup(
  backup: Backup,
  current: { knownWords: string[]; explanations: Record<string, Explained> },
): { knownWords: string[]; explanations: Record<string, Explained> } {
  const merged: Record<string, Explained> = { ...current.explanations };
  for (const [word, incoming] of Object.entries(backup.explanations)) {
    const mine = merged[word];
    if (!mine || incoming.time > mine.time) merged[word] = incoming;
  }
  return {
    knownWords: [...new Set([...current.knownWords, ...backup.knownWords])],
    explanations: capExplanations(merged),
  };
}
