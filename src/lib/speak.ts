/**
 * 念一个英文单词。
 *
 * 走浏览器自带的 Web Speech API，用的是系统里已经装好的语音：
 * **零权限、零体积、离线可用**，一行网络请求都不发。
 *
 * 认真评估过换成神经 TTS（sanoTTS 那一类），结论是不划算：
 * 许可证是 GPLv3（G2P 那一环绕不开 espeak-ng），运行时 2.6MB 起、每个声音的权重
 * 还要另拉 4–7MB，而且在 MV3 里唯一能跑通的位置是 offscreen document——
 * content script 里注入 wasm 会被宿主页面的 CSP 拦掉。
 * 换来的收益是**句子**的韵律，而这里只念一个词，那正好是差距最小的地方。
 */

const hasAPI =
  typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';

/**
 * 这台机器上能不能念——API 在，而且**有本机英文语音**。
 *
 * 两个条件都不假设成立，因为卡片得在念不了的环境里也长得正常（少一颗按钮而已），
 * 而不是渲染出一颗点了没反应的喇叭——那比没有更糟。
 *
 * 是个函数不是常量：语音表是异步装的，模块加载那一刻问往往是空的。每次重画现问一次，
 * getVoices() 只是同步读一个数组，不值得为它缓存（见 pickVoice 的注释）。
 * 代价是页面刚打开、语音表还没装好时弹的第一张卡可能没有喇叭，下一张就有了。
 */
export function canSpeak(): boolean {
  return hasAPI && !!pickVoice();
}

/**
 * 挑一个英文嗓子。**只认本机语音，没有就返回 null。**
 *
 * `localService === false` 按规范就是「不在本机合成」——Chrome 的语音表里混着一批
 * Google 的网络语音，音质更好，但用它意味着把你正在读的那个词发到别人服务器上。
 *
 * 这不只是取舍问题，是承诺问题：PRIVACY.md 里写着「只有你主动点 AI 释义时才发出
 * 网络请求，关掉 AI 释义就完全不联网」。留一条网络语音的回退，那句话就是假的——
 * 而它已经作为隐私政策公开了。所以宁可这台机器上没有喇叭（canSpeak 会如实说没有），
 * 也不能让一颗喇叭按钮把承诺撕开一个口子。
 *
 * 每次问都重挑一次，不缓存。getVoices() 是同步读一个数组，几乎不要钱，而缓存要处理
 * 「第一次调用返回空数组」（语音表是异步装的）和 voiceschanged 之后作废——
 * 为一个点击频率的操作背这两个状态不值。
 */
function pickVoice(): SpeechSynthesisVoice | null {
  const local = speechSynthesis
    .getVoices()
    .filter((v) => v.localService && v.lang.replace('_', '-').toLowerCase().startsWith('en'));
  return local.find((v) => v.lang.toLowerCase().startsWith('en-us')) ?? local[0] ?? null;
}

/**
 * 加载时先问一次，把语音表预热掉。
 *
 * getVoices() 第一次调用返回的是空数组，同时在后台去装那张表。不预热的话，
 * 「第一次调用」就发生在你悬停的第一个词上——那张卡会没有喇叭，第二张才有。
 * 内容脚本在 document_idle 跑，而卡片要等 220ms 的悬停才弹，中间这段时间足够了。
 */
if (hasAPI) speechSynthesis.getVoices();

/** 单词太短，默认语速听着是「一闪而过」。慢一档，音节才分得开。 */
const RATE = 0.9;

export function speak(word: string): void {
  if (!hasAPI || !word) return;
  const voice = pickVoice();
  if (!voice) return; // 只剩网络语音，宁可不出声
  /**
   * 先清队列。默认行为是排队——连点三下会一个接一个念三遍，
   * 而点第二下的意思显然是「再念一次」，不是「念三次」。
   */
  speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(word);
  // voice 已经定了，lang 是给它兜底的：有的实现会拿 utterance.lang 去选发音规则，
  // 少了它，中文系统上可能拿中文音去拼这个英文词。
  utterance.lang = 'en-US';
  utterance.voice = voice;
  utterance.rate = RATE;
  speechSynthesis.speak(utterance);
}
