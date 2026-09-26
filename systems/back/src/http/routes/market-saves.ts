import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";

import {
  ActorResolutionError,
  resolveRequestActor
} from "../../auth/actor-resolver";
import type { AppEnv } from "../../config/env";
import { sendActorResolutionError, sendError } from "./route-errors";
import {
  MarketSaveServiceError,
  readMarketSaveState,
  saveMarketForUser,
  unsaveMarketForUser
} from "../../markets/market-save-service";
import { readSavedMarkets } from "../../search/public-search-service";
import { formatUnknownError, type Logger } from "../../shared/logger";

type MarketSaveRouteContext = {
  dbPool: Pool;
  env: AppEnv;
  logger: Logger;
};

function readMarketKeyParam(request: FastifyRequest): string {
  return String((request.params as { marketKey?: string }).marketKey ?? "").trim();
}

export function registerMarketSaveRoutes(
  app: FastifyInstance,
  context: MarketSaveRouteContext
): void {
  // The viewer's saved markets, enriched for the results-page "saved" view.
  // Static path wins over /api/markets/:marketKey in find-my-way, so no collision.
  app.get("/api/markets/saved", async (request, reply) => {
    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, {
        allowDemo: false
      });
      const markets = await readSavedMarkets(context.dbPool, actor.actorId);
      return { markets };
    } catch (error) {
      if (error instanceof ActorResolutionError) {
        sendActorResolutionError(reply, error);
        return undefined;
      }
      context.logger.error("fastify_app.market_save.list_failed", {
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.get("/api/markets/:marketKey/save", async (request, reply) => {
    const marketKey = readMarketKeyParam(request);

    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, {
        allowDemo: false
      });
      return await readMarketSaveState(context.dbPool, actor.actorId, marketKey);
    } catch (error) {
      if (error instanceof ActorResolutionError) {
        sendActorResolutionError(reply, error);
        return undefined;
      }

      if (error instanceof MarketSaveServiceError) {
        sendError(reply, error.statusCode, error.code, error.message);
        return undefined;
      }

      context.logger.error("fastify_app.market_save.read_failed", {
        marketKey,
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.post("/api/markets/:marketKey/save", async (request, reply) => {
    const marketKey = readMarketKeyParam(request);

    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, {
        allowDemo: false
      });
      return await saveMarketForUser(context.dbPool, actor.actorId, marketKey);
    } catch (error) {
      if (error instanceof ActorResolutionError) {
        sendActorResolutionError(reply, error);
        return undefined;
      }

      if (error instanceof MarketSaveServiceError) {
        sendError(reply, error.statusCode, error.code, error.message);
        return undefined;
      }

      context.logger.error("fastify_app.market_save.save_failed", {
        marketKey,
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.delete("/api/markets/:marketKey/save", async (request, reply) => {
    const marketKey = readMarketKeyParam(request);

    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, {
        allowDemo: false
      });
      return await unsaveMarketForUser(context.dbPool, actor.actorId, marketKey);
    } catch (error) {
      if (error instanceof ActorResolutionError) {
        sendActorResolutionError(reply, error);
        return undefined;
      }

      if (error instanceof MarketSaveServiceError) {
        sendError(reply, error.statusCode, error.code, error.message);
        return undefined;
      }

      context.logger.error("fastify_app.market_save.unsave_failed", {
        marketKey,
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });
}
