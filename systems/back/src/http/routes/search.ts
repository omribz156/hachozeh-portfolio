import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";

import {
  ActorResolutionError,
  resolveRequestActor,
  type RequestActor
} from "../../auth/actor-resolver";
import { readCookie } from "../../auth/session-cookie";
import type { AppEnv } from "../../config/env";
import { readPublicSearch } from "../../search/public-search-service";
import { formatUnknownError, type Logger } from "../../shared/logger";
import { sendError } from "./route-errors";

type SearchRouteContext = {
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

// The full results page enriches with viewer-scoped follow state; resolve the
// session actor when present, but never fail search on an unresolvable session
// (guests search too). Mirrors resolveOptionalSocialActor in social.ts.
async function resolveOptionalViewer(
  context: SearchRouteContext,
  request: FastifyRequest
): Promise<RequestActor | null> {
  if (!readCookie(request.raw, context.env.auth.sessionCookieName)) {
    return null;
  }

  try {
    return await resolveRequestActor(context.dbPool, context.env, request.raw, {
      allowDemo: false
    });
  } catch (error) {
    if (error instanceof ActorResolutionError) {
      context.logger.info("fastify_app.search.viewer_actor_unavailable", {
        code: error.code
      });
      return null;
    }

    throw error;
  }
}

export function registerSearchRoutes(
  app: FastifyInstance,
  context: SearchRouteContext
): void {
  app.get("/api/search", async (request, reply) => {
    try {
      const requestUrl = buildRequestUrl(request);
      const enrich = requestUrl.searchParams.get("enrich") === "1";
      const viewer = enrich ? await resolveOptionalViewer(context, request) : null;

      return await readPublicSearch(context.dbPool, {
        q: requestUrl.searchParams.get("q"),
        kind: requestUrl.searchParams.get("kind"),
        limit: requestUrl.searchParams.get("limit"),
        sort: requestUrl.searchParams.get("sort"),
        status: requestUrl.searchParams.get("status"),
        enrich,
        viewerUserId: viewer?.actorId ?? null
      });
    } catch (error) {
      context.logger.error("fastify_app.search.read_failed", {
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });
}
