import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

import type { RequestActor, CloseMarketResponse } from "../../back/src/platform-surface/oracle";
import type { OracleCaseDetailResult } from "./review-queue-service";
import { OracleReviewActionError } from "./review-action-errors";

export type OracleCaseReviewAction =
  | "approve_close_condition"
  | "approve_resolution"
  | "reject_case"
  | "request_more_evidence";

type OracleCaseReviewResultStatus = "attempted" | "completed" | "failed";

export type OracleCaseReviewRecord = {
  reviewId: string;
  oracleCaseId: string;
  marketId: string;
  reviewAction: OracleCaseReviewAction;
  resultStatus: OracleCaseReviewResultStatus;
  actorId: string;
  actorRole: RequestActor["role"];
  reviewNote: string | null;
  idempotencyKey: string;
  resolutionId: string | null;
  resolveResponseSnapshot: Record<string, unknown> | null;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  failedAt: string | null;
};

export type OracleCaseReviewCaseSnapshot = {
  oracleCaseId: string;
  marketId: string;
  caseType: "close_condition_check" | "resolution_check";
  marketStatus: "draft" | "open" | "closed" | "resolved" | "voided";
  caseStatus:
    | "recommended"
    | "review_needed"
    | "no_action"
    | "approved_close_condition"
    | "approved_resolution"
    | "rejected"
    | "more_evidence_requested";
};

export type OracleCaseReviewResult = {
  objectType: "oracle_case_review_result";
  review: OracleCaseReviewRecord;
  case: OracleCaseReviewCaseSnapshot;
  outcome:
    | "approved_close_condition"
    | "approved_resolution"
    | "rejected_case"
    | "requested_more_evidence";
  reviewMessage: string;
  close: CloseMarketResponse | null;
  resolution: {
    marketId: string;
    status: "resolved";
    winningOutcomeId: string;
    resolutionId: string;
    resolvedAt: string;
    settlementStatus: "completed";
    auditEventId: string;
  } | null;
  eventSiblingCascade?: Record<string, unknown> | null;
  dependentResolutionCascade?: Record<string, unknown> | null;
};

export function buildCaseSnapshot(
  caseDetail: OracleCaseDetailResult
): OracleCaseReviewCaseSnapshot {
  return {
    oracleCaseId: caseDetail.item.oracleCaseId,
    marketId: caseDetail.item.marketId,
    caseType: caseDetail.item.caseType,
    marketStatus: caseDetail.item.marketStatus,
    caseStatus: caseDetail.item.caseStatus
  };
}

function readTimestamp(value: unknown): string | null {
  if (value == null) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
}

function mapReviewRow(row: Record<string, unknown>): OracleCaseReviewRecord {
  return {
    reviewId: String(row.id),
    oracleCaseId: String(row.oracle_case_id),
    marketId: String(row.market_id),
    reviewAction: row.review_action as OracleCaseReviewAction,
    resultStatus: row.result_status as OracleCaseReviewResultStatus,
    actorId: String(row.actor_id),
    actorRole: row.actor_role as RequestActor["role"],
    reviewNote: row.review_note == null ? null : String(row.review_note),
    idempotencyKey: String(row.idempotency_key),
    resolutionId: row.resolution_id == null ? null : String(row.resolution_id),
    resolveResponseSnapshot:
      row.resolve_response_snapshot && typeof row.resolve_response_snapshot === "object"
        ? (row.resolve_response_snapshot as Record<string, unknown>)
        : null,
    failureCode: row.failure_code == null ? null : String(row.failure_code),
    failureMessage: row.failure_message == null ? null : String(row.failure_message),
    createdAt: readTimestamp(row.created_at) ?? new Date().toISOString(),
    completedAt: readTimestamp(row.completed_at),
    failedAt: readTimestamp(row.failed_at)
  };
}

export async function readExistingReviewByIdempotency(
  db: Pool,
  oracleCaseId: string,
  reviewAction: OracleCaseReviewAction,
  idempotencyKey: string
): Promise<OracleCaseReviewRecord | null> {
  const { rows } = await db.query(
    `
      select
        id,
        oracle_case_id,
        market_id,
        review_action,
        result_status,
        actor_id,
        actor_role,
        review_note,
        idempotency_key,
        resolution_id,
        resolve_response_snapshot,
        failure_code,
        failure_message,
        created_at,
        completed_at,
        failed_at
      from oracle_case_reviews
      where oracle_case_id = $1
        and review_action = $2
        and idempotency_key = $3
      limit 1
    `,
    [oracleCaseId, reviewAction, idempotencyKey]
  );

  return rows[0] ? mapReviewRow(rows[0] as Record<string, unknown>) : null;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "23505";
}

function readOutcomeForReviewAction(
  reviewAction: OracleCaseReviewAction
): OracleCaseReviewResult["outcome"] {
  if (reviewAction === "approve_close_condition") {
    return "approved_close_condition";
  }

  if (reviewAction === "approve_resolution") {
    return "approved_resolution";
  }

  if (reviewAction === "reject_case") {
    return "rejected_case";
  }

  return "requested_more_evidence";
}

function readReviewMessageForAction(reviewAction: OracleCaseReviewAction): string {
  if (reviewAction === "approve_close_condition") {
    return "Human approved the Oracle close-condition recommendation.";
  }

  if (reviewAction === "approve_resolution") {
    return "Human approved the Oracle resolution recommendation.";
  }

  if (reviewAction === "reject_case") {
    return "Human rejected the Oracle recommendation or review path.";
  }

  return "Human requested more evidence before taking trusted action.";
}

export function buildExistingReviewResult(
  caseDetail: OracleCaseDetailResult,
  review: OracleCaseReviewRecord
): OracleCaseReviewResult {
  if (review.resultStatus === "attempted") {
    throw new OracleReviewActionError(
      409,
      "oracle_review_action_in_progress",
      "Oracle review action with this idempotency key is still in progress."
    );
  }

  if (review.resultStatus === "failed") {
    throw new OracleReviewActionError(
      409,
      "oracle_review_action_failed",
      review.failureMessage ||
        "Oracle review action with this idempotency key failed. Retry with a new idempotency key."
    );
  }

  return {
    objectType: "oracle_case_review_result",
    review,
    case: buildCaseSnapshot(caseDetail),
    outcome: readOutcomeForReviewAction(review.reviewAction),
    reviewMessage: readReviewMessageForAction(review.reviewAction),
    close:
      review.reviewAction === "approve_close_condition"
        ? (review.resolveResponseSnapshot as CloseMarketResponse)
        : null,
    resolution:
      review.reviewAction === "approve_resolution"
        ? (review.resolveResponseSnapshot as OracleCaseReviewResult["resolution"])
        : null
  };
}

export function buildCompletedReviewRecord(
  caseDetail: OracleCaseDetailResult,
  actor: RequestActor,
  request: { reviewNote?: string | null; idempotencyKey: string },
  reviewAction: OracleCaseReviewAction
): OracleCaseReviewRecord {
  const completedAt = new Date().toISOString();

  return {
    reviewId: `ocr_${randomUUID()}`,
    oracleCaseId: caseDetail.item.oracleCaseId,
    marketId: caseDetail.item.marketId,
    reviewAction,
    resultStatus: "completed",
    actorId: actor.actorId,
    actorRole: actor.role,
    reviewNote: request.reviewNote?.trim() || null,
    idempotencyKey: request.idempotencyKey,
    resolutionId: null,
    resolveResponseSnapshot: null,
    failureCode: null,
    failureMessage: null,
    createdAt: completedAt,
    completedAt,
    failedAt: null
  };
}

export function buildAttemptedReviewRecord(
  caseDetail: OracleCaseDetailResult,
  actor: RequestActor,
  request: { idempotencyKey: string },
  reviewAction: Extract<
    OracleCaseReviewAction,
    "approve_close_condition" | "approve_resolution"
  >,
  reviewNote: string
): OracleCaseReviewRecord {
  const createdAt = new Date().toISOString();

  return {
    reviewId: `ocr_${randomUUID()}`,
    oracleCaseId: caseDetail.item.oracleCaseId,
    marketId: caseDetail.item.marketId,
    reviewAction,
    resultStatus: "attempted",
    actorId: actor.actorId,
    actorRole: actor.role,
    reviewNote,
    idempotencyKey: request.idempotencyKey,
    resolutionId: null,
    resolveResponseSnapshot: null,
    failureCode: null,
    failureMessage: null,
    createdAt,
    completedAt: null,
    failedAt: null
  };
}

function readFailureCode(error: unknown): string {
  if (error instanceof OracleReviewActionError) {
    return error.code;
  }

  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return error.code;
  }

  return "oracle_review_action_failed";
}

export function buildFailedReviewRecord(
  review: OracleCaseReviewRecord,
  error: unknown
): OracleCaseReviewRecord {
  return {
    ...review,
    resultStatus: "failed",
    failureCode: readFailureCode(error),
    failureMessage: error instanceof Error ? error.message : String(error),
    failedAt: new Date().toISOString()
  };
}

async function insertReviewAttempt(
  db: Pool,
  record: OracleCaseReviewRecord
): Promise<void> {
  await db.query(
    `
      insert into oracle_case_reviews (
        id,
        oracle_case_id,
        market_id,
        review_action,
        result_status,
        actor_id,
        actor_role,
        review_note,
        idempotency_key,
        resolution_id,
        resolve_response_snapshot,
        failure_code,
        failure_message,
        created_at,
        completed_at,
        failed_at
      )
      values (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11::jsonb,
        $12,
        $13,
        $14,
        $15,
        $16
      )
    `,
    [
      record.reviewId,
      record.oracleCaseId,
      record.marketId,
      record.reviewAction,
      record.resultStatus,
      record.actorId,
      record.actorRole,
      record.reviewNote,
      record.idempotencyKey,
      record.resolutionId,
      record.resolveResponseSnapshot ? JSON.stringify(record.resolveResponseSnapshot) : null,
      record.failureCode,
      record.failureMessage,
      record.createdAt,
      record.completedAt,
      record.failedAt
    ]
  );
}

export async function insertReviewAttemptOrReplay(
  db: Pool,
  caseDetail: OracleCaseDetailResult,
  record: OracleCaseReviewRecord
): Promise<OracleCaseReviewResult | null> {
  try {
    await insertReviewAttempt(db, record);
    return null;
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }

    const existing = await readExistingReviewByIdempotency(
      db,
      record.oracleCaseId,
      record.reviewAction,
      record.idempotencyKey
    );

    if (!existing) {
      throw error;
    }

    return buildExistingReviewResult(caseDetail, existing);
  }
}

export async function updateReviewAttempt(
  db: Pool,
  record: OracleCaseReviewRecord
): Promise<void> {
  await db.query(
    `
      update oracle_case_reviews
      set result_status = $2,
          review_note = $3,
          resolution_id = $4,
          resolve_response_snapshot = $5::jsonb,
          failure_code = $6,
          failure_message = $7,
          completed_at = $8,
          failed_at = $9
      where id = $1
    `,
    [
      record.reviewId,
      record.resultStatus,
      record.reviewNote,
      record.resolutionId,
      record.resolveResponseSnapshot ? JSON.stringify(record.resolveResponseSnapshot) : null,
      record.failureCode,
      record.failureMessage,
      record.completedAt,
      record.failedAt
    ]
  );
}
