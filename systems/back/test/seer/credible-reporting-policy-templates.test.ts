import { describe, expect, it } from "vitest";

import {
  buildCredibleReportingContractPolicy,
  DIRECT_STATE_CONFLICT_POLICY,
  HACHOZEH_MAJOR_MEDIA_MENTION_POLICY,
  LOCAL_MAJOR_MEDIA_SOURCE_IDS,
  WHO_PANDEMIC_DECLARATION_POLICY
} from "../../../seer/src/credible-reporting-policy-templates";

describe("credible reporting policy templates", () => {
  it("keeps major Israeli media sources in the mention policy", () => {
    expect(LOCAL_MAJOR_MEDIA_SOURCE_IDS).toContain("src_themarker_news");
    expect(LOCAL_MAJOR_MEDIA_SOURCE_IDS).toContain("src_maariv_news");
    expect(LOCAL_MAJOR_MEDIA_SOURCE_IDS).toContain("src_israel_hayom_news");
    expect(HACHOZEH_MAJOR_MEDIA_MENTION_POLICY.minimumIndependentSources).toBe(1);
    expect(HACHOZEH_MAJOR_MEDIA_MENTION_POLICY.allowSingleSourceEvidence).toBe(true);
  });

  it("requires official source evidence for sensitive fallback templates", () => {
    expect(DIRECT_STATE_CONFLICT_POLICY.requiredEvidenceSourceIds).toEqual([
      "src_idf_realtime_updates",
      "src_gov_il_news"
    ]);
    expect(WHO_PANDEMIC_DECLARATION_POLICY.requiredEvidenceSourceIds).toEqual(["src_who_official"]);
  });

  it("builds a contract-shaped credible-reporting policy", () => {
    expect(buildCredibleReportingContractPolicy(WHO_PANDEMIC_DECLARATION_POLICY)).toMatchObject({
      oracleCapability: "credible_reporting",
      resolutionAuthorityType: "credible-reporting",
      allowFallbackResolution: true,
      fallbackEvidenceStandard: "two_independent_reports",
      credibleReporting: {
        approvedSourceIds: expect.arrayContaining(["src_who_official", "src_reuters", "src_ap"]),
        minimumIndependentSources: 2,
        requiresHumanReview: true
      }
    });
  });

  it("builds a single-source mention policy only for the media mention template", () => {
    expect(buildCredibleReportingContractPolicy(HACHOZEH_MAJOR_MEDIA_MENTION_POLICY)).toMatchObject({
      fallbackEvidenceStandard: "single_approved_source",
      credibleReporting: {
        minimumIndependentSources: 1,
        allowSingleSourceEvidence: true
      }
    });
  });
});
