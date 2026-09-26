import { describe, expect, it, vi } from "vitest";

import type { Queryable } from "../../../src/db/client/pool";
import { findKnownDependentResult } from "../../../src/lifecycle/events/dependent-trade-guard";

describe("dependent trade guard", () => {
  it("skips markets without executable dependency metadata", async () => {
    const db: Queryable = { query: vi.fn() };

    await expect(
      findKnownDependentResult(db, {
        marketId: "independent-market",
        eventId: "evt-independent",
        marketContract: { objectType: "market_contract_v1" }
      })
    ).resolves.toBeNull();
    expect(db.query).not.toHaveBeenCalled();
  });

  it("derives a binary loser when an older emitter lacks an explicit outcome map", async () => {
    const db: Queryable = {
      query: vi.fn(async () => ({
        rows: [
          {
            trigger_market_id: "legacy-match",
            market_contract: {
              dependentResolution: {
                emitFact: "entity_eliminated",
                targetEventId: "evt-winner"
              }
            },
            winning_outcome_id: "spain",
            winning_outcome_label: "Spain",
            outcomes: [
              { outcomeId: "england", label: "England" },
              { outcomeId: "spain", label: "Spain" }
            ]
          }
        ]
      }))
    };

    await expect(
      findKnownDependentResult(db, {
        marketId: "england-winner",
        eventId: "evt-winner",
        marketContract: {
          dependencyResolution: {
            acceptFact: "entity_eliminated",
            entityKey: "england"
          }
        }
      })
    ).resolves.toMatchObject({
      triggerMarketId: "legacy-match",
      entityKey: "england"
    });
  });
});
