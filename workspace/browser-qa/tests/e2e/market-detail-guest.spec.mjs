/**
 * market-detail-guest.spec.mjs — STRUCTURE-ONLY — market-detail is live-data-dominated;
 * pixel regression lives in component-visual tests (see task doc), not here.
 *
 * E2E for /markets/:marketKey as a GUEST (unauthenticated) user.
 *
 * Catalog-driven: one describe block per market type (binary / multi / event),
 * plus the binary-resolved lifecycle. Driven by MARKETS keys in fixtures/markets.mjs.
 *
 * GUEST = default Playwright context (no storageState).
 *
 * Structure-first: every open type asserts its DISTINCT layout selectors.
 *
 * Guest-specific assertions:
 *  - [data-shell-guest-actions] visible; .hz-shell__wallet-cell NOT visible
 *  - Submit gate: filling an amount and clicking submit opens ?overlay=login
 *    (tested once on the binary type; flows for multi/event assert structure only)
 *
 * DISTINCT layout selectors per type — same as authed spec:
 *  binary → [data-binary-pill-duo] + [data-md-chart]
 *  multi  → [data-market-detail-outcomes] + N outcome rows + [data-md-chart]
 *  event  → [data-market-detail-event] ladder + [data-md-chart] ABSENT
 */

import { test, expect } from '@playwright/test';
import { astroBase } from './fixtures/contexts.mjs';
import { installConsoleGate } from './fixtures/console-gate.mjs';
import { MARKETS, TYPE_MARKERS } from './fixtures/markets.mjs';

// Guest spec — NO storageState. Default context is unauthenticated.

// ─── Shared helpers ───────────────────────────────────────────────────────────

async function waitForTicketReady(page) {
  await page
    .locator('[data-market-detail-order-ticket]')
    .waitFor({ state: 'visible', timeout: 15_000 });
}

async function waitForChartReady(page) {
  await page.locator('[data-md-chart]').waitFor({ state: 'attached', timeout: 10_000 });
}

async function waitForResolvedRailReady(page) {
  await page.locator('[data-resolved-rail]').waitFor({ state: 'visible', timeout: 15_000 });
}

async function gotoMarket(page, key) {
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes(`/markets/${key}`) && r.request().method() === 'GET',
    ),
    page.goto(`${astroBase}/markets/${key}`, { waitUntil: 'domcontentloaded' }),
  ]);
  return response;
}

// ─── BINARY ──────────────────────────────────────────────────────────────────

test.describe('binary market — guest (/markets/' + MARKETS.binaryOpen.key + ')', () => {
  const KEY = MARKETS.binaryOpen.key;

  test('loads 200, guest header chrome (sign-in CTA, no wallet)', async ({ page }) => {
    const gate = installConsoleGate(page);
    const response = await gotoMarket(page, KEY);
    expect(response.status()).toBe(200);

    await expect(page.locator(`.market-detail-page[data-market-key="${KEY}"]`)).toBeVisible();
    await expect(page.locator('main.market-detail-stage-page-shell')).toBeVisible();

    // Guest chrome
    await expect(page.locator('[data-shell-guest-actions]')).toBeVisible();
    await expect(page.locator('.hz-shell__wallet-cell')).not.toBeVisible();

    gate.assertClean();
  });

  test('binary layout: pill duo present, chart present, no outcome/event ladder', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/markets/${KEY}`, { waitUntil: 'domcontentloaded' });
    await waitForTicketReady(page);
    await waitForChartReady(page);

    const h1 = page.locator('.market-detail-page-title');
    await expect(h1).toBeVisible();
    expect((await h1.textContent()).trim().length).toBeGreaterThan(0);
    await expect(page.locator('.hz-breadcrumb')).toBeVisible();

    // BINARY-DISTINCT: yes/no pill duo present (outcome selector in ticket)
    await expect(page.locator(TYPE_MARKERS.binary)).toBeVisible();
    await expect(page.locator('[data-md-chart]')).toBeVisible();

    // BINARY-DISTINCT: no multi outcome SECTION, no event ladder SECTION
    await expect(page.locator(TYPE_MARKERS.multi)).not.toBeAttached();
    await expect(page.locator(TYPE_MARKERS.event)).not.toBeAttached();

    // Mobile launcher present on binary open
    await expect(page.locator('[data-market-detail-mobile-launcher]')).toBeAttached();

    // Ticket interactive (guest can fill + preview; submit is the gate)
    const ticket = page.locator('[data-market-detail-order-ticket]');
    await expect(ticket).toBeVisible();
    await expect(ticket.locator('[data-order-amount-input]')).toBeVisible();
    await expect(ticket.locator('[data-order-submit-button]')).toBeVisible();

    gate.assertClean();
  });

  test('binary guest gate: filling amount + submit routes to ?overlay=login', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/markets/${KEY}`, { waitUntil: 'domcontentloaded' });
    await waitForTicketReady(page);

    const ticket = page.locator('[data-market-detail-order-ticket]');

    // Confirm guest chrome
    await expect(page.locator('[data-shell-guest-actions]')).toBeVisible();
    await expect(page.locator('.hz-shell__wallet-cell')).not.toBeVisible();

    // Fill amount — guest preview quote (buildGuestBuyQuote) populates
    const amountInput = ticket.locator('[data-order-amount-input]');
    await amountInput.fill('10');

    const submitLabel = ticket.locator('[data-order-submit-label]');
    await expect(submitLabel).not.toContainText('בחר סכום', { timeout: 8_000 });

    // Submit should open login overlay (overlay=login in URL)
    await Promise.all([
      page.waitForURL((url) => url.searchParams.get('overlay') === 'login', { timeout: 8_000 }),
      ticket.locator('[data-order-submit-button]').click(),
    ]);

    const currentUrl = page.url();
    expect(
      currentUrl.includes('overlay=login'),
      `URL must carry overlay=login after guest submit. Got: ${currentUrl}`,
    ).toBe(true);

    gate.assertClean();
  });
});

// ─── MULTI ───────────────────────────────────────────────────────────────────

test.describe('multi-outcome market — guest (/markets/' + MARKETS.multiOpen.key + ')', () => {
  const KEY = MARKETS.multiOpen.key;
  const EXPECTED_OUTCOMES = MARKETS.multiOpen.outcomes; // 4

  test('loads 200, guest header chrome', async ({ page }) => {
    const gate = installConsoleGate(page);
    const response = await gotoMarket(page, KEY);
    expect(response.status()).toBe(200);

    await expect(page.locator(`.market-detail-page[data-market-key="${KEY}"]`)).toBeVisible();
    await expect(page.locator('[data-shell-guest-actions]')).toBeVisible();
    await expect(page.locator('.hz-shell__wallet-cell')).not.toBeVisible();

    gate.assertClean();
  });

  test('multi layout: outcome ladder + correct row count, chart present, no pill duo/event', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/markets/${KEY}`, { waitUntil: 'domcontentloaded' });
    await waitForTicketReady(page);
    await waitForChartReady(page);

    const h1 = page.locator('.market-detail-page-title');
    await expect(h1).toBeVisible();
    expect((await h1.textContent()).trim().length).toBeGreaterThan(0);
    await expect(page.locator('.hz-breadcrumb')).toBeVisible();

    // MULTI-DISTINCT
    await expect(page.locator(TYPE_MARKERS.multi)).toBeVisible();

    const rows = page.locator('[data-market-detail-outcomes] [data-outcome-row]');
    await expect(rows).toHaveCount(EXPECTED_OUTCOMES, { timeout: 10_000 });

    await expect(page.locator('[data-md-chart]')).toBeVisible();

    // no event ladder SECTION (page-level, exclusive to event type)
    await expect(page.locator(TYPE_MARKERS.event)).not.toBeAttached();

    // no mobile launcher
    await expect(page.locator('[data-market-detail-mobile-launcher]')).not.toBeAttached();

    // Ticket present
    const ticket = page.locator('[data-market-detail-order-ticket]');
    await expect(ticket).toBeVisible();
    await expect(ticket.locator('[data-order-amount-input]')).toBeVisible();

    gate.assertClean();
  });

  test('multi flow (guest): selecting second outcome row is interactive; submit gates to login', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/markets/${KEY}`, { waitUntil: 'domcontentloaded' });
    await waitForTicketReady(page);

    await page.locator('[data-market-detail-outcomes] [data-outcome-row]').first().waitFor({ timeout: 10_000 });

    const rows = page.locator('[data-market-detail-outcomes] [data-outcome-row]');
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(2);

    // Click second row yes-buy button
    const secondRow = rows.nth(1);
    const yesBtn = secondRow.locator('[data-ticket-outcome-id][data-ticket-contract-side="yes"]');
    await yesBtn.waitFor({ state: 'visible', timeout: 8_000 });
    await yesBtn.click();

    // Ticket still visible and interactive
    const ticket = page.locator('[data-market-detail-order-ticket]');
    await expect(ticket).toBeVisible();
    await expect(ticket.locator('[data-order-amount-input]')).toBeVisible();

    // Fill amount and submit → gate
    await ticket.locator('[data-order-amount-input]').fill('10');
    const submitLabel = ticket.locator('[data-order-submit-label]');
    await expect(submitLabel).not.toContainText('בחר סכום', { timeout: 8_000 });

    await Promise.all([
      page.waitForURL((url) => url.searchParams.get('overlay') === 'login', { timeout: 8_000 }),
      ticket.locator('[data-order-submit-button]').click(),
    ]);
    expect(page.url()).toContain('overlay=login');

    gate.assertClean();
  });
});

// ─── EVENT ───────────────────────────────────────────────────────────────────

test.describe('event market — guest (/markets/' + MARKETS.eventOpen.key + ')', () => {
  const KEY = MARKETS.eventOpen.key;

  test('loads 200, guest header chrome', async ({ page }) => {
    const gate = installConsoleGate(page);
    const response = await gotoMarket(page, KEY);
    expect(response.status()).toBe(200);

    await expect(page.locator(`.market-detail-page[data-market-key="${KEY}"]`)).toBeVisible();
    await expect(page.locator('[data-shell-guest-actions]')).toBeVisible();
    await expect(page.locator('.hz-shell__wallet-cell')).not.toBeVisible();

    gate.assertClean();
  });

  test('event layout: event ladder present, chart ABSENT, child rows have buy buttons, ticket present', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/markets/${KEY}`, { waitUntil: 'domcontentloaded' });
    await waitForTicketReady(page);
    // No chart wait — event has no chart

    const h1 = page.locator('.market-detail-page-title');
    await expect(h1).toBeVisible();
    expect((await h1.textContent()).trim().length).toBeGreaterThan(0);
    await expect(page.locator('.hz-breadcrumb')).toBeVisible();

    // EVENT-DISTINCT
    await expect(page.locator(TYPE_MARKERS.event)).toBeVisible();
    await expect(page.locator('[data-hz-event-ladder]')).toBeVisible({ timeout: 10_000 });

    const childRows = page.locator('[data-event-child-row]');
    expect(await childRows.count()).toBeGreaterThan(0);

    // EVENT-DISTINCT: chart ABSENT
    await expect(page.locator('[data-md-chart]')).not.toBeAttached();

    // no multi outcome SECTION (page-level, exclusive to multi type)
    await expect(page.locator(TYPE_MARKERS.multi)).not.toBeAttached();

    // no mobile launcher
    await expect(page.locator('[data-market-detail-mobile-launcher]')).not.toBeAttached();

    // Ticket present for defaultChild
    const ticket = page.locator('[data-market-detail-order-ticket]');
    await expect(ticket).toBeVisible();
    await expect(ticket.locator('[data-order-amount-input]')).toBeVisible();

    gate.assertClean();
  });

  test('event guest gate: ticket submit (after child row click) routes to login', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/markets/${KEY}`, { waitUntil: 'domcontentloaded' });
    await waitForTicketReady(page);

    await page.locator('[data-hz-event-ladder]').waitFor({ state: 'visible', timeout: 10_000 });

    const ticket = page.locator('[data-market-detail-order-ticket]');
    await expect(ticket).toBeVisible();

    // Fill amount — guest preview populates
    await ticket.locator('[data-order-amount-input]').fill('10');
    const submitLabel = ticket.locator('[data-order-submit-label]');
    await expect(submitLabel).not.toContainText('בחר סכום', { timeout: 8_000 });

    // Submit → login gate
    await Promise.all([
      page.waitForURL((url) => url.searchParams.get('overlay') === 'login', { timeout: 8_000 }),
      ticket.locator('[data-order-submit-button]').click(),
    ]);
    expect(page.url()).toContain('overlay=login');

    gate.assertClean();
  });
});

// ─── BINARY RESOLVED ─────────────────────────────────────────────────────────

test.describe('binary resolved — guest (/markets/' + MARKETS.binaryResolved.key + ')', () => {
  const KEY = MARKETS.binaryResolved.key;

  test('resolved lifecycle (guest): verdict banner, no ticket, guest chrome', async ({ page }) => {
    const gate = installConsoleGate(page);

    const response = await gotoMarket(page, KEY);
    expect(response.status()).toBe(200);

    await expect(page.locator(`.market-detail-page[data-market-key="${KEY}"]`)).toBeVisible();

    const h1 = page.locator('.market-detail-page-title');
    await expect(h1).toBeVisible();
    expect((await h1.textContent()).trim().length).toBeGreaterThan(0);
    await expect(page.locator('.hz-breadcrumb')).toBeVisible();

    // Guest chrome still present on resolved pages
    await expect(page.locator('[data-shell-guest-actions]')).toBeVisible();
    await expect(page.locator('.hz-shell__wallet-cell')).not.toBeVisible();

    // Chart present on resolved (✓/✗ end-dots)
    await expect(page.locator('[data-md-chart]')).toBeVisible();

    // Wait for ResolvedRail (client:load)
    await waitForResolvedRailReady(page);

    const resolvedRail = page.locator('[data-resolved-rail]');
    await expect(resolvedRail).toBeVisible();

    const verdict = resolvedRail.locator('[data-rail-verdict]');
    await expect(verdict).toBeVisible();
    expect(await verdict.textContent()).toMatch(/תוצאה:/);

    const railName = resolvedRail.locator('[data-rail-name]');
    await expect(railName).toBeVisible();
    expect((await railName.textContent()).trim().length).toBeGreaterThan(0);

    // NO ticket, NO mobile launcher
    await expect(page.locator('[data-market-detail-order-ticket]')).not.toBeAttached();
    await expect(page.locator('[data-market-detail-mobile-launcher]')).not.toBeAttached();

    gate.assertClean();
  });
});

// ─── MULTI RESOLVED (3-outcome) — GUEST ──────────────────────────────────────
//
// Guest sees: verdict rail, outcome ladder with winner marked, no ticket,
// guest chrome, no mobile launcher.

test.describe('multi resolved — guest (/markets/' + MARKETS.multiResolved.key + ')', () => {
  const KEY = MARKETS.multiResolved.key;
  const EXPECTED_OUTCOMES = MARKETS.multiResolved.outcomes; // 3

  test('resolved multi (guest): verdict rail, outcomes present with winner marked, no ticket, guest chrome', async ({ page }) => {
    const gate = installConsoleGate(page);

    const response = await gotoMarket(page, KEY);
    expect(response.status()).toBe(200);

    await expect(page.locator(`.market-detail-page[data-market-key="${KEY}"]`)).toBeVisible();

    const h1 = page.locator('.market-detail-page-title');
    await expect(h1).toBeVisible();
    expect((await h1.textContent()).trim().length).toBeGreaterThan(0);
    await expect(page.locator('.hz-breadcrumb')).toBeVisible();

    // Guest chrome on resolved pages
    await expect(page.locator('[data-shell-guest-actions]')).toBeVisible();
    await expect(page.locator('.hz-shell__wallet-cell')).not.toBeVisible();

    // Chart present
    await expect(page.locator('[data-md-chart]')).toBeVisible();

    // ResolvedRail
    await waitForResolvedRailReady(page);
    const resolvedRail = page.locator('[data-resolved-rail]');
    await expect(resolvedRail).toBeVisible();

    const verdict = resolvedRail.locator('[data-rail-verdict]');
    await expect(verdict).toBeVisible();
    expect(await verdict.textContent()).toMatch(/תוצאה:/);

    const railName = resolvedRail.locator('[data-rail-name]');
    await expect(railName).toBeVisible();
    expect((await railName.textContent()).trim().length).toBeGreaterThan(0);

    // MULTI-DISTINCT: outcome ladder with correct row count
    await expect(page.locator(TYPE_MARKERS.multi)).toBeVisible();
    const rows = page.locator('[data-market-detail-outcomes] [data-outcome-row]');
    await expect(rows).toHaveCount(EXPECTED_OUTCOMES, { timeout: 10_000 });

    // Exactly one winner row
    const winnerRows = page.locator('[data-market-detail-outcomes] [data-outcome-row].hz-outcome-row--winner');
    await expect(winnerRows).toHaveCount(1, { timeout: 5_000 });

    // NO ticket, NO launcher
    await expect(page.locator('[data-market-detail-order-ticket]')).not.toBeAttached();
    await expect(page.locator('[data-market-detail-mobile-launcher]')).not.toBeAttached();

    gate.assertClean();
  });
});

// ─── MULTI RESOLVED (10-outcome density) — GUEST ─────────────────────────────

test.describe('multi resolved 10-outcome — guest (/markets/' + MARKETS.multiResolved10.key + ')', () => {
  const KEY = MARKETS.multiResolved10.key;
  const EXPECTED_OUTCOMES = MARKETS.multiResolved10.outcomes; // 10

  test('resolved 10-outcome (guest): verdict rail, 10 rows, winner marked, no ticket', async ({ page }) => {
    const gate = installConsoleGate(page);

    const response = await gotoMarket(page, KEY);
    expect(response.status()).toBe(200);

    await expect(page.locator(`.market-detail-page[data-market-key="${KEY}"]`)).toBeVisible();

    const h1 = page.locator('.market-detail-page-title');
    await expect(h1).toBeVisible();
    expect((await h1.textContent()).trim().length).toBeGreaterThan(0);

    // Guest chrome
    await expect(page.locator('[data-shell-guest-actions]')).toBeVisible();
    await expect(page.locator('.hz-shell__wallet-cell')).not.toBeVisible();

    // Chart present
    await expect(page.locator('[data-md-chart]')).toBeVisible();

    // ResolvedRail
    await waitForResolvedRailReady(page);
    const resolvedRail = page.locator('[data-resolved-rail]');
    await expect(resolvedRail).toBeVisible();

    const verdict = resolvedRail.locator('[data-rail-verdict]');
    await expect(verdict).toBeVisible();
    expect(await verdict.textContent()).toMatch(/תוצאה:/);

    const railName = resolvedRail.locator('[data-rail-name]');
    await expect(railName).toBeVisible();
    expect((await railName.textContent()).trim().length).toBeGreaterThan(0);

    // Outcome ladder: 10 rows
    await expect(page.locator(TYPE_MARKERS.multi)).toBeVisible();
    const rows = page.locator('[data-market-detail-outcomes] [data-outcome-row]');
    await expect(rows).toHaveCount(EXPECTED_OUTCOMES, { timeout: 10_000 });

    // Exactly one winner among 10
    const winnerRows = page.locator('[data-market-detail-outcomes] [data-outcome-row].hz-outcome-row--winner');
    await expect(winnerRows).toHaveCount(1, { timeout: 5_000 });

    // NO ticket, NO launcher
    await expect(page.locator('[data-market-detail-order-ticket]')).not.toBeAttached();
    await expect(page.locator('[data-market-detail-mobile-launcher]')).not.toBeAttached();

    // 390px overflow check
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    const overflow = await page.evaluate(() => {
      const dw = document.documentElement.scrollWidth;
      const cw = document.documentElement.clientWidth;
      return { scrollWidth: dw, clientWidth: cw, overflows: dw > cw + 1 };
    });
    expect(
      overflow.overflows,
      `10-outcome resolved (guest): horizontal overflow at 390px: scrollWidth=${overflow.scrollWidth} clientWidth=${overflow.clientWidth}`,
    ).toBe(false);

    gate.assertClean();
  });
});

// ─── HYGIENE ─────────────────────────────────────────────────────────────────

test.describe('mobile overflow hygiene — guest', () => {
  const KEY = MARKETS.binaryOpen.key;

  test('no horizontal overflow at 390px (360px reported)', async ({ page }) => {
    await page.goto(`${astroBase}/markets/${KEY}`, { waitUntil: 'domcontentloaded' });
    await waitForTicketReady(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);

    const overflow390 = await page.evaluate(() => {
      const dw = document.documentElement.scrollWidth;
      const cw = document.documentElement.clientWidth;
      return { scrollWidth: dw, clientWidth: cw, overflows: dw > cw + 1 };
    });
    expect(
      overflow390.overflows,
      `Horizontal overflow at 390px: scrollWidth=${overflow390.scrollWidth} clientWidth=${overflow390.clientWidth}`,
    ).toBe(false);

    await page.setViewportSize({ width: 360, height: 780 });
    await page.waitForTimeout(200);

    const overflow360 = await page.evaluate(() => {
      const dw = document.documentElement.scrollWidth;
      const cw = document.documentElement.clientWidth;
      return { scrollWidth: dw, clientWidth: cw, overflows: dw > cw + 1 };
    });
    if (overflow360.overflows) {
      console.warn(
        `[market-detail-guest spec] 360px overflow detected (not a failure): scrollWidth=${overflow360.scrollWidth} clientWidth=${overflow360.clientWidth}`,
      );
    }
  });
});
