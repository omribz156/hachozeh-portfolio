export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "form-action 'self'",
  // data: allows Astro's ClientRouter sentinel script (a bare data:application/javascript,
  // element it injects to sync module-script execution on soft navigations). Without it
  // the ClientRouter re-run mechanism is blocked by CSP on every soft nav.
  "script-src 'self' 'unsafe-inline' data: https://www.googletagmanager.com https://eu.i.posthog.com",
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' http://127.0.0.1:3001 http://localhost:3001 https://hachozeh.com https://www.hachozeh.com https://dev.hachozeh.com https://www.google-analytics.com https://region1.google-analytics.com https://eu.i.posthog.com https://*.ingest.sentry.io",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "media-src 'self' https:",
].join('; ');

const BASE_SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'content-security-policy': CONTENT_SECURITY_POLICY,
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

export function applySecurityHeaders(headers, url) {
  for (const [name, value] of Object.entries(BASE_SECURITY_HEADERS)) {
    headers.set(name, value);
  }

  if (url?.protocol === 'https:') {
    headers.set('strict-transport-security', 'max-age=15552000; includeSubDomains');
  }
}
