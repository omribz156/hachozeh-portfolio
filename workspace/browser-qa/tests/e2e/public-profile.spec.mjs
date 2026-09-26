/**
 * public-profile.spec.mjs — E2E + pixel regression for /<handle> GUEST (public) view
 *
 * Covers:
 *   1. /mrbz loads 200 + guest chrome (sign-in CTA present, wallet hidden)
 *   2. Structure landmark assertions (header, stat strip, tabs, tables, follow btn)
 *   3. Tab switch (positions↔history) works for guests
 *   4. Public-vs-owner distinction: follow button IS visible, edit CTA is NOT
 *   5. Flow — click follow → auth overlay (navi-overlay-panel) opens (guest cannot
 *      follow without signing in; profile-follow.js calls NaviOverlays.open("login"))
 *   6. Pixel baseline (masked live data)
 *   7. Overflow hygiene @390 (report 360 if it overflows, don't fail)
 *
 * GUEST context: NO storageState — uses the default Playwright context.
 * Do NOT import or call ensureOmribStorageState / OMRIB_STATE here.
 *
 * FIXED 2026-06-24 (tab handler now works for guests):
 *   profile.js used to bail at `if (!overlay) return;` when #editOverlay was absent
 *   (owner-only), skipping the tab/sort/search/share wiring for guest views. The
 *   guest-safe interactions are now wired up front (wireProfileTables/wireShare),
 *   before the owner-only guard — so the tab-switch flow (test 3) is asserted here
 *   rather than omitted.
 */

import { test, expect } from '@playwright/test';
import { astroBase } from './fixtures/contexts.mjs';
import { installConsoleGate } from './fixtures/console-gate.mjs';
import { snap, chromeMasks } from './fixtures/screenshot.mjs';

// ─── Constants ────────────────────────────────────────────────────────────────
// Data-rich handle used for all profile E2E specs. Never change.
const HANDLE = 'mrbz';

// ─── Helpers ─────────────────────────────────────────────────────────────────
/**
 * Wait until the profile dossier identity header is visible.
 * The page is SSR-rendered so .db-identity (a <header> element) is present
 * immediately after domcontentloaded — no hydration event needed.
 */
async function waitForProfileReady(page) {
  await page.locator('main.db-wrap').waitFor({ timeout: 12_000 });
}

// ─── Tests ───────────────────────────────────────────────────────────────────
test.describe('/mrbz (PUBLIC guest profile) — E2E + regression', () => {

  // ── 1. Load — /mrbz loads 200 + guest chrome ─────────────────────────────
  test('/mrbz loads 200 + guest chrome + follow btn present + edit CTA absent', async ({ page }) => {
    const gate = installConsoleGate(page);

    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes(`/${HANDLE}`) && r.request().method() === 'GET',
        { timeout: 10_000 }
      ),
      page.goto(`${astroBase}/${HANDLE}`, { waitUntil: 'domcontentloaded' }),
    ]);
    expect(response.status()).toBe(200);

    // SSR main wrapper present
    await expect(page.locator('main.db-wrap')).toBeVisible();

    // Guest header chrome:
    //   Sign-in CTA is visible (the ghost "התחברות" link in the header)
    //   Selector: .hz-shell__cta links with data-overlay-open="login" or "signup"
    await expect(page.locator('a.hz-shell__cta[data-overlay-open="login"]')).toBeVisible();
    //   Wallet cell exists in DOM but is NOT visible to guests
    await expect(page.locator('.hz-shell__wallet-cell')).not.toBeVisible();

    // PUBLIC-vs-OWNER distinction:
    //   Follow button IS rendered for guests visiting another user's profile.
    //   profile-follow.js adds the click handler separately from profile.js.
    await expect(page.locator('[data-follow-btn]')).toBeVisible();
    //   Edit CTA is only rendered when isOwner === true — completely absent for guests
    await expect(page.locator('#editProfileBtn')).not.toBeAttached();

    gate.assertClean();
  });

  // ── 2. Structure regression ───────────────────────────────────────────────
  test('key public profile sections exist after SSR load', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/${HANDLE}`, { waitUntil: 'domcontentloaded' });
    await waitForProfileReady(page);

    // ── Identity header ──
    await expect(page.locator('[data-profile-avatar]')).toBeVisible();
    await expect(page.locator('[data-profile-name]')).toBeVisible();
    // Follow button is the public-facing social affordance
    await expect(page.locator('[data-follow-btn]')).toBeVisible();
    // Share button
    await expect(page.locator('[data-profile-share]')).toBeVisible();
    // Edit CTA is completely absent in the guest render (not just hidden)
    await expect(page.locator('#editProfileBtn')).not.toBeAttached();

    // ── Bio / meta ──
    // Bio element must be in DOM (may be empty string but element must exist)
    await expect(page.locator('[data-profile-bio]')).toBeAttached();
    await expect(page.locator('[data-follower-count]')).toBeVisible();

    // ── Stat strip ──
    const statCells = page.locator('.db-statstrip .ss');
    await expect(statCells.first()).toBeVisible();
    const ssCount = await statCells.count();
    expect(ssCount, 'expected 3 stat strip cells').toBe(3);

    // ── Depth section: tab bar ──
    const positionsTab = page.locator('.pf-tablist .pf-tab[data-tab="positions"]');
    const historyTab = page.locator('.pf-tablist .pf-tab[data-tab="history"]');
    await expect(positionsTab).toBeVisible();
    await expect(historyTab).toBeVisible();
    // Positions tab is active by default (SSR-rendered class)
    await expect(positionsTab).toHaveClass(/is-active/);

    // ── Depth section: search input ──
    await expect(page.locator('[data-pf-search]')).toBeVisible();

    // ── Positions tab panel is active ──
    const positionsPanel = page.locator('.pf-tabpanel[data-panel="positions"]');
    await expect(positionsPanel).toBeVisible();

    // ── History tab panel exists but is not active ──
    const historyPanel = page.locator('.pf-tabpanel[data-panel="history"]');
    await expect(historyPanel).toBeAttached();
    await expect(historyPanel).not.toBeVisible();

    // ── Credential rail ──
    await expect(page.locator('.db-rail')).toBeVisible();
    await expect(page.locator('.db-acc')).toBeVisible();

    gate.assertClean();
  });

  // ── 3. Tab switch — positions↔history toggles for guests ──────────────────
  //
  // Regression guard for the bug where profile.js bailed on the owner-only
  // #editOverlay and never wired the tabs for guests. The wiring now runs up
  // front (wireProfileTables), independent of the edit overlay.
  test('tab switch positions↔history works for guest', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/${HANDLE}`, { waitUntil: 'domcontentloaded' });
    await waitForProfileReady(page);

    const positionsTab = page.locator('.pf-tablist .pf-tab[data-tab="positions"]');
    const historyTab = page.locator('.pf-tablist .pf-tab[data-tab="history"]');
    const positionsPanel = page.locator('.pf-tabpanel[data-panel="positions"]');
    const historyPanel = page.locator('.pf-tabpanel[data-panel="history"]');

    // Default (SSR) state: positions active, history hidden
    await expect(positionsPanel).toBeVisible();
    await expect(historyPanel).not.toBeVisible();

    // Click history → it activates, positions hides. Wrapped in toPass so the
    // assertion retries if profile.js hasn't attached its listener for the first
    // click yet (no explicit ready signal on the page script).
    await expect(async () => {
      await historyTab.click();
      await expect(historyPanel).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 8_000 });
    await expect(historyTab).toHaveClass(/is-active/);
    await expect(positionsPanel).not.toBeVisible();

    // Click positions → back to the default state
    await positionsTab.click();
    await expect(positionsPanel).toBeVisible();
    await expect(positionsTab).toHaveClass(/is-active/);
    await expect(historyPanel).not.toBeVisible();

    gate.assertClean();
  });

  // ── 4. Flow — follow button → auth overlay (guest cannot follow) ──────────
  //
  // profile-follow.js: when data-viewer-authed="false", a guest's click calls
  // NaviOverlays.open("login") which pushes ?overlay=login to the URL and
  // renders the auth dialog (section.navi-overlay-panel[role="dialog"]).
  // This is the correct guest UX: sign in to follow.
  test('follow button click opens login auth overlay for guest', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/${HANDLE}`, { waitUntil: 'domcontentloaded' });
    await waitForProfileReady(page);

    // profile-follow.js loads as a separate script from profile.js.
    // Wait for it to wire the click handler (it's an is:inline src= script).
    await page.waitForFunction(
      () => document.querySelector('[data-follow-btn]') !== null,
      { timeout: 5_000 }
    );

    const followBtn = page.locator('[data-follow-btn]');
    await expect(followBtn).toBeVisible();

    // Verify it's a guest button (data-viewer-authed="false")
    await expect(followBtn).toHaveAttribute('data-viewer-authed', 'false');

    // Click follow — guest path: NaviOverlays.open("login") → overlay appears
    await followBtn.click();

    // The overlay panel appears as section.navi-overlay-panel[role="dialog"]
    // URL also gains ?overlay=login, confirming the overlay opened
    await page.waitForURL(/\?overlay=login/, { timeout: 5_000 });
    const authPanel = page.locator('section.navi-overlay-panel[role="dialog"]');
    await expect(authPanel).toBeVisible({ timeout: 5_000 });

    gate.assertClean();
  });

  // ── 4. Pixel regression ───────────────────────────────────────────────────
  //
  // Why each region is masked:
  //   chromeMasks(page)          — wallet cell (hidden for guest, harmless to mask)
  //   [data-profile-avatar]      — avatar image: may change
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

    await snap(page, 'public-profile.png', { mask: masks });

    gate.assertClean();
  });

  // ── 5. Overflow hygiene — no horizontal overflow at mobile widths ─────────
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
        `[public-profile.spec] Horizontal overflow at 360px (reported, not failed): scrollWidth=${at360.scrollWidth} clientWidth=${at360.clientWidth}`
      );
    }
  });
});
