import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseResolveMarketRequest } from "../../oracle/src/resolve-market-service";
import { parseExecuteOracleReviewActionRequest } from "../../oracle/src/review-action-requests";

async function readOracleSource(relativePath: string): Promise<string> {
  return readFile(join(process.cwd(), "..", "oracle", "src", relativePath), "utf8");
}

describe("oracle admin boundary Zod ownership", () => {
  it("keeps resolve and review-action request parsing on Oracle Zod helpers", async () => {
    const [resolveSource, reviewActionSource, helperSource] = await Promise.all([
      readOracleSource("resolve-market-service.ts"),
      readOracleSource("review-action-requests.ts"),
      readOracleSource("zod-request-body.ts")
    ]);

    for (const source of [resolveSource, reviewActionSource]) {
      expect(source).toContain("./zod-request-body");
      expect(source).not.toContain("function readTrimmedString");
    }

    expect(helperSource).toContain('from "zod"');
  });

  it("preserves Oracle resolve and review-action parser behavior", () => {
    expect(() => parseResolveMarketRequest([])).toThrow("Resolve request body must be an object.");
    expect(() =>
      parseResolveMarketRequest({
        winningOutcomeId: 123,
        triggerType: "oracle_proposal",
        resolutionSourceUrl: "https://example.com/result",
        resolutionNote: "Official result.",
        idempotencyKey: "resolve:1"
      })
    ).toThrow("winningOutcomeId must be a string.");
    expect(() =>
      parseResolveMarketRequest({
        winningOutcomeId: "outcome_a",
        triggerType: "oracle_proposal",
        resolutionNote: "Official result."
      })
    ).toThrow("resolutionSourceUrl is required.");
    expect(() =>
      parseResolveMarketRequest({
        winningOutcomeId: "outcome_a",
        triggerType: "oracle_proposal",
        resolutionSourceUrl: "javascript:alert(1)",
        resolutionNote: "Official result.",
        idempotencyKey: "resolve:1"
      })
    ).toThrow("resolutionSourceUrl must be an HTTPS URL.");
    expect(() =>
      parseResolveMarketRequest({
        winningOutcomeId: "outcome_a",
        triggerType: "oracle_proposal",
        resolutionSourceUrl: "http://example.com/result",
        resolutionNote: "Official result.",
        idempotencyKey: "resolve:1"
      })
    ).toThrow("resolutionSourceUrl must be an HTTPS URL.");
    expect(parseResolveMarketRequest({
      winningOutcomeId: " outcome_a ",
      triggerType: " oracle_proposal ",
      resolutionSourceUrl: " https://example.com/result ",
      resolutionNote: " Official result. ",
      oracleCaseId: " ",
      proposedByOracleId: "",
      approvedByHumanId: null,
      evidenceSnapshot: undefined,
      idempotencyKey: " resolve:1 "
    })).toMatchObject({
      winningOutcomeId: "outcome_a",
      triggerType: "oracle_proposal",
      resolutionSourceUrl: "https://example.com/result",
      resolutionNote: "Official result.",
      oracleCaseId: null,
      proposedByOracleId: null,
      approvedByHumanId: null,
      evidenceSnapshot: null,
      idempotencyKey: "resolve:1"
    });

    expect(() => parseExecuteOracleReviewActionRequest(null)).toThrow(
      "Review action body must be an object."
    );
    expect(() =>
      parseExecuteOracleReviewActionRequest({
        caseId: 123,
        action: "approve_resolution",
        idempotencyKey: "review:1"
      })
    ).toThrow("caseId must be a string.");
    expect(() =>
      parseExecuteOracleReviewActionRequest({
        action: "approve_resolution",
        idempotencyKey: "review:1"
      })
    ).toThrow("caseId is required.");
    expect(() =>
      parseExecuteOracleReviewActionRequest({
        caseId: "case_1",
        action: "approve_nothing",
        idempotencyKey: "review:1"
      })
    ).toThrow("action is invalid.");
    expect(parseExecuteOracleReviewActionRequest({
      caseId: " case_1 ",
      action: " approve_resolution ",
      reviewNote: " ",
      idempotencyKey: " review:1 "
    })).toMatchObject({
      caseId: "case_1",
      action: "approve_resolution",
      reviewNote: null,
      idempotencyKey: "review:1"
    });
  });
});
