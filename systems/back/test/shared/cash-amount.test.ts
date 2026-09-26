import { describe, expect, it } from "vitest";

import { normalizeUserCashAmountInput } from "../../src/shared/cash-amount";
import { DecimalValidationError } from "../../src/shared/decimals";

describe("cash amount input", () => {
  it("normalizes user cash amounts to money scale", () => {
    expect(normalizeUserCashAmountInput("12")).toBe("12.000000");
    expect(normalizeUserCashAmountInput("12.3")).toBe("12.300000");
    expect(normalizeUserCashAmountInput("12.34")).toBe("12.340000");
    expect(normalizeUserCashAmountInput("12.340000")).toBe("12.340000");
  });

  it("rejects meaningful precision beyond cents", () => {
    expect(() => normalizeUserCashAmountInput("12.345")).toThrow(DecimalValidationError);
    expect(() => normalizeUserCashAmountInput("12.340001")).toThrow(
      DecimalValidationError
    );
  });
});
