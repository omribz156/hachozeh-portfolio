import assert from 'node:assert/strict';

import { applySecurityHeaders } from './security-headers.js';

const httpHeaders = new Headers();
applySecurityHeaders(httpHeaders, new URL('http://127.0.0.1:6969/'));

assert.equal(httpHeaders.get('x-content-type-options'), 'nosniff');
assert.equal(httpHeaders.get('x-frame-options'), 'DENY');
assert.match(httpHeaders.get('content-security-policy') || '', /default-src 'self'/);
assert.match(httpHeaders.get('content-security-policy') || '', /object-src 'none'/);
assert.match(httpHeaders.get('content-security-policy') || '', /base-uri 'self'/);
assert.match(httpHeaders.get('content-security-policy') || '', /frame-ancestors 'none'/);
assert.match(httpHeaders.get('content-security-policy') || '', /script-src .*https:\/\/www\.googletagmanager\.com/);
assert.match(httpHeaders.get('content-security-policy') || '', /script-src .*https:\/\/eu\.i\.posthog\.com/);
assert.match(httpHeaders.get('content-security-policy') || '', /script-src-attr 'none'/);
assert.match(httpHeaders.get('content-security-policy') || '', /connect-src .*https:\/\/www\.google-analytics\.com/);
assert.match(httpHeaders.get('content-security-policy') || '', /connect-src .*https:\/\/region1\.google-analytics\.com/);
assert.match(httpHeaders.get('content-security-policy') || '', /connect-src .*https:\/\/eu\.i\.posthog\.com/);
assert.match(httpHeaders.get('content-security-policy') || '', /connect-src .*https:\/\/\*\.ingest\.sentry\.io/);
assert.match(httpHeaders.get('content-security-policy') || '', /style-src 'self' 'unsafe-inline' https:\/\/fonts\.googleapis\.com/);
assert.match(httpHeaders.get('content-security-policy') || '', /font-src 'self' https:\/\/fonts\.gstatic\.com data:/);
assert.equal(httpHeaders.get('referrer-policy'), 'strict-origin-when-cross-origin');
assert.match(httpHeaders.get('permissions-policy') || '', /camera=\(\)/);
assert.equal(httpHeaders.get('strict-transport-security'), null);

const httpsHeaders = new Headers();
applySecurityHeaders(httpsHeaders, new URL('https://hachozeh.com/'));

assert.equal(
  httpsHeaders.get('strict-transport-security'),
  'max-age=15552000; includeSubDomains'
);
