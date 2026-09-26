import assert from 'node:assert/strict';

import {
  checkShareImageRateLimit,
  shareImageRateLimitResponse,
  __resetShareImageRateLimit,
} from './share-image-rate-limit.js';

function ctx(ip, xff, proxySecret) {

  return {
    clientAddress: ip,
    request: {
      headers: {
        get: (name) => {
          if (name === 'x-forwarded-for') return xff;
          if (name === 'x-hachozeh-proxy-secret') return proxySecret;
          return null;
        },
      },
    },
  };
}

function withProxySecret(secret, block) {
  const previousSecret = process.env.HACHOZEH_PROXY_SECRET;
  if (secret === undefined) {
    delete process.env.HACHOZEH_PROXY_SECRET;
  } else {
    process.env.HACHOZEH_PROXY_SECRET = secret;
  }

  try {
    block();
  } finally {
    if (previousSecret === undefined) {
      delete process.env.HACHOZEH_PROXY_SECRET;
    } else {
      process.env.HACHOZEH_PROXY_SECRET = previousSecret;
    }
  }
}

// Allows a burst up to the window cap, then blocks with a retry-after.
__resetShareImageRateLimit();
{
  const now = 1_000_000;
  let last;
  for (let i = 0; i < 40; i += 1) {
    last = checkShareImageRateLimit(ctx('203.0.113.7'), now);
    assert.equal(last.allowed, true, `request ${i + 1} should be allowed`);
  }
  const blocked = checkShareImageRateLimit(ctx('203.0.113.7'), now);
  assert.equal(blocked.allowed, false, '41st request in window should be blocked');
  assert.ok(blocked.retryAfterSec >= 1, 'blocked response carries a retry-after');
}

// The window resets: after resetAt passes, the same IP flows again.
__resetShareImageRateLimit();
{
  const start = 2_000_000;
  for (let i = 0; i < 40; i += 1) checkShareImageRateLimit(ctx('203.0.113.8'), start);
  assert.equal(checkShareImageRateLimit(ctx('203.0.113.8'), start).allowed, false);
  const afterWindow = start + 60_001;
  assert.equal(
    checkShareImageRateLimit(ctx('203.0.113.8'), afterWindow).allowed,
    true,
    'a fresh window admits the IP again',
  );
}

// Distinct IPs get independent buckets — one flooder never blocks another user.
__resetShareImageRateLimit();
{
  const now = 3_000_000;
  for (let i = 0; i < 40; i += 1) checkShareImageRateLimit(ctx('198.51.100.1'), now);
  assert.equal(checkShareImageRateLimit(ctx('198.51.100.1'), now).allowed, false);
  assert.equal(
    checkShareImageRateLimit(ctx('198.51.100.2'), now).allowed,
    true,
    'a second IP is unaffected by the first IP being capped',
  );
}

// Route-specific buckets can be stricter without consuming the general bucket.
__resetShareImageRateLimit();
{
  const now = 3_500_000;
  for (let i = 0; i < 10; i += 1) {
    assert.equal(checkShareImageRateLimit({ ...ctx('192.0.2.10'), bucket: 'legacy-win', maxPerWindow: 10 }, now).allowed, true);
  }
  assert.equal(
    checkShareImageRateLimit({ ...ctx('192.0.2.10'), bucket: 'legacy-win', maxPerWindow: 10 }, now).allowed,
    false,
    'the stricter route bucket blocks at its own cap',
  );
  assert.equal(
    checkShareImageRateLimit(ctx('192.0.2.10'), now).allowed,
    true,
    'the general share-image bucket is still independent',
  );
}

// Behind a loopback proxy, X-Forwarded-For identifies the real client, so two
// users sharing the proxy peer land in different buckets.
__resetShareImageRateLimit();
{
  const now = 4_000_000;
  for (let i = 0; i < 40; i += 1) checkShareImageRateLimit(ctx('127.0.0.1', '203.0.113.20'), now);
  assert.equal(checkShareImageRateLimit(ctx('127.0.0.1', '203.0.113.20'), now).allowed, false);
  assert.equal(
    checkShareImageRateLimit(ctx('127.0.0.1', '203.0.113.21'), now).allowed,
    true,
    'XFF is honored only behind the trusted loopback peer, keying per real client',
  );
}

// A non-loopback gateway can still use XFF when it presents the internal proxy
// trust secret; forwarded visitors are then bucketed separately.
__resetShareImageRateLimit();
{
  withProxySecret('gateway-shared-secret', () => {
    const now = 4_500_000;
    for (let i = 0; i < 40; i += 1) {
      checkShareImageRateLimit(ctx('45.77.10.20', '203.0.113.20', 'gateway-shared-secret'), now);
    }
    assert.equal(
      checkShareImageRateLimit(ctx('45.77.10.20', '203.0.113.20', 'gateway-shared-secret'), now).allowed,
      false,
      'proxy-trusted forwarding uses XFF to separate forwarded visitors',
    );
    assert.equal(
      checkShareImageRateLimit(ctx('45.77.10.20', '198.51.100.21', 'gateway-shared-secret'), now).allowed,
      true,
      'a second forwarded client is independent when proxy trust is proven',
    );
  });
}

// Missing or malformed proxy-secret headers must not let a caller select buckets
// through attacker-chosen XFF values.
__resetShareImageRateLimit();
{
  withProxySecret(undefined, () => {
    const now = 5_000_000;
    for (let i = 0; i < 40; i += 1) {
      checkShareImageRateLimit(ctx('45.77.10.20', '203.0.113.20', 'attacker-secret'), now);
    }
    assert.equal(
      checkShareImageRateLimit(ctx('45.77.10.20', '198.51.100.21', 'attacker-secret'), now).allowed,
      false,
      'without a trusted secret, peer address remains the key',
    );
  });

  withProxySecret('gateway-shared-secret', () => {
    const now = 5_500_000;
    for (let i = 0; i < 40; i += 1) {
      checkShareImageRateLimit(ctx('45.77.11.20', 'not-an-ip', 'wrong-secret'), now);
    }
    assert.equal(
      checkShareImageRateLimit(ctx('45.77.11.20', '203.0.113.20', 'wrong-secret'), now).allowed,
      false,
      'malformed XFF values with trusted secret absent still collapse to peer bucket',
    );
  });
}

// Hostile proxy headers cannot create oversized map keys or escape bucket
// syntax; normalization keeps them deterministic without trusting the text.
__resetShareImageRateLimit();
{
  const now = 5_000_000;
  const longHeader = `${'x'.repeat(300)}<script>`;
  for (let i = 0; i < 40; i += 1) checkShareImageRateLimit(ctx('127.0.0.1', longHeader), now);
  assert.equal(
    checkShareImageRateLimit(ctx('127.0.0.1', longHeader), now).allowed,
    false,
    'oversized XFF values still resolve to one bounded client bucket',
  );
}

// The 429 helper is shaped for a crawler: no-store, retry-after, tiny body.
{
  const res = shareImageRateLimitResponse(7);
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('retry-after'), '7');
  assert.equal(res.headers.get('cache-control'), 'no-store');
}

console.log('share-image-rate-limit: all assertions passed');
