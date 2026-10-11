import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPageCache } from './page-cache.js';

function policy(path, requestOptions = {}, status = 200, extraHeaders = {}) {
  const url = new URL(path, 'https://example.test');
  const headers = new Headers({ 'content-type': 'text/html; charset=utf-8', ...extraHeaders });
  applyPageCache(headers, new Request(url, requestOptions), url, status);
  return headers.get('cache-control');
}
test('anonymous public documents revalidate in browsers and expire at the edge after a minute', () => {
  for (const path of ['/', '/closing-markets', '/markets/test', '/markets/test/']) {
    assert.equal(policy(path), 'public, max-age=0, s-maxage=60, must-revalidate');
  }
});
test('auth, attribution, non-public pages and failures are never shared', () => {
  for (const path of ['/?overlay=login', '/?overlay=signup', '/?ref=share', '/portfolio', '/settings', '/api/auth/start']) {
    assert.equal(policy(path), 'private, no-store');
  }
  for (const headers of [{ cookie: 'custom_session=test' }, { cookie: 'hz_src=test' }, { authorization: 'Bearer test' }]) {
    assert.equal(policy('/', { headers }), 'private, no-store');
  }
  assert.equal(policy('/', { method: 'POST' }), 'private, no-store');
  assert.equal(policy('/', {}, 500), 'private, no-store');
  assert.equal(policy('/', {}, 200, { 'set-cookie': 'test=1' }), 'private, no-store');
});
test('does not alter non-document API or hashed asset cache policy', () => {
  const headers = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store' });
  const url = new URL('https://example.test/api/session');
  applyPageCache(headers, new Request(url), url, 200);
  assert.equal(headers.get('cache-control'), 'no-store');
});
