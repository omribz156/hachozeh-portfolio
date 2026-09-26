import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";

import { readMarketsByFamilyKey } from "../../db/read-models/market-detail/chain-reader";
import { formatUnknownError, type Logger } from "../../shared/logger";
import { sendError } from "./route-errors";
import { setPublicCacheControl } from "../cache-control";

type MarketFamilyRouteContext = {
  dbPool: Pool;
  logger: Logger;
};

function readFamilyKeyParam(request: FastifyRequest): string {
  return String((request.params as { familyKey?: string }).familyKey ?? "");
}

function readReplyRequestId(reply: FastifyReply, request: FastifyRequest): string {
  return String(reply.getHeader("x-request-id") ?? request.headers["x-request-id"] ?? "");
}

// Public, unauthenticated read powering the recurring-series hub (`/series/{familyKey}`).
// Returns every published instance of a market family as date-ordered chain items,
// reusing the same shape the market-detail chain rail already consumes.
export function registerMarketFamilyRoutes(
  app: FastifyInstance,
  context: MarketFamilyRouteContext
): void {
  app.get("/api/market-families/:familyKey", async (request, reply) => {
    const familyKey = readFamilyKeyParam(request);

    if (!familyKey) {
      sendError(reply, 404, "market_family_not_found", "Market family not found.", {
        familyKey,
        requestId: readReplyRequestId(reply, request)
      });
      return undefined;
    }

    try {
      const items = await readMarketsByFamilyKey(context.dbPool, familyKey);

      if (items.length === 0) {
        sendError(reply, 404, "market_family_not_found", "Market family not found.", {
          familyKey,
          requestId: readReplyRequestId(reply, request)
        });
        return undefined;
      }

      setPublicCacheControl(reply, {
        browserMaxAgeSeconds: 60,
        cloudflareMaxAgeSeconds: 300,
        staleWhileRevalidateSeconds: 600
      });
      return { familyKey, count: items.length, items };
    } catch (error) {
      context.logger.warn("fastify_app.market_family.read_failed", {
        familyKey,
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.", {
        familyKey,
        requestId: readReplyRequestId(reply, request)
      });
      return undefined;
    }
  });
}
