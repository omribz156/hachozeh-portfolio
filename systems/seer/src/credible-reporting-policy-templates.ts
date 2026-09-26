import type { OracleCapabilityStatus, ResolutionAuthorityType } from "./contracts";

export type CredibleReportingPolicyTemplateId =
  | "hachozeh-major-media-mention-v1"
  | "direct-state-conflict-v1"
  | "who-pandemic-declaration-v1";

export type CredibleReportingPolicyTemplate = {
  templateId: CredibleReportingPolicyTemplateId;
  label: string;
  approvedSourceIds: string[];
  minimumIndependentSources: number;
  fallbackEvidenceStandard: "single_approved_source" | "two_independent_reports";
  conflictPolicy: string;
  correctionWindow: string;
  requiresHumanReview: boolean;
  allowSingleSourceEvidence?: boolean;
  requiredEvidenceSourceIds?: string[];
  notes: string[];
};

export type CredibleReportingContractPolicy = {
  oracleCapability: OracleCapabilityStatus;
  resolutionAuthorityType: ResolutionAuthorityType;
  allowFallbackResolution: boolean;
  fallbackEvidenceStandard: "single_approved_source" | "two_independent_reports";
  credibleReporting: {
    approvedSourceIds: string[];
    minimumIndependentSources: number;
    conflictPolicy: string;
    correctionWindow: string;
    requiresHumanReview: boolean;
    allowSingleSourceEvidence?: boolean;
  };
};

export const LOCAL_MAJOR_MEDIA_SOURCE_IDS = [
  "src_kan_news",
  "src_channel12_news",
  "src_channel13_news",
  "src_ynet_news",
  "src_calcalist_news",
  "src_walla_news",
  "src_haaretz_news",
  "src_themarker_news",
  "src_globes_news",
  "src_maariv_news",
  "src_israel_hayom_news"
] as const;

export const INTERNATIONAL_WIRE_SOURCE_IDS = ["src_reuters", "src_ap"] as const;

export const HACHOZEH_MAJOR_MEDIA_MENTION_POLICY: CredibleReportingPolicyTemplate = {
  templateId: "hachozeh-major-media-mention-v1",
  label: "Hachozeh major media mention",
  approvedSourceIds: [...LOCAL_MAJOR_MEDIA_SOURCE_IDS, ...INTERNATIONAL_WIRE_SOURCE_IDS],
  minimumIndependentSources: 1,
  fallbackEvidenceStandard: "single_approved_source",
  conflictPolicy: "requires_human_review_conflicting_sources",
  correctionWindow: "72h",
  requiresHumanReview: true,
  allowSingleSourceEvidence: true,
  notes: [
    "One approved editorial mention can resolve YES after human review.",
    "Syndication, paid ads, SEO pages, automatic listings, and Hachozeh-owned posts do not count."
  ]
};

export const DIRECT_STATE_CONFLICT_POLICY: CredibleReportingPolicyTemplate = {
  templateId: "direct-state-conflict-v1",
  label: "Direct state conflict",
  approvedSourceIds: [
    "src_idf_realtime_updates",
    "src_gov_il_news",
    ...INTERNATIONAL_WIRE_SOURCE_IDS,
    "src_kan_news",
    "src_channel12_news",
    "src_channel13_news",
    "src_ynet_news",
    "src_walla_news",
    "src_haaretz_news",
    "src_maariv_news",
    "src_israel_hayom_news"
  ],
  minimumIndependentSources: 2,
  fallbackEvidenceStandard: "two_independent_reports",
  conflictPolicy: "requires_human_review_conflicting_sources",
  correctionWindow: "72h",
  requiresHumanReview: true,
  requiredEvidenceSourceIds: ["src_idf_realtime_updates", "src_gov_il_news"],
  notes: [
    "Prefer official Israeli source evidence; major reporting is fallback only.",
    "If official wording is unavailable or incomplete, require two independent approved reports and human review."
  ]
};

export const WHO_PANDEMIC_DECLARATION_POLICY: CredibleReportingPolicyTemplate = {
  templateId: "who-pandemic-declaration-v1",
  label: "WHO pandemic declaration",
  approvedSourceIds: ["src_who_official", ...INTERNATIONAL_WIRE_SOURCE_IDS, "src_kan_news", "src_channel12_news"],
  minimumIndependentSources: 2,
  fallbackEvidenceStandard: "two_independent_reports",
  conflictPolicy: "requires_who_official_evidence",
  correctionWindow: "72h",
  requiresHumanReview: true,
  requiredEvidenceSourceIds: ["src_who_official"],
  notes: [
    "WHO official language is required for YES.",
    "PHEIC alone does not count unless the visible market rules explicitly say so."
  ]
};

export const GTA_VI_EVENT_CREDIBLE_REPORTING_POLICIES = [
  HACHOZEH_MAJOR_MEDIA_MENTION_POLICY,
  DIRECT_STATE_CONFLICT_POLICY,
  WHO_PANDEMIC_DECLARATION_POLICY
] as const;

export function buildCredibleReportingContractPolicy(
  template: CredibleReportingPolicyTemplate
): CredibleReportingContractPolicy {
  return {
    oracleCapability: "credible_reporting",
    resolutionAuthorityType: "credible-reporting",
    allowFallbackResolution: true,
    fallbackEvidenceStandard: template.fallbackEvidenceStandard,
    credibleReporting: {
      approvedSourceIds: template.approvedSourceIds,
      minimumIndependentSources: template.minimumIndependentSources,
      conflictPolicy: template.conflictPolicy,
      correctionWindow: template.correctionWindow,
      requiresHumanReview: template.requiresHumanReview,
      allowSingleSourceEvidence: template.allowSingleSourceEvidence
    }
  };
}
