/**
 * 自定义接口地址的准入。
 *
 * 这条判断决定了 API Key 会不会走明文出门，所以单独钉住。
 * grantHost 本身要调浏览器的权限接口，测不了；把纯判断抽出来测。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

/** 和 options/main.ts 里 grantHost 用的是同一份规则。 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function allowed(baseURL: string): boolean {
  let url: URL;
  try {
    url = new URL(baseURL);
  } catch {
    return false;
  }
  return url.protocol === 'https:' || LOCAL_HOSTS.has(url.hostname);
}

test('https 一律放行', () => {
  assert.ok(allowed('https://api.example.com/v1'));
  assert.ok(allowed('https://my-proxy.internal:8443/v1'));
});

test('本机的几种写法走 http 也放行——请求不出这台机器', () => {
  assert.ok(allowed('http://localhost:11434/v1'));
  assert.ok(allowed('http://127.0.0.1:11434/v1'));
  assert.ok(allowed('http://[::1]:11434/v1'));
});

test('非本机的明文 http 拒掉——那条路要带着 Key 出门', () => {
  assert.ok(!allowed('http://api.example.com/v1'));
  assert.ok(!allowed('http://192.168.1.5:11434/v1'), '局域网也算出门，同网段谁都能读');
});

test('不是合法 URL 的直接拒', () => {
  for (const bad of ['', 'api.example.com/v1', 'not a url', 'ftp:/']) {
    assert.ok(!allowed(bad), `${bad} 该被拒`);
  }
});
