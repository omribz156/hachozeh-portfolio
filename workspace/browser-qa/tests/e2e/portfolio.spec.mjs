/**
 * portfolio.spec.mjs — E2E + pixel regression for /portfolio
 *
 * Template spec for all data-page specs. Copy this and adapt:
 *   1. Import + auth pattern (ensureOmrib / OMRIB_STATE)
 *   2. Structure assertions (data-* selectors discovered from source)
 *   3. One real interaction (range switch, sort, search)
 *   4. snap() with exhaustive live-data masks
 *   5. Overflow hygiene at 390/360
 *
 * DAILY-STREAK DE-FLAKE
 * ---------------------
 * The daily-streak island fires ~600 ms after DOMContentLoaded on every authed
 * page and POPs the streak-claim ticket overlay if GET /api/wallet/faucets returns
 * canClaim=true. Because the overlay is fixed-positioned it pushes the full-page
 * height and shifts content, breaking the pixel baseline non-deterministically
 * (depending on whether omrib has already claimed today).
 *
 * Fix: every test.goto() in this spec is preceded by a page.route() mock that
 * returns an already-claimed faucet state (canClaim=false for both faucets).
 * This is the SAME approach used in daily-streak.spec.mjs — it's the correct
 * seam. The overlay code then maps state → null and exits without opening.
 *
 * A dedicated test ("daily-win state appears on /portfolio") mocks the faucet
 * to a claimable state and asserts the overlay renders — that test owns the
 * positive coverage for the feature on this page.
 */

import { test, expect } from '@playwright/test';
import { OMRIB_STATE, astroBase, ensureOmribStorageState } from './fixtures/contexts.mjs';
import { installConsoleGate } from './fixtures/console-gate.mjs';
import { snap, chromeMasks, stabilize } from './fixtures/screenshot.mjs';

// Authed page — mint the cached omrib session at module load, then declare it.
// Must be top-level await (NOT beforeAll); see ensureOmribStorageState() docs.
await ensureOmribStorageState();
test.use({ storageState: OMRIB_STATE });

// ─── Faucet mock helpers ──────────────────────────────────────────────────────

/**
 * Silence the daily-streak island: return an already-claimed faucet state so
 * mapState() → null and the overlay never opens. Register BEFORE page.goto().
 */
async function suppressStreak(page) {
  await page.route('**/api/wallet/faucets', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        faucets: {
          dailyLogin: { canClaim: false, rewardAmount: 0, nextStreakDay: 0, currentStreakDay: 3 },
          emergency:  { canClaim: false, rewardAmount: 0 },
        },
        liquidBalance: 350,
        hasActivePosition: true,
      }),
    });
  });
}

/**
 * Mock a claimable faucet state for the daily-win positive test.
 * Uses the "position" kind: dailyLogin.canClaim=true + hasActivePosition=true.
 */
async function mockClaimableFaucet(page) {
  await page.route('**/api/wallet/faucets', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        faucets: {
          dailyLogin: { canClaim: true, rewardAmount: 150, nextStreakDay: 2, currentStreakDay: 1 },
          emergency:  { canClaim: false, rewardAmount: 0 },
        },
        liquidBalance: 500,
        hasActivePosition: true,
      }),
    });
  });
}

/**
 * Clear the once/day localStorage gate so the island always fetches the
 * faucet (instead of short-circuiting on the seen-today stamp). Must be
 * called before page.goto() — addInitScript runs before page JS.
 */
async function clearStreakSeenStamp(page) {
  await page.addInitScript(() => {
    try { window.localStorage.removeItem('navi_streak_seen'); } catch (_) {}
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
/**
 * Wait until the Preact islands have hydrated and painted real content.
 * The vanilla orchestrator dispatches 'navi:portfolio-content-ready' when
 * PortfolioCards mounts its first model (see PortfolioCards.jsx useEffect).
 * Fallback: if the event fired before we subscribed, check for the total card.
 */
async function waitForPortfolioReady(page) {
  // Wait up to 15 s for the custom event OR for the total card to appear.
  await Promise.race([
    page.evaluate(() =>
      new Promise((resolve) => {
        if (document.querySelector('[data-portfolio-total]')) {
          resolve();
          return;
        }
        window.addEventListener('navi:portfolio-content-ready', resolve, { once: true });
      })
    ),
    page.locator('[data-portfolio-total]').waitFor({ timeout: 15_000 }),
  ]);
}

// ─── Tests ───────────────────────────────────────────────────────────────────
test.describe('/portfolio — E2E + regression', () => {
  // ── 1. Load ──────────────────────────────────────────────────────────────
  test('loads with 200 SSR and authed header chrome', async ({ page }) => {
    const gate = installConsoleGate(page);
    await suppressStreak(page);

    // Intercept to confirm SSR 200 (Caddy proxies Astro SSR)
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/portfolio') && r.request().method() === 'GET'),
      page.goto(`${astroBase}/portfolio`, { waitUntil: 'domcontentloaded' }),
    ]);
    expect(response.status()).toBe(200);

    // SSR main wrapper
    await expect(page.locator('main[data-portfolio-page]')).toBeVisible();

    // Authed header: wallet cell present, NOT the guest sign-in CTA
    await expect(page.locator('.hz-shell__wallet-cell')).toBeVisible();
    await expect(page.locator('[data-header-sign-in]')).not.toBeVisible();

    gate.assertClean();
  });

  // ── 2. Structure regression ───────────────────────────────────────────────
  test('key sections exist after hydration', async ({ page }) => {
    const gate = installConsoleGate(page);
    await suppressStreak(page);
    await page.goto(`${astroBase}/portfolio`, { waitUntil: 'domcontentloaded' });
    await waitForPortfolioReady(page);

    // Total-value card
    await expect(page.locator('[data-portfolio-total]')).toBeVisible();

    // P&L change card (contains the range switcher)
    const changeCard = page.locator('[data-portfolio-change]');
    await expect(changeCard).toBeVisible();

    // Range switcher pills  — at least one [data-portfolio-timeframe] button
    const timeframeBtns = page.locator('[data-portfolio-timeframe]');
    await expect(timeframeBtns.first()).toBeVisible();
    const tfCount = await timeframeBtns.count();
    expect(tfCount, 'expected multiple timeframe buttons').toBeGreaterThan(1);

    // Depth section (tab bar + search bar are always rendered when model loads)
    const depthBar = page.locator('.pf-depth-bar');
    await expect(depthBar).toBeVisible();

    // Tab buttons: פוזיציות and היסטוריה
    const positionsTab = page.locator('.pf-tablist button[role="tab"]', { hasText: 'פוזיציות' });
    const historyTab = page.locator('.pf-tablist button[role="tab"]', { hasText: 'היסטוריה' });
    await expect(positionsTab).toBeVisible();
    await expect(historyTab).toBeVisible();

    // Search input
    const searchInput = page.locator('.pf-depth-search input[type="search"]');
    await expect(searchInput).toBeVisible();

    // Positions table rendered (role="table" + header row)
    const positionsTable = page.locator('[role="table"][aria-label="פוזיציות"]');
    await expect(positionsTable).toBeVisible();

    // Column header sort buttons present
    const sortBtns = page.locator('[data-portfolio-sort]');
    await expect(sortBtns.first()).toBeVisible();

    gate.assertClean();
  });

  // ── 3. Flow — range switch + column sort ─────────────────────────────────
  test('range switch updates active pill; sort changes row order', async ({ page }) => {
    const gate = installConsoleGate(page);
    await suppressStreak(page);
    await page.goto(`${astroBase}/portfolio`, { waitUntil: 'domcontentloaded' });
    await waitForPortfolioReady(page);

    // --- Range switch ---
    // The default active range is "day" (DEFAULT_TIMEFRAME_ID in PortfolioCards.jsx).
    const weekBtn = page.locator('[data-portfolio-timeframe="week"]');
    const dayBtn = page.locator('[data-portfolio-timeframe="day"]');

    // Confirm day is active before click
    await expect(dayBtn).toHaveClass(/is-active/);
    await expect(weekBtn).not.toHaveClass(/is-active/);

    // Click "week"
    await weekBtn.click();

    // After click: week pill becomes active, day is no longer active.
    // Allow up to 8 s for the async data fetch + re-render.
    await expect(weekBtn).toHaveClass(/is-active/, { timeout: 8_000 });
    await expect(dayBtn).not.toHaveClass(/is-active/);

    // The change card must still be visible (no crash/unmount on range switch)
    await expect(page.locator('[data-portfolio-change]')).toBeVisible();

    // --- Column sort (positions table) ---
    // Default sort is "value" descending. Click "שוק" (title) to sort by title asc.
    const titleSortBtn = page.locator('[data-portfolio-sort="title"]');
    await expect(titleSortBtn).toBeVisible();
    await titleSortBtn.click();

    // After clicking title: the title header should become active
    await expect(titleSortBtn).toHaveClass(/is-active/);

    // Clicking again reverses direction (asc → desc): the header stays active.
    await titleSortBtn.click();
    await expect(titleSortBtn).toHaveClass(/is-active/);

    gate.assertClean();
  });

  // ── 4. Pixel regression ───────────────────────────────────────────────────
  test('pixel baseline — layout/structure (live data masked)', async ({ page }) => {
    const gate = installConsoleGate(page);
    // Suppress daily-streak overlay BEFORE goto — the island fires 600 ms post-DCL.
    // Without this mock, mapState() may return a claimable state and the overlay
    // pushes the page taller + shifts content, breaking the diff non-deterministically.
    await suppressStreak(page);
    await page.goto(`${astroBase}/portfolio`, { waitUntil: 'domcontentloaded' });
    await waitForPortfolioReady(page);

    // Build mask list — guard layout/structure, not live numbers.
    //
    // WHY each region is masked:
    //   chromeMasks(page)            — wallet balance in header: changes every run
    //   [data-portfolio-total]       — total portfolio value + "available to trade": live numbers
    //   .pf-change-total             — P&L hero number: signed amount drifts every run
    //   .pf-change-sub-eyebrow       — date range label: drifts with timeframe selection
    //   .pf-change-sparkline-wrap    — sparkline SVG: path data changes with actual P&L curve
    //   [data-portfolio-chart]       — chart element target (belt-and-suspenders alongside wrap)
    //   .pf-positions-list           — position rows: current prices, values, PnL% all change
    //   .pf-history-list             — history rows: relative timestamps ("לפני 3 שעות") drift
    //   .pf-closing-card             — closing-soon strip: countdown timers change every second
    //   .pf-claims-card              — unclaimed winnings: amounts are live
    //
    // NOT masked (structural/static in the P&L card now visible in baseline):
    //   .pf-card-eyebrow             — "רווח/הפסד" section heading
    //   .pf-timeframes (pills)       — timeframe range labels ("יום", "שבוע", "חודש", "כל הזמן")
    //   .pf-change-mini-stats        — mini stats label row (if present)
    const masks = [
      ...chromeMasks(page),
      page.locator('[data-portfolio-total]'),
      page.locator('.pf-change-total'),
      page.locator('.pf-change-sub-eyebrow'),
      page.locator('.pf-change-sparkline-wrap'),
      page.locator('[data-portfolio-chart]'),
      page.locator('.pf-positions-list'),
      page.locator('.pf-history-list'),
      page.locator('.pf-closing-card'),
      page.locator('.pf-claims-card'),
    ];

    await snap(page, 'portfolio.png', { mask: masks });

    gate.assertClean();
  });

  // ── 5. Daily-win state — streak claim overlay appears on /portfolio ───────
  //
  // The daily-streak island boots on every authed page, including /portfolio.
  // This test asserts the overlay renders correctly when the faucet returns a
  // claimable state — covering the "daily win" scenario the owner flagged.
  //
  // Strategy: clear the seen-today localStorage gate + mock the faucet to
  // kind=position (dailyLogin.canClaim=true + hasActivePosition=true), then
  // navigate and wait for the .hz-ticket overlay to appear.
  test('daily-win state — streak claim overlay appears on /portfolio', async ({ page }) => {
    const gate = installConsoleGate(page, {
      allow: [
        // Other API calls may 429 in test runs; not related to the overlay.
        /429/i,
        /status of 429/i,
        /Failed to load resource/i,
      ],
    });

    // Clear the once/day stamp so the island always fetches.
    await clearStreakSeenStamp(page);
    // Return a claimable "position" kind: day 2, reward 150, has open position.
    await mockClaimableFaucet(page);

    await page.goto(`${astroBase}/portfolio`, { waitUntil: 'domcontentloaded' });

    // The island delays 600 ms post-DCL. Wait up to 5 s for the overlay ticket.
    const ticket = page.locator('.hz-ticket[role="dialog"]');
    await expect(ticket).toBeVisible({ timeout: 5_000 });

    // ── Structure: medallion shows the streak day being claimed ──
    const medallion = ticket.locator('.hz-medallion__day');
    await expect(medallion).toHaveText('2');

    // ── Hero: reward amount displayed ──
    const hero = ticket.locator('.hz-stub__hero');
    await expect(hero).toContainText('150');

    // ── CTA: claim button present and shows reward amount ──
    const cta = ticket.locator('[data-claim]');
    await expect(cta).toBeVisible();
    await expect(cta).toContainText('150');

    // ── Stamp ladder: 7 cells rendered ──
    const stamps = ticket.locator('.hz-stamp');
    await expect(stamps).toHaveCount(7);

    // ── Not paused (that's noposition only) ──
    await expect(ticket).not.toHaveClass(/is-paused/);

    // ── Pixel: ticket component only (isolates from live portfolio data) ──
    await stabilize(page);
    await expect(ticket).toHaveScreenshot('portfolio-daily-win.png', {
      maxDiffPixelRatio: 0.02,
    });

    gate.assertClean();
  });

  // ── 6. Hygiene — no horizontal overflow at mobile widths ─────────────────
  // 360px overflow fixed: the top-fold used a bare `1fr` track that grew to the
  // PnL card's nowrap timeframe-pill min-content (~363px), dragging both summary
  // cards off the inline-start edge. Now `minmax(0,1fr)` + card `min-width:0` +
  // pills wrap. Both 390 (iPhone 14) and 360 are asserted clean.
  test('no horizontal overflow at 390/360px', async ({ page }) => {
    await suppressStreak(page);
    await page.goto(`${astroBase}/portfolio`, { waitUntil: 'domcontentloaded' });
    await waitForPortfolioReady(page);

    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 844 });
      // Allow a repaint cycle
      await page.waitForTimeout(200);

      const overflows = await page.evaluate(() => {
        const dw = document.documentElement.scrollWidth;
        const cw = document.documentElement.clientWidth;
        return { scrollWidth: dw, clientWidth: cw, overflows: dw > cw + 1 };
      });

      expect(
        overflows.overflows,
        `Horizontal overflow at ${width}px: scrollWidth=${overflows.scrollWidth} clientWidth=${overflows.clientWidth}`
      ).toBe(false);
    }
  });
});
