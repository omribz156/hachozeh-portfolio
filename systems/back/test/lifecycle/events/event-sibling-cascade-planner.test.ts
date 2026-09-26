import { describe, expect, it, vi } from "vitest";

import type { Queryable } from "../../../src/db/client/pool";
import {
  planEventSiblingResolutionCascade,
  type EventSiblingCascadeTrigger
} from "../../../src/lifecycle/events/event-sibling-cascade-planner";

type EventRow = {
  id: string;
  resolution_policy: "independent_children" | "exclusive_first_hit";
  sibling_resolution_requires_human_approval: boolean;
  status: "active" | "completed";
};

type ChildOutcomeRow = {
  market_id: string;
  market_status: "draft" | "open" | "closed" | "resolved" | "voided";
  winning_outcome_id: string | null;
  outcome_id: string;
  outcome_label: string;
  sort_order: number;
};

function yesNoChild(input: {
  marketId: string;
  status?: ChildOutcomeRow["market_status"];
  winningOutcomeId?: string | null;
}): ChildOutcomeRow[] {
  return [
    {
      market_id: input.marketId,
      market_status: input.status ?? "closed",
      winning_outcome_id: input.winningOutcomeId ?? null,
      outcome_id: `${input.marketId}-yes`,
      outcome_label: "כן",
      sort_order: 0
    },
    {
      market_id: input.marketId,
      market_status: input.status ?? "closed",
      winning_outcome_id: input.winningOutcomeId ?? null,
      outcome_id: `${input.marketId}-no`,
      outcome_label: "לא",
      sort_order: 1
    }
  ];
}

function nonBinaryChild(marketId: string): ChildOutcomeRow[] {
  return [
    {
      market_id: marketId,
      market_status: "closed",
      winning_outcome_id: null,
      outcome_id: `${marketId}-a`,
      outcome_label: "A",
      sort_order: 0
    },
    {
      market_id: marketId,
      market_status: "closed",
      winning_outcome_id: null,
      outcome_id: `${marketId}-b`,
      outcome_label: "B",
      sort_order: 1
    }
  ];
}

function createDb(event: EventRow | null, children: ChildOutcomeRow[]): Queryable {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("from events")) {
        return { rows: event ? [event] : [], rowCount: event ? 1 : 0 };
      }

      if (sql.includes("from markets")) {
        return { rows: children, rowCount: children.length };
      }

      if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    })
  } as unknown as Queryable;
}

function trigger(marketId = "child-a"): EventSiblingCascadeTrigger {
  return {
    triggerMarketId: marketId,
    triggerWinningOutcomeId: `${marketId}-yes`,
    approvedByHuman: true,
    oracleCaseId: "oc_1",
    reviewId: "ocr_1"
  };
}

describe("planEventSiblingResolutionCascade", () => {
  it("does nothing for independent child events", async () => {
    const plan = await planEventSiblingResolutionCascade(
      createDb(
        {
          id: "event-1",
          resolution_policy: "independent_children",
          sibling_resolution_requires_human_approval: true,
          status: "active"
        },
        [...yesNoChild({ marketId: "child-a" }), ...yesNoChild({ marketId: "child-b" })]
      ),
      "event-1",
      trigger()
    );

    expect(plan).toMatchObject({
      action: "none",
      resolutionPolicy: "independent_children",
      siblingActions: [],
      blockers: [],
      context: {
        childCount: 2
      }
    });
  });

  it("plans unresolved siblings as no after a human-approved exclusive yes trigger", async () => {
    const plan = await planEventSiblingResolutionCascade(
      createDb(
        {
          id: "event-1",
          resolution_policy: "exclusive_first_hit",
          sibling_resolution_requires_human_approval: true,
          status: "active"
        },
        [
          ...yesNoChild({ marketId: "child-a", status: "resolved", winningOutcomeId: "child-a-yes" }),
          ...yesNoChild({ marketId: "child-b", status: "closed" }),
          ...yesNoChild({ marketId: "child-c", status: "open" })
        ]
      ),
      "event-1",
      trigger()
    );

    expect(plan).toMatchObject({
      action: "resolve_siblings_no",
      resolutionPolicy: "exclusive_first_hit",
      requiresHumanApproval: true,
      blockers: [],
      siblingActions: [
        {
          marketId: "child-b",
          action: "resolve_no",
          noOutcomeId: "child-b-no",
          currentStatus: "closed",
          reason: "exclusive_first_hit"
        },
        {
          marketId: "child-c",
          action: "resolve_no",
          noOutcomeId: "child-c-no",
          currentStatus: "open",
          reason: "exclusive_first_hit"
        }
      ],
      skippedChildren: [{ marketId: "child-a", reason: "trigger_market" }]
    });
  });

  it("skips terminal siblings that are already no/voided", async () => {
    const plan = await planEventSiblingResolutionCascade(
      createDb(
        {
          id: "event-1",
          resolution_policy: "exclusive_first_hit",
          sibling_resolution_requires_human_approval: true,
          status: "active"
        },
        [
          ...yesNoChild({ marketId: "child-a", status: "resolved", winningOutcomeId: "child-a-yes" }),
          ...yesNoChild({ marketId: "child-b", status: "resolved", winningOutcomeId: "child-b-no" }),
          ...yesNoChild({ marketId: "child-c", status: "voided" })
        ]
      ),
      "event-1",
      trigger()
    );

    expect(plan.action).toBe("none");
    expect(plan.siblingActions).toEqual([]);
    expect(plan.skippedChildren).toEqual([
      { marketId: "child-a", reason: "trigger_market" },
      { marketId: "child-b", reason: "already_terminal" },
      { marketId: "child-c", reason: "already_terminal" }
    ]);
  });

  it("blocks if another sibling already resolved yes", async () => {
    const plan = await planEventSiblingResolutionCascade(
      createDb(
        {
          id: "event-1",
          resolution_policy: "exclusive_first_hit",
          sibling_resolution_requires_human_approval: true,
          status: "active"
        },
        [
          ...yesNoChild({ marketId: "child-a", status: "resolved", winningOutcomeId: "child-a-yes" }),
          ...yesNoChild({ marketId: "child-b", status: "resolved", winningOutcomeId: "child-b-yes" })
        ]
      ),
      "event-1",
      trigger()
    );

    expect(plan.action).toBe("blocked");
    expect(plan.blockers).toContain("existing_yes_sibling:child-b");
  });

  it("blocks non yes/no binary children and non-human triggers", async () => {
    const plan = await planEventSiblingResolutionCascade(
      createDb(
        {
          id: "event-1",
          resolution_policy: "exclusive_first_hit",
          sibling_resolution_requires_human_approval: true,
          status: "active"
        },
        [
          ...yesNoChild({ marketId: "child-a", status: "closed" }),
          ...nonBinaryChild("child-b")
        ]
      ),
      "event-1",
      {
        ...trigger(),
        approvedByHuman: false
      }
    );

    expect(plan.action).toBe("blocked");
    expect(plan.blockers).toEqual([
      "trigger_not_human_approved",
      "child_not_yes_no_binary:child-b"
    ]);
  });
});
