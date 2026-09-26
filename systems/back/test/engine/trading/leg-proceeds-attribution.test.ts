import { describe, expect, it } from "vitest";

import { attributeLegProceeds } from "../../../src/engine/trading/leg-proceeds-attribution";
import { calculateLmsrPrices } from "../../../src/engine/pricing";
import { toDecimal } from "../../../src/shared/decimals";

function sumValues(attribution: Map<string, string>): string {
  let sum = toDecimal(0);
  for (const value of attribution.values()) {
    sum = sum.plus(value);
  }
  return sum.toFixed(6);
}

describe("attributeLegProceeds", () => {
  it("gives a single leg the full proceeds", () => {
    const attribution = attributeLegProceeds({
      proceedsReceived: "7.123456",
      legs: [{ outcomeId: "out_a" }],
      liquidityB: "100.00000000",
      qShares: ["0.000000", "0.000000"],
      outcomeIndexById: new Map([["out_a", 0]])
    });

    expect(attribution.get("out_a")).toBe("7.123456");
  });

  it("splits equal-price legs evenly and books the rounding residual on the first max-weight leg", () => {
    // 3 equal-price legs, proceeds 10.000000: two legs floor to 3.333333,
    // the residual leg absorbs 10 - 6.666666 = 3.333334. Equal split under
    // the old code lost 0.000001 (3 × 3.333333 = 9.999999).
    const attribution = attributeLegProceeds({
      proceedsReceived: "10.000000",
      legs: [{ outcomeId: "out_a" }, { outcomeId: "out_b" }, { outcomeId: "out_c" }],
      liquidityB: "1000.00000000",
      qShares: ["0.000000", "0.000000", "0.000000"],
      outcomeIndexById: new Map([
        ["out_a", 0],
        ["out_b", 1],
        ["out_c", 2]
      ])
    });

    expect(attribution.get("out_a")).toBe("3.333334");
    expect(attribution.get("out_b")).toBe("3.333333");
    expect(attribution.get("out_c")).toBe("3.333333");
    expect(sumValues(attribution)).toBe("10.000000");
  });

  it("weights legs by pre-trade outcome price and sums exactly to proceeds", () => {
    const liquidityB = "100.00000000";
    const qShares = ["0.000000", "300.000000", "8.000000"];
    const prices = calculateLmsrPrices({ liquidityB, qShares });

    const attribution = attributeLegProceeds({
      proceedsReceived: "10.000000",
      legs: [{ outcomeId: "out_b" }, { outcomeId: "out_c" }],
      liquidityB,
      qShares,
      outcomeIndexById: new Map([
        ["out_a", 0],
        ["out_b", 1],
        ["out_c", 2]
      ])
    });

    const expensiveLegShare = toDecimal(attribution.get("out_b")!);
    const cheapLegShare = toDecimal(attribution.get("out_c")!);

    // out_b (q=300) is worth ~20x out_c (q=8) at b=100 — attribution must
    // follow value, not head-count.
    expect(expensiveLegShare.gt("9.000000")).toBe(true);
    expect(cheapLegShare.lt("1.000000")).toBe(true);
    expect(sumValues(attribution)).toBe("10.000000");

    // The non-residual (lighter) leg is the exact floored proportional share.
    const weightB = toDecimal(prices[1]!);
    const weightC = toDecimal(prices[2]!);
    const expectedCheap = toDecimal("10.000000")
      .mul(weightC)
      .div(weightB.plus(weightC))
      .toDecimalPlaces(6, 1); // ROUND_DOWN
    expect(cheapLegShare.toFixed(6)).toBe(expectedCheap.toFixed(6));
  });

  it("falls back to equal weights when no leg has a resolvable price", () => {
    // Legs missing from the index map resolve to zero weight → equal-split
    // fallback, residual still keeps the sum exact.
    const attribution = attributeLegProceeds({
      proceedsReceived: "0.490000",
      legs: [{ outcomeId: "ghost_a" }, { outcomeId: "ghost_b" }],
      liquidityB: "100.00000000",
      qShares: ["0.000000", "0.000000"],
      outcomeIndexById: new Map()
    });

    expect(attribution.get("ghost_a")).toBe("0.245000");
    expect(attribution.get("ghost_b")).toBe("0.245000");
    expect(sumValues(attribution)).toBe("0.490000");
  });
});
