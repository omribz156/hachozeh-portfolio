import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";

import {
  clearCurrentUserAvatar,
  CurrentUserAvatarServiceError,
  readLocalAvatarFile,
  updateCurrentUserAvatar
} from "../../auth/current-user-avatar-service";
import {
  cancelCurrentUserAccountDeletion,
  CurrentUserAccountDeletionServiceError,
  readCurrentUserAccountDeletion,
  scheduleCurrentUserAccountDeletion
} from "../../auth/current-user-account-deletion-service";
import { readCurrentUserDataExport } from "../../auth/current-user-data-export-service";
import { readCurrentUser } from "../../auth/current-user-service";
import {
  readCurrentUserNotificationPreferences,
  CurrentUserNotificationPreferencesError,
  updateCurrentUserNotificationPreferences
} from "../../auth/current-user-notification-preferences-service";
import {
  CurrentUserProfileServiceError,
  readCurrentUserHandleAvailability,
  updateCurrentUserProfile
} from "../../auth/current-user-profile-service";
import { readCurrentUserSessionSummary } from "../../auth/current-user-session-read-service";
import {
  CurrentUserSessionMutationError,
  revokeCurrentUserSessionById,
  revokeOtherCurrentUserSessions
} from "../../auth/current-user-session-revoke-service";
import {
  CurrentUserSocialLinksServiceError,
  deleteCurrentUserSocialLink,
  readCurrentUserSocialLinks,
  updateCurrentUserSocialLinks
} from "../../auth/current-user-social-links-service";
import { parseStartBody } from "../../auth/session/request-parsers";
import {
  AuthSessionError,
  logoutCurrentSession,
  readSessionSummary,
  startAuthChallenge,
  verifyAuthChallenge
} from "../../auth/session-service";
import type { AuthStartResponse } from "../../auth/session/types";
import {
  ActorResolutionError,
  resolveRequestActor
} from "../../auth/actor-resolver";
import { sendActorResolutionError, sendError, sendInvalidJsonError } from "./route-errors";
import {
  purchaseVerificationTier,
  VerificationTierServiceError
} from "../../auth/user-verification-tier-service";
import type { AppEnv } from "../../config/env";
import type { Queryable } from "../../db/client/pool";
import { recordRateLimitIntegritySignal } from "../../risk/market-integrity-service";
import { formatUnknownError, type Logger } from "../../shared/logger";
import type { RateLimiter, RateLimitResult } from "../rate-limit";

type AuthSessionRouteContext = {
  dbPool: Pool;
  env: AppEnv;
  logger: Logger;
  rateLimiter: RateLimiter;
  startAuthChallenge?: (
    db: Queryable,
    env: AppEnv,
    body: unknown
  ) => Promise<AuthStartResponse>;
};

function buildDataExportAttachmentFilename(userId: string): string {
  const safeUserId = userId
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "user";

  return `hachozeh-data-export-${safeUserId}.json`;
}

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

async function recordRateLimitSignalSafely(
  context: AuthSessionRouteContext,
  request: FastifyRequest,
  result: RateLimitResult
): Promise<void> {
  try {
    await recordRateLimitIntegritySignal(context.dbPool, request.raw, result);
  } catch (error) {
    context.logger.warn("fastify_app.risk.rate_limit_signal_failed", {
      family: result.family,
      error: formatUnknownError(error)
    });
  }
}

export function registerAuthSessionRoutes(
  app: FastifyInstance,
  context: AuthSessionRouteContext
): void {
  const authStart = context.startAuthChallenge ?? startAuthChallenge;

  app.post("/api/auth/start", async (request, reply) => {
    const otpSendResult = context.rateLimiter.check(request.raw, "auth_otp_send");
    reply.header("x-rate-limit-family", otpSendResult.family);
    reply.header("x-rate-limit-limit", String(otpSendResult.limit));
    reply.header("x-rate-limit-remaining", String(otpSendResult.remaining));
    reply.header("x-rate-limit-reset", new Date(otpSendResult.resetAt).toISOString());

    if (!otpSendResult.allowed) {
      await recordRateLimitSignalSafely(context, request, otpSendResult);
      reply.header("retry-after", String(otpSendResult.retryAfterSeconds));
      sendError(
        reply,
        429,
        "rate_limited",
        "Too many OTP requests from this IP address.",
        {
          family: otpSendResult.family,
          retryAfterSeconds: otpSendResult.retryAfterSeconds
        }
      );
      return undefined;
    }

    try {
      const parsedBody = parseStartBody(readRequiredBody(request));
      return await authStart(context.dbPool, context.env, parsedBody);
    } catch (error) {
      if (error instanceof AuthSessionError) {
        sendError(reply, error.statusCode, error.code, error.message);
        return undefined;
      }

      if (error instanceof Error && error.message === "JSON body is required") {
        sendInvalidJsonError(reply, error.message);
        return undefined;
      }

      context.logger.error("fastify_app.auth.start_failed", {
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.post("/api/auth/verify", async (request, reply) => {
    try {
      const { payload, setCookie } = await verifyAuthChallenge(
        context.dbPool,
        context.env,
        request.raw,
        readRequiredBody(request)
      );
      reply.header("set-cookie", setCookie);
      return payload;
    } catch (error) {
      if (error instanceof AuthSessionError) {
        sendError(reply, error.statusCode, error.code, error.message);
        return undefined;
      }

      if (error instanceof Error && error.message === "JSON body is required") {
        sendInvalidJsonError(reply, error.message);
        return undefined;
      }

      context.logger.error("fastify_app.auth.verify_failed", {
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.post("/api/auth/logout", async (request, reply) => {
    try {
      const { payload, setCookie } = await logoutCurrentSession(
        context.dbPool,
        context.env,
        request.raw
      );
      reply.header("set-cookie", setCookie);
      return payload;
    } catch (error) {
      if (error instanceof AuthSessionError) {
        sendError(reply, error.statusCode, error.code, error.message);
        return undefined;
      }

      context.logger.error("fastify_app.auth.logout_failed", {
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.get("/api/session", async (request, reply) => {
    try {
      const { payload, setCookie } = await readSessionSummary(
        context.dbPool,
        context.env,
        request.raw
      );

      let currentUser: Awaited<ReturnType<typeof readCurrentUser>> | null = null;

      if (payload.session.authenticated && payload.actor?.userId) {
        try {
          currentUser = await readCurrentUser(context.dbPool, payload.actor.userId);
        } catch (enrichmentError) {
          context.logger.warn("fastify_app.session.current_user_enrichment_failed", {
            error: formatUnknownError(enrichmentError)
          });
        }
      }

      if (setCookie) {
        reply.header("set-cookie", setCookie);
      }

      return currentUser ? { ...payload, currentUser } : payload;
    } catch (error) {
      context.logger.error("fastify_app.session.read_failed", {
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.get("/api/me", async (request, reply) => {
    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, {
        allowDemo: false
      });
      return await readCurrentUser(context.dbPool, actor.actorId);
    } catch (error) {
      if (error instanceof ActorResolutionError) {
        sendActorResolutionError(reply, error);
        return undefined;
      }

      context.logger.error("fastify_app.current_user.read_failed", {
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.patch("/api/me/profile", async (request, reply) => {
    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, {
        allowDemo: false
      });
      return await updateCurrentUserProfile(
        context.dbPool,
        actor.actorId,
        readRequiredBody(request)
      );
    } catch (error) {
      if (error instanceof ActorResolutionError) {
        sendActorResolutionError(reply, error);
        return undefined;
      }

      if (error instanceof CurrentUserProfileServiceError) {
        sendError(reply, error.statusCode, error.code, error.message);
        return undefined;
      }

      if (error instanceof Error && error.message === "JSON body is required") {
        sendInvalidJsonError(reply, error.message);
        return undefined;
      }

      context.logger.error("fastify_app.current_user.profile_update_failed", {
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.get("/api/me/profile/handle-availability", async (request, reply) => {
    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, {
        allowDemo: false
      });
      const requestUrl = buildRequestUrl(request);
      return await readCurrentUserHandleAvailability(
        context.dbPool,
        actor.actorId,
        requestUrl.searchParams.get("handle")
      );
    } catch (error) {
      if (error instanceof ActorResolutionError) {
        sendActorResolutionError(reply, error);
        return undefined;
      }

      if (error instanceof CurrentUserProfileServiceError) {
        sendError(reply, error.statusCode, error.code, error.message);
        return undefined;
      }

      context.logger.error("fastify_app.current_user.handle_availability_failed", {
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  // Body stays tiny because the client downscales to a 512² webp/jpeg before upload (~tens
  // of KB). 256KB leaves comfortable headroom (incl. an old-browser PNG fallback) while
  // closing the hole the old 6MB override punched in the 32KB global limit.
  app.post("/api/me/avatar", { bodyLimit: 256 * 1024 }, async (request, reply) => {
    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, {
        allowDemo: false
      });
      return await updateCurrentUserAvatar(
        context.dbPool,
        actor.actorId,
        readRequiredBody(request)
      );
    } catch (error) {
      if (error instanceof ActorResolutionError) {
        sendActorResolutionError(reply, error);
        return undefined;
      }

      if (error instanceof CurrentUserAvatarServiceError) {
        sendError(reply, error.statusCode, error.code, error.message);
        return undefined;
      }

      if (error instanceof Error && error.message === "JSON body is required") {
        sendInvalidJsonError(reply, error.message);
        return undefined;
      }

      context.logger.error("fastify_app.current_user.avatar_update_failed", {
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.delete("/api/me/avatar", async (request, reply) => {
    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, {
        allowDemo: false
      });
      return await clearCurrentUserAvatar(context.dbPool, actor.actorId);
    } catch (error) {
      if (error instanceof ActorResolutionError) {
        sendActorResolutionError(reply, error);
        return undefined;
      }

      if (error instanceof CurrentUserAvatarServiceError) {
        sendError(reply, error.statusCode, error.code, error.message);
        return undefined;
      }

      context.logger.error("fastify_app.current_user.avatar_clear_failed", {
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.get("/api/uploads/avatars/:fileName", async (request, reply) => {
    try {
      const fileName = String((request.params as { fileName?: string }).fileName ?? "");
      const file = await readLocalAvatarFile(fileName);

      if (!file) {
        sendError(reply, 404, "avatar_not_found", "Avatar image not found.");
        return undefined;
      }

      reply
        .header("content-type", file.contentType)
        .header("x-content-type-options", "nosniff")
        .header("cache-control", "public, max-age=31536000, immutable")
        .send(file.buffer);
      return undefined;
    } catch (error) {
      context.logger.error("fastify_app.current_user.avatar_read_failed", {
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.get("/api/me/notification-preferences", async (request, reply) => {
    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, {
        allowDemo: false
      });
      return await readCurrentUserNotificationPreferences(context.dbPool, actor.actorId);
    } catch (error) {
      if (error instanceof ActorResolutionError) {
        sendActorResolutionError(reply, error);
        return undefined;
      }

      context.logger.error("fastify_app.current_user.notification_preferences_read_failed", {
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.put("/api/me/notification-preferences", async (request, reply) => {
    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, {
        allowDemo: false
      });
      return await updateCurrentUserNotificationPreferences(
        context.dbPool,
        actor.actorId,
        readRequiredBody(request)
      );
    } catch (error) {
      if (error instanceof ActorResolutionError) {
        sendActorResolutionError(reply, error);
        return undefined;
      }

      if (error instanceof CurrentUserNotificationPreferencesError) {
        sendError(reply, error.statusCode, error.code, error.message);
        return undefined;
      }

      if (error instanceof Error && error.message === "JSON body is required") {
        sendInvalidJsonError(reply, error.message);
        return undefined;
      }

      context.logger.error("fastify_app.current_user.notification_preferences_update_failed", {
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.get("/api/me/social-links", async (request, reply) => {
    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, {
        allowDemo: false
      });
      return await readCurrentUserSocialLinks(context.dbPool, actor.actorId);
    } catch (error) {
      if (error instanceof ActorResolutionError) {
        sendActorResolutionError(reply, error);
        return undefined;
      }

      context.logger.error("fastify_app.current_user.social_links_read_failed", {
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.put("/api/me/social-links", async (request, reply) => {
    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, {
        allowDemo: false
      });
      return await updateCurrentUserSocialLinks(
        context.dbPool,
        actor.actorId,
        readRequiredBody(request)
      );
    } catch (error) {
      if (error instanceof ActorResolutionError) {
        sendActorResolutionError(reply, error);
        return undefined;
      }

      if (error instanceof CurrentUserSocialLinksServiceError) {
        sendError(reply, error.statusCode, error.code, error.message);
        return undefined;
      }

      if (error instanceof Error && error.message === "JSON body is required") {
        sendInvalidJsonError(reply, error.message);
        return undefined;
      }

      context.logger.error("fastify_app.current_user.social_links_update_failed", {
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.delete("/api/me/social-links/:platform", async (request, reply) => {
    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, {
        allowDemo: false
      });
      const params = request.params as { platform?: string };
      return await deleteCurrentUserSocialLink(
        context.dbPool,
        actor.actorId,
        params.platform || ""
      );
    } catch (error) {
      if (error instanceof ActorResolutionError) {
        sendActorResolutionError(reply, error);
        return undefined;
      }

      if (error instanceof CurrentUserSocialLinksServiceError) {
        sendError(reply, error.statusCode, error.code, error.message);
        return undefined;
      }

      context.logger.error("fastify_app.current_user.social_links_delete_failed", {
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.get("/api/me/data-export", async (request, reply) => {
    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, {
        allowDemo: false
      });
      const payload = await readCurrentUserDataExport(context.dbPool, actor.actorId);
      reply
        .header("content-type", "application/json; charset=utf-8")
        .header("cache-control", "no-store")
        .header("pragma", "no-cache")
        .header("expires", "0")
        .header(
          "content-disposition",
          `attachment; filename="${buildDataExportAttachmentFilename(actor.actorId)}"`
        );
      reply.send(JSON.stringify(payload, null, 2));
      return undefined;
    } catch (error) {
      if (error instanceof ActorResolutionError) {
        sendActorResolutionError(reply, error);
        return undefined;
      }

      context.logger.error("fastify_app.current_user.data_export_failed", {
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.get("/api/me/account-deletion", async (request, reply) => {
    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, {
        allowDemo: false
      });
      return await readCurrentUserAccountDeletion(context.dbPool, actor.actorId);
    } catch (error) {
      if (error instanceof ActorResolutionError) {
        sendActorResolutionError(reply, error);
        return undefined;
      }

      context.logger.error("fastify_app.current_user.account_deletion_read_failed", {
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.post("/api/me/account-deletion", async (request, reply) => {
    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, {
        allowDemo: false
      });
      return await scheduleCurrentUserAccountDeletion(
        context.dbPool,
        actor.actorId,
        actor.sessionId || "",
        request.body ?? {}
      );
    } catch (error) {
      if (error instanceof ActorResolutionError) {
        sendActorResolutionError(reply, error);
        return undefined;
      }

      if (error instanceof CurrentUserAccountDeletionServiceError) {
        sendError(reply, error.statusCode, error.code, error.message);
        return undefined;
      }

      if (error instanceof Error && error.message === "JSON body is required") {
        sendInvalidJsonError(reply, error.message);
        return undefined;
      }

      context.logger.error("fastify_app.current_user.account_deletion_schedule_failed", {
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.delete("/api/me/account-deletion", async (request, reply) => {
    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, {
        allowDemo: false
      });
      return await cancelCurrentUserAccountDeletion(
        context.dbPool,
        actor.actorId,
        actor.sessionId || "",
        request.body ?? {}
      );
    } catch (error) {
      if (error instanceof ActorResolutionError) {
        sendActorResolutionError(reply, error);
        return undefined;
      }

      if (error instanceof CurrentUserAccountDeletionServiceError) {
        sendError(reply, error.statusCode, error.code, error.message);
        return undefined;
      }

      context.logger.error("fastify_app.current_user.account_deletion_cancel_failed", {
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.post("/api/me/verification-tier/purchase", async (request, reply) => {
    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, {
        allowDemo: false
      });
      return await purchaseVerificationTier(
        context.dbPool,
        actor.actorId,
        readRequiredBody(request)
      );
    } catch (error) {
      if (error instanceof ActorResolutionError) {
        sendActorResolutionError(reply, error);
        return undefined;
      }

      if (error instanceof VerificationTierServiceError) {
        sendError(reply, error.statusCode, error.code, error.message);
        return undefined;
      }

      if (error instanceof Error && error.message === "JSON body is required") {
        sendInvalidJsonError(reply, error.message);
        return undefined;
      }

      context.logger.error("fastify_app.current_user.verification_tier_purchase_failed", {
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.get("/api/me/sessions", async (request, reply) => {
    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, {
        allowDemo: false
      });
      return await readCurrentUserSessionSummary(
        context.dbPool,
        actor.actorId,
        actor.sessionId || ""
      );
    } catch (error) {
      if (error instanceof ActorResolutionError) {
        sendActorResolutionError(reply, error);
        return undefined;
      }

      context.logger.error("fastify_app.current_user_sessions.read_failed", {
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.post("/api/me/sessions/revoke-others", async (request, reply) => {
    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, {
        allowDemo: false
      });
      return await revokeOtherCurrentUserSessions(
        context.dbPool,
        actor.actorId,
        actor.sessionId || "",
        readRequiredBody(request)
      );
    } catch (error) {
      if (error instanceof ActorResolutionError) {
        sendActorResolutionError(reply, error);
        return undefined;
      }

      if (error instanceof CurrentUserSessionMutationError) {
        sendError(reply, error.statusCode, error.code, error.message);
        return undefined;
      }

      if (error instanceof Error && error.message === "JSON body is required") {
        sendInvalidJsonError(reply, error.message);
        return undefined;
      }

      context.logger.error("fastify_app.current_user_sessions.revoke_others_failed", {
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.delete("/api/me/sessions/:sessionId", async (request, reply) => {
    try {
      const actor = await resolveRequestActor(context.dbPool, context.env, request.raw, {
        allowDemo: false
      });
      const params = request.params as { sessionId?: string };
      return await revokeCurrentUserSessionById(
        context.dbPool,
        actor.actorId,
        actor.sessionId || "",
        params.sessionId || "",
        request.body ?? {}
      );
    } catch (error) {
      if (error instanceof ActorResolutionError) {
        sendActorResolutionError(reply, error);
        return undefined;
      }

      if (error instanceof CurrentUserSessionMutationError) {
        sendError(reply, error.statusCode, error.code, error.message);
        return undefined;
      }

      context.logger.error("fastify_app.current_user_sessions.revoke_single_failed", {
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  for (const path of [
    "/api/auth/start",
    "/api/auth/verify",
    "/api/auth/logout",
    "/api/me/profile",
    "/api/me/avatar",
    "/api/me/notification-preferences",
    "/api/me/social-links",
    "/api/me/social-links/:platform",
    "/api/me/data-export",
    "/api/me/account-deletion",
    "/api/me/verification-tier/purchase",
    "/api/me/sessions/revoke-others",
    "/api/me/sessions/:sessionId"
  ]) {
    app.options(path, async (_request, reply) => {
      reply.code(204).send();
    });
  }
}
