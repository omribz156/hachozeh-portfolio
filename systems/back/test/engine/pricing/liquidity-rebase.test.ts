import { describe, expect, it } from "vitest";

import {
  assertExecutableLiquidityRebasePlan,
  buildPricePreservingLiquidityRebasePlan,
  deriveQSharesFromProbabilities
} from "../../../src/engine/pricing";

describe("LMSR liquidity rebase", () => {
  it("preserves displayed prices while moving to a deeper liquidity_b", () => {
    const currentQShares = deriveQSharesFromProbabilities(
      ["0.84000000", "0.16000000"],
      "700.00000000"
    );
    const plan = buildPricePreservingLiquidityRebasePlan({
      currentLiquidityB: "700.00000000",
      targetLiquidityB: "75000.00000000",
      currentQShares
    });

    expect(plan.currentPrices).toEqual(["0.84000000", "0.16000000"]);
    expect(plan.targetPrices).toEqual(plan.currentPrices);
    expect(plan.maxPriceDrift).toBe("0.00000000");
    expect(Number(plan.lmsrCostDelta)).toBeGreaterThan(0);
  });

  it("supports multi-outcome markets", () => {
    const currentQShares = deriveQSharesFromProbabilities(
      ["0.40000000", "0.30000000", "0.20000000", "0.10000000"],
      "1000.00000000"
    );
    const plan = buildPricePreservingLiquidityRebasePlan({
      currentLiquidityB: "1000.00000000",
      targetLiquidityB: "25000.00000000",
      currentQShares
    });

    expect(plan.outcomeCount).toBe(4);
    expect(plan.targetPrices).toEqual(plan.currentPrices);
    expect(plan.targetQShares).toHaveLength(4);
  });

  it("preserves displayed prices while moving to a shallower liquidity_b", () => {
    const currentQShares = deriveQSharesFromProbabilities(
      ["0.61313753", "0.38686247"],
      "25000.00000000"
    );
    const plan = buildPricePreservingLiquidityRebasePlan({
      currentLiquidityB: "25000.00000000",
      targetLiquidityB: "10000.00000000",
      currentQShares
    });

    expect(plan.currentPrices).toEqual(["0.61313753", "0.38686247"]);
    expect(plan.targetPrices).toEqual(plan.currentPrices);
    expect(plan.maxPriceDrift).toBe("0.00000000");
    expect(Number(plan.lmsrCostDelta)).toBeLessThan(0);
  });

  it("rejects executable plans with non-trivial price drift", () => {
    const currentQShares = deriveQSharesFromProbabilities(
      ["0.84000000", "0.16000000"],
      "700.00000000"
    );
    const plan = buildPricePreservingLiquidityRebasePlan({
      currentLiquidityB: "700.00000000",
      targetLiquidityB: "75000.00000000",
      currentQShares
    });

    expect(() =>
      assertExecutableLiquidityRebasePlan({
        ...plan,
        maxPriceDrift: "0.00000002"
      })
    ).toThrow("liquidity rebase price drift");
  });
});
