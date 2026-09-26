import type {
  OracleAmbiguityLevel,
  OracleCaseType,
  OracleReviewSignal
} from "./contracts";

export type OracleInspectionRequest = {
  marketId: string;
  caseType: OracleCaseType;
  sources: Array<{
    sourceId?: string;
    sourceUrl: string;
    sourceLabel: string;
    sourceType: string;
    independentGroupId?: string;
    claimSummary: string;
    capturedAt?: string;
  }>;
  closeConditionSatisfied?: boolean | null;
  winningOutcomeId?: string | null;
  winningOutcomeKey?: string | null;
  evidenceSummary?: string | null;
  reasonSummary?: string | null;
  summary?: string | null;
  ambiguityLevel?: OracleAmbiguityLevel | null;
  requiresHumanReview?: boolean;
  reviewType?: OracleReviewSignal["reviewType"] | null;
  reviewSeverity?: OracleReviewSignal["severity"] | null;
  reviewSummary?: string | null;
  reviewNotes?: string | null;
  recommendedNextAction?: OracleReviewSignal["recommendedNextAction"] | null;
  resolvedAtObserved?: string | null;
  fallbackResolution?: boolean;
  fallbackEvidenceStandard?: string | null;
  primarySourceUrl?: string | null;
  primaryFailureReason?: string | null;
  capturedAt?: string;
};

export type OracleInspectionOptions = {
  persistResult?: boolean;
};
