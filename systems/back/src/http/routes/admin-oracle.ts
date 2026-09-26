import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";

import {
  ActorResolutionError,
  resolveRequiredAdminActor
} from "../../auth/actor-resolver";
import type { AppEnv } from "../../config/env";
import { sendActorResolutionError, sendError, sendInvalidJsonError } from "./route-errors";
import {
  approveOracleResolutionCandidate,
  intakeOracleCandidateEvidence,
  OracleCandidateIntakeError,
  parseApproveOracleResolutionCandidateRequest,
  parseIntakeOracleCandidateEvidenceRequest
} from "../../../../oracle/src/candidate-intake-service";
import {
  isOracleCaseType,
  type OracleCaseType
} from "../../../../oracle/src/contracts";
import {
  OracleMarketAssistError,
  readOracleMarketAssist
} from "../../../../oracle/src/market-assist-service";
import { readOracleAlerts } from "../../../../oracle/src/oracle-alerts-service";
import { runFamilyRouteAudit } from "../../../../oracle/src/family-route-audit-service";
import { readOracleLifecycleWorkerStatus } from "../../../../oracle/src/lifecycle-worker-status-service";
import {
  executeOracleReviewAction,
  OracleReviewActionError,
  parseExecuteOracleReviewActionRequest
} from "../../../../oracle/src/review-action-service";
import {
  readOracleCaseDetail,
  readOracleReviewQueue
} from "../../../../oracle/src/review-queue-service";
import { checkOracleSourceCapability } from "../../../../oracle/src/source-capability-service";
import { formatUnknownError, type Logger } from "../../shared/logger";
import {
  AdminOracleQueryError,
  readOracleAlertsQuery,
  readOracleReviewQueueQuery
} from "../admin-oracle-query-boundary";
import {
  broadcastMarketLifecycleEvent
} from "../market-stream-broadcasts";
import type { MarketStreamBus } from "../market-stream-bus";

type AdminOracleRouteContext = {
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

function readMarketIdParam(request: FastifyRequest): string {
  return String((request.params as { marketId?: string }).marketId ?? "");
}

function readOracleCaseTypeQuery(value: string | null): OracleCaseType {
  const caseType = value?.trim() || "resolution_check";

  if (!isOracleCaseType(caseType)) {
    throw new AdminOracleQueryError(
      "caseType must be one of: close_condition_check, resolution_check."
    );
  }

  return caseType;
}

function readCaseIdParam(request: FastifyRequest): string {
  return String((request.params as { caseId?: string }).caseId ?? "");
}

async function resolveRequiredFastifyAdminActor(
  context: AdminOracleRouteContext,
  request: FastifyRequest
) {
  return await resolveRequiredAdminActor(context.dbPool, context.env, request.raw);
}

function sendAdminOracleError(
  context: AdminOracleRouteContext,
  reply: FastifyReply,
  error: unknown,
  logName: string,
  metadata?: Record<string, unknown>
): boolean {
  if (error instanceof ActorResolutionError) {
    sendActorResolutionError(reply, error);
    return true;
  }

  if (error instanceof AdminOracleQueryError) {
    sendError(reply, error.statusCode, error.code, error.message);
    return true;
  }

  if (error instanceof OracleMarketAssistError) {
    sendError(reply, error.statusCode, error.code, error.message);
    return true;
  }

  if (
    error instanceof OracleCandidateIntakeError ||
    error instanceof OracleReviewActionError
  ) {
    sendError(reply, error.statusCode, error.code, error.message);
    return true;
  }

  if (error instanceof Error && error.message.startsWith("Oracle case not found:")) {
    sendError(reply, 404, "oracle_case_not_found", error.message);
    return true;
  }

  if (error instanceof Error && error.message === "JSON body is required") {
    sendInvalidJsonError(reply, error.message);
    return true;
  }

  context.logger.error(`fastify_app.admin_oracle_${logName}.request_failed`, {
    ...metadata,
    error: formatUnknownError(error)
  });
  sendError(reply, 500, "internal_error", "Unexpected server failure.");
  return true;
}

function broadcastOracleLifecycle(
  context: AdminOracleRouteContext,
  marketId: string,
  action: string,
  payload: unknown
): void {
  broadcastMarketLifecycleEvent({
    dbPool: context.dbPool,
    marketStreamBus: context.marketStreamBus,
    requestLogger: context.logger.child({
      component: "http",
      route: "fastify_admin_oracle",
      marketId,
      action
    }),
    marketKey: marketId,
    action,
    payload
  });
}

export function registerAdminOracleRoutes(
  app: FastifyInstance,
  context: AdminOracleRouteContext
): void {
  app.get("/admin/oracle/review-queue", async (request, reply) => {
    const requestUrl = buildRequestUrl(request);

    try {
      await resolveRequiredFastifyAdminActor(context, request);
      return await readOracleReviewQueue(
        context.dbPool,
        readOracleReviewQueueQuery(requestUrl.searchParams)
      );
    } catch (error) {
      sendAdminOracleError(context, reply, error, "review_queue");
      return undefined;
    }
  });

  app.get("/admin/oracle/alerts", async (request, reply) => {
    const requestUrl = buildRequestUrl(request);

    try {
      await resolveRequiredFastifyAdminActor(context, request);
      return await readOracleAlerts(context.dbPool, readOracleAlertsQuery(requestUrl.searchParams));
    } catch (error) {
      sendAdminOracleError(context, reply, error, "alerts");
      return undefined;
    }
  });

  app.get("/admin/oracle/cases/:caseId", async (request, reply) => {
    const caseId = readCaseIdParam(request);

    try {
      await resolveRequiredFastifyAdminActor(context, request);
      return await readOracleCaseDetail(context.dbPool, caseId);
    } catch (error) {
      sendAdminOracleError(context, reply, error, "case_detail", {
        oracleCaseId: caseId
      });
      return undefined;
    }
  });

  app.get("/admin/oracle/market-assist/:marketId", async (request, reply) => {
    const requestUrl = buildRequestUrl(request);
    const marketId = readMarketIdParam(request);

    try {
      await resolveRequiredFastifyAdminActor(context, request);
      return await readOracleMarketAssist(context.dbPool, marketId, {
        caseType: readOracleCaseTypeQuery(requestUrl.searchParams.get("caseType"))
      });
    } catch (error) {
      sendAdminOracleError(context, reply, error, "market_assist", {
        marketId
      });
      return undefined;
    }
  });

  app.get("/admin/oracle/lifecycle-worker/status", async (request, reply) => {
    try {
      await resolveRequiredFastifyAdminActor(context, request);
      return await readOracleLifecycleWorkerStatus();
    } catch (error) {
      sendAdminOracleError(context, reply, error, "lifecycle_worker_status");
      return undefined;
    }
  });

  app.get("/admin/oracle/family-route-audit", async (request, reply) => {
    const requestUrl = buildRequestUrl(request);

    try {
      await resolveRequiredFastifyAdminActor(context, request);
      return await runFamilyRouteAudit({
        sourceId: requestUrl.searchParams.get("sourceId")
      });
    } catch (error) {
      sendAdminOracleError(context, reply, error, "family_route_audit");
      return undefined;
    }
  });

  app.get("/admin/oracle/capability-check", async (request, reply) => {
    const requestUrl = buildRequestUrl(request);

    try {
      await resolveRequiredFastifyAdminActor(context, request);
      const sourceId = requestUrl.searchParams.get("sourceId")?.trim();
      const measurementKind =
        requestUrl.searchParams.get("measurementKind")?.trim() ||
        requestUrl.searchParams.get("measurement")?.trim();
      const resultShape =
        requestUrl.searchParams.get("resultShape")?.trim() ||
        requestUrl.searchParams.get("shape")?.trim();

      if (!sourceId || !measurementKind || !resultShape) {
        sendError(
          reply,
          400,
          "invalid_request",
          "sourceId, measurementKind, and resultShape are required."
        );
        return undefined;
      }

      return checkOracleSourceCapability({
        sourceId,
        measurementKind,
        resultShape,
        sourceUrl: requestUrl.searchParams.get("sourceUrl")
      });
    } catch (error) {
      sendAdminOracleError(context, reply, error, "capability_check");
      return undefined;
    }
  });

  app.post("/admin/oracle/intake-candidate", async (request, reply) => {
    try {
      await resolveRequiredFastifyAdminActor(context, request);
      const intakeRequest = parseIntakeOracleCandidateEvidenceRequest(readRequiredBody(request));
      return await intakeOracleCandidateEvidence(context.dbPool, intakeRequest);
    } catch (error) {
      sendAdminOracleError(context, reply, error, "intake_candidate");
      return undefined;
    }
  });

  app.post("/admin/oracle/review-action", async (request, reply) => {
    try {
      const actor = await resolveRequiredFastifyAdminActor(context, request);
      const reviewActionRequest = parseExecuteOracleReviewActionRequest(readRequiredBody(request));
      const payload = await executeOracleReviewAction(context.dbPool, actor, reviewActionRequest);

      if (payload.resolution) {
        broadcastOracleLifecycle(
          context,
          payload.resolution.marketId,
          "oracle_resolution_reviewed",
          payload
        );
      }

      if (payload.close) {
        broadcastOracleLifecycle(
          context,
          payload.close.marketId,
          "oracle_close_condition_reviewed",
          payload
        );
      }

      return payload;
    } catch (error) {
      sendAdminOracleError(context, reply, error, "review_action");
      return undefined;
    }
  });

  app.post("/admin/oracle/approve-resolution-candidate", async (request, reply) => {
    try {
      const actor = await resolveRequiredFastifyAdminActor(context, request);
      const approvalRequest = parseApproveOracleResolutionCandidateRequest(readRequiredBody(request));
      const payload = await approveOracleResolutionCandidate(context.dbPool, actor, approvalRequest);

      if (payload.approval.resolution) {
        broadcastOracleLifecycle(
          context,
          payload.approval.resolution.marketId,
          "oracle_resolution_approved",
          payload
        );
      }

      return payload;
    } catch (error) {
      sendAdminOracleError(context, reply, error, "approve_candidate");
      return undefined;
    }
  });

  for (const path of [
    "/admin/oracle/intake-candidate",
    "/admin/oracle/review-action",
    "/admin/oracle/approve-resolution-candidate"
  ]) {
    app.options(path, async (_request, reply) => {
      reply.code(204).send();
    });
  }
}
