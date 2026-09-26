import { describe, expect, it } from "vitest";

import { buildLmsrDepthLadder } from "../../../src/engine/pricing";

describe("LMSR depth ladder", () => {
  it("reports lower price impact as liquidity_b increases", () => {
    const rows = buildLmsrDepthLadder({
      action: "buy_yes",
      probabilities: ["0.50000000", "0.50000000"],
      cashAmounts: ["2000.000000"],
      liquidityBands: ["700.00000000", "10000.00000000", "75000.00000000"]
    });

    expect(rows).toHaveLength(3);
    expect(Number(rows[0].absPriceDelta)).toBeGreaterThan(Number(rows[1].absPriceDelta));
    expect(Number(rows[1].absPriceDelta)).toBeGreaterThan(Number(rows[2].absPriceDelta));
  });

  it("supports binary buy-no impact through complement pricing", () => {
    const [row] = buildLmsrDepthLadder({
      action: "buy_no",
      probabilities: ["0.84000000", "0.16000000"],
      cashAmounts: ["100.000000"],
      liquidityBands: ["10000.00000000"]
    });

    expect(row).toMatchObject({
      action: "buy_no",
      priceBefore: "0.16000000"
    });
    expect(Number(row.priceAfter)).toBeGreaterThan(Number(row.priceBefore));
    expect(Number(row.cashSpent)).toBeLessThanOrEqual(100);
  });

  it("supports multi-outcome complement buy-no ladders", () => {
    const [row] = buildLmsrDepthLadder({
      action: "buy_no",
      anchorOutcomeIndex: 1,
      probabilities: ["0.40000000", "0.30000000", "0.20000000", "0.10000000"],
      cashAmounts: ["2000.000000"],
      liquidityBands: ["25000.00000000"]
    });

    expect(row).toMatchObject({
      action: "buy_no",
      outcomeCount: 4,
      anchorOutcomeIndex: 1,
      priceBefore: "0.70000000"
    });
    expect(Number(row.priceAfter)).toBeGreaterThan(Number(row.priceBefore));
    expect(Number(row.priceImpactPercentPoints)).toBeGreaterThan(0);
  });
});
