import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";

import {
  ActorResolutionError,
  resolveRequestActor,
  type RequestActor
} from "../../auth/actor-resolver";
import type { AppEnv } from "../../config/env";
import { sendActorResolutionError, sendError, sendInvalidJsonError } from "./route-errors";
import { createTradeTicketQuote, QuoteServiceError } from "../../engine/pricing/quote-service";
import { readTradeStatusByIdempotencyKey } from "../../engine/trading/idempotency";
import {
  executeTrade,
  TradeServiceError,
  type TradeResponse
} from "../../engine/trading/trade-service";
import { recordTradeWriteRejectionSignal } from "../../risk/market-integrity-service";
import { formatUnknownError, type Logger } from "../../shared/logger";
import {
  broadcastMarketTradeEvent
} from "../market-stream-broadcasts";
import type { MarketStreamBus } from "../market-stream-bus";
import type { PortfolioStreamBus } from "../portfolio-stream-bus";
import { broadcastPortfolioInvalidation } from "../portfolio-invalidation";

type TradeWriteRouteContext = {
  dbPool: Pool;
  env: AppEnv;
  logger: Logger;
  marketStreamBus?: MarketStreamBus;
  portfolioStreamBus?: PortfolioStreamBus;
  applyRateLimit: (
    request: FastifyRequest,
    reply: FastifyReply,
    signalContext?: {
      actorId?: string | null;
      sessionId?: string | null;
    },
    options?: {
      allowTradeIpFallback?: boolean;
    }
  ) => Promise<boolean>;
};

function readRequiredBody(request: FastifyRequest): unknown {
  if (typeof request.body === "undefined" || request.body === null) {
    throw new Error("JSON body is required");
  }

  return request.body;
}

function readMarketKeyParam(request: FastifyRequest): string {
  return String((request.params as { marketKey?: string }).marketKey ?? "");
}

function readIdempotencyKeyQuery(request: FastifyRequest): string {
  const query = request.query as { idempotencyKey?: string };
  return String(query.idempotencyKey ?? "").trim();
}

function readReplyRequestId(reply: FastifyReply, request: FastifyRequest): string {
  return String(reply.getHeader("x-request-id") ?? request.headers["x-request-id"] ?? "");
}

async function resolveTradeRouteActor(
  context: TradeWriteRouteContext,
  request: FastifyRequest
): Promise<RequestActor> {
  return await resolveRequestActor(context.dbPool, context.env, request.raw, {
    allowDemo: !context.env.trading.requireSession
  });
}

async function recordTradeWriteSignalSafely(
  context: TradeWriteRouteContext,
  request: FastifyRequest,
  error: QuoteServiceError | TradeServiceError,
  operation: "quote" | "trade",
  marketKey: string,
  actor?: {
    actorId?: string | null;
    sessionId?: string | null;
  } | null
): Promise<void> {
  try {
    await recordTradeWriteRejectionSignal(context.dbPool, request.raw, {
      actorId: actor?.actorId,
      sessionId: actor?.sessionId,
      marketKey,
      operation,
      reasonCode: error.code,
      statusCode: error.statusCode
    });
  } catch (signalError) {
    context.logger.warn("fastify_app.risk.trade_write_signal_failed", {
      marketKey,
      operation,
      reasonCode: error.code,
      error: formatUnknownError(signalError)
    });
  }
}

function sendTradeWriteError(
  context: TradeWriteRouteContext,
  reply: FastifyReply,
  error: unknown,
  logName: string,
  marketKey: string
): boolean {
  if (error instanceof ActorResolutionError) {
    sendActorResolutionError(reply, error);
    return true;
  }

  if (error instanceof QuoteServiceError) {
    sendError(reply, error.statusCode, error.code, error.message);
    return true;
  }

  if (error instanceof TradeServiceError) {
    sendError(
      reply,
      error.statusCode,
      error.code,
      error.message,
      error.details ? { details: error.details } : undefined
    );
    return true;
  }

  if (error instanceof Error && error.message === "JSON body is required") {
    sendInvalidJsonError(reply, error.message);
    return true;
  }

  context.logger.error(`fastify_app.${logName}.request_failed`, {
    marketKey,
    error: formatUnknownError(error)
  });
  sendError(reply, 500, "internal_error", "Unexpected server failure.");
  return true;
}

export function registerTradeWriteRoutes(
  app: FastifyInstance,
  context: TradeWriteRouteContext
): void {
  app.post("/api/markets/:marketKey/quote", async (request, reply) => {
    const marketKey = readMarketKeyParam(request);
    let actor: RequestActor | null = null;

    try {
      actor = await resolveTradeRouteActor(context, request);
      if (await context.applyRateLimit(request, reply, {
        actorId: actor.actorId,
        sessionId: actor.sessionId
      })) {
        return undefined;
      }
      return await createTradeTicketQuote(
        context.dbPool,
        context.env,
        marketKey,
        readRequiredBody(request),
        actor
      );
    } catch (error) {
      if (
        error instanceof ActorResolutionError &&
        await context.applyRateLimit(request, reply, undefined, {
          allowTradeIpFallback: true
        })
      ) {
        return undefined;
      }
      if (error instanceof QuoteServiceError || error instanceof TradeServiceError) {
        await recordTradeWriteSignalSafely(context, request, error, "quote", marketKey, actor);
      }
      sendTradeWriteError(context, reply, error, "quote", marketKey);
      return undefined;
    }
  });

  app.post("/api/markets/:marketKey/trades", async (request, reply) => {
    const marketKey = readMarketKeyParam(request);
    let actor: RequestActor | null = null;

    try {
      actor = await resolveTradeRouteActor(context, request);
      if (await context.applyRateLimit(request, reply, {
        actorId: actor.actorId,
        sessionId: actor.sessionId
      })) {
        return undefined;
      }
      const payload: TradeResponse = await executeTrade(
        context.dbPool,
        context.env,
        marketKey,
        readRequiredBody(request),
        actor,
        { requestId: readReplyRequestId(reply, request) }
      );

      broadcastMarketTradeEvent({
        dbPool: context.dbPool,
        marketStreamBus: context.marketStreamBus,
        requestLogger: context.logger.child({
          component: "http",
          route: "fastify_trade",
          marketKey
        }),
        trade: payload
      });

      broadcastPortfolioInvalidation(context, {
        actor,
        reason: "trade",
        marketKey
      });

      return payload;
    } catch (error) {
      if (
        error instanceof ActorResolutionError &&
        await context.applyRateLimit(request, reply, undefined, {
          allowTradeIpFallback: true
        })
      ) {
        return undefined;
      }
      if (error instanceof TradeServiceError || error instanceof QuoteServiceError) {
        await recordTradeWriteSignalSafely(context, request, error, "trade", marketKey, actor);
      }
      sendTradeWriteError(context, reply, error, "trade", marketKey);
      return undefined;
    }
  });

  // Network-drop trust probe: after a submit whose response was lost to a
  // network failure/timeout, the client re-queries with the SAME
  // idempotencyKey it sent on the trade to learn the definite outcome.
  // Actor-scoped read only — never resolves another user's trades (see
  // readTradeStatusByIdempotencyKey). marketKey in the path is routing
  // context only; the lookup itself is scope+actor+key.
  //
  // Rate limiting: a plain GET under /api/markets/ classifies as market_read
  // via the global onRequest hook (fastify-app.ts) — no manual applyRateLimit
  // call here. Unlike the POST quote/trades routes below, this isn't a money
  // write, so it doesn't need the tighter actor/session-scoped trade_write
  // family or the IP-fallback dance for unauthenticated callers.
  app.get("/api/markets/:marketKey/trades/status", async (request, reply) => {
    const marketKey = readMarketKeyParam(request);

    try {
      const actor = await resolveTradeRouteActor(context, request);
      const idempotencyKey = readIdempotencyKeyQuery(request);
      if (!idempotencyKey) {
        sendError(reply, 400, "invalid_request", "idempotencyKey is required.");
        return undefined;
      }

      return await readTradeStatusByIdempotencyKey(
        context.dbPool,
        actor.actorId,
        idempotencyKey
      );
    } catch (error) {
      sendTradeWriteError(context, reply, error, "trade_status", marketKey);
      return undefined;
    }
  });

  for (const path of [
    "/api/markets/:marketKey/quote",
    "/api/markets/:marketKey/trades"
  ]) {
    app.options(path, async (_request, reply) => {
      reply.code(204).send();
    });
  }
}
