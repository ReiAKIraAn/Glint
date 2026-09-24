import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * 开发用的预览沙盒。跑的是 src/ 下的真模块，只把扩展专有的 `#imports` 换成替身。
 *   pnpm demo
 *
 *   /demo/index.html                        标注效果 + 词形还原自检
 *   /src/entrypoints/options/index.html     设置页
 *   /src/entrypoints/popup/index.html       工具栏弹窗
 *
 * root 设在项目根目录，这样三个页面都能直接打开，不用把 HTML 复制一份到 demo/。
 */
export default defineConfig({
  root: __dirname,
  publicDir: resolve(__dirname, 'public'),
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '#imports': resolve(__dirname, 'demo/mock-imports.ts'),
    },
  },
  server: { port: 5178, open: '/demo/index.html' },
});
