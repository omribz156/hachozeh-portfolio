import { describe, expect, it, vi } from "vitest";

import type { Queryable } from "../../../src/db/client/pool";
import {
  planDependentResolutionCascade,
  type DependentResolutionCascadeTrigger
} from "../../../src/lifecycle/events/dependent-resolution-cascade-planner";

type MarketStatus = "draft" | "open" | "closed" | "resolved" | "voided";

type TriggerOutcomeRow = {
  market_id: string;
  market_status: MarketStatus;
  market_title: string;
  market_contract: unknown;
  outcome_id: string;
  outcome_label: string;
  sort_order: number;
};

type CandidateOutcomeRow = {
  event_id: string | null;
  market_id: string;
  market_status: MarketStatus;
  market_title: string;
  market_contract: unknown;
  winning_outcome_id: string | null;
  outcome_id: string;
  outcome_label: string;
  sort_order: number;
};

function fifaMatchTriggerRows(): TriggerOutcomeRow[] {
  const market_contract = {
    objectType: "market_contract_v1",
    marketKindId: "sports.game-winner",
    resultShape: "home_away_winner",
    resolutionSource: {
      sourceIds: ["src_fifa_match_centre"]
    },
    outcomeMap: [
      {
        outcomeLabel: "פורטוגל",
        evidenceKey: "home",
        resolutionPath: "Portugal is the FIFA official match winner."
      },
      {
        outcomeLabel: "ספרד",
        evidenceKey: "away",
        resolutionPath: "Spain is the FIFA official match winner."
      }
    ],
    operational: {
      eventPack: "fifa-world-cup-2026-semifinals",
      dependentEventId: "evt-fifa-world-cup-2026-winner"
    },
    dependentResolution: {
      emitFact: "entity_eliminated"
    }
  };

  return [
    {
      market_id: "disc-fifa-portugal-spain-2026-07-06-winner",
      market_status: "resolved",
      market_title: "פורטוגל נגד ספרד",
      market_contract,
      outcome_id: "disc-fifa-portugal-spain-2026-07-06-winner-portugal",
      outcome_label: "פורטוגל",
      sort_order: 0
    },
    {
      market_id: "disc-fifa-portugal-spain-2026-07-06-winner",
      market_status: "resolved",
      market_title: "פורטוגל נגד ספרד",
      market_contract,
      outcome_id: "disc-fifa-portugal-spain-2026-07-06-winner-spain",
      outcome_label: "ספרד",
      sort_order: 1
    }
  ];
}

function tournamentWinnerRows(input: {
  marketId: string;
  targetEntity: string;
  aliases: string[];
  status?: MarketStatus;
  winningOutcomeId?: string | null;
}): CandidateOutcomeRow[] {
  const market_contract = {
    objectType: "market_contract_v1",
    marketKindId: "sports.tournament-winner",
    resultShape: "yes_no",
    timeline: {
      targetEntity: input.targetEntity
    },
    taxonomy: {
      entities: input.aliases,
      aliases: input.aliases
    },
    operational: {
      eventPack: "fifa-world-cup-2026-winner",
      earlyEliminationClose: true
    }
  };

  return [
    {
      event_id: "evt-fifa-world-cup-2026-winner",
      market_id: input.marketId,
      market_status: input.status ?? "open",
      market_title: `האם ${input.targetEntity} תזכה במונדיאל 2026?`,
      market_contract,
      winning_outcome_id: input.winningOutcomeId ?? null,
      outcome_id: `${input.marketId}-yes`,
      outcome_label: "כן",
      sort_order: 0
    },
    {
      event_id: "evt-fifa-world-cup-2026-winner",
      market_id: input.marketId,
      market_status: input.status ?? "open",
      market_title: `האם ${input.targetEntity} תזכה במונדיאל 2026?`,
      market_contract,
      winning_outcome_id: input.winningOutcomeId ?? null,
      outcome_id: `${input.marketId}-no`,
      outcome_label: "לא",
      sort_order: 1
    }
  ];
}

function genericEliminationTriggerRows(): TriggerOutcomeRow[] {
  const market_contract = {
    objectType: "market_contract_v1",
    marketKindId: "reality.show-elimination",
    resultShape: "multi_outcome",
    resolutionSource: { sourceIds: ["src_show_official"] },
    dependentResolution: {
      emitFact: "entity_eliminated",
      targetEventId: "evt-power-couple"
    },
    outcomeMap: [
      {
        outcomeLabel: "דנה ורון",
        evidenceKey: "dana-ron-eliminated",
        eliminatesEntityKey: "dana-ron",
        eliminatesEntityLabel: "דנה ורון"
      },
      { outcomeLabel: "אין הדחה", evidenceKey: "no-elimination" }
    ]
  };
  return [
    { market_id: "power-couple-episode-5", market_status: "closed", market_title: "מי הודח?", market_contract, outcome_id: "dana-ron", outcome_label: "דנה ורון", sort_order: 0 },
    { market_id: "power-couple-episode-5", market_status: "closed", market_title: "מי הודח?", market_contract, outcome_id: "none", outcome_label: "אין הדחה", sort_order: 1 }
  ];
}

function genericEliminationChildRows(): CandidateOutcomeRow[] {
  const market_contract = {
    objectType: "market_contract_v1",
    marketKindId: "reality.show-winner",
    resultShape: "yes_no",
    dependencyResolution: {
      acceptFact: "entity_eliminated",
      entityKey: "dana-ron",
      entityLabel: "דנה ורון"
    }
  };
  return [
    { event_id: "evt-power-couple", market_id: "power-couple-dana-ron", market_status: "open", market_title: "האם דנה ורון יזכו?", market_contract, winning_outcome_id: null, outcome_id: "power-couple-dana-ron-yes", outcome_label: "כן", sort_order: 0 },
    { event_id: "evt-power-couple", market_id: "power-couple-dana-ron", market_status: "open", market_title: "האם דנה ורון יזכו?", market_contract, winning_outcome_id: null, outcome_id: "power-couple-dana-ron-no", outcome_label: "לא", sort_order: 1 }
  ];
}

function createDb(
  triggerRows: TriggerOutcomeRow[],
  candidateRows: CandidateOutcomeRow[]
): Queryable {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("where m.id = $1")) {
        return { rows: triggerRows, rowCount: triggerRows.length };
      }

      if (sql.includes("where m.id <> $1")) {
        return { rows: candidateRows, rowCount: candidateRows.length };
      }

      throw new Error(`Unexpected query: ${sql}`);
    })
  } as unknown as Queryable;
}

function trigger(overrides?: Partial<DependentResolutionCascadeTrigger>): DependentResolutionCascadeTrigger {
  return {
    triggerMarketId: "disc-fifa-portugal-spain-2026-07-06-winner",
    triggerWinningOutcomeId: "disc-fifa-portugal-spain-2026-07-06-winner-spain",
    approvedByHuman: true,
    oracleCaseId: "orc_fifa",
    reviewId: "ocr_fifa",
    ...overrides
  };
}

describe("planDependentResolutionCascade", () => {
  it("plans matching tournament-winner child as no after a human-approved elimination fact", async () => {
    const plan = await planDependentResolutionCascade(
      createDb(fifaMatchTriggerRows(), [
        ...tournamentWinnerRows({
          marketId: "disc-fifa-world-cup-2026-winner-portugal",
          targetEntity: "פורטוגל",
          aliases: ["portugal", "פורטוגל"]
        }),
        ...tournamentWinnerRows({
          marketId: "disc-fifa-world-cup-2026-winner-spain",
          targetEntity: "ספרד",
          aliases: ["spain", "ספרד"]
        })
      ]),
      trigger()
    );

    expect(plan).toMatchObject({
      action: "resolve_dependents_no",
      facts: [
        {
          factType: "entity_eliminated",
          entityLabel: "פורטוגל"
        }
      ],
      dependentActions: [
        {
          marketId: "disc-fifa-world-cup-2026-winner-portugal",
          action: "resolve_no",
          noOutcomeId: "disc-fifa-world-cup-2026-winner-portugal-no",
          currentStatus: "open",
          reason: "dependent_entity_eliminated",
          entityLabel: "פורטוגל"
        }
      ],
      blockers: [],
      context: {
        candidateCount: 2
      }
    });
  });

  it("closes no-op when the trigger market is not an eligible dependency emitter", async () => {
    const rows = fifaMatchTriggerRows().map((row) => ({
      ...row,
      market_contract: {
        objectType: "market_contract_v1",
        marketKindId: "sports.game-winner",
        resultShape: "home_away_winner",
        resolutionSource: {
          sourceIds: ["src_other"]
        }
      }
    }));
    const db = createDb(rows, [
      ...tournamentWinnerRows({
        marketId: "disc-fifa-world-cup-2026-winner-portugal",
        targetEntity: "פורטוגל",
        aliases: ["portugal", "פורטוגל"]
      })
    ]);

    const plan = await planDependentResolutionCascade(db, trigger());

    expect(plan.action).toBe("none");
    expect(plan.facts).toEqual([]);
    expect((db.query as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("blocks non-human triggers", async () => {
    const plan = await planDependentResolutionCascade(
      createDb(fifaMatchTriggerRows(), []),
      trigger({ approvedByHuman: false })
    );

    expect(plan.action).toBe("blocked");
    expect(plan.blockers).toEqual(["trigger_not_human_approved"]);
  });

  it("allows canonical official final evidence to plan protective dependent closes", async () => {
    const plan = await planDependentResolutionCascade(
      createDb(fifaMatchTriggerRows(), [
        ...tournamentWinnerRows({
          marketId: "disc-fifa-world-cup-2026-winner-portugal",
          targetEntity: "פורטוגל",
          aliases: ["portugal", "פורטוגל"]
        })
      ]),
      trigger({ approvedByHuman: false, trustedOfficialFinal: true })
    );
    expect(plan.action).toBe("resolve_dependents_no");
    expect(plan.dependentActions).toHaveLength(1);
  });

  it("plans a non-FIFA elimination emitted by an explicit source outcome", async () => {
    const plan = await planDependentResolutionCascade(
      createDb(genericEliminationTriggerRows(), genericEliminationChildRows()),
      trigger({
        triggerMarketId: "power-couple-episode-5",
        triggerWinningOutcomeId: "dana-ron",
        approvedByHuman: false,
        trustedOfficialFinal: true
      })
    );

    expect(plan).toMatchObject({
      action: "resolve_dependents_no",
      facts: [{ entityLabel: "דנה ורון", targetEventId: "evt-power-couple" }],
      dependentActions: [{ marketId: "power-couple-dana-ron", action: "resolve_no" }]
    });
  });

  it("does not leak an elimination fact into another tournament event", async () => {
    const unrelated = tournamentWinnerRows({
      marketId: "disc-euro-winner-portugal",
      targetEntity: "פורטוגל",
      aliases: ["portugal", "פורטוגל"]
    }).map((row) => ({ ...row, event_id: "evt-euro-winner" }));
    const plan = await planDependentResolutionCascade(
      createDb(fifaMatchTriggerRows(), unrelated),
      trigger({ approvedByHuman: false, trustedOfficialFinal: true })
    );
    expect(plan.action).toBe("none");
    expect(plan.dependentActions).toEqual([]);
  });

  it("blocks when a matching dependent already resolved yes", async () => {
    const plan = await planDependentResolutionCascade(
      createDb(fifaMatchTriggerRows(), [
        ...tournamentWinnerRows({
          marketId: "disc-fifa-world-cup-2026-winner-portugal",
          targetEntity: "פורטוגל",
          aliases: ["portugal", "פורטוגל"],
          status: "resolved",
          winningOutcomeId: "disc-fifa-world-cup-2026-winner-portugal-yes"
        })
      ]),
      trigger()
    );

    expect(plan.action).toBe("blocked");
    expect(plan.blockers).toEqual([
      "dependent_already_resolved_yes:disc-fifa-world-cup-2026-winner-portugal"
    ]);
  });
});
