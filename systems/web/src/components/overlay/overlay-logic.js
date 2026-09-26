// overlay-logic.js — Pure (DOM-free) overlay logic.
// No window reads at module level — all guards are functions so they can be
// called after the runtime-config script has run.

// ── Constants ────────────────────────────────────────────────────────────────

export const NAVI_OVERLAY_PARAM = 'overlay';

export const NAVI_PAGE_ROUTES = {
  homeGuest: '/',
  homeUser: '/',
};

export const NAVI_ALLOWED_OVERLAYS = {
  'landing-guest': new Set(['login', 'signup', 'otp', 'auth-processing', 'auth-error']),
  'landing-user':  new Set(['auth-success', 'idea']),
};

// ── Guards (read window globals) ─────────────────────────────────────────────

export function isBackendAuthRequired() {
  return window.NAVI_REQUIRE_BACKEND_AUTH === true;
}

export function canUseFakeAuth() {
  return !isBackendAuthRequired();
}

export function shouldSuppressDevOtp() {
  return isBackendAuthRequired() || window.NAVI_SUPPRESS_DEV_OTP === true;
}

/** Currently always false — kept as a seam for future redirect logic. */
export function shouldRedirectToHomeUser() {
  return false;
}

// ── Validators / Sanitizers ──────────────────────────────────────────────────

export function sanitizeOtpCode(value) {
  return String(value || '')
    .replace(/\D/g, '')
    .slice(0, 6);
}

export function isValidOtpCode(value) {
  return /^\d{6}$/.test(value);
}

// ── Error messages ────────────────────────────────────────────────────────────

export function mapAuthErrorMessage(code) {
  const messages = {
    access_denied:           'הכניסה עם Google בוטלה.',
    google_auth_failed:      'Google לא החזיר אימות תקין. נסה שוב.',
    google_auth_unavailable: 'כניסה עם Google לא מוגדרת כרגע.',
    google_email_unverified: 'כתובת האימייל ב-Google לא מאומתת.',
    invalid_request:         'נא למלא את כל השדות בצורה תקינה.',
    invalid_code:            'קוד האימות לא תקין או שפג תוקפו.',
    invalid_oauth_state:     'בקשת הכניסה פגה. נסה להתחבר שוב.',
    rate_limited:            'יש להמתין רגע לפני ניסיון נוסף.',
    unauthorized:            'הגישה לחשבון הזה חסומה כרגע.',
    internal_error:          'השרת נפל על הפנים. נסה שוב עוד רגע.',
  };
  return messages[code] || 'האימות נכשל כרגע. נסה שוב.';
}

// ── URL helpers ───────────────────────────────────────────────────────────────

export function buildPageHref(pageName, overlayValue, options = {}) {
  const params = options.preserveCurrentSearch
    ? new URLSearchParams(window.location.search)
    : new URLSearchParams();

  if (overlayValue) {
    params.set(NAVI_OVERLAY_PARAM, overlayValue);
  } else {
    params.delete(NAVI_OVERLAY_PARAM);
  }

  const query = params.toString();
  return query ? `${pageName}?${query}` : pageName;
}

export function buildCurrentOverlayHref(overlayValue) {
  return buildPageHref(
    window.location.pathname || NAVI_PAGE_ROUTES.homeGuest,
    overlayValue,
    { preserveCurrentSearch: true },
  );
}

export function buildPostAuthReturnTo(href) {
  const origin = window.location.origin || 'https://hachozeh.com';
  const url = new URL(href, origin);
  url.searchParams.delete(NAVI_OVERLAY_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

// ── Formatting ────────────────────────────────────────────────────────────────

export function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(value);
}

// ── State factories ───────────────────────────────────────────────────────────

export function freshIdeaState() {
  return { type: 'idea', sent: false, draft: { title: '', message: '' } };
}
