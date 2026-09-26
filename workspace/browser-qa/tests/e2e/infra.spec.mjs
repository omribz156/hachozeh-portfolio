/**
 * infra.spec.mjs — Infrastructure status + shape checks.
 *
 * Uses the Playwright `request` fixture (no browser, no rendering) for speed.
 * Zero visual/snapshot assertions — this is a pure HTTP contract check.
 *
 * Routes covered:
 *   GET /sitemap.xml                        — 200, xml, contains <urlset + <loc>
 *   GET /robots.txt                         — 200, text/plain, contains User-agent/Sitemap
 *   GET /feeds/trending.xml                 — 200, xml, contains <rss/<channel
 *   GET /feeds/breaking.xml                 — 200, xml, contains <rss/<channel
 *   GET /feeds/topics/politics.xml          — 200, xml, valid category key
 *   GET /share/markets/<key>.png            — 200, image/png, non-empty
 *   GET /share/pages/trending.png           — 200, image/png, non-empty
 *   GET /share/profiles/mrbz.png            — 200, image/png, non-empty
 */

import { test, expect } from '@playwright/test';
import { astroBase, backendBase } from './fixtures/contexts.mjs';

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Fetch one market key from the discovery feed for the share-market test. */
async function discoverMarketKey() {
  try {
    const res = await fetch(`${backendBase}/api/discovery/feed?limit=1`);
    if (!res.ok) return null;
    const json = await res.json();
    return json?.items?.[0]?.marketKey || null;
  } catch {
    return null;
  }
}

// ─── /sitemap.xml ─────────────────────────────────────────────────────────────

test.describe('GET /sitemap.xml', () => {
  test('200, xml content-type, valid urlset with at least one <loc>', async ({ request }) => {
    const res = await request.get(`${astroBase}/sitemap.xml`);
    expect(res.status()).toBe(200);

    const ct = res.headers()['content-type'] || '';
    expect(ct, 'content-type should be xml').toMatch(/xml/);

    const body = await res.text();
    expect(body, 'should contain <urlset').toContain('<urlset');
    expect(body, 'should contain at least one <loc>').toContain('<loc>');
  });
});

// ─── /robots.txt ──────────────────────────────────────────────────────────────

test.describe('GET /robots.txt', () => {
  test('200, text/plain, contains User-agent and Sitemap directives', async ({ request }) => {
    const res = await request.get(`${astroBase}/robots.txt`);
    expect(res.status()).toBe(200);

    const ct = res.headers()['content-type'] || '';
    expect(ct, 'content-type should be text/plain').toMatch(/text\/plain/);

    const body = await res.text();
    expect(body, 'should contain User-agent directive').toContain('User-agent');
    expect(body, 'should contain Sitemap directive').toContain('Sitemap:');
  });
});

// ─── /feeds/*.xml ─────────────────────────────────────────────────────────────

test.describe('GET /feeds/trending.xml', () => {
  test('200, xml, contains RSS channel markup', async ({ request }) => {
    const res = await request.get(`${astroBase}/feeds/trending.xml`);
    expect(res.status()).toBe(200);

    const ct = res.headers()['content-type'] || '';
    expect(ct, 'content-type should be xml').toMatch(/xml/);

    const body = await res.text();
    // Must contain RSS root element — either <rss or <feed (Atom)
    const hasRss = body.includes('<rss') || body.includes('<feed') || body.includes('<channel');
    expect(hasRss, 'body should contain <rss, <feed, or <channel').toBe(true);
  });
});

test.describe('GET /feeds/breaking.xml', () => {
  test('200, xml, contains RSS channel markup', async ({ request }) => {
    const res = await request.get(`${astroBase}/feeds/breaking.xml`);
    expect(res.status()).toBe(200);

    const ct = res.headers()['content-type'] || '';
    expect(ct, 'content-type should be xml').toMatch(/xml/);

    const body = await res.text();
    const hasRss = body.includes('<rss') || body.includes('<feed') || body.includes('<channel');
    expect(hasRss, 'body should contain <rss, <feed, or <channel').toBe(true);
  });
});

test.describe('GET /feeds/topics/politics.xml', () => {
  test('200, xml, contains RSS channel markup', async ({ request }) => {
    // "politics" is a valid PUBLIC_CATEGORY_HUBS key (see systems/web/src/lib/category-hubs.js)
    const res = await request.get(`${astroBase}/feeds/topics/politics.xml`);
    expect(res.status()).toBe(200);

    const ct = res.headers()['content-type'] || '';
    expect(ct, 'content-type should be xml').toMatch(/xml/);

    const body = await res.text();
    const hasRss = body.includes('<rss') || body.includes('<feed') || body.includes('<channel');
    expect(hasRss, 'body should contain <rss, <feed, or <channel').toBe(true);
  });
});

// ─── /share/markets/<key>.png ─────────────────────────────────────────────────

test.describe('GET /share/markets/<key>.png', () => {
  test('200, image/png, non-empty body (dynamic key from discovery)', async ({ request }) => {
    // Discover a live market key — if backend is down, fall back to a known sim market
    // that is always seeded in dev.
    const key = (await discoverMarketKey()) || 'disc-cm-gauntlet-sim-election-jun-2026-20260615';

    const res = await request.get(`${astroBase}/share/markets/${encodeURIComponent(key)}.png`);
    expect(res.status(), `share/markets/${key}.png should return 200`).toBe(200);

    const ct = res.headers()['content-type'] || '';
    expect(ct, 'content-type should be image/png').toMatch(/image\/png/);

    const body = await res.body();
    expect(body.length, 'PNG body should not be empty').toBeGreaterThan(0);
  });
});

// ─── /share/pages/<pageKey>.png ───────────────────────────────────────────────

test.describe('GET /share/pages/trending.png', () => {
  test('200, image/png, non-empty body', async ({ request }) => {
    // "trending" is a known PAGES key in share/pages/[pageKey].png.js
    const res = await request.get(`${astroBase}/share/pages/trending.png`);
    expect(res.status()).toBe(200);

    const ct = res.headers()['content-type'] || '';
    expect(ct, 'content-type should be image/png').toMatch(/image\/png/);

    const body = await res.body();
    expect(body.length, 'PNG body should not be empty').toBeGreaterThan(0);
  });
});

// ─── /share/profiles/<handle>.png ─────────────────────────────────────────────

test.describe('GET /share/profiles/mrbz.png', () => {
  test('200, image/png, non-empty body', async ({ request }) => {
    // "mrbz" is the data-rich test account (handle mrbz, omrib@navi.local)
    // Route returns 404 for unknown handles — mrbz must exist in dev.
    const res = await request.get(`${astroBase}/share/profiles/mrbz.png`);
    expect(res.status(), 'share/profiles/mrbz.png should return 200 (handle must exist)').toBe(200);

    const ct = res.headers()['content-type'] || '';
    expect(ct, 'content-type should be image/png').toMatch(/image\/png/);

    const body = await res.body();
    expect(body.length, 'PNG body should not be empty').toBeGreaterThan(0);
  });
});
