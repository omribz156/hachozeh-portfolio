import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";

import { ActorResolutionError, resolveRequestActor } from "../../auth/actor-resolver";
import { readCookie } from "../../auth/session-cookie";
import type { AppEnv } from "../../config/env";
import {
  CommunityServiceError,
  createCommunityComment,
  createCommunityDiscussion,
  createFeedComment,
  readCommunityDiscussion,
  readCommunityDiscussions,
  readFeedComments
} from "../../community/community-service";
import {
  CommunityFeedError,
  createCommunityPost,
  readCommunityFeed
} from "../../community/community-feed-service";
import { readCommunityRail } from "../../community/community-rail-service";
import { toggleCommunityLike } from "../../community/community-likes-service";
import { searchCommunitySubjects } from "../../community/community-subjects";
import {
  readMyPositions,
  readMyResults,
  readShareableMilestones
} from "../../community/community-authored-derive";
import {
  deleteOwnCommunityEntity,
  normalizeEntityKind,
  reportCommunityEntity
} from "../../community/community-moderation-service";
import { formatUnknownError, type Logger } from "../../shared/logger";
import { sendActorResolutionError, sendError, sendInvalidJsonError } from "./route-errors";

type CommunityRouteContext = {
  dbPool: Pool;
  env: AppEnv;
  logger: Logger;
};

function readRequiredBody(request: FastifyRequest): unknown {
  if (typeof request.body === "undefined" || request.body === null) {
    throw new Error("JSON body is required");
  }
  return request.body;
}

function buildRequestUrl(request: FastifyRequest): URL {
  return new URL(request.raw.url ?? "/", `http://${request.headers.host?.toString() ?? "localhost"}`);
}

function readIdParam(request: FastifyRequest): string {
  return String((request.params as { id?: string }).id ?? "");
}

async function readOptionalViewerUserId(
  context: CommunityRouteContext,
  request: FastifyRequest
): Promise<string | null> {
  const token = readCookie(request.raw, context.env.auth.sessionCookieName);
  if (!token) return null;
  try {
    const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, { allowDemo: false });
    return actor.actorId;
  } catch {
    return null;
  }
}

function sendCommunityError(
  context: CommunityRouteContext,
  reply: FastifyReply,
  error: unknown,
  logName: string
): void {
  if (error instanceof ActorResolutionError) {
    sendActorResolutionError(reply, error);
    return;
  }
  if (error instanceof CommunityServiceError || error instanceof CommunityFeedError) {
    sendError(reply, error.statusCode, error.code, error.message);
    return;
  }
  if (error instanceof Error && error.message === "JSON body is required") {
    sendInvalidJsonError(reply, error.message);
    return;
  }
  context.logger.error(`fastify_app.community_${logName}.request_failed`, {
    error: formatUnknownError(error)
  });
  sendError(reply, 500, "internal_error", "Unexpected server failure.");
}

export function registerCommunityRoutes(app: FastifyInstance, context: CommunityRouteContext): void {
  // ── discussions ──
  app.get("/api/community/discussions", async (request, reply) => {
    try {
      const url = buildRequestUrl(request);
      return await readCommunityDiscussions(context.dbPool, {
        topic: url.searchParams.get("topic"),
        sort: url.searchParams.get("sort"),
        limit: url.searchParams.get("limit"),
        cursor: url.searchParams.get("cursor"),
        viewerUserId: await readOptionalViewerUserId(context, request)
      });
    } catch (error) {
      sendCommunityError(context, reply, error, "discussions_list");
      return undefined;
    }
  });

  app.get("/api/community/discussions/:id", async (request, reply) => {
    const id = readIdParam(request);
    try {
      const payload = await readCommunityDiscussion(
        context.dbPool,
        id,
        await readOptionalViewerUserId(context, request)
      );
      if (!payload) {
        sendError(reply, 404, "discussion_not_found", "Discussion not found.");
        return undefined;
      }
      return payload;
    } catch (error) {
      sendCommunityError(context, reply, error, "discussion_detail");
      return undefined;
    }
  });

  app.post("/api/community/discussions", async (request, reply) => {
    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, { allowDemo: false });
      reply.code(201);
      return await createCommunityDiscussion(context.dbPool, actor.actorId, readRequiredBody(request));
    } catch (error) {
      sendCommunityError(context, reply, error, "discussion_create");
      return undefined;
    }
  });

  app.post("/api/community/discussions/:id/comments", async (request, reply) => {
    const id = readIdParam(request);
    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, { allowDemo: false });
      reply.code(201);
      return await createCommunityComment(context.dbPool, actor.actorId, id, readRequiredBody(request));
    } catch (error) {
      sendCommunityError(context, reply, error, "comment_create");
      return undefined;
    }
  });

  // ── feed ──
  app.get("/api/community/feed", async (request, reply) => {
    try {
      const url = buildRequestUrl(request);
      return await readCommunityFeed(context.dbPool, {
        limit: url.searchParams.get("limit"),
        cursor: url.searchParams.get("cursor"),
        viewerUserId: await readOptionalViewerUserId(context, request)
      });
    } catch (error) {
      sendCommunityError(context, reply, error, "feed_list");
      return undefined;
    }
  });

  app.post("/api/community/posts", async (request, reply) => {
    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, { allowDemo: false });
      reply.code(201);
      return await createCommunityPost(context.dbPool, actor.actorId, readRequiredBody(request));
    } catch (error) {
      sendCommunityError(context, reply, error, "post_create");
      return undefined;
    }
  });

  // comments on any feed item (take/share/position/result), keyed by feed id
  app.get("/api/community/feed/:id/comments", async (request, reply) => {
    const id = readIdParam(request);
    try {
      const payload = await readFeedComments(
        context.dbPool,
        id,
        await readOptionalViewerUserId(context, request)
      );
      if (!payload) {
        sendError(reply, 404, "feed_item_not_found", "Feed item not found.");
        return undefined;
      }
      return payload;
    } catch (error) {
      sendCommunityError(context, reply, error, "feed_comments_list");
      return undefined;
    }
  });

  app.post("/api/community/feed/:id/comments", async (request, reply) => {
    const id = readIdParam(request);
    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, { allowDemo: false });
      reply.code(201);
      return await createFeedComment(context.dbPool, actor.actorId, id, readRequiredBody(request));
    } catch (error) {
      sendCommunityError(context, reply, error, "feed_comment_create");
      return undefined;
    }
  });

  // ── likes: toggle on any target (feed item / discussion / comment) ──
  app.post("/api/community/like/:id", async (request, reply) => {
    const id = readIdParam(request);
    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, { allowDemo: false });
      return await toggleCommunityLike(context.dbPool, actor.actorId, id);
    } catch (error) {
      sendCommunityError(context, reply, error, "like_toggle");
      return undefined;
    }
  });

  // ── moderation: report any content / delete your own ──
  // kind ∈ {discussion, comment, post}; one pair of routes covers every surface.
  app.post("/api/community/:kind/:id/report", async (request, reply) => {
    try {
      const kind = normalizeEntityKind(String((request.params as { kind?: string }).kind ?? ""));
      const id = readIdParam(request);
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, { allowDemo: false });
      return await reportCommunityEntity(context.dbPool, actor.actorId, kind, id, request.body);
    } catch (error) {
      sendCommunityError(context, reply, error, "report");
      return undefined;
    }
  });

  app.delete("/api/community/:kind/:id", async (request, reply) => {
    try {
      const kind = normalizeEntityKind(String((request.params as { kind?: string }).kind ?? ""));
      const id = readIdParam(request);
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, { allowDemo: false });
      return await deleteOwnCommunityEntity(context.dbPool, actor.actorId, kind, id);
    } catch (error) {
      sendCommunityError(context, reply, error, "delete");
      return undefined;
    }
  });

  // ── composer pickers for authored position/result/milestone (your real data) ──
  app.get("/api/community/my-positions", async (request, reply) => {
    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, { allowDemo: false });
      return { positions: await readMyPositions(context.dbPool, actor.actorId) };
    } catch (error) {
      sendCommunityError(context, reply, error, "my_positions");
      return undefined;
    }
  });
  app.get("/api/community/my-results", async (request, reply) => {
    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, { allowDemo: false });
      return { results: await readMyResults(context.dbPool, actor.actorId) };
    } catch (error) {
      sendCommunityError(context, reply, error, "my_results");
      return undefined;
    }
  });
  app.get("/api/community/my-milestones", async (request, reply) => {
    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, { allowDemo: false });
      return { milestones: await readShareableMilestones(context.dbPool, actor.actorId) };
    } catch (error) {
      sendCommunityError(context, reply, error, "my_milestones");
      return undefined;
    }
  });

  // ── composer subject picker: markets (children) + events (parents) ──
  app.get("/api/community/subjects", async (request, reply) => {
    try {
      const url = buildRequestUrl(request);
      const subjects = await searchCommunitySubjects(context.dbPool, url.searchParams.get("q") ?? "");
      return { subjects };
    } catch (error) {
      sendCommunityError(context, reply, error, "subjects_search");
      return undefined;
    }
  });

  // ── rail (trending markets + suggested voices) ──
  app.get("/api/community/rail", async (request, reply) => {
    try {
      return await readCommunityRail(context.dbPool, await readOptionalViewerUserId(context, request));
    } catch (error) {
      sendCommunityError(context, reply, error, "rail");
      return undefined;
    }
  });

  for (const path of [
    "/api/community/discussions",
    "/api/community/discussions/:id",
    "/api/community/discussions/:id/comments",
    "/api/community/feed",
    "/api/community/feed/:id/comments",
    "/api/community/posts",
    "/api/community/subjects",
    "/api/community/like/:id",
    "/api/community/my-positions",
    "/api/community/my-results",
    "/api/community/my-milestones",
    "/api/community/rail",
    // moderation (singular kind, so it can't collide with the plural resource paths)
    "/api/community/:kind/:id",
    "/api/community/:kind/:id/report"
  ]) {
    app.options(path, async (_request, reply) => {
      reply.code(204).send();
    });
  }
}
