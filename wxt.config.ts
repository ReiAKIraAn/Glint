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
  manifest: {
    name: 'Glint',
    description: '阅读英文网页时，按你的水平把难词标出来。',
    /**
     * 图标源文件是 public/icon/glint.svg，四档 PNG 由 `pnpm icons` 从它渲染出来。
     * Chrome 的 manifest 不认 SVG，所以必须落成位图；改了 svg 记得重跑一次。
     */
    icons: {
      16: '/icon/16.png',
      32: '/icon/32.png',
      48: '/icon/48.png',
      128: '/icon/128.png',
    },
    /**
     * 工具栏那颗按钮。不写的话 Chrome 会回退到上面的 icons，但回退挑哪一档由它决定；
     * 写清楚才能保证 1x 用 16、2x 用 32，缩放出来的图标不会糊。
     */
    action: {
      default_icon: { 16: '/icon/16.png', 32: '/icon/32.png' },
    },
    // activeTab：popup 需要问当前页「标了多少词」。这个权限只在用户点击
    // 扩展图标后才生效，比申请 tabs 或全站 host 权限克制得多。
    permissions: ['storage', 'activeTab'],
    /**
     * 键盘唯一能唤出卡片的路。
     *
     * 标注是画上去的，页面上没有可聚焦的节点，Tab 走不到。不给快捷键的话，
     * 键盘用户和读屏用户完全看不到释义——这不是「少个便利」，是整个功能对他们不存在。
     * 不自己在页面上监听按键：那会和网站自己的快捷键打架，而且用户改不了。
     */
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
    /**
     * BYOK：请求只从 background service worker 发出，key 不进入页面上下文。
     *
     * 预置服务商的域全部写在这里，装上就有——曾经把它们放在可选权限里按需申请，
     * 结果是选了 DeepSeek、存好 Key，请求却被浏览器直接拦掉，而报错只说「连不上」。
     * 省那一次授权弹窗，换来的是一个没人查得出原因的故障，不值。
     */
    host_permissions: [...providerOrigins, ...LOCAL_ORIGINS],
    /**
     * 只有「自定义」那一路的地址事先不可能知道，所以留在可选权限里，
     * 在用户点「授权访问」的那一刻按域名现要一次。
     *
     * 这里**只有 https**。两个理由：
     *   - 本机地址（localhost / 127.0.0.1）已经在上面的必需权限里了，
     *     再列一遍 Chrome 会警告「与必需权限重复，此项将被忽略」。
     *   - 非本机的明文 http 不给：那条路上要带着 API Key 出门。
     *     设置页在申请权限之前就会拦下来并说明白（见 grantHost）。
     */
    optional_host_permissions: ['https://*/*'],
    // 标注靠 CSS Custom Highlight API（Chrome 105+），
    // hover 命中靠 caretPositionFromPoint（Chrome 128+）。
    minimum_chrome_version: '128',
  },
});
