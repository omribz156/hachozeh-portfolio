/**
 * idea-overlay.spec.mjs — E2E + pixel regression for the IDEA / feedback overlay
 *
 * The idea overlay is an authed modal surface accessible via:
 *   • ?overlay=idea on any page (used here — no menu-nav required)
 *   • hamburger menu → "יש לכם רעיון?" (userOnly item)
 *
 * Flow coverage:
 *   1. Open — authed goto trending?overlay=idea → panel visible
 *   2. Structure — type cards, detail textarea, attach toggle, submit button
 *   3. Interaction — type switch, draft text entry, attach toggle
 *   4. Validation — submit with <4 chars triggers inline error (no mock needed)
 *   5. Submit → thank-you (MOCKED) — POST /api/feedback → 201 → .idea-sent visible
 *   6. Dismiss via "סגירה" button and backdrop click
 *   7. Pixel regression — element screenshot of the panel in initial state
 *   8. Hygiene — console gate clean
 *
 * The /api/feedback endpoint is MOCKED with a 201 in the submit test.
 * The thank-you path is currently UNVERIFIED in prod — this spec is the first
 * coverage of it. The mock uses the real route so integration will break loudly
 * if the endpoint path changes.
 *
 * NOTE: No email field exists by design — the overlay sends as the authenticated
 * user (identity shown in .idea-sender). This spec asserts that fact.
 */

import { test, expect } from '@playwright/test';
import { OMRIB_STATE, astroBase, ensureOmribStorageState } from './fixtures/contexts.mjs';
import { installConsoleGate } from './fixtures/console-gate.mjs';
import { stabilize } from './fixtures/screenshot.mjs';

// Authed page — mint the cached omrib session at module load, then declare it.
// Must be top-level await (NOT beforeAll); see ensureOmribStorageState() docs.
await ensureOmribStorageState();
test.use({ storageState: OMRIB_STATE });

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Navigate to trending?overlay=idea and wait for the overlay panel to mount. */
async function openIdeaOverlay(page) {
  await page.goto(`${astroBase}/trending?overlay=idea`, { waitUntil: 'domcontentloaded' });
  // The Preact island renders the panel inside .navi-overlay-root[data-overlay="idea"].
  // Wait for the panel itself — it only mounts once the island hydrates + overlay is active.
  await page.locator('.navi-overlay-panel--idea').waitFor({ timeout: 12_000 });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('idea overlay — E2E + regression', () => {
  // ── 1. Open ────────────────────────────────────────────────────────────────

  test('opens for authed user via ?overlay=idea', async ({ page }) => {
    const gate = installConsoleGate(page);
    await openIdeaOverlay(page);

    // The overlay root must be active with overlay="idea"
    const root = page.locator('[data-page-overlay-root]');
    await expect(root).toHaveAttribute('data-active', 'true');
    await expect(root).toHaveAttribute('data-overlay', 'idea');

    // The panel section must be visible with role="dialog"
    const panel = page.locator('.navi-overlay-panel--idea');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('role', 'dialog');
    await expect(panel).toHaveAttribute('aria-modal', 'true');

    gate.assertClean();
  });

  // ── 2. Structure ───────────────────────────────────────────────────────────

  test('form structure: type cards, fields, attach, submit, sender — no email field', async ({ page }) => {
    const gate = installConsoleGate(page);
    await openIdeaOverlay(page);

    const panel = page.locator('.navi-overlay-panel--idea');

    // Header
    await expect(panel.locator('.idea-title')).toBeVisible();
    await expect(panel.locator('.idea-title')).toHaveText('עזרו לנו לבנות את החוזה');

    // Type card switcher (tablist)
    const typelist = panel.locator('.idea-typecards[role="tablist"]');
    await expect(typelist).toBeVisible();
    await expect(typelist.locator('[data-idea-type="idea"]')).toBeVisible();
    await expect(typelist.locator('[data-idea-type="bug"]')).toBeVisible();
    await expect(typelist.locator('[data-idea-type="feedback"]')).toBeVisible();

    // "idea" type active by default
    await expect(typelist.locator('[data-idea-type="idea"]')).toHaveClass(/is-active/);

    // Detail textarea
    await expect(panel.locator('textarea[data-idea-msg]')).toBeVisible();

    // Attach / clip button
    await expect(panel.locator('button[data-idea-attach]')).toBeVisible();

    // Submit button
    const submitBtn = panel.locator('button[data-idea-submit]');
    await expect(submitBtn).toBeVisible();
    await expect(submitBtn).toHaveText('שליחת המשוב');

    // Sender badge — identity, not an email input
    await expect(panel.locator('.idea-sender')).toBeVisible();
    // No <input type="email"> anywhere in the panel — identity comes from the session
    const emailInputs = panel.locator('input[type="email"]');
    await expect(emailInputs).toHaveCount(0);

    gate.assertClean();
  });

  // ── 3. Interaction: type switch, text entry, attach toggle ─────────────────

  test('type switch, draft entry, auto-grow, attach toggle', async ({ page }) => {
    const gate = installConsoleGate(page);
    await openIdeaOverlay(page);

    const panel = page.locator('.navi-overlay-panel--idea');
    const textarea = panel.locator('textarea[data-idea-msg]');
    const attachBtn = panel.locator('button[data-idea-attach]');

    // ── Type switch: idea → bug ──────────────────────────────────────────────
    const bugCard = panel.locator('[data-idea-type="bug"]');
    await bugCard.click();
    // Bug becomes active, idea becomes inactive
    await expect(bugCard).toHaveClass(/is-active/);
    await expect(panel.locator('[data-idea-type="idea"]')).not.toHaveClass(/is-active/);
    // Placeholder changes to the bug-specific text
    await expect(textarea).toHaveAttribute('placeholder', 'מה ניסית לעשות, ומה קרה במקום?');

    // ── Type switch: bug → feedback ──────────────────────────────────────────
    const feedbackCard = panel.locator('[data-idea-type="feedback"]');
    await feedbackCard.click();
    await expect(feedbackCard).toHaveClass(/is-active/);
    await expect(bugCard).not.toHaveClass(/is-active/);

    // ── Text entry + auto-grow ───────────────────────────────────────────────
    await textarea.click();
    const initialHeight = await textarea.evaluate((el) => el.offsetHeight);
    const longText = 'זה רעיון מצוין לפיצ׳ר חדש שיעזור למשתמשים להבין טוב יותר את הנתונים.\n'
      + 'חשוב לנו שהממשק יהיה נגיש וקל לשימוש לכולם.';
    await textarea.fill(longText);
    await textarea.dispatchEvent('input'); // trigger auto-grow
    // textarea must have accepted the text
    await expect(textarea).toHaveValue(longText);
    // height must have grown (auto-grow)
    const grownHeight = await textarea.evaluate((el) => el.offsetHeight);
    expect(grownHeight, 'textarea must grow taller after multi-line input').toBeGreaterThan(initialHeight);

    // ── Attach toggle ────────────────────────────────────────────────────────
    await expect(attachBtn).not.toHaveClass(/has-file/);
    await attachBtn.click();
    await expect(attachBtn).toHaveClass(/has-file/);
    // Toggle back off
    await attachBtn.click();
    await expect(attachBtn).not.toHaveClass(/has-file/);

    gate.assertClean();
  });

  // ── 4. Validation: short message shows inline error ────────────────────────

  test('submit with <4 chars triggers inline error, not network request', async ({ page }) => {
    const gate = installConsoleGate(page);
    await openIdeaOverlay(page);

    const panel = page.locator('.navi-overlay-panel--idea');
    const textarea = panel.locator('textarea[data-idea-msg]');
    const errorEl = panel.locator('[data-idea-error]');

    // Track whether any POST /api/feedback fires — it must NOT
    let feedbackCalled = false;
    await page.route('**/api/feedback', (route) => {
      feedbackCalled = true;
      route.continue();
    });

    // Type 3 chars (below 4-char minimum)
    await textarea.fill('אבג');
    await panel.locator('button[data-idea-submit]').click();

    // Error element must gain is-shown
    await expect(errorEl).toHaveClass(/is-shown/);

    // No network request must have fired
    expect(feedbackCalled, 'POST /api/feedback must NOT fire for short message').toBe(false);

    gate.assertClean();
  });

  // ── 5. Submit → thank-you (MOCKED) ────────────────────────────────────────
  //
  // The real endpoint is POST /api/feedback (absolute URL built from
  // NaviAuthSession.getBackendBaseUrl() + '/api/feedback'). The page.route
  // glob '**/api/feedback' matches both http://127.0.0.1:3001/api/feedback
  // and the Caddy-proxied http://127.0.0.1:6969/api/feedback.
  //
  // This path is currently UNVERIFIED in prod — the mock makes the thank-you
  // state reachable without a live backend round-trip.

  test('valid submit → POST /api/feedback → 201 → thank-you state (MOCKED)', async ({ page }) => {
    const gate = installConsoleGate(page);
    await openIdeaOverlay(page);

    // Mock the feedback endpoint BEFORE filling the form.
    let capturedBody = null;
    await page.route('**/api/feedback', async (route) => {
      const req = route.request();
      capturedBody = req.postData();
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: '{}',
      });
    });

    const panel = page.locator('.navi-overlay-panel--idea');

    // Switch to "bug" to prove the type is sent correctly
    await panel.locator('[data-idea-type="bug"]').click();

    // Fill a valid message (≥ 4 chars)
    const titleInput = panel.locator('input[data-idea-title]');
    const textarea = panel.locator('textarea[data-idea-msg]');
    await titleInput.fill('בעיה בגרף');
    await textarea.fill('הגרף לא מתעדכן כשמחליפים טווח זמן.');

    // Click submit — the mock intercepts, returns 201
    const submitBtn = panel.locator('button[data-idea-submit]');
    await submitBtn.click();

    // The thank-you screen must appear
    const sentEl = panel.locator('.idea-sent');
    await expect(sentEl).toBeVisible({ timeout: 6_000 });
    await expect(panel.locator('.idea-sent__title')).toHaveText('המשוב נשלח');
    await expect(panel.locator('.idea-sent__body')).toBeVisible();

    // Action buttons on the success screen
    await expect(panel.locator('button[data-idea-again]')).toBeVisible();
    await expect(panel.locator('button[data-overlay-close]')).toBeVisible();

    // The form screen must be gone
    await expect(panel.locator('button[data-idea-submit]')).not.toBeVisible();

    // Verify the mocked request received the correct payload
    expect(capturedBody, 'POST body must have been captured').toBeTruthy();
    const body = JSON.parse(capturedBody);
    expect(body.type).toBe('bug');
    expect(body.title).toBe('בעיה בגרף');
    expect(body.message).toBe('הגרף לא מתעדכן כשמחליפים טווח זמן.');

    gate.assertClean();
  });

  // ── 6a. Dismiss via "סגירה" button ────────────────────────────────────────

  test('"סגירה" on thank-you screen dismisses the overlay', async ({ page }) => {
    const gate = installConsoleGate(page);
    await openIdeaOverlay(page);

    // Mock submit so we can reach the thank-you screen
    await page.route('**/api/feedback', (route) =>
      route.fulfill({ status: 201, contentType: 'application/json', body: '{}' })
    );

    const panel = page.locator('.navi-overlay-panel--idea');
    await panel.locator('textarea[data-idea-msg]').fill('בדיקת סגירה של המודל.');
    await panel.locator('button[data-idea-submit]').click();
    await expect(panel.locator('.idea-sent')).toBeVisible({ timeout: 6_000 });

    // Click the close button
    await panel.locator('button[data-overlay-close]').click();

    // The root must become inactive
    await expect(page.locator('[data-page-overlay-root]')).toHaveAttribute('data-active', 'false', {
      timeout: 4_000,
    });
    await expect(panel).not.toBeVisible();

    gate.assertClean();
  });

  // ── 6b. Dismiss via backdrop click ────────────────────────────────────────
  //
  // The backdrop spans the full viewport but the panel (pointer-events:auto) covers
  // its centre — Playwright's default click would land on the panel and be intercepted.
  // We click the top-left corner of the viewport (16px in from each edge), which is
  // guaranteed to be backdrop-only (the panel is centred and narrower than the viewport).
  // The backdrop's own `data-overlay-close` onClick is what triggers the dismiss.

  test('backdrop click closes the overlay', async ({ page }) => {
    const gate = installConsoleGate(page);
    await openIdeaOverlay(page);

    // Confirm backdrop is present
    await expect(page.locator('.navi-overlay-backdrop')).toBeVisible();

    // Click a corner that is definitely outside the centred panel.
    await page.mouse.click(16, 16);

    // Root must become inactive
    await expect(page.locator('[data-page-overlay-root]')).toHaveAttribute('data-active', 'false', {
      timeout: 4_000,
    });
    await expect(page.locator('.navi-overlay-panel--idea')).not.toBeVisible();

    gate.assertClean();
  });

  // ── 6c. "לשליחת עוד פנייה" resets to form ──────────────────────────────────

  test('"לשליחת עוד פנייה" button resets overlay back to the form', async ({ page }) => {
    const gate = installConsoleGate(page);
    await openIdeaOverlay(page);

    await page.route('**/api/feedback', (route) =>
      route.fulfill({ status: 201, contentType: 'application/json', body: '{}' })
    );

    const panel = page.locator('.navi-overlay-panel--idea');
    await panel.locator('textarea[data-idea-msg]').fill('עוד פנייה לבדיקה.');
    await panel.locator('button[data-idea-submit]').click();
    await expect(panel.locator('.idea-sent')).toBeVisible({ timeout: 6_000 });

    // Click "לשליחת עוד פנייה"
    await panel.locator('button[data-idea-again]').click();

    // Form must be back, sent screen gone
    await expect(panel.locator('button[data-idea-submit]')).toBeVisible({ timeout: 4_000 });
    await expect(panel.locator('.idea-sent')).not.toBeVisible();
    // Type defaults back to "idea"
    await expect(panel.locator('[data-idea-type="idea"]')).toHaveClass(/is-active/);

    // Overlay must still be open
    await expect(page.locator('[data-page-overlay-root]')).toHaveAttribute('data-active', 'true');

    gate.assertClean();
  });

  // ── 7. Pixel regression — panel in initial (form) state ───────────────────

  test('pixel baseline — overlay panel initial state', async ({ page }) => {
    const gate = installConsoleGate(page);
    await openIdeaOverlay(page);

    const panel = page.locator('.navi-overlay-panel--idea');
    await expect(panel).toBeVisible();

    // Stabilize before shooting: kill animations, wait for fonts, settle.
    await stabilize(page);

    // Element-scoped screenshot (not full-page) — the panel is the regression target.
    await expect(panel).toHaveScreenshot('idea-panel.png', {
      animations: 'disabled',
      maxDiffPixelRatio: 0.02,
    });

    gate.assertClean();
  });
});
