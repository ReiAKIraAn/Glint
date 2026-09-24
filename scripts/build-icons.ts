/**
 * 从 brand/glint-logo.svg 渲染出 manifest 要的四档 PNG。
 *
 *   pnpm icons
 *
 * 用本机的 Chrome 无头渲染，不引第三方栅格化库：图标最终就是由 Chrome 显示的，
 * 让它自己画一遍，所见即所得，也省掉一个只在发版前用一次的依赖。
 *
 * 注意那个 <img> 必须写死像素宽高，不能用 100vw/100vh——无头模式下布局视口并不
 * 等于 --window-size，用视口单位会渲染成放大好几倍的左上角一块。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SIZES = [16, 32, 48, 128];
const CHROME =
  process.env.CHROME_PATH ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** 矢量源放在 brand/：public/ 会被原样打进扩展包，源文件没必要跟着发出去。 */
const source = resolve(import.meta.dirname, '../brand/glint-logo.svg');
const iconDir = resolve(import.meta.dirname, '../public/icon');
const work = mkdtempSync(join(tmpdir(), 'glint-icons-'));

try {
  copyFileSync(source, join(work, 'glint.svg'));

  for (const size of SIZES) {
    const page = join(work, `${size}.html`);
    writeFileSync(
      page,
      `<!doctype html><meta charset=utf-8>
<style>html,body{margin:0;padding:0;background:transparent}
img{display:block;width:${size}px;height:${size}px}</style>
<img src="glint.svg">`,
    );
    execFileSync(
      CHROME,
      [
        '--headless=new',
        '--hide-scrollbars',
        '--disable-gpu',
        '--default-background-color=00000000',
        '--force-device-scale-factor=1',
        '--virtual-time-budget=3000',
        `--window-size=${size},${size}`,
        `--screenshot=${join(iconDir, `${size}.png`)}`,
        `file://${page}`,
      ],
      { stdio: 'ignore' },
    );
    console.log(`icon/${size}.png`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
