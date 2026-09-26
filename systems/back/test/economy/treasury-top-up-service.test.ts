import { describe, expect, it } from "vitest";

import {
  parseTreasuryTopUpRequest,
  TreasuryTopUpServiceError
} from "../../src/economy/treasury-top-up-service";

describe("treasury top-up service", () => {
  it("normalizes bounded admin treasury top-up requests", () => {
    expect(
      parseTreasuryTopUpRequest({
        amount: "10",
        reason: " operator liquidity review ",
        idempotencyKey: " top-up-1 "
      })
    ).toEqual({
      amount: "10.000000",
      reason: "operator liquidity review",
      idempotencyKey: "top-up-1"
    });
  });

  it("rejects unsafe admin treasury top-up text fields", () => {
    expect(() =>
      parseTreasuryTopUpRequest({
        amount: "10",
        reason: `operator\n${"x".repeat(241)}`,
        idempotencyKey: "top-up-1"
      })
    ).toThrow(TreasuryTopUpServiceError);

    expect(() =>
      parseTreasuryTopUpRequest({
        amount: "10",
        reason: "operator liquidity review",
        idempotencyKey: "x".repeat(161)
      })
    ).toThrow(TreasuryTopUpServiceError);
  });
});
