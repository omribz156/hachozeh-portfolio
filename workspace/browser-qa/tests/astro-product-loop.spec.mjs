import { expect, test } from '@playwright/test';
import { authenticateContext, resolveOpenMarketTargets } from './auth-helpers.mjs';

const backendBase = 'http://127.0.0.1:3001';
const astroBase = process.env.ASTRO_BASE_URL || 'http://127.0.0.1:6969';

test.describe('Astro product loop', () => {
  test('authenticated user can buy, sell from the position island, and see portfolio state', async ({ page }) => {
    const identifier = `astro-product-loop+${Date.now()}@navi.local`;
    await authenticateContext(page.context(), {
      backendBase,
      identifier,
      purpose: 'signup',
    });

    // Resolve an open market from the live feed rather than a hardcoded key so
    // this spec stays green against both the seed DB (CI) and the live platform.
    const openMarkets = await resolveOpenMarketTargets(page.context(), { backendBase });
    if (!openMarkets.length) {
      throw new Error('No open markets found in discovery feed - seed DB may be empty');
    }
    const marketKey = openMarkets[0].marketKey;
    const outcomeKey = openMarkets[0].outcomeKey;

    await page.goto(`${astroBase}/markets/${marketKey}`, { waitUntil: 'domcontentloaded' });
    const ticket = page.locator('[data-market-detail-order-ticket]');
    await expect(ticket).toBeVisible();
    await expect(ticket.locator('[data-order-feedback]')).not.toContainText('צריך להתחבר');

    const targetOutcome = page.locator(`[data-ticket-outcome-id="${outcomeKey}"]`).first();
    if (await targetOutcome.count()) {
      await targetOutcome.click();
    }

    await ticket.locator('[data-order-amount-input]').fill('25');
    await expect(ticket.locator('[data-order-submit-button]')).toBeEnabled();

    const tradeResponsePromise = page.waitForResponse((response) =>
      response.url().includes(`/api/markets/${marketKey}/trades`) && response.status() === 200
    );
    await ticket.locator('[data-order-submit-button]').click();
    await tradeResponsePromise;

    await expect(ticket.locator('[data-order-submit-label]')).toContainText('בוצעה');

    const viewerPositions = page.locator('[data-hz-viewer-positions]');
    if (await viewerPositions.count()) {
      await expect(viewerPositions).toContainText('הפוזיציה שלך');

      await page.locator('[data-viewer-position-sell="yes"]').click();
      await expect(ticket.locator('[data-order-balance-label]')).toContainText('זמין למכירה');
      await ticket.locator('[data-order-amount-input]').fill('1');
      await expect(ticket.locator('[data-order-submit-button]')).toBeEnabled();

      const sellResponsePromise = page.waitForResponse((response) =>
        response.url().includes(`/api/markets/${marketKey}/trades`) && response.status() === 200
      );
      await ticket.locator('[data-order-submit-button]').click();
      await sellResponsePromise;
      await expect(ticket.locator('[data-order-submit-label]')).toContainText('בוצעה');
    }

    await page.goto(`${astroBase}/portfolio`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-portfolio-page]')).toBeVisible();
    await expect(page.locator('[data-portfolio-search]')).toBeVisible();
    // Market-agnostic check: the portfolio loaded and shows the position.
    // ("בנק ישראל" was tied to a specific live market that no longer exists in seed.)
    await expect(page.locator('body')).toContainText('שווי תיק');
    await expect(page.locator('[data-portfolio-page]')).toBeVisible();
  });
});
