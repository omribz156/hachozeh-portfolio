import { describe, expect, it } from "vitest";

import { resolveMarketCreationLiquidityB } from "../../../src/lifecycle/management/market-creation-liquidity";

describe("market creation liquidity policy", () => {
  it("honors the explicit binary depth — no preset floor", () => {
    expect(
      resolveMarketCreationLiquidityB({
        marketId: "disc-cm-public-sports",
        categoryKey: "sports",
        familyKey: "sports.game-winner",
        liquidityB: "5000.00000000",
        outcomeCount: 2
      })
    ).toBe("5000.00000000");
  });

  it("scales a 3-way market to 1.5x the binary-equivalent depth", () => {
    expect(
      resolveMarketCreationLiquidityB({
        marketId: "disc-cm-three-way",
        categoryKey: "sports",
        familyKey: "sports.game-3way",
        liquidityB: "5000.00000000",
        outcomeCount: 3
      })
    ).toBe("7500.00000000");
  });

  it("scales a 4-way market to 2x the binary-equivalent depth", () => {
    expect(
      resolveMarketCreationLiquidityB({
        marketId: "disc-cm-four-way",
        categoryKey: "politics",
        familyKey: "politics.next-pm",
        liquidityB: "5000.00000000",
        outcomeCount: 4
      })
    ).toBe("10000.00000000");
  });

  it("no longer raises economy/politics drafts to a preset tier", () => {
    expect(
      resolveMarketCreationLiquidityB({
        marketId: "disc-cm-usd-ils-threshold",
        categoryKey: "economics",
        familyKey: "economy.fx-threshold",
        liquidityB: "5000.00000000",
        outcomeCount: 2
      })
    ).toBe("5000.00000000");
  });

  it("keeps stress/test markets exact — no outcome scaling", () => {
    expect(
      resolveMarketCreationLiquidityB({
        marketId: "stress-engine-proof",
        categoryKey: "stress",
        familyKey: "stress.market",
        liquidityB: "5000.00000000",
        outcomeCount: 3
      })
    ).toBe("5000.00000000");
  });

  it("scales product market ids that merely contain 'test' (not a stress rig)", () => {
    expect(
      resolveMarketCreationLiquidityB({
        marketId: "disc-cm-test-polykalshi-knesset-june-2026",
        categoryKey: "politics",
        familyKey: "politics.knesset-deadline",
        liquidityB: "5000.00000000",
        outcomeCount: 4
      })
    ).toBe("10000.00000000");
  });
});
