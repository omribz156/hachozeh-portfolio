import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import type { RequestActor } from "../../../src/auth/actor-resolver";
import {
  approveOracleResolutionCandidate,
  intakeOracleCandidateEvidence,
  OracleCandidateIntakeError,
  parseIntakeOracleCandidateEvidenceRequest
} from "../../../../oracle/src/candidate-intake-service";
import { OracleInspectionError } from "../../../../oracle/src/inspect-market-service";

const {
  inspectOracleMarketMock,
  approveOracleResolutionCaseMock
} = vi.hoisted(() => ({
  inspectOracleMarketMock: vi.fn(),
  approveOracleResolutionCaseMock: vi.fn()
}));

vi.mock("../../../../oracle/src/inspect-market-service", async () => {
  const actual = await vi.importActual<typeof import("../../../../oracle/src/inspect-market-service")>(
    "../../../../oracle/src/inspect-market-service"
  );

  return {
    ...actual,
    inspectOracleMarket: inspectOracleMarketMock
  };
});

vi.mock("../../../../oracle/src/review-action-service", () => ({
  approveOracleResolutionCase: approveOracleResolutionCaseMock
}));

const ADMIN_ACTOR: RequestActor = {
  actorId: "user_admin_1",
  mode: "session",
  sessionId: "session_admin_1",
  role: "admin"
};

const DB_POOL = {} as Pool;

describe("oracle candidate intake service", () => {
  beforeEach(() => {
    inspectOracleMarketMock.mockReset();
    approveOracleResolutionCaseMock.mockReset();
  });

  it("promotes candidate evidence into an inspectable Oracle intake request", async () => {
    inspectOracleMarketMock.mockResolvedValue({
      objectType: "oracle_inspection_result"
    });

    await intakeOracleCandidateEvidence(DB_POOL, {
      marketId: "market_seed_next_prime_minister",
      caseType: "resolution_check",
      winningOutcomeKey: "option-a",
      candidateEvidence: {
        candidateEvidenceId: "oce_sig_1",
        signalId: "sig_1",
        sourceId: "src_gov_il_news",
        sourceLabel: "Gov.il",
        sourceUrl: "https://www.gov.il/en/departments/news",
        independentGroupId: "gov-il",
        title: "Candidate A sworn in",
        summary: "Official publication confirms swearing-in.",
        observedAt: "2026-04-08T15:28:05.000Z",
        configuredRoles: ["resolution_preferred"],
        authorityProfile: "official",
        fetchReadiness: "planned",
        normalizationStatus: "candidate_only",
        requiresHumanReview: true,
        reviewReasons: ["Shared-source signal has not been promoted yet."]
      }
    });

    expect(inspectOracleMarketMock).toHaveBeenCalledWith(
      DB_POOL,
      expect.objectContaining({
        marketId: "market_seed_next_prime_minister",
        caseType: "resolution_check",
        winningOutcomeKey: "option-a",
        requiresHumanReview: true,
        recommendedNextAction: "inspect",
        sources: [
          expect.objectContaining({
            sourceId: "src_gov_il_news",
            sourceUrl: "https://www.gov.il/en/departments/news",
            sourceLabel: "Gov.il",
            sourceType: "official",
            independentGroupId: "gov-il"
          })
        ]
      }),
      {
        persistResult: true
      }
    );
  });

  it("preserves source independence groups when parsing candidate intake bodies", () => {
    const request = parseIntakeOracleCandidateEvidenceRequest({
      marketId: "market_seed_next_prime_minister",
      caseType: "resolution_check",
      winningOutcomeKey: "option-a",
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
        configuredRoles: ["resolution_preferred"],
        authorityProfile: "credible_reporting",
        fetchReadiness: "unknown",
        normalizationStatus: "candidate_only",
        requiresHumanReview: true,
        reviewReasons: []
      }
    });

    expect(request.candidateEvidence.independentGroupId).toBe("reuters");
  });

  it("can approve a resolution candidate through intake plus trusted resolve handoff", async () => {
    inspectOracleMarketMock.mockResolvedValue({
      objectType: "oracle_inspection_result",
      oracleCase: {
        oracleCaseId: "orc_candidate_1"
      },
      output: {
        objectType: "resolution_recommendation",
        reasonSummary: "Candidate A won."
      }
    });
    approveOracleResolutionCaseMock.mockResolvedValue({
      objectType: "oracle_case_review_result",
      outcome: "approved_resolution"
    });

    const result = await approveOracleResolutionCandidate(DB_POOL, ADMIN_ACTOR, {
      marketId: "market_seed_next_prime_minister",
      caseType: "resolution_check",
      winningOutcomeKey: "option-a",
      reviewNote: "Approve the candidate path.",
      approvalIdempotencyKey: "oracle-approve-candidate-1",
      candidateEvidence: {
        candidateEvidenceId: "oce_sig_1",
        signalId: "sig_1",
        sourceId: "src_gov_il_news",
        sourceLabel: "Gov.il",
        sourceUrl: "https://www.gov.il/en/departments/news",
        title: "Candidate A sworn in",
        summary: "Official publication confirms swearing-in.",
        observedAt: "2026-04-08T15:28:05.000Z",
        configuredRoles: ["resolution_preferred"],
        authorityProfile: "official",
        fetchReadiness: "planned",
        normalizationStatus: "candidate_only",
        requiresHumanReview: true,
        reviewReasons: []
      }
    });

    expect(inspectOracleMarketMock).toHaveBeenCalledWith(
      DB_POOL,
      expect.objectContaining({
        requiresHumanReview: false
      }),
      {
        persistResult: true
      }
    );
    expect(approveOracleResolutionCaseMock).toHaveBeenCalledWith(
      DB_POOL,
      "orc_candidate_1",
      ADMIN_ACTOR,
      {
        reviewNote: "Approve the candidate path.",
        idempotencyKey: "oracle-approve-candidate-1"
      }
    );
    expect(result).toMatchObject({
      objectType: "oracle_candidate_resolution_approval_result",
      approval: {
        outcome: "approved_resolution"
      }
    });
  });

  it("reclassifies Oracle inspection domain failures into candidate intake errors", async () => {
    inspectOracleMarketMock.mockRejectedValue(
      new OracleInspectionError("Winning outcome key does not belong to market: rate-cut")
    );

    await expect(
      intakeOracleCandidateEvidence(DB_POOL, {
        marketId: "market_seed_1",
        caseType: "resolution_check",
        winningOutcomeKey: "rate-cut",
        candidateEvidence: {
          candidateEvidenceId: "oce_sig_bad_1",
          signalId: "sig_bad_1",
          sourceId: "src_boi_announcements",
          sourceLabel: "Bank of Israel announcements",
          sourceUrl: "https://www.boi.org.il/en/communication-and-publications/press-releases/",
          title: "Rate decision signal",
          summary: "Shared-source candidate mapped to a bad outcome key.",
          observedAt: "2026-04-12T10:00:00.000Z",
          configuredRoles: ["resolution_preferred"],
          authorityProfile: "official",
          fetchReadiness: "planned",
          normalizationStatus: "candidate_only",
          requiresHumanReview: true,
          reviewReasons: ["Probe invalid key"]
        }
      })
    ).rejects.toMatchObject<Partial<OracleCandidateIntakeError>>({
      statusCode: 409,
      code: "candidate_not_intakeable",
      message: "Winning outcome key does not belong to market: rate-cut"
    });
  });
});
