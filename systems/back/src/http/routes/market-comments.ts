import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";

import {
  ActorResolutionError,
  resolveRequestActor,
  resolveRequiredAdminActor
} from "../../auth/actor-resolver";
import { readCookie } from "../../auth/session-cookie";
import type { AppEnv } from "../../config/env";
import { sendActorResolutionError, sendError, sendInvalidJsonError } from "./route-errors";
import {
  createMarketComment,
  deleteOwnMarketComment,
  likeMarketComment,
  MarketCommentsServiceError,
  readMarketComments,
  reportMarketComment,
  setMarketCommentModerationStatus
} from "../../markets/market-comments-service";
import { formatUnknownError, type Logger } from "../../shared/logger";
import { broadcastMarketCommentEvent } from "../market-stream-broadcasts";
import type { MarketStreamBus } from "../market-stream-bus";

type MarketCommentsRouteContext = {
  dbPool: Pool;
  env: AppEnv;
  logger: Logger;
  marketStreamBus?: MarketStreamBus;
};

function readRequiredBody(request: FastifyRequest): unknown {
  if (typeof request.body === "undefined" || request.body === null) {
    throw new Error("JSON body is required");
  }

  return request.body;
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

function readCommentIdParam(request: FastifyRequest): string {
  return String((request.params as { commentId?: string }).commentId ?? "");
}

function sendMarketNotFound(reply: FastifyReply): void {
  sendError(reply, 404, "market_not_found", "Market not found.");
}

function sendMarketCommentsError(
  context: MarketCommentsRouteContext,
  reply: FastifyReply,
  error: unknown,
  logName: string,
  marketKey: string
): boolean {
  if (error instanceof ActorResolutionError) {
    sendActorResolutionError(reply, error);
    return true;
  }

  if (error instanceof MarketCommentsServiceError) {
    sendError(reply, error.statusCode, error.code, error.message);
    return true;
  }

  if (error instanceof Error && error.message === "JSON body is required") {
    sendInvalidJsonError(reply, error.message);
    return true;
  }

  context.logger.error(`fastify_app.market_comments_${logName}.request_failed`, {
    marketKey,
    error: formatUnknownError(error)
  });
  sendError(reply, 500, "internal_error", "Unexpected server failure.");
  return true;
}

async function readOptionalViewerUserId(
  context: MarketCommentsRouteContext,
  request: FastifyRequest
): Promise<string | null> {
  const token = readCookie(request.raw, context.env.auth.sessionCookieName);

  if (!token) {
    return null;
  }

  try {
    const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, {
      allowDemo: false
    });
    return actor.actorId;
  } catch (_error) {
    return null;
  }
}

export function registerMarketCommentRoutes(
  app: FastifyInstance,
  context: MarketCommentsRouteContext
): void {
  app.get("/api/markets/:marketKey/comments", async (request, reply) => {
    const marketKey = readMarketKeyParam(request);

    try {
      const requestUrl = buildRequestUrl(request);
      const payload = await readMarketComments(context.dbPool, marketKey, {
        limit: requestUrl.searchParams.get("limit"),
        cursor: requestUrl.searchParams.get("cursor"),
        eventId: requestUrl.searchParams.get("eventId"),
        viewerUserId: await readOptionalViewerUserId(context, request)
      });

      if (!payload) {
        sendMarketNotFound(reply);
        return undefined;
      }

      return payload;
    } catch (error) {
      sendMarketCommentsError(context, reply, error, "read", marketKey);
      return undefined;
    }
  });

  app.post("/api/markets/:marketKey/comments", async (request, reply) => {
    const marketKey = readMarketKeyParam(request);

    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, {
        allowDemo: false
      });
      reply.code(201);
      const payload = await createMarketComment(
        context.dbPool,
        marketKey,
        actor.actorId,
        readRequiredBody(request)
      );
      if (payload?.comment) {
        broadcastMarketCommentEvent({
          dbPool: context.dbPool,
          marketStreamBus: context.marketStreamBus,
          requestLogger: context.logger,
          marketKey,
          eventType: "comment.new",
          comment: payload.comment
        });
      }
      return payload;
    } catch (error) {
      sendMarketCommentsError(context, reply, error, "create", marketKey);
      return undefined;
    }
  });

  app.post("/api/markets/:marketKey/comments/:commentId/replies", async (request, reply) => {
    const marketKey = readMarketKeyParam(request);
    const commentId = readCommentIdParam(request);

    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, {
        allowDemo: false
      });
      reply.code(201);
      const payload = await createMarketComment(
        context.dbPool,
        marketKey,
        actor.actorId,
        readRequiredBody(request),
        { parentCommentId: commentId }
      );
      if (payload?.comment) {
        broadcastMarketCommentEvent({
          dbPool: context.dbPool,
          marketStreamBus: context.marketStreamBus,
          requestLogger: context.logger,
          marketKey,
          eventType: "comment.reply",
          comment: payload.comment
        });
      }
      return payload;
    } catch (error) {
      sendMarketCommentsError(context, reply, error, "reply", marketKey);
      return undefined;
    }
  });

  app.post("/api/markets/:marketKey/comments/:commentId/like", async (request, reply) => {
    const marketKey = readMarketKeyParam(request);
    const commentId = readCommentIdParam(request);

    try {
      const requestUrl = buildRequestUrl(request);
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, {
        allowDemo: false
      });
      const payload = await likeMarketComment(context.dbPool, marketKey, actor.actorId, commentId, {
        eventId: requestUrl.searchParams.get("eventId")
      });
      if (payload?.ok) {
        broadcastMarketCommentEvent({
          dbPool: context.dbPool,
          marketStreamBus: context.marketStreamBus,
          requestLogger: context.logger,
          marketKey,
          eventType: "comment.like",
          payload: {
            commentId: payload.commentId,
            likes: payload.likes
          }
        });
      }
      return payload;
    } catch (error) {
      sendMarketCommentsError(context, reply, error, "like", marketKey);
      return undefined;
    }
  });

  app.post("/api/markets/:marketKey/comments/:commentId/report", async (request, reply) => {
    const marketKey = readMarketKeyParam(request);
    const commentId = readCommentIdParam(request);

    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, {
        allowDemo: false
      });
      const payload = await reportMarketComment(
        context.dbPool,
        marketKey,
        actor.actorId,
        commentId,
        request.body
      );
      return payload;
    } catch (error) {
      sendMarketCommentsError(context, reply, error, "report", marketKey);
      return undefined;
    }
  });

  app.delete("/api/markets/:marketKey/comments/:commentId", async (request, reply) => {
    const marketKey = readMarketKeyParam(request);
    const commentId = readCommentIdParam(request);

    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, {
        allowDemo: false
      });
      const payload = await deleteOwnMarketComment(context.dbPool, actor.actorId, commentId);
      return payload;
    } catch (error) {
      sendMarketCommentsError(context, reply, error, "delete", marketKey);
      return undefined;
    }
  });

  // Operator moderation: hide / delete / restore any comment. Admin-only.
  app.post("/admin/markets/:marketKey/comments/:commentId/moderation", async (request, reply) => {
    const marketKey = readMarketKeyParam(request);
    const commentId = readCommentIdParam(request);

    try {
      await resolveRequiredAdminActor(context.dbPool, context.env, request.raw);
      const body = readRequiredBody(request) as { status?: unknown };
      const payload = await setMarketCommentModerationStatus(
        context.dbPool,
        commentId,
        String(body?.status ?? "")
      );
      return payload;
    } catch (error) {
      sendMarketCommentsError(context, reply, error, "moderation", marketKey);
      return undefined;
    }
  });

  for (const path of [
    "/api/markets/:marketKey/comments",
    "/api/markets/:marketKey/comments/:commentId",
    "/api/markets/:marketKey/comments/:commentId/replies",
    "/api/markets/:marketKey/comments/:commentId/like",
    "/api/markets/:marketKey/comments/:commentId/report"
  ]) {
    app.options(path, async (_request, reply) => {
      reply.code(204).send();
    });
  }
}
