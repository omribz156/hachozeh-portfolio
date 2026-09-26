import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";

import { readPublicClaimShare } from "../../engine/portfolio/portfolio-claim-service";
import { formatUnknownError, type Logger } from "../../shared/logger";
import { sendError } from "./route-errors";

type PublicShareReadRouteContext = {
  dbPool: Pool;
  logger: Logger;
};

function readClaimIdParam(request: FastifyRequest): string {
  const params = request.params as { claimId?: string };
  return String(params.claimId ?? "").trim();
}

// Public read for shared win claims. Fully anonymous by design (share pages and
// unfurl crawlers hit this); a claim is only visible after its owner consented
// via POST /api/portfolio/claims/:claimId/share.
export function registerPublicShareReadRoutes(
  app: FastifyInstance,
  context: PublicShareReadRouteContext
): void {
  app.get("/api/share/claims/:claimId", async (request, reply) => {
    try {
      const claimId = readClaimIdParam(request);
      if (!claimId) {
        sendError(reply, 400, "invalid_request", "claimId is required.");
        return undefined;
      }

      const share = await readPublicClaimShare(context.dbPool, claimId);
      if (!share) {
        sendError(reply, 404, "share_not_found", "Shared claim was not found.");
        return undefined;
      }

      return share;
    } catch (error) {
      context.logger.error("fastify_app.share_claims.read_failed", {
        error: formatUnknownError(error)
      });
      sendError(reply, 500, "internal_error", "Unexpected server failure.");
      return undefined;
    }
  });
}
