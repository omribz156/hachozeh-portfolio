import type { IncomingMessage } from "node:http";
import { resolveClientIp } from "./client-ip";

export type RouteFamily =
  | "market_read"
  | "portfolio_read"
  | "session_read"
  | "trade_write"
  | "auth_write"
  | "auth_verify"
  | "auth_otp_send"
  | "account_write"
  | "comment_write"
  | "feedback_write"
  | "social_write"
  | "wallet_write"
  | "admin_write"
  | "oracle_write"
  | "general_request";

type RateLimitRule = {
  limit: number;
  windowMs: number;
};

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

export type RateLimitResult = {
  allowed: boolean;
  family: RouteFamily;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

export type RateLimitContext = {
  actorId?: string | null;
  sessionId?: string | null;
};

type RateLimiterOptions = {
  sweepBucketThreshold?: number;
  sweepIntervalMs?: number;
};

export function buildRateLimitKey(input: {
  family: string;
  ip: string;
  actorId?: string | null;
  sessionId?: string | null;
}): string {
  const actorId = input.actorId?.trim();
  if (actorId) {
    return `${input.family}:actor:${actorId}`;
  }

  const sessionId = input.sessionId?.trim();
  if (sessionId) {
    return `${input.family}:session:${sessionId}`;
  }

  return `${input.family}:ip:${input.ip}`;
}

export type RateLimiter = {
  check(
    request: IncomingMessage,
    family: RouteFamily,
    context?: RateLimitContext
  ): RateLimitResult;
};

/** Exposed for tests and diagnostics — not part of the request hot path. */
export type RateLimitDiagnostics = {
  bucketCount: number;
};

// Per-IP OTP-send cap: tighter hourly guard on top of auth_write.
// Env-tunable so CI and local dev can raise it without disabling auth_write.
// Default 10/hr — production value. CI sets AUTH_OTP_SEND_LIMIT_PER_HOUR=100.
const AUTH_OTP_SEND_LIMIT_PER_HOUR = (() => {
  const raw = process.env["AUTH_OTP_SEND_LIMIT_PER_HOUR"];
  if (!raw || !raw.trim()) return 10;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) || parsed < 1 ? 10 : parsed;
})();

const DEFAULT_RULES: Record<RouteFamily, RateLimitRule> = {
  market_read: { limit: 600, windowMs: 60_000 },
  portfolio_read: { limit: 240, windowMs: 60_000 },
  session_read: { limit: 240, windowMs: 60_000 },
  trade_write: { limit: 60, windowMs: 60_000 },
  auth_write: { limit: 80, windowMs: 60_000 },
  auth_verify: { limit: 30, windowMs: 60_000 },
  // Per-IP OTP send cap — EMAIL BOMBING / QUOTA BURN defence.
  // Applied in addition to auth_write on POST /api/auth/start only.
  auth_otp_send: { limit: AUTH_OTP_SEND_LIMIT_PER_HOUR, windowMs: 3_600_000 },
  account_write: { limit: 60, windowMs: 60_000 },
  comment_write: { limit: 30, windowMs: 60_000 },
  feedback_write: { limit: 30, windowMs: 60_000 },
  social_write: { limit: 60, windowMs: 60_000 },
  wallet_write: { limit: 20, windowMs: 60_000 },
  admin_write: { limit: 120, windowMs: 60_000 },
  oracle_write: { limit: 60, windowMs: 60_000 },
  general_request: { limit: 300, windowMs: 60_000 }
};

// Lazy-sweep tunables: evict expired buckets when either condition fires.
// No setInterval — keeps the module dependency-free and test-deterministic.
const SWEEP_BUCKET_THRESHOLD = 10_000; // trigger if map exceeds this size
const SWEEP_INTERVAL_MS = 60_000;      // trigger at most once per minute regardless

function readClientKey(request: IncomingMessage): string {
  return resolveClientIp(request);
}

function buildBucketKey(
  request: IncomingMessage,
  family: RouteFamily,
  context?: RateLimitContext
): string {
  return buildRateLimitKey({
    family,
    ip: readClientKey(request),
    actorId: context?.actorId,
    sessionId: context?.sessionId
  });
}

export function classifyRouteFamily(method: string, path: string): RouteFamily | null {
  if (method === "GET" && path.startsWith("/api/markets/")) {
    return "market_read";
  }

  if (method === "GET" && path === "/api/markets") {
    return "market_read";
  }

  if (method === "GET" && path === "/api/search") {
    return "market_read";
  }

  if (method === "GET" && path.startsWith("/api/market-families/")) {
    return "market_read";
  }

  if (method === "GET" && (path === "/api/tags" || path.startsWith("/api/tags/"))) {
    return "market_read";
  }

  if (method === "GET" && path.startsWith("/api/uploads/avatars/")) {
    return "market_read";
  }

  if (method === "GET" && path.startsWith("/api/uploads/feedback/")) {
    return "admin_write";
  }

  if (method === "GET" && path.startsWith("/api/social/")) {
    return "market_read";
  }

  if (method === "GET" && path.startsWith("/api/community/")) {
    return "market_read";
  }

  if (method === "GET" && path.startsWith("/api/market-detail/")) {
    return "market_read";
  }

  // Public share-claim read (unfurl crawlers + share-page SSR). Classify as a
  // read rather than let it fall through to general_request.
  if (method === "GET" && path.startsWith("/api/share/")) {
    return "market_read";
  }

  if (method === "GET" && path === "/api/discovery/feed") {
    return "market_read";
  }

  if (method === "GET" && path === "/api/discovery/feed/stream") {
    return "market_read";
  }

  if (method === "GET" && path.startsWith("/api/portfolio/")) {
    return "portfolio_read";
  }

  if (method === "GET" && path === "/api/wallet/faucets") {
    return "portfolio_read";
  }

  if (method === "POST" && /^\/api\/portfolio\/claims\/[^/]+\/claim$/.test(path)) {
    return "wallet_write";
  }

  // Share consent stamp: an identity-signal write, same weight as save/follow —
  // not a money path, but must not ride the loose general_request fallback.
  if (method === "POST" && /^\/api\/portfolio\/claims\/[^/]+\/share$/.test(path)) {
    return "social_write";
  }

  if (method === "POST" && /^\/api\/markets\/[^/]+\/(quote|trades)$/.test(path)) {
    return "trade_write";
  }

  if (
    ((method === "POST" && /^\/api\/markets\/[^/]+\/comments(\/[^/]+\/(replies|like|report))?$/.test(path)) ||
      (method === "DELETE" && /^\/api\/markets\/[^/]+\/comments\/[^/]+$/.test(path)))
  ) {
    return "comment_write";
  }

  // Community authored writes (new discussion, comment/reply, take/share post)
  // and moderation (report / delete-own) — same weight as market comments.
  if ((method === "POST" || method === "DELETE") && path.startsWith("/api/community/")) {
    return "comment_write";
  }

  if ((method === "POST" || method === "DELETE") && /^\/api\/markets\/[^/]+\/save$/.test(path)) {
    return "social_write";
  }

  if (method === "POST" && path.startsWith("/api/auth/")) {
    if (path === "/api/auth/verify") {
      return "auth_verify";
    }

    return "auth_write";
  }

  if (method === "GET" && path.startsWith("/api/auth/google/")) {
    return "auth_write";
  }

  if (method === "GET" && path === "/api/session") {
    return "session_read";
  }

  if (method === "POST" && path === "/api/me/verification-tier/purchase") {
    return "wallet_write";
  }

  if (method === "GET" && path === "/api/me/data-export") {
    return "account_write";
  }

  if (method === "GET" && path === "/api/me/profile/handle-availability") {
    return "account_write";
  }

  if (
    (method === "PATCH" || method === "POST" || method === "PUT" || method === "DELETE") &&
    path.startsWith("/api/me/")
  ) {
    return "account_write";
  }

  if (method === "GET" && (path === "/api/me" || path.startsWith("/api/me/"))) {
    return "portfolio_read";
  }

  if (method === "POST" && path === "/api/feedback") {
    return "feedback_write";
  }

  if ((method === "POST" || method === "DELETE") && path.startsWith("/api/social/")) {
    return "social_write";
  }

  if (method === "POST" && path.startsWith("/api/wallet/")) {
    return "wallet_write";
  }

  if (method === "GET" && path === "/health/diagnostics") {
    return "admin_write";
  }

  if (path.startsWith("/admin/oracle/")) {
    return "oracle_write";
  }

  if (path.startsWith("/admin/")) {
    return "admin_write";
  }

  if (path.startsWith("/api/") || path.startsWith("/admin/")) {
    return "general_request";
  }

  return null;
}

export function createInMemoryRateLimiter(
  overrides?: Partial<Record<RouteFamily, Partial<RateLimitRule>>>,
  options: RateLimiterOptions = {}
): RateLimiter & { readDiagnostics(): RateLimitDiagnostics } {
  const buckets = new Map<string, RateLimitBucket>();
  let lastSweepAt = 0;
  const sweepBucketThreshold = options.sweepBucketThreshold ?? SWEEP_BUCKET_THRESHOLD;
  const sweepIntervalMs = options.sweepIntervalMs ?? SWEEP_INTERVAL_MS;

  const rules = Object.fromEntries(
    Object.entries(DEFAULT_RULES).map(([family, rule]) => {
      const override = overrides?.[family as RouteFamily];

      return [
        family,
        {
          limit: override?.limit ?? rule.limit,
          windowMs: override?.windowMs ?? rule.windowMs
        }
      ];
    })
  ) as Record<RouteFamily, RateLimitRule>;

  function maybeSweep(now: number): void {
    if (buckets.size < sweepBucketThreshold && now - lastSweepAt < sweepIntervalMs) {
      return;
    }

    lastSweepAt = now;

    for (const [key, bucket] of buckets) {
      if (bucket.resetAt < now) {
        buckets.delete(key);
      }
    }
  }

  return {
    check(request, family, context) {
      const now = Date.now();

      // Hot path: sweep only when a threshold triggers — O(1) otherwise.
      maybeSweep(now);

      const rule = rules[family];
      const bucketKey = buildBucketKey(request, family, context);
      const existingBucket = buckets.get(bucketKey);
      const bucket =
        existingBucket && existingBucket.resetAt > now
          ? existingBucket
          : {
              count: 0,
              resetAt: now + rule.windowMs
            };

      bucket.count += 1;
      buckets.set(bucketKey, bucket);

      const remaining = Math.max(0, rule.limit - bucket.count);
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));

      return {
        allowed: bucket.count <= rule.limit,
        family,
        limit: rule.limit,
        remaining,
        resetAt: bucket.resetAt,
        retryAfterSeconds
      };
    },

    readDiagnostics(): RateLimitDiagnostics {
      return { bucketCount: buckets.size };
    }
  };
}

export const DEFAULT_RATE_LIMITER = createInMemoryRateLimiter();
