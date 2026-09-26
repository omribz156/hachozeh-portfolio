export type OracleCandidateEvidenceRole =
  | "context_reference"
  | "close_condition_preferred"
  | "close_condition_fallback"
  | "resolution_preferred"
  | "resolution_fallback";

export type OracleCandidateEvidence = {
  candidateEvidenceId: string;
  signalId: string;
  sourceId: string;
  sourceLabel: string;
  sourceUrl: string | null;
  independentGroupId?: string;
  title: string;
  summary: string;
  observedAt: string;
  configuredRoles: OracleCandidateEvidenceRole[];
  authorityProfile?: string;
  fetchReadiness: "live" | "planned" | "unknown";
  normalizationStatus: "candidate_only";
  requiresHumanReview: true;
  reviewReasons: string[];
};
