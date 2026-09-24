import { browser } from '#imports';
import { paintRange } from '@/lib/controls';
/**
 * 图标用 @lobehub/icons 的静态 SVG，构建时内联进来。
 *
 * 不走它的 CDN：那是运行时去 GitHub 取图，一个「全程本地、只连你自己配的那家接口」的
 * 扩展不该为了几个 logo 破例，扩展的 CSP 也不会放行。单色那几个是 fill=currentColor，
 * 跟着明暗主题走；官方标识本来就是彩色的（Gemini、DeepSeek 这些）才用 -color。
 */
import anthropicIcon from '@lobehub/icons-static-svg/icons/anthropic.svg?raw';
import openaiIcon from '@lobehub/icons-static-svg/icons/openai.svg?raw';
import geminiIcon from '@lobehub/icons-static-svg/icons/gemini-color.svg?raw';
import openrouterIcon from '@lobehub/icons-static-svg/icons/openrouter-color.svg?raw';
import opencodeIcon from '@lobehub/icons-static-svg/icons/opencode.svg?raw';
import siliconcloudIcon from '@lobehub/icons-static-svg/icons/siliconcloud-color.svg?raw';
import deepseekIcon from '@lobehub/icons-static-svg/icons/deepseek-color.svg?raw';
import moonshotIcon from '@lobehub/icons-static-svg/icons/moonshot.svg?raw';
import zhipuIcon from '@lobehub/icons-static-svg/icons/zhipu-color.svg?raw';
import groqIcon from '@lobehub/icons-static-svg/icons/groq.svg?raw';
import ollamaIcon from '@lobehub/icons-static-svg/icons/ollama.svg?raw';
import {
  BACKUP_VERSION,
  explanationsStore,
  knownWordsStore,
  mergeBackup,
  parseBackup,
  readSettings,
  settingsStore,
  type Backup,
} from '@/lib/settings';
import { apiKeysStore } from '@/lib/keys';
import { mountContactLinks } from '@/lib/links';
import { escapeHtml as escape, boldWord } from '@/lib/text';
import { toAnkiTSV, type AnkiRow } from '@/lib/anki';
import { scan, sentenceAround, type Token } from '@/lib/scan';
import { resolve } from '@/lib/lexicon';
import { applyStyle, paint, clear } from '@/lib/highlight';
import { HoverTracker } from '@/lib/hover';
import { Card } from '@/lib/card';
import {
  DEFAULT_MODELS,
  EXAM_NAMES,
  PROVIDERS,
  PROVIDER_IDS,
  TARGET_NAMES,
  baseURLOf,
  isConfigured,
  type Analysis,
  type DictEntry,
  type Level,
  type Effort,
  type Explained,
  type ModelList,
  type PassedExam,
  type Provider,
  type Settings,
  type TargetExam,
} from '@/lib/types';

const ICONS: Record<string, string> = {
  anthropic: anthropicIcon,
  openai: openaiIcon,
  'gemini-color': geminiIcon,
  'openrouter-color': openrouterIcon,
  opencode: opencodeIcon,
  'siliconcloud-color': siliconcloudIcon,
  'deepseek-color': deepseekIcon,
  moonshot: moonshotIcon,
  'zhipu-color': zhipuIcon,
  groq: groqIcon,
  ollama: ollamaIcon,
};

/** 「自定义接口」没有品牌图标，自己画一个插头。 */
const PLUG_ICON = `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none"
  stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
  <path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-6 6 6 6 0 0 1-6-6V8ZM12 17v4"/>
</svg>`;

/** 滑块每一档的意思：「我到这个水平了，再难的给我标出来」。 */
const LEVEL_COPY: Record<Level, string> = {
  1: 'A1 · 标 A2 以上',
  2: 'A2 · 标 B1 以上',
  3: 'B1 · 标 B2 以上',
  4: 'B2 · 标 C1 以上',
  5: 'C1 · 只标 C2 和生僻词',
  6: '',
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const fields = {
  level: $<HTMLInputElement>('level'),
  levelLabel: $<HTMLOutputElement>('levelLabel'),
  passedExam: $<HTMLSelectElement>('passedExam'),
  targetExam: $<HTMLSelectElement>('targetExam'),
  enabled: $<HTMLInputElement>('enabled'),
  oncePerPage: $<HTMLInputElement>('oncePerPage'),
  markUnknown: $<HTMLInputElement>('markUnknown'),
  aiEnabled: $<HTMLInputElement>('aiEnabled'),
  model: $<HTMLInputElement>('model'),
  modelList: $<HTMLDataListElement>('modelList'),
  modelPick: $<HTMLSelectElement>('modelPick'),
  effort: $<HTMLSelectElement>('effort'),
  baseURL: $<HTMLInputElement>('baseURL'),
  apiKey: $<HTMLInputElement>('apiKey'),
  keyStatus: $<HTMLSpanElement>('keyStatus'),
};

/** 页面里的一份当前设置。改动即时落盘，同时驱动右侧预览。 */
let settings: Settings;
/** 备考词表按需取，切换目标时才拉。 */
let examWords: Set<string> | undefined;
let hasKey = false;
/** 这家配齐了没有。和后台、弹窗共用 isConfigured，三处不能各说各的。 */
let aiOk = false;

/** 每家的 Key 存不存在，只存布尔——Key 本身存进去就没有再读出来的必要。 */
let savedKeys: Partial<Record<Provider, boolean>> = {};

/**
 * 已存过 Key 的时候往输入框里放的占位符。
 *
 * 空输入框加一句「已保存 Key」，多数人第一眼读成「没填」——密码框里有东西才是「填过了」
 * 的通用信号。放的不是真 Key：真 Key 存进去就没有再读回页面的必要，
 * 这里只是一个和它等长无关的记号，聚焦就清空，让你直接打新的。
 */
const KEY_MASK = '••••••••••••••••';

/**
 * 把 settings 回填进各个控件。
 *
 * 单独抽出来是因为导入备份之后也要走一遍——只写存储不回填的话，滑块和下拉还停在
 * 旧值上，而 redraw() 里有几处读的是控件的当前值，于是界面和实际设置各说各的；
 * 更糟的是用户随后动任何一个控件，都会把那个过期的值原样写回存储。
 */
function paintForm() {
  fields.level.value = String(settings.level);
  fields.passedExam.value = String(settings.passedExam);
  fields.targetExam.value = settings.targetExam;
  fields.enabled.checked = settings.enabled;
  fields.oncePerPage.checked = settings.oncePerPage;
  fields.markUnknown.checked = settings.markUnknown;
  fields.aiEnabled.checked = settings.aiEnabled;
  fields.effort.value = settings.effort;

  const styleInput = document.querySelector<HTMLInputElement>(
    `input[name="style"][value="${settings.style}"]`,
  );
  if (styleInput) styleInput.checked = true;
}

async function init() {
  /**
   * 支持 ?tab=ai 直接开在某一页。
   *
   * 不是为了截图才加的：AI 没配好的时候，从别处一步跳到该配的那一页，
   * 比让人自己找过去顺手。取值先过一遍白名单——URL 是外部输入。
   */
  const wanted = new URLSearchParams(location.search).get('tab');
  if (wanted && (TABS as readonly string[]).includes(wanted)) showTab(wanted);

  mountContactLinks($('links'));

  settings = await readSettings();
  paintForm();
  renderProviderCards();

  const keys = await apiKeysStore.getValue();
  savedKeys = Object.fromEntries(Object.entries(keys).map(([name, key]) => [name, !!key]));
  paintProvider();

  await loadExamWords();
  await refreshCounts();
  renderSites();
  redraw();

  /**
   * 设置页和网页是两个同时开着的标签页，而「已认识」「已生成的释义」两个数字
   * 是在**网页那边**被改的——你在文章里点一次「认识」、点一次「AI 释义」，
   * 这边不重新读就永远停在打开时的那个数。
   *
   * 内容脚本一直是监听的（content.ts 里那两处 watch），设置页漏了，于是症状是
   * 「我明明刚生成过，这里还是 0」——看起来像功能坏了，其实只差一次刷新。
   *
   * 自己写完也会收到一次（storage 的变更通知不区分是谁写的），多渲染一遍而已，
   * 换来的是不用在每个写入点后面都记得补一句 refreshCounts。
   */
  explanationsStore.watch(() => void refreshCounts());
  knownWordsStore.watch(() => void refreshCounts());
}

/**
 * 服务商做成一格一格的卡片，从那张表长出来，加一家不用改这里。
 *
 * 十一家塞进一个下拉里，你得先展开、再逐行读文字才能换一家；摊成带 logo 的卡片，
 * 一眼扫过去就知道有哪些、现在用的是哪个、哪几家已经配过 Key（右上角那个小点）。
 */
function renderProviderCards() {
  $('providerCards').innerHTML = PROVIDER_IDS.map((id) => {
    const spec = PROVIDERS[id];
    return `<button type="button" class="pcard" data-provider="${id}" aria-pressed="false">
      <span class="picon">${ICONS[spec.icon] ?? PLUG_ICON}</span>
      <span class="pname">${escape(spec.name)}</span>
      <span class="pdot" hidden title="已保存 Key"></span>
    </button>`;
  }).join('');
}

$('providerCards').addEventListener('click', async (event) => {
  const picked = (event.target as HTMLElement).closest<HTMLElement>('[data-provider]')?.dataset
    .provider as Provider | undefined;
  if (!picked || picked === settings.provider) return;
  await patch({ provider: picked });
  paintProvider();
  redraw();
});

/**
 * 服务商相关的那几格跟着当前选择走：模型名、Key 状态、接口地址、去哪拿 Key。
 * 每家的模型名和地址各记一份，来回切不用重填。
 */
function paintProvider() {
  const provider = settings.provider;
  const spec = PROVIDERS[provider];
  hasKey = !!savedKeys[provider] || !!spec.keyless;
  aiOk = isConfigured(settings, !!savedKeys[provider]);

  for (const card of document.querySelectorAll<HTMLElement>('[data-provider]')) {
    const id = card.dataset.provider as Provider;
    card.setAttribute('aria-pressed', String(id === provider));
    card.querySelector<HTMLElement>('.pdot')!.hidden = !savedKeys[id];
  }

  fields.model.value = settings.models[provider] || DEFAULT_MODELS[provider];
  fields.model.placeholder = DEFAULT_MODELS[provider] || '填模型名';
  fields.apiKey.value = savedKeys[provider] ? KEY_MASK : '';
  fields.apiKey.placeholder = provider === 'anthropic' ? 'sk-ant-...' : `${spec.name} 的 API Key`;
  fields.apiKey.disabled = !!spec.keyless;

  // 兼容协议的都能改地址：预置的填错了或哪天变了，用户自己改一行就能救
  $('baseURLRow').hidden = spec.kind !== 'compatible';
  fields.baseURL.value = baseURLOf(settings);
  fields.baseURL.placeholder = spec.baseURL ?? 'https://…/v1';

  const link = $<HTMLAnchorElement>('keyLink');
  link.hidden = !spec.keyURL;
  if (spec.keyURL) link.href = spec.keyURL;

  setKeyStatus(
    spec.keyless
      ? `${spec.name} · 本机服务，不用 Key`
      : savedKeys[provider]
        ? `${spec.name} · 已保存 Key`
        : `${spec.name} · 还没配置 Key`,
  );

  // 换了服务商，上一家的模型列表就不作数了
  fields.modelList.innerHTML = '';
  fields.modelPick.innerHTML = '';
  fields.modelPick.hidden = true;
  $('modelNote').textContent = spec.keyless
    ? '本机服务，直接点「拉取列表」看装了哪些'
    : '配好 Key 后点「拉取列表」，直接从这家的接口里选';
  $('aiSummary').innerHTML = aiOk
    ? `<b>${escape(spec.name)}</b> · ${escape(fields.model.value.trim())} · <span data-tone="ok">已就绪</span>`
    : `<b>${escape(spec.name)}</b> · <span>还没配置好</span>`;

  $('effortNote').textContent =
    spec.kind === 'compatible'
      ? '以 reasoning_effort 透传；接口不认这个字段就选「不思考」'
      : settings.effort === 'off'
        ? '直接作答，延迟最低'
        : '句子有歧义时更准，但卡片要多等几秒';
}

// ---------------------------------------------------------------- 标签页

/**
 * 三页：标注 / AI 服务商 / 我的词。
 *
 * 右边那个实时预览只跟「标注」有关，所以切走的时候连同它一起收起来，
 * 剩下两页就能占满整行——服务商那一页字段最多，挤在 60% 宽度里最难看。
 */
$('tabs').addEventListener('click', (event) => {
  const tab = (event.target as HTMLElement).closest<HTMLElement>('[data-tab]')?.dataset.tab;
  if (tab) showTab(tab);
});

/** 合法的页签名。URL 是外部输入，别拿它去乱设 dataset。 */
const TABS = ['mark', 'ai', 'data'] as const;

function showTab(tab: string) {
  for (const button of $('tabs').querySelectorAll<HTMLElement>('[data-tab]')) {
    button.setAttribute('aria-selected', String(button.dataset.tab === tab));
  }
  for (const panel of document.querySelectorAll<HTMLElement>('[data-panel]')) {
    panel.hidden = panel.dataset.panel !== tab;
  }
  document.querySelector<HTMLElement>('.layout')!.dataset.tab = tab;
}

/** 每次改动直接落盘，没有「保存」按钮——设置项少，即时生效更顺手。 */
async function patch(change: Partial<Settings>) {
  settings = { ...settings, ...change };
  await settingsStore.setValue(settings);
}

async function loadExamWords() {
  if (!settings.targetExam) {
    examWords = undefined;
    return;
  }
  try {
    const lists = (await fetch('/data/exams.json').then((r) => r.json())) as Record<string, string>;
    const list = lists[settings.targetExam];
    examWords = new Set(list ? list.split(' ') : []);
  } catch {
    examWords = undefined;
  }
}

// ---------------------------------------------------------------- 悬浮卡片

/**
 * 预览里也能 hover。用的是内容脚本那套 HoverTracker + Card，
 * 词典和 AI 释义都走真实的 background——所以这里看到的卡片跟网页上一模一样，
 * 包括音标、考试标签和语境释义。
 */
const card = new Card({
  lookup: (word) => browser.runtime.sendMessage({ kind: 'dict:lookup', word }) as Promise<DictEntry | null>,
  analyze: (token) =>
    browser.runtime.sendMessage({
      kind: 'ai:analyze',
      word: token.surface,
      lemma: token.lemma,
      sentence: sentenceAround(token),
    }) as Promise<{ ok: true; analysis: Analysis } | { ok: false; error: string }>,
  aiReady: async () => settings.aiEnabled && aiOk,
  // 预览里不认存货，每次都从「点一下才解释」开始，方便看那个按钮长什么样
  cached: () => null,
  /**
   * 「认识」在预览里是空操作：那是给你看按钮长什么样的，不该往「已认识」里塞词。
   *
   * 「AI 释义」不一样，它会真的存下来——因为它真的花了钱。存盘在 background 做
   * （见那边的 remember），所以这里想拦也拦不住，而且也不该拦：付过的东西
   * 就该留下。代价是上面那行 cached 让预览永远从零开始，在这儿连点两次会付两次；
   * 预览的职责是演示卡片，那一下认了。
   */
  onKnown: () => {},
  onPointerEnter: () => hover.hold(),
  onPointerLeave: () => hover.release(),
});

const hover = new HoverTracker({
  onEnter: (token: Token, rect: DOMRect) => void card.show(token, rect),
  onLeave: () => card.hide(),
});

card.mount();
hover.start();

// ---------------------------------------------------------------- 实时预览

/**
 * 预览调用的是内容脚本里那套真的 scan / paint，不是另写一份模拟。
 *
 * 这样「改了设置到底会变成什么样」不用装扩展、开网页去试；
 * 也保证了预览永远不会和实际行为漂移——两边是同一份代码。
 */
function redraw() {
  fields.levelLabel.textContent = LEVEL_COPY[Number(fields.level.value) as Level] ?? '';
  paintRange(fields.level);

  $('examNote').textContent = settings.passedExam
    ? `${EXAM_NAMES[settings.passedExam]}及以下考纲里的词不再标注`
    : '不按考纲静音';
  $('targetNote').textContent = settings.targetExam
    ? `只标${TARGET_NAMES[settings.targetExam]}词表里、且高于你水平的词`
    : '不限考纲，按难度标注全部';

  applyStyle(settings.style);
  clear();

  if (!settings.enabled) {
    hover.setTokens([]);
    card.hide();
    $('previewCount').textContent = '已关闭';
    $('previewFoot').textContent = '标注总开关是关的，任何页面都不会标。';
    return;
  }

  const canExplain = settings.aiEnabled && aiOk;
  const tokens = scan($('previewBody'), settings, new Set(), canExplain, examWords);
  paint(tokens);
  hover.setTokens(tokens);

  $('previewCount').textContent = `${tokens.length} 词`;
  $('previewFoot').textContent = describe(tokens.length, canExplain);
}

function describe(count: number, canExplain: boolean): string {
  const parts = [`这两段共 ${count} 个词会被标出来`];
  if (settings.passedExam) parts.push(`已减去${EXAM_NAMES[settings.passedExam]}及以下考纲`);
  if (settings.targetExam) parts.push(`已限定在${TARGET_NAMES[settings.targetExam]}词表内`);
  if (settings.markUnknown && !canExplain) parts.push('词库外的生僻词暂不标（没 Key 解释不了）');
  parts.push('把鼠标停在标注的词上试试');
  return parts.join('，') + '。';
}

// ---------------------------------------------------------------- 事件

fields.level.addEventListener('input', () => {
  // input 只更新界面，change 才落盘——拖动过程中没必要写几十次 storage
  settings = { ...settings, level: Number(fields.level.value) as Level };
  redraw();
});
fields.level.addEventListener('change', () => patch({ level: Number(fields.level.value) as Level }));

fields.passedExam.addEventListener('change', async () => {
  await patch({ passedExam: Number(fields.passedExam.value) as PassedExam });
  redraw();
});

fields.targetExam.addEventListener('change', async () => {
  await patch({ targetExam: fields.targetExam.value as TargetExam });
  await loadExamWords();
  redraw();
});

for (const [el, key] of [
  [fields.enabled, 'enabled'],
  [fields.oncePerPage, 'oncePerPage'],
  [fields.markUnknown, 'markUnknown'],
  [fields.aiEnabled, 'aiEnabled'],
] as const) {
  el.addEventListener('change', async () => {
    await patch({ [key]: el.checked } as Partial<Settings>);
    redraw();
  });
}

fields.effort.addEventListener('change', async () => {
  await patch({ effort: fields.effort.value as Effort });
  paintProvider();
});

fields.baseURL.addEventListener('change', () => {
  void patch({ baseURLs: overrideBaseURL(fields.baseURL.value.trim()) });
});

/**
 * 只有和预置值不一样才存。存成和预置一模一样的话，将来预置地址变了这个用户反而收不到——
 * 他手里那份「覆盖」会一直盖着。
 */
function overrideBaseURL(url: string): Settings['baseURLs'] {
  const next = { ...settings.baseURLs };
  if (url && url !== PROVIDERS[settings.provider].baseURL) next[settings.provider] = url;
  else delete next[settings.provider];
  return next;
}

// 模型名是随手改的输入框，失焦或回车再落盘；空着就退回这家的默认值
fields.model.addEventListener('change', () => {
  const model = fields.model.value.trim() || DEFAULT_MODELS[settings.provider];
  fields.model.value = model;
  // 手打的值如果正好在列表里，下拉也跟着指过去，两处别各说各的
  fields.modelPick.value = [...fields.modelPick.options].some((o) => o.value === model) ? model : '';
  void patch({ models: { ...settings.models, [settings.provider]: model } });
  paintProvider(); // 模型名是就绪判定的一部分，改了要重算
  redraw();
});

$('style').addEventListener('change', async (event) => {
  await patch({ style: (event.target as HTMLInputElement).value as Settings['style'] });
  redraw();
});

// ---------------------------------------------------------------- API Key

function setKeyStatus(text: string, tone?: 'ok' | 'bad') {
  fields.keyStatus.textContent = text;
  if (tone) fields.keyStatus.dataset.tone = tone;
  else delete fields.keyStatus.dataset.tone;
}

// 点进去就把那串圆点清掉，直接打新的；没改又移开的话再放回去，看着还是「已填」
fields.apiKey.addEventListener('focus', () => {
  if (fields.apiKey.value === KEY_MASK) fields.apiKey.value = '';
});
fields.apiKey.addEventListener('blur', () => {
  if (!fields.apiKey.value && savedKeys[settings.provider]) fields.apiKey.value = KEY_MASK;
});

$('saveKey').addEventListener('click', async () => {
  const provider = settings.provider;
  const spec = PROVIDERS[provider];
  // 原封不动的圆点 = 没打算换 Key，这次保存只落地址那些
  const typed = fields.apiKey.value.trim();
  const key = typed === KEY_MASK ? '' : typed;
  if (!key && !spec.keyless && !savedKeys[provider]) return setKeyStatus('先粘贴一个 Key', 'bad');
  // 只做形状检查。真正有没有效，第一次点「解释」的时候接口会告诉你。
  if (key && provider === 'anthropic' && !key.startsWith('sk-ant-')) {
    return setKeyStatus('这看起来不像 Anthropic 的 Key', 'bad');
  }

  /**
   * 权限要在任何 await 之前要。
   *
   * Chrome 只在用户手势里放行 permissions.request()，中间夹一次 await（哪怕只是写一次
   * 存储）手势就没了，调用直接抛异常。之前正是这个顺序错了——地址存下了、Key 也存下了，
   * 请求却被浏览器拦在门外，而卡片上只写「连不上」，谁也查不出为什么。
   */
  const baseURL = fields.baseURL.value.trim();
  if (spec.kind === 'compatible') {
    if (!baseURL) return setKeyStatus('先填接口地址', 'bad');
    const granted = await grantHost(baseURL);
    if (!granted.ok) return setKeyStatus(granted.error ?? '没拿到访问这个域的权限', 'bad');
    await patch({ baseURLs: overrideBaseURL(baseURL) });
  }

  if (key) {
    await apiKeysStore.setValue({ ...(await apiKeysStore.getValue()), [provider]: key });
    savedKeys = { ...savedKeys, [provider]: true };
  }
  fields.apiKey.value = savedKeys[provider] ? KEY_MASK : '';
  paintProvider();
  setKeyStatus('已保存', 'ok');
  redraw(); // 生僻词的标注策略跟着变
  void loadModels(true); // 刚配好，顺手把模型列表拉回来
});

$('clearKey').addEventListener('click', async () => {
  const keys = { ...(await apiKeysStore.getValue()) };
  delete keys[settings.provider];
  await apiKeysStore.setValue(keys);
  savedKeys = { ...savedKeys, [settings.provider]: false };
  fields.apiKey.value = '';
  hasKey = false;
  paintProvider();
  setKeyStatus('已清除');
  redraw();
});

/**
 * 模型名是整套配置里最容易过时的一格，所以配好之后直接问接口要一份。
 *
 * 拉回来只是塞进 datalist，输入框仍然可以自己打——接口没列全、或者你想用
 * 一个刚发布还没进列表的模型，都不该被这个下拉框挡住。
 */
async function loadModels(quiet = false) {
  const note = $('modelNote');
  note.textContent = '正在拉取…';
  delete note.dataset.tone;
  fields.modelPick.hidden = true;

  /**
   * sendMessage 是会 reject 的，而且不止一种理由：service worker 在等回复的中途
   * 被回收、消息通道断掉、或者这个 Chrome 版本不认「监听器返回 Promise」
   * （那样拿到的是 undefined，下一行读 .ok 就抛）。
   *
   * 漏过去的话这个函数就在 await 上死掉，note 永远停在「正在拉取…」——
   * 那正是一个「拉不出来又没有任何报错」的故障，谁也查不下去。
   */
  let result: ModelList;
  try {
    result = (await browser.runtime.sendMessage({ kind: 'ai:models' })) as ModelList;
    if (!result || typeof result.ok !== 'boolean') throw new Error('后台没有返回结果');
  } catch (error) {
    note.textContent = `拉取失败：${error instanceof Error ? error.message : String(error)}`;
    note.dataset.tone = 'bad';
    return;
  }

  if (!result.ok) {
    // 保存 Key 之后的自动拉取失败不该像个错误——用户没主动要，手打模型名也能用
    note.textContent = quiet ? `没拉到模型列表（${result.error}），手填也行` : result.error;
    if (!quiet) note.dataset.tone = 'bad';
    return;
  }

  /**
   * 两个入口，因为它们干的不是一件事。
   *
   * datalist 是打字时的补全，它会拿输入框里已有的文字过滤候选——所以拉到 12 个、
   * 下拉里只冒出 2 个是它的正常行为，不是丢了。但那副样子会让人以为没拉全，
   * 所以另给一个规规矩矩的 select，一个不少地列出来。
   */
  fields.modelList.innerHTML = result.models
    .map((model) => `<option value="${escape(model)}"></option>`)
    .join('');

  const current = fields.model.value.trim();
  fields.modelPick.innerHTML = [
    `<option value="">从拉到的 ${result.models.length} 个里选…</option>`,
    ...result.models.map(
      (model) =>
        `<option value="${escape(model)}"${model === current ? ' selected' : ''}>${escape(model)}</option>`,
    ),
  ].join('');
  fields.modelPick.hidden = false;

  note.textContent = `拉到 ${result.models.length} 个模型，下面挑一个，或者直接在上面打`;
  note.dataset.tone = 'ok';
}

fields.modelPick.addEventListener('change', () => {
  const model = fields.modelPick.value;
  if (!model) return;
  fields.model.value = model;
  void patch({ models: { ...settings.models, [settings.provider]: model } });
});

$('fetchModels').addEventListener('click', () => void loadModels());

/**
 * 自定义接口的域名事先不知道，所以只能作为可选权限在保存时现要。
 * 必须挂在点击里——浏览器只在用户手势里才弹这个授权框。
 */
/** 本机的几种写法。这些走 http 没问题——请求根本不出这台机器。 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

async function grantHost(baseURL: string): Promise<{ ok: boolean; error?: string }> {
  let url: URL;
  try {
    url = new URL(baseURL);
  } catch {
    return { ok: false, error: '接口地址不是合法 URL' };
  }

  /**
   * 非本机的明文 http 直接拒。
   *
   * 那条路上要带着 API Key 出门，同一个局域网里任何人都能读到。
   * 而且 manifest 的可选权限里只声明了 https，真去 request 也只会拿到一个
   * 「申请权限失败」——那看起来像扩展坏了。不如在这里说清楚是为什么。
   */
  if (url.protocol !== 'https:' && !LOCAL_HOSTS.has(url.hostname)) {
    return { ok: false, error: '非本机地址请用 https——http 会把 API Key 明文发出去' };
  }

  const origin = `${url.origin}/*`;
  try {
    /**
     * 不先 contains 再 request——那一次 await 就足以让 Chrome 不认这是用户手势。
     * 已经授过的域再 request 一次会直接返回 true，不会重复弹框，所以直接问就行。
     * manifest 里写死的那十个域同理，问了也是秒过。
     */
    const ok = await browser.permissions.request({ origins: [origin] });
    return ok ? { ok: true } : { ok: false, error: `浏览器没给 ${origin} 的访问权限` };
  } catch (error) {
    // 别再把原因吞掉了，出问题的时候这句话就是唯一的线索
    return { ok: false, error: error instanceof Error ? error.message : '申请权限失败' };
  }
}

// ---------------------------------------------------------------- 我的词

async function refreshCounts() {
  const known = await knownWordsStore.getValue();
  $('knownCount').textContent = String(known.length);
  // 后加的排前面：刚点错的那个最可能是你想撤销的
  $('knownList').innerHTML = known.length
    ? [...known]
        .reverse()
        .map(
          (word) =>
            `<button type="button" class="chip" data-known="${escape(word)}" title="不再当作已认识，以后重新标注">
              ${escape(word)}<span aria-hidden="true">×</span>
            </button>`,
        )
        .join('')
    : `<p class="empty">还没有标过「认识」的词。</p>`;

  // 新生成的排最前面——刚看过的词最可能是你想找的那条
  const saved = Object.entries(await explanationsStore.getValue()).sort((a, b) => b[1].time - a[1].time);
  $('explainedCount').textContent = String(saved.length);
  $('explainedList').innerHTML = saved.length
    ? saved.map(([word, item]) => entryRow(word, item)).join('')
    : `<li class="empty">还没有生成过释义。在网页上把鼠标停到标注的词上，点那个按钮就会有。</li>`;
}

/**
 * 一条释义摊开长什么样。
 *
 * 折起来只有词 + 一句中文，点开才是原句、译文、英文释义、例句这一整套——
 * 这里存的是你花过钱的东西，翻回来看得见全貌才有意义，
 * 但列表首先得能扫，所以默认收着。用 details/summary，不写展开收起的状态。
 */
function entryRow(word: string, item: Explained) {
  const a = item.analysis;
  const part = (label: string, body: string) =>
    body ? `<div class="tag">${label}</div><div class="body">${body}</div>` : '';

  return `<li>
    <details>
      <summary>
        <b>${escape(word)}</b>
        <p>${escape(a.sense)}</p>
        <time>${escape(ago(item.time))}</time>
      </summary>
      <div class="detail">
        ${part('原句', `${boldWord(item.sentence, word, item.surface)}${a.sentenceZh ? `<span>${escape(a.sentenceZh)}</span>` : ''}`)}
        ${part('英文释义', `<i>${escape(a.en)}</i>`)}
        ${part('提示', escape(a.note))}
        ${part('例句', `${escape(a.example)}<span>${escape(a.exampleZh)}</span>`)}
      </div>
    </details>
    <button class="ghost danger" data-word="${escape(word)}">删除</button>
  </li>`;
}

/** 「3 天前」比一串时间戳好读，而且这里只需要知道个大概。 */
function ago(time: number): string {
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days} 天前` : `${Math.round(days / 30)} 个月前`;
}

// ---------------------------------------------------------------- 导出到 Anki

/**
 * 词典的四元组行。background 里有一份一模一样的懒加载（loadDict），这里没有复用它，
 * 因为走消息意味着一次导出要发几百上千次 sendMessage。设置页本身就是扩展页面，
 * 直接把这 3.5MB 读进来快得多，而且只在点了导出的那一下才读——平时打开设置页不该
 * 为一个可能永远不点的按钮付这笔加载。
 */
let dictPromise: Promise<Record<string, [string, string, string, number]>> | undefined;

function loadDict() {
  dictPromise ??= fetch(browser.runtime.getURL('/data/dict.json'))
    .then((response) => response.json())
    .catch(() => ({}));
  return dictPromise;
}

$('exportAnki').addEventListener('click', async () => {
  const saved = Object.entries(await explanationsStore.getValue());
  if (!saved.length) {
    setAnkiNote('还没有生成过释义，没有可以导出的卡片。', 'bad');
    return;
  }

  const dict = await loadDict();
  // 先生成的排前面：Anki 按导入顺序发新卡，这样复习到的次序和你读到它们的次序一致
  const rows: AnkiRow[] = saved
    .sort((a, b) => a[1].time - b[1].time)
    .map(([word, item]) => {
      const row = dict[word.toLowerCase()];
      return {
        word,
        entry: row
          ? {
              phonetic: row[0],
              translation: row[1],
              tags: row[2].split(' ').filter(Boolean),
              rank: row[3],
            }
          : null,
        level: resolve(word).level,
        item,
      };
    });

  download(new Blob([toAnkiTSV(rows)], { type: 'text/plain;charset=utf-8' }), `glint-anki-${stamp()}.txt`);
  setAnkiNote(`已导出 ${rows.length} 张卡片。在 Anki 里点 Import File 选中它，牌组会自动建成 Glint。`, 'ok');
});

function setAnkiNote(text: string, tone?: 'ok' | 'bad') {
  setNote($('ankiNote'), text, tone);
}

// ---------------------------------------------------------------- 不标注的网站

function renderSites() {
  $('siteList').innerHTML = settings.disabledSites.length
    ? settings.disabledSites
        .map(
          (site) =>
            `<button type="button" class="chip" data-site="${escape(site)}" title="恢复在这个站上标注">
              ${escape(site)}<span aria-hidden="true">×</span>
            </button>`,
        )
        .join('')
    : `<p class="empty">还没有关掉任何网站。在某个站上打开工具栏弹窗就能关掉它。</p>`;
}

$('siteList').addEventListener('click', async (event) => {
  const site = (event.target as HTMLElement).closest<HTMLElement>('[data-site]')?.dataset.site;
  if (!site) return;
  await patch({ disabledSites: settings.disabledSites.filter((item) => item !== site) });
  renderSites();
});

// ---------------------------------------------------------------- 备份

$('exportData').addEventListener('click', async () => {
  const [knownWords, explanations] = await Promise.all([
    knownWordsStore.getValue(),
    explanationsStore.getValue(),
  ]);
  // apiKeys 有意不导出，理由见 settings.ts 里 Backup 的注释
  const backup: Backup = {
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    settings,
    knownWords,
    explanations,
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  download(blob, `glint-backup-${stamp()}.json`);
  setBackupNote(`已导出 ${knownWords.length} 个已认识的词、${Object.keys(explanations).length} 条释义。`, 'ok');
});

$('importData').addEventListener('click', () => $<HTMLInputElement>('importFile').click());

$<HTMLInputElement>('importFile').addEventListener('change', async (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = ''; // 清掉，否则同一个文件选第二次不触发 change
  if (!file) return;

  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    return setBackupNote('这个文件不是合法的 JSON。', 'bad');
  }

  const parsed = parseBackup(raw);
  if (!parsed.ok) return setBackupNote(parsed.error, 'bad');
  const { backup } = parsed;

  const words = backup.knownWords.length;
  const items = Object.keys(backup.explanations).length;
  if (!confirm(`导入 ${words} 个已认识的词和 ${items} 条释义（与现有的合并），并覆盖当前设置？\nAPI Key 不在备份里，不受影响。`)) {
    return;
  }

  const [knownWords, explanations] = await Promise.all([
    knownWordsStore.getValue(),
    explanationsStore.getValue(),
  ]);
  const merged = mergeBackup(backup, { knownWords, explanations });
  await Promise.all([
    knownWordsStore.setValue(merged.knownWords),
    explanationsStore.setValue(merged.explanations),
    // 备份里的设置可能来自另一个版本，照样过一遍补默认值那道关
    settingsStore.setValue({ ...settings, ...backup.settings }),
  ]);

  settings = await readSettings();
  await loadExamWords(); // 备份里的备考目标可能和现在这份不一样
  paintForm();
  await refreshCounts();
  renderSites();
  paintProvider();
  redraw();
  setBackupNote(`已合并：现在有 ${merged.knownWords.length} 个已认识的词、${Object.keys(merged.explanations).length} 条释义。`, 'ok');
});

function setBackupNote(text: string, tone?: 'ok' | 'bad') {
  setNote($('backupNote'), text, tone);
}

function setNote(note: HTMLElement, text: string, tone?: 'ok' | 'bad') {
  note.textContent = text;
  if (tone) note.dataset.tone = tone;
  else delete note.dataset.tone;
}

/** 造个临时链接把 blob 交出去。导出备份和导出 Anki 走同一套。 */
function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** 文件名里的日期。同一天导出两次就是覆盖，这是想要的。 */
const stamp = () => new Date().toISOString().slice(0, 10);

$('knownList').addEventListener('click', async (event) => {
  const word = (event.target as HTMLElement).closest<HTMLElement>('[data-known]')?.dataset.known;
  if (!word) return;
  const known = (await knownWordsStore.getValue()).filter((item) => item !== word);
  await knownWordsStore.setValue(known);
  await refreshCounts();
});

$('explainedList').addEventListener('click', async (event) => {
  const word = (event.target as HTMLElement).closest<HTMLElement>('[data-word]')?.dataset.word;
  if (!word) return;
  const saved = { ...(await explanationsStore.getValue()) };
  delete saved[word];
  await explanationsStore.setValue(saved);
  await refreshCounts();
});

$('resetExplained').addEventListener('click', async () => {
  const count = Object.keys(await explanationsStore.getValue()).length;
  if (!count) return;
  if (!confirm(`删掉全部 ${count} 条 AI 释义？以后再遇到这些词要重新生成，会重新花钱。`)) return;
  await explanationsStore.setValue({});
  await refreshCounts();
});

$('resetKnown').addEventListener('click', async () => {
  const count = (await knownWordsStore.getValue()).length;
  if (!count) return;
  if (!confirm(`清空 ${count} 个「已认识」的词？它们会重新开始被标注。`)) return;
  await knownWordsStore.setValue([]);
  await refreshCounts();
});

init();
