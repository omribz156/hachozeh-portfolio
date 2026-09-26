import type { Pool } from "pg";

import type { RequestActor } from "../../back/src/platform-surface/oracle";
import {
  readOracleCaseDetail,
  type OracleCaseDetailResult
} from "./review-queue-service";
import { OracleReviewActionError } from "./review-action-errors";
import {
  buildCaseSnapshot,
  buildCompletedReviewRecord,
  buildExistingReviewResult,
  insertReviewAttemptOrReplay,
  readExistingReviewByIdempotency,
  type OracleCaseReviewAction,
  type OracleCaseReviewResult
} from "./review-action-records";
import type { ReviewOracleCaseRequest } from "./review-action-requests";

export function assertCaseIsReviewable(caseDetail: OracleCaseDetailResult): void {
  if (caseDetail.item.caseStatus === "no_action") {
    throw new OracleReviewActionError(
      409,
      "oracle_case_not_reviewable",
      "Oracle case is already take-no-action and cannot be reviewed further."
    );
  }
}

async function completeAuditOnlyReviewAction(
  dbPool: Pool,
  caseDetail: OracleCaseDetailResult,
  actor: RequestActor,
  request: ReviewOracleCaseRequest,
  reviewAction: Extract<
    OracleCaseReviewAction,
    "reject_case" | "request_more_evidence"
  >,
  outcome: OracleCaseReviewResult["outcome"],
  reviewMessage: string
): Promise<OracleCaseReviewResult> {
  const existing = await readExistingReviewByIdempotency(
    dbPool,
    caseDetail.item.oracleCaseId,
    reviewAction,
    request.idempotencyKey
  );

  if (existing) {
    return buildExistingReviewResult(caseDetail, existing);
  }

  assertCaseIsReviewable(caseDetail);

  const reviewRecord = buildCompletedReviewRecord(
    caseDetail,
    actor,
    request,
    reviewAction
  );

  const replay = await insertReviewAttemptOrReplay(dbPool, caseDetail, reviewRecord);

  if (replay) {
    return replay;
  }

  return {
    objectType: "oracle_case_review_result",
    review: reviewRecord,
    case: buildCaseSnapshot(caseDetail),
    outcome,
    reviewMessage,
    close: null,
    resolution: null
  };
}

export async function rejectOracleCase(
  dbPool: Pool,
  oracleCaseId: string,
  actor: RequestActor,
  request: ReviewOracleCaseRequest
): Promise<OracleCaseReviewResult> {
  const caseDetail = await readOracleCaseDetail(dbPool, oracleCaseId);

  return completeAuditOnlyReviewAction(
    dbPool,
    caseDetail,
    actor,
    request,
    "reject_case",
    "rejected_case",
    "Human rejected the Oracle recommendation or review path."
  );
}

export async function requestMoreEvidenceForOracleCase(
  dbPool: Pool,
  oracleCaseId: string,
  actor: RequestActor,
  request: ReviewOracleCaseRequest
): Promise<OracleCaseReviewResult> {
  const caseDetail = await readOracleCaseDetail(dbPool, oracleCaseId);

  return completeAuditOnlyReviewAction(
    dbPool,
    caseDetail,
    actor,
    request,
    "request_more_evidence",
    "requested_more_evidence",
    "Human requested more evidence before taking trusted action."
  );
}
