import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import {
  clearMarketDetailPassiveRecordCacheForTest,
  readDbBackedMarketDetailPassiveRecord
} from "../../src/db/read-models/market-detail-passive";

const MARKET_CONTRACT_V1 = {
  objectType: "market_contract_v1",
  version: "seer-contract-v1",
  measurement: "Official coalition mandate result.",
  resolutionSource: {
    label: "Official election result",
    url: "https://example.test/election"
  },
  resolutionRule: "Resolves to the official published coalition mandate result.",
  timeline: {
    closeShape: "scheduled-close",
    closeAt: "2026-06-22T18:00:00.000Z",
    timezone: "UTC"
  },
  outcomeMap: [
    {
      outcomeLabel: "מועמד א'",
      resolutionPath: "Wins official mandate."
    },
    {
      outcomeLabel: "מועמד ב'",
      resolutionPath: "Wins official mandate."
    }
  ],
  delayPolicy: "If delayed, market remains pending until the official source updates."
};

function createPool() {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("count(distinct m.id)::text")) {
        return {
          rowCount: 1,
          rows: [
            {
              child_count: "1",
              max_state_version: "12",
              max_updated_at: new Date("2026-03-29T09:00:00.000Z")
            }
          ]
        };
      }

      if (sql.includes("select event_id") && sql.includes("from markets")) {
        return {
          rowCount: 1,
          rows: [{ event_id: "evt_market_seed_next_prime_minister" }]
        };
      }

      if (sql.includes("from events e")) {
        return {
          rowCount: 0,
          rows: []
        };
      }

      if (sql.includes("market_family_key =")) {
        return {
          rowCount: 0,
          rows: []
        };
      }

      if (sql.includes("from trades")) {
        return {
          rowCount: 0,
          rows: []
        };
      }

      if (sql.includes("from lifecycle_events") && !sql.includes("from markets m")) {
        return {
          rowCount: 1,
          rows: [
            {
              id: "meu_source_lag",
              event_type: "official_source_not_ready",
              source_system: "oracle",
              actor_id: "system:oracle-lifecycle",
              occurred_at: new Date("2026-06-22T19:00:00.000Z"),
              oracle_case_id: null,
              payload: {
                summary: "Official source is not final yet after the expected resolution time.",
                sourceUrl: "javascript:alert(1)",
                sourceLabel: "Official election result"
              }
            }
          ]
        };
      }

      return {
        rowCount: 4,
        rows: [
          {
            market_id: "market_seed_next_prime_minister",
            market_status: "open",
            title: "מי יהיה ראש הממשלה הבא?",
            description: "שוק backend",
            category_key: "politics",
            market_family_key: null,
            event_id: "evt_market_seed_next_prime_minister",
            open_at: new Date("2026-03-01T08:00:00.000Z"),
            close_at: new Date("2026-06-22T18:00:00.000Z"),
            market_state_version: "12",
            updated_at: new Date("2026-03-29T09:00:00.000Z"),
            outcome_id: "market_seed_next_prime_minister_outcome_option_a",
            short_label: "מועמד א'",
            label: "מועמד א'",
            sort_order: 0,
            last_price: "0.25000000",
            resolution_source: "Official election result",
            resolution_rules: "Resolves to the official published coalition mandate result.",
            market_contract: MARKET_CONTRACT_V1,
            oracle_source_policy: {
              contextSourceIds: ["src_market_launch_wire"],
              resolutionSourceIds: ["src_election_official"],
              requiresHumanReviewOnSourceConflict: true,
              notes: [
                "wake-role=Coalition negotiations",
                "ground-role=Central Elections Committee",
                "resolve-role=Official government mandate notice"
              ]
            }
          },
          {
            market_id: "market_seed_next_prime_minister",
            market_status: "open",
            title: "מי יהיה ראש הממשלה הבא?",
            description: "שוק backend",
            category_key: "politics",
            market_family_key: null,
            event_id: "evt_market_seed_next_prime_minister",
            open_at: new Date("2026-03-01T08:00:00.000Z"),
            close_at: new Date("2026-06-22T18:00:00.000Z"),
            market_state_version: "12",
            updated_at: new Date("2026-03-29T09:00:00.000Z"),
            outcome_id: "market_seed_next_prime_minister_outcome_option_b",
            short_label: "מועמד ב'",
            label: "מועמד ב'",
            sort_order: 1,
            last_price: "0.25000000",
            resolution_source: "Official election result",
            resolution_rules: "Resolves to the official published coalition mandate result.",
            market_contract: MARKET_CONTRACT_V1,
            oracle_source_policy: {
              contextSourceIds: ["src_market_launch_wire"],
              resolutionSourceIds: ["src_election_official"],
              requiresHumanReviewOnSourceConflict: true,
              notes: [
                "wake-role=Coalition negotiations",
                "ground-role=Central Elections Committee",
                "resolve-role=Official government mandate notice"
              ]
            }
          },
          {
            market_id: "market_seed_next_prime_minister",
            market_status: "open",
            title: "מי יהיה ראש הממשלה הבא?",
            description: "שוק backend",
            category_key: "politics",
            market_family_key: null,
            open_at: new Date("2026-03-01T08:00:00.000Z"),
            close_at: new Date("2026-06-22T18:00:00.000Z"),
            market_state_version: "12",
            updated_at: new Date("2026-03-29T09:00:00.000Z"),
            outcome_id: "market_seed_next_prime_minister_outcome_option_c",
            short_label: null,
            label: "מועמד ג'",
            sort_order: 2,
            last_price: "0.25000000",
            resolution_source: "Official election result",
            resolution_rules: "Resolves to the official published coalition mandate result.",
            market_contract: MARKET_CONTRACT_V1,
            oracle_source_policy: {
              contextSourceIds: ["src_market_launch_wire"],
              resolutionSourceIds: ["src_election_official"],
              requiresHumanReviewOnSourceConflict: true,
              notes: [
                "wake-role=Coalition negotiations",
                "ground-role=Central Elections Committee",
                "resolve-role=Official government mandate notice"
              ]
            }
          },
          {
            market_id: "market_seed_next_prime_minister",
            market_status: "open",
            title: "מי יהיה ראש הממשלה הבא?",
            description: "שוק backend",
            category_key: "politics",
            market_family_key: null,
            open_at: new Date("2026-03-01T08:00:00.000Z"),
            close_at: new Date("2026-06-22T18:00:00.000Z"),
            market_state_version: "12",
            updated_at: new Date("2026-03-29T09:00:00.000Z"),
            outcome_id: "market_seed_next_prime_minister_outcome_option_d",
            short_label: "מועמד ד'",
            label: "מועמד ד'",
            sort_order: 3,
            last_price: "0.25000000",
            resolution_source: "Official election result",
            resolution_rules: "Resolves to the official published coalition mandate result.",
            market_contract: MARKET_CONTRACT_V1,
            oracle_source_policy: {
              contextSourceIds: ["src_market_launch_wire"],
              resolutionSourceIds: ["src_election_official"],
              requiresHumanReviewOnSourceConflict: true,
              notes: [
                "wake-role=Coalition negotiations",
                "ground-role=Central Elections Committee",
                "resolve-role=Official government mandate notice"
              ]
            }
          }
        ]
      };
    })
  } as unknown as Pool;
}

describe("market detail passive read-model", () => {
  beforeEach(() => {
    clearMarketDetailPassiveRecordCacheForTest();
  });

  it("adds explicit outcome labels for db-backed passive reads", async () => {
    const record = await readDbBackedMarketDetailPassiveRecord(
      createPool(),
      "next-prime-minister"
    );

    expect(record?.snapshot.tradingMode).toBe("contract_side");
    expect(record?.snapshot.outcomes).toEqual([
      {
        id: "option-a",
        key: "option-a",
        label: "מועמד א'",
        shortLabel: "מועמד א'"
      },
      {
        id: "option-b",
        key: "option-b",
        label: "מועמד ב'",
        shortLabel: "מועמד ב'"
      },
      {
        id: "option-c",
        key: "option-c",
        label: "מועמד ג'",
        shortLabel: "מועמד ג'"
      },
      {
        id: "option-d",
        key: "option-d",
        label: "מועמד ד'",
        shortLabel: "מועמד ד'"
      }
    ]);
    expect(record?.snapshot.marketStatus).toBe("open");
    expect(record?.snapshot.trust).toMatchObject({
      resolutionSource: "Official election result",
      sourceUrl: "https://example.test/election",
      resolutionRules: "Resolves to the official published coalition mandate result.",
      sourceRolePlan: {
        wake: ["Coalition negotiations"],
        ground: ["Central Elections Committee"],
        resolve: ["Official government mandate notice"]
      },
      sourcePolicySummary: {
        contextSourceCount: 1,
        resolutionSourceCount: 1,
        requiresHumanReviewOnSourceConflict: true
      }
    });
    expect(record?.snapshot.contract).toMatchObject({
      objectType: "market_contract_v1",
      delayPolicy: "If delayed, market remains pending until the official source updates.",
      timeline: {
        closeAt: "2026-06-22T18:00:00.000Z"
      }
    });
    expect(record?.snapshot.eventUpdates).toEqual([
      {
        id: "meu_source_lag",
        eventType: "official_source_not_ready",
        tier: "system_status",
        summary: "Official source is not final yet after the expected resolution time.",
        sourceUrl: null,
        sourceLabel: "Official election result",
        observedAt: "2026-06-22T19:00:00.000Z",
        createdBy: "oracle-lifecycle",
        linksToCaseId: null
      }
    ]);
  });

  it("hydrates per-outcome team colors on sports market-detail reads", async () => {
    const sportsContract = {
      objectType: "market_contract_v1",
      resultShape: "home_away_winner",
      resolutionSource: {
        sourceIds: ["src_winner_league_basketball"]
      }
    };
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("select event_id") && sql.includes("from markets")) {
          return {
            rowCount: 1,
            rows: [{ event_id: null }]
          };
        }

        if (sql.includes("from events e")) {
          return {
            rowCount: 0,
            rows: []
          };
        }

        if (sql.includes("market_family_key =") || sql.includes("from trades")) {
          return {
            rowCount: 0,
            rows: []
          };
        }

        return {
          rowCount: 3,
          rows: [
            {
              market_id: "winner-league-matchup",
              market_status: "open",
              persisted_status: "open",
              title: "מי תנצח: מכבי ת״א או הפועל ירושלים?",
              description: "שוק ספורט",
              category_key: "sports",
              market_family_key: null,
              event_id: null,
              open_at: new Date("2026-04-12T08:00:00.000Z"),
              close_at: new Date("2026-04-18T18:00:00.000Z"),
              published_at: new Date("2026-04-12T08:30:00.000Z"),
              liquidity_b: "100.00000000",
              settlement_status: null,
              market_resolved_at: null,
              market_state_version: "3",
              updated_at: new Date("2026-04-12T09:00:00.000Z"),
              outcome_id: "winner-league-matchup-maccabi",
              short_label: "מכבי ת״א",
              label: "מכבי ת״א",
              sort_order: 0,
              last_price: "0.57000000",
              winning_outcome_id: null,
              winning_outcome_label: null,
              resolution_source: "Winner League official result",
              resolution_rules: "Official result decides.",
              oracle_source_policy: null,
              market_contract: sportsContract,
              resolution_source_url: null,
              resolution_note: null,
              resolution_resolved_at: null
            },
            {
              market_id: "winner-league-matchup",
              market_status: "open",
              persisted_status: "open",
              title: "מי תנצח: מכבי ת״א או הפועל ירושלים?",
              description: "שוק ספורט",
              category_key: "sports",
              market_family_key: null,
              event_id: null,
              open_at: new Date("2026-04-12T08:00:00.000Z"),
              close_at: new Date("2026-04-18T18:00:00.000Z"),
              published_at: new Date("2026-04-12T08:30:00.000Z"),
              liquidity_b: "100.00000000",
              settlement_status: null,
              market_resolved_at: null,
              market_state_version: "3",
              updated_at: new Date("2026-04-12T09:00:00.000Z"),
              outcome_id: "winner-league-matchup-hapoel",
              short_label: "הפועל ירושלים",
              label: "הפועל ירושלים",
              sort_order: 1,
              last_price: "0.43000000",
              winning_outcome_id: null,
              winning_outcome_label: null,
              resolution_source: "Winner League official result",
              resolution_rules: "Official result decides.",
              oracle_source_policy: null,
              market_contract: sportsContract,
              resolution_source_url: null,
              resolution_note: null,
              resolution_resolved_at: null
            },
            {
              market_id: "winner-league-matchup",
              market_status: "open",
              persisted_status: "open",
              title: "מי תנצח: מכבי ת״א או הפועל ירושלים?",
              description: "שוק ספורט",
              category_key: "sports",
              market_family_key: null,
              event_id: null,
              open_at: new Date("2026-04-12T08:00:00.000Z"),
              close_at: new Date("2026-04-18T18:00:00.000Z"),
              published_at: new Date("2026-04-12T08:30:00.000Z"),
              liquidity_b: "100.00000000",
              settlement_status: null,
              market_resolved_at: null,
              market_state_version: "3",
              updated_at: new Date("2026-04-12T09:00:00.000Z"),
              outcome_id: "winner-league-matchup-draw",
              short_label: "תיקו",
              label: "תיקו",
              sort_order: 2,
              last_price: "0.10000000",
              winning_outcome_id: null,
              winning_outcome_label: null,
              resolution_source: "Winner League official result",
              resolution_rules: "Official result decides.",
              oracle_source_policy: null,
              market_contract: sportsContract,
              resolution_source_url: null,
              resolution_note: null,
              resolution_resolved_at: null
            }
          ]
        };
      })
    } as unknown as Pool;

    const record = await readDbBackedMarketDetailPassiveRecord(pool, "winner-league-matchup");

    expect(record?.snapshot.outcomes).toEqual([
      expect.objectContaining({
        id: "winner-league-matchup-maccabi",
        label: "מכבי ת״א",
        colorPrimary: "#FFF100",
        colorOn: "#161616"
      }),
      expect.objectContaining({
        id: "winner-league-matchup-hapoel",
        label: "הפועל ירושלים",
        colorPrimary: "#E2231A",
        colorOn: "#ffffff"
      }),
      expect.objectContaining({
        id: "winner-league-matchup-draw",
        label: "תיקו",
        colorPrimary: "#94A3B8",
        colorOn: "#0F172A"
      })
    ]);
  });

  it("caches expensive market-detail assembly while market version is stable", async () => {
    const pool = createPool();

    await readDbBackedMarketDetailPassiveRecord(pool, "next-prime-minister");
    await readDbBackedMarketDetailPassiveRecord(pool, "next-prime-minister");

    const query = vi.mocked(pool.query);
    const tradeReads = query.mock.calls.filter(([sql]) =>
      String(sql).includes("from trades")
    );

    expect(tradeReads).toHaveLength(1);
  });

  it("keeps raw market and outcome ids usable for non-seeded published markets", async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("select event_id") && sql.includes("from markets")) {
          return {
            rowCount: 1,
            rows: [{ event_id: null }]
          };
        }

        if (sql.includes("from events e")) {
          return {
            rowCount: 0,
            rows: []
          };
        }

        if (sql.includes("market_family_key =") || sql.includes("from trades")) {
          return {
            rowCount: 0,
            rows: []
          };
        }

        return {
          rowCount: 2,
          rows: [
            {
              market_id: "budget-vote-0f2a9c1d",
              market_status: "open",
              title: "האם התקציב יעבור השבוע?",
              description: "שוק backend",
              category_key: "politics",
              market_family_key: null,
              open_at: new Date("2026-04-10T08:00:00.000Z"),
              close_at: new Date("2026-04-18T18:00:00.000Z"),
              market_state_version: "3",
              updated_at: new Date("2026-04-12T09:00:00.000Z"),
              outcome_id: "budget-vote-0f2a9c1d-outcome-yes",
              short_label: "כן",
              label: "כן",
              sort_order: 0,
              last_price: "0.62000000",
              resolution_source: "Official budget vote result",
              resolution_rules: "Resolves to the official Knesset vote result.",
              oracle_source_policy: null
            },
            {
              market_id: "budget-vote-0f2a9c1d",
              market_status: "open",
              title: "האם התקציב יעבור השבוע?",
              description: "שוק backend",
              category_key: "politics",
              market_family_key: null,
              open_at: new Date("2026-04-10T08:00:00.000Z"),
              close_at: new Date("2026-04-18T18:00:00.000Z"),
              market_state_version: "3",
              updated_at: new Date("2026-04-12T09:00:00.000Z"),
              outcome_id: "budget-vote-0f2a9c1d-outcome-no",
              short_label: "לא",
              label: "לא",
              sort_order: 1,
              last_price: "0.38000000",
              resolution_source: "Official budget vote result",
              resolution_rules: "Resolves to the official Knesset vote result.",
              oracle_source_policy: null
            }
          ]
        };
      })
    } as unknown as Pool;

    const record = await readDbBackedMarketDetailPassiveRecord(
      pool,
      "budget-vote-0f2a9c1d"
    );

    expect(record?.snapshot.outcomes).toEqual([
      {
        id: "budget-vote-0f2a9c1d-outcome-yes",
        key: "budget-vote-0f2a9c1d-outcome-yes",
        label: "כן",
        shortLabel: "כן"
      },
      {
        id: "budget-vote-0f2a9c1d-outcome-no",
        key: "budget-vote-0f2a9c1d-outcome-no",
        label: "לא",
        shortLabel: "לא"
      }
    ]);
    expect(record?.snapshot.current).toEqual({
      "budget-vote-0f2a9c1d-outcome-yes": 0.62,
      "budget-vote-0f2a9c1d-outcome-no": 0.38
    });
    expect(record?.snapshot.trust).toMatchObject({
      resolutionSource: "Official budget vote result",
      resolutionRules: "Resolves to the official Knesset vote result."
    });
  });

  it("builds sibling market chain from persisted family keys", async () => {
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes("count(distinct m.id)::text")) {
          return {
            rowCount: 1,
            rows: [
              {
                child_count: "1",
                max_state_version: "0",
                max_updated_at: new Date("2026-04-16T12:00:07.198Z")
              }
            ]
          };
        }

        if (sql.includes("select event_id") && sql.includes("from markets")) {
          return {
            rowCount: 1,
            rows: [{ event_id: null }]
          };
        }

        if (sql.includes("from events e")) {
          return {
            rowCount: 0,
            rows: []
          };
        }

        if (sql.includes("market_family_key =")) {
          expect(values).toEqual([
            "boi-rate-decision-v1",
            "disc-cm-boi-rate-decision-july-6-2026-v2"
          ]);
          expect(sql).toContain("local://operator-clean-platform/%");
          expect(sql).toContain("contract-test");
          expect(sql).toContain("gauntlet");
          expect(sql).toContain("Asia/Jerusalem");
          expect(sql).toContain("current_market");
          expect(sql).toContain("measurementKind");
          expect(sql).toContain("measurement-date-local");

          return {
            rowCount: 2,
            rows: [
              {
                market_id: "disc-cm-boi-rate-decision-may-25-2026-v2",
                status: "resolved",
                close_at: new Date("2026-05-25T16:00:00.000Z"),
                label_at: new Date("2026-05-25T00:00:00.000Z")
              },
              {
                market_id: "disc-cm-boi-rate-decision-july-6-2026-v2",
                status: "open",
                close_at: new Date("2026-07-06T16:00:00.000Z"),
                label_at: new Date("2026-07-06T00:00:00.000Z")
              }
            ]
          };
        }

        if (sql.includes("from trades")) {
          return {
            rowCount: 0,
            rows: []
          };
        }

        return {
          rowCount: 2,
          rows: [
            {
              market_id: "disc-cm-boi-rate-decision-july-6-2026-v2",
              market_status: "open",
              title: "החלטת בנק ישראל ביולי?",
              description: "שוק backend",
              category_key: "economy",
              market_family_key: "boi-rate-decision-v1",
              open_at: new Date("2026-04-16T09:54:50.952Z"),
              close_at: new Date("2026-07-06T16:00:00.000Z"),
              market_state_version: "0",
              updated_at: new Date("2026-04-16T12:00:07.198Z"),
              outcome_id: "disc-cm-boi-rate-decision-july-6-2026-cut-025",
              short_label: "ירידה של 0.25%",
              label: "ירידה של 0.25%",
              sort_order: 0,
              last_price: "0.20000000",
              resolution_source: "הודעת הריבית הרשמית של בנק ישראל.",
              resolution_rules: "הכרעת הריבית הרשמית קובעת את הסל.",
              oracle_source_policy: null
            },
            {
              market_id: "disc-cm-boi-rate-decision-july-6-2026-v2",
              market_status: "open",
              title: "החלטת בנק ישראל ביולי?",
              description: "שוק backend",
              category_key: "economy",
              market_family_key: "boi-rate-decision-v1",
              open_at: new Date("2026-04-16T09:54:50.952Z"),
              close_at: new Date("2026-07-06T16:00:00.000Z"),
              market_state_version: "0",
              updated_at: new Date("2026-04-16T12:00:07.198Z"),
              outcome_id: "disc-cm-boi-rate-decision-july-6-2026-no-change",
              short_label: "ללא שינוי",
              label: "ללא שינוי",
              sort_order: 1,
              last_price: "0.80000000",
              resolution_source: "הודעת הריבית הרשמית של בנק ישראל.",
              resolution_rules: "הכרעת הריבית הרשמית קובעת את הסל.",
              oracle_source_policy: null
            }
          ]
        };
      })
    } as unknown as Pool;

    const record = await readDbBackedMarketDetailPassiveRecord(
      pool,
      "disc-cm-boi-rate-decision-july-6-2026-v2"
    );

    expect(record?.chain).toEqual([
      {
        id: "disc-cm-boi-rate-decision-may-25-2026-v2",
        label: "25 במאי",
        href: "/markets/disc-cm-boi-rate-decision-may-25-2026-v2",
        temporalStatus: "past"
      },
      {
        id: "disc-cm-boi-rate-decision-july-6-2026-v2",
        label: "6 ביולי",
        href: "/markets/disc-cm-boi-rate-decision-july-6-2026-v2",
        temporalStatus: "current"
      }
    ]);
  });

  it("omits inline price history from passive detail records", async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("select event_id") && sql.includes("from markets")) {
          return {
            rowCount: 1,
            rows: [{ event_id: null }]
          };
        }

        if (sql.includes("from events e")) {
          return {
            rowCount: 0,
            rows: []
          };
        }

        if (sql.includes("market_family_key =")) {
          return {
            rowCount: 0,
            rows: []
          };
        }

        if (sql.includes("from trades")) {
          return {
            rowCount: 2,
            rows: [
              {
                id: "trade-1",
                outcome_id: "budget-vote-0f2a9c1d-outcome-yes",
                side: "buy",
                cash_amount: "120.000000",
                share_amount: "20.000000",
                created_at: new Date("2026-04-12T08:30:00.000Z"),
                price_before: "0.50000000",
                price_after: "0.58000000",
                execution_legs: []
              },
              {
                id: "trade-2",
                outcome_id: "budget-vote-0f2a9c1d-outcome-no",
                side: "buy",
                // 180 (not 80): keeps this outcome above the public-volume floor
                // so the per-outcome allocation stays asserted as a label.
                cash_amount: "180.000000",
                share_amount: "10.000000",
                created_at: new Date("2026-04-12T08:45:00.000Z"),
                price_before: "0.42000000",
                price_after: "0.36000000",
                execution_legs: []
              }
            ]
          };
        }

        return {
          rowCount: 2,
          rows: [
            {
              market_id: "budget-vote-0f2a9c1d",
              market_status: "closed",
              title: "האם התקציב יעבור השבוע?",
              description: "שוק backend",
              category_key: "politics",
              market_family_key: null,
              open_at: new Date("2026-04-10T08:00:00.000Z"),
              close_at: new Date("2026-04-18T18:00:00.000Z"),
              market_state_version: "3",
              updated_at: new Date("2026-04-12T09:00:00.000Z"),
              outcome_id: "budget-vote-0f2a9c1d-outcome-yes",
              short_label: "כן",
              label: "כן",
              sort_order: 0,
              last_price: "0.64000000",
              resolution_source: "Official budget vote result",
              resolution_rules: "Resolves to the official Knesset vote result.",
              oracle_source_policy: null
            },
            {
              market_id: "budget-vote-0f2a9c1d",
              market_status: "closed",
              title: "האם התקציב יעבור השבוע?",
              description: "שוק backend",
              category_key: "politics",
              market_family_key: null,
              open_at: new Date("2026-04-10T08:00:00.000Z"),
              close_at: new Date("2026-04-18T18:00:00.000Z"),
              market_state_version: "3",
              updated_at: new Date("2026-04-12T09:00:00.000Z"),
              outcome_id: "budget-vote-0f2a9c1d-outcome-no",
              short_label: "לא",
              label: "לא",
              sort_order: 1,
              last_price: "0.36000000",
              resolution_source: "Official budget vote result",
              resolution_rules: "Resolves to the official Knesset vote result.",
              oracle_source_policy: null
            }
          ]
        };
      })
    } as unknown as Pool;

    const record = await readDbBackedMarketDetailPassiveRecord(
      pool,
      "budget-vote-0f2a9c1d"
    );

    expect(record?.snapshot.timeframes).toBeUndefined();
    expect(record?.snapshot.current).toEqual({
      "budget-vote-0f2a9c1d-outcome-yes": 0.64,
      "budget-vote-0f2a9c1d-outcome-no": 0.36
    });
    expect(record?.snapshot.volumeLabel).toBe("V₪ 300");
    expect(record?.snapshot.outcomeVolumes).toEqual({
      "budget-vote-0f2a9c1d-outcome-yes": "V₪ 120",
      "budget-vote-0f2a9c1d-outcome-no": "V₪ 180"
    });
  });

  it("keeps execution-leg volume truth without inline chart replay", async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("select event_id") && sql.includes("from markets")) {
          return {
            rowCount: 1,
            rows: [{ event_id: null }]
          };
        }

        if (sql.includes("from events e")) {
          return {
            rowCount: 0,
            rows: []
          };
        }

        if (sql.includes("market_family_key =")) {
          return {
            rowCount: 0,
            rows: []
          };
        }

        if (sql.includes("from trades")) {
          return {
            rowCount: 1,
            rows: [
              {
                id: "trade-bundle-1",
                outcome_id: "three-way-market-outcome-a",
                side: "buy",
                // 900 (not 90): keeps the leg allocation above the public-volume
                // floor so the 50/50 split stays asserted as formatted labels.
                cash_amount: "900.000000",
                share_amount: "15.000000",
                created_at: new Date("2026-04-12T08:30:00.000Z"),
                price_before: "0.66666667",
                price_after: "0.70000000",
                execution_legs: [
                  {
                    outcome_id: "three-way-market-outcome-b",
                    share_amount: "15.000000"
                  },
                  {
                    outcome_id: "three-way-market-outcome-c",
                    share_amount: "15.000000"
                  }
                ]
              }
            ]
          };
        }

        return {
          rowCount: 3,
          rows: [
            {
              market_id: "three-way-market",
              market_status: "closed",
              title: "מי ינצח?",
              description: "שוק backend",
              category_key: "politics",
              market_family_key: null,
              open_at: new Date("2026-04-12T08:00:00.000Z"),
              close_at: new Date("2026-04-18T18:00:00.000Z"),
              liquidity_b: "100.00000000",
              market_state_version: "3",
              updated_at: new Date("2026-04-12T09:00:00.000Z"),
              outcome_id: "three-way-market-outcome-a",
              short_label: "א",
              label: "א",
              sort_order: 0,
              last_price: "0.30000000",
              resolution_source: "Official result",
              resolution_rules: "Official result decides.",
              oracle_source_policy: null
            },
            {
              market_id: "three-way-market",
              market_status: "closed",
              title: "מי ינצח?",
              description: "שוק backend",
              category_key: "politics",
              market_family_key: null,
              open_at: new Date("2026-04-12T08:00:00.000Z"),
              close_at: new Date("2026-04-18T18:00:00.000Z"),
              liquidity_b: "100.00000000",
              market_state_version: "3",
              updated_at: new Date("2026-04-12T09:00:00.000Z"),
              outcome_id: "three-way-market-outcome-b",
              short_label: "ב",
              label: "ב",
              sort_order: 1,
              last_price: "0.35000000",
              resolution_source: "Official result",
              resolution_rules: "Official result decides.",
              oracle_source_policy: null
            },
            {
              market_id: "three-way-market",
              market_status: "closed",
              title: "מי ינצח?",
              description: "שוק backend",
              category_key: "politics",
              market_family_key: null,
              open_at: new Date("2026-04-12T08:00:00.000Z"),
              close_at: new Date("2026-04-18T18:00:00.000Z"),
              liquidity_b: "100.00000000",
              market_state_version: "3",
              updated_at: new Date("2026-04-12T09:00:00.000Z"),
              outcome_id: "three-way-market-outcome-c",
              short_label: "ג",
              label: "ג",
              sort_order: 2,
              last_price: "0.35000000",
              resolution_source: "Official result",
              resolution_rules: "Official result decides.",
              oracle_source_policy: null
            }
          ]
        };
      })
    } as unknown as Pool;

    const record = await readDbBackedMarketDetailPassiveRecord(pool, "three-way-market");
    expect(record?.snapshot.timeframes).toBeUndefined();
    expect(record?.snapshot.current).toEqual({
      "three-way-market-outcome-a": 0.3,
      "three-way-market-outcome-b": 0.35,
      "three-way-market-outcome-c": 0.35
    });
    expect(record?.snapshot.volumeLabel).toBe("V₪ 900");
    expect(record?.snapshot.outcomeVolumes).toEqual({
      // outcome-a took no legs: zero volume is below the public floor → null
      // (a misallocation would surface as a label, so null still discriminates).
      "three-way-market-outcome-a": null,
      "three-way-market-outcome-b": "V₪ 450",
      "three-way-market-outcome-c": "V₪ 450"
    });
  });
});
