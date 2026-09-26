/**
 * discovery.spec.mjs — E2E + pixel regression for the four guest discovery routes.
 *
 * Routes covered:
 *   /trending          — primary; also tested via / redirect
 *   /breaking-markets  — moved-most feed, bespoke layout
 *   /new-markets       — under-construction static page
 *   /topics/politics   — category hub (FeedPage with category filter)
 *
 * Guest spec — NO auth, NO storageState. Default Playwright context.
 *
 * Template: portfolio.spec.mjs (data page — explicit landmark assertions, NOT aria-snapshot).
 */

import { test, expect } from '@playwright/test';
import { astroBase } from './fixtures/contexts.mjs';
import { installConsoleGate } from './fixtures/console-gate.mjs';
import { snap, chromeMasks } from './fixtures/screenshot.mjs';

// ── shared helpers ────────────────────────────────────────────────────────────

/**
 * Wait for the trending/topics feed stream to have at least one card rendered.
 * FeedPage is pure SSR — cards are in the HTML; we just wait for the first one
 * to be visible after hydration and paints settle.
 */
async function waitForMarketStream(page) {
  await page.locator('[data-market-stream]').waitFor({ state: 'attached', timeout: 10_000 });
}

// ─────────────────────────────────────────────────────────────────────────────
// /trending — full suite
// ─────────────────────────────────────────────────────────────────────────────
test.describe('/trending — full E2E', () => {
  // ── 1. Load ────────────────────────────────────────────────────────────────
  test('loads with 200 SSR and <main> visible', async ({ page }) => {
    const gate = installConsoleGate(page);

    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/trending') && r.request().method() === 'GET'
      ),
      page.goto(`${astroBase}/trending`, { waitUntil: 'domcontentloaded' }),
    ]);
    expect(response.status()).toBe(200);

    // SSR wrapper
    await expect(page.locator('[data-trending-stage]')).toBeVisible();

    // Guest header: guest actions group (הרשמה / התחברות) is visible;
    // the user-actions group (wallet) is hidden by default.
    await expect(page.locator('[data-shell-guest-actions]')).toBeVisible();
    // Signup CTA link present as part of the guest chrome
    await expect(page.locator('[data-overlay-open="signup"]').first()).toBeVisible();

    gate.assertClean();
  });

  // / redirects to /trending — confirm the redirect resolves cleanly
  test('/ redirects to /trending and renders the feed', async ({ page }) => {
    const gate = installConsoleGate(page);

    await page.goto(`${astroBase}/`, { waitUntil: 'domcontentloaded' });
    // Astro SSR redirect: final URL must contain /trending
    await expect(page).toHaveURL(/\/trending/);
    await expect(page.locator('[data-trending-stage]')).toBeVisible();

    gate.assertClean();
  });

  // ── 2. Structure landmarks ─────────────────────────────────────────────────
  test('key landmarks exist: hero-zone, market stream, category chips, sort', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/trending`, { waitUntil: 'domcontentloaded' });
    await waitForMarketStream(page);

    // Hero zone (opening): visible at full desktop width (default viewport 1280px)
    await expect(page.locator('.hz-trending__hero-zone')).toBeVisible();

    // Market stream section
    const stream = page.locator('[data-market-stream]');
    await expect(stream).toBeVisible();

    // At least one market card rendered in the stream
    const cards = stream.locator('.hz-card, [data-market-key]');
    await expect(cards.first()).toBeVisible();
    const cardCount = await cards.count();
    expect(cardCount, 'expected at least one market card').toBeGreaterThan(0);

    // Category filter chips
    const chips = page.locator('[data-trending-chips] [data-chip]');
    await expect(chips.first()).toBeVisible();

    // Sort select
    await expect(page.locator('[data-trending-sort]')).toBeVisible();

    // Filter row nav container
    await expect(page.locator('[data-trending-filters]')).toBeVisible();

    gate.assertClean();
  });

  // ── 3. Flow — click a market card → navigate to /markets/... ──────────────
  test('clicking a market card navigates to /markets/:key', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/trending`, { waitUntil: 'domcontentloaded' });
    await waitForMarketStream(page);

    // Grab the first card's href to assert destination
    const firstCard = page.locator('[data-market-stream] [data-market-key]').first();
    await expect(firstCard).toBeVisible();

    const cardHref = await firstCard.getAttribute('href');
    expect(cardHref, 'market card should have an href').toMatch(/^\/markets\//);

    // Click and assert navigation
    await Promise.all([
      page.waitForURL(/\/markets\//, { timeout: 10_000 }),
      firstCard.click(),
    ]);

    // Confirm we landed on a market detail page
    await expect(page).toHaveURL(/\/markets\//);

    gate.assertClean();
  });

  // ── 4. Responsive contract (1024px breakpoint) ────────────────────────────
  //
  // From trending-stage.css:
  //   .hz-trending__hero-zone { display: grid } — visible ≥1025px
  //   @media (max-width: 1024px) { .hz-trending__hero-zone { display: none } }
  //
  // Above 1024px → hero-zone visible. Below 1024px → hero-zone hidden (cards only).
  test('responsive contract: hero-zone visible ≥1025px, hidden ≤1024px', async ({ page }) => {
    await page.goto(`${astroBase}/trending`, { waitUntil: 'domcontentloaded' });
    await waitForMarketStream(page);

    // ── above breakpoint (1280px default — already loaded at this size) ──
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(150);

    const heroZoneAbove = await page.evaluate(() => {
      const el = document.querySelector('.hz-trending__hero-zone');
      if (!el) return null;
      return getComputedStyle(el).display;
    });
    expect(heroZoneAbove, 'hero-zone should be visible (grid) at 1280px').not.toBe('none');

    // ── at exactly the breakpoint (1024px) — should be hidden ──
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.waitForTimeout(150);

    const heroZoneAt = await page.evaluate(() => {
      const el = document.querySelector('.hz-trending__hero-zone');
      if (!el) return null;
      return getComputedStyle(el).display;
    });
    expect(heroZoneAt, 'hero-zone should be hidden (none) at exactly 1024px').toBe('none');

    // ── below breakpoint (768px — mobile) — should be hidden ──
    await page.setViewportSize({ width: 768, height: 900 });
    await page.waitForTimeout(150);

    const heroZoneBelow = await page.evaluate(() => {
      const el = document.querySelector('.hz-trending__hero-zone');
      if (!el) return null;
      return getComputedStyle(el).display;
    });
    expect(heroZoneBelow, 'hero-zone should be hidden (none) at 768px').toBe('none');

    // Cards-only feed is always present regardless of viewport
    const stream = page.locator('[data-market-stream]');
    await expect(stream).toBeVisible();
  });

  // ── 5. Pixel regression ────────────────────────────────────────────────────
  test('pixel baseline (live data masked)', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/trending`, { waitUntil: 'domcontentloaded' });
    await waitForMarketStream(page);

    // Masks — guard layout/structure, not live numbers.
    //
    //   chromeMasks(page)               — wallet cell in authed shell; harmless for guest (no-match)
    //   [data-market-stream]            — entire card grid: probabilities, prices, volumes, signals,
    //                                     and relative timestamps ("לפני 3 שעות") all drift every run
    //   .hz-trending__hero-zone         — HeroCarousel cards carry the same live probability ring +
    //                                     "מתפרץ" / "חדש" signal badges and countdown timers
    //   [data-card-ring-value]          — belt-and-suspenders: ring values inside cards if any slip
    //                                     through (e.g. server-render without full stream mask)
    const masks = [
      ...chromeMasks(page),
      page.locator('[data-market-stream]'),
      page.locator('.hz-trending__hero-zone'),
      page.locator('[data-card-ring-value]'),
    ];

    // freeze the auto-rotating hero carousel + pin the variable-height live regions
    // to a fixed height so the masked card grid can't reflow the footer below it.
    await snap(page, 'trending.png', {
      mask: masks,
      freeze: true,
      pin: [
        { sel: '[data-market-stream]', h: 900 },
        { sel: '.hz-trending__hero-zone', h: 340 },
      ],
    });

    gate.assertClean();
  });

  // ── 6. No horizontal overflow at 390px ────────────────────────────────────
  test('no horizontal overflow at 390px; warn at 360px', async ({ page }) => {
    await page.goto(`${astroBase}/trending`, { waitUntil: 'domcontentloaded' });
    await waitForMarketStream(page);

    // 390px (iPhone 14) — hard assertion
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);

    const at390 = await page.evaluate(() => {
      const dw = document.documentElement.scrollWidth;
      const cw = document.documentElement.clientWidth;
      return { scrollWidth: dw, clientWidth: cw, overflows: dw > cw + 1 };
    });
    expect(
      at390.overflows,
      `Horizontal overflow at 390px: scrollWidth=${at390.scrollWidth} clientWidth=${at390.clientWidth}`
    ).toBe(false);

    // 360px — soft warn (known narrow-screen edge cases may exist)
    await page.setViewportSize({ width: 360, height: 780 });
    await page.waitForTimeout(200);

    const at360 = await page.evaluate(() => {
      const dw = document.documentElement.scrollWidth;
      const cw = document.documentElement.clientWidth;
      return { scrollWidth: dw, clientWidth: cw, overflows: dw > cw + 1 };
    });
    if (at360.overflows) {
      console.warn(
        `[discovery] Horizontal overflow at 360px: scrollWidth=${at360.scrollWidth} clientWidth=${at360.clientWidth} — not a hard failure`
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// /breaking-markets — load + structure + pixel
// ─────────────────────────────────────────────────────────────────────────────
test.describe('/breaking-markets — load + structure + pixel', () => {
  test('loads with 200 SSR and <main> visible', async ({ page }) => {
    const gate = installConsoleGate(page);

    // Navigate and assert 200 via goto's response (avoids catching the SSE stream
    // for /api/discovery/feed/stream?feed=breaking which returns 502 on unknown feed).
    const response = await page.goto(`${astroBase}/breaking-markets`, {
      waitUntil: 'domcontentloaded',
    });
    expect(response?.status()).toBe(200);

    // SSR wrapper — breaking page uses data-breaking-stage on <main>
    await expect(page.locator('[data-breaking-stage]')).toBeVisible();

    gate.assertClean();
  });

  test('key landmarks: breaking rows section and category chips', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/breaking-markets`, { waitUntil: 'domcontentloaded' });

    // Row list landmark (aria-label="שווקים מתפרצים")
    const rowsSection = page.locator('[data-breaking-rows]');
    await expect(rowsSection).toBeVisible();

    // Category filter chips nav
    const chipsNav = page.locator('[data-breaking-chips]');
    await expect(chipsNav).toBeVisible();

    // At least one market row or an empty-state message (feed may be empty in test env)
    const rows = rowsSection.locator('[data-market-key]');
    const emptyMsg = rowsSection.locator('.hz-breaking__state');
    const hasRows = (await rows.count()) > 0;
    const hasEmpty = (await emptyMsg.count()) > 0;
    expect(
      hasRows || hasEmpty,
      'breaking-markets should show either market rows or an empty-state message'
    ).toBe(true);

    gate.assertClean();
  });

  test('pixel baseline (live data masked)', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/breaking-markets`, { waitUntil: 'domcontentloaded' });

    // Masks:
    //   [data-breaking-rows]    — row prices (pct), delta values and SVG tracks all drift every run
    //   .hz-breaking__hero-motif — decorative SVG contains no live data but has a live-dot pulse animation
    const masks = [
      ...chromeMasks(page),
      page.locator('[data-breaking-rows]'),
      page.locator('.hz-breaking__hero-motif'),
    ];

    // pin the variable-height rows so the masked list can't reflow the page below it
    await snap(page, 'breaking.png', {
      mask: masks,
      freeze: true,
      pin: [{ sel: '[data-breaking-rows]', h: 700 }],
    });

    gate.assertClean();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// /new-markets — load + structure + pixel
// ─────────────────────────────────────────────────────────────────────────────
test.describe('/new-markets — load + structure + pixel', () => {
  test('loads with 200 SSR and static page shell visible', async ({ page }) => {
    const gate = installConsoleGate(page);

    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/new-markets') && r.request().method() === 'GET'
      ),
      page.goto(`${astroBase}/new-markets`, { waitUntil: 'domcontentloaded' }),
    ]);
    expect(response.status()).toBe(200);

    // StaticPageShell renders <main data-static-page="new-markets">
    await expect(page.locator('[data-static-page="new-markets"]')).toBeVisible();

    gate.assertClean();
  });

  test('shows under-construction panel with navigation links', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/new-markets`, { waitUntil: 'domcontentloaded' });

    const panel = page.locator('.hz-static-page__panel');
    await expect(panel).toBeVisible();

    // Both CTA links rendered — scoped to the static page panel to avoid
    // matching the shell nav links that also link to /trending and /breaking-markets
    const ctaPanel = page.locator('.hz-static-page__panel');
    await expect(ctaPanel.locator('a[href="/trending"]')).toBeVisible();
    await expect(ctaPanel.locator('a[href="/breaking-markets"]')).toBeVisible();

    gate.assertClean();
  });

  test('pixel baseline', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/new-markets`, { waitUntil: 'domcontentloaded' });

    // Static page — no live data. No content masks needed beyond shell chrome.
    const masks = [...chromeMasks(page)];

    await snap(page, 'new.png', { mask: masks });

    gate.assertClean();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// /topics/politics — category hub (FeedPage with category=politics)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('/topics/politics — load + structure + pixel', () => {
  test('loads with 200 SSR and trending-stage visible', async ({ page }) => {
    const gate = installConsoleGate(page);

    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/topics/politics') && r.request().method() === 'GET'
      ),
      page.goto(`${astroBase}/topics/politics`, { waitUntil: 'domcontentloaded' }),
    ]);
    expect(response.status()).toBe(200);

    // Topics uses FeedPage which renders [data-trending-stage]
    await expect(page.locator('[data-trending-stage]')).toBeVisible();

    gate.assertClean();
  });

  test('key landmarks: market stream and intro section', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/topics/politics`, { waitUntil: 'domcontentloaded' });
    await waitForMarketStream(page);

    // Market stream section
    const stream = page.locator('[data-market-stream]');
    await expect(stream).toBeVisible();

    // Intro section: category heading + eyebrow (topics hub always has heading + intro)
    // FeedPage renders .hz-trending__intro when heading or intro prop is set
    await expect(page.locator('.hz-trending__intro')).toBeVisible();

    // At least one market card or empty-state
    const cards = stream.locator('[data-market-key]');
    const emptyEl = page.locator('.hz-trending__empty');
    const hasCards = (await cards.count()) > 0;
    const hasEmpty = (await emptyEl.count()) > 0;
    expect(
      hasCards || hasEmpty,
      'topics page should show market cards or empty-state'
    ).toBe(true);

    gate.assertClean();
  });

  test('pixel baseline (live data masked)', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/topics/politics`, { waitUntil: 'domcontentloaded' });
    await waitForMarketStream(page);

    // Masks — same reasoning as /trending stream mask.
    const masks = [
      ...chromeMasks(page),
      page.locator('[data-market-stream]'),
      page.locator('[data-card-ring-value]'),
    ];

    await snap(page, 'topics.png', { mask: masks });

    gate.assertClean();
  });
});
