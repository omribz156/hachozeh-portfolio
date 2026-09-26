import { expect, test } from '@playwright/test';
import { authenticateContext } from './auth-helpers.mjs';

const backendBase = 'http://127.0.0.1:3001';
const astroBase = process.env.ASTRO_BASE_URL || 'http://127.0.0.1:6969';

test.describe('Astro header auth state', () => {
  test('header switches between guest and user chrome with logout', async ({ page }) => {
    const identifier = `astro-header+${Date.now()}@navi.local`;
    await page.addInitScript(() => {
      try {
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
        window.localStorage.setItem('navi_streak_seen', today);
      } catch {}
    });
    await page.goto(`${astroBase}/trending`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-site-shell]')).toHaveAttribute('data-shell-variant', 'landing-guest');
    await expect(page.locator('[data-shell-guest-actions]')).toBeVisible();
    await expect(page.locator('[data-shell-user-actions]')).toBeHidden();
    await expect(page.locator('[data-search-wrap]')).toBeVisible();

    await authenticateContext(page.context(), {
      backendBase,
      identifier,
      purpose: 'signup',
    });

    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page.locator('[data-site-shell]')).toHaveAttribute('data-shell-variant', 'landing-user');
    await expect(page.locator('[data-shell-user-actions]')).toBeVisible();
    await expect(page.locator('[data-shell-guest-actions]')).toBeHidden();
    await expect(page.locator('[data-search-wrap]')).toBeVisible();
    await expect.poll(async () => {
      const values = await page.locator('[data-shell-wallet-value]').evaluateAll((nodes) =>
        nodes.map((node) => node.textContent || '')
      );
      return values.length > 0 && values.every((value) => value.includes('V₪'));
    }).toBe(true);

    await page.locator('[data-search-input]').fill('בנק');
    const firstSearchResult = page.locator('[data-search-panel="markets"] .hz-shell__search-result').first();
    await expect(firstSearchResult).toBeVisible();
    await expect(firstSearchResult).toHaveAttribute('href', /^\/markets\//);

    await page.locator('[data-hamburger-trigger="user"]').click();
    const userMenu = page.locator('[data-hamburger-menu="user"]');
    await expect(userMenu).toBeVisible();
    await expect(userMenu).toContainText('מרכז עזרה');
    await expect(userMenu).toContainText('מסחר פעיל');
    await expect(userMenu).toContainText('תקנון');
    await expect(page.locator('[data-auth-logout]')).toBeVisible();

    await page.locator('[data-auth-logout]').click();
    await expect(page.locator('[data-site-shell]')).toHaveAttribute('data-shell-variant', 'landing-guest');
    await expect(page.locator('[data-shell-guest-actions]')).toBeVisible();
    await expect(page.locator('[data-shell-user-actions]')).toBeHidden();
    await expect(page.locator('[data-search-wrap]')).toBeVisible();
  });
});
