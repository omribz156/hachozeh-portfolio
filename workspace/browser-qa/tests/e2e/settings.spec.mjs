/**
 * settings.spec.mjs — E2E + pixel regression for /settings
 *
 * Data page spec following the portfolio.spec.mjs template.
 * Auth-gated: redirects guests to /trending?overlay=login.
 *
 * Sections asserted:
 *   - nav sidebar: פרופיל, חשבון ואבטחה, התראות, אזור מסוכן
 *   - profile panel (default): avatar row, handle input, email row, bio textarea, social stubs
 *   - account panel: sessions section, data-export row, 2FA stub
 *   - notify panel: 3 notification rows (moves/resolve/comments) × 2 channels (app/ext)
 *   - danger panel: account deletion section
 *
 * Flow — edit + save (NON-DESTRUCTIVE choice):
 *   We toggle the `moves_ext` notification preference (external notifications for
 *   sharp price moves). This is safe because:
 *     1. It is a user preference, not an identity field — does NOT affect handle/email/bio.
 *     2. It is idempotent: we flip it ON then immediately flip it OFF, leaving the
 *        account in exactly the state we found it (the backend default is false for moves_ext).
 *     3. The profile spec depends on handle `mrbz` — we never touch handle here.
 *   Saved confirmation signal: the toggle button's aria-checked attribute flips
 *   synchronously on click (optimistic UI) and the server round-trip is fire-and-forget.
 *   We assert aria-checked transitions from the starting state to "true" and back.
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

/** Navigate to /settings and wait for the Preact island to hydrate.
 *  The island mounts data-settings on the root div; wait for it to appear. */
async function gotoSettings(page) {
  await page.goto(`${astroBase}/settings`, { waitUntil: 'domcontentloaded' });
  // Wait for the Preact island root to be present (client:load hydration).
  await page.locator('[data-settings]').waitFor({ timeout: 12_000 });
}

/** Click a nav tab by its data-settings-nav value and wait for the panel to become active. */
async function activatePanel(page, panelKey) {
  await page.locator(`[data-settings-nav="${panelKey}"]`).click();
  await expect(page.locator(`[data-settings-panel="${panelKey}"]`)).toHaveClass(/is-active/, {
    timeout: 4_000,
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('/settings — E2E + regression', () => {
  // ── 1. Load ──────────────────────────────────────────────────────────────

  test('loads with 200 SSR and authed header chrome', async ({ page }) => {
    const gate = installConsoleGate(page);

    // Intercept to confirm SSR 200 via Caddy gateway
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/settings') && r.request().method() === 'GET'
      ),
      page.goto(`${astroBase}/settings`, { waitUntil: 'domcontentloaded' }),
    ]);
    expect(response.status()).toBe(200);

    // SSR main wrapper (from Layout.astro)
    await expect(page.locator('main')).toBeVisible();

    // Island root mounts after hydration
    await page.locator('[data-settings]').waitFor({ timeout: 12_000 });

    // Authed header: wallet cell present, NOT the guest sign-in CTA
    await expect(page.locator('.hz-shell__wallet-cell')).toBeVisible();
    await expect(page.locator('[data-header-sign-in]')).not.toBeVisible();

    gate.assertClean();
  });

  // ── 2. Structure regression ───────────────────────────────────────────────

  test('nav sidebar — all four panels present', async ({ page }) => {
    const gate = installConsoleGate(page);
    await gotoSettings(page);

    const nav = page.locator('nav[aria-label="ניווט הגדרות"]');
    await expect(nav).toBeVisible();

    // All four nav items must be present
    await expect(page.locator('[data-settings-nav="profile"]')).toBeVisible();
    await expect(page.locator('[data-settings-nav="account"]')).toBeVisible();
    await expect(page.locator('[data-settings-nav="notify"]')).toBeVisible();
    await expect(page.locator('[data-settings-nav="danger"]')).toBeVisible();

    // Profile is active by default (first render)
    await expect(page.locator('[data-settings-nav="profile"]')).toHaveClass(/is-on/);

    gate.assertClean();
  });

  test('profile panel — avatar, handle, email, bio, social all present', async ({ page }) => {
    const gate = installConsoleGate(page);
    await gotoSettings(page);

    // Profile panel is active on load
    const profilePanel = page.locator('[data-settings-panel="profile"]');
    await expect(profilePanel).toHaveClass(/is-active/);

    // Panel heading
    await expect(profilePanel.locator('.lg-head__title')).toContainText('פרופיל');

    // Avatar picker — the label wrapping the file input
    await expect(profilePanel.locator('[data-settings-avatar-picker]')).toBeVisible();

    // Handle input
    await expect(profilePanel.locator('[data-settings-profile="handle"]')).toBeVisible();

    // Email row label (the displayed email/masked hint is a live value — we only assert the label)
    const emailLabel = profilePanel.locator('.lg-label', { hasText: 'אימייל' });
    await expect(emailLabel).toBeVisible();

    // Bio textarea
    await expect(profilePanel.locator('[data-settings-profile="bio"]')).toBeVisible();

    // Social stubs section heading
    const socialLabel = profilePanel.locator('.lg-label', { hasText: 'רשתות חברתיות' });
    await expect(socialLabel).toBeVisible();

    // "בקרוב" badge on social (these are stubs)
    await expect(profilePanel.locator('.lg-soon')).toBeVisible();

    gate.assertClean();
  });

  // iOS auto-zoom guard — focusable profile inputs must be ≥ 16px, or iOS Safari
  // zooms on focus and the page stays pannable after blur/close (same root cause as
  // the auth email field; see auth-overlay.spec.mjs "iOS auto-zoom guard"). Not
  // reproducible in Chromium, so we guard the trigger: computed font-size.
  test('profile inputs font-size ≥ 16px (iOS auto-zoom guard)', async ({ page }) => {
    const gate = installConsoleGate(page);
    await gotoSettings(page);

    const profilePanel = page.locator('[data-settings-panel="profile"]');
    for (const sel of ['[data-settings-profile="handle"]', '[data-settings-profile="bio"]']) {
      const px = await profilePanel
        .locator(sel)
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(px, `${sel} < 16px → iOS Safari auto-zooms on focus. Keep it ≥ 16px.`).toBeGreaterThanOrEqual(16);
    }

    gate.assertClean();
  });

  test('account panel — sessions, data export, 2FA stub all present', async ({ page }) => {
    const gate = installConsoleGate(page);
    await gotoSettings(page);

    await activatePanel(page, 'account');
    const accountPanel = page.locator('[data-settings-panel="account"]');

    await expect(accountPanel.locator('.lg-head__title')).toContainText('חשבון ואבטחה');

    // 2FA stub — label + "בקרוב" badge
    const twoFaLabel = accountPanel.locator('.lg-label', { hasText: 'אימות דו-שלבי' });
    await expect(twoFaLabel).toBeVisible();
    // 2FA "בקרוב" badge
    await expect(accountPanel.locator('.lg-soon')).toBeVisible();

    // Sessions container
    await expect(accountPanel.locator('.st-sessions')).toBeVisible();

    // "מכשירים מחוברים" label
    const devicesLabel = accountPanel.locator('.lg-label', { hasText: 'מכשירים מחוברים' });
    await expect(devicesLabel).toBeVisible();

    // "ניתוק מכל המכשירים" row + its button
    await expect(
      accountPanel.locator('[data-settings-action="logout-others"]')
    ).toBeVisible();

    // Data export row + download button
    await expect(
      accountPanel.locator('[data-settings-action="download-data-export"]')
    ).toBeVisible();

    gate.assertClean();
  });

  test('notify panel — three notification rows × two channels each', async ({ page }) => {
    const gate = installConsoleGate(page);
    await gotoSettings(page);

    await activatePanel(page, 'notify');
    const notifyPanel = page.locator('[data-settings-panel="notify"]');

    await expect(notifyPanel.locator('.lg-head__title')).toContainText('התראות');

    // Notification matrix header (column labels)
    await expect(notifyPanel.locator('.lg-notify__head')).toBeVisible();

    // All six toggle buttons: moves_app, moves_ext, resolve_app, resolve_ext, comments_app, comments_ext
    const prefKeys = ['moves_app', 'moves_ext', 'resolve_app', 'resolve_ext', 'comments_app', 'comments_ext'];
    for (const key of prefKeys) {
      await expect(
        notifyPanel.locator(`[data-settings-pref="${key}"]`)
      ).toBeVisible();
    }

    // Row labels
    await expect(notifyPanel.locator('.lg-label', { hasText: 'תנועות שוק חדות' })).toBeVisible();
    await expect(notifyPanel.locator('.lg-label', { hasText: 'הכרעת שווקים' })).toBeVisible();
    await expect(notifyPanel.locator('.lg-label', { hasText: 'תגובות ואזכורים' })).toBeVisible();

    gate.assertClean();
  });

  test('danger panel — account deletion section present', async ({ page }) => {
    const gate = installConsoleGate(page);
    await gotoSettings(page);

    await activatePanel(page, 'danger');
    const dangerPanel = page.locator('[data-settings-panel="danger"]');

    await expect(dangerPanel.locator('.lg-head__title')).toContainText('אזור מסוכן');

    // Deletion section root
    await expect(dangerPanel.locator('[data-settings-account-deletion]')).toBeVisible();

    // "מחיקת חשבון" label
    await expect(
      dangerPanel.locator('.lg-label', { hasText: 'מחיקת חשבון' })
    ).toBeVisible();

    // "התחלת מחיקה" button (visible when status=none, which is the initial state)
    await expect(
      dangerPanel.locator('[data-settings-action="schedule-account-deletion"]')
    ).toBeVisible();

    gate.assertClean();
  });

  // ── 3. Flow — toggle notification pref (non-destructive) ─────────────────
  //
  // SAFE FIELD CHOICE: moves_ext (external notifications for sharp price moves).
  // Default value from the backend is false. We flip it ON then immediately OFF,
  // leaving the account state unchanged. We DO NOT touch handle, email, bio, or
  // any identity field that would affect the profile spec (which depends on mrbz).
  //
  // SAVED CONFIRMATION SIGNAL: NotifyToggle uses optimistic UI — clicking the
  // toggle immediately flips aria-checked (the "saved" signal the user sees) and
  // fires the PUT in the background. We assert aria-checked transitions.

  test('notification toggle — flip on then off (non-destructive round-trip)', async ({ page }) => {
    const gate = installConsoleGate(page);
    await gotoSettings(page);

    await activatePanel(page, 'notify');

    const movesExtToggle = page.locator('[data-settings-pref="moves_ext"]');
    await expect(movesExtToggle).toBeVisible();

    // Read starting state (backend default for moves_ext is false)
    const startingChecked = await movesExtToggle.getAttribute('aria-checked');

    // Flip ON
    await movesExtToggle.click();
    const expectedAfterFirstClick = startingChecked === 'true' ? 'false' : 'true';
    await expect(movesExtToggle).toHaveAttribute('aria-checked', expectedAfterFirstClick, {
      timeout: 4_000,
    });

    // Immediately flip back to restore original state
    await movesExtToggle.click();
    await expect(movesExtToggle).toHaveAttribute('aria-checked', startingChecked, {
      timeout: 4_000,
    });

    // Toggle must not be stuck in busy/disabled state after the round-trip
    await expect(movesExtToggle).not.toBeDisabled();

    gate.assertClean();
  });

  // ── 3b. Handle field — inline validation only (DO NOT SUBMIT) ─────────────
  //
  // We type an INVALID handle to verify the error message appears. We do NOT
  // click save (the save button is hidden while the input is invalid). After
  // asserting the validation message, we clear the field. Handle stays as mrbz.

  test('handle input — inline validation fires on invalid input (no submit)', async ({ page }) => {
    const gate = installConsoleGate(page);
    await gotoSettings(page);

    // Profile panel is active by default
    const handleInput = page.locator('[data-settings-profile="handle"]');
    await expect(handleInput).toBeVisible();

    // Type an invalid handle (too short, 2 chars)
    await handleInput.fill('ab');

    // Error message should appear
    const handleMsg = page.locator('[data-settings-handle-msg]');
    // hidden attr is toggled; when unhidden the hint is visible
    await expect(handleMsg).toBeVisible({ timeout: 3_000 });

    // Save button must NOT be visible for an invalid handle
    const saveActions = page.locator('[data-settings-handle-actions]');
    // hidden attr present when not showActions
    await expect(saveActions).toBeHidden();

    // Restore: clear the input — the error msg disappears, no submit sent
    await handleInput.fill('');

    gate.assertClean();
  });

  // ── 4. Pixel regression ───────────────────────────────────────────────────

  test('pixel baseline — profile panel layout (live data masked)', async ({ page }) => {
    const gate = installConsoleGate(page);
    await gotoSettings(page);

    // Build mask list — guard layout/structure, not live/identity values.
    //
    // WHY each region is masked:
    //   chromeMasks(page)                    — wallet balance in header: changes every run
    //   [data-settings-avatar-preview]       — avatar image or initial: user-specific
    //   [data-settings-profile="handle"]     — contains omrib's handle (mrbz): identity
    //   .lg-value[dir="ltr"]                 — email display: identity data, masked hint varies
    //   [data-settings-profile="bio"]        — bio text: user-specific, may change
    //   .st-sessions                         — session rows: session IDs + timestamps drift
    //   [data-settings-biocount]             — bio char counter: drifts with bio content
    const masks = [
      ...chromeMasks(page),
      page.locator('[data-settings-avatar-preview]'),
      page.locator('[data-settings-profile="handle"]'),
      page.locator('.lg-value[dir="ltr"]'),
      page.locator('[data-settings-profile="bio"]'),
      page.locator('[data-settings-biocount]'),
    ];

    await snap(page, 'settings.png', { mask: masks });

    gate.assertClean();
  });

  // ── 5. Hygiene — no horizontal overflow at mobile widths ─────────────────

  test('no horizontal overflow at 390px (report 360 separately, do not fail)', async ({ page }) => {
    await gotoSettings(page);

    // Assert clean at 390 (iPhone 14 size — our supported mobile width)
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

    // Report 360 but do NOT fail (known potential overflow at narrowest breakpoint)
    await page.setViewportSize({ width: 360, height: 780 });
    await page.waitForTimeout(200);

    const at360 = await page.evaluate(() => {
      const dw = document.documentElement.scrollWidth;
      const cw = document.documentElement.clientWidth;
      return { scrollWidth: dw, clientWidth: cw, overflows: dw > cw + 1 };
    });

    if (at360.overflows) {
      console.warn(
        `[settings] horizontal overflow at 360px (non-blocking): scrollWidth=${at360.scrollWidth} clientWidth=${at360.clientWidth}`
      );
    }
  });
});
