import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

import { withTransaction } from "../../db/tx/with-transaction";
import type { RequestActor } from "../../auth/actor-resolver";
import { insertAuditEvent } from "../../shared/audit-events";
import {
  claimIdempotencyRecord,
  completeIdempotencyRecord
} from "../../shared/idempotency-records";
import { insertLifecycleEvent } from "../../shared/lifecycle-events";
import { pingMarketIndexNow } from "../../seo/market-indexnow-service";
import {
  parseNullableStringField,
  parseObjectBody,
  parseRequiredStringField
} from "../../shared/zod-request-body";
import {
  buildCloseCandidate,
  inspectCloseCandidate,
  validateCloseCommand
} from "./close-check";
import type { HorizonCloseCommand } from "./contracts";
import { toHorizonLifecycleMarket, type HorizonMarketLifecycleRow } from "./market-lifecycle-row";

export type CloseMarketRequest = {
  triggerType: "scheduled_time" | "oracle_confirmed_event_completion";
  reason: string;
  sourceUrl: string | null;
  note: string | null;
  oracleCaseId: string | null;
  triggeredByOracleId: string | null;
  approvedByHumanId: string | null;
  idempotencyKey: string;
  requestedAt?: string;
};

export type CloseMarketResponse = {
  marketId: string;
  status: "closed";
  closedAt: string;
  triggerType: "scheduled_time" | "oracle_confirmed_event_completion";
  auditEventId: string;
};

export class CloseMarketServiceError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "CloseMarketServiceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

const createCloseRequestError = (message: string) =>
  new CloseMarketServiceError(400, "invalid_request", message);

function normalizeCloseSourceUrl(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol === "https:") {
      return url.toString();
    }
  } catch {
    // fall through to shared error below
  }

  throw createCloseRequestError("sourceUrl must be an HTTPS URL.");
}

export function parseCloseMarketRequest(body: unknown): CloseMarketRequest {
  const candidate = parseObjectBody(body, "Close request body must be an object.", createCloseRequestError);

  const triggerType = parseRequiredStringField(candidate, "triggerType", createCloseRequestError);

  if (
    triggerType !== "scheduled_time" &&
    triggerType !== "oracle_confirmed_event_completion"
  ) {
    throw new CloseMarketServiceError(400, "invalid_request", "triggerType is invalid.");
  }

  return {
    triggerType,
    reason: parseRequiredStringField(candidate, "reason", createCloseRequestError),
    sourceUrl: normalizeCloseSourceUrl(
      parseNullableStringField(candidate, "sourceUrl", createCloseRequestError)
    ),
    note: parseNullableStringField(candidate, "note", createCloseRequestError),
    oracleCaseId: parseNullableStringField(candidate, "oracleCaseId", createCloseRequestError),
    triggeredByOracleId: parseNullableStringField(candidate, "triggeredByOracleId", createCloseRequestError),
    approvedByHumanId: parseNullableStringField(candidate, "approvedByHumanId", createCloseRequestError),
    idempotencyKey: parseRequiredStringField(candidate, "idempotencyKey", createCloseRequestError),
    requestedAt: parseNullableStringField(candidate, "requestedAt", createCloseRequestError) ?? undefined
  };
}

function buildRequestHash(marketId: string, request: CloseMarketRequest): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        marketId,
        ...request
      })
    )
    .digest("hex");
}

async function readMarketForClose(
  client: PoolClient,
  marketId: string
): Promise<HorizonMarketLifecycleRow | null> {
  const result = await client.query<HorizonMarketLifecycleRow>(
    `
      select
        id,
        status,
        open_at,
        close_at,
        close_on_event_completion,
        event_completion_close_requires_human_approval,
        closed_at,
        resolved_at
      from markets
      where id = $1
      limit 1
      for update
    `,
    [marketId]
  );

  return result.rows[0] ?? null;
}

async function updateMarketClosed(
  client: PoolClient,
  marketId: string,
  closedAt: string
): Promise<void> {
  await client.query(
    `
      update markets
      set status = 'closed',
          closed_at = $2,
          updated_at = now()
      where id = $1
    `,
    [marketId, closedAt]
  );
}

export async function closeMarket(
  dbPool: Pool,
  marketId: string,
  request: CloseMarketRequest,
  actor: RequestActor
): Promise<CloseMarketResponse> {
  const requestedAt = request.requestedAt ?? new Date().toISOString();
  const parsedRequestedAt = new Date(requestedAt);
  const normalizedRequest: CloseMarketRequest = {
    ...request,
    sourceUrl: normalizeCloseSourceUrl(request.sourceUrl)
  };

  if (Number.isNaN(parsedRequestedAt.getTime())) {
    throw new CloseMarketServiceError(400, "invalid_request", "requestedAt must be an ISO timestamp.");
  }

  const normalizedRequestedAt = parsedRequestedAt.toISOString();
  const requestHash = buildRequestHash(marketId, normalizedRequest);

  const result = await withTransaction(dbPool, async (client) => {
    const idempotency = await claimIdempotencyRecord<CloseMarketResponse>(client, {
      scope: "close_market",
      recordIdPrefix: "idempotency_close_market",
      actorId: actor.actorId,
      idempotencyKey: request.idempotencyKey,
      requestHash,
      disappearedMessage: "Idempotency record disappeared during close execution",
      conflictError: () => new CloseMarketServiceError(
        409,
        "idempotency_conflict",
        "Idempotency key was already used with a different close payload."
      ),
      inProgressError: () => new CloseMarketServiceError(
        409,
        "idempotency_in_progress",
        "Close with this idempotency key is already in progress."
      )
    });

    if (idempotency.completedResponse) {
      return idempotency.completedResponse;
    }

    const market = await readMarketForClose(client, marketId);

    if (!market) {
      throw new CloseMarketServiceError(404, "market_not_found", "Requested market was not found.");
    }

    const command: HorizonCloseCommand = {
      objectType: "close_command",
      closeCommandId: `clc_${randomUUID()}`,
      marketId,
      actorId: actor.actorId,
      triggerType: request.triggerType,
      idempotencyKey: request.idempotencyKey,
      requestedAt: normalizedRequestedAt,
      proposedBySubsystem: request.triggeredByOracleId ? "oracle" : undefined,
      approvalActorId: request.approvedByHumanId ?? undefined,
      triggerContextSummary: request.note ?? undefined,
      sourceRef: normalizedRequest.sourceUrl ?? undefined,
      notes: request.reason
    };

    const commandProblems = validateCloseCommand(command);

    if (commandProblems.length > 0) {
      throw new CloseMarketServiceError(400, "invalid_request", commandProblems[0]!);
    }

    const lifecycleMarket = toHorizonLifecycleMarket(market);
    const candidate = buildCloseCandidate({
      closeCandidateId: `cc_${randomUUID()}`,
      evaluatedAt: command.requestedAt,
      triggerType: request.triggerType,
      market: lifecycleMarket,
      whyNow: request.reason,
      actorId: actor.actorId,
      proposedBySubsystem: request.triggeredByOracleId ? "oracle" : undefined,
      approvalActorId: request.approvedByHumanId ?? undefined,
      triggerContextSummary: request.note ?? undefined,
      sourceRef: normalizedRequest.sourceUrl ?? undefined
    });

    const check = inspectCloseCandidate({
      closeCheckResultId: `chk_${randomUUID()}`,
      checkedAt: command.requestedAt,
      candidate,
      market: lifecycleMarket,
      notes: request.reason
    });

    if (!check.eligible) {
      throw new CloseMarketServiceError(
        409,
        "market_not_closable",
        check.rejectionReasons?.[0] ?? "Market cannot be closed right now."
      );
    }

    const closedAt = command.requestedAt;
    await updateMarketClosed(client, marketId, closedAt);

    const auditEventId = await insertAuditEvent(client, {
      actorId: actor.actorId,
      action: "market_closed",
      entityType: "market",
      entityId: marketId,
      payload: {
        command,
        check,
        result: {
          status: "closed",
          closedAt
        }
      }
    });

    await insertLifecycleEvent(client, {
      marketId,
      eventType: "market_closed",
      sourceSystem: request.triggeredByOracleId ? "oracle" : "horizon",
      actorId: actor.actorId,
      occurredAt: closedAt,
      correlationId: request.idempotencyKey,
      dedupeKey: `market_closed:${marketId}:${request.idempotencyKey}`,
      auditEventId,
      oracleCaseId: request.oracleCaseId,
      payload: {
        triggerType: request.triggerType,
        reason: request.reason,
        sourceUrl: normalizedRequest.sourceUrl,
        closedAt,
        check
      }
    });

    const response: CloseMarketResponse = {
      marketId,
      status: "closed",
      closedAt,
      triggerType: request.triggerType,
      auditEventId
    };

    await completeIdempotencyRecord(client, {
      recordId: idempotency.recordId,
      resourceType: "market",
      resourceId: marketId,
      response
    });

    return response;
  });

  pingMarketIndexNow(dbPool, marketId);
  return result;
}
