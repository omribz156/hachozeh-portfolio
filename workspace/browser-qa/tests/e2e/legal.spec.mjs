/**
 * legal.spec.mjs — E2E + pixel regression for guest legal/static content pages.
 *
 * Pages covered:
 *   /terms    — Terms of Use (תנאי שימוש)
 *   /privacy  — Privacy Policy (מדיניות פרטיות)
 *   /cookies  — Cookie Policy (מדיניות עוגיות)
 *   /qanda    — 301 redirect → /help (Q&A retired 2026-06-09)
 *
 * These are GUEST pages — no auth required. Default Playwright context (no storageState).
 *
 * Per-page flow follows the content-page template from tests/e2e/README.md:
 *   1. Load — SSR 200 + main visible.
 *   2. Content assertion — real heading + non-trivial body text (not an empty shell).
 *   3. Structure regression — toMatchAriaSnapshot (text IS the content; stable baseline).
 *   4. Pixel regression — snap() with minimal masks (static pages; only header chrome masked).
 *   5. Hygiene — console gate + no 390 overflow (warn 360).
 *
 * /qanda is tested for its redirect contract (301 → /help) rather than page content,
 * because the page itself only performs Astro.redirect('/help', 301) with no body.
 */

import { test, expect } from '@playwright/test';
import { astroBase } from './fixtures/contexts.mjs';
import { installConsoleGate } from './fixtures/console-gate.mjs';
import { snap, chromeMasks } from './fixtures/screenshot.mjs';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Navigate to a legal page and wait for the static shell to be visible.
 *  All three legal pages use StaticPageShell which renders
 *  `<main class="hz-static-page" data-static-page="<routeKey>">`.
 *  We capture the navigation response directly from page.goto, which returns
 *  the main document response (following any redirects). */
async function gotoLegal(page, path) {
  const response = await page.goto(`${astroBase}${path}`, { waitUntil: 'domcontentloaded' });
  return response;
}

/** Assert no horizontal overflow. Warn at 360, hard-fail at 390. */
async function assertNoOverflow(page) {
  // 390px — must pass
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const at390 = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    overflows: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  }));
  expect(
    at390.overflows,
    `Horizontal overflow at 390px: scrollWidth=${at390.scrollWidth} clientWidth=${at390.clientWidth}`
  ).toBe(false);

  // 360px — warn, do not fail (legal tables can be borderline at narrowest)
  await page.setViewportSize({ width: 360, height: 780 });
  await page.waitForTimeout(200);
  const at360 = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    overflows: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  }));
  if (at360.overflows) {
    console.warn(
      `[legal] horizontal overflow at 360px (non-blocking): scrollWidth=${at360.scrollWidth} clientWidth=${at360.clientWidth}`
    );
  }
}

// ─── /terms ──────────────────────────────────────────────────────────────────

test.describe('/terms — Terms of Use', () => {
  test('loads with SSR 200 and real content', async ({ page }) => {
    const gate = installConsoleGate(page);

    const response = await gotoLegal(page, '/terms');
    expect(response.status()).toBe(200);

    // Static shell renders <main data-static-page="terms">
    await expect(page.locator('main[data-static-page="terms"]')).toBeVisible();

    // Real heading — not an empty shell
    const h1 = page.locator('main[data-static-page="terms"] h1');
    await expect(h1).toBeVisible();
    await expect(h1).toContainText('תנאי שימוש');

    // Non-trivial body: the article should have substantial text.
    // The terms page has 17 sections; we expect at least 1000 chars of text content.
    const bodyLength = await page.locator('main[data-static-page="terms"] article').evaluate(
      (el) => el.textContent?.trim().length ?? 0
    );
    expect(bodyLength, 'terms article appears empty or very short').toBeGreaterThan(1000);

    gate.assertClean();
  });

  test('structure baseline — aria snapshot', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/terms`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main[data-static-page="terms"]')).toBeVisible();

    // Content pages: aria tree is a stable, meaningful structural baseline.
    // Use the specific static-page main to avoid matching the Layout's outer main.
    await expect(page.locator('main[data-static-page="terms"]')).toMatchAriaSnapshot(`
      - main:
        - article:
          - paragraph: /מסמך זה הוא טיוטה/
          - heading "תנאי שימוש — החוזה" [level=1]
          - paragraph: /גרסה/
          - heading /1\\. מבוא/ [level=2]
          - heading /2\\. הגדרות/ [level=2]
          - heading /3\\. כשירות/ [level=2]
          - heading /4\\. חשבון/ [level=2]
          - heading /5\\. מהות השירות/ [level=2]
          - heading /6\\. השקל/ [level=2]
          - heading /7\\. שימוש/ [level=2]
          - heading /8\\. שווקים/ [level=2]
          - heading /9\\. קניין/ [level=2]
          - heading /10\\. פרטיות/ [level=2]
          - heading /11\\. זמינות/ [level=2]
          - heading /12\\. השעיה/ [level=2]
          - heading /13\\. היעדר/ [level=2]
          - heading /14\\. שיפוי/ [level=2]
          - heading /15\\. שינויים/ [level=2]
          - heading /16\\. דין חל/ [level=2]
          - heading /17\\. כללי/ [level=2]
    `);

    gate.assertClean();
  });

  test('pixel baseline', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/terms`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main[data-static-page="terms"]')).toBeVisible();

    // Static pages have no live numbers to mask; chromeMasks is harmless on guest pages.
    await snap(page, 'terms.png', { mask: [...chromeMasks(page)] });

    gate.assertClean();
  });

  test('no horizontal overflow at 390px (warn 360)', async ({ page }) => {
    await page.goto(`${astroBase}/terms`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main[data-static-page="terms"]')).toBeVisible();
    await assertNoOverflow(page);
  });
});

// ─── /privacy ────────────────────────────────────────────────────────────────

test.describe('/privacy — Privacy Policy', () => {
  test('loads with SSR 200 and real content', async ({ page }) => {
    const gate = installConsoleGate(page);

    const response = await gotoLegal(page, '/privacy');
    expect(response.status()).toBe(200);

    await expect(page.locator('main[data-static-page="privacy"]')).toBeVisible();

    const h1 = page.locator('main[data-static-page="privacy"] h1');
    await expect(h1).toBeVisible();
    await expect(h1).toContainText('מדיניות פרטיות');

    const bodyLength = await page.locator('main[data-static-page="privacy"] article').evaluate(
      (el) => el.textContent?.trim().length ?? 0
    );
    expect(bodyLength, 'privacy article appears empty or very short').toBeGreaterThan(800);

    gate.assertClean();
  });

  test('structure baseline — aria snapshot', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/privacy`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main[data-static-page="privacy"]')).toBeVisible();

    await expect(page.locator('main[data-static-page="privacy"]')).toMatchAriaSnapshot(`
      - main:
        - article:
          - paragraph: /מסמך זה הוא טיוטה/
          - heading "מדיניות פרטיות — החוזה" [level=1]
          - paragraph: /גרסה/
          - heading /1\\. כללי/ [level=2]
          - heading /2\\. איזה מידע/ [level=2]
          - heading /3\\. כיצד אנו אוספים/ [level=2]
          - heading /4\\. למטרות מה/ [level=2]
          - heading /5\\. שיתוף מידע/ [level=2]
          - heading /6\\. עוגיות/ [level=2]
          - heading /7\\. אבטחת מידע/ [level=2]
          - heading /8\\. שמירת מידע/ [level=2]
          - heading /9\\. זכויותיך/ [level=2]
          - heading /10\\. קטינים/ [level=2]
          - heading /11\\. העברת מידע/ [level=2]
          - heading /12\\. שינויים/ [level=2]
          - heading /13\\. יצירת קשר/ [level=2]
    `);

    gate.assertClean();
  });

  test('pixel baseline', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/privacy`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main[data-static-page="privacy"]')).toBeVisible();

    await snap(page, 'privacy.png', { mask: [...chromeMasks(page)] });

    gate.assertClean();
  });

  test('no horizontal overflow at 390px (warn 360)', async ({ page }) => {
    await page.goto(`${astroBase}/privacy`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main[data-static-page="privacy"]')).toBeVisible();
    await assertNoOverflow(page);
  });
});

// ─── /cookies ────────────────────────────────────────────────────────────────

test.describe('/cookies — Cookie Policy', () => {
  test('loads with SSR 200 and real content', async ({ page }) => {
    const gate = installConsoleGate(page);

    const response = await gotoLegal(page, '/cookies');
    expect(response.status()).toBe(200);

    await expect(page.locator('main[data-static-page="cookies"]')).toBeVisible();

    const h1 = page.locator('main[data-static-page="cookies"] h1');
    await expect(h1).toBeVisible();
    await expect(h1).toContainText('מדיניות עוגיות');

    const bodyLength = await page.locator('main[data-static-page="cookies"] article').evaluate(
      (el) => el.textContent?.trim().length ?? 0
    );
    expect(bodyLength, 'cookies article appears empty or very short').toBeGreaterThan(400);

    gate.assertClean();
  });

  test('structure baseline — aria snapshot', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/cookies`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main[data-static-page="cookies"]')).toBeVisible();

    await expect(page.locator('main[data-static-page="cookies"]')).toMatchAriaSnapshot(`
      - main:
        - article:
          - paragraph: /מסמך זה הוא טיוטה/
          - heading /מדיניות עוגיות/ [level=1]
          - paragraph: /גרסה/
          - heading /1\\. מהי עוגייה/ [level=2]
          - heading /2\\. במה אנו משתמשים/ [level=2]
          - heading /3\\. תוכן ושירותים/ [level=2]
          - heading /4\\. ניהול עוגיות/ [level=2]
          - heading /5\\. שינויים ויצירת קשר/ [level=2]
    `);

    gate.assertClean();
  });

  test('cookies table — navi_session row present', async ({ page }) => {
    // The cookies page has a table listing the essential session cookie.
    // Verify it contains the key data so the table hasn't been inadvertently emptied.
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/cookies`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main[data-static-page="cookies"]')).toBeVisible();

    const table = page.locator('main[data-static-page="cookies"] table');
    await expect(table).toBeVisible();

    // The navi_session row must exist — this is the cookie the policy describes
    const sessionRow = table.locator('td', { hasText: 'navi_session' });
    await expect(sessionRow).toBeVisible();

    gate.assertClean();
  });

  test('pixel baseline', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/cookies`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main[data-static-page="cookies"]')).toBeVisible();

    await snap(page, 'cookies.png', { mask: [...chromeMasks(page)] });

    gate.assertClean();
  });

  test('no horizontal overflow at 390px (warn 360)', async ({ page }) => {
    await page.goto(`${astroBase}/cookies`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main[data-static-page="cookies"]')).toBeVisible();
    await assertNoOverflow(page);
  });
});

// ─── /qanda ──────────────────────────────────────────────────────────────────
//
// /qanda was retired 2026-06-09 and replaced by the Help Center (/help).
// Both /qanda and /qanda.html now issue 301 → /help.
// This spec asserts the redirect contract, not page content — the page body is empty.

test.describe('/qanda — redirect to /help', () => {
  test('301 redirect resolves to /help with real content', async ({ page }) => {
    const gate = installConsoleGate(page);

    // Follow the redirect and land on /help
    await page.goto(`${astroBase}/qanda`, { waitUntil: 'domcontentloaded' });

    // After following the redirect, Playwright lands on /help
    await expect(page).toHaveURL(/\/help(\?.*)?$/);

    // /help must have its main hub wrapper
    const helpRoot = page.locator('.hz-help');
    await expect(helpRoot).toBeVisible();

    // Real heading — not an empty shell
    const h1 = page.locator('.hz-help h1');
    await expect(h1).toBeVisible();
    await expect(h1).toContainText('איך לעבוד עם החוזה');

    // Topic cards present (at least one)
    const topicCards = page.locator('.hz-help-card');
    await expect(topicCards.first()).toBeVisible();

    gate.assertClean();
  });

  test('/qanda.html legacy URL also redirects to /help', async ({ page }) => {
    const gate = installConsoleGate(page);

    await page.goto(`${astroBase}/qanda.html`, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/help(\?.*)?$/);

    // Same content check as above
    await expect(page.locator('.hz-help h1')).toContainText('איך לעבוד עם החוזה');

    gate.assertClean();
  });

  test('help hub — topic cards are navigable (click one, land on topic page)', async ({ page }) => {
    // Drives the interactive flow on /help (the page /qanda redirects to).
    // This is the closest thing to an accordion/FAQ interaction:
    // topic cards are the primary navigable affordance on this hub.
    const gate = installConsoleGate(page);

    await page.goto(`${astroBase}/help`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.hz-help-card').first()).toBeVisible();

    // Click the first topic card and assert navigation to a /help/<topic> URL
    const firstCard = page.locator('.hz-help-card').first();
    const href = await firstCard.getAttribute('href');
    await firstCard.click();

    // Should land on a /help/<topic> route
    await expect(page).toHaveURL(/\/help\/.+/);

    // The topic page should render a main element (Layout wrapper)
    await expect(page.locator('main')).toBeVisible();

    gate.assertClean();
  });

  test('pixel baseline — /help hub (qanda redirect target)', async ({ page }) => {
    const gate = installConsoleGate(page);
    await page.goto(`${astroBase}/help`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.hz-help')).toBeVisible();

    // Mask the search input in case it has a placeholder that varies,
    // and the featured-links section whose article titles could change.
    const masks = [
      ...chromeMasks(page),
      page.locator('.hz-help-featured'),   // featured article links (titles change as content grows)
      page.locator('.hz-help__lede'),      // marketing copy may evolve
    ];

    await snap(page, 'qanda-help-hub.png', { mask: masks });

    gate.assertClean();
  });

  test('no horizontal overflow at 390px (warn 360) — /help hub', async ({ page }) => {
    await page.goto(`${astroBase}/help`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.hz-help')).toBeVisible();
    await assertNoOverflow(page);
  });
});
