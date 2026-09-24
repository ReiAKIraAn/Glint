/**
 * 预览沙盒。用的是 src/lib 下的真模块，只把两件扩展才有的事情换成假的：
 * 本地词典直接 fetch dict.json，AI 释义返回一段固定文本。
 */
import { scan, sentenceAround, type Token } from '@/lib/scan';
import { applyStyle, paint, clear } from '@/lib/highlight';
import { HoverTracker } from '@/lib/hover';
import { Card } from '@/lib/card';
import { createWordNav } from '@/lib/keynav';
import { resolve } from '@/lib/lexicon';
import { LEMMA_CASES as CASES } from '../tests/lemma-cases';
import {
  DEFAULT_SETTINGS,
  LEVEL_NAMES,
  UNKNOWN_LEVEL,
  type DictEntry,
  type Explained,
  type Settings,
} from '@/lib/types';

const settings: Settings = { ...DEFAULT_SETTINGS };
/** 沙盒里假装 AI 已就绪，这样生僻词也会被标出来方便观察 */
let aiReady = true;
let examWords: Set<string> | undefined;
const examCache: Record<string, string> = await fetch('/data/exams.json').then((r) => r.json());
const known = new Set<string>();

// ---------------------------------------------------------------- 假的后台

let dict: Record<string, [string, string, string, number]> | undefined;

async function lookup(word: string): Promise<DictEntry | null> {
  dict ??= await fetch('/data/dict.json').then((r) => r.json());
  const row = dict![word.toLowerCase()];
  if (!row) return null;
  return { phonetic: row[0], translation: row[1], tags: row[2].split(' ').filter(Boolean), rank: row[3] };
}

async function analyze(token: Token) {
  await new Promise((r) => setTimeout(r, 700)); // 装一下网络延迟，看看加载态
  return {
    ok: true as const,
    analysis: {
      sense: `（沙盒占位）"${token.surface}" 在这句里的意思`,
      en: 'placeholder definition for the sandbox',
      note: `所在句子：${sentenceAround(token).slice(0, 80)}…`,
      sentenceZh: '（沙盒占位）这里是原句的中文翻译。',
      example: 'This sentence is generated locally, no API call was made.',
      exampleZh: '这句是本地生成的，没有真的调接口。',
    },
  };
}

// ---------------------------------------------------------------- 接线

const explained: Record<string, Explained> = {};

const card = new Card({
  lookup,
  analyze: async (token) => {
    const result = await analyze(token);
    if (result.ok) {
      explained[token.lemma] = { sentence: sentenceAround(token), analysis: result.analysis, time: Date.now() };
    }
    return result;
  },
  aiReady: async () => aiReady,
  cached: (lemma) => explained[lemma] ?? null,
  onKnown: (lemma) => {
    known.add(lemma);
    render();
  },
  onPointerEnter: () => hover.hold(),
  onPointerLeave: () => hover.release(),
});

const hover = new HoverTracker({
  onEnter: (token, rect) => void card.show(token, rect),
  onLeave: () => card.hide(),
});

card.mount();
hover.start();

/** 当前这一遍扫出来的词。键盘遍历要按它走，所以提到模块作用域。 */
let tokens: Token[] = [];

function render() {
  clear();
  applyStyle(settings.style);
  tokens = scan(document.querySelector('article')!, settings, known, aiReady, examWords);
  paint(tokens);
  hover.setTokens(tokens);
  const countEl = document.getElementById('count');
  if (countEl) countEl.textContent = String(tokens.length);
}

// ---------------------------------------------------------------- 控制条

const $ = (id: string) => document.getElementById(id)!;
const levelInput = $('level') as HTMLInputElement;

levelInput.addEventListener('input', () => {
  settings.level = Number(levelInput.value) as Settings['level'];
  $('levelOut').textContent = LEVEL_NAMES[settings.level] ?? '';
  render();
});
$('style').addEventListener('change', (e) => {
  settings.style = (e.target as HTMLSelectElement).value as Settings['style'];
  render();
});
$('targetExam').addEventListener('change', (e) => {
  const exam = (e.target as HTMLSelectElement).value;
  examWords = exam ? new Set(examCache[exam]!.split(' ')) : undefined;
  render();
});
$('aiReady').addEventListener('change', (e) => {
  aiReady = (e.target as HTMLInputElement).checked;
  render();
});
$('passedExam').addEventListener('change', (e) => {
  settings.passedExam = Number((e.target as HTMLSelectElement).value) as Settings['passedExam'];
  render();
});
$('oncePerPage').addEventListener('change', (e) => {
  settings.oncePerPage = (e.target as HTMLInputElement).checked;
  render();
});
$('markUnknown').addEventListener('change', (e) => {
  settings.markUnknown = (e.target as HTMLInputElement).checked;
  render();
});

// 调试用：在控制台里直接查任意词的判定结果
const dbg = window as unknown as Record<string, unknown>;
dbg.glintResolve = resolve;
dbg.glintHover = hover;
dbg.glintCard = card;
dbg.glintExplained = explained; // 沙盒里可以手改一条存货，试「另一句里的意思」那条路

// ---------------------------------------------------------------- 截图钩子

/**
 * 给商店截图用的：按 URL 参数把界面摆成某个状态，然后无头浏览器拍下来。
 *
 *   ?card=latticework        把卡片停在这个词上
 *   &ai=1                    再点一下「AI 释义」，拍展开后的样子
 *   &bare=1                  收掉底部那条控制条
 *
 * 存在的理由是「截图拍的必须是真界面」。手工摆一遍再截，下次改了 UI 就对不上了；
 * 用设计稿重画更糟——商店里那几张图会直接变成对用户的虚假承诺。
 * 只在沙盒里生效，不进任何构建产物。
 */
const shot = new URLSearchParams(location.search);
if (shot.has('bare')) document.getElementById('bar')?.remove();
const shotWord = shot.get('card');
if (shotWord) {
  requestAnimationFrame(() => {
    const token = tokens.find((t) => t.surface.toLowerCase() === shotWord.toLowerCase());
    if (!token) return;
    hover.pin(token);
    if (shot.has('ai')) {
      // 卡片内容是异步渲染的，等它把按钮画出来再点
      setTimeout(() => {
        const button = card.element.shadowRoot?.querySelector<HTMLElement>('[data-act="explain"]');
        button?.click();
      }, 300);
    }
  });
}

// ---------------------------------------------------------------- 键盘

/**
 * 沙盒里也接上键盘遍历，用的是内容脚本那份同一个模块。
 *
 * 真扩展里这条走 manifest 的 commands（Alt+G），浏览器把按键交给后台再转发；
 * 沙盒没有那一层，所以这里直接监听同一组键，方便试手感。
 */
const nav = createWordNav({ tokens: () => tokens, hover, card });
document.addEventListener('keydown', (event) => {
  nav.onKeydown(event);
  if (event.altKey && (event.key === 'g' || event.key === 'G')) {
    event.preventDefault();
    nav.step(event.shiftKey ? -1 : 1);
  }
});

// ---------------------------------------------------------------- 自检

/**
 * 跑的是真的 resolve()，用例表和 `pnpm test` 共用同一份（tests/lemma-cases.ts）。
 * 这里比测试多显示一列等级——「剥对了没有」测试管，「剥完落在哪一档」得看着判断。
 */
const rows = CASES.map(([surface, expected]) => {
  const { lemma, level } = resolve(surface);
  const label = level === UNKNOWN_LEVEL ? '生僻' : LEVEL_NAMES[level];
  const ok = lemma === expected;
  return `<div class="${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'}<span>${surface}</span>→<span>${lemma}</span><span>${label}</span>${
    ok ? '' : `<span>期望 ${expected}</span>`
  }</div>`;
});
const failures = CASES.filter(([s, e]) => resolve(s).lemma !== e).length;
$('selftestBody').innerHTML =
  `<div style="margin-bottom:8px">${CASES.length - failures} / ${CASES.length} 通过</div>` + rows.join('');

render();
