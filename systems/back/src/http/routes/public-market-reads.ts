import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";

import {
  readMarket,
  readMarketHistory,
  readMarketLifecycleEvents,
  readMarketPriceHistory,
  readMarketPrices,
  readMarketPositions,
  readMarketTrades
} from "../../markets/market-api-read-service";
import { readEventHistory } from "../../markets/market-history/event-history-service";
import { formatUnknownError, type Logger } from "../../shared/logger";
import { sendError } from "./route-errors";
import { DEFAULT_MARKET_STREAM_BUS } from "../default-market-stream-bus";
import { DEFAULT_STREAM_CONNECTION_LIMITER } from "../default-stream-connection-limiter";
import {
  beginServerSentEvents,
  writeServerSentEvent
} from "../json";
import {
  buildCloudflareCdnCacheControl,
  buildPublicCacheControl,
  setPublicCacheControl
} from "../cache-control";
import type { MarketStreamBus } from "../market-stream-bus";
import type { StreamConnectionLimiter } from "../stream-connection-limiter";

type PublicMarketReadRouteContext = {
  dbPool: Pool;
  logger: Logger;
  marketStreamBus?: MarketStreamBus;
  streamConnectionLimiter?: StreamConnectionLimiter;
};

const HISTORY_CACHE_MAX_AGE_BY_RANGE: Record<string, number> = {
  "1H": 10,
  "6H": 15,
  "1D": 30,
  "1W": 60,
  "1M": 120,
  ALL: 300
};

function buildHistoryCacheOptions(range: string | null): {
  browserMaxAgeSeconds: number;
  cloudflareMaxAgeSeconds: number;
  staleWhileRevalidateSeconds: number;
} {
  const normalizedRange = range?.trim().toUpperCase() || "1D";
  const maxAgeSeconds =
    HISTORY_CACHE_MAX_AGE_BY_RANGE[normalizedRange] ?? HISTORY_CACHE_MAX_AGE_BY_RANGE["1D"];

  return {
    browserMaxAgeSeconds: Math.min(maxAgeSeconds, 30),
    cloudflareMaxAgeSeconds: maxAgeSeconds,
    staleWhileRevalidateSeconds: Math.min(maxAgeSeconds * 2, 300)
  };
}

function setHistoryCacheControl(reply: FastifyReply, range: string | null): void {
  const options = buildHistoryCacheOptions(range);
  reply.header("cache-control", buildPublicCacheControl(options));
  const cloudflareCacheControl = buildCloudflareCdnCacheControl(options);
  if (cloudflareCacheControl) {
    reply.header("cloudflare-cdn-cache-control", cloudflareCacheControl);
  }
}

function sendMarketNotFound(reply: FastifyReply): void {
  sendError(reply, 404, "market_not_found", "Market not found.");
}

function buildRequestUrl(request: FastifyRequest): URL {
  return new URL(
    request.raw.url ?? "/",
    `http://${request.headers.host?.toString() ?? "localhost"}`
  );
}

function readMarketKeyParam(request: FastifyRequest): string {
  return String((request.params as { marketKey?: string }).marketKey ?? "");
}

function readReplyRequestId(reply: FastifyReply, request: FastifyRequest): string {
  return String(reply.getHeader("x-request-id") ?? request.headers["x-request-id"] ?? "");
}

export function registerPublicMarketReadRoutes(
  app: FastifyInstance,
  context: PublicMarketReadRouteContext
): void {
  app.get("/api/markets/:marketKey/prices", async (request, reply) => {
    const marketKey = readMarketKeyParam(request);

    try {
      const payload = await readMarketPrices(context.dbPool, marketKey);

      if (!payload) {
        sendMarketNotFound(reply);
        return undefined;
      }

      setPublicCacheControl(reply, {
        browserMaxAgeSeconds: 5,
        cloudflareMaxAgeSeconds: 10,
        staleWhileRevalidateSeconds: 30
      });
      return payload;
    } catch (error) {
      context.logger.error("fastify_app.markets.prices_failed", {
        marketKey,
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.get("/api/markets/:marketKey/stream", async (request, reply) => {
    const marketKey = readMarketKeyParam(request);

    try {
      const requestUrl = buildRequestUrl(request);
      const isOneShotStream = requestUrl.searchParams.get("once") === "1";
      const streamConnectionLimiter =
        context.streamConnectionLimiter ?? DEFAULT_STREAM_CONNECTION_LIMITER;

      if (!isOneShotStream && !streamConnectionLimiter.canAcceptConnection(request.raw)) {
        sendError(reply, 429, "stream_limit_exceeded", "Too many open streams from this client.");
        return undefined;
      }

      const payload = await readMarketPrices(context.dbPool, marketKey);

      if (!payload) {
        sendMarketNotFound(reply);
        return undefined;
      }

      const streamBus = context.marketStreamBus ?? DEFAULT_MARKET_STREAM_BUS;

      if (!isOneShotStream && !streamBus.canAcceptConnection(payload.marketKey)) {
        sendError(reply, 429, "stream_limit_exceeded", "Too many open market streams.");
        return undefined;
      }

      reply.hijack();
      reply.raw.setHeader("x-request-id", readReplyRequestId(reply, request));

      beginServerSentEvents(reply.raw, request.raw);
      writeServerSentEvent(reply.raw, "market.snapshot", {
        eventId: `snapshot:${payload.marketStateVersion}`,
        eventType: "snapshot",
        ...payload
      });

      if (isOneShotStream) {
        reply.raw.end();
        return undefined;
      }

      const closeStream = streamBus.addConnection(payload.marketKey, reply.raw);
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
      context.logger.error("fastify_app.markets.stream_failed", {
        marketKey,
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

  app.get("/api/markets/:marketKey/price-history", async (request, reply) => {
    const marketKey = readMarketKeyParam(request);

    try {
      const requestUrl = buildRequestUrl(request);
      const payload = await readMarketPriceHistory(context.dbPool, marketKey, {
        range: requestUrl.searchParams.get("range"),
        interval: requestUrl.searchParams.get("interval"),
        startTs: requestUrl.searchParams.get("startTs") ?? requestUrl.searchParams.get("start_ts"),
        endTs: requestUrl.searchParams.get("endTs") ?? requestUrl.searchParams.get("end_ts"),
        fidelity: requestUrl.searchParams.get("fidelity"),
        limit: requestUrl.searchParams.get("limit")
      });

      if (!payload) {
        sendMarketNotFound(reply);
        return undefined;
      }

      setHistoryCacheControl(reply, requestUrl.searchParams.get("range"));
      return payload;
    } catch (error) {
      context.logger.error("fastify_app.markets.price_history_failed", {
        marketKey,
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.get("/api/markets/:marketKey/history", async (request, reply) => {
    const marketKey = readMarketKeyParam(request);

    try {
      const requestUrl = buildRequestUrl(request);
      const payload = await readMarketHistory(context.dbPool, marketKey, {
        range: requestUrl.searchParams.get("range"),
        interval: requestUrl.searchParams.get("interval"),
        startTs: requestUrl.searchParams.get("startTs") ?? requestUrl.searchParams.get("start_ts"),
        endTs: requestUrl.searchParams.get("endTs") ?? requestUrl.searchParams.get("end_ts"),
        fidelity: requestUrl.searchParams.get("fidelity"),
        limit: requestUrl.searchParams.get("limit")
      });

      if (!payload) {
        sendMarketNotFound(reply);
        return undefined;
      }

      setHistoryCacheControl(reply, requestUrl.searchParams.get("range"));
      return payload;
    } catch (error) {
      context.logger.error("fastify_app.markets.history_failed", {
        marketKey,
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.get("/api/markets/:marketKey/event-history", async (request, reply) => {
    const marketKey = readMarketKeyParam(request);

    try {
      const requestUrl = buildRequestUrl(request);
      const payload = await readEventHistory(context.dbPool, marketKey, {
        range: requestUrl.searchParams.get("range"),
        interval: requestUrl.searchParams.get("interval"),
        startTs: requestUrl.searchParams.get("startTs") ?? requestUrl.searchParams.get("start_ts"),
        endTs: requestUrl.searchParams.get("endTs") ?? requestUrl.searchParams.get("end_ts"),
        fidelity: requestUrl.searchParams.get("fidelity"),
        limit: requestUrl.searchParams.get("limit")
      });

      if (!payload) {
        sendMarketNotFound(reply);
        return undefined;
      }

      setHistoryCacheControl(reply, requestUrl.searchParams.get("range"));
      return payload;
    } catch (error) {
      context.logger.error("fastify_app.markets.event_history_failed", {
        marketKey,
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.get("/api/markets/:marketKey/lifecycle-events", async (request, reply) => {
    const marketKey = readMarketKeyParam(request);

    try {
      const requestUrl = buildRequestUrl(request);
      const payload = await readMarketLifecycleEvents(context.dbPool, marketKey, {
        limit: requestUrl.searchParams.get("limit"),
        order: requestUrl.searchParams.get("order")
      });

      if (!payload) {
        sendMarketNotFound(reply);
        return undefined;
      }

      setPublicCacheControl(reply, {
        browserMaxAgeSeconds: 10,
        cloudflareMaxAgeSeconds: 30,
        staleWhileRevalidateSeconds: 60
      });
      return payload;
    } catch (error) {
      context.logger.error("fastify_app.markets.lifecycle_events_failed", {
        marketKey,
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.get("/api/markets/:marketKey/trades", async (request, reply) => {
    const marketKey = readMarketKeyParam(request);

    try {
      const requestUrl = buildRequestUrl(request);
      const payload = await readMarketTrades(context.dbPool, marketKey, {
        limit: requestUrl.searchParams.get("limit"),
        cursor: requestUrl.searchParams.get("cursor"),
        side: requestUrl.searchParams.get("side"),
        contractSide: requestUrl.searchParams.get("contractSide"),
        outcome: requestUrl.searchParams.get("outcome")
      });

      if (!payload) {
        sendMarketNotFound(reply);
        return undefined;
      }

      setPublicCacheControl(reply, {
        browserMaxAgeSeconds: 10,
        cloudflareMaxAgeSeconds: 30,
        staleWhileRevalidateSeconds: 60
      });
      return payload;
    } catch (error) {
      context.logger.error("fastify_app.markets.public_trades_failed", {
        marketKey,
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.get("/api/markets/:marketKey/positions", async (request, reply) => {
    const marketKey = readMarketKeyParam(request);

    try {
      const requestUrl = buildRequestUrl(request);
      const payload = await readMarketPositions(context.dbPool, marketKey, {
        limit: requestUrl.searchParams.get("limit")
      });

      if (!payload) {
        sendMarketNotFound(reply);
        return undefined;
      }

      setPublicCacheControl(reply, {
        browserMaxAgeSeconds: 10,
        cloudflareMaxAgeSeconds: 30,
        staleWhileRevalidateSeconds: 60
      });
      return payload;
    } catch (error) {
      context.logger.error("fastify_app.markets.positions_failed", {
        marketKey,
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.get("/api/markets/:marketKey", async (request, reply) => {
    const marketKey = readMarketKeyParam(request);

    try {
      const payload = await readMarket(context.dbPool, marketKey);

      if (!payload) {
        sendMarketNotFound(reply);
        return undefined;
      }

      setPublicCacheControl(reply, {
        browserMaxAgeSeconds: 10,
        cloudflareMaxAgeSeconds: 30,
        staleWhileRevalidateSeconds: 60
      });
      return payload;
    } catch (error) {
      context.logger.error("fastify_app.markets.read_failed", {
        marketKey,
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });
}
