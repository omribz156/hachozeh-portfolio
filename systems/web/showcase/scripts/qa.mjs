import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../../showcase-dist/', import.meta.url));
const remoteOrigin = process.env.SHOWCASE_QA_ORIGIN;
if (remoteOrigin) {
  const target = new URL(remoteOrigin);
  assert.equal(target.protocol, 'https:', 'Remote QA requires HTTPS');
  assert.equal(target.origin, remoteOrigin, 'Provide an origin without a path or trailing slash');
  assert.ok(['hachozeh.com', 'www.hachozeh.com', 'hachozeh-showcase.pages.dev'].includes(target.hostname) || target.hostname.endsWith('.hachozeh-showcase.pages.dev'), 'Remote QA is limited to showcase deployments');
}
const receipts = fileURLToPath(new URL(remoteOrigin ? '../../../../test-results/showcase/remote/' : '../../../../test-results/showcase/', import.meta.url));
await mkdir(receipts, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const headers = (await readFile(join(root, '_headers'), 'utf8')).split('\n\n')[0].split('\n').slice(1).filter(Boolean).map(line => { const colon = line.indexOf(':'); return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()]; });
const redirects = new Map((await readFile(join(root, '_redirects'), 'utf8')).trim().split('\n').map(line => { const [from, to, status] = line.split(/\s+/); return [from, { to, status: Number(status) }]; }));
const server = createServer(async (req, res) => {
  for (const [name, value] of headers) res.setHeader(name, value);
  try {
    const url = new URL(req.url, 'http://localhost');
    const redirect = redirects.get(url.pathname);
    if (redirect) { res.writeHead(redirect.status, { Location: `${redirect.to}${url.search}` }); res.end(); return; }
    let path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (path !== resolve(root) && !path.startsWith(root)) throw new Error('path');
    if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
    res.setHeader('Content-Type', mime[extname(path)] || 'application/octet-stream');
    res.end(await readFile(path));
  } catch { res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(await readFile(join(root, '404.html'))); }
});
if (!remoteOrigin) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = remoteOrigin || `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const results = [];
try {
  for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }], ['narrow-mobile', { width: 320, height: 740 }]]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [], requests = [], failures = [], documentReads = [];
    const injectedHashes = new Set();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('request', request => requests.push({ url: request.url(), method: request.method() }));
    page.on('response', response => {
      if (response.status() >= 400) failures.push({ status: response.status(), url: response.url(), resourceType: response.request().resourceType(), purpose: response.request().headers()['sec-purpose'] || response.request().headers().purpose || null, cloudflare: Boolean(response.headers()['cf-ray']) });
      if (response.request().resourceType() === 'document' && response.status() === 200) {
        documentReads.push(response.text().then(html => {
          for (const [, script] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
            if (script.includes('window.__CF$cv$params') && script.includes('/cdn-cgi/challenge-platform/')) {
              injectedHashes.add(`sha256-${createHash('sha256').update(script).digest('base64')}`);
            }
          }
        }));
      }
    });
    await page.goto(origin, { waitUntil: 'networkidle' });
    const coldHome = await page.evaluate(() => ({ navigation: performance.getEntriesByType('navigation').map(n => ({ domContentLoaded: n.domContentLoadedEventEnd, load: n.loadEventEnd })), paint: performance.getEntriesByType('paint').map(p => ({ name: p.name, startTime: p.startTime })) }));
    assert.equal(await page.locator('.hz-card').count(), 5);
    await page.screenshot({ path: `${receipts}/${name}-home.png`, fullPage: true });
    await page.mouse.wheel(0, 800);
    await page.waitForTimeout(200);
    const sticky = await page.locator('.hz-shell-wrap').boundingBox();
    assert.ok(sticky.y >= -1 && sticky.y <= 1, `${name}: header not sticky: ${sticky.y}`);
    await page.mouse.wheel(0, -2000);
    await page.locator('[data-category-filter="travel"]').click();
    assert.equal(await page.locator('.hz-card:visible').count(), 1);
    await page.locator('[data-category-filter=""]').click();
    const search = page.locator('input[name=q]:visible').first();
    await search.fill('Wizz');
    assert.equal(await page.locator('.hz-card:visible').count(), 1);
    await search.fill('zzzz-not-a-market');
    assert.ok(await page.locator('[data-empty]').isVisible());
    await search.fill('');
    await page.locator('[data-sort]').selectOption('volume');
    await page.locator('.hz-card__link').first().click();
    await page.waitForLoadState('networkidle');
    assert.ok(await page.locator('[data-archive-chart] svg path').count() > 0, `${name}: chart missing`);
    const picker = page.locator('.chart-card__line-picker-button');
    assert.match(await picker.innerText(), /4\/7/, `${name}: distinct grouped series identities`);
    await picker.click();
    await page.locator('.chart-card__line-option:not([disabled])').first().click();
    assert.match(await picker.innerText(), /3\/7/, `${name}: series selection must change`);
    await picker.click();
    await page.locator('.chart-card__range-tab').filter({ hasText: /^1D$/ }).click();
    await page.waitForFunction(() => document.querySelector('.chart-card__range-tab--active')?.textContent === '1D');
    await page.getByRole('button', { name: 'הגדרות גרף', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'הגדרות גרף', exact: true }).getAttribute('aria-expanded'), 'true');
    await page.getByRole('button', { name: 'הגדרות גרף', exact: true }).click();
    await page.screenshot({ path: `${receipts}/${name}-market.png`, fullPage: true });
    await page.locator('.showcase-outcome a').first().click();
    await page.waitForLoadState('networkidle');
    assert.ok(new URL(page.url()).pathname.startsWith('/markets/'));
    assert.equal(await page.locator('[data-market-dispute]').count(), 0, 'Archive must not offer a live dispute action');
    const toggle = page.locator('[data-market-detail-trust-toggle]').nth(1);
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    await page.goto(`${origin}/portfolio/`, { waitUntil: 'networkidle' });
    assert.equal(await page.locator('.pf-position-row').count(), 3);
    await page.getByRole('tab', { name: 'שבוע', exact: true }).click();
    assert.equal(await page.getByRole('tab', { name: 'שבוע', exact: true }).getAttribute('aria-selected'), 'true');
    assert.ok(await page.locator('.hz-pnl-spark path').count() > 0, `${name}: portfolio chart missing`);
    await page.getByRole('searchbox', { name: 'חיפוש בתיק לדוגמה' }).fill('Wizz');
    assert.equal(await page.locator('.pf-position-row').count(), 1);
    await page.getByRole('searchbox', { name: 'חיפוש בתיק לדוגמה' }).fill('');
    await page.screenshot({ path: `${receipts}/${name}-portfolio.png`, fullPage: true });
    const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(overflow.scroll <= overflow.width + 1, `${name}: overflow ${JSON.stringify(overflow)}`);
    const unsafe = requests.filter(r => new URL(r.url).pathname.startsWith('/api/') || r.method !== 'GET');
    assert.deepEqual(unsafe, [], 'No API/auth/trade requests allowed');
    await Promise.all(documentReads);
    const providerWarnings = errors.filter(error => error.includes('violates the following Content Security Policy directive') && (
      error.startsWith("Loading the script 'https://static.cloudflareinsights.com/beacon.min.js/") ||
      (error.startsWith('Executing inline script') && [...injectedHashes].some(hash => error.includes(`a hash ('${hash}')`)))
    ));
    assert.deepEqual(errors.filter(error => !providerWarnings.includes(error)), [], `${name} application JS errors`);
    // Cloudflare Speed Brain returns 503 for unavailable speculative cache entries.
    // Keep those receipts; actual navigation and required-resource failures still fail.
    assert.deepEqual(failures.filter(failure => !(failure.status === 503 && failure.purpose === 'prefetch' && failure.resourceType === 'other' && failure.cloudflare)), [], `${name} failed required resources`);
    results.push({ viewport: name, requests: requests.length, errors, providerWarnings, failures, apiRequests: unsafe, overflow, coldHome, performance: await page.evaluate(() => ({ navigation: performance.getEntriesByType('navigation').map(n => ({ domContentLoaded: n.domContentLoadedEventEnd, load: n.loadEventEnd })), paint: performance.getEntriesByType('paint').map(p => ({ name: p.name, startTime: p.startTime })) })) });
    await context.close();
  }
  const routes = [];
  async function collect(dir, prefix = '') {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) await collect(join(dir, entry.name), `${prefix}/${entry.name}`);
      else if (entry.name === 'index.html') routes.push(`${prefix}/`);
    }
  }
  await collect(root);
  for (const [from, { to, status }] of redirects) {
    const response = await fetch(`${origin}${from}`, { redirect: 'manual' });
    assert.equal(response.status, status, from);
    assert.equal(new URL(response.headers.get('location'), origin).href, new URL(to, origin).href, from);
    assert.equal((await fetch(`${origin}${to}`)).status, 200, `${from}: redirect destination`);
  }
  const context = await browser.newContext({ viewport: { width: 320, height: 740 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const routeErrors = [];
  page.on('pageerror', error => routeErrors.push(error.message));
  for (const route of routes) {
    const response = await page.goto(`${origin}${route}`, { waitUntil: 'networkidle' });
    assert.equal(response.status(), 200, route);
    const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(dimensions.scroll <= dimensions.width + 1, `${route}: narrow overflow ${JSON.stringify(dimensions)}`);
    assert.ok((await page.locator('main').innerText()).trim().length > 20, `${route}: blank content`);
  }
  assert.equal((await page.goto(`${origin}/missing-showcase-route/`)).status(), 404);
  assert.deepEqual(routeErrors, [], 'Route matrix JS errors');
  await context.close();
  await writeFile(`${receipts}/receipt.json`, JSON.stringify({ testedAt: new Date().toISOString(), origin, results, routesChecked: routes.length, redirectsChecked: redirects.size, missingRouteStatus: 404 }, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); if (server.listening) await new Promise(resolve => server.close(resolve)); }
