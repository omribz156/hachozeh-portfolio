import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

// The curated snapshot omits the retired design runtime.
const scripts = [new URL('./auth-session.js', import.meta.url)];
for (const file of scripts) {
  const source = await readFile(file, 'utf8');
  function load(href, configuredBase) {
    const window = {
      location: { href }, NAVI_ENABLE_BACKEND_AUTH: true,
      NAVI_BACKEND_BASE_URL: configuredBase,
      __NAVI_SSR_AUTH: { validated: true, authenticated: false },
      dispatchEvent() {},
      fetch: async () => ({ ok: true, json: async () => ({ session: { authenticated: false } }) }),
    };
    vm.runInNewContext(source, { window, URL, console, CustomEvent: class {} });
    return window;
  }
  test(`${file.pathname}: public auth cannot be redirected by query or unsafe config`, () => {
    for (const value of ['javascript:alert(1)//', 'https://attacker.invalid', '//attacker.invalid', 'http://127.0.0.1:3001']) {
      const window = load(`https://example.com/?backendBase=${encodeURIComponent(value)}`, value);
      window.NaviAuthSession.startGoogle('/');
      assert.equal(new URL(window.location.href, 'https://example.com').origin, 'https://example.com');
    }
  });
  test(`${file.pathname}: local preview supports only explicit loopback destinations`, () => {
    const window = load('http://localhost:6969/?backendBase=http://127.0.0.1:3001');
    window.NaviAuthSession.startGoogle('/');
    assert.equal(new URL(window.location.href).origin, 'http://127.0.0.1:3001');
    const rejected = load('http://localhost:6969/?backendBase=javascript:alert(1)');
    rejected.NaviAuthSession.startGoogle('/');
    assert.equal(new URL(rejected.location.href, 'http://localhost:6969').origin, 'http://localhost:6969');
  });
}
