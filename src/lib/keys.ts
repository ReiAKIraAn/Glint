import { storage } from '#imports';
import type { Provider } from './types';

/**
 * API Key 的存储。**单独一个模块，不和 settings.ts 放在一起。**
 *
 * 拆开不是为了整洁。`storage.defineItem` 是模块级副作用，只要内容脚本 import 了
 * 同一个模块，这几个访问器就会被打进内容脚本的 bundle 并在每个页面上执行一遍——
 * 密钥本身不会泄给页面（内容脚本在隔离世界，页面 JS 碰不到 chrome.storage），
 * 但「读得到 Key 的代码根本不出现在页面上下文里」这条边界就名存实亡了。
 *
 * 所以：只有 background 和设置页 import 这里，内容脚本的依赖图碰不到它。
 * 加东西之前先想清楚会不会被内容脚本间接引用。
 */
export const apiKeysStore = storage.defineItem<Partial<Record<Provider, string>>>(
  'local:apiKeys',
  { fallback: {} },
);

/** 只支持 Anthropic 那个版本留下的单把 Key，只在迁移时读一次。 */
const legacyKeyStore = storage.defineItem<string>('local:apiKey', { fallback: '' });

/** 老版本升上来的一次性搬运：单把 Key → Anthropic 那一格。background 启动时调。 */
export async function migrateLegacyKey() {
  const legacy = await legacyKeyStore.getValue();
  if (!legacy) return;
  const keys = await apiKeysStore.getValue();
  if (!keys.anthropic) await apiKeysStore.setValue({ ...keys, anthropic: legacy });
  await legacyKeyStore.removeValue();
}

/**
 * 仅判定某个服务商是否配置过 Key，不把明文字符串返回给调用方。
 * 用于 popup 状态展示等无需持有真密钥的轻量场景。
 */
export async function hasApiKey(provider: Provider): Promise<boolean> {
  const keys = await apiKeysStore.getValue();
  return Boolean(keys[provider]);
}

