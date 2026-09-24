import { defineConfig } from 'wxt';
import { PROVIDERS } from './src/lib/types';

/** 预置服务商的接口域名。表在 types.ts，这里只是把它摊平进 manifest。 */
const providerOrigins = [
  ...new Set(Object.values(PROVIDERS).map((spec) => spec.origin).filter(Boolean)),
];

/**
 * 127.0.0.1 和 localhost 是同一台机器的两种写法，用户两种都会填。
 * PROVIDERS 里 Ollama 只写了 localhost，另一种在这里补上——
 * 少了它，把地址填成 http://127.0.0.1:11434 的人会拿到一个「申请权限失败」，
 * 而那看起来像扩展坏了，不像是自己写法的问题。
 */
const LOCAL_ORIGINS = ['http://127.0.0.1/*'];

export default defineConfig({
  srcDir: 'src',
  /**
   * 关掉 modulepreload。
   *
   * Vite 会给共用 chunk 插一行 `<link rel="modulepreload" crossorigin>`，
   * 而 chrome-extension:// 上带 crossorigin 的预载和真正的模块导入落在不同的
   * 请求上下文里，Chrome 匹配不上会丢弃，然后在控制台报
   * 「cross-world extension resource mismatch」——白下载一次，还留一条噪音。
   *
   * 预载在这里本来也没有意义：文件就在本地磁盘上，没有网络延迟可以隐藏。
   */
  vite: () => ({
    build: { modulePreload: false },
  }),
  /**
   * 让 `pnpm dev` 真的把浏览器拉起来并装好扩展。
   * 不显式写这段的话，这个版本的 WXT 只会构建 + 起热更新服务，不开浏览器——
   * 看起来像「跑起来了但浏览器里什么都没有」。
   */
  webExt: {
    disabled: false,
    // 开一个真有英文正文的页面，一打开就能看到标注效果
    startUrls: ['https://en.wikipedia.org/wiki/Sediment'],
  },
  manifest: ({ browser }) => {
    const isSafari = browser === 'safari';
    return {
      name: isSafari ? 'Glint (Safari Personal Edition)' : 'Glint',
      description: '阅读英文网页时，按你的水平把难词标出来。',
      /**
       * 图标源文件是 public/icon/glint.svg，四档 PNG 由 `pnpm icons` 从它渲染出来。
       */
      icons: {
        16: '/icon/16.png',
        32: '/icon/32.png',
        48: '/icon/48.png',
        128: '/icon/128.png',
      },
      action: {
        default_icon: { 16: '/icon/16.png', 32: '/icon/32.png' },
      },
      permissions: ['storage', 'activeTab'],
      commands: {
        'next-word': {
          suggested_key: { default: 'Alt+G' },
          description: '跳到下一个标注的词',
        },
        'prev-word': {
          suggested_key: { default: 'Alt+Shift+G' },
          description: '跳到上一个标注的词',
        },
      },
      host_permissions: [...providerOrigins, ...LOCAL_ORIGINS],
      optional_host_permissions: ['https://*/*'],
      ...(isSafari ? {} : { minimum_chrome_version: '128' }),
    };
  },
});
