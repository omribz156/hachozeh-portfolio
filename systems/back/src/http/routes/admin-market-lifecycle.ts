import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";

import {
  ActorResolutionError,
  resolveRequiredAdminActor
} from "../../auth/actor-resolver";
import type { AppEnv } from "../../config/env";
import { sendActorResolutionError, sendError, sendInvalidJsonError } from "./route-errors";
import {
  closeMarket,
  CloseMarketServiceError,
  parseCloseMarketRequest
} from "../../lifecycle/horizon/close-market-service";
import {
  createMarketDraft,
  CreateMarketDraftServiceError,
  parseCreateMarketDraftRequest
} from "../../lifecycle/management/create-market-draft-service";
import {
  parsePublishMarketRequest,
  publishMarket,
  PublishMarketServiceError
} from "../../lifecycle/management/publish-market-service";
import {
  parseVoidMarketRequest,
  voidMarket,
  VoidMarketServiceError
} from "../../lifecycle/management/void-market-service";
import {
  parseResolveMarketRequest,
  resolveMarket,
  ResolveMarketServiceError
} from "../../../../oracle/src/resolve-market-service";
import { formatUnknownError, type Logger } from "../../shared/logger";
import {
  broadcastMarketLifecycleEvent
} from "../market-stream-broadcasts";
import type { MarketStreamBus } from "../market-stream-bus";
import { broadcastPortfolioInvalidation } from "../portfolio-invalidation";
import type { PortfolioStreamBus } from "../portfolio-stream-bus";

type AdminMarketLifecycleRouteContext = {
  dbPool: Pool;
  env: AppEnv;
  logger: Logger;
  marketStreamBus?: MarketStreamBus;
  portfolioStreamBus?: PortfolioStreamBus;
};

function readRequiredBody(request: FastifyRequest): unknown {
  if (typeof request.body === "undefined" || request.body === null) {
    throw new Error("JSON body is required");
  }

  return request.body;
}

function readMarketIdParam(request: FastifyRequest): string {
  return String((request.params as { marketId?: string }).marketId ?? "");
}

async function resolveRequiredFastifyAdminActor(
  context: AdminMarketLifecycleRouteContext,
  request: FastifyRequest
) {
  return await resolveRequiredAdminActor(context.dbPool, context.env, request.raw);
}

function sendAdminMarketLifecycleError(
  context: AdminMarketLifecycleRouteContext,
  reply: FastifyReply,
  error: unknown,
  routeKind: string,
  marketId?: string
): boolean {
  if (error instanceof ActorResolutionError) {
    sendActorResolutionError(reply, error);
    return true;
  }

  if (
    error instanceof CreateMarketDraftServiceError ||
    error instanceof CloseMarketServiceError ||
    error instanceof PublishMarketServiceError ||
    error instanceof ResolveMarketServiceError ||
    error instanceof VoidMarketServiceError
  ) {
    sendError(reply, error.statusCode, error.code, error.message);
    return true;
  }

  if (error instanceof Error && error.message === "JSON body is required") {
    sendInvalidJsonError(reply, error.message);
    return true;
  }

  context.logger.error(`fastify_app.admin_market_${routeKind}.request_failed`, {
    ...(marketId ? { marketId } : {}),
    error: formatUnknownError(error)
  });
  sendError(reply, 500, "internal_error", "Unexpected server failure.");
  return true;
}

export function registerAdminMarketLifecycleRoutes(
  app: FastifyInstance,
  context: AdminMarketLifecycleRouteContext
): void {
  app.post("/admin/markets", async (request, reply) => {
    try {
      const actor = await resolveRequiredFastifyAdminActor(context, request);
      const createRequest = parseCreateMarketDraftRequest(readRequiredBody(request));
      return await createMarketDraft(context.dbPool, createRequest, actor);
    } catch (error) {
      sendAdminMarketLifecycleError(context, reply, error, "create");
      return undefined;
    }
  });

  app.post("/admin/markets/:marketId/close", async (request, reply) => {
    const marketId = readMarketIdParam(request);

    try {
      const actor = await resolveRequiredFastifyAdminActor(context, request);
      const closeRequest = parseCloseMarketRequest(readRequiredBody(request));
      const payload = await closeMarket(context.dbPool, marketId, closeRequest, actor);

      broadcastMarketLifecycleEvent({
        dbPool: context.dbPool,
        marketStreamBus: context.marketStreamBus,
        requestLogger: context.logger.child({
          component: "http",
          route: "fastify_admin_market_close",
          marketId
        }),
        marketKey: payload.marketId,
        action: "closed",
        payload
      });

      return payload;
    } catch (error) {
      sendAdminMarketLifecycleError(context, reply, error, "close", marketId);
      return undefined;
    }
  });

  app.post("/admin/markets/:marketId/publish", async (request, reply) => {
    const marketId = readMarketIdParam(request);

    try {
      const actor = await resolveRequiredFastifyAdminActor(context, request);
      const publishRequest = parsePublishMarketRequest(readRequiredBody(request));
      const payload = await publishMarket(context.dbPool, marketId, publishRequest, actor);

      broadcastMarketLifecycleEvent({
        dbPool: context.dbPool,
        marketStreamBus: context.marketStreamBus,
        requestLogger: context.logger.child({
          component: "http",
          route: "fastify_admin_market_publish",
          marketId
        }),
        marketKey: marketId,
        action: "published",
        payload
      });

      return payload;
    } catch (error) {
      sendAdminMarketLifecycleError(context, reply, error, "publish", marketId);
      return undefined;
    }
  });

  app.post("/admin/markets/:marketId/resolve", async (request, reply) => {
    const marketId = readMarketIdParam(request);

    try {
      const actor = await resolveRequiredFastifyAdminActor(context, request);
      const resolveRequest = parseResolveMarketRequest(readRequiredBody(request));
      const payload = await resolveMarket(context.dbPool, marketId, resolveRequest, actor);

      broadcastMarketLifecycleEvent({
        dbPool: context.dbPool,
        marketStreamBus: context.marketStreamBus,
        requestLogger: context.logger.child({
          component: "http",
          route: "fastify_admin_market_resolve",
          marketId
        }),
        marketKey: payload.marketId,
        action: "resolved",
        payload
      });

      broadcastPortfolioInvalidation(context, {
        reason: "settlement",
        marketKey: payload.marketId,
        broadcastAll: true
      });

      return payload;
    } catch (error) {
      sendAdminMarketLifecycleError(context, reply, error, "resolve", marketId);
      return undefined;
    }
  });

  app.post("/admin/markets/:marketId/void", async (request, reply) => {
    const marketId = readMarketIdParam(request);

    try {
      const actor = await resolveRequiredFastifyAdminActor(context, request);
      const voidRequest = parseVoidMarketRequest(readRequiredBody(request));
      const payload = await voidMarket(context.dbPool, marketId, voidRequest, actor);

      broadcastMarketLifecycleEvent({
        dbPool: context.dbPool,
        marketStreamBus: context.marketStreamBus,
        requestLogger: context.logger.child({
          component: "http",
          route: "fastify_admin_market_void",
          marketId
        }),
        marketKey: payload.marketId,
        action: "voided",
        payload
      });

      broadcastPortfolioInvalidation(context, {
        reason: "void",
        marketKey: payload.marketId,
        broadcastAll: true
      });

      return payload;
    } catch (error) {
      sendAdminMarketLifecycleError(context, reply, error, "void", marketId);
      return undefined;
    }
  });

  for (const path of [
    "/admin/markets",
    "/admin/markets/:marketId/close",
    "/admin/markets/:marketId/publish",
    "/admin/markets/:marketId/resolve",
    "/admin/markets/:marketId/void"
  ]) {
    app.options(path, async (_request, reply) => {
      reply.code(204).send();
    });
  }
}
