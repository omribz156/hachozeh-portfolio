const astroBaseUrl = process.env.STATUS_ASTRO_URL || 'http://127.0.0.1:4321';
const caddyBaseUrl = process.env.STATUS_CADDY_URL || 'http://127.0.0.1:6969';

const checks = [
  ['astro', `${astroBaseUrl}/trending`],
  ['astro-root', `${astroBaseUrl}/`],
  ['caddy', `${caddyBaseUrl}/trending`],
  ['portfolio', `${caddyBaseUrl}/portfolio`],
  ['breaking', `${caddyBaseUrl}/breaking-markets`],
  ['new-markets', `${caddyBaseUrl}/new-markets`],
  ['topic', `${caddyBaseUrl}/topics/economy`],
  ['settings', `${caddyBaseUrl}/settings`],
  ['backend', `${caddyBaseUrl}/health/ready`],
  ['discovery', `${caddyBaseUrl}/api/discovery/feed`],
];

const timeoutMs = Number(process.env.STATUS_TIMEOUT_MS || 3000);

async function check(name, url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const started = Date.now();
    const response = await fetch(url, { signal: controller.signal });
    const ms = Date.now() - started;
    const ok = response.ok;
    return { name, url, ok, status: response.status, ms };
  } catch (error) {
    return { name, url, ok: false, error: error?.message || String(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function firstMarketDetailCheck() {
  try {
    const response = await fetch(`${caddyBaseUrl}/api/discovery/feed`);
    if (!response.ok) return null;
    const payload = await response.json();
    const marketKey = payload?.items?.find((item) => item?.marketKey)?.marketKey;
    if (!marketKey) return null;
    return ['market', `${astroBaseUrl}/markets/${encodeURIComponent(marketKey)}`];
  } catch {
    return null;
  }
}

const marketCheck = await firstMarketDetailCheck();
const checksToRun = marketCheck ? [...checks, marketCheck] : checks;
const results = await Promise.all(checksToRun.map(([name, url]) => check(name, url)));

let failed = false;
for (const result of results) {
  if (!result.ok) failed = true;
  const label = result.ok ? 'ok' : 'fail';
  const detail = result.ok
    ? `${result.status} ${result.ms}ms`
    : result.error || `status ${result.status}`;
  console.log(`${label.padEnd(4)} ${result.name.padEnd(11)} ${detail} ${result.url}`);
}

if (failed) process.exit(1);
