import { describe, expect, it } from "vitest";

import {
  DecimalValidationError,
  ceilMoneyDecimal,
  floorMoneyDecimal,
  parseDecimalString,
  quantizeMoney,
  quantizePrice,
  quantizeShares
} from "../../src/shared/decimals";

describe("shared decimals", () => {
  it("normalizes fixed-width engine strings", () => {
    expect(quantizeMoney("12.3")).toBe("12.300000");
    expect(quantizeShares("7")).toBe("7.000000");
    expect(quantizePrice("0.25")).toBe("0.25000000");
  });

  it("rejects scientific notation and over-precision", () => {
    expect(() =>
      parseDecimalString("1e-4", { fieldName: "cashAmount", maxScale: 6 })
    ).toThrow(DecimalValidationError);

    expect(() =>
      parseDecimalString("1.1234567", { fieldName: "cashAmount", maxScale: 6 })
    ).toThrow(DecimalValidationError);
  });

  it("keeps conservative floor/ceil helpers honest", () => {
    expect(floorMoneyDecimal("1.2345678").toFixed(6)).toBe("1.234567");
    expect(ceilMoneyDecimal("1.2345671").toFixed(6)).toBe("1.234568");
  });
});
