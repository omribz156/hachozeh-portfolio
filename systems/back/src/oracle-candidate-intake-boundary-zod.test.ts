import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  OracleCandidateIntakeError,
  parseApproveOracleResolutionCandidateRequest,
  parseIntakeOracleCandidateEvidenceRequest
} from "../../oracle/src/candidate-intake-requests";

async function readOracleSource(relativePath: string): Promise<string> {
  return readFile(join(process.cwd(), "..", "oracle", "src", relativePath), "utf8");
}

const CANDIDATE_EVIDENCE = {
  candidateEvidenceId: "oce_sig_1",
  signalId: "sig_1",
  sourceId: "src_reuters",
  sourceLabel: "Reuters",
  sourceUrl: " https://www.reuters.com/example ",
  independentGroupId: " reuters ",
  title: " Reuters report ",
  summary: " Reuters reports the claim. ",
  observedAt: " 2026-04-08T15:28:05.000Z ",
  configuredRoles: ["resolution_preferred", "not_a_role", "close_condition_fallback"],
  authorityProfile: " credible_reporting ",
  fetchReadiness: "planned",
  normalizationStatus: "candidate_only",
  requiresHumanReview: true,
  reviewReasons: [" Shared-source signal. ", 123, "", "  Trusted source.  "]
};

describe("oracle candidate intake boundary Zod ownership", () => {
  it("keeps candidate intake request parsing on Oracle Zod helpers", async () => {
    const [intakeSource, helperSource] = await Promise.all([
      readOracleSource("candidate-intake-requests.ts"),
      readOracleSource("zod-request-body.ts")
    ]);

    expect(intakeSource).toContain("./zod-request-body");
    expect(intakeSource).not.toContain("function readNonEmptyString");
    expect(intakeSource).not.toContain("function readOptionalBoolean");
    expect(helperSource).toContain('from "zod"');
  });

  it("preserves candidate intake parser behavior while normalizing boundary fields", () => {
    expect(() => parseIntakeOracleCandidateEvidenceRequest([])).toThrow(
      "Candidate intake body must be an object."
    );
    expect(() =>
      parseIntakeOracleCandidateEvidenceRequest({
        marketId: 123,
        candidateEvidence: CANDIDATE_EVIDENCE
      })
    ).toThrow("marketId must be a string.");
    expect(() =>
      parseIntakeOracleCandidateEvidenceRequest({
        marketId: "market_seed_next_prime_minister",
        candidateEvidence: []
      })
    ).toThrow("candidateEvidence must be an object.");
    expect(() =>
      parseIntakeOracleCandidateEvidenceRequest({
        marketId: "market_seed_next_prime_minister",
        candidateEvidence: {
          ...CANDIDATE_EVIDENCE,
          sourceUrl: " "
        }
      })
    ).toThrow("Candidate evidence must have a source URL before Oracle intake.");
    expect(() =>
      parseIntakeOracleCandidateEvidenceRequest({
        marketId: "market_seed_next_prime_minister",
        candidateEvidence: {
          ...CANDIDATE_EVIDENCE,
          sourceUrl: "javascript:alert(1)"
        }
      })
    ).toThrow("candidateEvidence.sourceUrl must be an HTTPS URL.");
    expect(() =>
      parseIntakeOracleCandidateEvidenceRequest({
        marketId: "market_seed_next_prime_minister",
        candidateEvidence: {
          ...CANDIDATE_EVIDENCE,
          sourceUrl: "http://example.com/result"
        }
      })
    ).toThrow("candidateEvidence.sourceUrl must be an HTTPS URL.");
    expect(() =>
      parseIntakeOracleCandidateEvidenceRequest({
        marketId: "market_seed_next_prime_minister",
        closeConditionSatisfied: "false",
        candidateEvidence: CANDIDATE_EVIDENCE
      })
    ).toThrow("closeConditionSatisfied must be a boolean when provided.");
    expect(() =>
      parseIntakeOracleCandidateEvidenceRequest({
        marketId: "market_seed_next_prime_minister",
        caseType: "unknown_case_type",
        candidateEvidence: CANDIDATE_EVIDENCE
      })
    ).toThrow("caseType must be one of: close_condition_check, resolution_check.");

    const request = parseIntakeOracleCandidateEvidenceRequest({
      marketId: " market_seed_next_prime_minister ",
      winningOutcomeKey: " ",
      closeConditionSatisfied: false,
      evidenceSummary: " Official evidence. ",
      reasonSummary: "",
      summary: null,
      ambiguityLevel: "high",
      requiresHumanReview: "false",
      reviewType: "conflicting_sources",
      reviewSeverity: "medium",
      reviewSummary: " Needs review. ",
      reviewNotes: " ",
      recommendedNextAction: "approve",
      resolvedAtObserved: " 2026-04-08T15:28:05.000Z ",
      persistResult: "false",
      candidateEvidence: CANDIDATE_EVIDENCE
    });

    expect(request).toMatchObject({
      marketId: "market_seed_next_prime_minister",
      caseType: "resolution_check",
      closeConditionSatisfied: false,
      winningOutcomeKey: null,
      evidenceSummary: "Official evidence.",
      reasonSummary: null,
      summary: null,
      ambiguityLevel: "high",
      requiresHumanReview: true,
      reviewType: "conflicting_sources",
      reviewSeverity: "medium",
      reviewSummary: "Needs review.",
      reviewNotes: null,
      recommendedNextAction: "approve",
      resolvedAtObserved: "2026-04-08T15:28:05.000Z",
      persistResult: true,
      candidateEvidence: {
        candidateEvidenceId: "oce_sig_1",
        signalId: "sig_1",
        sourceId: "src_reuters",
        sourceLabel: "Reuters",
        sourceUrl: "https://www.reuters.com/example",
        independentGroupId: "reuters",
        title: "Reuters report",
        summary: "Reuters reports the claim.",
        observedAt: "2026-04-08T15:28:05.000Z",
        configuredRoles: ["resolution_preferred", "close_condition_fallback"],
        authorityProfile: "credible_reporting",
        fetchReadiness: "planned",
        reviewReasons: ["Shared-source signal.", "Trusted source."]
      }
    });
  });

  it("preserves candidate approval parser guards and fields", () => {
    expect(() =>
      parseApproveOracleResolutionCandidateRequest({
        marketId: "market_seed_next_prime_minister",
        caseType: "close_condition_check",
        winningOutcomeKey: "option-a",
        approvalIdempotencyKey: "approve:1",
        candidateEvidence: CANDIDATE_EVIDENCE
      })
    ).toThrow("approve-resolution-candidate only supports resolution_check intake.");
    expect(() =>
      parseApproveOracleResolutionCandidateRequest({
        marketId: "market_seed_next_prime_minister",
        approvalIdempotencyKey: "approve:1",
        candidateEvidence: CANDIDATE_EVIDENCE
      })
    ).toThrow("approve-resolution-candidate requires winningOutcomeId or winningOutcomeKey.");
    expect(() =>
      parseApproveOracleResolutionCandidateRequest({
        marketId: "market_seed_next_prime_minister",
        winningOutcomeKey: "option-a",
        approvalIdempotencyKey: 123,
        candidateEvidence: CANDIDATE_EVIDENCE
      })
    ).toThrow("approvalIdempotencyKey must be a string.");

    const request = parseApproveOracleResolutionCandidateRequest({
      marketId: "market_seed_next_prime_minister",
      winningOutcomeKey: " option-a ",
      reviewNote: " ",
      approvalIdempotencyKey: " approve:1 ",
      candidateEvidence: CANDIDATE_EVIDENCE
    });

    expect(request).toMatchObject({
      winningOutcomeKey: "option-a",
      reviewNote: null,
      approvalIdempotencyKey: "approve:1"
    });
  });

  it("keeps missing source URL classified as not intakeable", () => {
    expect(() =>
      parseIntakeOracleCandidateEvidenceRequest({
        marketId: "market_seed_next_prime_minister",
        candidateEvidence: {
          ...CANDIDATE_EVIDENCE,
          sourceUrl: null
        }
      })
    ).toThrow(
      expect.objectContaining<Partial<OracleCandidateIntakeError>>({
        statusCode: 409,
        code: "candidate_not_intakeable",
        message: "Candidate evidence must have a source URL before Oracle intake."
      })
    );
  });
});
