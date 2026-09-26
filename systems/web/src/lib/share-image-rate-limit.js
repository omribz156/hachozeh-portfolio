// Per-IP throttle for the on-demand share-image renderers (/share/**/*.png).
//
// Why this exists: these five endpoints run sharp on the Astro server, OUTSIDE
// the backend's Fastify rate limiter, and the win card's query params make every
// unique param combo a distinct render that skips the 5-minute HTTP cache. A
// loop over /share/claims/win.png?title=<random> would otherwise pin CPU — the
// exact "melts during a viral moment" surface the share-loop audit flagged.
//
// This is an in-memory bucket: correct for the current single web replica, and
// intentionally a floor, not the ceiling. The durable defense at scale is a
// Cloudflare edge rate rule on /share/*.png at cutover — DELETE-or-demote this
// once that lands (see workspace/tasks/reference/share-loop-audit.md). On
// scale-out the in-memory map goes per-replica (looser, never wrong).
import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

const WINDOW_MS = 60_000;
// Generous vs. real usage: a share-page view + a few unfurl-crawler fetches is
// well under 10/min. A flood loop trips this fast; humans never see it.
const MAX_PER_WINDOW = 40;

// Lazy-sweep tunables — evict expired buckets without a setInterval (keeps the
// module inert between requests, mirrors the backend limiter's approach).
const SWEEP_BUCKET_THRESHOLD = 5_000;
const SWEEP_INTERVAL_MS = 60_000;
const PROXY_TRUST_HEADER = "x-hachozeh-proxy-secret";
const PROXY_TRUST_ENV = "HACHOZEH_PROXY_SECRET";

const buckets = new Map();
let lastSweepAt = 0;

// Loopback peers are the trusted local proxy (Caddy in dev, the platform proxy
// in prod); only then is X-Forwarded-For meaningful. Otherwise the socket peer
// IS the client. Mirrors systems/back/src/http/client-ip.ts's trust model.
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);

function normalizeClientKey(value) {
  const clean = String(value || 'unknown').trim().replace(/[^\w:.:-]/g, '_').slice(0, 128);
  return clean || 'unknown';
}

function normalizeProxySecret(value) {
  return typeof value === "string" ? value.trim() : "";
}

function hasTrustedProxySecret(context, configuredSecret) {
  const expectedSecret = normalizeProxySecret(configuredSecret);
  if (!expectedSecret) return false;

  const providedSecret = normalizeProxySecret(context?.request?.headers?.get?.(PROXY_TRUST_HEADER));
  if (!providedSecret) return false;

  const expected = createHash("sha256").update(expectedSecret).digest();
  const provided = createHash("sha256").update(providedSecret).digest();
  return timingSafeEqual(expected, provided);
}

function resolveClientKey(context) {
  const direct = context?.clientAddress || '';
  const shouldTrustXffFromProxy = LOOPBACK.has(direct);
  const canTrustBySecret = hasTrustedProxySecret(context, process.env[PROXY_TRUST_ENV]);
  const shouldTrust = shouldTrustXffFromProxy || canTrustBySecret;

  if (!shouldTrust) return normalizeClientKey(direct);

  const xff = context?.request?.headers?.get?.('x-forwarded-for');
  const first = xff ? xff.split(',')[0]?.trim() : '';
  if (!first || isIP(first) === 0) return normalizeClientKey(direct);

  return normalizeClientKey(first);
}

function sweep(now) {
  const overSize = buckets.size > SWEEP_BUCKET_THRESHOLD;
  const overTime = now - lastSweepAt >= SWEEP_INTERVAL_MS;
  if (!overSize && !overTime) return;
  lastSweepAt = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function positiveNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

// Returns { allowed, retryAfterSec }. Call once at the top of each GET handler.
export function checkShareImageRateLimit(context, now = Date.now()) {
  sweep(now);

  const maxPerWindow = Math.floor(positiveNumber(context?.maxPerWindow, MAX_PER_WINDOW));
  const windowMs = Math.floor(positiveNumber(context?.windowMs, WINDOW_MS));
  const bucketName = String(context?.bucket || 'share-image').replace(/[^a-z0-9:_-]/gi, '').slice(0, 64) || 'share-image';
  const key = `${bucketName}:${resolveClientKey(context)}`;
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }

  if (bucket.count >= maxPerWindow) {
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }

  bucket.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}

// The 429 body is tiny and briefly cacheable — an unfurl crawler that trips this
// gets told to come back, without wasting a sharp render on the refusal.
export function shareImageRateLimitResponse(retryAfterSec) {
  return new Response('share image rate limit exceeded', {
    status: 429,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'retry-after': String(retryAfterSec || 1),
      'cache-control': 'no-store',
    },
  });
}

// Test-only reset so the limiter starts clean per case.
export function __resetShareImageRateLimit() {
  buckets.clear();
  lastSweepAt = 0;
}
