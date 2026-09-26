import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { Pool } from "pg";

import type { AuthStartResponse } from "../auth/session/types";
import { readCookie } from "../auth/session-cookie";
import type { AppEnv } from "../config/env";
import type { Queryable } from "../db/client/pool";
import { formatUnknownError, type Logger } from "../shared/logger";
import {
  registerHealthRoutes
} from "./routes/health";
import {
  buildCorsHeaders,
  isCorsOriginAllowed
} from "./json";
import type { MarketStreamBus } from "./market-stream-bus";
import { DEFAULT_MARKET_STREAM_BUS } from "./default-market-stream-bus";
import type { PortfolioStreamBus } from "./portfolio-stream-bus";
import type { DiscoveryStreamLimiter } from "./discovery-stream-limiter";
import type { StreamConnectionLimiter } from "./stream-connection-limiter";
import {
  classifyRouteFamily,
  DEFAULT_RATE_LIMITER,
  type RateLimitResult,
  type RateLimiter
} from "./rate-limit";
import { registerMarketDetailRoutes } from "./routes/market-detail";
import { registerMarketFamilyRoutes } from "./routes/market-family";
import { registerMarketRelatedRoutes } from "./routes/market-related";
import { registerTagRoutes } from "./routes/tags";
import { registerGoogleAuthRoutes } from "./routes/google-auth";
import { registerAuthSessionRoutes } from "./routes/auth-session";
import { registerFeedbackRoutes } from "./routes/feedback";
import { registerSearchRoutes } from "./routes/search";
import { registerSocialRoutes } from "./routes/social";
import { registerDiscoveryRoutes } from "./routes/discovery";
import { registerPublicMarketCatalogRoutes } from "./routes/public-market-catalog";
import { registerPublicMarketReadRoutes } from "./routes/public-market-reads";
import { registerPublicShareReadRoutes } from "./routes/public-share-reads";
import { registerWalletRoutes } from "./routes/wallet";
import { registerMarketCommentRoutes } from "./routes/market-comments";
import { registerCommunityRoutes } from "./routes/community";
import { registerMarketSaveRoutes } from "./routes/market-saves";
import { registerNotificationRoutes } from "./routes/notifications";
import { registerTradeWriteRoutes } from "./routes/trade-write";
import { registerPortfolioRoutes } from "./routes/portfolio";
import { registerAdminUserRiskEconomyRoutes } from "./routes/admin-user-risk-economy";
import { registerAdminOracleRoutes } from "./routes/admin-oracle";
import { registerAdminMarketLifecycleRoutes } from "./routes/admin-market-lifecycle";
import { recordRequestMetric } from "./request-metrics";
import {
  recordRateLimitIntegritySignal,
} from "../risk/market-integrity-service";

type FastifyAppContext = {
  env: AppEnv;
  logger: Logger;
  dbPool: Pool;
  marketStreamBus?: MarketStreamBus;
  portfolioStreamBus?: PortfolioStreamBus;
  discoveryStreamLimiter?: DiscoveryStreamLimiter;
  streamConnectionLimiter?: StreamConnectionLimiter;
  rateLimiter?: RateLimiter;
  requestLifecycle?: boolean;
  startAuthChallenge?: (
    db: Queryable,
    env: AppEnv,
    body: unknown
  ) => Promise<AuthStartResponse>;
};

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline'",
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' http://127.0.0.1:3001 http://localhost:3001 https://hachozeh.com https://www.hachozeh.com https://dev.hachozeh.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "media-src 'self' https:"
].join("; ");

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function readRequestId(request: FastifyRequest): string {
  const candidate = request.headers["x-request-id"]?.toString().trim();
  return candidate && REQUEST_ID_PATTERN.test(candidate) ? candidate : randomUUID();
}

function setResponseHeaders(reply: FastifyReply, requestId: string, env: AppEnv): void {
  reply.header("x-request-id", requestId);
  reply.header("x-content-type-options", "nosniff");
  reply.header("x-frame-options", "DENY");
  reply.header("content-security-policy", CONTENT_SECURITY_POLICY);
  reply.header("referrer-policy", "strict-origin-when-cross-origin");
  reply.header("permissions-policy", "camera=(), microphone=(), geolocation=()");

  if (env.nodeEnv === "production") {
    reply.header("strict-transport-security", "max-age=15552000; includeSubDomains");
  }

  for (const [key, value] of Object.entries(buildCorsHeaders(reply.request.raw))) {
    reply.header(key, value);
  }
}

function sendError(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
  metadata?: Record<string, unknown>
): void {
  reply.code(statusCode).send({
    error: {
      code,
      message
    },
    ...metadata
  });
}

function sendInvalidJsonError(reply: FastifyReply, message: string): void {
  sendError(reply, 400, "invalid_request", message);
}

async function recordRateLimitSignalSafely(
  context: FastifyAppContext,
  request: FastifyRequest,
  result: RateLimitResult,
  signalContext?: {
    actorId?: string | null;
    sessionId?: string | null;
  }
): Promise<void> {
  try {
    await recordRateLimitIntegritySignal(context.dbPool, request.raw, result, signalContext);
  } catch (error) {
    context.logger.warn("fastify_app.risk.rate_limit_signal_failed", {
      family: result.family,
      error: formatUnknownError(error)
    });
  }
}

async function applyFastifyRateLimit(
  context: FastifyAppContext,
  rateLimiter: RateLimiter,
  request: FastifyRequest,
  reply: FastifyReply,
  signalContext?: {
    actorId?: string | null;
    sessionId?: string | null;
  },
  options?: {
    allowTradeIpFallback?: boolean;
  }
): Promise<boolean> {
  if (request.method === "OPTIONS") {
    return false;
  }

  const family = classifyRouteFamily(request.method, buildRequestUrl(request).pathname);

  if (!family) {
    return false;
  }

  if (
    family === "trade_write" &&
    !signalContext?.actorId &&
    !signalContext?.sessionId &&
    options?.allowTradeIpFallback !== true
  ) {
    return false;
  }

  const result = rateLimiter.check(request.raw, family, signalContext);

  reply.header("x-rate-limit-family", result.family);
  reply.header("x-rate-limit-limit", String(result.limit));
  reply.header("x-rate-limit-remaining", String(result.remaining));
  reply.header("x-rate-limit-reset", new Date(result.resetAt).toISOString());

  if (result.allowed) {
    return false;
  }

  await recordRateLimitSignalSafely(context, request, result, signalContext);

  reply.header("retry-after", String(result.retryAfterSeconds));
  sendError(
    reply,
    429,
    "rate_limited",
    "Too many requests for this route family.",
    {
      family: result.family,
      retryAfterSeconds: result.retryAfterSeconds
    }
  );
  return true;
}

function buildRequestUrl(request: FastifyRequest): URL {
  return new URL(
    request.raw.url ?? "/",
    `http://${request.headers.host?.toString() ?? "localhost"}`
  );
}

function readFastifyErrorCode(error: unknown): string | null {
  return error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : null;
}

function readReplyRequestId(reply: FastifyReply, request: FastifyRequest): string {
  return String(reply.getHeader("x-request-id") ?? readRequestId(request));
}

function readRequestPath(request: FastifyRequest): string {
  return buildRequestUrl(request).pathname;
}

export function sanitizeRequestLogPath(path: string): string {
  if (path.startsWith("/api/uploads/avatars/")) {
    return "/api/uploads/avatars/:fileName";
  }

  if (path.startsWith("/api/uploads/feedback/")) {
    return "/api/uploads/feedback/:fileName";
  }

  return path;
}

function isStateChangingMethod(method: string): boolean {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}

function shouldPreventResponseCaching(method: string, path: string): boolean {
  if (method === "OPTIONS") {
    return false;
  }

  if (isStateChangingMethod(method)) {
    return true;
  }

  return (
    path === "/health/diagnostics" ||
    path === "/admin" ||
    path.startsWith("/admin/") ||
    path.startsWith("/api/auth/") ||
    path === "/api/me" ||
    path.startsWith("/api/me/") ||
    path === "/api/portfolio" ||
    path.startsWith("/api/portfolio/") ||
    path === "/api/wallet" ||
    path.startsWith("/api/wallet/")
  );
}

function readPublicBaseOrigin(env: AppEnv): string | null {
  try {
    return new URL(env.publicBaseUrl).origin;
  } catch {
    return null;
  }
}

function rejectUntrustedWriteOrigin(
  request: FastifyRequest,
  reply: FastifyReply,
  env: AppEnv
): boolean {
  if (!isStateChangingMethod(request.method)) {
    return false;
  }

  const origin = request.headers.origin?.toString().trim();
  const secFetchSite = request.headers["sec-fetch-site"]?.toString().trim().toLowerCase();

  if (!origin) {
    if (secFetchSite === "cross-site") {
      sendError(reply, 403, "forbidden_origin", "Request origin is not allowed.");
      return true;
    }

    return false;
  }

  if (isCorsOriginAllowed(origin) || origin === readPublicBaseOrigin(env)) {
    return false;
  }

  sendError(reply, 403, "forbidden_origin", "Request origin is not allowed.");
  return true;
}

export function createFastifyApp(context: FastifyAppContext): FastifyInstance {
  const app = fastify({
    logger: false,
    bodyLimit: 32 * 1024
  });
  const rateLimiter = context.rateLimiter ?? DEFAULT_RATE_LIMITER;
  const requestLifecycleByRequest = new WeakMap<
    FastifyRequest,
    {
      logger: Logger;
      path: string;
      startedAt: number;
    }
  >();

  app.setErrorHandler((error, _request, reply) => {
    const errorCode = readFastifyErrorCode(error);

    if (errorCode === "FST_ERR_CTP_BODY_TOO_LARGE") {
      sendInvalidJsonError(reply, "JSON body too large");
      return;
    }

    if (errorCode === "FST_ERR_CTP_EMPTY_JSON_BODY") {
      sendInvalidJsonError(reply, "JSON body is required");
      return;
    }

    if (errorCode === "FST_ERR_CTP_INVALID_JSON_BODY") {
      sendInvalidJsonError(reply, "JSON body is invalid");
      return;
    }

    context.logger.error("fastify_app.unhandled_error", {
      error: formatUnknownError(error)
    });
    sendError(reply, 500, "internal_error", "Unexpected server failure.");
  });

  app.addHook("onRequest", async (request, reply) => {
    const requestId = readRequestId(request);
    const path = readRequestPath(request);
    const logPath = sanitizeRequestLogPath(path);
    setResponseHeaders(reply, requestId, context.env);
    if (shouldPreventResponseCaching(request.method, path)) {
      reply.header("cache-control", "no-store");
    }

    if (context.requestLifecycle) {
      requestLifecycleByRequest.set(request, {
        logger: context.logger.child({
          component: "http",
          requestId,
          method: request.method,
          path: logPath
        }),
        path: logPath,
        startedAt: performance.now()
      });
    }

    if (rejectUntrustedWriteOrigin(request, reply, context.env)) {
      return reply;
    }

    if (await applyFastifyRateLimit(context, rateLimiter, request, reply)) {
      return reply;
    }
  });

  app.addHook("onResponse", async (request, reply) => {
    const lifecycle = requestLifecycleByRequest.get(request);

    if (!lifecycle) {
      return;
    }

    const durationMs = Number((performance.now() - lifecycle.startedAt).toFixed(1));
    recordRequestMetric({
      method: request.method,
      path: lifecycle.path,
      statusCode: reply.statusCode,
      durationMs
    });
    lifecycle.logger.info("request.completed", {
      statusCode: reply.statusCode,
      durationMs
    });
  });

  app.setNotFoundHandler((request, reply) => {
    const requestId = readReplyRequestId(reply, request);
    reply.code(404).send({
      error: {
        code: "not_found",
        message: "Route not found"
      },
      requestId
    });
  });

  registerHealthRoutes(app, context);

  registerGoogleAuthRoutes(app, context);

  registerPublicMarketCatalogRoutes(app, context);

  registerPublicMarketReadRoutes(app, context);

  registerPublicShareReadRoutes(app, context);

  registerMarketCommentRoutes(app, context);

  registerMarketSaveRoutes(app, context);

  registerSearchRoutes(app, context);

  registerCommunityRoutes(app, context);

  registerSocialRoutes(app, context);

  registerDiscoveryRoutes(app, context);

  registerMarketDetailRoutes(app, context);

  registerMarketFamilyRoutes(app, context);

  registerMarketRelatedRoutes(app, context);

  registerTagRoutes(app, context);

  registerAdminMarketLifecycleRoutes(app, context);

  registerAdminOracleRoutes(app, context);

  registerAdminUserRiskEconomyRoutes(app, context);

  registerPortfolioRoutes(app, context);

  registerWalletRoutes(app, context);

  registerTradeWriteRoutes(app, {
    ...context,
    applyRateLimit: async (request, reply, signalContext, options) =>
      await applyFastifyRateLimit(context, rateLimiter, request, reply, signalContext, options)
  });

  registerAuthSessionRoutes(app, {
    ...context,
    rateLimiter
  });

  registerNotificationRoutes(app, context);

  registerFeedbackRoutes(app, context);

  return app;
}
