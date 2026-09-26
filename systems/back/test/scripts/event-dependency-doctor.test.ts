import { describe, expect, it } from "vitest";

import {
  auditActiveEvents,
  formatEventAuditAlert,
  inspectEventDependencies,
  type ActiveEventLifecycleAuditReport,
  type ChildRow,
  type EventRow
} from "../../src/scripts/event-dependency-doctor";
import type { Queryable } from "../../src/db/client/pool";

const event: EventRow = {
  id: "event-1",
  slug: "event-1",
  title: "Winner event",
  status: "completed",
  resolution_policy: "exclusive_first_hit",
  sibling_resolution_requires_human_approval: true
};

function child(
  id: string,
  affirmativeWinner: boolean,
  overrides: Partial<ChildRow> = {}
): ChildRow {
  return {
    id,
    title: id,
    status: "resolved",
    close_at: new Date("2026-07-12T15:00:00.000Z"),
    resolved_at: new Date("2026-07-12T20:00:00.000Z"),
    market_contract: {
      marketKindId: "sports.tournament-winner",
      resultShape: "yes_no",
      operational: { earlyEliminationClose: true },
      dependencyResolution: { acceptFact: "entity_eliminated", entityKey: id }
    },
    winner_count: 1,
    affirmative_winner_count: affirmativeWinner ? 1 : 0,
    winner_label: affirmativeWinner ? "כן" : "לא",
    expected_resolution_at: "2026-07-12T20:00:00.000Z",
    resolution_case_count: 1,
    settlement_status: "completed",
    ...overrides
  };
}

describe("event dependency doctor", () => {
  it("accepts exactly one affirmative winner across resolved binary children", () => {
    expect(inspectEventDependencies(event, [
      child("sinner", true),
      child("djokovic", false),
      child("zverev", false)
    ])).toEqual([]);
  });

  it("flags a completed exclusive event with no affirmative winner", () => {
    expect(inspectEventDependencies(event, [
      child("sinner", false),
      child("djokovic", false)
    ])).toContain("exclusive_first_hit_has_no_affirmative_winner");
  });

  it("flags an affirmative winner while an exclusive sibling remains tradable", () => {
    const activeEvent = { ...event, status: "active" };
    expect(inspectEventDependencies(activeEvent, [
      child("winner", true),
      child("still-open", false, {
        status: "open",
        resolved_at: null,
        close_at: new Date("2026-08-01T15:00:00.000Z"),
        winner_count: 0,
        winner_label: null,
        settlement_status: "not_started"
      })
    ], new Date("2026-07-13T12:00:00.000Z"))).toContain(
      "exclusive_first_hit_has_nonterminal_siblings_after_affirmative_winner"
    );
  });

  it("flags a closed child without a resolution case immediately", () => {
    const activeEvent = { ...event, status: "active", resolution_policy: "independent_children" };
    expect(inspectEventDependencies(activeEvent, [
      child("closed-child", false, {
        status: "closed",
        resolved_at: null,
        winner_count: 0,
        winner_label: null,
        expected_resolution_at: "2026-07-13T22:00:00.000Z",
        resolution_case_count: 0,
        settlement_status: "not_started"
      }),
      child("open-child", false, {
        status: "open",
        resolved_at: null,
        close_at: new Date("2026-08-01T15:00:00.000Z"),
        winner_count: 0,
        winner_label: null,
        settlement_status: "not_started"
      })
    ], new Date("2026-07-13T12:00:00.000Z"))).toContain(
      "closed-child: closed without resolution case"
    );
  });

  it("rejects early-elimination prose without an executable route", () => {
    const activeEvent = { ...event, status: "active" };
    expect(inspectEventDependencies(activeEvent, [
      child("france", false, {
        status: "open",
        resolved_at: null,
        close_at: new Date("2026-07-20T15:00:00.000Z"),
        winner_count: 0,
        settlement_status: "not_started",
        market_contract: {
          marketKindId: "sports.tournament-winner",
          operational: { earlyEliminationClose: true }
        }
      }),
      child("spain", false, {
        status: "open",
        resolved_at: null,
        close_at: new Date("2026-07-20T15:00:00.000Z"),
        winner_count: 0,
        settlement_status: "not_started",
        market_contract: {
          marketKindId: "sports.tournament-winner",
          operational: { earlyEliminationClose: true }
        }
      })
    ], new Date("2026-07-15T12:00:00.000Z"))).toContain(
      "france: tournament child has no executable elimination route"
    );
  });

  it("accepts a tournament child wired to elimination facts", () => {
    const wired = child("france", false, {
      market_contract: {
        marketKindId: "sports.tournament-winner",
        operational: { earlyEliminationClose: true },
        dependencyResolution: { acceptFact: "entity_eliminated", entityKey: "france" }
      }
    });
    expect(inspectEventDependencies(event, [wired, child("spain", true)])).not.toContain(
      "france: tournament child has no executable elimination route"
    );
  });

  it("flags an elimination receiver without a stable entity key", () => {
    const missingKey = child("france", false, {
      status: "open",
      resolved_at: null,
      close_at: new Date("2026-07-20T15:00:00.000Z"),
      winner_count: 0,
      settlement_status: "not_started",
      market_contract: {
        marketKindId: "sports.tournament-winner",
        operational: { earlyEliminationClose: true },
        dependencyResolution: { acceptFact: "entity_eliminated" }
      }
    });
    expect(inspectEventDependencies({ ...event, status: "active" }, [missingKey], new Date("2026-07-15T12:00:00.000Z"))).toContain(
      "france: elimination receiver has no entity key"
    );
  });

  it("keeps the Telegram alert bounded while preserving counts", () => {
    const warnings = Array.from({ length: 10 }, (_, index) => `warning-${index + 1}`);
    const report: ActiveEventLifecycleAuditReport = {
      objectType: "active_event_lifecycle_audit",
      generatedAt: "2026-07-13T12:00:00.000Z",
      status: "findings",
      auditedEventCount: 4,
      findingEventCount: 1,
      warningCount: warnings.length,
      events: [{
        objectType: "event_dependency_doctor",
        generatedAt: "2026-07-13T12:00:00.000Z",
        status: "findings",
        event,
        childCount: 2,
        warnings,
        children: []
      }]
    };

    const message = formatEventAuditAlert(report);
    expect(message).toContain("events=1/4; warnings=10");
    expect(message).toContain("event-1: warning-8");
    expect(message).not.toContain("event-1: warning-9");
    expect(message).toContain("+2 more");
  });

  it("flags stale dependent cascades after a resolved source result", async () => {
    const db = {
      query: async (sql: string, values?: unknown[]) => {
        if (sql.includes("select e.id") && sql.includes("from events e")) {
          return { rows: [{ id: "evt-fifa-world-cup-2026-winner" }], rowCount: 1 };
        }

        if (sql.includes("from events") && sql.includes("where id = $1 or slug = $1")) {
          expect(values).toEqual(["evt-fifa-world-cup-2026-winner"]);
          return {
            rows: [{
              id: "evt-fifa-world-cup-2026-winner",
              slug: "fifa-world-cup-2026-winner",
              title: "מי יזכה במונדיאל 2026?",
              status: "active",
              resolution_policy: "exclusive_first_hit",
              sibling_resolution_requires_human_approval: true
            }],
            rowCount: 1
          };
        }

        if (sql.includes("where m.event_id = $1")) {
          expect(values).toEqual(["evt-fifa-world-cup-2026-winner"]);
          return {
            rows: [
              {
                id: "disc-fifa-world-cup-2026-winner-england",
                title: "האם אנגליה תזכה במונדיאל 2026?",
                status: "open",
                close_at: new Date("2026-07-19T19:00:00.000Z"),
                resolved_at: null,
                market_contract: {
                  marketKindId: "sports.tournament-winner",
                  resultShape: "yes_no",
                  operational: {
                    eventPack: "fifa-world-cup-2026-winner",
                    earlyEliminationClose: true
                  },
                  dependencyResolution: {
                    acceptFact: "entity_eliminated",
                    entityKey: "england"
                  }
                },
                expected_resolution_at: "2026-07-19T22:00:00.000Z",
                settlement_status: "not_started",
                winner_count: 0,
                affirmative_winner_count: 0,
                winner_label: null,
                resolution_case_count: 0
              },
              {
                id: "disc-fifa-world-cup-2026-winner-argentina",
                title: "האם ארגנטינה תזכה במונדיאל 2026?",
                status: "open",
                close_at: new Date("2026-07-19T19:00:00.000Z"),
                resolved_at: null,
                market_contract: {
                  marketKindId: "sports.tournament-winner",
                  resultShape: "yes_no",
                  operational: {
                    eventPack: "fifa-world-cup-2026-winner",
                    earlyEliminationClose: true
                  },
                  dependencyResolution: {
                    acceptFact: "entity_eliminated",
                    entityKey: "argentina"
                  }
                },
                expected_resolution_at: "2026-07-19T22:00:00.000Z",
                settlement_status: "not_started",
                winner_count: 0,
                affirmative_winner_count: 0,
                winner_label: null,
                resolution_case_count: 0
              }
            ],
            rowCount: 2
          };
        }

        if (sql.includes("where m.id = $1")) {
          expect(values).toEqual(["disc-fifa-england-argentina-2026-07-15-winner"]);
          return {
            rows: [
              {
                market_id: "disc-fifa-england-argentina-2026-07-15-winner",
                market_status: "resolved",
                market_title: "אנגליה נגד ארגנטינה",
                market_contract: {
                  marketKindId: "sports.game-winner",
                  resultShape: "home_away_winner",
                  resolutionSource: { sourceIds: ["src_fifa_match_centre"] },
                  dependentResolution: {
                    emitFact: "entity_eliminated",
                    targetEventId: "evt-fifa-world-cup-2026-winner"
                  },
                  outcomeMap: [
                    {
                      outcomeLabel: "ארגנטינה",
                      eliminatesEntityKey: "england",
                      eliminatesEntityLabel: "אנגליה"
                    }
                  ]
                },
                outcome_id: "disc-fifa-england-argentina-2026-07-15-winner-outcome-option-1",
                outcome_label: "אנגליה",
                sort_order: 0
              },
              {
                market_id: "disc-fifa-england-argentina-2026-07-15-winner",
                market_status: "resolved",
                market_title: "אנגליה נגד ארגנטינה",
                market_contract: {
                  marketKindId: "sports.game-winner",
                  resultShape: "home_away_winner",
                  resolutionSource: { sourceIds: ["src_fifa_match_centre"] },
                  dependentResolution: {
                    emitFact: "entity_eliminated",
                    targetEventId: "evt-fifa-world-cup-2026-winner"
                  },
                  outcomeMap: [
                    {
                      outcomeLabel: "ארגנטינה",
                      eliminatesEntityKey: "england",
                      eliminatesEntityLabel: "אנגליה"
                    }
                  ]
                },
                outcome_id: "disc-fifa-england-argentina-2026-07-15-winner-outcome-option-2",
                outcome_label: "ארגנטינה",
                sort_order: 1
              }
            ],
            rowCount: 2
          };
        }

        if (sql.includes("where m.id <> $1")) {
          expect(values).toEqual(["disc-fifa-england-argentina-2026-07-15-winner"]);
          return {
            rows: [
              {
                event_id: "evt-fifa-world-cup-2026-winner",
                market_id: "disc-fifa-world-cup-2026-winner-england",
                market_status: "open",
                market_title: "האם אנגליה תזכה במונדיאל 2026?",
                market_contract: {
                  marketKindId: "sports.tournament-winner",
                  resultShape: "yes_no",
                  operational: {
                    eventPack: "fifa-world-cup-2026-winner",
                    earlyEliminationClose: true
                  },
                  dependencyResolution: {
                    acceptFact: "entity_eliminated",
                    entityKey: "england"
                  }
                },
                winning_outcome_id: null,
                outcome_id: "disc-fifa-world-cup-2026-winner-england-yes",
                outcome_label: "כן",
                sort_order: 0
              },
              {
                event_id: "evt-fifa-world-cup-2026-winner",
                market_id: "disc-fifa-world-cup-2026-winner-england",
                market_status: "open",
                market_title: "האם אנגליה תזכה במונדיאל 2026?",
                market_contract: {
                  marketKindId: "sports.tournament-winner",
                  resultShape: "yes_no",
                  operational: {
                    eventPack: "fifa-world-cup-2026-winner",
                    earlyEliminationClose: true
                  },
                  dependencyResolution: {
                    acceptFact: "entity_eliminated",
                    entityKey: "england"
                  }
                },
                winning_outcome_id: null,
                outcome_id: "disc-fifa-world-cup-2026-winner-england-no",
                outcome_label: "לא",
                sort_order: 1
              }
            ],
            rowCount: 2
          };
        }

        if (sql.includes("select") && sql.includes("mr.winning_outcome_id") && sql.includes("join market_resolutions mr")) {
          return {
            rows: [{
              market_id: "disc-fifa-england-argentina-2026-07-15-winner",
              winning_outcome_id: "disc-fifa-england-argentina-2026-07-15-winner-outcome-option-2"
            }],
            rowCount: 1
          };
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    } satisfies Queryable;

    const report = await auditActiveEvents(db, new Date("2026-07-15T22:00:00.000Z"));

    expect(report).toMatchObject({
      status: "findings",
      auditedEventCount: 1,
      findingEventCount: 1,
      warningCount: 1
    });
    expect(report.events[0]?.warnings).toContain(
      "disc-fifa-world-cup-2026-winner-england: stale dependent cascade from disc-fifa-england-argentina-2026-07-15-winner still needs NO resolution for אנגליה"
    );
  });
});
