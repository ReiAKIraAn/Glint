/**
 * 预览沙盒里的 `#imports` 替身。
 *
 * 设置页和 popup 依赖 WXT 的 storage 和 browser，只有装进扩展才有。
 * 这一层把它们换成 localStorage 支撑的等价实现，于是这两个页面能在普通
 * vite dev server 里直接打开、热更新——不用每改一行就去 reload 扩展。
 *
 * 只在 vite.demo.config.ts 里生效，不进任何构建产物。
 */
type Listener<T> = (next: T, prev: T) => void;

function makeItem<T>(key: string, fallback: T) {
  const listeners = new Set<Listener<T>>();
  const read = (): T => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  };
  return {
    getValue: async () => read(),
    setValue: async (value: T) => {
      const prev = read();
      localStorage.setItem(key, JSON.stringify(value));
      for (const fn of listeners) fn(value, prev);
    },
    watch: (fn: Listener<T>) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/**
 * 同一个 key 只造一个 item。
 *
 * 真的 WXT storage 背后是一份全局存储，谁写都会通知到所有 watch 的人。
 * 替身要是每次 defineItem 都新造一个闭包，下面那个「替身 background」写进去的东西
 * 就通知不到 settings.ts 里那个实例——沙盒里会看到写成功了但界面不动，
 * 而那是替身自己的毛病，不是被测代码的。
 */
const items = new Map<string, unknown>();

export const storage = {
  defineItem<T>(key: string, options: { fallback: T }) {
    const existing = items.get(key) as ReturnType<typeof makeItem<T>> | undefined;
    if (existing) return existing;
    const item = makeItem<T>(key, options.fallback);
    items.set(key, item);
    return item;
  },
};

/** 替身 background 也往这里写，键和真扩展一致。 */
const explanations = () =>
  storage.defineItem<Record<string, unknown>>('local:explanations', { fallback: {} });

/** 替身版的 background：词典直接 fetch，AI 释义返回固定文本。 */
let dictPromise: Promise<Record<string, [string, string, string, number]>> | undefined;

async function handle(message: { kind: string; [k: string]: unknown }) {
  if (message.kind === 'dict:lookup') {
    dictPromise ??= fetch('/data/dict.json').then((r) => r.json());
    const row = (await dictPromise)[String(message.word).toLowerCase()];
    if (!row) return null;
    return { phonetic: row[0], translation: row[1], tags: row[2].split(' ').filter(Boolean), rank: row[3] };
  }
  if (message.kind === 'ai:analyze') {
    await new Promise((r) => setTimeout(r, 600));
    const analysis = {
      sense: `（沙盒占位）"${message.word}" 在这句里的意思`,
      en: 'placeholder definition for the sandbox',
      note: '',
      sentenceZh: '（沙盒占位）这里是原句的中文翻译。',
      example: 'This sentence is generated locally, no API call was made.',
      exampleZh: '这句是本地生成的，没有真的调接口。',
    };
    /**
     * 真扩展里存盘在 background 做——钱是在那儿花的，内容脚本随时可能连人带上下文
     * 一起消失。替身也照做，否则沙盒里「存货优先」和 stale 那两条路根本试不出来。
     */
    const store = explanations();
    const stored = await store.getValue();
    await store.setValue({
      ...stored,
      [String(message.lemma)]: {
        sentence: String(message.sentence),
        surface: String(message.word),
        analysis,
        time: Date.now(),
      },
    });
    return { ok: true, analysis };
  }
  if (message.kind === 'ai:status') return { configured: false };
  if (message.kind === 'ai:models') {
    await new Promise((r) => setTimeout(r, 400));
    return {
      ok: true,
      // 前两个同前缀、第三个不同：正好演示 datalist 会按输入框里的文字过滤
      models: ['sandbox-flash', 'sandbox-flash-vision', 'sandbox-pro'],
    };
  }
  return undefined;
}

export const browser = {
  runtime: {
    openOptionsPage: () => window.open('/src/entrypoints/options/index.html', '_blank'),
    getURL: (path: string) => path,
    sendMessage: (message: { kind: string; [k: string]: unknown }) => handle(message),
    onMessage: { addListener: () => {} },
  },
  /** 沙盒里没有真的权限系统，一律放行。 */
  permissions: {
    request: async () => true,
    contains: async () => true,
  },
  tabs: {
    /**
     * 假装停在一个真的英文网页上。用 location.href 的话主机名是 localhost——
     * 那既不是个「网站」，也试不出站点开关该有的样子。这个地址和 wxt.config.ts
     * 里 `pnpm dev` 打开的那一页一致。
     */
    query: async () => [
      { id: 1 as number | undefined, url: 'https://en.wikipedia.org/wiki/Sediment' },
    ],
    // 字段要和真的 PageStats 对齐，少一个 supported 弹窗就会显示「浏览器太旧」
    sendMessage: async () => ({ marked: 23, active: true, supported: true }),
  },
};

export const defineBackground = (fn: unknown) => fn;
export const defineContentScript = (options: unknown) => options;
