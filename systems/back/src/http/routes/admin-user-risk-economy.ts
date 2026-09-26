import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";

import {
  ActorResolutionError,
  resolveRequiredAdminActor
} from "../../auth/actor-resolver";
import { readAdminUser } from "../../auth/admin-user-read-service";
import { sendActorResolutionError, sendError, sendInvalidJsonError } from "./route-errors";
import {
  reverseStarterGrant,
  StarterGrantReversalServiceError
} from "../../auth/starter-grant-reversal-service";
import {
  archiveUserAccount,
  blockUserTrading,
  lockUserAccount,
  restoreUserTrading,
  revokeUserSessions,
  unlockUserAccount,
  UserOpsServiceError
} from "../../auth/user-ops-service";
import {
  moderateUserProfile,
  UserProfileModerationServiceError
} from "../../auth/user-profile-moderation-service";
import type { AppEnv } from "../../config/env";
import {
  buildEconomyTelemetryWindow,
  readEconomyTelemetry
} from "../../economy/economy-telemetry-service";
import {
  parseTreasuryTopUpRequest,
  topUpPlatformTreasuryForAdmin,
  TreasuryTopUpServiceError
} from "../../economy/treasury-top-up-service";
import {
  MarketIntegrityServiceError,
  readIntegritySignals,
  readIntegritySignalSummary,
  reviewIntegritySignal
} from "../../risk/market-integrity-service";
import { formatUnknownError, type Logger } from "../../shared/logger";

type AdminUserRiskEconomyRouteContext = {
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
  return new URL(
    request.raw.url ?? "/",
    `http://${request.headers.host?.toString() ?? "localhost"}`
  );
}

function readRequestId(request: FastifyRequest): string {
  return request.headers["x-request-id"]?.toString() || "";
}

function readReplyRequestId(reply: FastifyReply, request: FastifyRequest): string {
  return String(reply.getHeader("x-request-id") ?? readRequestId(request));
}

function readClampedPositiveIntegerParam(
  searchParams: URLSearchParams,
  name: string,
  fallback: number,
  max: number
): number {
  const raw = searchParams.get(name);
  if (!raw || !raw.trim()) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(max, Math.floor(parsed));
}

function readUserIdParam(request: FastifyRequest): string {
  return String((request.params as { userId?: string }).userId ?? "");
}

function readSignalIdParam(request: FastifyRequest): string {
  return String((request.params as { signalId?: string }).signalId ?? "");
}

async function resolveRequiredFastifyAdminActor(
  context: AdminUserRiskEconomyRouteContext,
  request: FastifyRequest
) {
  return await resolveRequiredAdminActor(context.dbPool, context.env, request.raw);
}

function sendAdminUserError(
  context: AdminUserRiskEconomyRouteContext,
  reply: FastifyReply,
  error: unknown,
  logName: string,
  userId: string
): boolean {
  if (error instanceof ActorResolutionError) {
    sendActorResolutionError(reply, error);
    return true;
  }

  if (
    error instanceof UserOpsServiceError ||
    error instanceof UserProfileModerationServiceError ||
    error instanceof StarterGrantReversalServiceError ||
    error instanceof TreasuryTopUpServiceError ||
    error instanceof MarketIntegrityServiceError
  ) {
    sendError(reply, error.statusCode, error.code, error.message);
    return true;
  }

  if (error instanceof Error && error.message === "JSON body is required") {
    sendInvalidJsonError(reply, error.message);
    return true;
  }

  context.logger.error(`fastify_app.admin_user_${logName}.request_failed`, {
    userId,
    error: formatUnknownError(error)
  });
  sendError(reply, 500, "internal_error", "Unexpected server failure.");
  return true;
}

export function registerAdminUserRiskEconomyRoutes(
  app: FastifyInstance,
  context: AdminUserRiskEconomyRouteContext
): void {
  app.get("/admin/users/:userId", async (request, reply) => {
    const userId = readUserIdParam(request);

    try {
      await resolveRequiredFastifyAdminActor(context, request);
      const payload = await readAdminUser(context.dbPool, userId);

      if (!payload) {
        sendError(
          reply,
          404,
          "admin_user_not_found",
          "Requested user was not found.",
          {
            userId,
            requestId: readReplyRequestId(reply, request)
          }
        );
        return undefined;
      }

      return payload;
    } catch (error) {
      sendAdminUserError(context, reply, error, "read", userId);
      return undefined;
    }
  });

  app.post("/admin/users/:userId/lock", async (request, reply) => {
    const userId = readUserIdParam(request);

    try {
      const actor = await resolveRequiredFastifyAdminActor(context, request);
      return await lockUserAccount(context.dbPool, userId, readRequiredBody(request), actor);
    } catch (error) {
      sendAdminUserError(context, reply, error, "lock", userId);
      return undefined;
    }
  });

  app.post("/admin/users/:userId/unlock", async (request, reply) => {
    const userId = readUserIdParam(request);

    try {
      const actor = await resolveRequiredFastifyAdminActor(context, request);
      return await unlockUserAccount(context.dbPool, userId, readRequiredBody(request), actor);
    } catch (error) {
      sendAdminUserError(context, reply, error, "unlock", userId);
      return undefined;
    }
  });

  app.post("/admin/users/:userId/archive", async (request, reply) => {
    const userId = readUserIdParam(request);

    try {
      const actor = await resolveRequiredFastifyAdminActor(context, request);
      return await archiveUserAccount(context.dbPool, userId, readRequiredBody(request), actor);
    } catch (error) {
      sendAdminUserError(context, reply, error, "archive", userId);
      return undefined;
    }
  });

  app.post("/admin/users/:userId/trade-block", async (request, reply) => {
    const userId = readUserIdParam(request);

    try {
      const actor = await resolveRequiredFastifyAdminActor(context, request);
      return await blockUserTrading(context.dbPool, userId, readRequiredBody(request), actor);
    } catch (error) {
      sendAdminUserError(context, reply, error, "trade_block", userId);
      return undefined;
    }
  });

  app.post("/admin/users/:userId/trade-restore", async (request, reply) => {
    const userId = readUserIdParam(request);

    try {
      const actor = await resolveRequiredFastifyAdminActor(context, request);
      return await restoreUserTrading(context.dbPool, userId, readRequiredBody(request), actor);
    } catch (error) {
      sendAdminUserError(context, reply, error, "trade_restore", userId);
      return undefined;
    }
  });

  app.post("/admin/users/:userId/sessions/revoke", async (request, reply) => {
    const userId = readUserIdParam(request);

    try {
      const actor = await resolveRequiredFastifyAdminActor(context, request);
      return await revokeUserSessions(context.dbPool, userId, readRequiredBody(request), actor);
    } catch (error) {
      sendAdminUserError(context, reply, error, "revoke_sessions", userId);
      return undefined;
    }
  });

  app.post("/admin/users/:userId/reverse-starter-grant", async (request, reply) => {
    const userId = readUserIdParam(request);

    try {
      const actor = await resolveRequiredFastifyAdminActor(context, request);
      return await reverseStarterGrant(context.dbPool, userId, readRequiredBody(request), actor);
    } catch (error) {
      sendAdminUserError(context, reply, error, "starter_grant_reversal", userId);
      return undefined;
    }
  });

  app.post("/admin/users/:userId/profile/moderation", async (request, reply) => {
    const userId = readUserIdParam(request);

    try {
      const actor = await resolveRequiredFastifyAdminActor(context, request);
      return await moderateUserProfile(context.dbPool, userId, readRequiredBody(request), actor);
    } catch (error) {
      sendAdminUserError(context, reply, error, "profile_moderation", userId);
      return undefined;
    }
  });

  app.get("/admin/risk/signals", async (request, reply) => {
    try {
      await resolveRequiredFastifyAdminActor(context, request);
      const requestUrl = buildRequestUrl(request);
      return await readIntegritySignals(context.dbPool, {
        limit: readClampedPositiveIntegerParam(requestUrl.searchParams, "limit", 50, 100),
        subject: requestUrl.searchParams.get("subject")
      });
    } catch (error) {
      sendAdminUserError(context, reply, error, "risk_signals", "risk");
      return undefined;
    }
  });

  app.get("/admin/risk/signals/summary", async (request, reply) => {
    try {
      await resolveRequiredFastifyAdminActor(context, request);
      const requestUrl = buildRequestUrl(request);
      return await readIntegritySignalSummary(context.dbPool, {
        windowHours: readClampedPositiveIntegerParam(
          requestUrl.searchParams,
          "windowHours",
          24,
          24 * 30
        )
      });
    } catch (error) {
      sendAdminUserError(context, reply, error, "risk_summary", "risk");
      return undefined;
    }
  });

  app.post("/admin/risk/signals/:signalId/review", async (request, reply) => {
    const signalId = readSignalIdParam(request);

    try {
      const actor = await resolveRequiredFastifyAdminActor(context, request);
      return await reviewIntegritySignal(context.dbPool, {
        signalId,
        actorId: actor.actorId,
        body: readRequiredBody(request)
      });
    } catch (error) {
      sendAdminUserError(context, reply, error, "risk_signal_review", signalId);
      return undefined;
    }
  });

  app.post("/admin/economy/platform-treasury/top-up", async (request, reply) => {
    try {
      const actor = await resolveRequiredFastifyAdminActor(context, request);
      return await topUpPlatformTreasuryForAdmin(
        context.dbPool,
        parseTreasuryTopUpRequest(readRequiredBody(request)),
        actor
      );
    } catch (error) {
      sendAdminUserError(context, reply, error, "platform_treasury_top_up", "platform");
      return undefined;
    }
  });

  app.get("/admin/economy/telemetry", async (request, reply) => {
    const requestUrl = buildRequestUrl(request);

    try {
      await resolveRequiredFastifyAdminActor(context, request);
      const days = readClampedPositiveIntegerParam(requestUrl.searchParams, "days", 7, 90);
      return await readEconomyTelemetry(
        context.dbPool,
        buildEconomyTelemetryWindow(days)
      );
    } catch (error) {
      sendAdminUserError(context, reply, error, "economy_telemetry", "platform");
      return undefined;
    }
  });

  for (const path of [
    "/admin/users/:userId/lock",
    "/admin/users/:userId/unlock",
    "/admin/users/:userId/archive",
    "/admin/users/:userId/trade-block",
    "/admin/users/:userId/trade-restore",
    "/admin/users/:userId/sessions/revoke",
    "/admin/users/:userId/reverse-starter-grant",
    "/admin/users/:userId/profile/moderation",
    "/admin/risk/signals/:signalId/review",
    "/admin/economy/platform-treasury/top-up",
    "/admin/economy/telemetry"
  ]) {
    app.options(path, async (_request, reply) => {
      reply.code(204).send();
    });
  }
}
