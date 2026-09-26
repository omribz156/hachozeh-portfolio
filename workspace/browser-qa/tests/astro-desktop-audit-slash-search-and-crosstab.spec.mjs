import { expect, test } from '@playwright/test';
import { authenticateContext } from './auth-helpers.mjs';

const backendBase = 'http://127.0.0.1:3001';
const astroBase = process.env.ASTRO_BASE_URL || 'http://127.0.0.1:6969';

test.describe('Desktop audit 3.3 — "/" focuses header search', () => {
  test('activeElement checks: feed / typing-inside-input / overlay-open', async ({ page }) => {
    await page.goto(`${astroBase}/trending`, { waitUntil: 'domcontentloaded' });

    // (a) "/" on the feed focuses search.
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('/');
    const focusedIsSearch = await page.evaluate(() => {
      const input = document.querySelector('[data-search-input]');
      return document.activeElement === input;
    });
    expect(focusedIsSearch).toBe(true);
    const wrapOpen = await page.evaluate(() =>
      document.querySelector('[data-search-wrap]')?.classList.contains('is-open')
    );
    expect(wrapOpen).toBe(true);

    // Reset focus, close search.
    await page.keyboard.press('Escape');
    await page.locator('body').click({ position: { x: 5, y: 5 } });

    // (b) typing "/" inside the search input inserts a literal slash — no hijack.
    await page.locator('[data-search-input]').click();
    await page.locator('[data-search-input]').fill('');
    await page.keyboard.type('a/b');
    await expect(page.locator('[data-search-input]')).toHaveValue('a/b');

    await page.locator('[data-search-input]').fill('');
    await page.keyboard.press('Escape');
    await page.locator('body').click({ position: { x: 5, y: 5 } });

    // (c) "/" with an overlay open does nothing (login overlay via ?overlay=login).
    await page.goto(`${astroBase}/trending?overlay=login`, { waitUntil: 'domcontentloaded' });
    await expect.poll(async () =>
      page.evaluate(() => document.body.classList.contains('overlay-open'))
    ).toBe(true);
    await page.keyboard.press('/');
    const focusedDuringOverlay = await page.evaluate(() => {
      const input = document.querySelector('[data-search-input]');
      return document.activeElement === input;
    });
    expect(focusedDuringOverlay).toBe(false);
    const wrapOpenDuringOverlay = await page.evaluate(() =>
      document.querySelector('[data-search-wrap]')?.classList.contains('is-open')
    );
    expect(wrapOpenDuringOverlay).toBe(false);
  });
});

test.describe('Desktop audit 3.5 — cross-tab auth sync', () => {
  test('login in tab A reflects in tab B within ~2s; logout in A propagates to B', async ({ browser }) => {
    const context = await browser.newContext();
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    await pageA.goto(`${astroBase}/trending`, { waitUntil: 'domcontentloaded' });
    await pageB.goto(`${astroBase}/trending`, { waitUntil: 'domcontentloaded' });

    await expect(pageA.locator('[data-site-shell]')).toHaveAttribute('data-shell-variant', 'landing-guest');
    await expect(pageB.locator('[data-site-shell]')).toHaveAttribute('data-shell-variant', 'landing-guest');

    const identifier = `astro-crosstab+${Date.now()}@navi.local`;
    await authenticateContext(context, {
      backendBase,
      identifier,
      purpose: 'signup',
    });

    // Tab A still needs its OWN client-side state to learn about the new cookie —
    // trigger it the same way a real login overlay would (refreshSession), since
    // authenticateContext() only performs the raw API calls, not the UI flow.
    await pageA.evaluate(() => window.NaviAuthSession?.refreshSession?.());
    await expect(pageA.locator('[data-site-shell]')).toHaveAttribute('data-shell-variant', 'landing-user');

    // Tab B must pick up the beacon + re-validate WITHOUT a manual reload.
    await expect.poll(
      async () => pageB.locator('[data-site-shell]').getAttribute('data-shell-variant'),
      { timeout: 5000, intervals: [250, 250, 250, 500, 500] }
    ).toBe('landing-user');
    await expect.poll(async () => {
      const values = await pageB.locator('[data-shell-wallet-value]').evaluateAll((nodes) =>
        nodes.map((node) => node.textContent || '')
      );
      return values.length > 0 && values.every((value) => value.includes('V₪'));
    }).toBe(true);

    // Logout in A must propagate to B. bindLogout() hard-navigates tab A to "/"
    // after the API call resolves, so wait for that navigation rather than
    // asserting on the pre-navigation DOM (which would race the redirect).
    await pageA.locator('[data-hamburger-trigger="user"]').click();
    await Promise.all([
      pageA.waitForURL(`${astroBase}/`),
      pageA.locator('[data-auth-logout]').click(),
    ]);
    await expect(pageA.locator('[data-site-shell]')).toHaveAttribute('data-shell-variant', 'landing-guest');

    await expect.poll(
      async () => pageB.locator('[data-site-shell]').getAttribute('data-shell-variant'),
      { timeout: 5000, intervals: [250, 250, 250, 500, 500] }
    ).toBe('landing-guest');
    await expect(pageB.locator('[data-shell-guest-actions]')).toBeVisible();
    await expect(pageB.locator('[data-shell-user-actions]')).toBeHidden();

    await context.close();
  });
});
