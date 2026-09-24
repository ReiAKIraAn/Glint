/**
 * 卡片摆在词的哪一边。
 *
 * 这条判断错了不抛异常，只会让卡片在某些屏幕位置上行为怪异——而要碰到它，
 * 得手动把鼠标 hover 到视口里对的那一段，本机随手一试基本试不出来。
 *
 * 用例里的数字取自沙盒里量到的真实高度：骨架/词典态 213px，AI 释义摊开后 514px。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickSide } from '../src/lib/card';

const IDLE = 213;
const DONE = 514;

test('放得下就放下面——就近，视线不用跳', () => {
  assert.equal(pickSide({ height: IDLE, roomBelow: 400, roomAbove: 200 }), true);
  assert.equal(pickSide({ height: IDLE, roomBelow: 400, roomAbove: 600 }), true);
});

test('下面放不下就挑更宽敞的一侧', () => {
  assert.equal(pickSide({ height: DONE, roomBelow: 289, roomAbove: 460 }), false);
  assert.equal(pickSide({ height: DONE, roomBelow: 460, roomAbove: 289 }), true);
});

test('两边都放不下也要挑宽的那边，剩下的交给 maxHeight 去滚', () => {
  assert.equal(pickSide({ height: DONE, roomBelow: 100, roomAbove: 250 }), false);
  assert.equal(pickSide({ height: DONE, roomBelow: 250, roomAbove: 100 }), true);
});

/**
 * 这条是那个 bug 的回归用例。
 *
 * 场景：词落在视口下半部（下方 289px、上方 460px）。骨架 213px 放得下，卡片摆在下面；
 * 鼠标移上去点了「AI 释义」，停在那儿等；结果回来卡片要 514px，下方放不下而上方更宽敞。
 * 没有这条锁，卡片会整个跳到词上面——从鼠标底下跑掉，浏览器发 pointerleave，
 * 40ms 后卡片消失，刚花钱买到的释义看都没看见。
 */
test('鼠标踩在卡片上时不许换边，哪怕换边更宽敞', () => {
  const room = { roomBelow: 289, roomAbove: 460 };
  // 先确认这组数字确实会触发换边，否则这条用例什么都没测到
  assert.equal(pickSide({ height: DONE, ...room }), false);
  // 锁住之后必须留在原地
  assert.equal(pickSide({ height: DONE, ...room, locked: true }), true);
});

test('锁在上面的也一样不许被拉下来', () => {
  const room = { roomBelow: 600, roomAbove: 200 };
  assert.equal(pickSide({ height: IDLE, ...room }), true);
  assert.equal(pickSide({ height: IDLE, ...room, locked: false }), false);
});
