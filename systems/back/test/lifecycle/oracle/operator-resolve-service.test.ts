import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import type { RequestActor } from "../../../src/auth/actor-resolver";
import {
  operatorResolveMarket,
  OracleOperatorResolveError
} from "../../../../oracle/src/operator-resolve-service";

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

const ACTOR: RequestActor = {
  actorId: "oracle_operator_1",
  mode: "session",
  sessionId: "oracle_operator_session",
  role: "admin"
};

function createDb(market?: Partial<{
  id: string;
  status: "draft" | "open" | "closed" | "resolved";
  title: string;
  category_key: string | null;
  resolution_source: string;
  created_by: string | null;
}>): Pool {
  return {
    query: vi.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes("from markets")) {
        return {
          rows: [
            {
              id: market?.id ?? params[0],
              status: market?.status ?? "closed",
              title: market?.title ?? "Stress engine market",
              category_key: market?.category_key ?? "stress",
              resolution_source: market?.resolution_source ?? "Synthetic stress runner",
              created_by: market?.created_by ?? "system_stress"
            }
          ],
          rowCount: 1
        };
      }

      if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    })
  } as unknown as Pool;
}

describe("operatorResolveMarket", () => {
  beforeEach(() => {
    inspectOracleMarketMock.mockReset();
    approveOracleResolutionCaseMock.mockReset();
  });

  it("creates an Oracle resolution case without approving by default", async () => {
    inspectOracleMarketMock.mockResolvedValue({
      objectType: "oracle_inspection_result",
      oracleCase: {
        oracleCaseId: "orc_operator_1"
      },
      output: {
        objectType: "resolution_recommendation",
        reasonSummary: "Synthetic winner selected by cleanup policy."
      }
    });

    const result = await operatorResolveMarket(createDb(), ACTOR, {
      marketId: "stress-engine-1",
      mode: "test",
      winningOutcomeId: "stress-engine-1_outcome_1",
      reasonSummary: "Synthetic winner selected by cleanup policy.",
      evidenceUrl: "local://operator-cleanup/stress-engine-1",
      evidenceLabel: "Operator cleanup note"
    });

    expect(inspectOracleMarketMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        marketId: "stress-engine-1",
        caseType: "resolution_check",
        winningOutcomeId: "stress-engine-1_outcome_1",
        requiresHumanReview: true,
        reviewType: null,
        reviewSeverity: null,
        recommendedNextAction: "inspect",
        sources: [
          expect.objectContaining({
            sourceUrl: "local://operator-cleanup/stress-engine-1",
            sourceType: "test_operator"
          })
        ]
      }),
      {
        persistResult: true
      }
    );
    expect(approveOracleResolutionCaseMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      objectType: "oracle_operator_resolve_result",
      mode: "test",
      nextAction: "review_case",
      approvalCommand: "npm --prefix systems/back run oracle -- approve-resolution-case --case orc_operator_1 --json"
    });
  });

  it("can explicitly approve through the existing trusted resolution path", async () => {
    inspectOracleMarketMock.mockResolvedValue({
      objectType: "oracle_inspection_result",
      oracleCase: {
        oracleCaseId: "orc_operator_2"
      },
      output: {
        objectType: "resolution_recommendation",
        reasonSummary: "Official source maps winner."
      }
    });
    approveOracleResolutionCaseMock.mockResolvedValue({
      objectType: "oracle_case_review_result",
      outcome: "approved_resolution",
      resolution: {
        status: "resolved"
      }
    });

    const result = await operatorResolveMarket(
      createDb({
        category_key: "sports",
        resolution_source: "Official league page",
        created_by: "seer"
      }),
      ACTOR,
      {
        marketId: "disc-cm-official-1",
        mode: "official",
        winningOutcomeKey: "home",
        reasonSummary: "Official source maps winner.",
        evidenceUrl: "https://example.com/final",
        evidenceLabel: "Official final page",
        approve: true,
        idempotencyKey: "operator-resolve-official-1"
      }
    );

    expect(inspectOracleMarketMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        requiresHumanReview: false,
        reviewType: null,
        reviewSeverity: null,
        recommendedNextAction: "approve",
        sources: [
          expect.objectContaining({
            sourceType: "official"
          })
        ]
      }),
      {
        persistResult: true
      }
    );
    expect(approveOracleResolutionCaseMock).toHaveBeenCalledWith(
      expect.anything(),
      "orc_operator_2",
      ACTOR,
      {
        reviewNote: "Official source maps winner.",
        idempotencyKey: "operator-resolve-official-1"
      }
    );
    expect(result.nextAction).toBe("resolved");
  });

  it("blocks test mode on non-test markets", async () => {
    await expect(
      operatorResolveMarket(
        createDb({
          category_key: "sports",
          resolution_source: "Official source",
          created_by: "seer"
        }),
        ACTOR,
        {
          marketId: "disc-cm-real-market",
          mode: "test",
          winningOutcomeKey: "home",
          reasonSummary: "Do not do this.",
          evidenceUrl: "local://bad",
          evidenceLabel: "Bad test evidence"
        }
      )
    ).rejects.toMatchObject<Partial<OracleOperatorResolveError>>({
      statusCode: 409,
      code: "market_not_test_like"
    });
    expect(inspectOracleMarketMock).not.toHaveBeenCalled();
  });

  it("blocks open markets before creating a resolution case", async () => {
    await expect(
      operatorResolveMarket(
        createDb({
          status: "open"
        }),
        ACTOR,
        {
          marketId: "stress-engine-open",
          mode: "test",
          winningOutcomeKey: "yes",
          reasonSummary: "Too early.",
          evidenceUrl: "local://too-early",
          evidenceLabel: "Too early"
        }
      )
    ).rejects.toMatchObject<Partial<OracleOperatorResolveError>>({
      statusCode: 409,
      code: "market_not_closed"
    });
    expect(inspectOracleMarketMock).not.toHaveBeenCalled();
  });
});
