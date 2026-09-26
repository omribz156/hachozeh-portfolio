import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";

import {
  ActorResolutionError,
  resolveRequestActor
} from "../../auth/actor-resolver";
import type { AppEnv } from "../../config/env";
import { sendActorResolutionError, sendError } from "./route-errors";
import {
  claimPortfolioRealization,
  consentPortfolioClaimShare,
  PortfolioClaimServiceError,
  readPortfolioClaims
} from "../../engine/portfolio/portfolio-claim-service";
import {
  readPortfolioHistory,
  readPortfolioOrders,
  readPortfolioPerformance,
  readPortfolioPerformanceTimeframe
} from "../../engine/portfolio/portfolio-read-service";
import {
  PortfolioSnapshotServiceError,
  readPortfolioSnapshot
} from "../../engine/portfolio/portfolio-snapshot-service";
import { formatUnknownError, type Logger } from "../../shared/logger";
import { DEFAULT_PORTFOLIO_STREAM_BUS } from "../default-portfolio-stream-bus";
import { DEFAULT_STREAM_CONNECTION_LIMITER } from "../default-stream-connection-limiter";
import {
  beginServerSentEvents,
  writeServerSentEvent
} from "../json";
import { broadcastPortfolioInvalidation } from "../portfolio-invalidation";
import type { PortfolioStreamBus } from "../portfolio-stream-bus";
import type { StreamConnectionLimiter } from "../stream-connection-limiter";

type PortfolioRouteContext = {
  dbPool: Pool;
  env: AppEnv;
  logger: Logger;
  portfolioStreamBus?: PortfolioStreamBus;
  streamConnectionLimiter?: StreamConnectionLimiter;
};

function buildRequestUrl(request: FastifyRequest): URL {
  return new URL(
    request.raw.url ?? "/",
    `http://${request.headers.host?.toString() ?? "localhost"}`
  );
}

function readRequestId(request: FastifyRequest): string {
  return request.headers["x-request-id"]?.toString() || "";
}

function readReplyRequestId(reply: FastifyReply, request: FastifyRequest): string {
  return String(reply.getHeader("x-request-id") ?? readRequestId(request));
}

function readClaimIdParam(request: FastifyRequest): string {
  return String((request.params as { claimId?: string }).claimId ?? "");
}

function sendPortfolioError(
  context: PortfolioRouteContext,
  reply: FastifyReply,
  error: unknown,
  logName: string
): boolean {
  if (error instanceof ActorResolutionError) {
    sendActorResolutionError(reply, error);
    return true;
  }

  if (error instanceof PortfolioSnapshotServiceError) {
    sendError(reply, error.statusCode, error.code, error.message);
    return true;
  }

  if (error instanceof PortfolioClaimServiceError) {
    sendError(reply, error.statusCode, error.code, error.message);
    return true;
  }

  context.logger.error(`fastify_app.portfolio_${logName}.request_failed`, {
    error: formatUnknownError(error)
  });
  sendError(reply, 500, "internal_error", "Unexpected server failure.");
  return true;
}

async function resolvePortfolioRouteActor(
  context: PortfolioRouteContext,
  request: FastifyRequest
) {
  return await resolveRequestActor(context.dbPool, context.env, request.raw, {
    allowDemo: !context.env.trading.requireSession
  });
}

async function resolveRequiredPortfolioStreamActor(
  context: PortfolioRouteContext,
  request: FastifyRequest
) {
  return await resolveRequestActor(context.dbPool, context.env, request.raw, {
    allowDemo: false
  });
}

export function registerPortfolioRoutes(
  app: FastifyInstance,
  context: PortfolioRouteContext
): void {
  app.get("/api/portfolio/snapshot", async (request, reply) => {
    try {
      const actor = await resolvePortfolioRouteActor(context, request);
      return await readPortfolioSnapshot(context.dbPool, context.env, actor);
    } catch (error) {
      sendPortfolioError(context, reply, error, "snapshot");
      return undefined;
    }
  });

  app.get("/api/portfolio/stream", async (request, reply) => {
    try {
      const requestUrl = buildRequestUrl(request);
      const actor = await resolveRequiredPortfolioStreamActor(context, request);
      const streamBus = context.portfolioStreamBus ?? DEFAULT_PORTFOLIO_STREAM_BUS;
      const streamConnectionLimiter =
        context.streamConnectionLimiter ?? DEFAULT_STREAM_CONNECTION_LIMITER;
      const isOneShotStream = requestUrl.searchParams.get("once") === "1";

      if (!isOneShotStream && !streamBus.canAcceptConnection(actor.actorId)) {
        sendError(reply, 429, "stream_limit_exceeded", "Too many open portfolio streams.");
        return undefined;
      }

      if (!isOneShotStream && !streamConnectionLimiter.canAcceptConnection(request.raw)) {
        sendError(reply, 429, "stream_limit_exceeded", "Too many open streams from this client.");
        return undefined;
      }

      reply.hijack();
      reply.raw.setHeader("x-request-id", readReplyRequestId(reply, request));

      beginServerSentEvents(reply.raw, request.raw);
      writeServerSentEvent(reply.raw, "portfolio.ready", {
        eventId: `portfolio:ready:${actor.sessionId ?? actor.actorId}:${Date.now()}`,
        eventType: "portfolio.ready",
        at: new Date().toISOString()
      });

      if (isOneShotStream) {
        reply.raw.end();
        return undefined;
      }

      const closeStream = streamBus.addConnection(actor.actorId, reply.raw);
      const closeClientStream = streamConnectionLimiter.addConnection(request.raw);
      const heartbeat = setInterval(() => {
        writeServerSentEvent(reply.raw, "heartbeat", {
          eventType: "heartbeat",
          at: new Date().toISOString()
        });
      }, 15_000);

      request.raw.once("close", () => {
        clearInterval(heartbeat);
        closeStream();
        closeClientStream();
      });

      return undefined;
    } catch (error) {
      if (error instanceof ActorResolutionError) {
        sendActorResolutionError(reply, error);
        return undefined;
      }

      context.logger.error("fastify_app.portfolio.stream_failed", {
        error: formatUnknownError(error)
      });

      if (!reply.raw.headersSent) {
        sendError(reply, 500, "internal_error", "Unexpected server failure.");
      } else {
        reply.raw.end();
      }

      return undefined;
    }
  });

  app.get("/api/portfolio/orders", async (request, reply) => {
    try {
      const actor = await resolvePortfolioRouteActor(context, request);
      return await readPortfolioOrders(context.dbPool, context.env, actor);
    } catch (error) {
      sendPortfolioError(context, reply, error, "orders");
      return undefined;
    }
  });

  app.get("/api/portfolio/history", async (request, reply) => {
    try {
      const actor = await resolvePortfolioRouteActor(context, request);
      return await readPortfolioHistory(context.dbPool, context.env, actor);
    } catch (error) {
      sendPortfolioError(context, reply, error, "history");
      return undefined;
    }
  });

  app.get("/api/portfolio/performance", async (request, reply) => {
    try {
      const requestUrl = buildRequestUrl(request);
      const actor = await resolvePortfolioRouteActor(context, request);
      return await readPortfolioPerformance(context.dbPool, context.env, actor, {
        timeframe: readPortfolioPerformanceTimeframe(requestUrl.searchParams.get("timeframe"))
      });
    } catch (error) {
      sendPortfolioError(context, reply, error, "performance");
      return undefined;
    }
  });

  app.get("/api/portfolio/claims", async (request, reply) => {
    try {
      const actor = await resolvePortfolioRouteActor(context, request);
      return await readPortfolioClaims(context.dbPool, context.env, actor);
    } catch (error) {
      sendPortfolioError(context, reply, error, "claims");
      return undefined;
    }
  });

  app.post("/api/portfolio/claims/:claimId/claim", async (request, reply) => {
    try {
      const actor = await resolvePortfolioRouteActor(context, request);
      const claimId = readClaimIdParam(request);
      const payload = await claimPortfolioRealization(context.dbPool, context.env, claimId, actor);

      broadcastPortfolioInvalidation(context, {
        actor,
        reason: "claim",
        claimId
      });

      return payload;
    } catch (error) {
      sendPortfolioError(context, reply, error, "claim");
      return undefined;
    }
  });

  app.options("/api/portfolio/claims/:claimId/claim", async (_request, reply) => {
    reply.code(204).send();
  });

  // Owner consents to sharing this win publicly (stamped on the first real
  // share action, idempotent) and gets back the public share payload.
  app.post("/api/portfolio/claims/:claimId/share", async (request, reply) => {
    try {
      const actor = await resolvePortfolioRouteActor(context, request);
      const claimId = readClaimIdParam(request);
      return await consentPortfolioClaimShare(context.dbPool, context.env, claimId, actor);
    } catch (error) {
      sendPortfolioError(context, reply, error, "claim_share");
      return undefined;
    }
  });

  app.options("/api/portfolio/claims/:claimId/share", async (_request, reply) => {
    reply.code(204).send();
  });
}
