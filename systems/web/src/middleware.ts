import { defineMiddleware } from 'astro:middleware';
import { BACKEND_INTERNAL_URL } from './lib/backend.js';
import { applySecurityHeaders } from './lib/security-headers.js';

// Mirror the backend's AUTH_SESSION_COOKIE_NAME (default 'navi_session'). The
// server can therefore tell, per request, whether the caller is authenticated
// and render the correct header chrome — no client-side guest→user flip.
const SESSION_COOKIE = process.env.AUTH_SESSION_COOKIE_NAME || 'navi_session';

// Only document/page renders need the header's auth shape. Skip API routes,
// Astro internals, and static assets so we don't fire a session validation per
// stylesheet/script/image. Pages are extensionless (or `.html` legacy shims).
function rendersTheShell(pathname: string): boolean {
  if (pathname.startsWith('/api') || pathname.startsWith('/_')) return false;
  const last = pathname.split('/').pop() || '';
  if (last.includes('.') && !last.endsWith('.html')) return false;
  return true;
}

export const onRequest = defineMiddleware(async (context, next) => {
  // Default: definitively anonymous (guests + asset requests). `validated` tells
  // the client whether this is an authoritative answer it can adopt without its
  // own round-trip, or a fail-closed fallback it should re-check itself.
  let auth: App.Locals['auth'] = { authenticated: false, validated: true, payload: null };

  // Prerendered pages run this middleware at BUILD time, where there is no request
  // cookie — so a 'guest' answer would be baked into the static HTML and served to
  // signed-in users as authoritative, hiding their auth. Mark it unvalidated so the
  // client re-checks /api/session and flips to user mode. (Real runtime SSR requests
  // skip this branch and get a genuine validated answer.) No page currently
  // prerenders — help is now SSR — but this keeps any future prerender correct.
  if (context.isPrerendered) {
    context.locals.auth = { authenticated: false, validated: false, payload: null };
    const response = await next();
    applySecurityHeaders(response.headers, context.url);
    return response;
  }

  // Share attribution: a tagged landing (?ref=share&k=win) stamps a first-touch
  // cookie; the backend reads it at signup into retention_events.metadata.
  // First touch wins, value is strictly shaped, and this must never affect render.
  if (rendersTheShell(context.url.pathname)) {
    try {
      const ref = context.url.searchParams.get('ref');
      if (ref && !context.cookies.has('hz_src')) {
        const kind = context.url.searchParams.get('k') || '';
        // Win-share landings carry the claim id — it identifies the SHARER
        // server-side, which is what the referral grant pays against.
        const rawClaim = context.url.searchParams.get('claim') || '';
        const claim = /^realization_[\w-]{10,64}$/.test(rawClaim) ? rawClaim : '';
        const value = [ref, kind, claim].filter(Boolean).join(':').slice(0, 60);
        if (/^[\w:.-]+$/.test(value)) {
          context.cookies.set('hz_src', value, {
            path: '/',
            maxAge: 60 * 60 * 24 * 30,
            sameSite: 'lax',
            httpOnly: true,
            secure: context.url.protocol === 'https:',
          });
        }
      }

      // Marketing attribution: a UTM-tagged landing (?utm_source=tiktok&utm_campaign=v1
      // — e.g. from the /start social-entry page's CTA) stamps a first-touch hz_utm
      // cookie, read at signup into retention_events.metadata. Kept SEPARATE from hz_src
      // on purpose: hz_src drives referral PAYOUTS, hz_utm is analytics only (never pays).
      const utmSource = context.url.searchParams.get('utm_source');
      if (utmSource && !context.cookies.has('hz_utm')) {
        const clean = (v: string | null) => (v || '').replace(/[^\w.-]/g, '').slice(0, 40);
        const value = [
          clean(utmSource),
          clean(context.url.searchParams.get('utm_medium')),
          clean(context.url.searchParams.get('utm_campaign')),
        ].join('|').slice(0, 124);
        if (clean(utmSource)) {
          context.cookies.set('hz_utm', value, {
            path: '/',
            maxAge: 60 * 60 * 24 * 30,
            sameSite: 'lax',
            httpOnly: true,
            secure: context.url.protocol === 'https:',
          });
        }
      }
    } catch {
      // attribution is best-effort by definition
    }
  }

  if (rendersTheShell(context.url.pathname) && context.cookies.has(SESSION_COOKIE)) {
    try {
      // Authoritative: the backend re-validates the token (session/user status +
      // expiry) on every render. Forward the request's cookie server-to-server.
      // /api/session embeds currentUser for authed sessions, so the full payload
      // captured here lets the client adopt it instead of re-fetching on load.
      const response = await fetch(new URL('/api/session', BACKEND_INTERNAL_URL), {
        headers: {
          cookie: context.request.headers.get('cookie') || '',
          accept: 'application/json',
        },
      });

      if (response.ok) {
        const payload = await response.json().catch(() => null);
        const authenticated = payload?.session?.authenticated === true;
        auth = { authenticated, validated: true, payload: authenticated ? payload : null };
      } else {
        // Non-OK (5xx etc.) — couldn't validate authoritatively; client re-checks.
        auth = { authenticated: false, validated: false, payload: null };
      }
    } catch {
      // Backend unreachable → render guest now, tell the client to re-check.
      auth = { authenticated: false, validated: false, payload: null };
    }
  }

  context.locals.auth = auth;
  const response = await next();
  applySecurityHeaders(response.headers, context.url);
  return response;
});
