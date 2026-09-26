import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";

import {
  ActorResolutionError,
  resolveRequestActor,
  type RequestActor
} from "../../auth/actor-resolver";
import type { AppEnv } from "../../config/env";
import { sendActorResolutionError, sendError } from "./route-errors";
import {
  claimDailyLoginFaucet,
  claimEmergencyFaucet,
  FaucetServiceError,
  readWalletFaucets
} from "../../economy/faucet-service";
import { recordEconomyGrantRejectionSignal } from "../../risk/market-integrity-service";
import { formatUnknownError, type Logger } from "../../shared/logger";

type WalletRouteContext = {
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

function readRequestPath(request: FastifyRequest): string {
  return buildRequestUrl(request).pathname;
}

async function resolveWalletActor(
  context: WalletRouteContext,
  request: FastifyRequest
): Promise<RequestActor> {
  return await resolveRequestActor(context.dbPool, context.env, request.raw, {
    allowDemo: !context.env.trading.requireSession
  });
}

async function recordEconomyGrantSignalSafely(
  context: WalletRouteContext,
  request: FastifyRequest,
  error: FaucetServiceError,
  actor: {
    actorId?: string | null;
  } | null,
  faucetType: "daily_login" | "emergency_bankruptcy"
): Promise<void> {
  if (!actor?.actorId) {
    return;
  }

  try {
    await recordEconomyGrantRejectionSignal(context.dbPool, {
      actorId: actor.actorId,
      faucetType,
      reasonCode: error.code,
      statusCode: error.statusCode,
      path: readRequestPath(request)
    });
  } catch (signalError) {
    context.logger.warn("fastify_app.risk.economy_grant_signal_failed", {
      faucetType,
      reasonCode: error.code,
      error: formatUnknownError(signalError)
    });
  }
}

function sendWalletError(
  context: WalletRouteContext,
  reply: FastifyReply,
  error: unknown,
  logName: string
): boolean {
  if (error instanceof ActorResolutionError) {
    sendActorResolutionError(reply, error);
    return true;
  }

  if (error instanceof FaucetServiceError) {
    sendError(reply, error.statusCode, error.code, error.message);
    return true;
  }

  context.logger.error(`fastify_app.wallet_${logName}.request_failed`, {
    error: formatUnknownError(error)
  });
  sendError(reply, 500, "internal_error", "Unexpected server failure.");
  return true;
}

export function registerWalletRoutes(
  app: FastifyInstance,
  context: WalletRouteContext
): void {
  app.get("/api/wallet/faucets", async (request, reply) => {
    try {
      const actor = await resolveWalletActor(context, request);
      return await readWalletFaucets(context.dbPool, actor.actorId);
    } catch (error) {
      sendWalletError(context, reply, error, "faucets");
      return undefined;
    }
  });

  app.post("/api/wallet/faucets/daily-login/claim", async (request, reply) => {
    let actor: RequestActor | null = null;

    try {
      actor = await resolveWalletActor(context, request);
      return await claimDailyLoginFaucet(context.dbPool, actor.actorId);
    } catch (error) {
      if (error instanceof FaucetServiceError) {
        await recordEconomyGrantSignalSafely(context, request, error, actor, "daily_login");
      }
      sendWalletError(context, reply, error, "daily_login_claim");
      return undefined;
    }
  });

  app.post("/api/wallet/faucets/emergency/claim", async (request, reply) => {
    let actor: RequestActor | null = null;

    try {
      actor = await resolveWalletActor(context, request);
      return await claimEmergencyFaucet(context.dbPool, actor.actorId);
    } catch (error) {
      if (error instanceof FaucetServiceError) {
        await recordEconomyGrantSignalSafely(
          context,
          request,
          error,
          actor,
          "emergency_bankruptcy"
        );
      }
      sendWalletError(context, reply, error, "emergency_claim");
      return undefined;
    }
  });

  for (const path of [
    "/api/wallet/faucets/daily-login/claim",
    "/api/wallet/faucets/emergency/claim"
  ]) {
    app.options(path, async (_request, reply) => {
      reply.code(204).send();
    });
  }
}
