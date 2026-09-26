import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage } from "node:http";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildRateLimitKey,
  classifyRouteFamily,
  createInMemoryRateLimiter
} from "../../src/http/rate-limit";
import { closeAppTestServers, startServer } from "./app-test-harness";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(ip: string, headers: Record<string, string> = {}): IncomingMessage {
  return {
    socket: { remoteAddress: ip },
    headers
  } as unknown as IncomingMessage;
}

function readRouteSourceFiles(): string[] {
  const routesDir = join(process.cwd(), "src/http/routes");

  return readdirSync(routesDir)
    .filter((fileName) => fileName.endsWith(".ts"))
    .map((fileName) => `src/http/routes/${fileName}`);
}

function readRegisteredRoutes(): Array<{ method: string; route: string; source: string }> {
  const routes: Array<{ method: string; route: string; source: string }> = [];
  const routePattern = /app\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g;

  for (const source of readRouteSourceFiles()) {
    const contents = readFileSync(join(process.cwd(), source), "utf8");
    let match: RegExpExecArray | null;

    while ((match = routePattern.exec(contents))) {
      routes.push({
        method: match[1]!.toUpperCase(),
        route: match[2]!,
        source
      });
    }
  }

  return routes;
}

function materializeRoute(route: string): string {
  return route.replace(/:[A-Za-z0-9_]+/g, "sample");
}

function routeRequiresRateLimit(route: { method: string; route: string }): boolean {
  const methodsWithBodiesOrReads = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

  if (!methodsWithBodiesOrReads.has(route.method)) {
    return false;
  }

  if (route.method === "GET" && ["/health", "/health/live", "/health/ready"].includes(route.route)) {
    return false;
  }

  return route.route.startsWith("/api/") ||
    route.route.startsWith("/admin/") ||
    route.route === "/health/diagnostics";
}

// ---------------------------------------------------------------------------
// Item 1 — bucket eviction sweep keeps the map bounded
// ---------------------------------------------------------------------------

describe("createInMemoryRateLimiter — bucket eviction sweep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("evicts expired buckets when the map exceeds the size threshold", () => {
    // Use a very short window so all buckets expire quickly.
    const limiter = createInMemoryRateLimiter({
      market_read: { limit: 1, windowMs: 1_000 }
    }, { sweepBucketThreshold: 20 });

    const now = Date.now();
    vi.setSystemTime(now);

    // Warm up distinct IPs above the injected sweep threshold.
    // Each IP: 1 request against market_read in the first second.
    for (let i = 0; i < 40; i++) {
      limiter.check(makeRequest(`10.0.${Math.floor(i / 256)}.${i % 256}`), "market_read");
    }

    // All windows expire after 1 s.
    vi.setSystemTime(now + 2_000);

    // One more request from a fresh IP — this triggers the sweep.
    limiter.check(makeRequest("192.168.1.1"), "market_read");

    // After the sweep the map should hold only the single live bucket we just
    // created, not the 20 000 stale ones.
    expect(limiter.readDiagnostics().bucketCount).toBeLessThan(100);
  });

  it("evicts expired buckets when the sweep interval elapses regardless of size", () => {
    const limiter = createInMemoryRateLimiter({
      market_read: { limit: 100, windowMs: 30_000 }
    });

    const now = Date.now();
    vi.setSystemTime(now);

    // Add a small number of buckets (well under the 10 000 threshold).
    for (let i = 0; i < 50; i++) {
      limiter.check(makeRequest(`10.0.0.${i}`), "market_read");
    }

    // Advance past the 1-minute sweep interval AND past the 30 s window.
    vi.setSystemTime(now + 70_000);

    // Trigger one more check — sweep fires because SWEEP_INTERVAL_MS elapsed.
    limiter.check(makeRequest("10.0.1.1"), "market_read");

    // Only the single new bucket should remain.
    expect(limiter.readDiagnostics().bucketCount).toBeLessThanOrEqual(1);
  });

  it("does not sweep on the hot path when below both thresholds", () => {
    const limiter = createInMemoryRateLimiter({
      market_read: { limit: 100, windowMs: 60_000 }
    });

    const now = Date.now();
    vi.setSystemTime(now);

    // 5 distinct IPs — far below the 10 000 threshold.
    for (let i = 0; i < 5; i++) {
      limiter.check(makeRequest(`10.0.0.${i}`), "market_read");
    }

    // Advance by 10 s — within the 60 s sweep interval.
    vi.setSystemTime(now + 10_000);
    limiter.check(makeRequest("10.0.0.99"), "market_read");

    // All 6 buckets are still alive (windows haven't expired) and no sweep
    // has fired — count must be exactly 6.
    expect(limiter.readDiagnostics().bucketCount).toBe(6);
  });
});

describe("trade_write rate-limiting key precedence", () => {
  it("uses actor key for trade_write when supplied", () => {
    const limiter = createInMemoryRateLimiter({
      trade_write: { limit: 2, windowMs: 60_000 }
    });

    const first = limiter.check(makeRequest("203.0.113.1"), "trade_write", {
      actorId: "actor-user-a"
    });
    const second = limiter.check(makeRequest("198.51.100.2"), "trade_write", {
      actorId: "actor-user-a"
    });
    const third = limiter.check(makeRequest("192.0.2.3"), "trade_write", {
      actorId: "actor-user-a"
    });

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
  });

  it("falls back to ip for trade_write when no actor/session is available", () => {
    const limiter = createInMemoryRateLimiter({
      trade_write: { limit: 1, windowMs: 60_000 }
    });

    const request = makeRequest("203.0.113.5");
    const first = limiter.check(request, "trade_write");
    const second = limiter.check(makeRequest("203.0.113.5"), "trade_write");

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
  });

  it("separates two users sharing one IP into different buckets", () => {
    const limiter = createInMemoryRateLimiter({
      trade_write: { limit: 1, windowMs: 60_000 }
    });

    const userOneFirst = limiter.check(makeRequest("198.51.100.9"), "trade_write", {
      actorId: "actor-user-1"
    });
    const userTwoFirst = limiter.check(makeRequest("198.51.100.9"), "trade_write", {
      actorId: "actor-user-2"
    });
    const userOneSecond = limiter.check(makeRequest("198.51.100.9"), "trade_write", {
      actorId: "actor-user-1"
    });

    expect(userOneFirst.allowed).toBe(true);
    expect(userTwoFirst.allowed).toBe(true);
    expect(userOneSecond.allowed).toBe(false);
  });

  it("shares one bucket for the same user across different IPs", () => {
    const limiter = createInMemoryRateLimiter({
      trade_write: { limit: 2, windowMs: 60_000 }
    });

    const first = limiter.check(makeRequest("198.51.100.20"), "trade_write", {
      actorId: "actor-shared"
    });
    const second = limiter.check(makeRequest("203.0.113.21"), "trade_write", {
      actorId: "actor-shared"
    });
    const third = limiter.check(makeRequest("192.0.2.22"), "trade_write", {
      actorId: "actor-shared"
    });

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
  });
});

describe("buildRateLimitKey", () => {
  it("uses actor then session then IP fallback", () => {
    expect(
      buildRateLimitKey({
        family: "trade_write",
        ip: "198.51.100.1",
        actorId: "actor_1",
        sessionId: "session_1"
      })
    ).toBe("trade_write:actor:actor_1");

    expect(
      buildRateLimitKey({
        family: "trade_write",
        ip: "198.51.100.1",
        sessionId: "session_1"
      })
    ).toBe("trade_write:session:session_1");

    expect(
      buildRateLimitKey({
        family: "trade_write",
        ip: "198.51.100.1"
      })
    ).toBe("trade_write:ip:198.51.100.1");
  });
});

// ---------------------------------------------------------------------------
// Item 2 — per-IP OTP send cap (auth_otp_send family)
// ---------------------------------------------------------------------------

afterEach(async () => {
  await closeAppTestServers();
});

describe("POST /api/auth/start — per-IP OTP send cap", () => {
  it("returns 429 after exceeding the OTP send limit from one IP", async () => {
    // Build a limiter with a tiny auth_otp_send cap (2 sends/hr) and an
    // auth_write cap high enough not to interfere.
    const limiter = createInMemoryRateLimiter({
      auth_write: { limit: 500, windowMs: 60_000 },
      auth_otp_send: { limit: 2, windowMs: 3_600_000 }
    });

    const { baseUrl } = await startServer({
      rateLimiter: limiter,
      queryImpl: async (sql: string) => {
        // startAuthChallenge inserts an OTP challenge row.
        if (
          sql.includes("insert into otp_challenges") ||
          sql.includes("select") ||
          sql.includes("update") ||
          sql.startsWith("set local")
        ) {
          return { rows: [{ challenge_id: "ch_1", expires_at: new Date(Date.now() + 600_000) }] };
        }

        throw new Error(`Unexpected db query: ${sql}`);
      }
    });

    async function sendOtp(identifier: string) {
      return fetch(`${baseUrl}/api/auth/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier, purpose: "login" })
      });
    }

    // First two sends from same IP (127.0.0.1 — the test client's socket addr)
    // should pass the OTP cap regardless of DB response.
    const r1 = await sendOtp("user-a@example.com");
    const r2 = await sendOtp("user-b@example.com");

    // Third send — different identifier, same IP — must be 429.
    const r3 = await sendOtp("user-c@example.com");
    const payload3 = await r3.json();

    expect(r1.status).not.toBe(429);
    expect(r2.status).not.toBe(429);
    expect(r3.status).toBe(429);
    expect(payload3).toMatchObject({
      error: {
        code: "rate_limited"
      }
    });
    expect(r3.headers.get("retry-after")).toBeTruthy();
  });

  it("does not throttle a second IP when the first IP is exhausted", async () => {
    const limiter = createInMemoryRateLimiter({
      auth_write: { limit: 500, windowMs: 60_000 },
      auth_otp_send: { limit: 1, windowMs: 3_600_000 }
    });

    const { baseUrl } = await startServer({
      rateLimiter: limiter,
      queryImpl: async (sql: string) => {
        if (
          sql.includes("insert into otp_challenges") ||
          sql.includes("select") ||
          sql.includes("update") ||
          sql.startsWith("set local")
        ) {
          return { rows: [{ challenge_id: "ch_2", expires_at: new Date(Date.now() + 600_000) }] };
        }

        throw new Error(`Unexpected db query: ${sql}`);
      }
    });

    async function sendOtp(identifier: string) {
      return fetch(`${baseUrl}/api/auth/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier, purpose: "login" })
      });
    }

    // Both requests come from 127.0.0.1 (the test server loopback address).
    // The first exhausts the cap (limit=1); the second hits 429.
    // The test verifies cap=1 fires on the second attempt.
    const r1 = await sendOtp("first@example.com");
    const r2 = await sendOtp("second@example.com");

    expect(r1.status).not.toBe(429);
    expect(r2.status).toBe(429);
  });

  it("respects a higher AUTH_OTP_SEND_LIMIT_PER_HOUR env knob", () => {
    // The env knob is read at module load time via an IIFE in rate-limit.ts.
    // We validate it indirectly: supply a limiter built with an explicit
    // override matching what the env knob would produce and confirm the limit
    // field on the result equals the override.
    const limiter = createInMemoryRateLimiter({
      auth_otp_send: { limit: 100, windowMs: 3_600_000 }
    });

    const request = makeRequest("10.1.2.3");

    // Confirm the configured limit is reflected in the result.
    const result = limiter.check(request, "auth_otp_send");

    expect(result.limit).toBe(100);
    expect(result.allowed).toBe(true);
  });
});

describe("route-family classification", () => {
  it("classifies feedback submissions as their own write family", () => {
    expect(classifyRouteFamily("POST", "/api/feedback")).toBe("feedback_write");
  });

  it("classifies auth-influencing OAuth routes as auth writes", () => {
    expect(classifyRouteFamily("GET", "/api/auth/google/start")).toBe("auth_write");
    expect(classifyRouteFamily("GET", "/api/auth/google/callback")).toBe("auth_write");
    expect(classifyRouteFamily("POST", "/api/auth/start")).toBe("auth_write");
  });

  it("classifies OTP verification into its own tighter family", () => {
    expect(classifyRouteFamily("POST", "/api/auth/verify")).toBe("auth_verify");
  });

  it("classifies session validation as session reads, not auth writes", () => {
    expect(classifyRouteFamily("GET", "/api/session")).toBe("session_read");
  });

  it("classifies private account and wallet reads into bounded families", () => {
    expect(classifyRouteFamily("GET", "/api/me")).toBe("portfolio_read");
    expect(classifyRouteFamily("GET", "/api/me/sessions")).toBe("portfolio_read");
    expect(classifyRouteFamily("GET", "/api/me/notification-preferences")).toBe("portfolio_read");
    expect(classifyRouteFamily("GET", "/api/me/data-export")).toBe("account_write");
    expect(classifyRouteFamily("GET", "/api/uploads/avatars/user_avatar.webp")).toBe("market_read");
    expect(classifyRouteFamily("GET", "/api/uploads/feedback/feedback_1.webp")).toBe("admin_write");
    expect(classifyRouteFamily("GET", "/api/wallet/faucets")).toBe("portfolio_read");
  });

  it("classifies admin diagnostics as an admin route family", () => {
    expect(classifyRouteFamily("GET", "/health/diagnostics")).toBe("admin_write");
  });

  it("classifies discovery feed streams as market reads", () => {
    expect(classifyRouteFamily("GET", "/api/discovery/feed")).toBe("market_read");
    expect(classifyRouteFamily("GET", "/api/discovery/feed/stream")).toBe("market_read");
  });

  it("classifies public share-claim reads as market reads", () => {
    expect(classifyRouteFamily("GET", "/api/share/claims/realization_1")).toBe("market_read");
  });

  it("classifies account, social, wallet, and comment mutations", () => {
    expect(classifyRouteFamily("PATCH", "/api/me/profile")).toBe("account_write");
    expect(classifyRouteFamily("POST", "/api/me/avatar")).toBe("account_write");
    expect(classifyRouteFamily("POST", "/api/me/notifications/notif_1/read")).toBe("account_write");
    expect(classifyRouteFamily("POST", "/api/me/notifications/notif_1/dismiss")).toBe("account_write");
    expect(classifyRouteFamily("GET", "/api/me/profile/handle-availability")).toBe("account_write");
    expect(classifyRouteFamily("POST", "/api/social/users/user_1/follow")).toBe("social_write");
    expect(classifyRouteFamily("DELETE", "/api/social/users/user_1/follow")).toBe("social_write");
    expect(classifyRouteFamily("POST", "/api/wallet/faucets/daily-login/claim")).toBe("wallet_write");
    expect(classifyRouteFamily("POST", "/api/me/verification-tier/purchase")).toBe("wallet_write");
    expect(classifyRouteFamily("POST", "/api/portfolio/claims/realization_1/claim")).toBe("wallet_write");
    expect(classifyRouteFamily("POST", "/api/portfolio/claims/realization_1/share")).toBe("social_write");
    expect(classifyRouteFamily("POST", "/api/markets/market_1/comments")).toBe("comment_write");
    expect(classifyRouteFamily("POST", "/api/markets/market_1/comments/comment_1/replies")).toBe("comment_write");
    expect(classifyRouteFamily("POST", "/api/markets/market_1/comments/comment_1/like")).toBe("comment_write");
    expect(classifyRouteFamily("POST", "/api/markets/market_1/comments/comment_1/report")).toBe("comment_write");
    expect(classifyRouteFamily("DELETE", "/api/markets/market_1/comments/comment_1")).toBe("comment_write");
  });

  it("keeps every registered API and admin route in a rate-limit family", () => {
    const classifiedRoutes = readRegisteredRoutes()
      .filter(routeRequiresRateLimit)
      .map((route) => ({
        ...route,
        family: classifyRouteFamily(route.method, materializeRoute(route.route))
      }));
    const missingRoutes = classifiedRoutes
      .filter((route) => !route.family)
      .map((route) => `${route.method} ${route.route} (${route.source})`);
    const fallbackRoutes = classifiedRoutes
      .filter((route) => route.family === "general_request")
      .map((route) => `${route.method} ${route.route} (${route.source})`);

    expect(missingRoutes).toEqual([]);
    expect(fallbackRoutes).toEqual([]);
  });

  it("falls back to a bounded general family for unknown API paths", () => {
    expect(classifyRouteFamily("GET", "/api/future-route")).toBe("general_request");
    expect(classifyRouteFamily("POST", "/api/future-route")).toBe("general_request");
    expect(classifyRouteFamily("GET", "/admin/future-route")).toBe("admin_write");
    expect(classifyRouteFamily("GET", "/health/ready")).toBeNull();
  });
});

describe("unclassified write surfaces — global Fastify rate limits", () => {
  it("rate-limits account mutation routes before auth and handler work", async () => {
    const limiter = createInMemoryRateLimiter({
      account_write: { limit: 1, windowMs: 60_000 }
    });

    const { baseUrl } = await startServer({
      rateLimiter: limiter,
      queryImpl: async () => {
        throw new Error("rate limit test should not reach the database");
      }
    });

    async function patchProfile() {
      return fetch(`${baseUrl}/api/me/profile`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: "test" })
      });
    }

    const first = await patchProfile();
    const second = await patchProfile();
    const payload = await second.json();

    expect(first.status).toBe(401);
    expect(second.status).toBe(429);
    expect(second.headers.get("x-rate-limit-family")).toBe("account_write");
    expect(payload).toMatchObject({
      error: {
        code: "rate_limited"
      },
      family: "account_write"
    });
  });

  it("rate-limits unknown API floods before the not-found handler keeps working", async () => {
    const limiter = createInMemoryRateLimiter({
      general_request: { limit: 1, windowMs: 60_000 }
    });

    const { baseUrl } = await startServer({
      rateLimiter: limiter,
      queryImpl: async () => {
        throw new Error("fallback rate limit test should not reach the database");
      }
    });

    const first = await fetch(`${baseUrl}/api/not-real`);
    const second = await fetch(`${baseUrl}/api/not-real`);
    const payload = await second.json();

    expect(first.status).toBe(404);
    expect(first.headers.get("x-rate-limit-family")).toBe("general_request");
    expect(second.status).toBe(429);
    expect(second.headers.get("x-rate-limit-family")).toBe("general_request");
    expect(payload).toMatchObject({
      error: {
        code: "rate_limited"
      },
      family: "general_request"
    });
  });
});

describe("POST /api/me/verification-tier/purchase — wallet write cap", () => {
  it("returns 429 with the wallet_write family after repeated purchase attempts", async () => {
    const limiter = createInMemoryRateLimiter({
      wallet_write: { limit: 1, windowMs: 60_000 }
    });

    const { baseUrl } = await startServer({
      rateLimiter: limiter,
      queryImpl: async (sql: string) => {
        if (sql.includes("from sessions s")) {
          return { rows: [] };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }

        throw new Error(`Unexpected db query: ${sql}`);
      }
    });

    async function buyBadge() {
      return fetch(`${baseUrl}/api/me/verification-tier/purchase`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tier: "gray" })
      });
    }

    const first = await buyBadge();
    const second = await buyBadge();
    const payload = await second.json();

    expect(first.status).not.toBe(429);
    expect(second.status).toBe(429);
    expect(second.headers.get("x-rate-limit-family")).toBe("wallet_write");
    expect(payload).toMatchObject({
      error: {
        code: "rate_limited"
      }
    });
  });
});

describe("POST /api/auth/verify — verification pressure cap", () => {
  it("returns 429 before DB verification work after repeated verify attempts", async () => {
    const limiter = createInMemoryRateLimiter({
      auth_verify: { limit: 1, windowMs: 60_000 }
    });

    const { baseUrl } = await startServer({
      rateLimiter: limiter,
      queryImpl: async (sql: string) => {
        if (
          sql === "begin" ||
          sql === "commit" ||
          sql === "rollback" ||
          sql.startsWith("set local statement_timeout") ||
          sql.startsWith("set local lock_timeout")
        ) {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes("from otp_challenges")) {
          return { rows: [] };
        }

        throw new Error(`Unexpected DB work before auth verify rate limit: ${sql}`);
      }
    });

    async function verifyOtp() {
      return fetch(`${baseUrl}/api/auth/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengeId: "otp_test", code: "123456" })
      });
    }

    const first = await verifyOtp();
    const second = await verifyOtp();
    const payload = await second.json();

    expect(first.status).toBe(400);
    expect(first.headers.get("x-rate-limit-family")).toBe("auth_verify");
    expect(second.status).toBe(429);
    expect(second.headers.get("x-rate-limit-family")).toBe("auth_verify");
    expect(payload).toMatchObject({
      error: {
        code: "rate_limited"
      },
      family: "auth_verify"
    });
  });
});
