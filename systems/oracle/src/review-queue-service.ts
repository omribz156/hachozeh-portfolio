import type { Queryable } from "../../back/src/platform-surface/oracle";

import type {
  OracleCaseType,
  OracleSourcePolicy,
  OracleSourcePolicyHints
} from "./contracts";
import {
  normalizeOracleSourcePolicy,
  parseOracleSourcePolicyHints
} from "./source-policy-annotations";
import {
  readOracleCaseById,
  readOracleCaseReviewRows,
  readOracleCases,
  readTerminalReviewRowsByCaseId,
  type OracleCaseRow,
  type OracleCaseReviewRow,
  type OracleCaseStatus,
  type TerminalReviewRow
} from "./review-queue-read-model";

type OracleEffectiveCaseStatus =
  | OracleCaseStatus
  | "approved_close_condition"
  | "approved_resolution"
  | "rejected"
  | "more_evidence_requested";

type OracleReviewQueueItem = {
  oracleCaseId: string;
  marketId: string;
  marketTitle: string;
  caseType: OracleCaseType;
  marketStatus: "draft" | "open" | "closed" | "resolved" | "voided";
  caseStatus: OracleEffectiveCaseStatus;
  storedCaseStatus: OracleCaseStatus;
  terminalReview: OracleTerminalReviewSnapshot | null;
  ambiguityLevel: "low" | "medium" | "high" | null;
  summary: string | null;
  scheduledCloseAt: string | null;
  createdAt: string;
  updatedAt: string;
  winningOutcomeId: string | null;
  winningOutcomeLabel: string | null;
  sourcePolicy: OracleSourcePolicy | null;
  contractHints: OracleSourcePolicyHints;
  evidencePacket: {
    evidencePacketId: string;
    evidenceSummary: string;
    capturedAt: string;
    sourceCount: number;
    closeConditionSatisfied: boolean | null;
  } | null;
  output: {
    outputId: string;
    outputType: "early_close_recommendation" | "resolution_recommendation" | "oracle_review_signal";
    snapshot: Record<string, unknown>;
  } | null;
};

type OracleEvidenceSourceSnapshot = {
  sourceId?: string;
  sourceUrl: string;
  sourceLabel: string;
  sourceType: string;
  independentGroupId?: string;
  capturedAt: string;
  claimSummary: string;
};

type OracleTerminalReviewSnapshot = {
  reviewId: string;
  reviewAction:
    | "approve_close_condition"
    | "approve_resolution"
    | "reject_case"
    | "request_more_evidence";
  resultStatus: "completed";
  completedAt: string | null;
  createdAt: string;
};

type OracleCaseReviewSnapshot = {
  reviewId: string;
  reviewAction:
    | "approve_close_condition"
    | "approve_resolution"
    | "reject_case"
    | "request_more_evidence";
  resultStatus: "attempted" | "completed" | "failed";
  actorId: string;
  actorRole: "user" | "admin";
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

export type OracleReviewQueueResult = {
  objectType: "oracle_review_queue";
  caseStatus: OracleCaseStatus | "all";
  totalItems: number;
  items: OracleReviewQueueItem[];
};

export type OracleCaseHistoryResult = {
  objectType: "oracle_case_history";
  marketId: string;
  totalItems: number;
  items: OracleReviewQueueItem[];
};

export type OracleCaseDetailResult = {
  objectType: "oracle_case_detail";
  item: OracleReviewQueueItem;
  evidenceSources: OracleEvidenceSourceSnapshot[];
  outputSnapshot: Record<string, unknown> | null;
  reviewHistory: OracleCaseReviewSnapshot[];
};

export type ReadOracleReviewQueueOptions = {
  caseStatus?: OracleCaseStatus | "all";
  caseType?: OracleCaseType;
  marketId?: string;
  limit?: number;
};

function normalizeSnapshot(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function readSourceCount(value: unknown): number {
  if (!Array.isArray(value)) {
    return 0;
  }

  return value.length;
}

function normalizeEvidenceSources(value: unknown): OracleEvidenceSourceSnapshot[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .map((item) => {
      const sourceUrl = typeof item.sourceUrl === "string" ? item.sourceUrl.trim() : "";
      const sourceLabel = typeof item.sourceLabel === "string" ? item.sourceLabel.trim() : "";
      const sourceType = typeof item.sourceType === "string" ? item.sourceType.trim() : "";
      const capturedAt = typeof item.capturedAt === "string" ? item.capturedAt.trim() : "";
      const claimSummary = typeof item.claimSummary === "string" ? item.claimSummary.trim() : "";
      const sourceId = typeof item.sourceId === "string" ? item.sourceId.trim() : undefined;
      const independentGroupId =
        typeof item.independentGroupId === "string" ? item.independentGroupId.trim() : undefined;

      return {
        sourceId,
        sourceUrl,
        sourceLabel,
        sourceType,
        independentGroupId,
        capturedAt,
        claimSummary
      };
    })
    .filter(
      (item) =>
        item.sourceUrl.length > 0 &&
        item.sourceLabel.length > 0 &&
        item.sourceType.length > 0 &&
        item.capturedAt.length > 0 &&
        item.claimSummary.length > 0
    );
}

function mapReviewRow(row: OracleCaseReviewRow): OracleCaseReviewSnapshot {
  return {
    reviewId: row.id,
    reviewAction: row.review_action,
    resultStatus: row.result_status,
    actorId: row.actor_id,
    actorRole: row.actor_role,
    reviewNote: row.review_note,
    idempotencyKey: row.idempotency_key,
    resolutionId: row.resolution_id,
    resolveResponseSnapshot:
      row.resolve_response_snapshot && typeof row.resolve_response_snapshot === "object" && !Array.isArray(row.resolve_response_snapshot)
        ? (row.resolve_response_snapshot as Record<string, unknown>)
        : null,
    failureCode: row.failure_code,
    failureMessage: row.failure_message,
    createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
    failedAt: row.failed_at?.toISOString() ?? null
  };
}

function mapTerminalReviewRow(row: TerminalReviewRow): OracleTerminalReviewSnapshot {
  return {
    reviewId: row.id,
    reviewAction: row.review_action,
    resultStatus: row.result_status,
    completedAt: row.completed_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString()
  };
}

function readEffectiveCaseStatus(
  storedCaseStatus: OracleCaseStatus,
  terminalReview: OracleTerminalReviewSnapshot | null
): OracleEffectiveCaseStatus {
  if (!terminalReview) {
    return storedCaseStatus;
  }

  if (terminalReview.reviewAction === "approve_close_condition") {
    return "approved_close_condition";
  }

  if (terminalReview.reviewAction === "approve_resolution") {
    return "approved_resolution";
  }

  if (terminalReview.reviewAction === "reject_case") {
    return "rejected";
  }

  return "more_evidence_requested";
}

function mapRowToQueueItem(
  row: OracleCaseRow,
  terminalReview: OracleTerminalReviewSnapshot | null = null
): OracleReviewQueueItem {
  const sourcePolicy = normalizeOracleSourcePolicy(row.source_policy_snapshot);

  return {
    oracleCaseId: row.oracle_case_id,
    marketId: row.market_id,
    marketTitle: row.market_title,
    caseType: row.case_type,
    marketStatus: row.market_status,
    caseStatus: readEffectiveCaseStatus(row.case_status, terminalReview),
    storedCaseStatus: row.case_status,
    terminalReview,
    ambiguityLevel: row.ambiguity_level,
    summary: row.summary,
    scheduledCloseAt: row.scheduled_close_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    winningOutcomeId: row.winning_outcome_id,
    winningOutcomeLabel: row.winning_outcome_label,
    sourcePolicy,
    contractHints: parseOracleSourcePolicyHints(sourcePolicy),
    evidencePacket:
      row.evidence_packet_id && row.evidence_summary && row.evidence_captured_at
        ? {
            evidencePacketId: row.evidence_packet_id,
            evidenceSummary: row.evidence_summary,
            capturedAt: row.evidence_captured_at.toISOString(),
            sourceCount: readSourceCount(row.sources_snapshot),
            closeConditionSatisfied: row.close_condition_satisfied
          }
        : null,
    output:
      row.output_id && row.output_type
        ? {
            outputId: row.output_id,
            outputType: row.output_type,
            snapshot: normalizeSnapshot(row.output_snapshot)
          }
        : null
  };
}

async function readOracleCaseReviews(
  db: Queryable,
  oracleCaseId: string
): Promise<OracleCaseReviewSnapshot[]> {
  const rows = await readOracleCaseReviewRows(db, oracleCaseId);
  return rows.map(mapReviewRow);
}

async function readTerminalReviewsByCaseId(
  db: Queryable,
  oracleCaseIds: string[]
): Promise<Map<string, OracleTerminalReviewSnapshot>> {
  if (oracleCaseIds.length === 0) {
    return new Map();
  }

  const rows = await readTerminalReviewRowsByCaseId(db, oracleCaseIds);

  return new Map(
    rows.map((row) => [
      row.oracle_case_id,
      mapTerminalReviewRow(row)
    ])
  );
}

export async function readOracleReviewQueue(
  db: Queryable,
  options?: ReadOracleReviewQueueOptions
): Promise<OracleReviewQueueResult> {
  const caseStatus = options?.caseStatus ?? "review_needed";
  const rows = await readOracleCases(db, {
    ...options,
    caseStatus
  });
  const terminalReviewsByCaseId = await readTerminalReviewsByCaseId(
    db,
    rows.map((row) => row.oracle_case_id)
  );
  const actionableRows = rows.filter(
    (row) => caseStatus === "all" || !terminalReviewsByCaseId.has(row.oracle_case_id)
  );

  return {
    objectType: "oracle_review_queue",
    caseStatus,
    totalItems: actionableRows.length,
    items: actionableRows.map((row) =>
      mapRowToQueueItem(row, terminalReviewsByCaseId.get(row.oracle_case_id) ?? null)
    )
  };
}

export async function readOracleCaseHistory(
  db: Queryable,
  marketId: string,
  options?: Omit<ReadOracleReviewQueueOptions, "marketId">
): Promise<OracleCaseHistoryResult> {
  const rows = await readOracleCases(db, {
    ...options,
    caseStatus: options?.caseStatus ?? "all",
    marketId
  });
  const terminalReviewsByCaseId = await readTerminalReviewsByCaseId(
    db,
    rows.map((row) => row.oracle_case_id)
  );

  return {
    objectType: "oracle_case_history",
    marketId,
    totalItems: rows.length,
    items: rows.map((row) =>
      mapRowToQueueItem(row, terminalReviewsByCaseId.get(row.oracle_case_id) ?? null)
    )
  };
}

export async function readOracleCaseDetail(
  db: Queryable,
  oracleCaseId: string
): Promise<OracleCaseDetailResult> {
  const row = await readOracleCaseById(db, oracleCaseId);

  if (!row) {
    throw new Error(`Oracle case not found: ${oracleCaseId}`);
  }

  const reviewHistory = await readOracleCaseReviews(db, oracleCaseId);
  const terminalReview = reviewHistory.find(
    (review) =>
      review.resultStatus === "completed" &&
      (review.reviewAction === "approve_close_condition" ||
        review.reviewAction === "approve_resolution" ||
        review.reviewAction === "reject_case" ||
        review.reviewAction === "request_more_evidence")
  );

  return {
    objectType: "oracle_case_detail",
    item: mapRowToQueueItem(
      row,
      terminalReview
        ? {
            reviewId: terminalReview.reviewId,
            reviewAction: terminalReview.reviewAction,
            resultStatus: "completed",
            completedAt: terminalReview.completedAt,
            createdAt: terminalReview.createdAt
          }
        : null
    ),
    evidenceSources: normalizeEvidenceSources(row.sources_snapshot),
    outputSnapshot: row.output_id ? normalizeSnapshot(row.output_snapshot) : null,
    reviewHistory
  };
}
