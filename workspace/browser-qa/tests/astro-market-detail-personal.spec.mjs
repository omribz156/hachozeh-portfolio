import { expect, test } from '@playwright/test';
import { authenticateContext, resolveOpenMarketTargets } from './auth-helpers.mjs';

const backendBase = 'http://127.0.0.1:3001';
const astroBase = process.env.ASTRO_BASE_URL || 'http://127.0.0.1:6969';
const seededMultiMarketKey = 'next-prime-minister';

async function resolveFirstOpenMarket(context) {
  const openMarkets = await resolveOpenMarketTargets(context, { backendBase });
  if (!openMarkets.length) {
    throw new Error('No open markets found in discovery feed - seed DB may be empty');
  }
  return openMarkets[0].marketKey;
}

async function suppressStreak(page) {
  await page.route('**/api/wallet/faucets', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        faucets: {
          dailyLogin: { canClaim: false, rewardAmount: 0, nextStreakDay: 0, currentStreakDay: 3 },
          emergency: { canClaim: false, rewardAmount: 0 },
        },
        liquidBalance: 350,
        hasActivePosition: true,
      }),
    });
  });
}

test.describe('Astro market detail personal state', () => {
  test('authenticated user with no holdings cannot sell', async ({ page }) => {
    const identifier = `astro-no-holdings+${Date.now()}@navi.local`;
    await authenticateContext(page.context(), {
      backendBase,
      identifier,
      purpose: 'signup',
    });

    const marketKey = await resolveFirstOpenMarket(page.context());
    await suppressStreak(page);
    await page.goto(`${astroBase}/markets/${marketKey}`, { waitUntil: 'domcontentloaded' });

    const ticket = page.locator('[data-market-detail-order-ticket]');
    await expect(ticket).toBeVisible();
    await expect(ticket.locator('[data-order-feedback]')).not.toContainText('צריך להתחבר');

    await ticket.locator('[data-order-side-toggle="sell"]').click();

    await expect(ticket).toHaveAttribute('data-order-side', 'sell');
    await expect(ticket.locator('[data-order-feedback]')).toBeHidden();
    await expect(ticket.locator('[data-order-submit-button]')).toBeDisabled();
    await expect(ticket.locator('[data-order-submit-button]')).toContainText('אין פוזיציה למכירה');
  });

  test('outcome row actions drive the order ticket', async ({ page }) => {
    const marketKey = seededMultiMarketKey;
    await page.goto(`${astroBase}/markets/${marketKey}`, { waitUntil: 'domcontentloaded' });

    const ticket = page.locator('[data-market-detail-order-ticket]');
    test.skip(
      (await ticket.count()) === 0,
      'seeded multi market is not tradeable in this environment'
    );

    await expect(ticket).toBeVisible();
    await expect(ticket).toHaveAttribute('data-status', 'open');

    const outcomeButtons = page.locator('[data-ticket-outcome-id]');
    const outcomeCount = await outcomeButtons.count();
    expect(outcomeCount).toBeGreaterThan(0);

    const targetButton = outcomeButtons.nth(Math.min(1, outcomeCount - 1));
    const outcomeId = await targetButton.getAttribute('data-ticket-outcome-id');
    const contractSide = await targetButton.getAttribute('data-ticket-contract-side');

    await targetButton.click();

    await expect(ticket).toHaveAttribute('data-selected-outcome', outcomeId || '');
    await expect(ticket).toHaveAttribute('data-active-side', contractSide || '');
  });

  test('authenticated user sees real market trade state', async ({ page }) => {
    const identifier = `astro-multi-buy+${Date.now()}@navi.local`;
    await authenticateContext(page.context(), {
      backendBase,
      identifier,
      purpose: 'signup',
    });

    const marketKey = await resolveFirstOpenMarket(page.context());
    await suppressStreak(page);
    await page.goto(`${astroBase}/markets/${marketKey}`, { waitUntil: 'domcontentloaded' });

    const ticket = page.locator('[data-market-detail-order-ticket]');
    await expect(ticket).toBeVisible();
    await expect(ticket).toHaveAttribute('data-status', 'open');
    await expect(ticket.locator('[data-order-feedback]')).not.toContainText('צריך להתחבר');

    const firstYes = page
      .locator('[data-ticket-outcome-id][data-ticket-contract-side="yes"]')
      .first();

    if (await firstYes.count()) {
      await firstYes.click();
    }

    await ticket.locator('[data-order-amount-input]').fill('25');
    await expect(ticket.locator('[data-order-submit-button]')).toBeEnabled();
  });
});
