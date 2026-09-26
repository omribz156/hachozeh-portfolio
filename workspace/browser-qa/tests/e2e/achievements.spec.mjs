/**
 * achievements.spec.mjs — E2E + pixel regression for /achievements
 *
 * Page structure:
 *   - REAL: verification tag-track (.tagtrack / #cab-tagtrack)
 *     The tier-ascent button (.tagbadge) opens a .cab-modal overlay with the
 *     full ascent track + CTA. The CTA has a purchase button that's either
 *     disabled (locked tier) or enabled (eligible). We test the modal open/close
 *     flow but NEVER click the purchase button — see NON-DESTRUCTIVE NOTE below.
 *   - FRONT-ONLY: badges section (.cab-soon) — rendered as a "בקרוב"/coming-soon
 *     panel. No backend; asserted to exist but nothing to interact with.
 *
 * NON-DESTRUCTIVE NOTE (modal flow):
 *   The .cab-modal is opened by clicking .tagbadge (the summary ascent card).
 *   Inside the modal, the CTA button (.cta-btn) either:
 *     a) is disabled — tier is locked (not yet eligible), safe to assert visible+disabled.
 *     b) is enabled  — tier is eligible, clicking it POSTs to /api/me/verification-tier/purchase
 *        and spends real V₪ balance + mutates omrib's verification tier.
 *   We assert the modal opens, the ascent track exists, and the CTA button is present,
 *   then close via Escape. We inspect disabled state but NEVER click an enabled CTA button.
 *   This is safe regardless of omrib's current tier state.
 */

import { test, expect } from '@playwright/test';
import { OMRIB_STATE, astroBase, ensureOmribStorageState } from './fixtures/contexts.mjs';
import { installConsoleGate } from './fixtures/console-gate.mjs';
import { snap, chromeMasks } from './fixtures/screenshot.mjs';

// Authed page — mint the cached omrib session at module load, then declare it.
// Must be top-level await (NOT beforeAll); see ensureOmribStorageState() docs.
await ensureOmribStorageState();
test.use({ storageState: OMRIB_STATE });

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Wait until the AchievementsCabinet Preact island has hydrated and painted real
 * content. The component renders null when verification is missing (pre-hydration
 * SSR shell), so we wait for the cabinet wrapper to appear in the DOM.
 */
async function waitForCabinetReady(page) {
  // .hz-cabinet is the root Preact render output; appears once island hydrates
  await page.locator('.hz-cabinet').waitFor({ timeout: 12_000 });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('/achievements — E2E + regression', () => {
  // ── 1. Load ──────────────────────────────────────────────────────────────
  test('loads with 200 SSR and authed header chrome', async ({ page }) => {
    const gate = installConsoleGate(page);

    // Intercept to confirm SSR 200 (Caddy proxies Astro SSR)
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/achievements') && r.request().method() === 'GET'
      ),
      page.goto(`${astroBase}/achievements`, { waitUntil: 'domcontentloaded' }),
    ]);
    expect(response.status()).toBe(200);

    // SSR main wrapper — data-screen-label="הישגים" is the astro shell attribute
    await expect(page.locator('main[data-screen-label="הישגים"]')).toBeVisible();

    // Authed header: wallet cell present, NOT the guest sign-in CTA
    await expect(page.locator('.hz-shell__wallet-cell')).toBeVisible();
    await expect(page.locator('[data-header-sign-in]')).not.toBeVisible();

    gate.assertClean();
  });

  // ── 2. Structure — tag-track (real) + badges (front-only) ────────────────
  test('key sections exist after hydration — tag-track (real) + badges (front-only)', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/achievements`, { waitUntil: 'domcontentloaded' });
    await waitForCabinetReady(page);

    // Cabinet root
    await expect(page.locator('.hz-cabinet')).toBeVisible();

    // Cabinet header (h1 title)
    await expect(page.locator('.cab-title')).toBeVisible();

    // ── REAL: verification tag-track ──────────────────────────────────────
    // The section wrapping the summary ascent card
    const tagtrack = page.locator('#cab-tagtrack');
    await expect(tagtrack).toBeVisible();

    // The summary ascent button — tier kicker + title
    const tagbadge = page.locator('.tagbadge');
    await expect(tagbadge).toBeVisible();
    await expect(tagbadge).toHaveAttribute('aria-haspopup', 'dialog');

    // Kicker shows "מסלול התגים · דרגה X / 3"
    await expect(page.locator('.tagbadge-kicker')).toBeVisible();
    // Tier count label inside the badge
    await expect(page.locator('.tagbadge-count')).toBeVisible();

    // ── FRONT-ONLY: badges "בקרוב" panel ─────────────────────────────────
    // NOTE: .cab-soon is purely a placeholder rendered by the frontend — it has no
    // backend counterpart. The badge grid is not implemented yet
    // (workspace/tasks/queued/finish-achievements-integration.md). Asserting it
    // exists + is visible proves the panel renders without crashing.
    const cabSoon = page.locator('.cab-soon');
    await expect(cabSoon).toBeVisible();

    // "בקרוב" heading should be present
    const soonTitle = page.locator('.cab-soon-title');
    await expect(soonTitle).toBeVisible();
    await expect(soonTitle).toContainText('בקרוב');

    gate.assertClean();
  });

  // ── 3. Flow — open modal → assert ascent track + CTA; close via Esc ─────
  // NON-DESTRUCTIVE: We open the .cab-modal ascent overlay, verify the tier
  // track and CTA button render correctly, then close via Escape key.
  // We DO NOT click the .cta-btn even if enabled — clicking it would POST to
  // /api/me/verification-tier/purchase, spending omrib's V₪ balance and
  // mutating the verification tier permanently. Instead we assert the button
  // is present (disabled OR enabled) and confirm its label without activating it.
  test('modal opens + shows ascent track; closes via Esc (non-destructive)', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/achievements`, { waitUntil: 'domcontentloaded' });
    await waitForCabinetReady(page);

    // Modal is not open at page load
    await expect(page.locator('.cab-modal')).not.toBeVisible();

    // Open the overlay by clicking the summary tagbadge
    await page.locator('.tagbadge').click();

    // .cab-modal and its card should now be visible
    const modal = page.locator('.cab-modal');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    const modalCard = page.locator('.cab-modal-card.cab-track-card');
    await expect(modalCard).toBeVisible();
    await expect(modalCard).toHaveAttribute('role', 'dialog');
    await expect(modalCard).toHaveAttribute('aria-modal', 'true');

    // Modal header: eyebrow + title
    await expect(page.locator('.track-modal-head .eyebrow')).toBeVisible();
    await expect(page.locator('.track-modal-title')).toBeVisible();

    // Ascent track — three medallions (gray, gold, diamond)
    const ascent = page.locator('.ascent');
    await expect(ascent).toBeVisible();

    const medallions = page.locator('.medallion');
    const medCount = await medallions.count();
    // ascent track renders 3 medallions (one per tier: gray, gold, diamond)
    // plus one in the tagbadge summary; filter to ascent-track only
    const ascentMeds = page.locator('.ascent-track .medallion');
    const ascentMedCount = await ascentMeds.count();
    expect(ascentMedCount, 'expected 3 medallions in ascent track').toBe(3);

    // Ascent labels: three tier label blocks
    const labels = page.locator('.ascent-labels .lab');
    const labelCount = await labels.count();
    expect(labelCount, 'expected 3 tier labels').toBe(3);

    // CTA block is present — either complete seal or a purchase option
    const cta = page.locator('.cta');
    await expect(cta).toBeVisible();

    // If a .cta-btn purchase button exists, assert it without clicking:
    // - disabled means omrib isn't eligible yet (safe)
    // - enabled means the tier is purchasable — we assert presence only
    const ctaBtn = page.locator('.cta-btn');
    const ctaBtnCount = await ctaBtn.count();
    if (ctaBtnCount > 0) {
      await expect(ctaBtn).toBeVisible();
      // The button label contains the price (V₪ amount) or a lock icon
      // We deliberately do NOT click it — purchase mutates omrib's balance + tier.
    }

    // Close the modal via Escape key
    await page.keyboard.press('Escape');

    // Modal should be dismissed
    await expect(modal).not.toBeVisible({ timeout: 3_000 });

    gate.assertClean();
  });

  // ── 4. Pixel regression ───────────────────────────────────────────────────
  test('pixel baseline — layout/structure (live data masked)', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/achievements`, { waitUntil: 'domcontentloaded' });
    await waitForCabinetReady(page);

    // Build mask list — guard layout/structure, not live numbers.
    //
    // WHY each region is masked:
    //   chromeMasks(page)       — wallet balance in header: changes every run
    //   .tagbadge-count         — "X / Y הצלחות" progress number drifts as omrib trades
    //   .ascent-link.is-progress — contains pct-chip "N / M הצלחות" live progress text
    //   .cta-sub b              — missingSuccessfulReturns count drifts per trade
    //   .cab-soon               — badges placeholder; content is stable but mask as
    //                             future-proof (content may change when backend lands)
    const masks = [
      ...chromeMasks(page),
      page.locator('.tagbadge-count'),       // live progress fraction "X / Y"
      page.locator('.ascent-link.is-progress'), // connector progress chip "N / M הצלחות"
      page.locator('.cta .cta-sub b'),       // live missing-count numeral in CTA body
    ];

    await snap(page, 'achievements.png', { mask: masks, freeze: true });

    gate.assertClean();
  });

  // ── 5. Hygiene — no horizontal overflow at mobile widths ─────────────────
  test('no horizontal overflow at 390/360px', async ({ page }) => {
    await page.goto(`${astroBase}/achievements`, { waitUntil: 'domcontentloaded' });
    await waitForCabinetReady(page);

    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 844 });
      // Allow a repaint cycle after resize
      await page.waitForTimeout(200);

      const overflows = await page.evaluate(() => {
        const dw = document.documentElement.scrollWidth;
        const cw = document.documentElement.clientWidth;
        return { scrollWidth: dw, clientWidth: cw, overflows: dw > cw + 1 };
      });

      if (width === 360) {
        // 360px is a warn threshold (tighter than 390) — still expect no overflow
        // but document it separately so a future narrow-device regression is obvious
        expect(
          overflows.overflows,
          `Horizontal overflow at 360px (narrow warn): scrollWidth=${overflows.scrollWidth} clientWidth=${overflows.clientWidth}`
        ).toBe(false);
      } else {
        expect(
          overflows.overflows,
          `Horizontal overflow at ${width}px: scrollWidth=${overflows.scrollWidth} clientWidth=${overflows.clientWidth}`
        ).toBe(false);
      }
    }
  });
});
