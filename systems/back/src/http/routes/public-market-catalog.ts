import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";

import { readLiveMarketCount } from "../../markets/live-count-service";
import { readMarketCatalog } from "../../markets/market-api-read-service";
import { formatUnknownError, type Logger } from "../../shared/logger";
import { sendError } from "./route-errors";
import { setPublicCacheControl } from "../cache-control";

type PublicMarketCatalogRouteContext = {
  dbPool: Pool;
  logger: Logger;
};

function buildRequestUrl(request: FastifyRequest): URL {
  return new URL(
    request.raw.url ?? "/",
    `http://${request.headers.host?.toString() ?? "localhost"}`
  );
}

export function registerPublicMarketCatalogRoutes(
  app: FastifyInstance,
  context: PublicMarketCatalogRouteContext
): void {
  app.get("/api/markets/live-count", async (_request, reply) => {
    try {
      setPublicCacheControl(reply, {
        browserMaxAgeSeconds: 15,
        cloudflareMaxAgeSeconds: 60,
        staleWhileRevalidateSeconds: 120
      });
      return await readLiveMarketCount(context.dbPool);
    } catch (error) {
      context.logger.error("fastify_app.markets.live_count_failed", {
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.get("/api/markets", async (request, reply) => {
    try {
      const requestUrl = buildRequestUrl(request);
      setPublicCacheControl(reply, {
        browserMaxAgeSeconds: 15,
        cloudflareMaxAgeSeconds: 60,
        staleWhileRevalidateSeconds: 120
      });
      return await readMarketCatalog(context.dbPool, {
        status: requestUrl.searchParams.get("status"),
        category: requestUrl.searchParams.get("category"),
        limit: requestUrl.searchParams.get("limit"),
        cursor: requestUrl.searchParams.get("cursor"),
        q: requestUrl.searchParams.get("q"),
        closeAfter: requestUrl.searchParams.get("closeAfter"),
        closeBefore: requestUrl.searchParams.get("closeBefore"),
        sort: requestUrl.searchParams.get("sort")
      });
    } catch (error) {
      context.logger.error("fastify_app.markets.catalog_failed", {
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });
}
