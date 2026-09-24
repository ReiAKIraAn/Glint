/**
 * 站点开关的匹配。
 *
 * 这里错一次的后果是「用户以为关掉了，其实没关」或者「关掉一个站，顺手关掉了
 * 一批不相干的站」——前者让人失去信任，后者根本发现不了。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHost, siteDisabled } from '../src/lib/types';

test('www 前缀不算区别', () => {
  assert.equal(normalizeHost('WWW.Example.COM'), 'example.com');
  assert.ok(siteDisabled('www.example.com', ['example.com']));
  assert.ok(siteDisabled('example.com', ['www.example.com']));
});

test('子域跟着父域一起关', () => {
  assert.ok(siteDisabled('en.wikipedia.org', ['wikipedia.org']));
  assert.ok(siteDisabled('a.b.wikipedia.org', ['wikipedia.org']));
});

test('反过来不成立：关子域不影响父域和兄弟域', () => {
  assert.ok(!siteDisabled('wikipedia.org', ['en.wikipedia.org']));
  assert.ok(!siteDisabled('fr.wikipedia.org', ['en.wikipedia.org']));
});

test('必须以点号为界，不能是纯后缀匹配', () => {
  assert.ok(!siteDisabled('notexample.com', ['example.com']), '差一点就把不相干的站一起关了');
  assert.ok(!siteDisabled('myexample.com', ['example.com']));
});

test('空表、空项都不匹配', () => {
  assert.ok(!siteDisabled('example.com', []));
  assert.ok(!siteDisabled('example.com', ['']), '空字符串不能变成「关掉所有站」');
});

test('大小写无关', () => {
  assert.ok(siteDisabled('EN.Wikipedia.ORG', ['wikipedia.org']));
});
