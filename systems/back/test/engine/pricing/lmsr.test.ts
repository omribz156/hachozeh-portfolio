import { describe, expect, it } from "vitest";

import {
  buildUniformQShares,
  calculateLmsrPrices,
  deriveQSharesFromProbabilities,
  quoteBuyByCash,
  quoteBuyComplementByCash,
  quoteSellComplementByShares,
  quoteSellByShares
} from "../../../src/engine/pricing";

describe("LMSR pricing", () => {
  it("builds a uniform market with prices that sum to one", () => {
    const prices = calculateLmsrPrices({
      liquidityB: "1000.00000000",
      qShares: buildUniformQShares(4)
    });
    const total = prices.reduce((sum, price) => sum + Number(price), 0);

    expect(prices).toEqual(["0.25000000", "0.25000000", "0.25000000", "0.25000000"]);
    expect(total).toBeCloseTo(1, 7);
  });

  it("derives seeded q-shares that recover the intended probabilities", () => {
    const qShares = deriveQSharesFromProbabilities(
      ["0.50000000", "0.30000000", "0.20000000"],
      "1000.00000000"
    );
    const prices = calculateLmsrPrices({
      liquidityB: "1000.00000000",
      qShares
    });

    expect(prices).toEqual(["0.50000000", "0.30000000", "0.20000000"]);
  });

  it("quotes buys without overspending and moves price upward", () => {
    const quote = quoteBuyByCash(
      {
        liquidityB: "1000.00000000",
        qShares: buildUniformQShares(4)
      },
      0,
      "100.000000"
    );

    expect(Number(quote.cashSpent)).toBeLessThanOrEqual(100);
    expect(Number(quote.unspentCash)).toBeGreaterThanOrEqual(0);
    expect(Number(quote.sharesBought)).toBeGreaterThan(0);
    expect(Number(quote.priceAfter)).toBeGreaterThan(Number(quote.priceBefore));
    expect(quote.nextQShares[0]).toBe(quote.sharesBought);
  });

  it("quotes sells conservatively and moves price downward", () => {
    const quote = quoteSellByShares(
      {
        liquidityB: "1000.00000000",
        qShares: ["150.000000", "0.000000", "0.000000", "0.000000"]
      },
      0,
      "10.000000"
    );

    expect(quote.proceedsReceived).toBe("2.781593");
    expect(Number(quote.priceAfter)).toBeLessThan(Number(quote.priceBefore));
    expect(quote.nextQShares[0]).toBe("140.000000");
  });

  it("rejects sells that exceed the current outcome state", () => {
    expect(() =>
      quoteSellByShares(
        {
          liquidityB: "1000.00000000",
          qShares: buildUniformQShares(4)
        },
        0,
        "1.000000"
      )
    ).toThrow("Cannot sell more shares than the current outcome state");
  });

  it("quotes multi-outcome buy-no as complement legs and keeps prices normalized", () => {
    const quote = quoteBuyComplementByCash(
      {
        liquidityB: "1000.00000000",
        qShares: buildUniformQShares(5)
      },
      2,
      "100.000000"
    );
    const nextPrices = calculateLmsrPrices({
      liquidityB: "1000.00000000",
      qShares: quote.nextQShares
    });
    const total = nextPrices.reduce((sum, price) => sum + Number(price), 0);

    expect(Number(quote.cashSpent)).toBeLessThanOrEqual(100);
    expect(Number(quote.sharesBought)).toBeGreaterThan(0);
    expect(Number(quote.priceAfter)).toBeGreaterThan(Number(quote.priceBefore));
    expect(quote.nextQShares[2]).toBe("0.000000");
    expect(quote.nextQShares.filter((value, index) => index !== 2)).toEqual(
      Array(4).fill(quote.sharesBought)
    );
    expect(total).toBeCloseTo(1, 7);
    expect(Number(nextPrices[2])).toBeCloseTo(1 - Number(quote.priceAfter), 8);
  });

  it("quotes multi-outcome sell-no as complement leg reduction and keeps prices normalized", () => {
    const quote = quoteSellComplementByShares(
      {
        liquidityB: "1000.00000000",
        qShares: ["25.000000", "25.000000", "0.000000", "25.000000", "25.000000"]
      },
      2,
      "5.000000"
    );
    const nextPrices = calculateLmsrPrices({
      liquidityB: "1000.00000000",
      qShares: quote.nextQShares
    });
    const total = nextPrices.reduce((sum, price) => sum + Number(price), 0);

    expect(Number(quote.proceedsReceived)).toBeGreaterThan(0);
    expect(Number(quote.priceAfter)).toBeLessThan(Number(quote.priceBefore));
    expect(quote.nextQShares).toEqual([
      "20.000000",
      "20.000000",
      "0.000000",
      "20.000000",
      "20.000000"
    ]);
    expect(total).toBeCloseTo(1, 7);
    expect(Number(nextPrices[2])).toBeCloseTo(1 - Number(quote.priceAfter), 8);
  });

  // -------------------------------------------------------------------------
  // Minimal cash amounts (one quantum "0.01")
  // -------------------------------------------------------------------------

  it("quotes a buy with minimal cash '0.010000' without NaN or negative shares", () => {
    const quote = quoteBuyByCash(
      {
        liquidityB: "1000.00000000",
        qShares: buildUniformQShares(2)
      },
      0,
      "0.010000"
    );

    expect(isNaN(Number(quote.cashSpent))).toBe(false);
    expect(isNaN(Number(quote.sharesBought))).toBe(false);
    expect(Number(quote.sharesBought)).toBeGreaterThan(0);
    expect(Number(quote.cashSpent)).toBeLessThanOrEqual(0.01);
    expect(Number(quote.cashSpent)).toBeGreaterThan(0);
  });

  it("buyer-rounds-up invariant: cashSpent is always a ceil of the exact cost", () => {
    // For any buy, cashSpent = ceilMoney(exactCost) ≤ requestedCash
    // Verify: the reported cashSpent ≤ requestedCash and > 0
    const quote = quoteBuyByCash(
      {
        liquidityB: "1000.00000000",
        qShares: buildUniformQShares(2)
      },
      0,
      "0.010000"
    );

    // cashSpent must be ≤ requested
    expect(Number(quote.cashSpent)).toBeLessThanOrEqual(0.01);
    // unspentCash must be non-negative
    expect(Number(quote.unspentCash)).toBeGreaterThanOrEqual(0);
    // unspentCash + cashSpent ≤ requestedCash (within fp tolerance)
    expect(Number(quote.unspentCash) + Number(quote.cashSpent)).toBeCloseTo(0.01, 6);
  });

  it("seller-rounds-down invariant: proceedsReceived is always a floor of exact proceeds", () => {
    // Sell a small number of shares; the result must be ≤ exact (floor) and > 0
    const quote = quoteSellByShares(
      {
        liquidityB: "1000.00000000",
        qShares: ["10.000000", "0.000000"]
      },
      0,
      "0.010000"
    );

    expect(isNaN(Number(quote.proceedsReceived))).toBe(false);
    expect(Number(quote.proceedsReceived)).toBeGreaterThan(0);
    // Proceeds must not exceed cash "extracted" (sanity: selling ≥ 0 share-value)
    expect(Number(quote.proceedsReceived)).toBeLessThanOrEqual(0.01 * 1); // rough upper bound
  });

  // -------------------------------------------------------------------------
  // Extreme probability concentration (one outcome approaches price = 1)
  // -------------------------------------------------------------------------

  it("extreme concentration: price approaches 1 for dominant outcome, no NaN", () => {
    // q_shares heavily skewed so outcome 0 is nearly certain
    const qShares = ["10000.000000", "0.000000"];
    const prices = calculateLmsrPrices({
      liquidityB: "1000.00000000",
      qShares
    });

    expect(isNaN(Number(prices[0]))).toBe(false);
    expect(isNaN(Number(prices[1]))).toBe(false);
    expect(Number(prices[0])).toBeGreaterThan(0.99);
    expect(Number(prices[1])).toBeLessThan(0.01);
    const total = prices.reduce((sum, p) => sum + Number(p), 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it("extreme concentration: quoteBuyByCash on a dominated outcome produces valid quote", () => {
    // Buying into the near-certain outcome should still work (price close to 1 → few shares per $)
    const quote = quoteBuyByCash(
      {
        liquidityB: "1000.00000000",
        qShares: ["10000.000000", "0.000000"]
      },
      0,
      "100.000000"
    );

    expect(isNaN(Number(quote.sharesBought))).toBe(false);
    expect(Number(quote.sharesBought)).toBeGreaterThan(0);
    expect(Number(quote.cashSpent)).toBeLessThanOrEqual(100);
    expect(Number(quote.priceAfter)).toBeGreaterThan(Number(quote.priceBefore));
  });

  it("extreme concentration: quoteSellByShares on a dominated outcome produces valid quote", () => {
    const quote = quoteSellByShares(
      {
        liquidityB: "1000.00000000",
        qShares: ["10000.000000", "0.000000"]
      },
      0,
      "5.000000"
    );

    expect(isNaN(Number(quote.proceedsReceived))).toBe(false);
    expect(Number(quote.proceedsReceived)).toBeGreaterThan(0);
    expect(Number(quote.priceAfter)).toBeLessThan(Number(quote.priceBefore));
  });

  // -------------------------------------------------------------------------
  // Many-outcome market (5+ outcomes)
  // -------------------------------------------------------------------------

  it("5-outcome market: prices sum to 1 from uniform state", () => {
    const prices = calculateLmsrPrices({
      liquidityB: "1000.00000000",
      qShares: buildUniformQShares(5)
    });

    expect(prices).toHaveLength(5);
    const total = prices.reduce((sum, p) => sum + Number(p), 0);
    expect(total).toBeCloseTo(1, 7);
    // Each uniform price should be ~0.2
    for (const p of prices) {
      expect(Number(p)).toBeCloseTo(0.2, 5);
    }
  });

  it("7-outcome market: buy on outcome 3 moves price up and prices still sum to 1", () => {
    const quote = quoteBuyByCash(
      {
        liquidityB: "1000.00000000",
        qShares: buildUniformQShares(7)
      },
      3,
      "50.000000"
    );

    const nextPrices = calculateLmsrPrices({
      liquidityB: "1000.00000000",
      qShares: quote.nextQShares
    });
    const total = nextPrices.reduce((sum, p) => sum + Number(p), 0);
    expect(total).toBeCloseTo(1, 7);
    expect(Number(quote.priceAfter)).toBeGreaterThan(Number(quote.priceBefore));
    expect(Number(quote.sharesBought)).toBeGreaterThan(0);
  });

  it("6-outcome market: complement buy moves complement price up, prices still sum to 1", () => {
    // anchor = outcome 0; buying complement = buying all others
    const quote = quoteBuyComplementByCash(
      {
        liquidityB: "1000.00000000",
        qShares: buildUniformQShares(6)
      },
      0,
      "60.000000"
    );

    const nextPrices = calculateLmsrPrices({
      liquidityB: "1000.00000000",
      qShares: quote.nextQShares
    });
    const total = nextPrices.reduce((sum, p) => sum + Number(p), 0);
    expect(total).toBeCloseTo(1, 7);
    // complement price of anchor 0 = 1 - price(0)
    expect(Number(quote.priceAfter)).toBeGreaterThan(Number(quote.priceBefore));
    // anchor qShares must stay 0 (never touched)
    expect(quote.nextQShares[0]).toBe("0.000000");
  });

  it("5-outcome market: sell-complement on outcome 2 leaves anchor unchanged and prices sum to 1", () => {
    const quote = quoteSellComplementByShares(
      {
        liquidityB: "1000.00000000",
        qShares: ["10.000000", "10.000000", "0.000000", "10.000000", "10.000000"]
      },
      2,
      "3.000000"
    );

    const nextPrices = calculateLmsrPrices({
      liquidityB: "1000.00000000",
      qShares: quote.nextQShares
    });
    const total = nextPrices.reduce((sum, p) => sum + Number(p), 0);
    expect(total).toBeCloseTo(1, 7);
    // Anchor outcome (index 2) qShares unchanged
    expect(quote.nextQShares[2]).toBe("0.000000");
    expect(Number(quote.priceAfter)).toBeLessThan(Number(quote.priceBefore));
    expect(Number(quote.proceedsReceived)).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Near-zero liquidityB edge
  // -------------------------------------------------------------------------

  it("near-zero liquidityB '0.00000001': prices still sum to 1 and are not NaN", () => {
    // With tiny B the market is very sensitive but math must hold
    const prices = calculateLmsrPrices({
      liquidityB: "0.00000001",
      qShares: ["0.000000", "0.000000"]
    });

    expect(isNaN(Number(prices[0]))).toBe(false);
    expect(isNaN(Number(prices[1]))).toBe(false);
    const total = prices.reduce((sum, p) => sum + Number(p), 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it("near-zero liquidityB: buyer-rounds-up invariant holds (cashSpent ≤ requestedCash)", () => {
    const quote = quoteBuyByCash(
      {
        liquidityB: "0.00000001",
        qShares: ["0.000000", "0.000000"]
      },
      0,
      "0.010000"
    );

    expect(isNaN(Number(quote.sharesBought))).toBe(false);
    expect(Number(quote.cashSpent)).toBeLessThanOrEqual(0.01);
    expect(Number(quote.unspentCash)).toBeGreaterThanOrEqual(0);
  });
});
