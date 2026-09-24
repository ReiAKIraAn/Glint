import { browser } from '#imports';
import { paintRange } from '@/lib/controls';
import { apiKeysStore } from '@/lib/keys';
import { mountContactLinks } from '@/lib/links';
import { knownWordsStore, readSettings, settingsStore } from '@/lib/settings';
import { isConfigured, normalizeHost, siteDisabled } from '@/lib/types';
import type { Level, PageStats, PassedExam, Settings, TargetExam } from '@/lib/types';

const LEVEL_NAMES = ['', 'A1', 'A2', 'B1', 'B2', 'C1'];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const enabled = $<HTMLInputElement>('enabled');
const level = $<HTMLInputElement>('level');
const levelLabel = $<HTMLOutputElement>('levelLabel');
const passedExam = $<HTMLSelectElement>('passedExam');
const targetExam = $<HTMLSelectElement>('targetExam');
const stats = $('stats');
const siteEnabled = $<HTMLInputElement>('siteEnabled');

/** 当前标签页的主机名。拿不到（chrome:// 之类）就把这一行整个藏起来。 */
let host = '';

let settings: Settings;

async function patch(change: Partial<Settings>) {
  settings = { ...settings, ...change };
  await settingsStore.setValue(settings);
}

function paintLevel() {
  levelLabel.textContent = LEVEL_NAMES[Number(level.value)] ?? '';
  paintRange(level);
}

/**
 * 问当前标签页标了多少词。走 activeTab 权限，只在用户点了扩展图标之后才可达。
 *
 * 三种情况必须分开说，否则用户没法判断该做什么：
 *
 *   1. 这个页面本来就没有内容脚本 —— chrome:// 、扩展商店、PDF 阅读器。无解，如实说。
 *   2. **刚重新加载过扩展。** 已经打开的标签页里，旧版本的内容脚本已经失联，
 *      新版本要等页面刷新才会注入。这时候提示「刷新一下页面」才是有用的信息，
 *      而不是「这个页面不适用」——后者会让人以为是网站的问题。
 *   3. 浏览器画不了标注（没有 CSS Custom Highlight API）。内容脚本在的、也应答了，
 *      只是干不了活，所以走的是正常返回而不是 catch，看 supported 字段。
 */
async function loadPageStats() {
  if (!settings.enabled) {
    stats.textContent = '已关闭';
    return;
  }
  if (host && siteDisabled(host, settings.disabledSites)) {
    stats.textContent = '在这个网站上已关闭';
    return;
  }
  let tabId: number | undefined;
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id;
    if (tabId === undefined) throw new Error('no tab');
    const result = (await browser.tabs.sendMessage(tabId, { kind: 'page:stats' })) as PageStats;
    // 这条不可能靠刷新解决，得说清是浏览器的事，别让人以为是网站有问题
    if (!result.supported) return void (stats.textContent = '浏览器版本太旧，标注用不了');
    stats.textContent = result.marked > 0 ? `本页标出 ${result.marked} 个词` : '本页没有可标的词';
  } catch (error) {
    stats.textContent = unreachable(error) ? '刷新一下页面就能用了' : '这个页面不适用';
  }
}

/** 「接收端不存在」＝ 内容脚本没注入或已失联，刷新页面即可恢复。 */
function unreachable(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /Receiving end does not exist|Could not establish connection|message port closed/i.test(
    text,
  );
}

/**
 * 当前标签页是哪个站。
 *
 * URL 靠 activeTab 拿——它在用户点了扩展图标之后才生效，所以不用额外权限。
 * 非 http(s) 的页面（chrome://、扩展页、本地文件）压根没有「网站」这个概念，
 * 那一行直接不显示，免得给一个按了没用的开关。
 */
async function loadSite() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab?.url ?? '');
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    host = normalizeHost(url.hostname);
  } catch {
    return;
  }
  if (!host) return;
  $('siteRow').hidden = false;
  $('siteHost').textContent = host;
  siteEnabled.checked = !siteDisabled(host, settings.disabledSites);
}

async function init() {
  mountContactLinks($('links'));
  settings = await readSettings();
  await loadSite();

  enabled.checked = settings.enabled;
  level.value = String(settings.level);
  passedExam.value = String(settings.passedExam);
  targetExam.value = settings.targetExam;
  paintLevel();

  const [known, keys] = await Promise.all([knownWordsStore.getValue(), apiKeysStore.getValue()]);
  $('knownCount').textContent = String(known.length);
  // 和后台、设置页共用同一个判定——只看 Key 存没存过的话，会把「配了 Key 但没填
  // 模型名」显示成已启用，而真去点释义时后台会拒
  const configured = isConfigured(settings, !!keys[settings.provider]);

  const ai = $('aiState');
  const on = settings.aiEnabled && configured;
  ai.textContent = on ? '已启用' : configured ? '已关闭' : '未配置';
  ai.className = on ? 'on' : 'off';

  await loadPageStats();
}

enabled.addEventListener('change', async () => {
  await patch({ enabled: enabled.checked });
  await loadPageStats();
});

/**
 * 关掉写的是当前这个主机名；打开则要把所有能命中它的条目都删掉——
 * 只删掉同名那条的话，在 wikipedia.org 上关过、又在 en.wikipedia.org 上打开，
 * 开关会弹回「关」，而用户完全不知道为什么。
 */
siteEnabled.addEventListener('change', async () => {
  const rest = settings.disabledSites.filter((entry) => !siteDisabled(host, [entry]));
  await patch({ disabledSites: siteEnabled.checked ? rest : [...rest, host] });
  await loadPageStats();
});

level.addEventListener('input', paintLevel);
level.addEventListener('change', () => patch({ level: Number(level.value) as Level }));

passedExam.addEventListener('change', () =>
  patch({ passedExam: Number(passedExam.value) as PassedExam }),
);
targetExam.addEventListener('change', () =>
  patch({ targetExam: targetExam.value as TargetExam }),
);

$('options').addEventListener('click', () => {
  browser.runtime.openOptionsPage();
  window.close();
});

init();
