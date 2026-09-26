import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const ASTRO_BASE = process.env.ASTRO_BASE_URL || 'http://127.0.0.1:6969';
const reportDir = new URL('../../../reports/astro-migration/perf/', import.meta.url);

const routes = [
  { id: 'trending', path: '/trending', ready: '[data-trending-stage]' },
  { id: 'breaking', path: '/breaking-markets', ready: '[data-breaking-stage][data-ready]' },
  { id: 'portfolio', path: '/portfolio', ready: '[data-portfolio-page]' },
  {
    id: 'market-detail-binary',
    path: '/markets/disc-cm-image-bucket-boi-rate-august-20260831',
    ready: '[data-market-detail-order-ticket]',
  },
  {
    id: 'market-detail-multi',
    path: '/markets/disc-cm-weather-tlv-tdmax-2026-06-04-5out-b25k',
    ready: '[data-market-detail-order-ticket] [data-order-ticket-title]',
  },
];

test.describe('Astro UX performance smoke', () => {
  for (const route of routes) {
    test(`${route.id} has usable local UX timings`, async ({ page }) => {
      const response = await page.goto(`${ASTRO_BASE}${route.path}`, { waitUntil: 'load' });
      expect(response?.ok(), `${route.path} should load`).toBeTruthy();
      await expect(page.locator(route.ready).first()).toBeVisible();

      await page.waitForTimeout(350);

      const metrics = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0];
        const paints = Object.fromEntries(
          performance.getEntriesByType('paint').map((entry) => [entry.name, entry.startTime])
        );
        const resources = performance.getEntriesByType('resource');
        const failedResources = resources.filter((entry) => entry.duration === 0 && entry.transferSize === 0);

        return {
          ttfbMs: nav ? nav.responseStart - nav.requestStart : null,
          domContentLoadedMs: nav ? nav.domContentLoadedEventEnd - nav.startTime : null,
          loadMs: nav ? nav.loadEventEnd - nav.startTime : null,
          fcpMs: paints['first-contentful-paint'] ?? null,
          transferKb: nav ? Math.round((nav.transferSize || 0) / 102.4) / 10 : null,
          encodedBodyKb: nav ? Math.round((nav.encodedBodySize || 0) / 102.4) / 10 : null,
          resourceCount: resources.length,
          failedResourceCount: failedResources.length,
        };
      });

      await mkdir(reportDir, { recursive: true });
      await writeFile(
        new URL(`${route.id}.json`, reportDir),
        JSON.stringify({ route, metrics, checkedAt: new Date().toISOString() }, null, 2)
      );

      expect(metrics.ttfbMs, `${route.id} TTFB ${JSON.stringify(metrics)}`).toBeLessThan(1000);
      expect(metrics.domContentLoadedMs, `${route.id} DCL ${JSON.stringify(metrics)}`).toBeLessThan(2500);
      expect(metrics.loadMs, `${route.id} load ${JSON.stringify(metrics)}`).toBeLessThan(5000);
      expect(metrics.fcpMs, `${route.id} FCP ${JSON.stringify(metrics)}`).toBeLessThan(2500);
      expect(metrics.failedResourceCount, `${route.id} resource health ${JSON.stringify(metrics)}`).toBe(0);
    });
  }
});
