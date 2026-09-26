import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";

import {
  ActorResolutionError,
  resolveRequestActor,
  type RequestActor
} from "../../auth/actor-resolver";
import { readCookie } from "../../auth/session-cookie";
import type { AppEnv } from "../../config/env";
import { sendActorResolutionError, sendError } from "./route-errors";
import { readWeeklyLeaderboard } from "../../social/leaderboard-service";
import {
  followPublicUser,
  PublicProfileServiceError,
  readPublicProfileCatalog,
  readPublicProfilePositions,
  readPublicProfileRecord,
  readPublicUserProfile,
  unfollowPublicUser
} from "../../social/public-profile-service";
import {
  readUserTrackRecord,
  TrackRecordServiceError
} from "../../social/track-record-service";
import { formatUnknownError, type Logger } from "../../shared/logger";

type SocialRouteContext = {
  dbPool: Pool;
  env: AppEnv;
  logger: Logger;
};

function buildRequestUrl(request: FastifyRequest): URL {
  return new URL(
    request.raw.url ?? "/",
    `http://${request.headers.host?.toString() ?? "localhost"}`
  );
}

function readPositiveIntegerQuery(
  value: string | null,
  fallback: number
): number {
  if (!value || !value.trim()) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readUserIdParam(request: FastifyRequest): string {
  return String((request.params as { userId?: string }).userId ?? "").trim();
}

async function resolveOptionalSocialActor(
  context: SocialRouteContext,
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
      context.logger.info("fastify_app.social.viewer_actor_unavailable", {
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

export function registerSocialRoutes(
  app: FastifyInstance,
  context: SocialRouteContext
): void {
  app.get("/api/social/profiles", async (request, reply) => {
    try {
      const requestUrl = buildRequestUrl(request);
      return await readPublicProfileCatalog(context.dbPool, {
        limit: requestUrl.searchParams.get("limit"),
        cursor: requestUrl.searchParams.get("cursor"),
        // Opt-in count(*) (sitemap-index caller only) — see
        // readActivePublicProfileCount for the index this rides on.
        includeTotal: requestUrl.searchParams.get("includeTotal") === "1",
        // Direct chunk addressing (sitemap-index children) — see
        // readPublicProfileCatalog's offset doc comment.
        offset: requestUrl.searchParams.get("offset")
      });
    } catch (error) {
      context.logger.error("fastify_app.social.profile_catalog_failed", {
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.get("/api/social/leaderboard/weekly", async (request, reply) => {
    try {
      const requestUrl = buildRequestUrl(request);
      return await readWeeklyLeaderboard(context.dbPool, {
        limit: readPositiveIntegerQuery(requestUrl.searchParams.get("limit"), 20)
      });
    } catch (error) {
      context.logger.error("fastify_app.social.leaderboard_failed", {
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.get("/api/social/users/:userId", async (request, reply) => {
    const userId = readUserIdParam(request);

    try {
      const viewerActor = await resolveOptionalSocialActor(context, request);
      if (viewerActor.setCookie) {
        reply.header("set-cookie", viewerActor.setCookie);
      }

      return await readPublicUserProfile(context.dbPool, userId, {
        viewerUserId: viewerActor.actor?.actorId ?? null,
        countView: true
      });
    } catch (error) {
      if (error instanceof PublicProfileServiceError) {
        sendError(reply, error.statusCode, error.code, error.message);
        return undefined;
      }

      context.logger.error("fastify_app.social.public_profile_failed", {
        userId,
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.post("/api/social/users/:userId/follow", async (request, reply) => {
    const userId = readUserIdParam(request);

    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, {
        allowDemo: false
      });
      return await followPublicUser(context.dbPool, userId, actor.actorId);
    } catch (error) {
      if (error instanceof ActorResolutionError) {
        sendActorResolutionError(reply, error);
        return undefined;
      }

      if (error instanceof PublicProfileServiceError) {
        sendError(reply, error.statusCode, error.code, error.message);
        return undefined;
      }

      context.logger.error("fastify_app.social.follow_failed", {
        userId,
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.delete("/api/social/users/:userId/follow", async (request, reply) => {
    const userId = readUserIdParam(request);

    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, {
        allowDemo: false
      });
      return await unfollowPublicUser(context.dbPool, userId, actor.actorId);
    } catch (error) {
      if (error instanceof ActorResolutionError) {
        sendActorResolutionError(reply, error);
        return undefined;
      }

      if (error instanceof PublicProfileServiceError) {
        sendError(reply, error.statusCode, error.code, error.message);
        return undefined;
      }

      context.logger.error("fastify_app.social.unfollow_failed", {
        userId,
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.get("/api/social/users/:userId/positions", async (request, reply) => {
    const userId = readUserIdParam(request);

    try {
      const requestUrl = buildRequestUrl(request);
      return await readPublicProfilePositions(context.dbPool, userId, {
        limit: requestUrl.searchParams.get("limit")
      });
    } catch (error) {
      if (error instanceof PublicProfileServiceError) {
        sendError(reply, error.statusCode, error.code, error.message);
        return undefined;
      }

      context.logger.error("fastify_app.social.public_positions_failed", {
        userId,
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.get("/api/social/users/:userId/record", async (request, reply) => {
    const userId = readUserIdParam(request);

    try {
      const requestUrl = buildRequestUrl(request);
      return await readPublicProfileRecord(context.dbPool, userId, {
        limit: requestUrl.searchParams.get("limit")
      });
    } catch (error) {
      if (error instanceof PublicProfileServiceError) {
        sendError(reply, error.statusCode, error.code, error.message);
        return undefined;
      }

      context.logger.error("fastify_app.social.public_record_failed", {
        userId,
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.get("/api/social/users/:userId/track-record", async (request, reply) => {
    const userId = readUserIdParam(request);

    if (!userId) {
      sendError(reply, 400, "invalid_request", "userId is required.");
      return undefined;
    }

    try {
      return await readUserTrackRecord(context.dbPool, userId);
    } catch (error) {
      if (error instanceof TrackRecordServiceError) {
        sendError(reply, error.statusCode, error.code, error.message);
        return undefined;
      }

      context.logger.error("fastify_app.social.track_record_failed", {
        userId,
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });
}
