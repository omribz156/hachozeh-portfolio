import { describe, expect, it } from "vitest";

import {
  buildExecutionQuote,
  quoteBuyByCash,
  quoteBuyComplementByCash,
  quoteSellByShares,
  quoteSellComplementByShares
} from "../../../src/engine/pricing";

describe("execution quote builder", () => {
  const binaryState = {
    liquidityB: "1000.00000000",
    qShares: ["0.000000", "0.000000"]
  };
  const binarySellState = {
    liquidityB: "1000.00000000",
    qShares: ["100.000000", "0.000000"]
  };
  const multiState = {
    liquidityB: "1000.00000000",
    qShares: ["0.000000", "0.000000", "0.000000"]
  };
  const multiSellState = {
    liquidityB: "1000.00000000",
    qShares: ["0.000000", "100.000000", "100.000000"]
  };

  it("matches direct YES buy math", () => {
    expect(
      buildExecutionQuote({
        side: "buy",
        marketState: binaryState,
        executionLegCount: 1,
        requestedOutcomeIndex: 0,
        executionOutcomeIndex: 0,
        cashAmount: "100.000000"
      })
    ).toEqual(quoteBuyByCash(binaryState, 0, "100.000000"));
  });

  it("matches binary NO buy math through the opposite execution outcome", () => {
    expect(
      buildExecutionQuote({
        side: "buy",
        marketState: binaryState,
        executionLegCount: 1,
        requestedOutcomeIndex: 0,
        executionOutcomeIndex: 1,
        cashAmount: "100.000000"
      })
    ).toEqual(quoteBuyByCash(binaryState, 1, "100.000000"));
  });

  it("matches multi-outcome complement buy and sell math", () => {
    expect(
      buildExecutionQuote({
        side: "buy",
        marketState: multiState,
        executionLegCount: 2,
        requestedOutcomeIndex: 0,
        executionOutcomeIndex: -1,
        cashAmount: "100.000000"
      })
    ).toEqual(quoteBuyComplementByCash(multiState, 0, "100.000000"));

    expect(
      buildExecutionQuote({
        side: "sell",
        marketState: multiSellState,
        executionLegCount: 2,
        requestedOutcomeIndex: 0,
        executionOutcomeIndex: -1,
        shareAmount: "10.000000"
      })
    ).toEqual(quoteSellComplementByShares(multiSellState, 0, "10.000000"));
  });

  it("matches direct sell math", () => {
    expect(
      buildExecutionQuote({
        side: "sell",
        marketState: binarySellState,
        executionLegCount: 1,
        requestedOutcomeIndex: 0,
        executionOutcomeIndex: 0,
        shareAmount: "10.000000"
      })
    ).toEqual(quoteSellByShares(binarySellState, 0, "10.000000"));
  });
});
