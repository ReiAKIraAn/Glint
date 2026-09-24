/**
 * Node 里跑测试时的 `#imports` 替身。
 *
 * `#imports` 是 WXT 注入的，只有装进扩展（或跑 demo 沙盒）才存在。测试要碰
 * settings.ts 就绕不开它，所以在 package.json 的 `imports` 里把它指到这里。
 *
 * 只影响 Node 的解析：wxt build 和 vite demo 都在各自的 resolve.alias 里
 * 先把 `#imports` 拦掉了，根本走不到 package.json 这一层。
 *
 * 存储用普通对象，不碰文件也不碰 localStorage——测试要的是纯逻辑，
 * 不是真去验证 WXT 的存储实现。
 */
type Listener<T> = (next: T, prev: T) => void;

export const storage = {
  defineItem<T>(_key: string, options: { fallback: T }) {
    let value = options.fallback;
    const listeners = new Set<Listener<T>>();
    return {
      getValue: async () => value,
      setValue: async (next: T) => {
        const prev = value;
        value = next;
        for (const fn of listeners) fn(next, prev);
      },
      removeValue: async () => {
        value = options.fallback;
      },
      watch: (fn: Listener<T>) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    };
  },
};

export const browser = {
  runtime: { sendMessage: async () => undefined, getURL: (p: string) => p },
  permissions: {
    contains: async () => true,
    request: async () => true,
    remove: async () => true,
    getAll: async () => ({ origins: [], permissions: [] }),
  },
};
export const defineBackground = (fn: unknown) => fn;
export const defineContentScript = (options: unknown) => options;
