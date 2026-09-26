import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { Queryable } from "../../../src/db/client/pool";

import {
  inspectOracleMarket,
  OracleInspectionError
} from "../../../../oracle/src/inspect-market-service";

function createDb(options?: {
  marketStatus?: "draft" | "open" | "closed" | "resolved";
  marketContract?: unknown;
  outcomes?: Array<{
    id: string;
    label: string;
    isWinner?: boolean | null;
  }>;
}) {
  const outcomes = options?.outcomes ?? [
    {
      id: "market_seed_next_prime_minister_outcome_option_a",
      label: "מועמד א'",
      isWinner: null
    },
    {
      id: "market_seed_next_prime_minister_outcome_option_b",
      label: "מועמד ב'",
      isWinner: null
    }
  ];

  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("from markets")) {
        return {
          rows: [
            {
              id: "market_seed_next_prime_minister",
              status: options?.marketStatus ?? "closed",
              title: "מי יהיה ראש הממשלה הבא?",
              close_at: new Date("2026-06-22T20:00:00Z"),
              resolution_source: "Official results",
              resolution_rules: "Official final result wins.",
              oracle_source_policy: {
                preferredSourceIds: ["src_election_official"],
                resolutionSourceIds: ["src_election_official"],
                requiresHumanReviewOnSourceConflict: true
              },
              market_contract: options?.marketContract ?? {}
            }
          ],
          rowCount: 1
        };
      }

      if (sql.includes("from market_outcomes")) {
        return {
          rows: outcomes,
          rowCount: outcomes.length
        };
      }

      if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    })
  } satisfies Queryable;
}

describe("inspectOracleMarket", () => {
  it("emits an early-close recommendation when evidence confirms event completion", async () => {
    const db = createDb({
      marketStatus: "open"
    });

    const result = await inspectOracleMarket(db, {
      marketId: "market_seed_next_prime_minister",
      caseType: "close_condition_check",
      closeConditionSatisfied: true,
      sources: [
        {
          sourceUrl: "https://example.com/result",
          sourceLabel: "Official source",
          sourceType: "official",
          claimSummary: "Election result finalized."
        }
      ]
    });

    expect(result.output.objectType).toBe("early_close_recommendation");
    if (result.output.objectType === "early_close_recommendation") {
      expect(result.output.recommendedAction).toBe("close_now");
    }
  });

  it("emits a resolution recommendation when winner mapping is explicit", async () => {
    const db = createDb();

    const result = await inspectOracleMarket(db, {
      marketId: "market_seed_next_prime_minister",
      caseType: "resolution_check",
      winningOutcomeKey: "option-a",
      resolvedAtObserved: "2026-06-22T18:11:00Z",
      sources: [
        {
          sourceUrl: "https://example.com/result",
          sourceLabel: "Official source",
          sourceType: "official",
          claimSummary: "Candidate A won."
        }
      ]
    });

    expect(result.output.objectType).toBe("resolution_recommendation");
    expect(result.market.contractHints).toEqual({
      sourceRolePlan: {
        wake: [],
        ground: [],
        resolve: [],
        integrity: []
      },
      fetchNeeds: [],
      policyNotes: []
    });
    if (result.output.objectType === "resolution_recommendation") {
      expect(result.output.winningOutcomeKey).toBe("option-a");
    }
  });

  it("records fallback resolution policy on human-gated recommendations", async () => {
    const db = createDb();

    const result = await inspectOracleMarket(db, {
      marketId: "market_seed_next_prime_minister",
      caseType: "resolution_check",
      winningOutcomeKey: "option-a",
      requiresHumanReview: true,
      fallbackResolution: true,
      fallbackEvidenceStandard: "two_independent_reports",
      primarySourceUrl: "https://example.com/official",
      primaryFailureReason: "official source returned 403",
      sources: [
        {
          sourceUrl: "https://example.com/report-a",
          sourceLabel: "Report A",
          sourceType: "fallback_report",
          independentGroupId: "group-a",
          claimSummary: "Candidate A won."
        },
        {
          sourceUrl: "https://example.com/report-b",
          sourceLabel: "Report B",
          sourceType: "fallback_report",
          independentGroupId: "group-b",
          claimSummary: "Candidate A won."
        }
      ]
    });

    expect(result.evidencePacket.notes).toContain("fallback_resolution=true");
    expect(result.output.objectType).toBe("resolution_recommendation");
    if (result.output.objectType === "resolution_recommendation") {
      expect(result.output.fallbackPolicy).toEqual({
        evidenceStandard: "two_independent_reports",
        primarySourceUrl: "https://example.com/official",
        primaryFailureReason: "official source returned 403"
      });
      expect(result.output.requiresHumanReview).toBe(true);
    }
  });

  it("maps dynamic market outcome keys through contract evidence keys", async () => {
    const db = createDb({
      outcomes: [
        {
          id: "disc-cm-proof-yes",
          label: "כן",
          isWinner: null
        },
        {
          id: "disc-cm-proof-no",
          label: "לא",
          isWinner: null
        }
      ],
      marketContract: {
        objectType: "market_contract_v1",
        outcomeMap: [
          {
            evidenceKey: "yes",
            outcomeLabel: "כן"
          },
          {
            evidenceKey: "no",
            outcomeLabel: "לא"
          }
        ]
      }
    });

    const result = await inspectOracleMarket(db, {
      marketId: "market_seed_next_prime_minister",
      caseType: "resolution_check",
      winningOutcomeKey: "yes",
      sources: [
        {
          sourceUrl: "https://example.com/report",
          sourceLabel: "Credible source",
          sourceType: "credible_reporting",
          claimSummary: "Credible source reports yes."
        }
      ]
    });

    expect(result.market.outcomes).toEqual([
      expect.objectContaining({
        outcomeId: "disc-cm-proof-yes",
        outcomeKey: "yes"
      }),
      expect.objectContaining({
        outcomeId: "disc-cm-proof-no",
        outcomeKey: "no"
      })
    ]);
    expect(result.oracleCase.currentWinningOutcomeKey).toBe("yes");
  });

  it("emits a review signal when winner mapping is missing", async () => {
    const db = createDb();

    const result = await inspectOracleMarket(db, {
      marketId: "market_seed_next_prime_minister",
      caseType: "resolution_check",
      sources: [
        {
          sourceUrl: "https://example.com/result",
          sourceLabel: "Official source",
          sourceType: "official",
          claimSummary: "Result published, but winner mapping unclear."
        }
      ]
    });

    expect(result.output.objectType).toBe("oracle_review_signal");
  });

  it("rejects empty evidence bundles", async () => {
    const db = createDb();

    await expect(
      inspectOracleMarket(db, {
        marketId: "market_seed_next_prime_minister",
        caseType: "resolution_check",
        sources: []
      })
    ).rejects.toBeInstanceOf(OracleInspectionError);
  });

  it("persists oracle case memory when asked", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === "begin" || sql === "commit" || sql === "rollback") {
        return { rows: [], rowCount: 0 };
      }

      if (sql.includes("from markets")) {
        return {
          rows: [
            {
              id: "market_seed_next_prime_minister",
              status: "closed",
              title: "מי יהיה ראש הממשלה הבא?",
              close_at: new Date("2026-06-22T20:00:00Z"),
              resolution_source: "Official results",
              resolution_rules: "Official final result wins.",
              oracle_source_policy: {
                preferredSourceIds: ["src_election_official"],
                resolutionSourceIds: ["src_election_official"]
              }
            }
          ],
          rowCount: 1
        };
      }

      if (sql.includes("from market_outcomes")) {
        return {
          rows: [
            {
              id: "market_seed_next_prime_minister_outcome_option_a",
              label: "מועמד א'",
              is_winner: null
            },
            {
              id: "market_seed_next_prime_minister_outcome_option_b",
              label: "מועמד ב'",
              is_winner: null
            }
          ],
          rowCount: 2
        };
      }

      if (sql.includes("from oracle_cases oc") && sql.includes("oracle_evidence_packets")) {
        return {
          rows: [],
          rowCount: 0
        };
      }

      if (
        sql.includes("insert into oracle_cases") ||
        sql.includes("insert into oracle_evidence_packets") ||
        sql.includes("insert into oracle_case_outputs")
      ) {
        return {
          rows: [],
          rowCount: 1
        };
      }

      if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
    const pool = {
      query,
      connect: vi.fn(async () => ({
        query,
        release: vi.fn()
      }))
    } as unknown as Pool;

    const result = await inspectOracleMarket(
      pool,
      {
        marketId: "market_seed_next_prime_minister",
        caseType: "resolution_check",
        winningOutcomeKey: "option-a",
        sources: [
          {
            sourceUrl: "https://example.com/result",
            sourceLabel: "Official source",
            sourceType: "official",
            claimSummary: "Candidate A won."
          }
        ]
      },
      {
        persistResult: true
      }
    );

    expect(result.market.oracleSourcePolicy).toEqual({
      preferredSourceIds: ["src_election_official"],
      resolutionSourceIds: ["src_election_official"]
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("insert into oracle_cases"),
      expect.arrayContaining([
        result.oracleCase.oracleCaseId,
        "market_seed_next_prime_minister"
      ])
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("insert into oracle_case_outputs"),
      expect.arrayContaining([expect.any(String), result.oracleCase.oracleCaseId])
    );
  });

  it("replays an existing active persisted case instead of inserting a duplicate", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("from markets")) {
        return {
          rows: [
            {
              id: "market_seed_next_prime_minister",
              status: "open",
              title: "מי יהיה ראש הממשלה הבא?",
              close_at: new Date("2026-06-22T20:00:00Z"),
              resolution_source: "Official results",
              resolution_rules: "Official final result wins.",
              oracle_source_policy: {}
            }
          ],
          rowCount: 1
        };
      }

      if (sql.includes("from market_outcomes")) {
        return {
          rows: [
            {
              id: "market_seed_next_prime_minister_outcome_option_a",
              label: "מועמד א'",
              is_winner: null
            }
          ],
          rowCount: 1
        };
      }

      if (sql.includes("from oracle_cases oc") && sql.includes("oracle_evidence_packets")) {
        return {
          rows: [
            {
              oracle_case_id: "orc_existing",
              market_id: "market_seed_next_prime_minister",
              case_type: "close_condition_check",
              market_status: "open",
              case_status: "recommended",
              ambiguity_level: "low",
              summary: "Existing close case.",
              scheduled_close_at: new Date("2026-06-22T20:00:00Z"),
              current_winning_outcome_id: null,
              created_at: new Date("2026-06-22T18:00:00Z"),
              updated_at: new Date("2026-06-22T18:00:00Z"),
              evidence_packet_id: "evp_existing",
              evidence_summary: "Existing evidence.",
              sources_snapshot: [
                {
                  sourceUrl: "https://example.com/result",
                  sourceLabel: "Official source",
                  sourceType: "official",
                  claimSummary: "Event started.",
                  capturedAt: "2026-06-22T18:00:00.000Z"
                }
              ],
              captured_at: new Date("2026-06-22T18:00:00Z"),
              winning_outcome_id: null,
              close_condition_satisfied: true,
              notes: null,
              output_snapshot: {
                objectType: "early_close_recommendation",
                earlyCloseRecommendationId: "ecr_existing",
                oracleCaseId: "orc_existing",
                marketId: "market_seed_next_prime_minister",
                triggerType: "oracle_confirmed_event_completion",
                recommendedAction: "review_first",
                reasonSummary: "Existing evidence.",
                evidencePacketId: "evp_existing",
                requiresHumanReview: true,
                createdAt: "2026-06-22T18:00:00.000Z"
              }
            }
          ],
          rowCount: 1
        };
      }

      if (
        sql.includes("insert into oracle_cases") ||
        sql.includes("insert into oracle_evidence_packets") ||
        sql.includes("insert into oracle_case_outputs")
      ) {
        throw new Error("duplicate replay should not insert");
      }

      if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
    const pool = {
      query,
      connect: vi.fn(async () => ({
        query,
        release: vi.fn()
      }))
    } as unknown as Pool;

    const result = await inspectOracleMarket(
      pool,
      {
        marketId: "market_seed_next_prime_minister",
        caseType: "close_condition_check",
        closeConditionSatisfied: true,
        requiresHumanReview: true,
        sources: [
          {
            sourceUrl: "https://example.com/result",
            sourceLabel: "Official source",
            sourceType: "official",
            claimSummary: "Event started."
          }
        ]
      },
      {
        persistResult: true
      }
    );

    expect(result.oracleCase.oracleCaseId).toBe("orc_existing");
    expect(result.evidencePacket.evidencePacketId).toBe("evp_existing");
    expect(result.output).toMatchObject({
      objectType: "early_close_recommendation",
      earlyCloseRecommendationId: "ecr_existing"
    });
    expect(query).not.toHaveBeenCalledWith(
      expect.stringContaining("insert into oracle_cases"),
      expect.anything()
    );
  });
});
