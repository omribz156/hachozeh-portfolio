/**
 * daily-streak.spec.mjs — E2E + pixel regression for the daily-streak claim overlay.
 *
 * The overlay is driven by GET /api/wallet/faucets. All 4 faucet kinds are hard to
 * manufacture live (they require specific account states: open position, complete week,
 * zero balance, etc.), so every test MOCKS the faucet response via page.route().
 *
 * Faucet response shape (from daily-streak.js mapState()):
 * {
 *   faucets: {
 *     dailyLogin: { canClaim: bool, rewardAmount: number, nextStreakDay: number,
 *                   currentStreakDay: number },
 *     emergency:  { canClaim: bool, rewardAmount: number }
 *   },
 *   liquidBalance: number,
 *   hasActivePosition: bool
 * }
 *
 * kind resolution (mapState priority order):
 *   emergency  — emergency.canClaim === true  (wins regardless of dailyLogin)
 *   complete   — daily.canClaim, hasActivePosition=true, nextStreakDay >= 7
 *   position   — daily.canClaim, hasActivePosition=true, nextStreakDay < 7
 *   noposition — daily.canClaim, hasActivePosition=false
 *
 * The init island (daily-streak.js) has two skip-gates:
 *   1. localStorage key 'navi_streak_seen' === today's Jerusalem date → no auto-open.
 *      The island may still do one recovery fetch to rebuild the bell reminder.
 *   2. Another overlay already open → skip (won't mark seen).
 *
 * Claim POSTs to:
 *   /api/wallet/faucets/daily-login/claim  — position / noposition / complete
 *   /api/wallet/faucets/emergency/claim    — emergency
 *
 * After claim the overlay dispatches window event 'wallet:credited'
 * { detail: { amount, source } } so the header shell can animate independently.
 *
 * Navigation strategy: each test uses a single page.goto(). The localStorage gate
 * is cleared via page.addInitScript() (runs before any page JS, so the island
 * never sees the old stamp). The faucet mock is registered before goto so it
 * intercepts the fetch the island makes 600 ms post-DOMContentLoaded.
 * No reload needed — avoids triggering auth rate-limits.
 */

import { test, expect } from '@playwright/test';
import { OMRIB_STATE, astroBase, ensureOmribStorageState } from './fixtures/contexts.mjs';
import { installConsoleGate } from './fixtures/console-gate.mjs';
import { stabilize, chromeMasks } from './fixtures/screenshot.mjs';

// ─── Auth ─────────────────────────────────────────────────────────────────────
// Top-level await per the README's Playwright 1.60 pattern.
await ensureOmribStorageState();
test.use({ storageState: OMRIB_STATE });

// ─── Faucet fixtures ──────────────────────────────────────────────────────────
// Each matches the real GET /api/wallet/faucets response shape that daily-streak.js
// mapState() reads. Amounts are deliberately distinct per kind so assertions can
// pin on the number displayed.

const FIXTURES = {
  position: {
    faucets: {
      dailyLogin: { canClaim: true, rewardAmount: 150, nextStreakDay: 2, currentStreakDay: 1 },
      emergency:  { canClaim: false, rewardAmount: 0 },
    },
    liquidBalance: 500,
    hasActivePosition: true,
  },
  complete: {
    faucets: {
      dailyLogin: { canClaim: true, rewardAmount: 400, nextStreakDay: 7, currentStreakDay: 6 },
      emergency:  { canClaim: false, rewardAmount: 0 },
    },
    liquidBalance: 500,
    hasActivePosition: true,
  },
  noposition: {
    faucets: {
      dailyLogin: { canClaim: true, rewardAmount: 25, nextStreakDay: 3, currentStreakDay: 2 },
      emergency:  { canClaim: false, rewardAmount: 0 },
    },
    liquidBalance: 200,
    hasActivePosition: false,
  },
  emergency: {
    faucets: {
      dailyLogin: { canClaim: false, rewardAmount: 0, nextStreakDay: 1, currentStreakDay: 0 },
      emergency:  { canClaim: true, rewardAmount: 100 },
    },
    liquidBalance: 0,
    hasActivePosition: false,
  },
};

// Fixture returned when the daily-login faucet has already been claimed today.
const FIXTURE_ALREADY_CLAIMED = {
  faucets: {
    dailyLogin: { canClaim: false, rewardAmount: 0, nextStreakDay: 0, currentStreakDay: 3 },
    emergency:  { canClaim: false, rewardAmount: 0 },
  },
  liquidBalance: 350,
  hasActivePosition: false,
};

// Successful claim response body.
const CLAIM_OK = { ok: true };

// allow-list patterns added to every console gate in this file
const GATE_ALLOW = [
  // Backend API calls unrelated to the faucet may 429/404 in test runs
  /429/i,
  /status of 429/i,
  /Failed to load resource/i,
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Install an init-script that clears the 'navi_streak_seen' localStorage key
 * before any page JS runs, so the once/day gate never blocks the overlay.
 * Must be called before page.goto().
 */
async function injectGateClear(page) {
  await page.addInitScript(() => {
    try {
      if (window.sessionStorage.getItem('navi_streak_test_gate_cleared')) return;
      window.sessionStorage.setItem('navi_streak_test_gate_cleared', '1');
    } catch (_) {}
    try { window.localStorage.removeItem('navi_streak_seen'); } catch (_) {}
    try { window.localStorage.removeItem('navi_streak_pending'); } catch (_) {}
    try { window.localStorage.removeItem('navi_streak_reminder_checked'); } catch (_) {}
    try { window.localStorage.removeItem('navi_streak_reminder_read'); } catch (_) {}
    try { window.localStorage.removeItem('navi_streak_reminder_dismissed'); } catch (_) {}
  });
}

/**
 * Register the faucet GET mock. Safe to call before or after goto (route mocks
 * persist for the lifetime of the page context).
 */
async function mockFaucet(page, fixture) {
  await page.route('**/api/wallet/faucets', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fixture),
    });
  });
}

/**
 * Mock the claim POST for both paths (only one will be hit per kind).
 */
async function mockClaimPost(page, body = CLAIM_OK, status = 200) {
  for (const path of [
    '**/api/wallet/faucets/daily-login/claim',
    '**/api/wallet/faucets/emergency/claim',
  ]) {
    await page.route(path, (route) => {
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    });
  }
}

async function mockNotificationsFeed(page, items = []) {
  await page.route('**/api/me/notifications', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items }),
    });
  });
}

/**
 * Navigate to /portfolio (a stable authed page carrying the daily-streak island),
 * wait for the overlay ticket to appear.
 *
 * Call AFTER injectGateClear() + mockFaucet() so the mock is ready before the page
 * JS fires. The island boots with a 600 ms setTimeout — we wait up to 5 s.
 */
async function gotoAndWaitForOverlay(page) {
  await page.goto(`${astroBase}/portfolio`, { waitUntil: 'domcontentloaded' });
  const ticket = page.locator('.hz-ticket[role="dialog"]');
  await expect(ticket).toBeVisible({ timeout: 5_000 });
  return ticket;
}

// ─── Tests — authed, mocked faucet ───────────────────────────────────────────

test.describe('daily-streak overlay — 4 faucet kinds (mocked, authed)', () => {

  // ── kind: position ──────────────────────────────────────────────────────────
  test('kind=position — shows day badge + collect CTA with reward amount', async ({ page }) => {
    const gate = installConsoleGate(page, { allow: GATE_ALLOW });

    await injectGateClear(page);
    await mockFaucet(page, FIXTURES.position);
    const ticket = await gotoAndWaitForOverlay(page);

    // Medallion shows day number (day 2 being claimed)
    const medallion = ticket.locator('.hz-medallion__day');
    await expect(medallion).toHaveText('2');

    // Reward amount present in the hero
    const hero = ticket.locator('.hz-stub__hero');
    await expect(hero).toContainText('150');

    // CTA: "אסוף" + reward amount (position kind appends the amount span)
    const cta = ticket.locator('[data-claim]');
    await expect(cta).toBeVisible();
    await expect(cta).toContainText('150');

    // Stamp row has 7 cells
    const stamps = ticket.locator('.hz-stamp');
    await expect(stamps).toHaveCount(7);

    // No "is-paused" class (that's noposition only)
    await expect(ticket).not.toHaveClass(/is-paused/);

    // Pixel snapshot
    await stabilize(page);
    await expect(ticket).toHaveScreenshot('streak-position.png', { maxDiffPixelRatio: 0.02 });

    gate.assertClean();
  });

  // ── kind: complete ──────────────────────────────────────────────────────────
  test('kind=complete — shows day 7 / full-week copy + peak stamp', async ({ page }) => {
    const gate = installConsoleGate(page, { allow: GATE_ALLOW });

    await injectGateClear(page);
    await mockFaucet(page, FIXTURES.complete);
    const ticket = await gotoAndWaitForOverlay(page);

    // Medallion fixed to 7 on complete
    const medallion = ticket.locator('.hz-medallion__day');
    await expect(medallion).toHaveText('7');

    // Reward 400
    const hero = ticket.locator('.hz-stub__hero');
    await expect(hero).toContainText('400');

    // Peak stamp (day-7 stamp gets hz-stamp--peak class)
    const peakStamp = ticket.locator('.hz-stamp--peak');
    await expect(peakStamp).toBeVisible();

    // Seq label "סבב הושלם" rendered in the foil title
    const foilTitle = ticket.locator('.hz-foil__title');
    await expect(foilTitle).toContainText('סבב הושלם');

    // No secondary button on complete
    await expect(ticket.locator('[data-secondary]')).toHaveCount(0);

    await stabilize(page);
    await expect(ticket).toHaveScreenshot('streak-complete.png', { maxDiffPixelRatio: 0.02 });

    gate.assertClean();
  });

  // ── kind: noposition ────────────────────────────────────────────────────────
  test('kind=noposition — shows paused state + discover-markets secondary', async ({ page }) => {
    const gate = installConsoleGate(page, { allow: GATE_ALLOW });

    await injectGateClear(page);
    await mockFaucet(page, FIXTURES.noposition);
    const ticket = await gotoAndWaitForOverlay(page);

    // Ticket carries is-paused
    await expect(ticket).toHaveClass(/is-paused/);

    // Medallion label "הרצף בהמתנה"
    const medLbl = ticket.locator('.hz-medallion__lbl');
    await expect(medLbl).toContainText('הרצף בהמתנה');

    // Sub copy mentions the reward (25 V₪)
    const sub = ticket.locator('.hz-stub__sub');
    await expect(sub).toContainText('25');

    // CTA present
    const cta = ticket.locator('[data-claim]');
    await expect(cta).toContainText('אסוף');

    // Secondary button present: "לשווקים →"
    const secondary = ticket.locator('[data-secondary]');
    await expect(secondary).toBeVisible();
    await expect(secondary).toContainText('לשווקים');

    // Callout: mentions the missed position reward
    const callout = ticket.locator('.hz-callout');
    await expect(callout).toBeVisible();

    await stabilize(page);
    await expect(ticket).toHaveScreenshot('streak-noposition.png', { maxDiffPixelRatio: 0.02 });

    gate.assertClean();
  });

  // ── kind: emergency ─────────────────────────────────────────────────────────
  test('kind=emergency — shows safety-net copy + bare foil (no stamp row)', async ({ page }) => {
    const gate = installConsoleGate(page, { allow: GATE_ALLOW });

    await injectGateClear(page);
    await mockFaucet(page, FIXTURES.emergency);
    const ticket = await gotoAndWaitForOverlay(page);

    // Medallion shows "₪" (the big symbol, not a day number — see render())
    const medallion = ticket.locator('.hz-medallion__day');
    await expect(medallion).toHaveText('₪');

    // Eyebrow says "מענק חירום"
    const eyebrow = ticket.locator('.hz-stub__eyebrow');
    await expect(eyebrow).toContainText('מענק חירום');

    // Sub copy mentions reward amount (100)
    const sub = ticket.locator('.hz-stub__sub');
    await expect(sub).toContainText('100');

    // No stamp ladder on emergency (hz-foil--bare, no .hz-stamps)
    const foil = ticket.locator('.hz-foil');
    await expect(foil).toHaveClass(/hz-foil--bare/);
    await expect(ticket.locator('.hz-stamps')).toHaveCount(0);

    // CTA visible
    const cta = ticket.locator('[data-claim]');
    await expect(cta).toBeVisible();

    // Secondary "לגלות שווקים →" is present on emergency
    const secondary = ticket.locator('[data-secondary]');
    await expect(secondary).toBeVisible();

    await stabilize(page);
    await expect(ticket).toHaveScreenshot('streak-emergency.png', { maxDiffPixelRatio: 0.02 });

    gate.assertClean();
  });

  // ── Claim flow ───────────────────────────────────────────────────────────────
  test('claim — POST fired + wallet:credited event dispatched', async ({ page }) => {
    const gate = installConsoleGate(page, { allow: GATE_ALLOW });

    await injectGateClear(page);
    await mockFaucet(page, FIXTURES.position);
    await mockClaimPost(page, CLAIM_OK);
    const ticket = await gotoAndWaitForOverlay(page);

    // Capture wallet:credited event before clicking (evaluate resolves when event fires).
    const creditedPromise = page.evaluate(() =>
      new Promise((resolve) => {
        window.addEventListener('wallet:credited', (e) => resolve(e.detail), { once: true });
      })
    );

    // Click claim CTA.
    const cta = ticket.locator('[data-claim]');
    await expect(cta).toBeVisible();
    await cta.click();

    // The wallet:credited event must fire with the correct amount and source.
    const detail = await creditedPromise;
    expect(detail.amount, 'credited amount matches fixture reward').toBe(150);
    expect(detail.source, 'source is daily-login for position kind').toBe('daily-login');

    gate.assertClean();
  });

  test('unclaimed daily reward — bell reminder reopens and dismissed reminder stays dismissed', async ({ page }) => {
    const gate = installConsoleGate(page, { allow: GATE_ALLOW });

    await injectGateClear(page);
    await mockFaucet(page, FIXTURES.position);
    await mockNotificationsFeed(page);
    const ticket = await gotoAndWaitForOverlay(page);

    await ticket.locator('[data-close]').click();
    await expect(ticket).toBeHidden();

    await page.locator('.hz-shell__bell').click();
    const panel = page.locator('.hz-notif');
    await expect(panel).toHaveClass(/is-open/);
    await expect(panel).toContainText('עדיין לא מימשת את מתנת הרצף היומי שלך');

    await panel.locator('[data-notif-claim="daily-streak-pending"]').click();
    await expect(page.locator('.hz-ticket[role="dialog"]')).toBeVisible();

    await page.locator('.hz-ticket [data-close]').click();
    await expect(page.locator('.hz-ticket[role="dialog"]')).toBeHidden();

    await page.locator('.hz-shell__bell').click();
    await expect(panel).toHaveClass(/is-open/);
    await panel.locator('[data-notif-dismiss="daily-streak-pending"]').click({ force: true });
    await expect(panel).not.toContainText('עדיין לא מימשת את מתנת הרצף היומי שלך');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1_000);
    await page.locator('.hz-shell__bell').click();
    await expect(page.locator('.hz-notif')).not.toContainText('עדיין לא מימשת את מתנת הרצף היומי שלך');

    gate.assertClean();
  });

  // ── Once/day gate — already-claimed fixture → overlay does NOT appear ───────
  test('once/day gate — already-claimed faucet → overlay stays hidden', async ({ page }) => {
    const gate = installConsoleGate(page, { allow: GATE_ALLOW });

    // Clear the seen stamp so the island DOES fetch — but the server returns
    // canClaim=false for both faucets, so mapState() returns null and no overlay opens.
    await injectGateClear(page);
    await mockFaucet(page, FIXTURE_ALREADY_CLAIMED);

    await page.goto(`${astroBase}/portfolio`, { waitUntil: 'domcontentloaded' });

    // Allow time for the 600 ms boot delay + fetch + mapState() null path to settle.
    await page.waitForTimeout(1_800);

    // The ticket must NOT appear.
    const ticket = page.locator('.hz-ticket[role="dialog"]');
    await expect(ticket).toHaveCount(0);

    // If the scrim was mounted (lazy — only happens on first open()), it must be hidden.
    const scrim = page.locator('.hz-streak-scrim');
    const scrimCount = await scrim.count();
    if (scrimCount > 0) {
      await expect(scrim).toBeHidden();
    }

    gate.assertClean();
  });

  // ── localStorage gate — seen-today stamp → no auto-open, but recovery fetch can rebuild bell ──
  test('once/day gate — seen-today stamp recovers reminder without auto-opening', async ({ page }) => {
    const gate = installConsoleGate(page, { allow: GATE_ALLOW });

    // Write today's Jerusalem date into localStorage BEFORE the page runs, so the
    // island suppresses the modal. The PR keeps one recovery fetch so an unclaimed
    // gift can still be recovered from the bell after a previous close.
    await page.addInitScript(() => {
      try {
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
        window.localStorage.setItem('navi_streak_seen', today);
      } catch (_) {}
    });
    await mockNotificationsFeed(page);

    // Register the faucet mock so we can detect if it was hit.
    let faucetHit = false;
    await page.route('**/api/wallet/faucets', (route) => {
      faucetHit = true;
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIXTURES.position) });
    });

    await page.goto(`${astroBase}/portfolio`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1_800);

    // Faucet is fetched once to rebuild the bell reminder, but no modal auto-opens.
    expect(faucetHit, 'faucet API should be hit once for seen-today reminder recovery').toBe(true);

    // No overlay.
    await expect(page.locator('.hz-ticket[role="dialog"]')).toHaveCount(0);
    await page.locator('.hz-shell__bell').click();
    await expect(page.locator('.hz-notif')).toContainText('עדיין לא מימשת את מתנת הרצף היומי שלך');

    gate.assertClean();
  });
});

// ─── Guest describe — no overlay ─────────────────────────────────────────────
// Guest context: no storageState → SSR renders data-auth-hint != "user" → the
// island's isAuthed() guard exits immediately, before any fetch.

test.describe('daily-streak overlay — guest (no auth)', () => {
  test.use({ storageState: undefined });

  test('guest — faucet is never fetched and overlay does not appear', async ({ page }) => {
    const gate = installConsoleGate(page, { allow: GATE_ALLOW });

    let faucetHit = false;
    await page.route('**/api/wallet/faucets', (route) => {
      faucetHit = true;
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIXTURES.position) });
    });

    // /trending is a public page that still carries the daily-streak island.
    await page.goto(`${astroBase}/trending`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1_800);

    expect(faucetHit, 'faucet API must not be hit for a guest').toBe(false);
    await expect(page.locator('.hz-ticket[role="dialog"]')).toHaveCount(0);

    gate.assertClean();
  });
});
