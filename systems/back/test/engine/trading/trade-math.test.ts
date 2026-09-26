import { describe, expect, it } from "vitest";

import { splitCostBasisAcrossExecutionLegs } from "../../../src/engine/trading/trade-math";

// ---------------------------------------------------------------------------
// Helper: sum an array of decimal strings
// ---------------------------------------------------------------------------
function sumStrings(values: string[]): string {
  const total = values.reduce((acc, v) => acc + Number(v), 0);
  // Return as a fixed-6 string for comparison
  return total.toFixed(6);
}

describe("splitCostBasisAcrossExecutionLegs", () => {
  // -----------------------------------------------------------------------
  // Basic structure
  // -----------------------------------------------------------------------

  it("returns an empty array when legCount is 0", () => {
    // The function guards legCount <= 0 and returns []
    // We need a positive cashSpent so parsing doesn't fail — but legCount guard fires first.
    // Note: parseDecimalString is called before the guard in the source, but legCount check
    // is the very first thing. With legCount=0 the guard fires before any parse attempt.
    const result = splitCostBasisAcrossExecutionLegs("10.000000", 0);
    expect(result).toEqual([]);
  });

  it("returns a single-element array equal to cashSpent for legCount=1", () => {
    const result = splitCostBasisAcrossExecutionLegs("7.500000", 1);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("7.500000");
  });

  // -----------------------------------------------------------------------
  // Exact-split cases (evenly divisible)
  // -----------------------------------------------------------------------

  it("splits evenly divisible amount across 2 legs", () => {
    const result = splitCostBasisAcrossExecutionLegs("10.000000", 2);
    expect(result).toEqual(["5.000000", "5.000000"]);
  });

  it("splits evenly divisible amount across 4 legs", () => {
    const result = splitCostBasisAcrossExecutionLegs("12.000000", 4);
    expect(result).toEqual(["3.000000", "3.000000", "3.000000", "3.000000"]);
  });

  // -----------------------------------------------------------------------
  // Repeated-buy cost-basis merge — last-leg remainder
  // -----------------------------------------------------------------------

  it("assigns remainder to last leg when not evenly divisible (3 legs)", () => {
    // 10 / 3 = 3.333333... floor = 3.333333; last = 10 - 3.333333 * 2 = 3.333334
    const result = splitCostBasisAcrossExecutionLegs("10.000000", 3);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe("3.333333");
    expect(result[1]).toBe("3.333333");
    expect(result[2]).toBe("3.333334");
  });

  it("assigns remainder to last leg for 3 legs — sum equals cashSpent exactly", () => {
    const result = splitCostBasisAcrossExecutionLegs("10.000000", 3);
    // Summing decimal strings via Number is fine here because the scale is small
    const total = result.reduce((acc, v) => acc + Number(v), 0);
    expect(total.toFixed(6)).toBe("10.000000");
  });

  it("repeated-buy merge: split across 3 legs, exact decimal string values", () => {
    // The test from trade-service confirms this splits "9.999999" across 3 → each "3.333333"
    const result = splitCostBasisAcrossExecutionLegs("9.999999", 3);
    expect(result).toEqual(["3.333333", "3.333333", "3.333333"]);
  });

  it("sum of all legs always equals cashSpent for 5-leg split", () => {
    const result = splitCostBasisAcrossExecutionLegs("10.000000", 5);
    expect(result).toHaveLength(5);
    const total = result.reduce((acc, v) => acc + Number(v), 0);
    expect(total.toFixed(6)).toBe("10.000000");
  });

  // -----------------------------------------------------------------------
  // Dust amounts
  // -----------------------------------------------------------------------

  it("handles dust amount '0.000001' across 1 leg", () => {
    const result = splitCostBasisAcrossExecutionLegs("0.000001", 1);
    expect(result).toEqual(["0.000001"]);
  });

  it("handles dust amount '0.000001' across 2 legs: first gets floor, last gets remainder", () => {
    // 0.000001 / 2 = 0.0000005 → floor to 6 dp = 0.000000; last = 0.000001 - 0 = 0.000001
    const result = splitCostBasisAcrossExecutionLegs("0.000001", 2);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe("0.000000");
    expect(result[1]).toBe("0.000001");
    const total = result.reduce((acc, v) => acc + Number(v), 0);
    expect(total.toFixed(6)).toBe("0.000001");
  });

  it("handles dust amount '0.000003' across 3 legs evenly", () => {
    const result = splitCostBasisAcrossExecutionLegs("0.000003", 3);
    expect(result).toEqual(["0.000001", "0.000001", "0.000001"]);
  });

  // -----------------------------------------------------------------------
  // Rounding direction guarantee: floor applied to base legs
  // -----------------------------------------------------------------------

  it("base legs are always floored (never rounded up)", () => {
    // 1.000001 / 3 = 0.333333666... → floor → 0.333333
    const result = splitCostBasisAcrossExecutionLegs("1.000001", 3);
    expect(result[0]).toBe("0.333333");
    expect(result[1]).toBe("0.333333");
    // Last leg absorbs the remainder
    const total = result.reduce((acc, v) => acc + Number(v), 0);
    expect(total.toFixed(6)).toBe("1.000001");
  });

  it("last-leg value is computed as total minus sum-of-base-legs (never independently rounded)", () => {
    // If independent rounding were used, 7.000001/3 could round all three to 2.333334,
    // giving a sum of 7.000002. The source avoids this by deriving the last leg as residual.
    const result = splitCostBasisAcrossExecutionLegs("7.000001", 3);
    const total = result.reduce((acc, v) => acc + Number(v), 0);
    expect(total.toFixed(6)).toBe("7.000001");
  });

  // -----------------------------------------------------------------------
  // Larger amounts
  // -----------------------------------------------------------------------

  it("large amount with 5 legs sums correctly", () => {
    const result = splitCostBasisAcrossExecutionLegs("999.999999", 5);
    expect(result).toHaveLength(5);
    const total = result.reduce((acc, v) => acc + Number(v), 0);
    expect(total.toFixed(6)).toBe("999.999999");
  });
});
