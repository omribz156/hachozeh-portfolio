import { timingSafeEqual } from "node:crypto";

import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "pg";

import {
  ActorResolutionError,
  resolveRequiredAdminActor
} from "../../auth/actor-resolver";
import type { AppEnv } from "../../config/env";
import { sendError } from "./route-errors";
import { formatUnknownError, type Logger } from "../../shared/logger";
import { DEFAULT_MARKET_STREAM_BUS } from "../default-market-stream-bus";
import { DEFAULT_PORTFOLIO_STREAM_BUS } from "../default-portfolio-stream-bus";
import { DEFAULT_DISCOVERY_STREAM_LIMITER } from "../default-discovery-stream-limiter";
import { DEFAULT_STREAM_CONNECTION_LIMITER } from "../default-stream-connection-limiter";
import {
  buildDiagnosticsPayload,
  buildLivenessPayload,
  buildReadinessPayload
} from "../health";
import type { MarketStreamBus } from "../market-stream-bus";
import type { PortfolioStreamBus } from "../portfolio-stream-bus";
import type { DiscoveryStreamLimiter } from "../discovery-stream-limiter";
import type { StreamConnectionLimiter } from "../stream-connection-limiter";

type HealthRouteContext = {
  dbPool: Pool;
  env: AppEnv;
  logger: Logger;
  marketStreamBus?: MarketStreamBus;
  portfolioStreamBus?: PortfolioStreamBus;
  discoveryStreamLimiter?: DiscoveryStreamLimiter;
  streamConnectionLimiter?: StreamConnectionLimiter;
};

function readBearerToken(authorization: string | string[] | undefined): string {
  const value = Array.isArray(authorization) ? authorization[0] : authorization;
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

function isDiagnosticsBearerAuthorized(authorization: string | string[] | undefined): boolean {
  const expected = process.env.DIAGNOSTICS_BEARER_TOKEN?.trim();
  const actual = readBearerToken(authorization);
  if (!expected || !actual) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

export function registerHealthRoutes(
  app: FastifyInstance,
  context: HealthRouteContext
): void {
  app.get("/health/live", async () => buildLivenessPayload(context.env));

  async function buildReadinessReply(_request: unknown, reply: FastifyReply) {
    const payload = await buildReadinessPayload(context.env);
    reply.code(payload.status === "ready" ? 200 : 503);
    return payload;
  }

  app.get("/health", buildReadinessReply);
  app.get("/health/ready", buildReadinessReply);

  app.get("/health/diagnostics", async (request, reply) => {
    if (!isDiagnosticsBearerAuthorized(request.headers.authorization)) {
      try {
        await resolveRequiredAdminActor(context.dbPool, context.env, request.raw);
      } catch (error) {
        if (error instanceof ActorResolutionError) {
          if (error.setCookie) {
            reply.header("set-cookie", error.setCookie);
          }
          sendError(reply, error.statusCode, error.code, error.message);
          return undefined;
        }

        context.logger.error("fastify_app.admin.diagnostics_actor_resolution_failed", {
          error: formatUnknownError(error)
        });
        sendError(reply, 500, "internal_error", "Unexpected server failure.");
        return undefined;
      }
    }

    return await buildDiagnosticsPayload(context.env, {
      dbPool: context.dbPool,
      marketStreamBus: context.marketStreamBus ?? DEFAULT_MARKET_STREAM_BUS,
      portfolioStreamBus: context.portfolioStreamBus ?? DEFAULT_PORTFOLIO_STREAM_BUS,
      discoveryStreamLimiter: context.discoveryStreamLimiter ?? DEFAULT_DISCOVERY_STREAM_LIMITER,
      streamConnectionLimiter: context.streamConnectionLimiter ?? DEFAULT_STREAM_CONNECTION_LIMITER
    });
  });
}
