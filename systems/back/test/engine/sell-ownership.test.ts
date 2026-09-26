import { describe, expect, it } from "vitest";

import { checkSellOwnership } from "../../src/engine/sell-ownership";
import { toDecimal } from "../../src/shared/decimals";

describe("sell ownership check", () => {
  it("fails missing rows and oversells", () => {
    expect(checkSellOwnership(null, toDecimal("1.000000")).ok).toBe(false);
    expect(
      checkSellOwnership({ shares: "1.000000" }, toDecimal("1.000001")).ok
    ).toBe(false);
  });

  it("accepts exact full-size sells", () => {
    const result = checkSellOwnership(
      { shares: "7585.225411" },
      toDecimal("7585.225411")
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ownedShares.toFixed(6)).toBe("7585.225411");
    }
  });
});
