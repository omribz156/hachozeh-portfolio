/**
 * how-it-works.spec.mjs — E2E + pixel regression for the "How It Works"
 * walkthrough overlay (guest onboarding).
 *
 * Surface: a vanilla, NON-BLOCKING modal flow mounted by HZHowItWorks
 * (systems/web/public/scripts/how-it-works/hz-how-it-works.js) and wired
 * by the init island (how-it-works.js). The overlay has four steps and hands
 * off to the signup overlay on the final CTA.
 *
 * GUEST = default Playwright context (no storageState needed — the trigger
 * is the [data-hiw-open] link in the guest nav, which is only visible to
 * unauthenticated users).
 *
 * Trigger used: [data-hiw-open] link — specifically the desktop header link
 * `a.hz-shell__hiw-link[data-hiw-open]` ("איך זה עובד?" in the nav). The
 * hamburger carries the same attribute but requires the mobile viewport.
 *
 * Selectors (all from hz-how-it-works.js source):
 *   Panel (dialog):    [role="dialog"][aria-label="איך זה עובד"]
 *   Art placeholder:   [data-hiw-art]
 *   Title:             [data-hiw-title]
 *   Body text:         [data-hiw-text]
 *   Next/Finish CTA:   [data-hiw-cta]
 *   Scrim (root):      .hzhiw-scrim
 *
 * Signup handoff: the final-step CTA fires onSignup → NaviOverlays.open("signup")
 * or falls back to pushing ?overlay=signup into the URL. We detect whichever fires
 * first, so the test is robust to NaviOverlays hydration timing.
 *
 * NON-BLOCKING contract: the overlay never scroll-locks/inerts the page — verified
 * by asserting body.overlay-open is NOT set while the HIW scrim is present.
 */

import { test, expect } from '@playwright/test';
import { astroBase } from './fixtures/contexts.mjs';
import { installConsoleGate } from './fixtures/console-gate.mjs';
import { stabilize } from './fixtures/screenshot.mjs';

// ─── Constants ────────────────────────────────────────────────────────────────

/** A stable public page that carries the guest nav (and therefore [data-hiw-open]). */
const BASE_URL = `${astroBase}/trending`;

/** Total number of steps in DEFAULT_STEPS (from hz-how-it-works.js). */
const TOTAL_STEPS = 4;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Navigate to a page that carries the guest nav + all HIW scripts. */
async function gotoBase(page) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
}

/** Open the HIW overlay via the desktop [data-hiw-open] link. */
async function openHIW(page) {
  // The desktop header link is always in the DOM for guests.
  const trigger = page.locator('a.hz-shell__hiw-link[data-hiw-open]');
  await expect(trigger).toBeVisible({ timeout: 10_000 });
  await trigger.click();
}

/** Wait for the HIW panel to appear in the DOM. */
async function waitForPanel(page) {
  const panel = page.locator('[role="dialog"][aria-label="איך זה עובד"]');
  await panel.waitFor({ state: 'visible', timeout: 8_000 });
  return panel;
}

/** Read the current step title from the panel. */
async function readTitle(panel) {
  return panel.locator('[data-hiw-title]').textContent();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('how-it-works walkthrough overlay', () => {

  // ── 1. Open ────────────────────────────────────────────────────────────────
  test('trigger [data-hiw-open] opens the walkthrough panel', async ({ page }) => {
    const gate = installConsoleGate(page);
    await gotoBase(page);

    // Panel must NOT be in the DOM before trigger
    await expect(page.locator('.hzhiw-scrim')).toHaveCount(0);

    await openHIW(page);
    const panel = await waitForPanel(page);

    // Panel visible + labelled correctly
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('aria-modal', 'true');

    // Step 1 content present
    const title = await readTitle(panel);
    expect(title.trim().length, 'step title must be non-empty').toBeGreaterThan(0);
    await expect(panel.locator('[data-hiw-text]')).toBeVisible();
    await expect(panel.locator('[data-hiw-cta]')).toBeVisible();
    await expect(panel.locator('[data-hiw-art]')).toBeVisible();

    // CTA says "הבא" on step 1 (not the final label)
    await expect(panel.locator('[data-hiw-cta]')).toContainText('הבא');

    gate.assertClean();
  });

  // ── 2. Step navigation (next) ──────────────────────────────────────────────
  test('next CTA advances through all steps; final step shows finish label', async ({ page }) => {
    const gate = installConsoleGate(page);
    await gotoBase(page);
    await openHIW(page);
    const panel = await waitForPanel(page);

    const cta = panel.locator('[data-hiw-cta]');
    const titleEl = panel.locator('[data-hiw-title]');

    // Collect each step title as we advance
    const titles = [await titleEl.textContent()];

    for (let step = 1; step < TOTAL_STEPS; step++) {
      await cta.click();
      // Wait for the title to change (renderStep replaces textContent)
      await expect(titleEl).not.toHaveText(titles[step - 1], { timeout: 3_000 });
      titles.push(await titleEl.textContent());
    }

    // We visited all 4 distinct steps
    expect(new Set(titles).size, 'each step must have a unique title').toBe(TOTAL_STEPS);

    // On the final step the CTA label changes to the finish label
    await expect(cta).not.toContainText('הבא');
    await expect(cta).toContainText('התחילו לחזות');

    gate.assertClean();
  });

  // ── 3. NON-BLOCKING contract ───────────────────────────────────────────────
  test('overlay is non-blocking: body does NOT carry overlay-open while HIW scrim is visible', async ({ page }) => {
    const gate = installConsoleGate(page);
    await gotoBase(page);
    await openHIW(page);
    await waitForPanel(page);

    // The signup/auth overlay uses body.overlay-open for scroll-lock.
    // HIW explicitly never does this (documented in how-it-works.js).
    const hasOverlayOpen = await page.evaluate(
      () => document.body.classList.contains('overlay-open'),
    );
    expect(hasOverlayOpen, 'body.overlay-open must NOT be set while HIW is open').toBe(false);

    gate.assertClean();
  });

  // ── 4. Signup handoff ─────────────────────────────────────────────────────
  // Clicking the finish CTA on the final step hands off to the signup overlay.
  // Two possible signals (whichever fires first):
  //   a) NaviOverlays.open("signup") sets .navi-overlay-root[data-active="true"]
  //   b) URL falls back to ?overlay=signup (if NaviOverlays not yet hydrated)
  // We race both and assert at least one fires.
  test('final-step CTA hands off to signup overlay or pushes ?overlay=signup', async ({ page }) => {
    const gate = installConsoleGate(page);
    await gotoBase(page);
    await openHIW(page);
    const panel = await waitForPanel(page);
    const cta = panel.locator('[data-hiw-cta]');

    // Advance to the final step
    for (let step = 1; step < TOTAL_STEPS; step++) {
      await cta.click();
      await expect(panel.locator('[data-hiw-title]')).not.toBeEmpty({ timeout: 3_000 });
    }
    await expect(cta).toContainText('התחילו לחזות');

    // Click the finish CTA — it calls finish() → teardown(false) → onSignup()
    // After teardown the HIW scrim is removed from the DOM.
    await Promise.race([
      // Signal A: auth overlay becomes active
      page
        .locator('.navi-overlay-root[data-active="true"]')
        .waitFor({ state: 'visible', timeout: 6_000 })
        .catch(() => null),
      // Signal B: URL carries ?overlay=signup (fallback path)
      page
        .waitForURL((url) => url.searchParams.get('overlay') === 'signup', { timeout: 6_000 })
        .catch(() => null),
    ]);

    await cta.click();

    // Give the handoff a moment to resolve
    await page.waitForTimeout(800);

    // Assert at least one signal fired
    const url = new URL(page.url());
    const overlayParam = url.searchParams.get('overlay');
    const overlayActive = await page
      .locator('.navi-overlay-root[data-active="true"]')
      .count()
      .catch(() => 0);

    const handoffFired = overlayParam === 'signup' || overlayActive > 0;
    expect(
      handoffFired,
      `Signup handoff not detected: url=${page.url()}, .navi-overlay-root[data-active="true"] count=${overlayActive}`,
    ).toBe(true);

    gate.assertClean();
  });

  // ── 5. Dismiss ────────────────────────────────────────────────────────────
  test('dismiss: Escape key closes the panel and removes it from the DOM', async ({ page }) => {
    const gate = installConsoleGate(page);
    await gotoBase(page);
    await openHIW(page);
    await waitForPanel(page);

    // Close via Escape (onKey handler in hz-how-it-works.js)
    await page.keyboard.press('Escape');

    // The scrim is removed from the DOM on close (teardown removes the element)
    await expect(page.locator('.hzhiw-scrim')).toHaveCount(0, { timeout: 3_000 });
    await expect(page.locator('[role="dialog"][aria-label="איך זה עובד"]')).toHaveCount(0);

    gate.assertClean();
  });

  test('dismiss: click-outside (on scrim) closes the panel', async ({ page }) => {
    const gate = installConsoleGate(page);
    await gotoBase(page);
    await openHIW(page);
    await waitForPanel(page);

    // Click the scrim background (not the panel itself)
    // The scrim fills the full viewport; click on the left edge which is outside
    // the centred panel section (the section carries .hzhiw and is RTL-centred).
    await page.locator('.hzhiw-scrim').click({ position: { x: 5, y: 5 } });

    await expect(page.locator('.hzhiw-scrim')).toHaveCount(0, { timeout: 3_000 });

    gate.assertClean();
  });

  // ── 6. Mobile ─────────────────────────────────────────────────────────────
  // At 390px the desktop header link is hidden behind the hamburger, but we
  // can still open the overlay programmatically via window.NaviHowItWorks.open()
  // (the handle is wired in how-it-works.js) to validate rendering.
  test('mobile 390px: overlay renders + no horizontal overflow', async ({ page }) => {
    const gate = installConsoleGate(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await gotoBase(page);

    // Open programmatically — NaviHowItWorks is the reusable handle set by the
    // init island (window.NaviHowItWorks = hiw).
    await page.evaluate(() => {
      if (window.NaviHowItWorks) window.NaviHowItWorks.open();
    });

    const panel = await waitForPanel(page);

    // Panel must be visible and contained within the viewport (no overflow)
    await expect(panel).toBeVisible();

    const overflows = await page.evaluate(() => {
      const dw = document.documentElement.scrollWidth;
      const cw = document.documentElement.clientWidth;
      return { scrollWidth: dw, clientWidth: cw, overflows: dw > cw + 1 };
    });
    expect(
      overflows.overflows,
      `Horizontal overflow at 390px: scrollWidth=${overflows.scrollWidth} clientWidth=${overflows.clientWidth}`,
    ).toBe(false);

    // The panel section itself must not clip out of view (bounding box within vp)
    const box = await panel.boundingBox();
    expect(box, 'panel must be in the DOM').not.toBeNull();
    expect(box.width, 'panel must have positive width').toBeGreaterThan(0);
    expect(box.x, 'panel must not be clipped left').toBeGreaterThanOrEqual(0);
    // right edge within viewport (allow 1px rounding)
    expect(box.x + box.width, 'panel must not overflow right').toBeLessThanOrEqual(391);

    // Usable: CTA is clickable
    await expect(panel.locator('[data-hiw-cta]')).toBeEnabled();

    gate.assertClean();
  });

  // ── 7. Pixel baseline — step 1 panel ─────────────────────────────────────
  test('pixel baseline — HIW panel at step 1', async ({ page }) => {
    const gate = installConsoleGate(page);
    await gotoBase(page);
    await openHIW(page);
    const panel = await waitForPanel(page);

    // Freeze motion BEFORE the pixel shot so animations/transitions don't drift
    await stabilize(page);

    await expect(panel).toHaveScreenshot('how-it-works-panel.png', {
      animations: 'disabled',
      maxDiffPixelRatio: 0.02,
    });

    gate.assertClean();
  });
});
