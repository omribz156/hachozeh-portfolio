/**
 * edge.spec.mjs — Edge-case routing checks.
 *
 * Uses the Playwright `request` fixture for HTTP-only assertions and
 * `page` only when rendered content needs to be observed (fallback page).
 * Zero visual/snapshot assertions.
 *
 * Routes covered:
 *   GET /fallback/<kind>   — valid kinds redirect to /trending?overlay=<overlay>
 *                            (see systems/web/src/pages/fallback/[kind].astro)
 *   GET /this-page-does-not-exist-xyz — branded 404
 *
 * SKIPPED:
 *   error.html + maintenance.html — served by Caddy as static error pages when
 *   upstream fails. They are NOT Astro routes and not reachable as normal URLs
 *   through the gateway during normal operation. Asserting them would require
 *   deliberately crashing the upstream, which is out of scope for a health check.
 *
 * NOTE: the 7 legacy *.html redirect shims (portfolio.html, new-markets.html,
 *   breaking-markets.html, graphs-and-accuracy.html, qanda.html,
 *   admin-market-management.html, market-detail.html) and their spec
 *   (astro-legacy-redirects.spec.mjs) were removed 2026-06-23 — the platform
 *   never went public, so those pre-Astro URLs have no inbound links to preserve.
 *   /fallback/<kind> (incl. its .html variants) is a SEPARATE, live mechanism.
 */

import { test, expect } from '@playwright/test';
import { astroBase } from './fixtures/contexts.mjs';

// ─── /fallback/<kind> ─────────────────────────────────────────────────────────
//
// overlayByKind map (from [kind].astro):
//   login                              → /trending?overlay=login
//   signup                             → /trending?overlay=signup
//   otp                                → /trending?overlay=otp
//   processing-of-login-or-signup      → /trending?overlay=auth-processing
//   signup-success                     → /trending?overlay=auth-success
//   signup-failed                      → /trending?overlay=auth-error
//   <unknown>                          → /trending  (no overlay param)
//
// Astro redirects are followed by Playwright page.goto by default.
// We assert the final URL rather than the 3xx status (which Playwright hides
// behind the final response) — consistent with how legal.spec.mjs does /qanda.

test.describe('GET /fallback/<kind> — redirects to /trending', () => {
  test('fallback/login → /trending?overlay=login', async ({ page }) => {
    await page.goto(`${astroBase}/fallback/login`, { waitUntil: 'domcontentloaded' });
    const url = new URL(page.url());
    expect(url.pathname).toBe('/trending');
    expect(url.searchParams.get('overlay')).toBe('login');
  });

  test('fallback/signup → /trending?overlay=signup', async ({ page }) => {
    await page.goto(`${astroBase}/fallback/signup`, { waitUntil: 'domcontentloaded' });
    const url = new URL(page.url());
    expect(url.pathname).toBe('/trending');
    expect(url.searchParams.get('overlay')).toBe('signup');
  });

  test('fallback/otp → /trending?overlay=otp', async ({ page }) => {
    await page.goto(`${astroBase}/fallback/otp`, { waitUntil: 'domcontentloaded' });
    const url = new URL(page.url());
    expect(url.pathname).toBe('/trending');
    expect(url.searchParams.get('overlay')).toBe('otp');
  });

  test('fallback/processing-of-login-or-signup → /trending?overlay=auth-processing', async ({ page }) => {
    await page.goto(`${astroBase}/fallback/processing-of-login-or-signup`, { waitUntil: 'domcontentloaded' });
    const url = new URL(page.url());
    expect(url.pathname).toBe('/trending');
    expect(url.searchParams.get('overlay')).toBe('auth-processing');
  });

  test('fallback/signup-success → /trending?overlay=auth-success', async ({ page }) => {
    await page.goto(`${astroBase}/fallback/signup-success`, { waitUntil: 'domcontentloaded' });
    const url = new URL(page.url());
    expect(url.pathname).toBe('/trending');
    expect(url.searchParams.get('overlay')).toBe('auth-success');
  });

  test('fallback/signup-failed → /trending?overlay=auth-error', async ({ page }) => {
    await page.goto(`${astroBase}/fallback/signup-failed`, { waitUntil: 'domcontentloaded' });
    const url = new URL(page.url());
    expect(url.pathname).toBe('/trending');
    expect(url.searchParams.get('overlay')).toBe('auth-error');
  });

  test('fallback/<unknown-kind> → /trending (no overlay)', async ({ page }) => {
    // Any unmapped kind falls through to a plain /trending redirect.
    await page.goto(`${astroBase}/fallback/some-unknown-kind`, { waitUntil: 'domcontentloaded' });
    const url = new URL(page.url());
    expect(url.pathname).toBe('/trending');
    // No overlay param — unmapped kind gets a plain redirect
    expect(url.searchParams.has('overlay')).toBe(false);
  });

  // .html variants are also in the map (login.html, signup.html, …)
  test('fallback/login.html → /trending?overlay=login', async ({ page }) => {
    await page.goto(`${astroBase}/fallback/login.html`, { waitUntil: 'domcontentloaded' });
    const url = new URL(page.url());
    expect(url.pathname).toBe('/trending');
    expect(url.searchParams.get('overlay')).toBe('login');
  });
});

// ─── Bogus route → 404 ────────────────────────────────────────────────────────

test.describe('Bogus route → 404', () => {
  test('GET /this-page-does-not-exist-xyz returns 404', async ({ request }) => {
    // We use `request` (no redirect following for 404 — Playwright request does NOT
    // throw on 4xx). The branded 404 is an Astro page, so Astro returns 404 status.
    const res = await request.get(`${astroBase}/this-page-does-not-exist-xyz`);
    expect(res.status()).toBe(404);
  });
});

// ─── Legacy .html redirects ────────────────────────────────────────────────────
//
// The 7 pre-Astro *.html redirect shims and their spec were deleted 2026-06-23
// (never went public → no inbound links to preserve). Those paths now 404, which
// is correct. Nothing to assert here.

// ─── error.html + maintenance.html ────────────────────────────────────────────
//
// SKIPPED — these are Caddy-level static error pages (served by Caddy when the
// upstream is down / returns 5xx). They are not Astro routes and are not reachable
// at a normal URL path during healthy operation. Testing them would require
// intentionally breaking the upstream, which is out of scope for this gate.
