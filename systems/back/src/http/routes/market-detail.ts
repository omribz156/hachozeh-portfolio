import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";

import {
  readDbBackedMarketDetailPassiveRecord,
  readMarketDetailEventTarget
} from "../../db/read-models/market-detail-passive";
import { formatUnknownError, type Logger } from "../../shared/logger";
import { sendError } from "./route-errors";
import {
  MARKET_DETAIL_RECORDS,
  type MarketDetailPassiveRecord
} from "./market-detail-fixtures";
import { setPublicCacheControl } from "../cache-control";

type MarketDetailRouteContext = {
  dbPool: Pool;
  logger: Logger;
};

const MARKET_KEY_TO_RECORD_KEY: Record<string, string> = {
  "bank-israel-mar-18": "mar-18",
  "bank-israel-apr-29": "apr-29",
  "bank-israel-jun-17": "jun-17",
  "mar-18": "mar-18",
  "apr-29": "apr-29",
  "jun-17": "jun-17"
};

function readMarketDetailPassiveRecord(marketKey: string): MarketDetailPassiveRecord | null {
  const recordKey = MARKET_KEY_TO_RECORD_KEY[marketKey];

  if (!recordKey) {
    return null;
  }

  return MARKET_DETAIL_RECORDS[recordKey] ?? null;
}

function readMarketKeyParam(request: FastifyRequest): string {
  return String((request.params as { marketKey?: string }).marketKey ?? "");
}

function readEventSlugParam(request: FastifyRequest): string {
  return String((request.params as { eventSlug?: string }).eventSlug ?? "");
}

function readReplyRequestId(reply: FastifyReply, request: FastifyRequest): string {
  return String(reply.getHeader("x-request-id") ?? request.headers["x-request-id"] ?? "");
}

function shouldAllowMarketDetailFixtureFallback(marketKey: string): boolean {
  return !/^(disc-cm-|stress-|market_)/.test(marketKey);
}

export function registerMarketDetailRoutes(
  app: FastifyInstance,
  context: MarketDetailRouteContext
): void {
  app.get("/api/market-detail/events/:eventSlug", async (request, reply) => {
    const eventSlug = readEventSlugParam(request);

    try {
      const target = await readMarketDetailEventTarget(context.dbPool, eventSlug);

      if (!target) {
        sendError(
          reply,
          404,
          "market_detail_event_not_found",
          "Market detail event not found.",
          {
            eventSlug,
            requestId: readReplyRequestId(reply, request)
          }
        );
        return undefined;
      }

      setPublicCacheControl(reply, {
        browserMaxAgeSeconds: 30,
        cloudflareMaxAgeSeconds: 120,
        staleWhileRevalidateSeconds: 300
      });
      return target;
    } catch (error) {
      context.logger.warn("fastify_app.market_detail.event_target_failed", {
        eventSlug,
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.", {
        eventSlug,
        requestId: readReplyRequestId(reply, request)
      });
      return undefined;
    }
  });

  app.get("/api/market-detail/markets/:marketKey", async (request, reply) => {
    const marketKey = readMarketKeyParam(request);
    let dbBackedRecord = null;

    try {
      dbBackedRecord = await readDbBackedMarketDetailPassiveRecord(context.dbPool, marketKey);
    } catch (error) {
      context.logger.warn("fastify_app.market_detail.db_overlay_failed", {
        marketKey,
        error: formatUnknownError(error)
      });
    }

    const record =
      dbBackedRecord ??
      (shouldAllowMarketDetailFixtureFallback(marketKey)
        ? readMarketDetailPassiveRecord(marketKey)
        : null);

    if (!record) {
      sendError(
        reply,
        404,
        "market_detail_not_found",
        "Market detail market not found.",
        {
          marketKey,
          requestId: readReplyRequestId(reply, request)
        }
      );
      return undefined;
    }

    setPublicCacheControl(reply, {
      browserMaxAgeSeconds: 10,
      cloudflareMaxAgeSeconds: 30,
      staleWhileRevalidateSeconds: 60
    });
    return record;
  });
}
