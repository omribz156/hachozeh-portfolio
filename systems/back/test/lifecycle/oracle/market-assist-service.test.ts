import { describe, expect, it, vi } from "vitest";

import type { Queryable } from "../../../src/db/client/pool";
import {
  OracleMarketAssistError,
  readOracleMarketAssist
} from "../../../../oracle/src/market-assist-service";

function createDb() {
  return {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("from markets")) {
        if (values?.[0] === "market_live_custom") {
          return {
            rows: [
              {
                id: "market_live_custom",
                title: "Custom coalition market",
                status: "open",
                resolution_source: "official_custom_source",
                oracle_source_policy: {
                  closeConditionSourceIds: ["src_custom_close"],
                  resolutionSourceIds: ["src_custom_resolution"],
                  fallbackSourceIds: ["src_custom_fallback"],
                  requiresHumanReviewOnSourceConflict: true,
                  notes: ["Operator should cross-check coalition source."]
                }
              }
            ],
            rowCount: 1
          };
        }

        return {
          rows: [],
          rowCount: 0
        };
      }

      if (sql.includes("from market_outcomes")) {
        return {
          rows: [
            {
              id: "market_live_custom_outcome_candidate_blue",
              label: "Candidate Blue",
              short_label: "Blue",
              is_winner: null
            },
            {
              id: "market_live_custom_outcome_candidate_gold",
              label: "Candidate Gold",
              short_label: null,
              is_winner: null
            }
          ],
          rowCount: 2
        };
      }

      if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    })
  } satisfies Queryable;
}

describe("readOracleMarketAssist", () => {
  it("returns exact backend outcome keys for non-seeded markets", async () => {
    const db = createDb();

    const result = await readOracleMarketAssist(db, "market_live_custom", {
      caseType: "resolution_check"
    });

    expect(result).toMatchObject({
      objectType: "oracle_market_assist",
      marketId: "market_live_custom",
      canonicalMarketKey: null,
      requiresWinningOutcome: true,
      sourcePolicySummary: {
        configuredSourceCount: 3,
        closeConditionSourceCount: 1,
        resolutionSourceCount: 1,
        fallbackSourceCount: 1,
        requiresHumanReviewOnSourceConflict: true
      }
    });
    expect(result.outcomes).toEqual([
      expect.objectContaining({
        outcomeId: "market_live_custom_outcome_candidate_blue",
        outcomeKey: "market_live_custom_outcome_candidate_blue",
        label: "Candidate Blue",
        shortLabel: "Blue"
      }),
      expect.objectContaining({
        outcomeId: "market_live_custom_outcome_candidate_gold",
        outcomeKey: "market_live_custom_outcome_candidate_gold",
        label: "Candidate Gold",
        shortLabel: null
      })
    ]);
  });

  it("fails cleanly when market input is empty", async () => {
    const db = createDb();

    await expect(readOracleMarketAssist(db, "   ")).rejects.toMatchObject<
      Partial<OracleMarketAssistError>
    >({
      statusCode: 400,
      code: "invalid_request",
      message: "market is required."
    });
  });

  it("rejects invalid case type input instead of defaulting", async () => {
    const db = createDb();

    await expect(
      readOracleMarketAssist(db, "market_live_custom", {
        caseType: "close condition" as never
      })
    ).rejects.toMatchObject<Partial<OracleMarketAssistError>>({
      statusCode: 400,
      code: "invalid_request",
      message: "caseType must be one of: close_condition_check, resolution_check."
    });
  });
});
