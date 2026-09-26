/**
 * help.spec.mjs — E2E + structure/pixel regression for the Help Center
 *
 * Three public routes (no auth required — guest context):
 *   /help                                           — hub / index
 *   /help/getting-started                           — topic collection page
 *   /help/getting-started/what-is-hachozeh          — article page
 *
 * Template type: CONTENT pages → toMatchAriaSnapshot (text IS the content;
 * the aria tree is a stable, meaningful baseline). See README §Per-page template.
 */

import { test, expect } from '@playwright/test';
import { astroBase } from './fixtures/contexts.mjs';
import { installConsoleGate } from './fixtures/console-gate.mjs';
import { snap, chromeMasks } from './fixtures/screenshot.mjs';

// ─── Slugs used across the suite ─────────────────────────────────────────────
const TOPIC = 'getting-started';
const ARTICLE = 'what-is-hachozeh';

// ─── Helper ──────────────────────────────────────────────────────────────────
/** Navigate to a path and assert SSR 200 + <main> visible.
 *
 *  Uses page.goto()'s return value (the main-document response) rather than
 *  waitForResponse, which was catching stale in-flight responses from other
 *  requests (assets, redirects) across sequential tests in the same describe.
 *
 *  Two <main> elements on the article page (Layout outer + hz-help-article inner)
 *  — use .first() which is the outer layout shell and is always present.
 */
async function loadAndAssert(page, path) {
  const response = await page.goto(`${astroBase}${path}`, { waitUntil: 'domcontentloaded' });
  expect(response.status(), `SSR status for ${path}`).toBe(200);
  // .first() — article page has a nested <main class="hz-help-article"> inside
  // the Layout's outer <main>; both are valid but strict mode rejects 2 elements.
  await expect(page.locator('main').first(), `<main> visible for ${path}`).toBeVisible();
  return response;
}

/** Overflow check at 390px (warn at 360px if it overflows). */
async function assertNoOverflow(page, path) {
  for (const [width, mode] of [
    [390, 'error'],
    [360, 'warn'],
  ]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(200);
    const { scrollWidth, clientWidth, overflows } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      overflows: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    }));
    if (mode === 'error') {
      expect(
        overflows,
        `Horizontal overflow at ${width}px on ${path}: scrollWidth=${scrollWidth} clientWidth=${clientWidth}`
      ).toBe(false);
    } else if (overflows) {
      console.warn(
        `[warn] Horizontal overflow at ${width}px on ${path}: scrollWidth=${scrollWidth} clientWidth=${clientWidth}`
      );
    }
  }
}

// ─── /help — Hub ─────────────────────────────────────────────────────────────
test.describe('/help — hub index', () => {
  test('loads with SSR 200 and main visible', async ({ page }) => {
    const gate = installConsoleGate(page);
    await loadAndAssert(page, '/help');
    gate.assertClean();
  });

  test('structure — aria snapshot of main content region', async ({ page }) => {
    const gate = installConsoleGate(page);
    await loadAndAssert(page, '/help');

    // Content pages: the aria tree is the baseline. Scoped to the outer main to
    // avoid header/footer drift. .first() is consistent with loadAndAssert —
    // the article page nests a second <main> but index/topic pages do not.
    await expect(page.locator('main').first()).toMatchAriaSnapshot({
      name: 'help-index-main',
    });

    gate.assertClean();
  });

  test('flow — clicking a topic card navigates into /help/[topic]', async ({ page }) => {
    const gate = installConsoleGate(page);
    await loadAndAssert(page, '/help');

    // The topic cards are <a class="hz-help-card"> links. Click the first one.
    const topicCard = page.locator('a.hz-help-card').first();
    await expect(topicCard).toBeVisible();

    await Promise.all([
      page.waitForURL(/\/help\//),
      topicCard.click(),
    ]);

    // Landed on a topic page — URL now under /help/
    expect(page.url()).toMatch(/\/help\//);
    await expect(page.locator('main').first()).toBeVisible();

    gate.assertClean();
  });

  test('pixel baseline — full page (help hub is mostly static; minimal masks)', async ({
    page,
  }) => {
    const gate = installConsoleGate(page);
    await loadAndAssert(page, '/help');

    // chromeMasks covers wallet cell (guest: harmless no-op since wallet is hidden).
    // No live numbers on this page → small mask list.
    const masks = [...chromeMasks(page)];
    await snap(page, 'help-index.png', { mask: masks });

    gate.assertClean();
  });

  test('no horizontal overflow at 390px (warn 360px)', async ({ page }) => {
    await loadAndAssert(page, '/help');
    await assertNoOverflow(page, '/help');
  });
});

// ─── /help/getting-started — Topic collection ─────────────────────────────────
test.describe('/help/getting-started — topic collection', () => {
  test('loads with SSR 200 and main visible', async ({ page }) => {
    const gate = installConsoleGate(page);
    await loadAndAssert(page, `/help/${TOPIC}`);
    gate.assertClean();
  });

  test('structure — aria snapshot of main content region', async ({ page }) => {
    const gate = installConsoleGate(page);
    await loadAndAssert(page, `/help/${TOPIC}`);

    await expect(page.locator('main').first()).toMatchAriaSnapshot({
      name: 'help-topic-getting-started-main',
    });

    gate.assertClean();
  });

  test('flow — clicking an article row navigates into the article', async ({ page }) => {
    const gate = installConsoleGate(page);
    await loadAndAssert(page, `/help/${TOPIC}`);

    // Article list rows are <a class="hz-help-row">
    const firstRow = page.locator('a.hz-help-row').first();
    await expect(firstRow).toBeVisible();

    await Promise.all([
      page.waitForURL(/\/help\/getting-started\//),
      firstRow.click(),
    ]);

    expect(page.url()).toMatch(/\/help\/getting-started\//);
    await expect(page.locator('main').first()).toBeVisible();

    gate.assertClean();
  });

  test('pixel baseline — full page', async ({ page }) => {
    const gate = installConsoleGate(page);
    await loadAndAssert(page, `/help/${TOPIC}`);

    const masks = [...chromeMasks(page)];
    await snap(page, 'help-topic-getting-started.png', { mask: masks });

    gate.assertClean();
  });

  test('no horizontal overflow at 390px (warn 360px)', async ({ page }) => {
    await loadAndAssert(page, `/help/${TOPIC}`);
    await assertNoOverflow(page, `/help/${TOPIC}`);
  });
});

// ─── /help/getting-started/what-is-hachozeh — Article page ──────────────────
test.describe('/help/getting-started/what-is-hachozeh — article page', () => {
  test('loads with SSR 200 and main visible', async ({ page }) => {
    const gate = installConsoleGate(page);
    await loadAndAssert(page, `/help/${TOPIC}/${ARTICLE}`);
    gate.assertClean();
  });

  test('structure — aria snapshot of article main', async ({ page }) => {
    const gate = installConsoleGate(page);
    await loadAndAssert(page, `/help/${TOPIC}/${ARTICLE}`);

    // Article page: the outer Layout <main> wraps an inner <main class="hz-help-article">.
    // Scope to the outer one — it captures the full page structure including the TOC aside.
    await expect(page.locator('main').first()).toMatchAriaSnapshot({
      name: 'help-article-what-is-hachozeh-main',
    });

    gate.assertClean();
  });

  test('pixel baseline — full page (date in footer masked)', async ({ page }) => {
    const gate = installConsoleGate(page);
    await loadAndAssert(page, `/help/${TOPIC}/${ARTICLE}`);

    // The article date (עודכן · …) could in principle drift across locales.
    // Mask it defensively. TOC and body text are static → no further masks needed.
    const masks = [
      ...chromeMasks(page),
      page.locator('.hz-help-article__date'),
    ];
    await snap(page, 'help-article-what-is-hachozeh.png', { mask: masks });

    gate.assertClean();
  });

  test('no horizontal overflow at 390px (warn 360px)', async ({ page }) => {
    await loadAndAssert(page, `/help/${TOPIC}/${ARTICLE}`);
    await assertNoOverflow(page, `/help/${TOPIC}/${ARTICLE}`);
  });
});
