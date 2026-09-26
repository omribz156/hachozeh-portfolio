import { describe, expect, it, vi } from "vitest";

import type { Queryable } from "../../../src/db/client/pool";
import { readOracleResolveInbox } from "../../../../oracle/src/resolve-inbox-service";

function buildRecommendedCaseRow() {
  return {
    oracle_case_id: "orc_nba_final_1",
    market_id: "disc-cm-nba-2026-05-03-raptors-cavaliers-game7",
    market_title: "מי תנצח במשחק 7: Toronto Raptors או Cleveland Cavaliers?",
    case_type: "resolution_check",
    market_status: "resolved",
    case_status: "recommended",
    ambiguity_level: "medium",
    summary: "Winner maps to Cleveland Cavaliers.",
    scheduled_close_at: new Date("2026-05-03T23:30:00.000Z"),
    created_at: new Date("2026-05-04T17:28:57.000Z"),
    updated_at: new Date("2026-05-04T17:28:57.000Z"),
    winning_outcome_id:
      "disc-cm-nba-2026-05-03-raptors-cavaliers-game7-cleveland-cavaliers",
    winning_outcome_label: "Cleveland Cavaliers",
    evidence_packet_id: "evp_nba_final_1",
    evidence_summary:
      "Official NBA final result: Cleveland Cavaliers 114, Toronto Raptors 102.",
    evidence_captured_at: new Date("2026-05-04T17:28:57.000Z"),
    close_condition_satisfied: null,
    sources_snapshot: [
      {
        sourceUrl: "https://www.nba.com/game/tor-vs-cle-0042500137"
      }
    ],
    output_id: "rrc_nba_final_1",
    output_type: "resolution_recommendation",
    output_snapshot: {
      objectType: "resolution_recommendation",
      winningOutcomeKey:
        "disc-cm-nba-2026-05-03-raptors-cavaliers-game7-cleveland-cavaliers"
    },
    source_policy_snapshot: {
      resolutionSourceIds: ["nba-official-game-page"],
      notes: ["resolve-role=Official final score"]
    }
  };
}

function buildReviewNeededCaseRow() {
  return {
    ...buildRecommendedCaseRow(),
    oracle_case_id: "orc_fx_review_needed_1",
    market_id: "disc-cm-front-sixpack-boi-usd-ils-3-70-2026-05-31",
    market_title: "האם שער הדולר היציג יהיה מעל 3.70 ₪ ב-31 במאי?",
    market_status: "closed",
    case_status: "review_needed",
    ambiguity_level: "high",
    summary:
      "Oracle inspected the market but could not map a winner confidently yet.",
    winning_outcome_id: null,
    winning_outcome_label: null,
    evidence_packet_id: "evp_fx_review_needed_1",
    evidence_summary: "Source bundle is not strong enough to map a winning outcome.",
    output_id: "ors_fx_review_needed_1",
    output_type: "oracle_review_signal",
    output_snapshot: {
      objectType: "oracle_review_signal",
      reviewType: "mapping_ambiguity"
    }
  };
}

function createDbWithCompletedReview() {
  return {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("where id = any")) {
        return {
          rows: [],
          rowCount: 0
        };
      }

      if (sql.includes("from markets m")) {
        return {
          rows: [],
          rowCount: 0
        };
      }

      if (sql.includes("from oracle_cases oc")) {
        if (values?.[0] === "review_needed") {
          return {
            rows: [],
            rowCount: 0
          };
        }

        return {
          rows: [buildRecommendedCaseRow()],
          rowCount: 1
        };
      }

      if (sql.includes("from oracle_case_reviews")) {
        expect(values).toEqual([["orc_nba_final_1"]]);

        return {
          rows: [
            {
              oracle_case_id: "orc_nba_final_1",
              id: "ocr_nba_final_1",
              review_action: "approve_resolution",
              result_status: "completed",
              resolution_id: "resolution_nba_final_1",
              completed_at: new Date("2026-05-04T17:34:18.231Z"),
              created_at: new Date("2026-05-04T17:34:17.900Z")
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
  } satisfies Queryable;
}

describe("oracle resolve inbox service", () => {
  it("does not keep approved resolution cases in the actionable inbox", async () => {
    const db = createDbWithCompletedReview();

    const result = await readOracleResolveInbox(db, {
      marketId: "disc-cm-nba-2026-05-03-raptors-cavaliers-game7"
    });

    expect(result).toMatchObject({
      objectType: "oracle_resolve_inbox",
      missingCaseCount: 0,
      recommendedCaseCount: 0,
      missingCases: [],
      recommendedCases: []
    });
  });

  it("treats closed markets as missing cases immediately even before expected resolution time", async () => {
    const seenSql: string[] = [];
    const db = {
      query: vi.fn(async (sql: string) => {
        seenSql.push(sql);

        if (sql.includes("from markets m")) {
          return {
            rows: [
              {
                market_id: "disc-fifa-england-argentina-2026-07-15-winner",
                market_title: "אנגליה נגד ארגנטינה",
                market_status: "closed",
                close_at: new Date("2026-07-15T19:00:00.000Z"),
                closed_at: new Date("2026-07-15T19:00:00.000Z"),
                resolution_source: "פיפ״א, עמוד המשחק הרשמי",
                resolution_rules: "Official final match winner.",
                market_contract: {
                  objectType: "market_contract_v1",
                  lifecycleFit: "event_full_cycle",
                  timeline: {
                    expectedResolutionAt: "2026-07-15T21:30:00.000Z"
                  },
                  resolutionSource: {
                    url: "https://www.fifa.com/en/match-centre/match/17/285023/289290/400021540"
                  }
                }
              }
            ],
            rowCount: 1
          };
        }

        if (sql.includes("from oracle_cases oc")) {
          return { rows: [], rowCount: 0 };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }

        throw new Error(`Unexpected query: ${sql}`);
      })
    } satisfies Queryable;

    const result = await readOracleResolveInbox(db);

    const missingCaseSql = seenSql.find((sql) => sql.includes("from markets m"));
    expect(result.missingCaseCount).toBe(1);
    expect(result.missingCases[0]).toMatchObject({
      marketId: "disc-fifa-england-argentina-2026-07-15-winner",
      expectedResolutionAt: "2026-07-15T21:30:00.000Z",
      nextAction: "create_resolution_case"
    });
    expect(missingCaseSql).not.toContain("expected_resolution_at::timestamptz <= now()");
    expect(missingCaseSql).not.toContain("oracle_confirmed_event_completion");
  });

  it("suggests fallback-resolution intake when the market contract permits it", async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("where id = any")) {
          return {
            rows: [],
            rowCount: 0
          };
        }

        if (sql.includes("from markets m")) {
          return {
            rows: [
              {
                market_id: "disc-cm-ifa-final",
                market_title: "גמר גביע המדינה",
                market_status: "closed",
                close_at: new Date("2026-05-26T20:00:00.000Z"),
                closed_at: new Date("2026-05-26T20:00:00.000Z"),
                resolution_source: "https://www.football.org.il/game/123",
                resolution_rules: "Official final score wins.",
                market_contract: {
                  objectType: "market_contract_v1",
                  measurementKind: "final_score",
                  resultShape: "multi_outcome",
                  oracleCapability: "supported_final_only",
                  trustDisplayUrl: "https://www.football.org.il/game/123",
                  allowFallbackResolution: true,
                  fallbackEvidenceStandard: "two_independent_reports",
                  lifecycleFit: "event_full_cycle",
                  timeline: {
                    expectedResolutionAt: "2026-05-26T22:30:00.000Z"
                  },
                  resolutionSource: {
                    sourceIds: ["src_ifa_fixtures_results"],
                    url: "https://www.football.org.il/game/123"
                  }
                }
              }
            ],
            rowCount: 1
          };
        }

        if (sql.includes("from oracle_cases oc")) {
          return { rows: [], rowCount: 0 };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected query: ${sql}`);
      })
    } satisfies Queryable;

    const result = await readOracleResolveInbox(db, {
      marketId: "disc-cm-ifa-final"
    });

    expect(result.missingCases[0]).toMatchObject({
      fallbackResolutionAllowed: true,
      fallbackEvidenceStandard: "two_independent_reports",
      primarySourceUrl: "https://www.football.org.il/game/123",
      lifecycleFit: "event_full_cycle",
      expectedResolutionAt: "2026-05-26T22:30:00.000Z"
    });
    expect(result.missingCases[0]?.suggestedCommand).toContain("--fallback-resolution true");
    expect(result.missingCases[0]?.suggestedCommand).toContain(
      "--fallback-evidence-standard two_independent_reports"
    );
  });

  it("keeps review-needed resolution cases visible in the inbox", async () => {
    const db = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes("where id = any")) {
          expect(values).toEqual([["disc-cm-front-sixpack-boi-usd-ils-3-70-2026-05-31"]]);

          return {
            rows: [
              {
                id: "disc-cm-front-sixpack-boi-usd-ils-3-70-2026-05-31"
              }
            ],
            rowCount: 1
          };
        }

        if (sql.includes("from markets m")) {
          return {
            rows: [],
            rowCount: 0
          };
        }

        if (sql.includes("from oracle_cases oc")) {
          return {
            rows: values?.[0] === "review_needed" ? [buildReviewNeededCaseRow()] : [],
            rowCount: values?.[0] === "review_needed" ? 1 : 0
          };
        }

        if (sql.includes("from oracle_case_reviews")) {
          expect(values).toEqual([["orc_fx_review_needed_1"]]);

          return {
            rows: [],
            rowCount: 0
          };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected query: ${sql}`);
      })
    } satisfies Queryable;

    const result = await readOracleResolveInbox(db, {
      marketId: "disc-cm-front-sixpack-boi-usd-ils-3-70-2026-05-31"
    });

    expect(result).toMatchObject({
      missingCaseCount: 0,
      recommendedCaseCount: 0,
      reviewNeededCaseCount: 1,
      reviewNeededCases: [
        {
          itemType: "review_needed_case",
          marketId: "disc-cm-front-sixpack-boi-usd-ils-3-70-2026-05-31",
          oracleCaseId: "orc_fx_review_needed_1",
          caseStatus: "review_needed",
          nextAction: "inspect_resolve_or_void"
        }
      ]
    });
    expect(result.reviewNeededCases[0]?.suggestedInspectCommand).toContain(
      "case-detail --case orc_fx_review_needed_1"
    );
    expect(result.reviewNeededCases[0]?.suggestedVoidCommand).toContain(
      "void-market --market disc-cm-front-sixpack-boi-usd-ils-3-70-2026-05-31"
    );
  });
});
