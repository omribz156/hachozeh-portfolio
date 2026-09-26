import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";

import { readRelatedMarkets } from "../../markets/market-api/related-read-service";
import { resolveMarketIdentity } from "../../shared/market-identity";
import { formatUnknownError, type Logger } from "../../shared/logger";
import { sendError } from "./route-errors";
import { setPublicCacheControl } from "../cache-control";

type MarketRelatedRouteContext = {
  dbPool: Pool;
  logger: Logger;
};

function readMarketKeyParam(request: FastifyRequest): string {
  return String((request.params as { marketKey?: string }).marketKey ?? "");
}

function readReplyRequestId(reply: FastifyReply, request: FastifyRequest): string {
  return String(reply.getHeader("x-request-id") ?? request.headers["x-request-id"] ?? "");
}

// Public, unauthenticated read powering the "related markets" module on the market
// detail page. Returns the market's visible tags + per-tag co-tagged panels + an "all"
// blend. Untagged markets return an empty (200) payload so the frontend renders nothing.
export function registerMarketRelatedRoutes(
  app: FastifyInstance,
  context: MarketRelatedRouteContext
): void {
  app.get("/api/market-detail/markets/:marketKey/related", async (request, reply) => {
    const marketKey = readMarketKeyParam(request);

    if (!marketKey) {
      sendError(reply, 404, "market_not_found", "Market not found.", {
        marketKey,
        requestId: readReplyRequestId(reply, request)
      });
      return undefined;
    }

    try {
      const marketId = resolveMarketIdentity(marketKey)?.marketId ?? marketKey;
      const result = await readRelatedMarkets(context.dbPool, marketId);

      setPublicCacheControl(reply, {
        browserMaxAgeSeconds: 60,
        cloudflareMaxAgeSeconds: 300,
        staleWhileRevalidateSeconds: 600
      });
      return { marketKey, ...result };
    } catch (error) {
      context.logger.warn("fastify_app.market_related.read_failed", {
        marketKey,
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.", {
        marketKey,
        requestId: readReplyRequestId(reply, request)
      });
      return undefined;
    }
  });
}
