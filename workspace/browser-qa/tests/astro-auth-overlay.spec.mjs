import { test, expect } from '@playwright/test';
import { resolveOpenMarketTargets } from './auth-helpers.mjs';

const ASTRO_BASE = process.env.ASTRO_BASE_URL || 'http://127.0.0.1:6969';
const BACKEND_BASE = 'http://127.0.0.1:3001';

// Resolved once per worker: first open market from the discovery feed so the
// spec stays green against both seed DB (CI) and the live platform.
let _resolvedMarketUrl = null;
async function getMarketUrl(context) {
  if (_resolvedMarketUrl) return _resolvedMarketUrl;
  const openMarkets = await resolveOpenMarketTargets(context, { backendBase: BACKEND_BASE });
  if (!openMarkets.length) throw new Error('No open markets in discovery feed');
  _resolvedMarketUrl = `${ASTRO_BASE}/markets/${openMarkets[0].marketKey}`;
  return _resolvedMarketUrl;
}

async function readCurrentUserStatus(context) {
  const response = await context.request.get(`${ASTRO_BASE}/api/me`);
  return response.status();
}

async function submitEmailAuth(page, identifier, purpose = 'signup') {
  const startResponsePromise = page.waitForResponse((response) =>
    response.url().includes('/api/auth/start')
  );
  await page.locator('.navi-overlay-panel input[type="email"]').fill(identifier);
  await page.locator(`[data-overlay-submit="${purpose}"] button[type="submit"]`).click();

  const startResponse = await startResponsePromise;
  const startPayload = await startResponse.json();
  expect(startResponse.status()).toBe(200);

  const code = startPayload.devCode || '111111';
  const codeBoxes = page.locator('[data-otp-box]');
  const boxCount = await codeBoxes.count();
  if (boxCount > 0) {
    await expect(codeBoxes).toHaveCount(6);
    await codeBoxes.first().click();
    await page.keyboard.type(code);
  } else {
    await page.locator('[data-otp-code]').fill(code);
    await page.locator('[data-overlay-submit="otp"] button[type="submit"]').click();
  }

  return startPayload;
}

test.describe('Astro auth overlay', () => {
  test('login, signup, and OTP render with real auth hooks', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (msg) => {
      if (
        msg.type() === 'error' &&
        !msg.text().includes('Failed to load resource: the server responded with a status of 401')
      ) {
        errors.push(msg.text());
      }
    });

    await page.goto(`${ASTRO_BASE}/trending?overlay=login`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-page-overlay-root][data-active="true"] .navi-overlay-panel')).toBeVisible();
    await expect(page.locator('.navi-overlay-title')).toContainText('ברוך הבא חזרה');
    await expect(page.locator('.navi-overlay-panel [data-auth-provider="google"]')).toHaveCount(1);
    await expect(page.locator('.navi-overlay-panel input[type="email"]')).toHaveCount(1);

    await page.locator('.navi-overlay-switch [data-overlay-open="signup"]').click();
    await expect(page.locator('.navi-overlay-title')).toContainText('פתח חשבון');

    await page.evaluate(() => {
      window.history.pushState({}, '', '/trending?overlay=otp');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    await expect(page.locator('[data-otp-code]')).toHaveCount(1);
    await expect(page.locator('[data-otp-code]')).toHaveAttribute('type', 'hidden');
    await expect(page.locator('[data-otp-box]')).toHaveCount(6);
    expect(errors).toEqual([]);
  });

  test('email OTP login accepts the backend dev code and exits success overlay', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (msg) => {
      if (
        msg.type() === 'error' &&
        !msg.text().includes('Failed to load resource: the server responded with a status of 401')
      ) {
        errors.push(msg.text());
      }
    });
    const identifier = `astro-auth-ui+${Date.now()}@navi.local`;

    await page.goto(`${ASTRO_BASE}/trending?overlay=signup`, { waitUntil: 'domcontentloaded' });
    await submitEmailAuth(page, identifier, 'signup');
    await expect(page.locator('.navi-overlay-success')).toBeVisible();
    await expect(page).toHaveURL(/(?:\/|\/trending)$/);
    await expect(page.locator('[data-page-overlay-root]')).toHaveAttribute('data-active', 'false');
    await expect(page.locator('[data-site-shell]')).toHaveAttribute('data-shell-variant', 'landing-user');
    await expect.poll(async () => {
      return readCurrentUserStatus(page.context());
    }).toBe(200);

    await page.locator('[data-hamburger-trigger="user"]').click();
    await page.locator('[data-auth-logout]').click();
    await expect(page.locator('[data-site-shell]')).toHaveAttribute('data-shell-variant', 'landing-guest');
    await expect.poll(async () => {
      return readCurrentUserStatus(page.context());
    }).toBe(401);

    await page.goto(`${ASTRO_BASE}/trending?overlay=auth-success`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-page-overlay-root]')).toHaveAttribute('data-active', 'false');
    expect(errors).toEqual([]);
  });

  test('portfolio gates signed-out users and loads real account after signup', async ({ page }) => {
    const identifier = `astro-portfolio-auth+${Date.now()}@navi.local`;

    await page.goto(`${ASTRO_BASE}/portfolio`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-portfolio-auth-gate]')).toBeVisible();
    await expect(page.locator('[data-portfolio-auth-gate]')).toContainText('צריך להתחבר');

    await page.locator('[data-portfolio-auth-gate] [data-overlay-open="signup"]').click();
    await submitEmailAuth(page, identifier, 'signup');

    await expect(page).toHaveURL(/\/portfolio$/);
    await expect(page.locator('[data-page-overlay-root]')).toHaveAttribute('data-active', 'false');
    await expect(page.locator('[data-portfolio-auth-gate]')).toHaveCount(0);
    await expect(page.locator('[data-portfolio-search]')).toBeVisible();
    await expect(page.locator('[data-site-shell]')).toHaveAttribute('data-shell-variant', 'landing-user');
  });

  test('market detail signup stays on the market and refreshes the trade gate', async ({ page }) => {
    const identifier = `astro-market-auth+${Date.now()}@navi.local`;

    const marketUrl = await getMarketUrl(page.context());
    await page.goto(marketUrl, { waitUntil: 'domcontentloaded' });
    const ticket = page.locator('[data-market-detail-order-ticket]');
    await expect(ticket).toBeVisible();

    await ticket.locator('[data-order-amount-input]').fill('25');
    await ticket.locator('[data-order-submit-button]').click();
    await expect(page.locator('[data-page-overlay-root][data-active="true"]')).toBeVisible();
    await expect(page.locator('.navi-overlay-title')).toContainText('פתח חשבון');

    await submitEmailAuth(page, identifier, 'signup');

    // Assert we stayed on the same market page (key-agnostic: just /markets/ prefix).
    await expect(page).toHaveURL(/\/markets\//);
    await expect(page.locator('[data-page-overlay-root]')).toHaveAttribute('data-active', 'false');
    await expect(page.locator('[data-site-shell]')).toHaveAttribute('data-shell-variant', 'landing-user');
    // The ticket client only clears state.message when the input is touched
    // (onInput clears the stale error). Re-fill the amount now that the session
    // is established — this triggers the quote debounce and wipes any prior
    // auth-error text.
    await ticket.locator('[data-order-amount-input]').fill('25');
    await expect(ticket.locator('[data-order-feedback]')).not.toContainText('צריך להתחבר');
    await expect(ticket.locator('[data-order-submit-button]')).toBeEnabled();
  });

  test('auth_error query opens a visible retryable auth error on the same page', async ({ page }) => {
    await page.goto(`${ASTRO_BASE}/trending?auth_error=google&auth_error_code=access_denied`, {
      waitUntil: 'domcontentloaded',
    });

    await expect(page.locator('[data-page-overlay-root][data-active="true"]')).toBeVisible();
    await expect(page.locator('.navi-overlay-error-title')).toContainText('Google');
    await expect(page.locator('.navi-overlay-error-body')).toContainText('בוטלה');
    expect(page.url()).toContain('overlay=auth-error');
    expect(page.url()).not.toContain('auth_error=');
  });
});
