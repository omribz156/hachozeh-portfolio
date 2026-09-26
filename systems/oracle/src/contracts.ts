export const ORACLE_CASE_TYPES = [
  "close_condition_check",
  "resolution_check"
] as const;

export type OracleCaseType = (typeof ORACLE_CASE_TYPES)[number];

export function isOracleCaseType(value: unknown): value is OracleCaseType {
  return typeof value === "string" && ORACLE_CASE_TYPES.includes(value as OracleCaseType);
}

export const ORACLE_AMBIGUITY_LEVELS = ["low", "medium", "high"] as const;

export type OracleAmbiguityLevel = (typeof ORACLE_AMBIGUITY_LEVELS)[number];

export type OracleSourcePolicy = {
  preferredSourceIds?: string[];
  fallbackSourceIds?: string[];
  contextSourceIds?: string[];
  closeConditionSourceIds?: string[];
  resolutionSourceIds?: string[];
  credibleReporting?: {
    minimumIndependentSources?: number;
    approvedSourceIds?: string[];
    conflictPolicy?: string;
    correctionWindow?: string;
    requiresHumanReview?: boolean;
  };
  requiresHumanReviewOnSourceConflict?: boolean;
  requiresHumanReviewOnWeakAuthority?: boolean;
  notes?: string[];
};

export type OracleSourceRolePlan = {
  wake: string[];
  ground: string[];
  resolve: string[];
  integrity: string[];
};

export type OracleSourcePolicyHints = {
  sourceRolePlan: OracleSourceRolePlan;
  fetchNeeds: string[];
  policyNotes: string[];
};

export type OracleCase = {
  objectType: "oracle_case";
  oracleCaseId: string;
  marketId: string;
  marketStatus: "draft" | "open" | "closed" | "resolved" | "voided";
  caseType: OracleCaseType;
  createdAt: string;
  updatedAt: string;
  scheduledCloseAt?: string;
  currentWinningOutcomeKey?: string;
  ambiguityLevel?: OracleAmbiguityLevel;
  summary?: string;
};

export type OracleEvidenceSource = {
  sourceId?: string;
  sourceUrl: string;
  sourceLabel: string;
  sourceType: string;
  independentGroupId?: string;
  capturedAt: string;
  claimSummary: string;
};

export type EvidencePacket = {
  objectType: "evidence_packet";
  evidencePacketId: string;
  oracleCaseId: string;
  marketId: string;
  evidenceSummary: string;
  sources: OracleEvidenceSource[];
  capturedAt: string;
  winningOutcomeKey?: string;
  closeConditionSatisfied?: boolean;
  notes?: string;
};

export type OracleFallbackResolutionPolicy = {
  evidenceStandard: string;
  primarySourceUrl: string;
  primaryFailureReason: string;
};

export type EarlyCloseRecommendation = {
  objectType: "early_close_recommendation";
  earlyCloseRecommendationId: string;
  oracleCaseId: string;
  marketId: string;
  triggerType: "oracle_confirmed_event_completion";
  recommendedAction: "close_now" | "review_first" | "take_no_action";
  reasonSummary: string;
  createdAt: string;
  evidencePacketId?: string;
  requiresHumanReview?: boolean;
  reviewReason?: string;
};

export type ResolutionRecommendation = {
  objectType: "resolution_recommendation";
  resolutionRecommendationId: string;
  oracleCaseId: string;
  marketId: string;
  winningOutcomeKey: string;
  reasonSummary: string;
  createdAt: string;
  evidencePacketId?: string;
  requiresHumanReview?: boolean;
  reviewReason?: string;
  resolvedAtObserved?: string;
  fallbackPolicy?: OracleFallbackResolutionPolicy;
};

export type OracleReviewSignal = {
  objectType: "oracle_review_signal";
  oracleReviewSignalId: string;
  oracleCaseId: string;
  marketId: string;
  severity: "low" | "medium" | "high";
  reviewType:
    | "conflicting_sources"
    | "insufficient_evidence"
    | "wording_ambiguity"
    | "mapping_ambiguity";
  summary: string;
  createdAt: string;
  evidencePacketId?: string;
  recommendedNextAction?: "inspect" | "approve" | "reject" | "wait";
  notes?: string;
};

export type OracleRecommendationOutput =
  | EarlyCloseRecommendation
  | ResolutionRecommendation
  | OracleReviewSignal;

export type OracleInspectionResult = {
  objectType: "oracle_inspection_result";
  market: {
    marketId: string;
    title: string;
    marketStatus: "draft" | "open" | "closed" | "resolved" | "voided";
    scheduledCloseAt: string;
    resolutionSource: string;
    resolutionRules: string;
    oracleSourcePolicy: OracleSourcePolicy | null;
    contractHints: OracleSourcePolicyHints;
    outcomes: Array<{
      outcomeId: string;
      outcomeKey: string;
      label: string;
      isWinner: boolean | null;
    }>;
  };
  oracleCase: OracleCase;
  evidencePacket: EvidencePacket;
  output: OracleRecommendationOutput;
};
