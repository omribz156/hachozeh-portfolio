import { describe, expect, it, vi } from "vitest";

import type { Queryable } from "../../../src/db/client/pool";
import {
  readOracleCaseDetail,
  readOracleCaseHistory,
  readOracleReviewQueue
} from "../../../../oracle/src/review-queue-service";

function createDb() {
  return {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("where oc.id = $1")) {
        expect(values).toEqual(["orc_detail_1"]);

        return {
          rows: [
            {
              oracle_case_id: "orc_detail_1",
              market_id: "market_seed_next_prime_minister",
              market_title: "מי יהיה ראש הממשלה הבא?",
              case_type: "resolution_check",
              market_status: "closed",
              case_status: "recommended",
              ambiguity_level: "low",
              summary: "Winner maps cleanly to Candidate A.",
              scheduled_close_at: new Date("2026-06-22T20:00:00.000Z"),
              created_at: new Date("2026-06-22T18:14:00.000Z"),
              updated_at: new Date("2026-06-22T18:14:30.000Z"),
              winning_outcome_id: "market_seed_next_prime_minister_outcome_option_a",
              winning_outcome_label: "מועמד א'",
              evidence_packet_id: "evp_detail_1",
              evidence_summary: "Official final result names Candidate A.",
              evidence_captured_at: new Date("2026-06-22T18:13:30.000Z"),
              close_condition_satisfied: null,
              sources_snapshot: [
                {
                  sourceId: "src_election_official",
                  sourceUrl: "https://example.com/result",
                  sourceLabel: "Election official",
                  sourceType: "official",
                  capturedAt: "2026-06-22T18:13:30.000Z",
                  claimSummary: "Official final result names Candidate A."
                }
              ],
              output_id: "rrc_detail_1",
              output_type: "resolution_recommendation",
              output_snapshot: {
                objectType: "resolution_recommendation",
                winningOutcomeKey: "option-a",
                reasonSummary: "Official result names Candidate A."
              },
              source_policy_snapshot: {
                preferredSourceIds: ["src_election_official"],
                resolutionSourceIds: ["src_election_official"],
                notes: ["resolve-role=Final certification"]
              }
            }
          ],
          rowCount: 1
        };
      }

      if (sql.includes("from oracle_case_reviews")) {
        if (values?.[0] === "orc_detail_1") {
          return {
            rows: [
              {
                id: "ocr_detail_1",
                review_action: "approve_resolution",
                result_status: "completed",
                actor_id: "user_admin_1",
                actor_role: "admin",
                review_note: "Human reviewed and approved.",
                idempotency_key: "oracle-approve-1",
                resolution_id: "resolution_1",
                resolve_response_snapshot: {
                  resolutionId: "resolution_1",
                  status: "resolved"
                },
                failure_code: null,
                failure_message: null,
                created_at: new Date("2026-06-22T18:15:00.000Z"),
                completed_at: new Date("2026-06-22T18:15:01.000Z"),
                failed_at: null
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

      if (sql.includes("where oc.case_status =")) {
        expect(values).toContain("review_needed");

        return {
          rows: [
            {
              oracle_case_id: "orc_review_1",
              market_id: "market_seed_next_prime_minister",
              market_title: "מי יהיה ראש הממשלה הבא?",
              case_type: "resolution_check",
              market_status: "closed",
              case_status: "review_needed",
              ambiguity_level: "high",
              summary: "Conflicting official and media source timing.",
              scheduled_close_at: new Date("2026-06-22T20:00:00.000Z"),
              created_at: new Date("2026-06-22T18:12:00.000Z"),
              updated_at: new Date("2026-06-22T18:13:00.000Z"),
              winning_outcome_id: null,
              winning_outcome_label: null,
              evidence_packet_id: "evp_review_1",
              evidence_summary: "Two sources disagree on whether the final certification is complete.",
              evidence_captured_at: new Date("2026-06-22T18:12:00.000Z"),
              close_condition_satisfied: null,
              sources_snapshot: [
                {
                  sourceUrl: "https://example.com/a"
                },
                {
                  sourceUrl: "https://example.com/b"
                }
              ],
              output_id: "ors_review_1",
              output_type: "oracle_review_signal",
              output_snapshot: {
                objectType: "oracle_review_signal",
                reviewType: "conflicting_sources",
                summary: "Need human review."
              },
              source_policy_snapshot: {
                preferredSourceIds: ["src_election_official"],
                resolutionSourceIds: ["src_election_official"],
                requiresHumanReviewOnSourceConflict: true,
                notes: [
                  "ground-role=Official tally board",
                  "resolve-role=Final certification",
                  "fetch-needed=official-pdf"
                ]
              }
            }
          ],
          rowCount: 1
        };
      }

      expect(sql).toContain("where oc.case_type =");
      expect(sql).toContain("oc.market_id =");
      expect(values).toContain("resolution_check");
      expect(values).toContain("market_seed_next_prime_minister");

      return {
        rows: [
          {
            oracle_case_id: "orc_history_1",
            market_id: "market_seed_next_prime_minister",
            market_title: "מי יהיה ראש הממשלה הבא?",
            case_type: "resolution_check",
            market_status: "closed",
            case_status: "recommended",
            ambiguity_level: "low",
            summary: "Winner maps cleanly to Candidate A.",
            scheduled_close_at: new Date("2026-06-22T20:00:00.000Z"),
            created_at: new Date("2026-06-22T18:14:00.000Z"),
            updated_at: new Date("2026-06-22T18:14:00.000Z"),
            winning_outcome_id: "market_seed_next_prime_minister_outcome_option_a",
            winning_outcome_label: "מועמד א'",
            evidence_packet_id: "evp_history_1",
            evidence_summary: "Official final result names Candidate A.",
            evidence_captured_at: new Date("2026-06-22T18:13:30.000Z"),
            close_condition_satisfied: null,
            sources_snapshot: [
              {
                sourceUrl: "https://example.com/result"
              }
            ],
            output_id: "rrc_history_1",
            output_type: "resolution_recommendation",
            output_snapshot: {
              objectType: "resolution_recommendation",
              winningOutcomeKey: "option-a",
              reasonSummary: "Official result names Candidate A."
            },
            source_policy_snapshot: {
              preferredSourceIds: ["src_election_official"],
              resolutionSourceIds: ["src_election_official"],
              notes: ["resolve-role=Final certification"]
            }
          }
        ],
        rowCount: 1
      };
    })
  } satisfies Queryable;
}

function createDbWithCompletedRecommendedCase() {
  return {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("where oc.case_status =")) {
        expect(values).toContain("recommended");

        return {
          rows: [
            {
              oracle_case_id: "orc_approved_nba",
              market_id: "disc-cm-nba-2026-05-03-raptors-cavaliers-game7",
              market_title: "מי תנצח במשחק 7: Toronto Raptors או Cleveland Cavaliers?",
              case_type: "resolution_check",
              market_status: "resolved",
              case_status: "recommended",
              ambiguity_level: "medium",
              summary: "Winner maps cleanly to Cleveland Cavaliers.",
              scheduled_close_at: new Date("2026-05-03T23:30:00.000Z"),
              created_at: new Date("2026-05-04T17:28:57.000Z"),
              updated_at: new Date("2026-05-04T17:28:57.000Z"),
              winning_outcome_id:
                "disc-cm-nba-2026-05-03-raptors-cavaliers-game7-cleveland-cavaliers",
              winning_outcome_label: "Cleveland Cavaliers",
              evidence_packet_id: "evp_approved_nba",
              evidence_summary: "Official NBA final result names Cleveland Cavaliers.",
              evidence_captured_at: new Date("2026-05-04T17:28:57.000Z"),
              close_condition_satisfied: null,
              sources_snapshot: [
                {
                  sourceUrl: "https://www.nba.com/game/tor-vs-cle-0042500137"
                }
              ],
              output_id: "rrc_approved_nba",
              output_type: "resolution_recommendation",
              output_snapshot: {
                objectType: "resolution_recommendation",
                winningOutcomeKey:
                  "disc-cm-nba-2026-05-03-raptors-cavaliers-game7-cleveland-cavaliers"
              },
              source_policy_snapshot: {
                resolutionSourceIds: ["src_nba_official_games"],
                notes: ["resolve-role=NBA official final game result"]
              }
            }
          ],
          rowCount: 1
        };
      }

      if (sql.includes("from oracle_case_reviews")) {
        expect(values).toEqual([["orc_approved_nba"]]);

        return {
          rows: [
            {
              oracle_case_id: "orc_approved_nba",
              id: "ocr_approved_nba",
              review_action: "approve_resolution",
              result_status: "completed",
              completed_at: new Date("2026-05-04T17:31:00.000Z"),
              created_at: new Date("2026-05-04T17:30:59.000Z")
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

function createDbWithTerminalCaseHistory() {
  const caseRows = [
    {
      oracle_case_id: "orc_clean_knicks",
      market_id: "disc-cm-nba-2026-05-04-76ers-knicks-game1",
      market_title: "מי תנצח במשחק 1: פילדלפיה סיקסרס או ניו יורק ניקס?",
      case_type: "resolution_check",
      market_status: "resolved",
      case_status: "recommended",
      ambiguity_level: "medium",
      summary: "Winner maps cleanly to New York Knicks.",
      scheduled_close_at: new Date("2026-05-05T00:00:00.000Z"),
      created_at: new Date("2026-05-05T18:30:00.000Z"),
      updated_at: new Date("2026-05-05T18:30:00.000Z"),
      winning_outcome_id: "disc-cm-nba-2026-05-04-76ers-knicks-game1-option-2",
      winning_outcome_label: "ניו יורק ניקס",
      evidence_packet_id: "evp_clean_knicks",
      evidence_summary: "Official NBA final result: Knicks 137, 76ers 98.",
      evidence_captured_at: new Date("2026-05-05T18:30:00.000Z"),
      close_condition_satisfied: null,
      sources_snapshot: [
        {
          sourceUrl: "https://www.nba.com/game/phi-vs-nyk-0042500211"
        }
      ],
      output_id: "rrc_clean_knicks",
      output_type: "resolution_recommendation",
      output_snapshot: {
        objectType: "resolution_recommendation",
        winningOutcomeKey: "disc-cm-nba-2026-05-04-76ers-knicks-game1-option-2"
      },
      source_policy_snapshot: {
        resolutionSourceIds: ["src_nba_official_games"]
      }
    },
    {
      oracle_case_id: "orc_bad_76ers",
      market_id: "disc-cm-nba-2026-05-04-76ers-knicks-game1",
      market_title: "מי תנצח במשחק 1: פילדלפיה סיקסרס או ניו יורק ניקס?",
      case_type: "resolution_check",
      market_status: "closed",
      case_status: "recommended",
      ambiguity_level: "medium",
      summary: "Winner was incorrectly mapped to 76ers.",
      scheduled_close_at: new Date("2026-05-05T00:00:00.000Z"),
      created_at: new Date("2026-05-05T18:28:00.000Z"),
      updated_at: new Date("2026-05-05T18:28:00.000Z"),
      winning_outcome_id: "disc-cm-nba-2026-05-04-76ers-knicks-game1-76ers",
      winning_outcome_label: "פילדלפיה סיקסרס",
      evidence_packet_id: "evp_bad_76ers",
      evidence_summary: "Official NBA final result: Knicks 137, 76ers 98.",
      evidence_captured_at: new Date("2026-05-05T18:28:00.000Z"),
      close_condition_satisfied: null,
      sources_snapshot: [
        {
          sourceUrl: "https://www.nba.com/game/phi-vs-nyk-0042500211"
        }
      ],
      output_id: "rrc_bad_76ers",
      output_type: "resolution_recommendation",
      output_snapshot: {
        objectType: "resolution_recommendation",
        winningOutcomeKey: "disc-cm-nba-2026-05-04-76ers-knicks-game1-76ers"
      },
      source_policy_snapshot: {
        resolutionSourceIds: ["src_nba_official_games"]
      }
    }
  ];

  return {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("from oracle_case_reviews")) {
        expect(values).toEqual([["orc_clean_knicks", "orc_bad_76ers"]]);

        return {
          rows: [
            {
              oracle_case_id: "orc_clean_knicks",
              id: "ocr_clean_knicks",
              review_action: "approve_resolution",
              result_status: "completed",
              completed_at: new Date("2026-05-05T19:12:25.000Z"),
              created_at: new Date("2026-05-05T19:12:25.000Z")
            },
            {
              oracle_case_id: "orc_bad_76ers",
              id: "ocr_bad_76ers",
              review_action: "reject_case",
              result_status: "completed",
              completed_at: new Date("2026-05-05T18:28:20.000Z"),
              created_at: new Date("2026-05-05T18:28:20.000Z")
            }
          ],
          rowCount: 2
        };
      }

      expect(sql).not.toContain("where oc.case_status =");
      expect(values).toContain("resolution_check");
      expect(values).toContain("disc-cm-nba-2026-05-04-76ers-knicks-game1");

      return {
        rows: caseRows,
        rowCount: caseRows.length
      };
    })
  } satisfies Queryable;
}

describe("oracle review queue service", () => {
  it("returns review-needed queue items by default", async () => {
    const db = createDb();

    const result = await readOracleReviewQueue(db);

    expect(result).toMatchObject({
      objectType: "oracle_review_queue",
      caseStatus: "review_needed",
      totalItems: 1
    });
    expect(result.items[0]).toMatchObject({
      oracleCaseId: "orc_review_1",
      marketId: "market_seed_next_prime_minister",
      caseStatus: "review_needed",
      ambiguityLevel: "high",
      sourcePolicy: {
        preferredSourceIds: ["src_election_official"],
        resolutionSourceIds: ["src_election_official"],
        requiresHumanReviewOnSourceConflict: true,
        notes: [
          "ground-role=Official tally board",
          "resolve-role=Final certification",
          "fetch-needed=official-pdf"
        ]
      },
      contractHints: {
        sourceRolePlan: {
          wake: [],
          ground: ["Official tally board"],
          resolve: ["Final certification"],
          integrity: []
        },
        fetchNeeds: ["official-pdf"],
        policyNotes: []
      },
      evidencePacket: {
        evidencePacketId: "evp_review_1",
        sourceCount: 2
      },
      output: {
        outputId: "ors_review_1",
        outputType: "oracle_review_signal"
      }
    });
  });

  it("returns per-market case history with filters", async () => {
    const db = createDb();

    const result = await readOracleCaseHistory(
      db,
      "market_seed_next_prime_minister",
      {
        caseStatus: "all",
        caseType: "resolution_check",
        limit: 5
      }
    );

    expect(result).toMatchObject({
      objectType: "oracle_case_history",
      marketId: "market_seed_next_prime_minister",
      totalItems: 1
    });
    expect(result.items[0]).toMatchObject({
      oracleCaseId: "orc_history_1",
      caseStatus: "recommended",
      winningOutcomeLabel: "מועמד א'",
      contractHints: {
        sourceRolePlan: {
          wake: [],
          ground: [],
          resolve: ["Final certification"],
          integrity: []
        }
      },
      output: {
        outputType: "resolution_recommendation"
      }
    });
  });

  it("does not show completed recommended cases as actionable queue items", async () => {
    const db = createDbWithCompletedRecommendedCase();

    const result = await readOracleReviewQueue(db, {
      caseStatus: "recommended",
      caseType: "resolution_check",
      marketId: "disc-cm-nba-2026-05-03-raptors-cavaliers-game7"
    });

    expect(result).toMatchObject({
      objectType: "oracle_review_queue",
      caseStatus: "recommended",
      totalItems: 0,
      items: []
    });
  });

  it("shows effective terminal status in the all queue instead of stale recommended status", async () => {
    const db = createDbWithTerminalCaseHistory();

    const result = await readOracleReviewQueue(db, {
      caseStatus: "all",
      caseType: "resolution_check",
      marketId: "disc-cm-nba-2026-05-04-76ers-knicks-game1"
    });

    expect(result).toMatchObject({
      objectType: "oracle_review_queue",
      caseStatus: "all",
      totalItems: 2
    });
    expect(result.items).toEqual([
      expect.objectContaining({
        oracleCaseId: "orc_clean_knicks",
        caseStatus: "approved_resolution",
        storedCaseStatus: "recommended",
        terminalReview: expect.objectContaining({
          reviewId: "ocr_clean_knicks",
          reviewAction: "approve_resolution"
        }),
        winningOutcomeLabel: "ניו יורק ניקס"
      }),
      expect.objectContaining({
        oracleCaseId: "orc_bad_76ers",
        caseStatus: "rejected",
        storedCaseStatus: "recommended",
        terminalReview: expect.objectContaining({
          reviewId: "ocr_bad_76ers",
          reviewAction: "reject_case"
        }),
        winningOutcomeLabel: "פילדלפיה סיקסרס"
      })
    ]);
  });

  it("returns full case detail with evidence sources and output snapshot", async () => {
    const db = createDb();

    const result = await readOracleCaseDetail(db, "orc_detail_1");

    expect(result).toMatchObject({
      objectType: "oracle_case_detail",
      item: {
        oracleCaseId: "orc_detail_1",
        caseStatus: "approved_resolution",
        storedCaseStatus: "recommended",
        terminalReview: expect.objectContaining({
          reviewId: "ocr_detail_1",
          reviewAction: "approve_resolution"
        }),
        winningOutcomeId: "market_seed_next_prime_minister_outcome_option_a",
        winningOutcomeLabel: "מועמד א'",
        contractHints: {
          sourceRolePlan: {
            wake: [],
            ground: [],
            resolve: ["Final certification"],
            integrity: []
          },
          fetchNeeds: [],
          policyNotes: []
        }
      },
      evidenceSources: [
        {
          sourceId: "src_election_official",
          sourceLabel: "Election official",
          claimSummary: "Official final result names Candidate A."
        }
      ],
      outputSnapshot: {
        objectType: "resolution_recommendation",
        winningOutcomeKey: "option-a"
      },
      reviewHistory: [
        {
          reviewId: "ocr_detail_1",
          reviewAction: "approve_resolution",
          resultStatus: "completed",
          actorId: "user_admin_1",
          resolutionId: "resolution_1"
        }
      ]
    });
  });
});
