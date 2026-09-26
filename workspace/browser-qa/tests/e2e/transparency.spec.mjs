/**
 * transparency.spec.mjs — E2E + pixel regression for /graphs-and-accuracy
 *
 * State mechanism: ?state=loading|empty|error|ready — a real URL query param
 * read by the Astro SSR route (systems/web/src/pages/graphs-and-accuracy.astro
 * line 55-56). No Playwright route() mocking needed — the param overrides the
 * backend fetch result at the server before any HTML is sent.
 *
 * Guest page — no auth, default context.
 */

import { test, expect } from '@playwright/test';
import { astroBase } from './fixtures/contexts.mjs';
import { installConsoleGate } from './fixtures/console-gate.mjs';
import { snap, chromeMasks } from './fixtures/screenshot.mjs';

const PAGE = '/graphs-and-accuracy';
const url = (state) => `${astroBase}${PAGE}?state=${state}`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Root wrapper carries data-ga-status; wait for it to be in the DOM. */
async function waitForPage(page) {
  await page.locator('[data-ga-page]').waitFor({ timeout: 10_000 });
}

// ─── Tests ───────────────────────────────────────────────────────────────────
test.describe('/graphs-and-accuracy — E2E + regression', () => {
  // ── State: loading ────────────────────────────────────────────────────────
  // ?state=loading — SSR injects skeleton placeholders (ga-skel / ga-statewrap)
  // instead of chart HTML. Hero KPI values are also replaced with skeletons.
  test('loading state — skeletons render, no charts', async ({ page }) => {
    const gate = installConsoleGate(page);

    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes(PAGE) && r.request().method() === 'GET'
      ),
      page.goto(url('loading'), { waitUntil: 'domcontentloaded' }),
    ]);
    expect(response.status()).toBe(200);

    await waitForPage(page);

    // Root carries the correct status attribute
    await expect(page.locator('[data-ga-page][data-ga-status="loading"]')).toBeVisible();

    // Hero skeleton — circular gauge placeholder
    const heroSkel = page.locator('.ga-hero .ga-skel').first();
    await expect(heroSkel).toBeVisible();

    // Chart skeleton placeholders appear in content sections
    // (chartSkeleton() wraps content in .ga-statewrap with .ga-skel inside)
    const stateWraps = page.locator('.ga-statewrap');
    await expect(stateWraps.first()).toBeVisible();
    const wrapCount = await stateWraps.count();
    expect(wrapCount, 'expected skeleton wrappers for each chart section').toBeGreaterThan(0);

    // TOC and structural chrome are always present
    await expect(page.locator('.ga-toc')).toBeVisible();
    await expect(page.locator('#stats')).toBeVisible();

    // No real chart SVGs in loading state
    const gaugeReal = page.locator('.ga-gauge-wrap');
    await expect(gaugeReal).not.toBeVisible();

    await snap(page, 'transparency-loading.png', { mask: [] });

    gate.assertClean();
  });

  // ── State: empty ─────────────────────────────────────────────────────────
  // ?state=empty — SSR injects chartEmpty() placeholders in each chart slot.
  // Hero KPI values show "—" (em dash, not a skeleton).
  test('empty state — empty-message placeholders, KPIs show em-dash', async ({ page }) => {
    const gate = installConsoleGate(page);

    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes(PAGE) && r.request().method() === 'GET'
      ),
      page.goto(url('empty'), { waitUntil: 'domcontentloaded' }),
    ]);
    expect(response.status()).toBe(200);

    await waitForPage(page);

    await expect(page.locator('[data-ga-page][data-ga-status="empty"]')).toBeVisible();

    // Empty state title rendered in each chart slot (chartEmpty() uses .ga-state__title)
    const emptyTitles = page.locator('.ga-state__title');
    await expect(emptyTitles.first()).toBeVisible();
    // Text matches the empty-state copy from chartEmpty()
    await expect(emptyTitles.first()).toHaveText('אין עדיין נתונים להצגה');

    // Multiple sections show the empty state
    const stateEls = page.locator('.ga-state');
    const stateCount = await stateEls.count();
    expect(stateCount, 'expected empty-state elements for each chart section').toBeGreaterThan(0);

    // Hero KPI values show "—" (not a number, not a skeleton)
    const emptyKpis = page.locator('.ga-kpi__value--empty');
    await expect(emptyKpis.first()).toBeVisible();
    await expect(emptyKpis.first()).toHaveText('—');

    // TOC present, gauge is empty (ga-gauge--empty)
    await expect(page.locator('.ga-toc')).toBeVisible();
    await expect(page.locator('.ga-gauge--empty')).toBeVisible();

    // Static sections still render (methodology, FAQ always show)
    await expect(page.locator('#methodology')).toBeVisible();
    await expect(page.locator('#faq')).toBeVisible();

    await snap(page, 'transparency-empty.png', { mask: [] });

    gate.assertClean();
  });

  // ── State: error ─────────────────────────────────────────────────────────
  // ?state=error — SSR injects chartError() placeholders: .ga-state__rule--error
  // + a [data-ga-retry] button per section.
  test('error state — error messages and retry buttons present', async ({ page }) => {
    // The error state logs nothing to the console (data-ga-retry triggers
    // window.location.reload on click, not an error itself).
    const gate = installConsoleGate(page);

    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes(PAGE) && r.request().method() === 'GET'
      ),
      page.goto(url('error'), { waitUntil: 'domcontentloaded' }),
    ]);
    expect(response.status()).toBe(200);

    await waitForPage(page);

    await expect(page.locator('[data-ga-page][data-ga-status="error"]')).toBeVisible();

    // Error rule decoration
    const errorRules = page.locator('.ga-state__rule--error');
    await expect(errorRules.first()).toBeVisible();

    // Error copy from chartError()
    const errorTitles = page.locator('.ga-state__title');
    await expect(errorTitles.first()).toHaveText('לא ניתן לטעון את הנתונים');

    // Retry button is present and labeled
    const retryBtns = page.locator('[data-ga-retry]');
    await expect(retryBtns.first()).toBeVisible();
    await expect(retryBtns.first()).toHaveText('נסו שוב');

    // Multiple chart sections all show error state
    const stateCount = await page.locator('.ga-state').count();
    expect(stateCount, 'expected error-state elements for each chart section').toBeGreaterThan(0);

    // TOC and static sections survive
    await expect(page.locator('.ga-toc')).toBeVisible();
    await expect(page.locator('#methodology')).toBeVisible();
    await expect(page.locator('#faq')).toBeVisible();

    await snap(page, 'transparency-error.png', { mask: [] });

    gate.assertClean();
  });

  // ── State: ready ─────────────────────────────────────────────────────────
  // ?state=ready — SSR provides empty data arrays (payload=null from failed
  // backend fetch). resolveStatus('ready', []) → 'empty', so real chart SVGs
  // won't appear unless the backend is live. What IS guaranteed: the page
  // root has data-ga-status="ready", the structural chrome (TOC, section
  // headings, horizon toggle, FAQ) are all present.
  test('ready state — structural chrome and interactive elements present', async ({ page }) => {
    const gate = installConsoleGate(page);

    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes(PAGE) && r.request().method() === 'GET'
      ),
      page.goto(url('ready'), { waitUntil: 'domcontentloaded' }),
    ]);
    expect(response.status()).toBe(200);

    await waitForPage(page);

    await expect(page.locator('[data-ga-page][data-ga-status="ready"]')).toBeVisible();

    // TOC sidebar with nav links
    const toc = page.locator('.ga-toc');
    await expect(toc).toBeVisible();
    const tocLinks = page.locator('[data-ga-toc]');
    await expect(tocLinks.first()).toBeVisible();
    const tocCount = await tocLinks.count();
    expect(tocCount, 'expected all TOC nav links').toBe(7); // SECTIONS array has 7 entries

    // All named section headings present
    await expect(page.locator('#stats')).toBeVisible();
    await expect(page.locator('#accuracy-time')).toBeVisible();
    await expect(page.locator('#prediction-reality')).toBeVisible();
    await expect(page.locator('#brier-volume')).toBeVisible();
    await expect(page.locator('#resolution')).toBeVisible();
    await expect(page.locator('#methodology')).toBeVisible();
    await expect(page.locator('#faq')).toBeVisible();

    // Horizon toggle (4h / 12h) is present on the prediction-reality section
    const horizonGroup = page.locator('[role="group"][aria-label="טווח לפני סגירה"]');
    await expect(horizonGroup).toBeVisible();
    const btn4h = page.locator('[data-ga-horizon-btn="4h"]');
    const btn12h = page.locator('[data-ga-horizon-btn="12h"]');
    await expect(btn4h).toBeVisible();
    await expect(btn12h).toBeVisible();

    // FAQ accordion — first item visible
    const faqWrap = page.locator('[data-ga-faq]');
    await expect(faqWrap).toBeVisible();
    const faqItems = page.locator('[data-ga-faq-item]');
    await expect(faqItems.first()).toBeVisible();
    const faqCount = await faqItems.count();
    expect(faqCount, 'expected all FAQ items').toBe(4);

    // Methodology section has text paragraphs
    await expect(page.locator('.ga-methodology p').first()).toBeVisible();

    await snap(page, 'transparency-ready.png', {
      mask: [
        // Mask any live KPI values that may vary once the backend ships
        page.locator('.ga-kpis'),
        page.locator('.ga-gauge-wrap'),
        page.locator('.ga-gauge--empty'),
        // Each chart slot (may be empty-state or real SVG once backend is live)
        page.locator('.ga-panel svg'),
        page.locator('.ga-state'),
        page.locator('.ga-statewrap'),
      ],
    });

    gate.assertClean();
  });

  // ── Flow: horizon toggle ──────────────────────────────────────────────────
  // Drive the 4h/12h segmented control in the ready state.
  test('ready state — horizon toggle switches active panel', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(url('ready'), { waitUntil: 'domcontentloaded' });
    await waitForPage(page);

    const btn4h = page.locator('[data-ga-horizon-btn="4h"]');
    const btn12h = page.locator('[data-ga-horizon-btn="12h"]');

    // Default: 4h is on, 12h is off
    await expect(btn4h).toHaveClass(/is-on/);
    await expect(btn12h).not.toHaveClass(/is-on/);

    // The 4h panel is visible, 12h panel is hidden
    await expect(page.locator('[data-ga-horizon="4h"]')).toBeVisible();
    const panel12h = page.locator('[data-ga-horizon="12h"]');
    await expect(panel12h).toBeHidden();

    // Click 12h
    await btn12h.click();

    // After click: 12h is on, 4h is off
    await expect(btn12h).toHaveClass(/is-on/);
    await expect(btn4h).not.toHaveClass(/is-on/);

    // Panel visibility swaps
    await expect(page.locator('[data-ga-horizon="4h"]')).toBeHidden();
    await expect(panel12h).toBeVisible();

    // Toggle back
    await btn4h.click();
    await expect(btn4h).toHaveClass(/is-on/);
    await expect(btn12h).not.toHaveClass(/is-on/);

    gate.assertClean();
  });

  // ── Flow: FAQ accordion ───────────────────────────────────────────────────
  test('ready state — FAQ accordion open/close', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(url('ready'), { waitUntil: 'domcontentloaded' });
    await waitForPage(page);

    const faqItems = page.locator('[data-ga-faq-item]');

    // First item starts open (openIndex=0 in component default state)
    const firstToggle = faqItems.nth(0).locator('[data-ga-faq-toggle]');
    await expect(firstToggle).toHaveAttribute('aria-expanded', 'true');

    // Second item starts closed
    const secondToggle = faqItems.nth(1).locator('[data-ga-faq-toggle]');
    await expect(secondToggle).toHaveAttribute('aria-expanded', 'false');

    // Click second — opens it, closes first (single-open accordion)
    await secondToggle.click();
    await expect(secondToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(firstToggle).toHaveAttribute('aria-expanded', 'false');

    // Click second again — closes it (toggle off)
    await secondToggle.click();
    await expect(secondToggle).toHaveAttribute('aria-expanded', 'false');

    gate.assertClean();
  });

  // ── Hygiene: no horizontal overflow at mobile widths (ready state) ─────────
  test('no horizontal overflow at 390px (ready state)', async ({ page }) => {
    await page.goto(url('ready'), { waitUntil: 'domcontentloaded' });
    await waitForPage(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);

    const overflows = await page.evaluate(() => {
      const dw = document.documentElement.scrollWidth;
      const cw = document.documentElement.clientWidth;
      return { scrollWidth: dw, clientWidth: cw, overflows: dw > cw + 1 };
    });

    expect(
      overflows.overflows,
      `Horizontal overflow at 390px: scrollWidth=${overflows.scrollWidth} clientWidth=${overflows.clientWidth}`
    ).toBe(false);

    // 360px — warn (log) but don't fail; narrower viewport may overflow due to
    // RTL SVG chart sizing. File a separate layout bug if this fires.
    await page.setViewportSize({ width: 360, height: 780 });
    await page.waitForTimeout(200);

    const overflows360 = await page.evaluate(() => {
      const dw = document.documentElement.scrollWidth;
      const cw = document.documentElement.clientWidth;
      return { scrollWidth: dw, clientWidth: cw, overflows: dw > cw + 1 };
    });

    if (overflows360.overflows) {
      console.warn(
        `[warn] Horizontal overflow at 360px: scrollWidth=${overflows360.scrollWidth} clientWidth=${overflows360.clientWidth} — log, not fail`
      );
    }
  });
});
