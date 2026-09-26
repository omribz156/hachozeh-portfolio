import { isOracleCaseType, type OracleCaseType, type OracleReviewSignal } from "./contracts";
import type { OracleInspectionRequest } from "./inspect-market-service";
import type { OracleCandidateEvidence } from "./candidate-evidence";
import {
  parseArrayOrEmptyValue,
  parseHttpsUrlValue,
  parseNullableStringField,
  parseNullableStringValue,
  parseObjectBody,
  parseOptionalBooleanValue,
  parseRequiredStringField,
  parseRequiredStringValue
} from "./zod-request-body";

export type IntakeOracleCandidateEvidenceRequest = {
  marketId: string;
  caseType: OracleCaseType;
  candidateEvidence: OracleCandidateEvidence;
  closeConditionSatisfied?: boolean | null;
  winningOutcomeId?: string | null;
  winningOutcomeKey?: string | null;
  evidenceSummary?: string | null;
  reasonSummary?: string | null;
  summary?: string | null;
  ambiguityLevel?: OracleInspectionRequest["ambiguityLevel"] | null;
  requiresHumanReview?: boolean;
  reviewType?: OracleReviewSignal["reviewType"] | null;
  reviewSeverity?: OracleReviewSignal["severity"] | null;
  reviewSummary?: string | null;
  reviewNotes?: string | null;
  recommendedNextAction?: OracleReviewSignal["recommendedNextAction"] | null;
  resolvedAtObserved?: string | null;
  persistResult?: boolean;
};

export type ApproveOracleResolutionCandidateRequest =
  IntakeOracleCandidateEvidenceRequest & {
    reviewNote?: string | null;
    approvalIdempotencyKey: string;
  };

export class OracleCandidateIntakeError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "OracleCandidateIntakeError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function createCandidateIntakeError(message: string): OracleCandidateIntakeError {
  return new OracleCandidateIntakeError(400, "invalid_request", message);
}

function parseCandidateEvidence(value: unknown): OracleCandidateEvidence {
  const candidate = parseObjectBody(
    value,
    "candidateEvidence must be an object.",
    createCandidateIntakeError
  );
  const configuredRoles = parseArrayOrEmptyValue(candidate.configuredRoles).filter(
    (entry): entry is OracleCandidateEvidence["configuredRoles"][number] =>
      entry === "close_condition_preferred" ||
      entry === "close_condition_fallback" ||
      entry === "resolution_preferred" ||
      entry === "resolution_fallback"
  );
  const reviewReasons = parseArrayOrEmptyValue(candidate.reviewReasons)
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const sourceUrl = parseNullableStringValue(
    candidate.sourceUrl,
    "candidateEvidence.sourceUrl",
    createCandidateIntakeError
  );

  if (!sourceUrl) {
    throw new OracleCandidateIntakeError(
      409,
      "candidate_not_intakeable",
      "Candidate evidence must have a source URL before Oracle intake."
    );
  }

  return {
    candidateEvidenceId: parseRequiredStringValue(
      candidate.candidateEvidenceId,
      "candidateEvidence.candidateEvidenceId",
      createCandidateIntakeError
    ),
    signalId: parseRequiredStringValue(
      candidate.signalId,
      "candidateEvidence.signalId",
      createCandidateIntakeError
    ),
    sourceId: parseRequiredStringValue(
      candidate.sourceId,
      "candidateEvidence.sourceId",
      createCandidateIntakeError
    ),
    sourceLabel: parseRequiredStringValue(
      candidate.sourceLabel,
      "candidateEvidence.sourceLabel",
      createCandidateIntakeError
    ),
    sourceUrl: parseHttpsUrlValue(
      sourceUrl,
      "candidateEvidence.sourceUrl",
      createCandidateIntakeError
    ),
    independentGroupId:
      parseNullableStringValue(
        candidate.independentGroupId,
        "candidateEvidence.independentGroupId",
        createCandidateIntakeError
      ) ?? undefined,
    title: parseRequiredStringValue(
      candidate.title,
      "candidateEvidence.title",
      createCandidateIntakeError
    ),
    summary: parseRequiredStringValue(
      candidate.summary,
      "candidateEvidence.summary",
      createCandidateIntakeError
    ),
    observedAt: parseRequiredStringValue(
      candidate.observedAt,
      "candidateEvidence.observedAt",
      createCandidateIntakeError
    ),
    configuredRoles,
    authorityProfile:
      parseNullableStringValue(
        candidate.authorityProfile,
        "candidateEvidence.authorityProfile",
        createCandidateIntakeError
      ) ?? undefined,
    fetchReadiness:
      candidate.fetchReadiness === "live" ||
      candidate.fetchReadiness === "planned" ||
      candidate.fetchReadiness === "unknown"
        ? candidate.fetchReadiness
        : "unknown",
    normalizationStatus: "candidate_only",
    requiresHumanReview: true,
    reviewReasons
  };
}

export function parseIntakeOracleCandidateEvidenceRequest(
  body: unknown
): IntakeOracleCandidateEvidenceRequest {
  const candidate = parseObjectBody(
    body,
    "Candidate intake body must be an object.",
    createCandidateIntakeError
  );
  const caseType = candidate.caseType ?? "resolution_check";

  if (!isOracleCaseType(caseType)) {
    throw createCandidateIntakeError(
      "caseType must be one of: close_condition_check, resolution_check."
    );
  }

  return {
    marketId: parseRequiredStringField(candidate, "marketId", createCandidateIntakeError),
    caseType,
    candidateEvidence: parseCandidateEvidence(candidate.candidateEvidence),
    closeConditionSatisfied: parseOptionalBooleanValue(
      candidate.closeConditionSatisfied,
      "closeConditionSatisfied",
      createCandidateIntakeError
    ),
    winningOutcomeId: parseNullableStringField(
      candidate,
      "winningOutcomeId",
      createCandidateIntakeError
    ),
    winningOutcomeKey: parseNullableStringField(
      candidate,
      "winningOutcomeKey",
      createCandidateIntakeError
    ),
    evidenceSummary: parseNullableStringField(
      candidate,
      "evidenceSummary",
      createCandidateIntakeError
    ),
    reasonSummary: parseNullableStringField(
      candidate,
      "reasonSummary",
      createCandidateIntakeError
    ),
    summary: parseNullableStringField(candidate, "summary", createCandidateIntakeError),
    ambiguityLevel:
      candidate.ambiguityLevel === "low" ||
      candidate.ambiguityLevel === "medium" ||
      candidate.ambiguityLevel === "high"
        ? candidate.ambiguityLevel
        : null,
    requiresHumanReview:
      candidate.requiresHumanReview == null
        ? undefined
        : Boolean(candidate.requiresHumanReview),
    reviewType:
      candidate.reviewType === "conflicting_sources" ||
      candidate.reviewType === "insufficient_evidence" ||
      candidate.reviewType === "wording_ambiguity" ||
      candidate.reviewType === "mapping_ambiguity"
        ? candidate.reviewType
        : null,
    reviewSeverity:
      candidate.reviewSeverity === "low" ||
      candidate.reviewSeverity === "medium" ||
      candidate.reviewSeverity === "high"
        ? candidate.reviewSeverity
        : null,
    reviewSummary: parseNullableStringField(candidate, "reviewSummary", createCandidateIntakeError),
    reviewNotes: parseNullableStringField(candidate, "reviewNotes", createCandidateIntakeError),
    recommendedNextAction:
      candidate.recommendedNextAction === "inspect" ||
      candidate.recommendedNextAction === "approve" ||
      candidate.recommendedNextAction === "reject" ||
      candidate.recommendedNextAction === "wait"
        ? candidate.recommendedNextAction
        : null,
    resolvedAtObserved: parseNullableStringField(
      candidate,
      "resolvedAtObserved",
      createCandidateIntakeError
    ),
    persistResult: candidate.persistResult == null ? undefined : Boolean(candidate.persistResult)
  };
}

export function parseApproveOracleResolutionCandidateRequest(
  body: unknown
): ApproveOracleResolutionCandidateRequest {
  const request = parseIntakeOracleCandidateEvidenceRequest(body);

  if (request.caseType !== "resolution_check") {
    throw new OracleCandidateIntakeError(
      400,
      "invalid_request",
      "approve-resolution-candidate only supports resolution_check intake."
    );
  }

  if (!request.winningOutcomeId && !request.winningOutcomeKey) {
    throw new OracleCandidateIntakeError(
      400,
      "invalid_request",
      "approve-resolution-candidate requires winningOutcomeId or winningOutcomeKey."
    );
  }

  const candidate = parseObjectBody(
    body,
    "Approval request body must be an object.",
    createCandidateIntakeError
  );

  return {
    ...request,
    reviewNote: parseNullableStringField(candidate, "reviewNote", createCandidateIntakeError),
    approvalIdempotencyKey: parseRequiredStringField(
      candidate,
      "approvalIdempotencyKey",
      createCandidateIntakeError
    )
  };
}
