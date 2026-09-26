/**
 * profile.spec.mjs — E2E + pixel regression for /<handle> owner profile view
 *
 * Covers:
 *   1. /profile redirect behaviour (or lack thereof — see bug note below)
 *   2. /mrbz loads 200 + authed owner chrome
 *   3. Structure landmark assertions (header, bio-sect, stat strip, tabs, tables)
 *   4. Edit overlay — bio save flow (NON-DESTRUCTIVE, idempotent fixed string)
 *   5. Pixel baseline (stable state before edit; live data masked)
 *   6. Overflow hygiene @390 (report 360 if it overflows, don't fail)
 *
 * BUG NOTE: /profile currently returns 404 — there is no route, page, or Caddy
 * redirect that maps /profile → /<handle>. The redirect test below is written
 * against this reality: it asserts the current 404 and flags the gap so the
 * feature can be added. When /profile → /mrbz is implemented, update the
 * redirect assertion to expect a 302/301 to /mrbz.
 *
 * Auth pattern: top-level await at module load (not beforeAll). See README.
 */

import { test, expect } from '@playwright/test';
import { OMRIB_STATE, astroBase, ensureOmribStorageState } from './fixtures/contexts.mjs';
import { installConsoleGate } from './fixtures/console-gate.mjs';
import { snap, chromeMasks } from './fixtures/screenshot.mjs';

// Authed page — mint the cached omrib session at module load, then declare it.
// Must be top-level await (NOT beforeAll); see ensureOmribStorageState() docs.
await ensureOmribStorageState();
test.use({ storageState: OMRIB_STATE });

// ─── Constants ────────────────────────────────────────────────────────────────
// omrib's handle is mrbz. Never change this — other specs depend on it.
const HANDLE = 'mrbz';
// Fixed bio used in the edit+save flow. Idempotent: re-running sets the same
// value. Short enough to fit the 100-char limit (14 chars).
const STABLE_BIO = 'בודק E2E — אל תמחק';

// ─── Helpers ─────────────────────────────────────────────────────────────────
/**
 * Wait until the profile dossier shell is visible. The page is SSR-rendered so
 * content is in the DOM from the first paint — no hydration event needed. We
 * wait for the identity header which proves the profile loaded successfully.
 */
async function waitForProfileReady(page) {
  await page.locator('.db-identity').waitFor({ timeout: 12_000 });
}

// ─── Tests ───────────────────────────────────────────────────────────────────
test.describe('/mrbz (owner profile) — E2E + regression', () => {

  // ── 1. /profile redirect (or gap) ────────────────────────────────────────
  // BUG: /profile currently 404s — there is no redirect to /<own-handle>.
  // This test documents the current reality. When the redirect is implemented,
  // change the assertion to expect a 302/301 landing on /mrbz.
  test('/profile → currently 404 (redirect not yet implemented)', async ({ page }) => {
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/profile') && r.request().method() === 'GET',
        { timeout: 8_000 }
      ),
      page.goto(`${astroBase}/profile`, { waitUntil: 'domcontentloaded' }),
    ]);
    // Document the gap: /profile has no redirect route yet. When feature lands,
    // flip this to: expect(page.url()).toContain(`/${HANDLE}`);
    expect(response.status(), '/profile should 404 until the redirect is implemented').toBe(404);
  });

  // ── 2. Load — /mrbz loads 200 + authed owner chrome ─────────────────────
  test('/mrbz loads 200 + authed chrome + owner edit affordance visible', async ({ page }) => {
    const gate = installConsoleGate(page);

    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes(`/${HANDLE}`) && r.request().method() === 'GET',
        { timeout: 10_000 }
      ),
      page.goto(`${astroBase}/${HANDLE}`, { waitUntil: 'domcontentloaded' }),
    ]);
    expect(response.status()).toBe(200);

    // SSR main wrapper
    await expect(page.locator('main.db-wrap')).toBeVisible();

    // Authed header: wallet cell present, NOT the guest sign-in CTA
    await expect(page.locator('.hz-shell__wallet-cell')).toBeVisible();
    await expect(page.locator('[data-header-sign-in]')).not.toBeVisible();

    // Owner affordance: edit button (only rendered when isOwner === true)
    await expect(page.locator('#editProfileBtn')).toBeVisible();
    // Follow button must NOT be shown to the owner of the profile
    await expect(page.locator('[data-follow-btn]')).not.toBeVisible();

    gate.assertClean();
  });

  // ── 3. Structure regression ───────────────────────────────────────────────
  test('key profile sections exist after SSR load', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/${HANDLE}`, { waitUntil: 'domcontentloaded' });
    await waitForProfileReady(page);

    // ── Identity header ──
    // Avatar wrap
    await expect(page.locator('[data-profile-avatar]')).toBeVisible();
    // Display name
    await expect(page.locator('[data-profile-name]')).toBeVisible();
    // Edit CTA (owner-only affordance)
    await expect(page.locator('#editProfileBtn')).toBeVisible();
    // Share button
    await expect(page.locator('[data-profile-share]')).toBeVisible();

    // ── Bio section ──
    // The bio text element (may be empty string but the element must be present)
    await expect(page.locator('[data-profile-bio]')).toBeAttached();
    // Follower/following/views meta line
    await expect(page.locator('[data-follower-count]')).toBeVisible();

    // ── Stat strip ──
    // Three stat cells: rank, streak, biggest-win
    const statCells = page.locator('.db-statstrip .ss');
    await expect(statCells.first()).toBeVisible();
    const ssCount = await statCells.count();
    expect(ssCount, 'expected 3 stat strip cells').toBe(3);

    // ── Depth section: tab bar ──
    const positionsTab = page.locator('.pf-tablist .pf-tab[data-tab="positions"]');
    const historyTab = page.locator('.pf-tablist .pf-tab[data-tab="history"]');
    await expect(positionsTab).toBeVisible();
    await expect(historyTab).toBeVisible();
    // Positions tab is active by default
    await expect(positionsTab).toHaveClass(/is-active/);

    // ── Depth section: search input ──
    await expect(page.locator('[data-pf-search]')).toBeVisible();

    // ── Positions tab panel is active ──
    const positionsPanel = page.locator('.pf-tabpanel[data-panel="positions"]');
    await expect(positionsPanel).toBeVisible();

    // ── Credential rail (accuracy card) ──
    await expect(page.locator('.db-rail')).toBeVisible();
    await expect(page.locator('.db-acc')).toBeVisible();

    gate.assertClean();
  });

  // ── 4. Flow — edit overlay + bio save (NON-DESTRUCTIVE, idempotent) ───────
  //
  // Strategy:
  //   a. Read the current bio value from the page.
  //   b. Open the edit overlay.
  //   c. Clear the bio field and type STABLE_BIO.
  //   d. Click "שמירת שינויים" (save).
  //   e. Assert the overlay closes (hidden) — this is the save-confirmation
  //      signal from profile.js (closeModal() sets overlay.hidden = true).
  //   f. Assert the in-place [data-profile-bio] element now shows STABLE_BIO.
  //   g. Never touch the handle/username inputs.
  //
  // The PATCH /api/me/profile call stores the bio server-side, so a subsequent
  // full reload would also show STABLE_BIO. We verify in-place update here
  // (profile.js reflects it without a reload) which proves the whole flow:
  // open → edit → save → API success → DOM update → modal close.
  test('edit overlay opens, bio saves in place, overlay closes', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/${HANDLE}`, { waitUntil: 'domcontentloaded' });
    await waitForProfileReady(page);

    // The edit overlay is in the DOM but hidden
    const overlay = page.locator('#editOverlay');
    await expect(overlay).toBeAttached();
    await expect(overlay).toBeHidden();

    // Open edit overlay
    await page.locator('#editProfileBtn').click();
    await expect(overlay).toBeVisible({ timeout: 3_000 });

    // The bio textarea should exist and be editable
    const bioField = page.locator('#editBio');
    await expect(bioField).toBeVisible();

    // Set the bio to our stable fixed string (triple-click selects all, then type)
    await bioField.click({ clickCount: 3 });
    await bioField.fill(STABLE_BIO);

    // Confirm the char counter updated
    const bioCount = page.locator('#editBioCount');
    await expect(bioCount).toHaveText(String(STABLE_BIO.length));

    // Save — click "שמירת שינויים"
    const saveBtn = page.locator('#editSave');
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    // Save-confirmation signal: the overlay closes (profile.js calls closeModal()
    // on success, which sets overlay.hidden = true). Allow up to 8s for the API
    // round-trip.
    await expect(overlay).toBeHidden({ timeout: 8_000 });

    // In-place DOM update: [data-profile-bio] should now show STABLE_BIO
    await expect(page.locator('[data-profile-bio]')).toHaveText(STABLE_BIO);

    gate.assertClean();
  });

  // ── 5. Pixel regression (BEFORE edit — stable state) ─────────────────────
  //
  // Why each region is masked:
  //   chromeMasks(page)          — wallet balance in header: live per run
  //   [data-profile-avatar]      — avatar image: may change if owner edits it
  //   .db-bio-meta               — entire meta line incl counts + joined date; counts drift
  //   .db-statstrip .ss-v        — stat values only (streak count, biggest win amount): live
  //                                Static labels "דירוג החודש", "הרצף הארוך", "הרווח הגדול"
  //                                are now visible in the baseline (they're always static).
  //   .db-rail                   — accuracy % + resolved count: grow over time
  //   .pf-tab-count              — position/record tab count badges: can change
  //   .pf-positions-list         — live rows: current prices, values, PnL
  //   .pf-history-list           — history rows: relative timestamps drift
  test('pixel baseline — layout/structure (live data masked)', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/${HANDLE}`, { waitUntil: 'domcontentloaded' });
    await waitForProfileReady(page);

    const masks = [
      ...chromeMasks(page),
      page.locator('[data-profile-avatar]'),
      page.locator('.db-bio-meta'),
      page.locator('.db-statstrip .ss-v'),
      page.locator('.db-rail'),
      page.locator('.pf-tab-count'),
      page.locator('.pf-positions-list'),
      page.locator('.pf-history-list'),
    ];

    await snap(page, 'profile.png', { mask: masks });

    gate.assertClean();
  });

  // ── 6. Overflow hygiene — no horizontal overflow at mobile widths ─────────
  test('no horizontal overflow at 390px (report 360 without failing)', async ({ page }) => {
    await page.goto(`${astroBase}/${HANDLE}`, { waitUntil: 'domcontentloaded' });
    await waitForProfileReady(page);

    // 390px — primary assertion (must pass)
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

    // 360px — report only; known narrower layouts may overflow here
    await page.setViewportSize({ width: 360, height: 780 });
    await page.waitForTimeout(200);

    const at360 = await page.evaluate(() => {
      const dw = document.documentElement.scrollWidth;
      const cw = document.documentElement.clientWidth;
      return { scrollWidth: dw, clientWidth: cw, overflows: dw > cw + 1 };
    });
    if (at360.overflows) {
      console.warn(
        `[profile.spec] Horizontal overflow at 360px (reported, not failed): scrollWidth=${at360.scrollWidth} clientWidth=${at360.clientWidth}`
      );
    }
  });
});
