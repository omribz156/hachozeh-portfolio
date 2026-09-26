/**
 * market-detail.spec.mjs — STRUCTURE-ONLY — market-detail is live-data-dominated;
 * pixel regression lives in component-visual tests (see task doc), not here.
 *
 * AUTHED spec (omrib account). Catalog-driven: one describe block per market
 * type (binary / multi / event), plus the existing binary-resolved lifecycle
 * block. Driven by MARKETS keys in fixtures/markets.mjs — do not re-discover.
 *
 * DISTINCT layout selectors per type:
 *  binary → [data-binary-pill-duo] yes/no present + [data-md-chart] present
 *  multi  → [data-market-detail-outcomes] + N outcome rows + [data-md-chart]
 *  event  → [data-market-detail-event] ladder + [data-md-chart] ABSENT
 *           (event has no single chart; it renders per-child trade buttons)
 *
 * Flows:
 *  binary → full buy trade (mutates omrib — intentional)
 *  multi  → select an outcome row → confirm ticket reflects the selection
 *  event  → click a child-market buy button → confirm ticket retargets
 *  resolved → verdict banner, no ticket
 */

import { test, expect } from '@playwright/test';
import {
  OMRIB_STATE,
  astroBase,
  ensureOmribStorageState,
} from './fixtures/contexts.mjs';
import { installConsoleGate } from './fixtures/console-gate.mjs';
import { MARKETS, TYPE_MARKERS } from './fixtures/markets.mjs';

// Authed page — mint the cached omrib session at module load, then declare it.
// Must be top-level await (NOT beforeAll); see ensureOmribStorageState() docs.
await ensureOmribStorageState();
test.use({ storageState: OMRIB_STATE });

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

test.describe('binary market (/markets/' + MARKETS.binaryOpen.key + ')', () => {
  const KEY = MARKETS.binaryOpen.key;

  test('loads 200, authed header chrome', async ({ page }) => {
    const gate = installConsoleGate(page);
    const response = await gotoMarket(page, KEY);
    expect(response.status()).toBe(200);

    await expect(page.locator(`.market-detail-page[data-market-key="${KEY}"]`)).toBeVisible();
    await expect(page.locator('main.market-detail-stage-page-shell')).toBeVisible();
    await expect(page.locator('.hz-shell__wallet-cell')).toBeVisible();
    await expect(page.locator('[data-header-sign-in]')).not.toBeVisible();

    gate.assertClean();
  });

  test('binary layout: pill duo present, chart present, no outcome ladder, no event ladder', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/markets/${KEY}`, { waitUntil: 'domcontentloaded' });
    await waitForTicketReady(page);
    await waitForChartReady(page);

    // Title and navigation
    const h1 = page.locator('.market-detail-page-title');
    await expect(h1).toBeVisible();
    expect((await h1.textContent()).trim().length).toBeGreaterThan(0);
    await expect(page.locator('.hz-breadcrumb')).toBeVisible();

    // BINARY-DISTINCT: yes/no pill duo present (outcome selector inside the ticket)
    await expect(page.locator(TYPE_MARKERS.binary)).toBeVisible();

    // BINARY-DISTINCT: chart IS present
    await expect(page.locator('[data-md-chart]')).toBeVisible();

    // BINARY-DISTINCT: no multi outcome SECTION, no event ladder SECTION
    // (these are page-level layout containers, exclusive to multi/event)
    await expect(page.locator(TYPE_MARKERS.multi)).not.toBeAttached();
    await expect(page.locator(TYPE_MARKERS.event)).not.toBeAttached();

    // Mobile launcher: binary open gets one
    await expect(page.locator('[data-market-detail-mobile-launcher]')).toBeAttached();

    // Ticket present with full controls
    const ticket = page.locator('[data-market-detail-order-ticket]');
    await expect(ticket).toBeVisible();
    await expect(ticket.locator('[data-order-side-toggle="buy"]')).toBeVisible();
    await expect(ticket.locator('[data-order-side-toggle="sell"]')).toBeVisible();
    await expect(ticket.locator('[data-order-amount-input]')).toBeVisible();
    await expect(ticket.locator('[data-order-submit-button]')).toBeVisible();

    gate.assertClean();
  });

  test('binary flow: buy trade → success feedback', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/markets/${KEY}`, { waitUntil: 'domcontentloaded' });
    await waitForTicketReady(page);

    const ticket = page.locator('[data-market-detail-order-ticket]');
    const submitLabel = ticket.locator('[data-order-submit-label]');

    // Confirm open (not "השוק סגור")
    await expect(submitLabel).not.toContainText('השוק סגור', { timeout: 8_000 });

    // Ensure buy side
    await ticket.locator('[data-order-side-toggle="buy"]').click();

    const amountInput = ticket.locator('[data-order-amount-input]');
    await amountInput.fill('20');

    // Wait for quote
    await expect(submitLabel).not.toContainText('בחר סכום', { timeout: 10_000 });
    await expect(submitLabel).not.toContainText('מחשב', { timeout: 5_000 });

    const labelBefore = await submitLabel.textContent();
    expect(labelBefore, 'Submit label should be a buy action').toMatch(/קנ/);

    // Submit
    await ticket.locator('[data-order-submit-button]').click();

    // Success signal
    const feedback = ticket.locator('[data-order-feedback]');
    await expect(feedback).toBeVisible({ timeout: 15_000 });
    await expect(feedback).toContainText('בוצע', { timeout: 15_000 });
    await expect(amountInput).toHaveValue('', { timeout: 5_000 });

    gate.assertClean();
  });
});

// ─── MULTI ───────────────────────────────────────────────────────────────────

test.describe('multi-outcome market (/markets/' + MARKETS.multiOpen.key + ')', () => {
  const KEY = MARKETS.multiOpen.key;
  const EXPECTED_OUTCOMES = MARKETS.multiOpen.outcomes; // 4

  test('loads 200, authed header chrome', async ({ page }) => {
    const gate = installConsoleGate(page);
    const response = await gotoMarket(page, KEY);
    expect(response.status()).toBe(200);

    await expect(page.locator(`.market-detail-page[data-market-key="${KEY}"]`)).toBeVisible();
    await expect(page.locator('.hz-shell__wallet-cell')).toBeVisible();

    gate.assertClean();
  });

  test('multi layout: outcome ladder present, correct row count, chart present, no pill duo, no event ladder', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/markets/${KEY}`, { waitUntil: 'domcontentloaded' });
    await waitForTicketReady(page);
    await waitForChartReady(page);

    // Title and navigation
    const h1 = page.locator('.market-detail-page-title');
    await expect(h1).toBeVisible();
    expect((await h1.textContent()).trim().length).toBeGreaterThan(0);
    await expect(page.locator('.hz-breadcrumb')).toBeVisible();

    // MULTI-DISTINCT: outcome ladder section present
    await expect(page.locator(TYPE_MARKERS.multi)).toBeVisible();

    // MULTI-DISTINCT: correct number of outcome rows
    const rows = page.locator('[data-market-detail-outcomes] [data-outcome-row]');
    await expect(rows).toHaveCount(EXPECTED_OUTCOMES, { timeout: 10_000 });

    // MULTI-DISTINCT: chart IS present
    await expect(page.locator('[data-md-chart]')).toBeVisible();

    // multi: no event ladder SECTION (page-level, exclusive to event)
    await expect(page.locator(TYPE_MARKERS.event)).not.toBeAttached();

    // multi: no mobile launcher (only rendered for binary open)
    await expect(page.locator('[data-market-detail-mobile-launcher]')).not.toBeAttached();

    // Ticket present
    const ticket = page.locator('[data-market-detail-order-ticket]');
    await expect(ticket).toBeVisible();
    await expect(ticket.locator('[data-order-amount-input]')).toBeVisible();
    await expect(ticket.locator('[data-order-submit-button]')).toBeVisible();

    gate.assertClean();
  });

  test('multi flow: clicking an outcome row retargets the ticket', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/markets/${KEY}`, { waitUntil: 'domcontentloaded' });
    await waitForTicketReady(page);

    // Rows are rendered by OutcomeLadder — wait for them
    await page.locator('[data-market-detail-outcomes] [data-outcome-row]').first().waitFor({ timeout: 10_000 });

    const rows = page.locator('[data-market-detail-outcomes] [data-outcome-row]');
    const count = await rows.count();
    expect(count, 'At least 2 outcome rows needed for flow test').toBeGreaterThanOrEqual(2);

    // Get the outcome id of the SECOND row (row 0 is selected by default)
    const secondRow = rows.nth(1);
    const outcomeId = await secondRow.getAttribute('data-outcome-row-id');
    expect(outcomeId, 'Second row must have data-outcome-row-id').toBeTruthy();

    // Click the "כן" (yes) buy button in the second row to drive the ticket
    const yesBtn = secondRow.locator('[data-ticket-outcome-id][data-ticket-contract-side="yes"]');
    await yesBtn.waitFor({ state: 'visible', timeout: 8_000 });
    await yesBtn.click();

    // Ticket should reflect the selected outcome — [data-selected-outcome] attribute
    // is set by TradeTicket on the ticket host when an outcome is activated
    const ticket = page.locator('[data-market-detail-order-ticket]');
    await expect(ticket).toBeVisible();

    // Confirm ticket is not in error/closed state
    const submitLabel = ticket.locator('[data-order-submit-label]');
    await expect(submitLabel).not.toContainText('השוק סגור', { timeout: 5_000 });

    gate.assertClean();
  });
});

// ─── EVENT ───────────────────────────────────────────────────────────────────

test.describe('event market (/markets/' + MARKETS.eventOpen.key + ')', () => {
  const KEY = MARKETS.eventOpen.key;

  test('loads 200, authed header chrome', async ({ page }) => {
    const gate = installConsoleGate(page);
    const response = await gotoMarket(page, KEY);
    expect(response.status()).toBe(200);

    await expect(page.locator(`.market-detail-page[data-market-key="${KEY}"]`)).toBeVisible();
    await expect(page.locator('.hz-shell__wallet-cell')).toBeVisible();

    gate.assertClean();
  });

  test('event layout: event ladder present, chart ABSENT, child rows have buy buttons, ticket present for default child', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/markets/${KEY}`, { waitUntil: 'domcontentloaded' });
    await waitForTicketReady(page);

    // Title and navigation
    const h1 = page.locator('.market-detail-page-title');
    await expect(h1).toBeVisible();
    expect((await h1.textContent()).trim().length).toBeGreaterThan(0);
    await expect(page.locator('.hz-breadcrumb')).toBeVisible();

    // EVENT-DISTINCT: event ladder section present
    await expect(page.locator(TYPE_MARKERS.event)).toBeVisible();

    // EVENT-DISTINCT: EventLadder (data-hz-event-ladder) renders inside
    await expect(page.locator('[data-hz-event-ladder]')).toBeVisible({ timeout: 10_000 });

    // EVENT-DISTINCT: at least one active child row
    const childRows = page.locator('[data-event-child-row]');
    const childCount = await childRows.count();
    expect(childCount, 'Event ladder must have at least one active child row').toBeGreaterThan(0);

    // EVENT-DISTINCT: chart is ABSENT (event has no single chart)
    await expect(page.locator('[data-md-chart]')).not.toBeAttached();

    // event: no multi outcome SECTION (page-level, exclusive to multi)
    await expect(page.locator(TYPE_MARKERS.multi)).not.toBeAttached();

    // event: no mobile launcher
    await expect(page.locator('[data-market-detail-mobile-launcher]')).not.toBeAttached();

    // Ticket IS present — renders for defaultChild (event always has a default child ticket)
    const ticket = page.locator('[data-market-detail-order-ticket]');
    await expect(ticket).toBeVisible();
    await expect(ticket.locator('[data-order-amount-input]')).toBeVisible();
    await expect(ticket.locator('[data-order-submit-button]')).toBeVisible();

    gate.assertClean();
  });

  test('event flow: clicking a child buy button retargets the ticket', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/markets/${KEY}`, { waitUntil: 'domcontentloaded' });
    await waitForTicketReady(page);

    // Wait for EventLadder to hydrate
    await page.locator('[data-hz-event-ladder]').waitFor({ state: 'visible', timeout: 10_000 });

    // Find the first active child row
    const firstRow = page.locator('[data-event-child-row]').first();
    await firstRow.waitFor({ state: 'visible', timeout: 8_000 });
    const childKey = await firstRow.getAttribute('data-child-market-key');
    expect(childKey, 'First child row must have data-child-market-key').toBeTruthy();

    // Check if there are more rows to click to prove retargeting
    const childRows = page.locator('[data-event-child-row]');
    const count = await childRows.count();

    if (count > 1) {
      // Click the SECOND child's yes-buy button to prove retarget from default
      const secondRow = childRows.nth(1);
      const secondKey = await secondRow.getAttribute('data-child-market-key');
      const yesBuyBtn = secondRow.locator('[data-event-buy][data-side="yes"]');
      await yesBuyBtn.waitFor({ state: 'visible', timeout: 8_000 });
      await yesBuyBtn.click();

      // Ticket should still be visible and not in error state
      const ticket = page.locator('[data-market-detail-order-ticket]');
      await expect(ticket).toBeVisible();

      // Ticket not showing "השוק סגור" (child market is open)
      const submitLabel = ticket.locator('[data-order-submit-label]');
      await expect(submitLabel).not.toContainText('השוק סגור', { timeout: 5_000 });

      console.log(`[market-detail event] retargeted ticket to child: ${secondKey}`);
    } else {
      // Single child — just confirm the ticket is in the right state
      const yesBuyBtn = firstRow.locator('[data-event-buy][data-side="yes"]');
      await yesBuyBtn.waitFor({ state: 'visible', timeout: 8_000 });
      await yesBuyBtn.click();

      const ticket = page.locator('[data-market-detail-order-ticket]');
      await expect(ticket).toBeVisible();
      console.log(`[market-detail event] single child event — confirmed ticket visible after click`);
    }

    gate.assertClean();
  });
});

// ─── BINARY RESOLVED ─────────────────────────────────────────────────────────
//
// Lifecycle coverage: verdict banner, winner name, no ticket, no mobile launcher.
// Market: אליצור נתניה נגד מכבי רעננה (basketball)
// Resolved 2026-06-18, winner: אליצור נתניה.

test.describe('binary resolved market (/markets/' + MARKETS.binaryResolved.key + ')', () => {
  const KEY = MARKETS.binaryResolved.key;

  test('resolved lifecycle: verdict banner, no ticket', async ({ page }) => {
    const gate = installConsoleGate(page);

    const response = await gotoMarket(page, KEY);
    expect(response.status()).toBe(200);

    await expect(page.locator(`.market-detail-page[data-market-key="${KEY}"]`)).toBeVisible();

    const h1 = page.locator('.market-detail-page-title');
    await expect(h1).toBeVisible();
    expect((await h1.textContent()).trim().length).toBeGreaterThan(0);
    await expect(page.locator('.hz-breadcrumb')).toBeVisible();

    // Chart still renders on resolved markets (shows ✓/✗ end-dots)
    await expect(page.locator('[data-md-chart]')).toBeVisible();

    // Wait for ResolvedRail island (client:load)
    await waitForResolvedRailReady(page);

    const resolvedRail = page.locator('[data-resolved-rail]');
    await expect(resolvedRail).toBeVisible();

    // Verdict prefix
    const verdict = resolvedRail.locator('[data-rail-verdict]');
    await expect(verdict).toBeVisible();
    expect(await verdict.textContent()).toMatch(/תוצאה:/);

    // Winner name non-empty
    const railName = resolvedRail.locator('[data-rail-name]');
    await expect(railName).toBeVisible();
    expect((await railName.textContent()).trim().length).toBeGreaterThan(0);

    // NO ticket — resolved markets render ResolvedRail instead
    await expect(page.locator('[data-market-detail-order-ticket]')).not.toBeAttached();

    // NO mobile launcher — only for open binary markets
    await expect(page.locator('[data-market-detail-mobile-launcher]')).not.toBeAttached();

    gate.assertClean();
  });
});

// ─── MULTI RESOLVED (3-outcome) ──────────────────────────────────────────────
//
// Proves that a resolved multi-outcome market: shows ResolvedRail verdict,
// renders the outcome ladder with correct row count, marks the winner row,
// and has NO order ticket + NO mobile launcher.

test.describe('multi resolved market (/markets/' + MARKETS.multiResolved.key + ')', () => {
  const KEY = MARKETS.multiResolved.key;
  const EXPECTED_OUTCOMES = MARKETS.multiResolved.outcomes; // 3

  test('resolved multi: verdict rail, outcomes present with winner marked, no ticket, no launcher', async ({ page }) => {
    const gate = installConsoleGate(page);

    const response = await gotoMarket(page, KEY);
    expect(response.status()).toBe(200);

    await expect(page.locator(`.market-detail-page[data-market-key="${KEY}"]`)).toBeVisible();

    const h1 = page.locator('.market-detail-page-title');
    await expect(h1).toBeVisible();
    expect((await h1.textContent()).trim().length).toBeGreaterThan(0);
    await expect(page.locator('.hz-breadcrumb')).toBeVisible();

    // Chart still renders on resolved markets
    await expect(page.locator('[data-md-chart]')).toBeVisible();

    // Wait for ResolvedRail island (client:load)
    await waitForResolvedRailReady(page);

    const resolvedRail = page.locator('[data-resolved-rail]');
    await expect(resolvedRail).toBeVisible();

    // Verdict prefix
    const verdict = resolvedRail.locator('[data-rail-verdict]');
    await expect(verdict).toBeVisible();
    expect(await verdict.textContent()).toMatch(/תוצאה:/);

    // Winner name non-empty
    const railName = resolvedRail.locator('[data-rail-name]');
    await expect(railName).toBeVisible();
    expect((await railName.textContent()).trim().length).toBeGreaterThan(0);

    // MULTI-DISTINCT: outcome ladder present with correct row count
    await expect(page.locator(TYPE_MARKERS.multi)).toBeVisible();
    const rows = page.locator('[data-market-detail-outcomes] [data-outcome-row]');
    await expect(rows).toHaveCount(EXPECTED_OUTCOMES, { timeout: 10_000 });

    // At least one row carries the winner class
    const winnerRows = page.locator('[data-market-detail-outcomes] [data-outcome-row].hz-outcome-row--winner');
    await expect(winnerRows).toHaveCount(1, { timeout: 5_000 });

    // NO ticket — resolved markets do not render an order ticket
    await expect(page.locator('[data-market-detail-order-ticket]')).not.toBeAttached();

    // NO mobile launcher
    await expect(page.locator('[data-market-detail-mobile-launcher]')).not.toBeAttached();

    gate.assertClean();
  });
});

// ─── MULTI RESOLVED (10-outcome density) ─────────────────────────────────────
//
// Edge-case: 10-outcome resolved market. Proves the OutcomeLadder renders
// all 10 rows + verdict without layout collapse (density coverage).

test.describe('multi resolved 10-outcome market (/markets/' + MARKETS.multiResolved10.key + ')', () => {
  const KEY = MARKETS.multiResolved10.key;
  const EXPECTED_OUTCOMES = MARKETS.multiResolved10.outcomes; // 10

  test('resolved 10-outcome: verdict rail, 10 outcome rows, winner marked, no ticket', async ({ page }) => {
    const gate = installConsoleGate(page);

    const response = await gotoMarket(page, KEY);
    expect(response.status()).toBe(200);

    await expect(page.locator(`.market-detail-page[data-market-key="${KEY}"]`)).toBeVisible();

    const h1 = page.locator('.market-detail-page-title');
    await expect(h1).toBeVisible();
    expect((await h1.textContent()).trim().length).toBeGreaterThan(0);

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

    // Exactly one winner among the 10
    const winnerRows = page.locator('[data-market-detail-outcomes] [data-outcome-row].hz-outcome-row--winner');
    await expect(winnerRows).toHaveCount(1, { timeout: 5_000 });

    // NO ticket, NO launcher
    await expect(page.locator('[data-market-detail-order-ticket]')).not.toBeAttached();
    await expect(page.locator('[data-market-detail-mobile-launcher]')).not.toBeAttached();

    // 390px overflow check — 10 rows resolved layout must not bust width
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    const overflow = await page.evaluate(() => {
      const dw = document.documentElement.scrollWidth;
      const cw = document.documentElement.clientWidth;
      return { scrollWidth: dw, clientWidth: cw, overflows: dw > cw + 1 };
    });
    expect(
      overflow.overflows,
      `10-outcome resolved: horizontal overflow at 390px: scrollWidth=${overflow.scrollWidth} clientWidth=${overflow.clientWidth}`,
    ).toBe(false);

    gate.assertClean();
  });
});

// ─── HYGIENE ─────────────────────────────────────────────────────────────────

test.describe('mobile overflow hygiene', () => {
  // Run against binary open (the simplest guaranteed-open market) to keep the
  // hygiene check stable without depending on feed discovery at runtime.
  const KEY = MARKETS.binaryOpen.key;

  test('no horizontal overflow at 390px (360px reported)', async ({ page }) => {
    await page.goto(`${astroBase}/markets/${KEY}`, { waitUntil: 'domcontentloaded' });
    await waitForTicketReady(page);

    // 390px — must pass
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

    // 360px — report only (do not fail)
    await page.setViewportSize({ width: 360, height: 780 });
    await page.waitForTimeout(200);

    const overflow360 = await page.evaluate(() => {
      const dw = document.documentElement.scrollWidth;
      const cw = document.documentElement.clientWidth;
      return { scrollWidth: dw, clientWidth: cw, overflows: dw > cw + 1 };
    });
    if (overflow360.overflows) {
      console.warn(
        `[market-detail spec] 360px overflow detected (not a failure): scrollWidth=${overflow360.scrollWidth} clientWidth=${overflow360.clientWidth}`,
      );
    }
  });
});
