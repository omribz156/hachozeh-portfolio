import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";

import {
  buildGoogleAuthStartRedirect,
  completeGoogleAuthCallback,
  readGoogleAuthStateReturnTo
} from "../../auth/google-oauth-service";
import { AuthSessionError } from "../../auth/session-service";
import type { AppEnv } from "../../config/env";
import { formatUnknownError, type Logger } from "../../shared/logger";
import { sendError } from "./route-errors";

type GoogleAuthRouteContext = {
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

function appendAuthError(returnTo: string, code: string): string {
  const url = new URL(returnTo);

  url.searchParams.set("auth_error", "google");
  url.searchParams.set("auth_error_code", code);

  return url.toString();
}

function readGoogleAuthErrorReturnTo(env: AppEnv, state: string | null): string {
  if (!state) {
    return env.publicBaseUrl;
  }

  try {
    return readGoogleAuthStateReturnTo(env, state);
  } catch {
    return env.publicBaseUrl;
  }
}

export function registerGoogleAuthRoutes(
  app: FastifyInstance,
  context: GoogleAuthRouteContext
): void {
  app.get("/api/auth/google/start", async (request, reply) => {
    try {
      const requestUrl = buildRequestUrl(request);
      reply.code(302).header(
        "location",
        buildGoogleAuthStartRedirect(context.env, requestUrl.searchParams.get("returnTo"))
      );
      return "";
    } catch (error) {
      if (error instanceof AuthSessionError) {
        const requestUrl = buildRequestUrl(request);
        reply.code(302).header(
          "location",
          appendAuthError(
            readGoogleAuthErrorReturnTo(context.env, requestUrl.searchParams.get("state")),
            error.code
          )
        );
        return "";
      }

      context.logger.error("fastify_app.auth.google_start_failed", {
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });

  app.get("/api/auth/google/callback", async (request, reply) => {
    try {
      const requestUrl = buildRequestUrl(request);
      const googleError = requestUrl.searchParams.get("error");

      if (googleError) {
        const returnTo = readGoogleAuthStateReturnTo(
          context.env,
          requestUrl.searchParams.get("state") || ""
        );

        reply.code(302).header("location", appendAuthError(returnTo, googleError));
        return "";
      }

      const { setCookie, returnTo } = await completeGoogleAuthCallback(
        context.dbPool,
        context.env,
        request.raw,
        {
          code: requestUrl.searchParams.get("code") || "",
          state: requestUrl.searchParams.get("state") || ""
        }
      );

      reply.code(302).header("set-cookie", setCookie).header("location", returnTo);
      return "";
    } catch (error) {
      if (error instanceof AuthSessionError) {
        sendError(reply, error.statusCode, error.code, error.message);
        return undefined;
      }

      context.logger.error("fastify_app.auth.google_callback_failed", {
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });
}
