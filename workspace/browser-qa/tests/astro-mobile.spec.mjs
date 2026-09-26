import { test, expect, devices } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { runnableAstroTargets, astroMigrationTargets, resolveAstroTargets } from './astro-page-targets.mjs';

test.use({ ...devices['Pixel 7'] });

const screenshotDir = new URL('../../../reports/astro-migration/mobile/', import.meta.url);
const requestedRawTargets = process.env.BROWSER_QA_TARGETS || '';
const { requestedTargets, selectedTargets } = resolveAstroTargets(requestedRawTargets, astroMigrationTargets);
const mobileTargets = runnableAstroTargets(selectedTargets).filter(
  (target) => target.status !== 'redirect'
);

if (requestedTargets.length > 0 && selectedTargets.length !== requestedTargets.length) {
  test('browser QA target selection is valid', () => {
    const selectedIds = selectedTargets.map((target) => target.id);
    const missing = requestedTargets.filter((id) => !selectedIds.includes(id));
    throw new Error(`Unknown browser QA target(s): ${missing.join(', ')}`);
  });
}

test.describe('Astro mobile smoke', () => {
  for (const target of mobileTargets) {
    test(`${target.id} loads without horizontal overflow`, async ({ page }) => {
      const response = await page.goto(target.astro, { waitUntil: 'domcontentloaded' });
      expect(response?.ok(), `${target.astro} should load`).toBeTruthy();
      await expect(page.locator(target.mobileReadySelector || target.readySelector).first()).toBeVisible();
      await expect(page.locator('[data-shell-bottom-tabs]')).toBeVisible();
      await expect(page.locator('[data-shell-bottom-tabs] [data-tab="home"]')).toBeVisible();
      await expect(page.locator('[data-shell-bottom-tabs] [data-tab="search"]')).toBeVisible();
      await expect(page.locator('[data-shell-bottom-tabs] [data-tab="social"]')).toBeVisible();
      await expect(page.locator('[data-shell-bottom-tabs] [data-tab="portfolio"]')).toBeVisible();

      const shellChrome = await page.evaluate(() => {
        const shell = document.querySelector('.hz-shell-wrap');
        const tabs = document.querySelector('[data-shell-bottom-tabs]');
        return {
          shellPosition: shell ? getComputedStyle(shell).position : null,
          tabsPosition: tabs ? getComputedStyle(tabs).position : null,
        };
      });
      expect(shellChrome).toEqual({
        shellPosition: 'sticky',
        tabsPosition: 'fixed',
      });

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        bodyScrollWidth: document.body.scrollWidth,
      }));

      await mkdir(screenshotDir, { recursive: true });
      await page.screenshot({
        path: new URL(`${target.id}-mobile.png`, screenshotDir).pathname,
        fullPage: true,
      });

      expect(
        overflow.scrollWidth,
        `${target.id} should not overflow horizontally: ${JSON.stringify(overflow)}`
      ).toBeLessThanOrEqual(overflow.viewportWidth + 2);
    });
  }

  test('binary market exposes the mobile trade launcher without ticket overflow', async ({ page }) => {
    const target = astroMigrationTargets.find((item) => item.id === 'market-detail-binary');
    await page.goto(target.astro, { waitUntil: 'domcontentloaded' });

    const launcher = page.locator('[data-market-detail-mobile-launcher]');
    await expect(launcher).toBeVisible();
    await expect(launcher.locator('[data-market-detail-mobile-ticket-open]')).toHaveCount(2);

    await launcher.locator('[data-mobile-launcher-side="yes"]').click();
    await expect(page.locator('.market-detail-page')).toHaveClass(/market-detail-page--ticket-open/);
    await expect(page.locator('[data-market-detail-order-ticket]')).toBeVisible();

    const overflow = await page.evaluate(() => {
      const widget = document.querySelector('.market-detail-stage-order-widget');
      return {
        pageScrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        widgetScrollWidth: widget?.scrollWidth ?? 0,
        widgetClientWidth: widget?.clientWidth ?? 0,
      };
    });

    expect(overflow.pageScrollWidth).toBeLessThanOrEqual(overflow.viewportWidth + 2);
    expect(overflow.widgetScrollWidth).toBeLessThanOrEqual(overflow.widgetClientWidth + 2);
  });

  test('mobile shell stays sticky while scrolling and bottom search opens', async ({ page }) => {
    const target = astroMigrationTargets.find((item) => item.id === 'market-detail-binary');
    await page.goto(target.astro, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.market-detail-page-title')).toBeVisible();

    const before = await page.evaluate(() => {
      const shell = document.querySelector('.hz-shell-wrap');
      const bar = document.querySelector('.hz-shell__bar');
      const nav = document.querySelector('.hz-shell__nav');
      return {
        scrollY,
        shellDisplay: shell ? getComputedStyle(shell).display : null,
        shellPosition: shell ? getComputedStyle(shell).position : null,
        shellTop: shell?.getBoundingClientRect().top ?? null,
        shellHeight: shell?.getBoundingClientRect().height ?? 0,
        barTop: bar?.getBoundingClientRect().top ?? null,
        navTop: nav?.getBoundingClientRect().top ?? null,
      };
    });

    await page.evaluate(() => window.scrollTo(0, 520));
    await page.waitForTimeout(250);

    const after = await page.evaluate(() => {
      const shell = document.querySelector('.hz-shell-wrap');
      const bar = document.querySelector('.hz-shell__bar');
      const nav = document.querySelector('.hz-shell__nav');
      return {
        scrollY,
        shellDisplay: shell ? getComputedStyle(shell).display : null,
        shellPosition: shell ? getComputedStyle(shell).position : null,
        shellTop: shell?.getBoundingClientRect().top ?? null,
        shellHeight: shell?.getBoundingClientRect().height ?? 0,
        barTop: bar?.getBoundingClientRect().top ?? null,
        navTop: nav?.getBoundingClientRect().top ?? null,
      };
    });

    expect(before.shellDisplay).toBe('block');
    expect(before.shellPosition).toBe('sticky');
    expect(before.shellHeight).toBeGreaterThan(90);
    expect(after.scrollY).toBeGreaterThan(100);
    expect(after.shellTop).toBeGreaterThanOrEqual(-1);
    expect(after.shellTop).toBeLessThanOrEqual(1);
    expect(after.barTop).toBeGreaterThanOrEqual(-1);
    expect(after.barTop).toBeLessThanOrEqual(1);
    expect(after.navTop).toBeGreaterThan(40);

    await page.locator('[data-shell-bottom-tabs] [data-tab="search"]').click();
    await expect(page.locator('[data-search-wrap].is-mobile-open')).toBeVisible();
    await expect(page.locator('[data-search-input]')).toBeFocused();

    await mkdir(screenshotDir, { recursive: true });
    await page.screenshot({
      path: new URL('sticky-header-after-scroll-search-open.png', screenshotDir).pathname,
      fullPage: false,
    });
  });

  test('multi-outcome row action opens the mobile ticket without horizontal rail scroll', async ({ page }) => {
    const target = astroMigrationTargets.find((item) => item.id === 'market-detail-multi');
    await page.goto(target.astro, { waitUntil: 'domcontentloaded' });

    await expect(page.locator('[data-market-detail-mobile-launcher]')).toHaveCount(0);
    await page.locator('[data-ticket-outcome-id]').first().click();
    await expect(page.locator('.market-detail-page')).toHaveClass(/market-detail-page--ticket-open/);
    await expect(page.locator('[data-market-detail-order-ticket]')).toBeVisible();

    const overflow = await page.evaluate(() => {
      const widget = document.querySelector('.market-detail-stage-order-widget');
      return {
        pageScrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        widgetScrollWidth: widget?.scrollWidth ?? 0,
        widgetClientWidth: widget?.clientWidth ?? 0,
      };
    });

    expect(overflow.pageScrollWidth).toBeLessThanOrEqual(overflow.viewportWidth + 2);
    expect(overflow.widgetScrollWidth).toBeLessThanOrEqual(overflow.widgetClientWidth + 2);
  });
});
