import { describe, expect, it } from "vitest";

import { classifyLiquidityAuditRow } from "../../../src/engine/pricing";

describe("LMSR liquidity audit", () => {
  it("flags legacy shallow economy markets as critical", () => {
    const result = classifyLiquidityAuditRow({
      marketId: "disc-cm-fx-threshold",
      title: "Will USD/ILS close above 3.70?",
      status: "open",
      categoryKey: "economy",
      familyKey: "economy.fx-threshold",
      outcomeCount: 2,
      liquidityB: "700.00000000",
      tradeCount: 4,
      tradeVolume: "27000000.000000"
    });

    expect(result.recommendedDepthClass).toBe("serious_economy_politics");
    expect(result.flags).toEqual([
      "below_recommended",
      "below_recommended_min",
      "legacy_shallow_pool",
      "volume_depth_mismatch"
    ]);
    expect(result.severity).toBe("critical");
  });

  it("treats recommended-depth public markets as ok", () => {
    const result = classifyLiquidityAuditRow({
      marketId: "disc-cm-sports-proof",
      title: "Will the home team win?",
      status: "open",
      categoryKey: "sports",
      familyKey: "sports.game-winner",
      outcomeCount: 2,
      liquidityB: "25000.00000000",
      tradeCount: 12,
      tradeVolume: "40000.000000"
    });

    expect(result.flags).toEqual([]);
    expect(result.liquidityRatio).toBe("1.0000");
    expect(result.severity).toBe("ok");
  });

  it("keeps high-volume recommended-depth markets as watch, not repair blockers", () => {
    const result = classifyLiquidityAuditRow({
      marketId: "disc-cm-fx-threshold",
      title: "Will USD/ILS close above 3.70?",
      status: "open",
      categoryKey: "economy",
      familyKey: "economy.fx-threshold",
      outcomeCount: 2,
      liquidityB: "75000.00000000",
      tradeCount: 2216,
      tradeVolume: "27184216.348724"
    });

    expect(result.flags).toEqual(["volume_depth_mismatch"]);
    expect(result.liquidityRatio).toBe("1.0000");
    expect(result.severity).toBe("watch");
  });
});
