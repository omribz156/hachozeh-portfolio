import type { Pool } from "pg";

import {
  type RequestActor,
  insertLifecycleEvent,
  closeMarket
} from "../../back/src/platform-surface/oracle";
import {
  planEventSiblingResolutionCascade,
  type EventSiblingCascadePlan
} from "../../back/src/lifecycle/events/event-sibling-cascade-planner";
import {
  planDependentResolutionCascade,
  type DependentResolutionCascadePlan
} from "../../back/src/lifecycle/events/dependent-resolution-cascade-planner";
import { resolveMarket } from "./resolve-market-service";
import {
  readOracleCaseDetail,
  type OracleCaseDetailResult
} from "./review-queue-service";
import { parseHttpsUrlValue } from "./zod-request-body";
import { OracleReviewActionError } from "./review-action-errors";
import {
  assertCaseIsReviewable,
  rejectOracleCase,
  requestMoreEvidenceForOracleCase
} from "./review-action-audit";
import {
  buildAttemptedReviewRecord,
  buildCaseSnapshot,
  buildExistingReviewResult,
  buildFailedReviewRecord,
  insertReviewAttemptOrReplay,
  readExistingReviewByIdempotency,
  updateReviewAttempt,
  type OracleCaseReviewAction,
  type OracleCaseReviewRecord,
  type OracleCaseReviewResult
} from "./review-action-records";
import type {
  ApproveOracleCloseConditionCaseRequest,
  ApproveOracleResolutionCaseRequest,
  ExecuteOracleReviewActionRequest
} from "./review-action-requests";

export { OracleReviewActionError } from "./review-action-errors";
export {
  parseExecuteOracleReviewActionRequest
} from "./review-action-requests";
export {
  rejectOracleCase,
  requestMoreEvidenceForOracleCase
} from "./review-action-audit";
export type {
  OracleCaseReviewAction,
  OracleCaseReviewCaseSnapshot,
  OracleCaseReviewRecord,
  OracleCaseReviewResult
} from "./review-action-records";
export type {
  ApproveOracleCloseConditionCaseRequest,
  ApproveOracleResolutionCaseRequest,
  ExecuteOracleReviewActionRequest,
  ReviewOracleCaseRequest
} from "./review-action-requests";

export type ApproveOracleResolutionCaseResult = OracleCaseReviewResult;
export type ApproveOracleCloseConditionCaseResult = OracleCaseReviewResult;

type EventSiblingCascadeExecution = {
  objectType: "event_sibling_resolution_cascade_execution";
  plan: EventSiblingCascadePlan;
  resolvedSiblings: Array<{
    marketId: string;
    noOutcomeId: string;
    resolutionId: string;
    closedFirst: boolean;
  }>;
  failedSiblings: Array<{
    marketId: string;
    code: string;
    message: string;
  }>;
};

type EventSiblingCascadeFailure = {
  objectType: "event_sibling_resolution_cascade_failed";
  code: string;
  message: string;
};

type DependentResolutionCascadeExecution = {
  objectType: "dependent_resolution_cascade_execution";
  plan: DependentResolutionCascadePlan;
  resolvedDependents: Array<{
    marketId: string;
    noOutcomeId: string;
    resolutionId: string;
    closedFirst: boolean;
  }>;
  failedDependents: Array<{
    marketId: string;
    code: string;
    message: string;
  }>;
};

type DependentResolutionCascadeFailure = {
  objectType: "dependent_resolution_cascade_failed";
  code: string;
  message: string;
};

function readResolutionSourceUrl(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OracleReviewActionError(
      409,
      "oracle_case_not_approvable",
      "Oracle case is missing a usable evidence source URL."
    );
  }

  const candidate = value as Record<string, unknown>;
  const sourceUrl = typeof candidate.sourceUrl === "string" ? candidate.sourceUrl.trim() : "";

  if (!sourceUrl) {
    throw new OracleReviewActionError(
      409,
      "oracle_case_not_approvable",
      "Oracle case is missing a usable evidence source URL."
    );
  }

  return parseHttpsUrlValue(
    sourceUrl,
    "Oracle case evidence source URL",
    (message) => new OracleReviewActionError(409, "oracle_case_not_approvable", message)
  );
}

function readResolutionReasonSummary(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "Human approved Oracle resolution recommendation.";
  }

  const candidate = value as Record<string, unknown>;
  const reasonSummary =
    typeof candidate.reasonSummary === "string" ? candidate.reasonSummary.trim() : "";

  return reasonSummary || "Human approved Oracle resolution recommendation.";
}

function readCloseConditionReasonSummary(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "Human approved Oracle close-condition recommendation.";
  }

  const candidate = value as Record<string, unknown>;
  const reasonSummary =
    typeof candidate.reasonSummary === "string" ? candidate.reasonSummary.trim() : "";

  return reasonSummary || "Human approved Oracle close-condition recommendation.";
}

function assertCloseConditionSatisfied(caseDetail: OracleCaseDetailResult): void {
  if (caseDetail.item.evidencePacket?.closeConditionSatisfied !== true) {
    throw new OracleReviewActionError(
      409,
      "oracle_case_not_approvable",
      "Oracle close-condition case must explicitly confirm the close condition before Horizon can close."
    );
  }
}

async function readMarketEventId(dbPool: Pool, marketId: string): Promise<string | null> {
  const result = await dbPool.query<{ event_id: string | null }>(
    `
      select event_id
      from markets
      where id = $1
      limit 1
    `,
    [marketId]
  );

  return result.rows[0]?.event_id ?? null;
}

function readErrorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code ?? "cascade_failed")
    : "cascade_failed";
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function cascadeNeedsRepair(
  cascade:
    | EventSiblingCascadeExecution
    | EventSiblingCascadeFailure
    | DependentResolutionCascadeExecution
    | DependentResolutionCascadeFailure
    | null
): boolean {
  if (!cascade) return false;
  if (
    cascade.objectType === "event_sibling_resolution_cascade_failed" ||
    cascade.objectType === "dependent_resolution_cascade_failed"
  ) {
    return true;
  }

  if (cascade.objectType === "event_sibling_resolution_cascade_execution") {
    return cascade.failedSiblings.length > 0 || cascade.plan.blockers.length > 0;
  }

  return cascade.failedDependents.length > 0 || cascade.plan.blockers.length > 0;
}

async function executeEventSiblingCascade(input: {
  dbPool: Pool;
  actor: RequestActor;
  caseDetail: OracleCaseDetailResult;
  reviewId: string;
  resolutionSourceUrl: string;
  resolutionNote: string;
  idempotencyKey: string;
}): Promise<EventSiblingCascadeExecution | null> {
  const eventId = await readMarketEventId(input.dbPool, input.caseDetail.item.marketId);

  if (!eventId || !input.caseDetail.item.winningOutcomeId) {
    return null;
  }

  const plan = await planEventSiblingResolutionCascade(input.dbPool, eventId, {
    triggerMarketId: input.caseDetail.item.marketId,
    triggerWinningOutcomeId: input.caseDetail.item.winningOutcomeId,
    approvedByHuman: true,
    oracleCaseId: input.caseDetail.item.oracleCaseId,
    reviewId: input.reviewId
  });

  const execution: EventSiblingCascadeExecution = {
    objectType: "event_sibling_resolution_cascade_execution",
    plan,
    resolvedSiblings: [],
    failedSiblings: []
  };

  if (plan.action !== "resolve_siblings_no") {
    return execution;
  }

  for (const action of plan.siblingActions) {
    let closedFirst = false;

    try {
      if (action.currentStatus === "open") {
        await closeMarket(
          input.dbPool,
          action.marketId,
          {
            triggerType: "oracle_confirmed_event_completion",
            reason: "Exclusive event sibling resolved after another child was approved as Yes.",
            sourceUrl: input.resolutionSourceUrl,
            note: `Exclusive event cascade from ${input.caseDetail.item.marketId}.`,
            oracleCaseId: input.caseDetail.item.oracleCaseId,
            triggeredByOracleId: "oracle",
            approvedByHumanId: input.actor.actorId,
            idempotencyKey: `${input.idempotencyKey}:event-cascade-close:${action.marketId}`
          },
          input.actor
        );
        closedFirst = true;
      }

      const resolution = await resolveMarket(
        input.dbPool,
        action.marketId,
        {
          winningOutcomeId: action.noOutcomeId,
          triggerType: "human_reviewed_oracle_resolution",
          resolutionSourceUrl: input.resolutionSourceUrl,
          resolutionNote: `${input.resolutionNote} Sibling resolved No by exclusive event cascade.`,
          oracleCaseId: input.caseDetail.item.oracleCaseId,
          proposedByOracleId: "oracle",
          approvedByHumanId: input.actor.actorId,
          evidenceSnapshot: JSON.stringify({
            cascadePlan: plan,
            triggerMarketId: input.caseDetail.item.marketId,
            triggerWinningOutcomeId: input.caseDetail.item.winningOutcomeId
          }),
          idempotencyKey: `${input.idempotencyKey}:event-cascade-resolve-no:${action.marketId}`
        },
        input.actor
      );

      execution.resolvedSiblings.push({
        marketId: action.marketId,
        noOutcomeId: action.noOutcomeId,
        resolutionId: resolution.resolutionId,
        closedFirst
      });
    } catch (error) {
      execution.failedSiblings.push({
        marketId: action.marketId,
        code: readErrorCode(error),
        message: readErrorMessage(error)
      });
    }
  }

  return execution;
}

async function executeDependentResolutionCascade(input: {
  dbPool: Pool;
  actor: RequestActor;
  caseDetail: OracleCaseDetailResult;
  reviewId: string;
  resolutionSourceUrl: string;
  resolutionNote: string;
  idempotencyKey: string;
}): Promise<DependentResolutionCascadeExecution | null> {
  if (!input.caseDetail.item.winningOutcomeId) {
    return null;
  }

  const plan = await planDependentResolutionCascade(input.dbPool, {
    triggerMarketId: input.caseDetail.item.marketId,
    triggerWinningOutcomeId: input.caseDetail.item.winningOutcomeId,
    approvedByHuman: true,
    oracleCaseId: input.caseDetail.item.oracleCaseId,
    reviewId: input.reviewId
  });

  const execution: DependentResolutionCascadeExecution = {
    objectType: "dependent_resolution_cascade_execution",
    plan,
    resolvedDependents: [],
    failedDependents: []
  };

  if (plan.action !== "resolve_dependents_no") {
    return execution;
  }

  for (const action of plan.dependentActions) {
    let closedFirst = false;

    try {
      if (action.currentStatus === "open") {
        await closeMarket(
          input.dbPool,
          action.marketId,
          {
            triggerType: "oracle_confirmed_event_completion",
            reason: `${action.entityLabel} was eliminated by an approved dependent result.`,
            sourceUrl: input.resolutionSourceUrl,
            note: `Dependent resolution cascade from ${input.caseDetail.item.marketId}.`,
            oracleCaseId: input.caseDetail.item.oracleCaseId,
            triggeredByOracleId: "oracle",
            approvedByHumanId: input.actor.actorId,
            idempotencyKey: `${input.idempotencyKey}:dependent-cascade-close:${action.marketId}`
          },
          input.actor
        );
        closedFirst = true;
      }

      const resolution = await resolveMarket(
        input.dbPool,
        action.marketId,
        {
          winningOutcomeId: action.noOutcomeId,
          triggerType: "human_reviewed_oracle_resolution",
          resolutionSourceUrl: input.resolutionSourceUrl,
          resolutionNote: `${input.resolutionNote} Dependent market resolved No because ${action.entityLabel} was eliminated.`,
          oracleCaseId: input.caseDetail.item.oracleCaseId,
          proposedByOracleId: "oracle",
          approvedByHumanId: input.actor.actorId,
          evidenceSnapshot: JSON.stringify({
            cascadePlan: plan,
            triggerMarketId: input.caseDetail.item.marketId,
            triggerWinningOutcomeId: input.caseDetail.item.winningOutcomeId
          }),
          idempotencyKey: `${input.idempotencyKey}:dependent-cascade-resolve-no:${action.marketId}`
        },
        input.actor
      );

      execution.resolvedDependents.push({
        marketId: action.marketId,
        noOutcomeId: action.noOutcomeId,
        resolutionId: resolution.resolutionId,
        closedFirst
      });
    } catch (error) {
      execution.failedDependents.push({
        marketId: action.marketId,
        code: readErrorCode(error),
        message: readErrorMessage(error)
      });
    }
  }

  return execution;
}

export async function approveOracleCloseConditionCase(
  dbPool: Pool,
  oracleCaseId: string,
  actor: RequestActor,
  request: ApproveOracleCloseConditionCaseRequest
): Promise<ApproveOracleCloseConditionCaseResult> {
  const caseDetail = await readOracleCaseDetail(dbPool, oracleCaseId);
  const existing = await readExistingReviewByIdempotency(
    dbPool,
    oracleCaseId,
    "approve_close_condition",
    request.idempotencyKey
  );

  if (existing) {
    return buildExistingReviewResult(caseDetail, existing);
  }

  assertCaseIsReviewable(caseDetail);

  if (caseDetail.item.caseType !== "close_condition_check") {
    throw new OracleReviewActionError(
      409,
      "oracle_case_not_approvable",
      "Only close-condition Oracle cases can be approved for Horizon close."
    );
  }

  if (caseDetail.item.caseStatus !== "recommended") {
    throw new OracleReviewActionError(
      409,
      "oracle_case_not_approvable",
      "Oracle case must be in recommended state before close approval."
    );
  }

  if (caseDetail.item.marketStatus !== "open") {
    throw new OracleReviewActionError(
      409,
      "oracle_case_not_approvable",
      "Market must be open before approving Oracle close-condition action."
    );
  }

  if (caseDetail.item.output?.outputType !== "early_close_recommendation") {
    throw new OracleReviewActionError(
      409,
      "oracle_case_not_approvable",
      "Oracle case does not carry a close-condition recommendation output."
    );
  }

  assertCloseConditionSatisfied(caseDetail);

  const sourceUrl = readResolutionSourceUrl(caseDetail.evidenceSources[0]);
  const closeReason =
    request.reviewNote?.trim() || readCloseConditionReasonSummary(caseDetail.outputSnapshot);
  const review = buildAttemptedReviewRecord(
    caseDetail,
    actor,
    request,
    "approve_close_condition",
    closeReason
  );

  const replay = await insertReviewAttemptOrReplay(dbPool, caseDetail, review);

  if (replay) {
    return replay;
  }

  try {
    const close = await closeMarket(
      dbPool,
      caseDetail.item.marketId,
      {
        triggerType: "oracle_confirmed_event_completion",
        reason: closeReason,
        sourceUrl,
        note: JSON.stringify({
          oracleCaseId,
          sourcePolicy: caseDetail.item.sourcePolicy,
          evidencePacket: caseDetail.item.evidencePacket,
          outputSnapshot: caseDetail.outputSnapshot
        }),
        oracleCaseId,
        triggeredByOracleId: "oracle",
        approvedByHumanId: actor.actorId,
        idempotencyKey: request.idempotencyKey
      },
      actor
    );

    const completedReview: OracleCaseReviewRecord = {
      ...review,
      resultStatus: "completed",
      resolveResponseSnapshot: close,
      completedAt: new Date().toISOString()
    };

    await updateReviewAttempt(dbPool, completedReview);

    return {
      objectType: "oracle_case_review_result",
      review: completedReview,
      case: buildCaseSnapshot(caseDetail),
      outcome: "approved_close_condition",
      reviewMessage: "Human approved the Oracle close-condition recommendation.",
      close,
      resolution: null
    };
  } catch (error) {
    await updateReviewAttempt(dbPool, buildFailedReviewRecord(review, error));
    throw error;
  }
}

export async function approveOracleResolutionCase(
  dbPool: Pool,
  oracleCaseId: string,
  actor: RequestActor,
  request: ApproveOracleResolutionCaseRequest
): Promise<ApproveOracleResolutionCaseResult> {
  const caseDetail = await readOracleCaseDetail(dbPool, oracleCaseId);
  const existing = await readExistingReviewByIdempotency(
    dbPool,
    oracleCaseId,
    "approve_resolution",
    request.idempotencyKey
  );

  if (existing) {
    return buildExistingReviewResult(caseDetail, existing);
  }

  assertCaseIsReviewable(caseDetail);

  if (caseDetail.item.caseType !== "resolution_check") {
    throw new OracleReviewActionError(
      409,
      "oracle_case_not_approvable",
      "Only resolution-check Oracle cases can be approved for trusted resolve."
    );
  }

  if (caseDetail.item.caseStatus !== "recommended") {
    throw new OracleReviewActionError(
      409,
      "oracle_case_not_approvable",
      "Oracle case must be in recommended state before approval."
    );
  }

  if (caseDetail.item.marketStatus !== "closed") {
    throw new OracleReviewActionError(
      409,
      "oracle_case_not_approvable",
      "Market must already be closed before approving Oracle resolution."
    );
  }

  if (caseDetail.item.output?.outputType !== "resolution_recommendation") {
    throw new OracleReviewActionError(
      409,
      "oracle_case_not_approvable",
      "Oracle case does not carry a resolution recommendation output."
    );
  }

  if (!caseDetail.item.winningOutcomeId) {
    throw new OracleReviewActionError(
      409,
      "oracle_case_not_approvable",
      "Oracle case is missing a winning outcome id."
    );
  }

  const sourceUrl = readResolutionSourceUrl(caseDetail.evidenceSources[0]);
  const resolutionNote =
    request.reviewNote?.trim() || readResolutionReasonSummary(caseDetail.outputSnapshot);
  const review = buildAttemptedReviewRecord(
    caseDetail,
    actor,
    request,
    "approve_resolution",
    resolutionNote
  );

  const replay = await insertReviewAttemptOrReplay(dbPool, caseDetail, review);

  if (replay) {
    return replay;
  }

  try {
    const resolution = await resolveMarket(
      dbPool,
      caseDetail.item.marketId,
      {
        winningOutcomeId: caseDetail.item.winningOutcomeId,
        triggerType: "human_reviewed_oracle_resolution",
        resolutionSourceUrl: sourceUrl,
        resolutionNote,
        oracleCaseId,
        proposedByOracleId: "oracle",
        approvedByHumanId: actor.actorId,
        evidenceSnapshot: JSON.stringify({
          sourcePolicy: caseDetail.item.sourcePolicy,
          evidencePacket: caseDetail.item.evidencePacket,
          evidenceSources: caseDetail.evidenceSources,
          outputSnapshot: caseDetail.outputSnapshot
        }),
        idempotencyKey: request.idempotencyKey
      },
      actor
    );

    const completedReview: OracleCaseReviewRecord = {
      ...review,
      resultStatus: "completed",
      resolutionId: resolution.resolutionId,
      resolveResponseSnapshot: resolution,
      completedAt: new Date().toISOString()
    };

    await updateReviewAttempt(dbPool, completedReview);
    await insertLifecycleEvent(dbPool, {
      marketId: caseDetail.item.marketId,
      eventType: "resolution_approved",
      sourceSystem: "oracle",
      actorId: actor.actorId,
      occurredAt: completedReview.completedAt ?? new Date().toISOString(),
      correlationId: request.idempotencyKey,
      dedupeKey: `resolution_approved:${caseDetail.item.marketId}:${oracleCaseId}:${request.idempotencyKey}`,
      oracleCaseId,
      resolutionId: resolution.resolutionId,
      payload: {
        reviewId: review.reviewId,
        winningOutcomeId: caseDetail.item.winningOutcomeId,
        reviewNote: resolutionNote
      }
    });

    let eventSiblingCascade: EventSiblingCascadeExecution | EventSiblingCascadeFailure | null = null;
    let dependentResolutionCascade:
      | DependentResolutionCascadeExecution
      | DependentResolutionCascadeFailure
      | null = null;

    try {
      eventSiblingCascade = await executeEventSiblingCascade({
        dbPool,
        actor,
        caseDetail,
        reviewId: review.reviewId,
        resolutionSourceUrl: sourceUrl,
        resolutionNote,
        idempotencyKey: request.idempotencyKey
      });
    } catch (error) {
      eventSiblingCascade = {
        objectType: "event_sibling_resolution_cascade_failed",
        code: readErrorCode(error),
        message: readErrorMessage(error)
      };
    }

    try {
      dependentResolutionCascade = await executeDependentResolutionCascade({
        dbPool,
        actor,
        caseDetail,
        reviewId: review.reviewId,
        resolutionSourceUrl: sourceUrl,
        resolutionNote,
        idempotencyKey: request.idempotencyKey
      });
    } catch (error) {
      dependentResolutionCascade = {
        objectType: "dependent_resolution_cascade_failed",
        code: readErrorCode(error),
        message: readErrorMessage(error)
      };
    }

    const cascadeFailed =
      cascadeNeedsRepair(eventSiblingCascade) ||
      cascadeNeedsRepair(dependentResolutionCascade);
    await insertLifecycleEvent(dbPool, {
      marketId: caseDetail.item.marketId,
      eventType: cascadeFailed
        ? "resolution_cascade_failed"
        : "resolution_cascade_completed",
      sourceSystem: "oracle",
      actorId: actor.actorId,
      occurredAt: new Date().toISOString(),
      correlationId: request.idempotencyKey,
      dedupeKey: `resolution_cascade:${caseDetail.item.marketId}:${oracleCaseId}:${request.idempotencyKey}`,
      oracleCaseId,
      resolutionId: resolution.resolutionId,
      payload: {
        reviewId: review.reviewId,
        eventSiblingCascade,
        dependentResolutionCascade
      }
    });

    return {
      objectType: "oracle_case_review_result",
      review: completedReview,
      case: buildCaseSnapshot(caseDetail),
      outcome: "approved_resolution",
      reviewMessage: "Human approved the Oracle resolution recommendation.",
      close: null,
      resolution,
      eventSiblingCascade,
      dependentResolutionCascade
    };
  } catch (error) {
    await updateReviewAttempt(dbPool, buildFailedReviewRecord(review, error));
    throw error;
  }
}

export async function executeOracleReviewAction(
  dbPool: Pool,
  actor: RequestActor,
  request: ExecuteOracleReviewActionRequest
): Promise<OracleCaseReviewResult> {
  if (request.action === "approve_close_condition") {
    return approveOracleCloseConditionCase(dbPool, request.caseId, actor, {
      reviewNote: request.reviewNote,
      idempotencyKey: request.idempotencyKey
    });
  }

  if (request.action === "approve_resolution") {
    return approveOracleResolutionCase(dbPool, request.caseId, actor, {
      reviewNote: request.reviewNote,
      idempotencyKey: request.idempotencyKey
    });
  }

  if (request.action === "reject_case") {
    return rejectOracleCase(dbPool, request.caseId, actor, {
      reviewNote: request.reviewNote,
      idempotencyKey: request.idempotencyKey
    });
  }

  return requestMoreEvidenceForOracleCase(dbPool, request.caseId, actor, {
    reviewNote: request.reviewNote,
    idempotencyKey: request.idempotencyKey
  });
}
