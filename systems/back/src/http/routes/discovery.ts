import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";

import {
  ActorResolutionError,
  resolveRequestActor,
  type RequestActor
} from "../../auth/actor-resolver";
import { readCookie } from "../../auth/session-cookie";
import type { AppEnv } from "../../config/env";
import { sendError } from "./route-errors";
import { readDiscoveryFeed } from "../../discovery/read-discovery-feed-service";
import { DEFAULT_GUEST_DISCOVERY_FEED_CACHE } from "../discovery-feed-snapshot-cache";
import { normalizeFeed } from "../../discovery/feed/ranking";
import { formatUnknownError, type Logger } from "../../shared/logger";
import { readMarketCategoryMeta } from "../../shared/market-category";
import {
  beginServerSentEvents,
  writeServerSentEvent
} from "../json";
import { DEFAULT_DISCOVERY_STREAM_LIMITER } from "../default-discovery-stream-limiter";
import { DEFAULT_STREAM_CONNECTION_LIMITER } from "../default-stream-connection-limiter";
import type { DiscoveryStreamLimiter } from "../discovery-stream-limiter";
import type { StreamConnectionLimiter } from "../stream-connection-limiter";
import {
  paginateDiscoveryFeed,
  parseDiscoveryLimit
} from "../../discovery/feed/pagination";
import {
  setNoStore,
  setPublicCacheControl
} from "../cache-control";

type DiscoveryRouteContext = {
  dbPool: Pool;
  env: AppEnv;
  logger: Logger;
  discoveryStreamLimiter?: DiscoveryStreamLimiter;
  streamConnectionLimiter?: StreamConnectionLimiter;
};

function buildRequestUrl(request: FastifyRequest): URL {
  return new URL(
    request.raw.url ?? "/",
    `http://${request.headers.host?.toString() ?? "localhost"}`
  );
}

function readReplyRequestId(reply: FastifyReply, request: FastifyRequest): string {
  return String(reply.getHeader("x-request-id") ?? request.headers["x-request-id"] ?? "");
}

function buildDiscoveryStreamKey(feed: string | null, category: string | null): string {
  const feedKey = normalizeFeed(feed);
  const normalizedCategory = category?.trim() ?? "";
  const categoryKey = normalizedCategory
    ? readMarketCategoryMeta(normalizedCategory)?.frontendKey ?? "unknown"
    : "all";

  return `${feedKey}:${categoryKey}`;
}

async function resolveOptionalDiscoveryActor(
  context: DiscoveryRouteContext,
  request: FastifyRequest
): Promise<{
  actor: RequestActor | null;
  setCookie?: string;
}> {
  if (!readCookie(request.raw, context.env.auth.sessionCookieName)) {
    return { actor: null };
  }

  try {
    return {
      actor: await resolveRequestActor(context.dbPool, context.env, request.raw, {
        allowDemo: false
      })
    };
  } catch (error) {
    if (error instanceof ActorResolutionError) {
      context.logger.info("fastify_app.discovery_feed.viewer_actor_unavailable", {
        code: error.code
      });

      return {
        actor: null,
        setCookie: error.setCookie ?? undefined
      };
    }

    throw error;
  }
}

export function registerDiscoveryRoutes(
  app: FastifyInstance,
  context: DiscoveryRouteContext
): void {
  app.get("/api/discovery/feed", async (request, reply) => {
    try {
      const requestUrl = buildRequestUrl(request);
      const hadSessionCookie = Boolean(
        readCookie(request.raw, context.env.auth.sessionCookieName)
      );
      const viewerActor = await resolveOptionalDiscoveryActor(context, request);
      const feed = requestUrl.searchParams.get("feed");
      const category = requestUrl.searchParams.get("category");
      const requestedLimit = parseDiscoveryLimit(requestUrl.searchParams.get("limit"));
      const requestedCursor = requestUrl.searchParams.get("cursor");
      const viewerUserId = viewerActor.actor?.actorId ?? null;
      // Guests share the cached snapshot (the SSR feed read fires on every page load);
      // logged-in viewers keep their personalized read.
      const payload = viewerUserId
        ? await readDiscoveryFeed(context.dbPool, { feed, category, viewerUserId })
        : await DEFAULT_GUEST_DISCOVERY_FEED_CACHE.read(
            context.dbPool,
            buildDiscoveryStreamKey(feed, category),
            { feed, category }
          );

      if (viewerActor.setCookie) {
        reply.header("set-cookie", viewerActor.setCookie);
      }

      if (hadSessionCookie || viewerActor.actor) {
        setNoStore(reply);
      } else {
        setPublicCacheControl(reply, {
          browserMaxAgeSeconds: 10,
          cloudflareMaxAgeSeconds: 30,
          staleWhileRevalidateSeconds: 60
        });
      }

      return requestedLimit
        ? paginateDiscoveryFeed(payload, { limit: requestedLimit, cursor: requestedCursor })
        : payload;
    } catch (error) {
      context.logger.error("fastify_app.discovery_feed.request_failed", {
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.get("/api/discovery/feed/stream", async (request, reply) => {
    let closeStream: (() => void) | null = null;

    try {
      const requestUrl = buildRequestUrl(request);
      const viewerActor = await resolveOptionalDiscoveryActor(context, request);
      const feed = requestUrl.searchParams.get("feed");
      const category = requestUrl.searchParams.get("category");
      const viewerUserId = viewerActor.actor?.actorId ?? null;
      const isOneShotStream = requestUrl.searchParams.get("once") === "1";
      const streamKey = buildDiscoveryStreamKey(feed, category);
      const streamLimiter = context.discoveryStreamLimiter ?? DEFAULT_DISCOVERY_STREAM_LIMITER;
      const streamConnectionLimiter =
        context.streamConnectionLimiter ?? DEFAULT_STREAM_CONNECTION_LIMITER;

      if (viewerActor.setCookie) {
        reply.header("set-cookie", viewerActor.setCookie);
      }

      if (!isOneShotStream && !streamLimiter.canAcceptConnection(streamKey)) {
        sendError(reply, 429, "stream_limit_exceeded", "Too many open discovery feed streams.");
        return undefined;
      }

      if (!isOneShotStream && !streamConnectionLimiter.canAcceptConnection(request.raw)) {
        sendError(reply, 429, "stream_limit_exceeded", "Too many open streams from this client.");
        return undefined;
      }

      if (!isOneShotStream) {
        closeStream = streamLimiter.addConnection(streamKey);
        const closeClientStream = streamConnectionLimiter.addConnection(request.raw);
        const closeFeedStream = closeStream;
        closeStream = () => {
          closeFeedStream();
          closeClientStream();
        };
      }

      const writeSnapshot = async () => {
        // Guests share the per-feed cached snapshot (collapses N viewers × 30s re-query to one
        // query per feed-key); logged-in viewers keep their personalized read.
        const payload = viewerUserId
          ? await readDiscoveryFeed(context.dbPool, { feed, category, viewerUserId })
          : await DEFAULT_GUEST_DISCOVERY_FEED_CACHE.read(context.dbPool, streamKey, {
              feed,
              category
            });
        writeServerSentEvent(reply.raw, "discovery.feed_snapshot", {
          eventId: `feed:${payload.feed}:${Date.now()}`,
          eventType: "feed_snapshot",
          ...payload
        });
      };

      reply.hijack();
      reply.raw.setHeader("x-request-id", readReplyRequestId(reply, request));
      beginServerSentEvents(reply.raw, request.raw);
      await writeSnapshot();

      if (isOneShotStream) {
        reply.raw.end();
        return undefined;
      }

      const snapshotTimer = setInterval(() => {
        writeSnapshot().catch((error) => {
          context.logger.warn("fastify_app.discovery_feed_stream.snapshot_failed", {
            error: formatUnknownError(error)
          });
        });
      }, 30_000);
      const heartbeat = setInterval(() => {
        writeServerSentEvent(reply.raw, "heartbeat", {
          eventType: "heartbeat",
          at: new Date().toISOString()
        });
      }, 15_000);

      request.raw.once("close", () => {
        clearInterval(snapshotTimer);
        clearInterval(heartbeat);
        closeStream?.();
        closeStream = null;
      });
      return undefined;
    } catch (error) {
      closeStream?.();
      context.logger.error("fastify_app.discovery_feed_stream.request_failed", {
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
}
