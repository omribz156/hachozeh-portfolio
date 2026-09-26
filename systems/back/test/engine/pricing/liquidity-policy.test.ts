import { describe, expect, it } from "vitest";

import {
  getLiquidityDepthPreset,
  listLiquidityDepthPresets,
  recommendLiquidityDepth
} from "../../../src/engine/pricing";

describe("LMSR liquidity policy", () => {
  it("exposes named depth presets from toy to flagship", () => {
    const presets = listLiquidityDepthPresets();

    expect(presets.map((preset) => preset.depthClass)).toEqual([
      "toy_test",
      "small_social",
      "normal_public",
      "serious_economy_politics",
      "flagship_proof"
    ]);
    expect(getLiquidityDepthPreset("normal_public").liquidityB).toBe("25000.00000000");
  });

  it("routes economy and politics markets to serious depth", () => {
    expect(
      recommendLiquidityDepth({
        categoryKey: "economy",
        outcomeCount: 2
      }).depthClass
    ).toBe("serious_economy_politics");
    expect(
      recommendLiquidityDepth({
        categoryKey: "economics",
        outcomeCount: 2
      }).depthClass
    ).toBe("serious_economy_politics");
    expect(
      recommendLiquidityDepth({
        familyKey: "boi-rate-decision-v1",
        outcomeCount: 5
      }).liquidityB
    ).toBe("75000.00000000");
  });
});
