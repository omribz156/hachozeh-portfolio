// overlay-logic.test.mjs — runnable: node overlay-logic.test.mjs
// Tests pure logic from overlay-logic.js (no DOM, no window required for most).

import assert from 'node:assert/strict';

// ── Shim window for guard functions that read globals ─────────────────────────
global.window = {
  NAVI_REQUIRE_BACKEND_AUTH: undefined,
  NAVI_SUPPRESS_DEV_OTP: undefined,
  location: { search: '', pathname: '/' },
};

import {
  sanitizeOtpCode,
  isValidOtpCode,
  mapAuthErrorMessage,
  buildPageHref,
  buildCurrentOverlayHref,
  buildPostAuthReturnTo,
  canUseFakeAuth,
  shouldSuppressDevOtp,
  freshIdeaState,
} from './overlay-logic.js';

// ── isValidOtpCode ────────────────────────────────────────────────────────────
assert.equal(isValidOtpCode('123456'), true,  '6 digits → valid');
assert.equal(isValidOtpCode('12345'),  false, '5 digits → invalid');
assert.equal(isValidOtpCode('1234567'), false, '7 digits → invalid');
assert.equal(isValidOtpCode(''),       false, 'empty → invalid');
assert.equal(isValidOtpCode('12345a'), false, 'letters → invalid');
assert.equal(isValidOtpCode('000000'), true,  'zeros → valid');

// ── sanitizeOtpCode ───────────────────────────────────────────────────────────
assert.equal(sanitizeOtpCode('1a2b3c456'), '123456', 'strips non-digits, caps at 6');
assert.equal(sanitizeOtpCode('1234567'),   '123456', 'truncates to 6');
assert.equal(sanitizeOtpCode(''),          '',       'empty stays empty');
assert.equal(sanitizeOtpCode(null),        '',       'null → empty string');
assert.equal(sanitizeOtpCode(undefined),   '',       'undefined → empty string');

// ── mapAuthErrorMessage ───────────────────────────────────────────────────────
assert.equal(mapAuthErrorMessage('access_denied'),   'הכניסה עם Google בוטלה.');
assert.equal(mapAuthErrorMessage('invalid_code'),    'קוד האימות לא תקין או שפג תוקפו.');
assert.equal(mapAuthErrorMessage('rate_limited'),    'יש להמתין רגע לפני ניסיון נוסף.');
assert.equal(mapAuthErrorMessage('unknown_code_xyz'), 'האימות נכשל כרגע. נסה שוב.', 'unknown → fallback');
assert.equal(mapAuthErrorMessage(undefined),          'האימות נכשל כרגע. נסה שוב.', 'undefined → fallback');
assert.equal(mapAuthErrorMessage(''),                 'האימות נכשל כרגע. נסה שוב.', 'empty → fallback');

// ── buildPageHref ─────────────────────────────────────────────────────────────
assert.equal(
  buildPageHref('/', 'login', {}),
  '/?overlay=login',
  'adds overlay param',
);
assert.equal(
  buildPageHref('/', '', {}),
  '/',
  'no overlay → clean href, no ?',
);
// preserveCurrentSearch: uses window.location.search (shimmed to '')
global.window.location.search = '?foo=bar';
assert.equal(
  buildPageHref('/', 'login', { preserveCurrentSearch: true }),
  '/?foo=bar&overlay=login',
  'preserveCurrentSearch carries existing params',
);
assert.equal(
  buildPageHref('/', '', { preserveCurrentSearch: true }),
  '/?foo=bar',
  'preserveCurrentSearch without overlay drops overlay param but keeps others',
);
global.window.location.search = '';

assert.equal(
  buildCurrentOverlayHref('signup'),
  '/?overlay=signup',
  'current overlay href uses current pathname',
);
assert.equal(
  buildPostAuthReturnTo('https://hachozeh.com/?overlay=login&foo=bar#top'),
  '/?foo=bar#top',
  'post-auth return strips transient overlay param',
);
assert.equal(
  buildPostAuthReturnTo('/?overlay=signup'),
  '/',
  'post-auth return keeps clean relative route when only overlay was present',
);

// ── canUseFakeAuth ────────────────────────────────────────────────────────────
global.window.NAVI_REQUIRE_BACKEND_AUTH = false;
assert.equal(canUseFakeAuth(), true,  '!required → fake auth allowed');

global.window.NAVI_REQUIRE_BACKEND_AUTH = true;
assert.equal(canUseFakeAuth(), false, 'required → no fake auth');

// ── shouldSuppressDevOtp ──────────────────────────────────────────────────────
global.window.NAVI_REQUIRE_BACKEND_AUTH = false;
global.window.NAVI_SUPPRESS_DEV_OTP = false;
assert.equal(shouldSuppressDevOtp(), false, 'neither flag → show dev otp');

global.window.NAVI_SUPPRESS_DEV_OTP = true;
assert.equal(shouldSuppressDevOtp(), true, 'suppress flag → suppress');

global.window.NAVI_REQUIRE_BACKEND_AUTH = true;
global.window.NAVI_SUPPRESS_DEV_OTP = false;
assert.equal(shouldSuppressDevOtp(), true, 'backend required → suppress');

// ── freshIdeaState ────────────────────────────────────────────────────────────
const idea = freshIdeaState();
assert.equal(idea.type, 'idea');
assert.equal(idea.sent, false);
assert.deepEqual(idea.draft, { title: '', message: '' });
// Returns a new object each call (not shared ref)
assert.notEqual(freshIdeaState(), freshIdeaState());

console.log('ok — all overlay-logic tests passed');
