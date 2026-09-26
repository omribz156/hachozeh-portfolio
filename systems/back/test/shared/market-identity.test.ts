import { describe, expect, it } from "vitest";

import { resolveMarketIdentity, resolveOutcomeId } from "../../src/shared/market-identity";

describe("market identity", () => {
  it("keeps raw market and outcome ids usable for db-backed markets", () => {
    expect(resolveMarketIdentity("budget-vote-0f2a9c1d")).toEqual({
      canonicalMarketKey: "budget-vote-0f2a9c1d",
      marketId: "budget-vote-0f2a9c1d",
      acceptedMarketKeys: ["budget-vote-0f2a9c1d"],
      outcomeKeyToOutcomeId: {}
    });
    expect(
      resolveOutcomeId(
        "budget-vote-0f2a9c1d",
        "budget-vote-0f2a9c1d-outcome-yes"
      )
    ).toBe("budget-vote-0f2a9c1d-outcome-yes");
  });
});
