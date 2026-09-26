import Decimal from "decimal.js";

import {
  ceilMoneyDecimal,
  floorMoneyDecimal,
  floorSharesDecimal,
  parseDecimalString,
  PRICE_SCALE,
  quantizeMoney,
  quantizePrice,
  quantizeShares,
  SHARES_SCALE,
  shareStep,
  toDecimal
} from "../../shared/decimals";

export type LmsrMarketState = {
  liquidityB: string;
  qShares: readonly string[];
};

export type BuyQuote = {
  side: "buy";
  requestedCashAmount: string;
  cashSpent: string;
  unspentCash: string;
  sharesBought: string;
  averageExecutionPrice: string;
  priceBefore: string;
  priceAfter: string;
  slippage: string;
  nextQShares: string[];
};

export type SellQuote = {
  side: "sell";
  requestedShareAmount: string;
  sharesSold: string;
  proceedsReceived: string;
  averageExecutionPrice: string;
  priceBefore: string;
  priceAfter: string;
  slippage: string;
  nextQShares: string[];
};

export const QUANTIZED_ZERO_SELL_MESSAGE =
  "Requested sell amount becomes zero after quantization";

export function isQuantizedZeroSellError(error: unknown): boolean {
  return error instanceof Error && error.message === QUANTIZED_ZERO_SELL_MESSAGE;
}

type ParsedState = {
  liquidityB: Decimal;
  qShares: Decimal[];
};

function parseState(state: LmsrMarketState): ParsedState {
  if (state.qShares.length < 2) {
    throw new Error("LMSR state requires at least two outcomes");
  }

  const liquidityB = parseDecimalString(state.liquidityB, {
    fieldName: "liquidityB",
    allowNegative: false,
    allowZero: false,
    maxScale: PRICE_SCALE
  });

  const qShares = state.qShares.map((value, index) =>
    parseDecimalString(value, {
      fieldName: `qShares[${index}]`,
      allowNegative: false,
      allowZero: true,
      maxScale: SHARES_SCALE
    })
  );

  return {
    liquidityB,
    qShares
  };
}

function assertOutcomeIndex(outcomeIndex: number, outcomeCount: number): void {
  if (!Number.isInteger(outcomeIndex) || outcomeIndex < 0 || outcomeIndex >= outcomeCount) {
    throw new Error("Outcome index is out of range");
  }
}

function calculateShiftedWeights(qShares: readonly Decimal[], liquidityB: Decimal) {
  const maxQ = Decimal.max(...qShares);
  const weights = qShares.map((qShare) => qShare.minus(maxQ).div(liquidityB).exp());
  const weightSum = weights.reduce((sum, weight) => sum.plus(weight), toDecimal(0));

  return {
    maxQ,
    weights,
    weightSum
  };
}

function calculatePriceVector(qShares: readonly Decimal[], liquidityB: Decimal): Decimal[] {
  const { weights, weightSum } = calculateShiftedWeights(qShares, liquidityB);
  return weights.map((weight) => weight.div(weightSum));
}

function calculateSinglePrice(
  qShares: readonly Decimal[],
  liquidityB: Decimal,
  outcomeIndex: number
): Decimal {
  return calculatePriceVector(qShares, liquidityB)[outcomeIndex]!;
}

function addShareDelta(
  qShares: readonly Decimal[],
  outcomeIndex: number,
  delta: Decimal
): Decimal[] {
  return qShares.map((value, index) => (index === outcomeIndex ? value.plus(delta) : value));
}

function subtractShareDelta(
  qShares: readonly Decimal[],
  outcomeIndex: number,
  delta: Decimal
): Decimal[] {
  return qShares.map((value, index) => (index === outcomeIndex ? value.minus(delta) : value));
}

function addComplementShareDelta(
  qShares: readonly Decimal[],
  anchorOutcomeIndex: number,
  delta: Decimal
): Decimal[] {
  return qShares.map((value, index) =>
    index === anchorOutcomeIndex ? value : value.plus(delta)
  );
}

function subtractComplementShareDelta(
  qShares: readonly Decimal[],
  anchorOutcomeIndex: number,
  delta: Decimal
): Decimal[] {
  const nextState = qShares.map((value, index) =>
    index === anchorOutcomeIndex ? value : value.minus(delta)
  );

  if (nextState.some((value) => value.isNegative())) {
    throw new Error("Cannot sell more complement shares than the market state currently holds");
  }

  return nextState;
}

function normalizeQShares(qShares: readonly Decimal[]): string[] {
  return qShares.map((value) => quantizeShares(value));
}

function calculateAverageExecutionPrice(amount: Decimal, shares: Decimal): string {
  return quantizePrice(amount.div(shares));
}

function calculateBuySlippage(
  averageExecutionPrice: string,
  priceBefore: string
): string {
  return quantizePrice(toDecimal(averageExecutionPrice).minus(priceBefore));
}

function calculateSellSlippage(
  priceBefore: string,
  averageExecutionPrice: string
): string {
  return quantizePrice(toDecimal(priceBefore).minus(averageExecutionPrice));
}

function calculateComplementPrice(
  qShares: readonly Decimal[],
  liquidityB: Decimal,
  anchorOutcomeIndex: number
): Decimal {
  return toDecimal(1).minus(
    calculateSinglePrice(qShares, liquidityB, anchorOutcomeIndex)
  );
}

function calculateBuySharesExact(
  priceBefore: Decimal,
  liquidityB: Decimal,
  cashAmount: Decimal
): Decimal {
  const growth = cashAmount.div(liquidityB).exp().minus(1);
  return liquidityB.mul(growth.div(priceBefore).plus(1).ln());
}

function calculateTradeCostDecimal(
  qShares: readonly Decimal[],
  liquidityB: Decimal,
  outcomeIndex: number,
  sharesBought: Decimal
): Decimal {
  const beforeCost = calculateLmsrCostDecimal(qShares, liquidityB);
  const afterCost = calculateLmsrCostDecimal(
    addShareDelta(qShares, outcomeIndex, sharesBought),
    liquidityB
  );

  return afterCost.minus(beforeCost);
}

function calculateTradeProceedsDecimal(
  qShares: readonly Decimal[],
  liquidityB: Decimal,
  outcomeIndex: number,
  sharesSold: Decimal
): Decimal {
  const beforeCost = calculateLmsrCostDecimal(qShares, liquidityB);
  const afterState = subtractShareDelta(qShares, outcomeIndex, sharesSold);

  if (afterState[outcomeIndex]!.isNegative()) {
    throw new Error("Cannot sell more shares than the market state currently holds");
  }

  const afterCost = calculateLmsrCostDecimal(afterState, liquidityB);
  return beforeCost.minus(afterCost);
}

function calculateComplementTradeCostDecimal(
  qShares: readonly Decimal[],
  liquidityB: Decimal,
  anchorOutcomeIndex: number,
  sharesBought: Decimal
): Decimal {
  const beforeCost = calculateLmsrCostDecimal(qShares, liquidityB);
  const afterCost = calculateLmsrCostDecimal(
    addComplementShareDelta(qShares, anchorOutcomeIndex, sharesBought),
    liquidityB
  );

  return afterCost.minus(beforeCost);
}

function calculateComplementTradeProceedsDecimal(
  qShares: readonly Decimal[],
  liquidityB: Decimal,
  anchorOutcomeIndex: number,
  sharesSold: Decimal
): Decimal {
  const beforeCost = calculateLmsrCostDecimal(qShares, liquidityB);
  const afterCost = calculateLmsrCostDecimal(
    subtractComplementShareDelta(qShares, anchorOutcomeIndex, sharesSold),
    liquidityB
  );

  return beforeCost.minus(afterCost);
}

function fitBuySharesToCash(
  qShares: readonly Decimal[],
  liquidityB: Decimal,
  outcomeIndex: number,
  requestedCashAmount: Decimal
): {
  sharesBought: Decimal;
  cashSpent: Decimal;
  nextQShares: Decimal[];
} {
  const minShareStep = shareStep();
  let sharesBought = floorSharesDecimal(
    calculateBuySharesExact(
      calculateSinglePrice(qShares, liquidityB, outcomeIndex),
      liquidityB,
      requestedCashAmount
    )
  );

  while (sharesBought.greaterThan(0)) {
    const exactCost = calculateTradeCostDecimal(qShares, liquidityB, outcomeIndex, sharesBought);
    const cashSpent = ceilMoneyDecimal(exactCost);

    if (cashSpent.lte(requestedCashAmount)) {
      return {
        sharesBought,
        cashSpent,
        nextQShares: addShareDelta(qShares, outcomeIndex, sharesBought)
      };
    }

    sharesBought = sharesBought.minus(minShareStep);
  }

  throw new Error("Requested buy amount becomes zero after quantization");
}

function fitComplementBuySharesToCash(
  qShares: readonly Decimal[],
  liquidityB: Decimal,
  anchorOutcomeIndex: number,
  requestedCashAmount: Decimal
): {
  sharesBought: Decimal;
  cashSpent: Decimal;
  nextQShares: Decimal[];
} {
  const minShareStep = shareStep();
  const priceBefore = calculateComplementPrice(qShares, liquidityB, anchorOutcomeIndex);
  let upperBound = floorSharesDecimal(
    requestedCashAmount.div(Decimal.max(priceBefore, toDecimal("0.000001")))
  );

  if (upperBound.lte(0)) {
    upperBound = minShareStep;
  }

  let low = toDecimal(0);
  let high = upperBound;

  while (high.minus(low).gt(minShareStep)) {
    const mid = floorSharesDecimal(low.plus(high).div(2));

    if (mid.lte(0)) {
      break;
    }

    const cashSpent = ceilMoneyDecimal(
      calculateComplementTradeCostDecimal(qShares, liquidityB, anchorOutcomeIndex, mid)
    );

    if (cashSpent.lte(requestedCashAmount)) {
      low = mid;
    } else {
      high = mid.minus(minShareStep);
    }
  }

  let sharesBought = floorSharesDecimal(low);

  while (sharesBought.greaterThan(0)) {
    const exactCost = calculateComplementTradeCostDecimal(
      qShares,
      liquidityB,
      anchorOutcomeIndex,
      sharesBought
    );
    const cashSpent = ceilMoneyDecimal(exactCost);

    if (cashSpent.lte(requestedCashAmount)) {
      return {
        sharesBought,
        cashSpent,
        nextQShares: addComplementShareDelta(qShares, anchorOutcomeIndex, sharesBought)
      };
    }

    sharesBought = sharesBought.minus(minShareStep);
  }

  throw new Error("Requested buy amount becomes zero after quantization");
}

export function buildUniformQShares(outcomeCount: number): string[] {
  if (!Number.isInteger(outcomeCount) || outcomeCount < 2) {
    throw new Error("Uniform LMSR start requires at least two outcomes");
  }

  return Array.from({ length: outcomeCount }, () => quantizeShares(0));
}

export function deriveQSharesFromProbabilities(
  probabilities: readonly string[],
  liquidityBInput: string
): string[] {
  if (probabilities.length < 2) {
    throw new Error("Seeded LMSR state requires at least two outcomes");
  }

  const liquidityB = parseDecimalString(liquidityBInput, {
    fieldName: "liquidityB",
    allowNegative: false,
    allowZero: false,
    maxScale: PRICE_SCALE
  });

  const parsedProbabilities = probabilities.map((value, index) =>
    parseDecimalString(value, {
      fieldName: `probabilities[${index}]`,
      allowNegative: false,
      allowZero: false,
      maxScale: PRICE_SCALE
    })
  );

  const probabilitySum = parsedProbabilities.reduce((sum, value) => sum.plus(value), toDecimal(0));

  if (!probabilitySum.eq(1)) {
    throw new Error("Seeded probabilities must sum to exactly 1.00000000");
  }

  const rawQShares = parsedProbabilities.map((value) => liquidityB.mul(value.ln()));
  const minQShare = Decimal.min(...rawQShares);

  return rawQShares.map((value) => quantizeShares(value.minus(minQShare)));
}

export function calculateLmsrCostDecimal(
  qSharesInput: readonly Decimal[],
  liquidityB: Decimal
): Decimal {
  const { maxQ, weightSum } = calculateShiftedWeights(qSharesInput, liquidityB);
  return maxQ.plus(liquidityB.mul(weightSum.ln()));
}

export function calculateLmsrCost(state: LmsrMarketState): string {
  const parsedState = parseState(state);
  return calculateLmsrCostDecimal(parsedState.qShares, parsedState.liquidityB).toFixed(18);
}

export function calculateLmsrPrices(state: LmsrMarketState): string[] {
  const parsedState = parseState(state);
  return calculatePriceVector(parsedState.qShares, parsedState.liquidityB).map((value) =>
    quantizePrice(value)
  );
}

export function quoteBuyByCash(
  state: LmsrMarketState,
  outcomeIndex: number,
  cashAmountInput: string
): BuyQuote {
  const parsedState = parseState(state);
  assertOutcomeIndex(outcomeIndex, parsedState.qShares.length);

  const requestedCashAmount = parseDecimalString(cashAmountInput, {
    fieldName: "cashAmount",
    allowNegative: false,
    allowZero: false,
    maxScale: SHARES_SCALE
  });
  const priceBefore = calculateSinglePrice(
    parsedState.qShares,
    parsedState.liquidityB,
    outcomeIndex
  );
  const execution = fitBuySharesToCash(
    parsedState.qShares,
    parsedState.liquidityB,
    outcomeIndex,
    requestedCashAmount
  );
  const priceAfter = calculateSinglePrice(
    execution.nextQShares,
    parsedState.liquidityB,
    outcomeIndex
  );
  const averageExecutionPrice = calculateAverageExecutionPrice(
    execution.cashSpent,
    execution.sharesBought
  );

  return {
    side: "buy",
    requestedCashAmount: quantizeMoney(requestedCashAmount),
    cashSpent: quantizeMoney(execution.cashSpent),
    unspentCash: quantizeMoney(requestedCashAmount.minus(execution.cashSpent)),
    sharesBought: quantizeShares(execution.sharesBought),
    averageExecutionPrice,
    priceBefore: quantizePrice(priceBefore),
    priceAfter: quantizePrice(priceAfter),
    slippage: calculateBuySlippage(averageExecutionPrice, quantizePrice(priceBefore)),
    nextQShares: normalizeQShares(execution.nextQShares)
  };
}

export function quoteSellByShares(
  state: LmsrMarketState,
  outcomeIndex: number,
  shareAmountInput: string
): SellQuote {
  const parsedState = parseState(state);
  assertOutcomeIndex(outcomeIndex, parsedState.qShares.length);

  const sharesSold = parseDecimalString(shareAmountInput, {
    fieldName: "shareAmount",
    allowNegative: false,
    allowZero: false,
    maxScale: SHARES_SCALE
  });
  const currentOutcomeShares = parsedState.qShares[outcomeIndex]!;

  if (sharesSold.gt(currentOutcomeShares)) {
    throw new Error("Cannot sell more shares than the current outcome state");
  }

  const priceBefore = calculateSinglePrice(
    parsedState.qShares,
    parsedState.liquidityB,
    outcomeIndex
  );
  const exactProceeds = calculateTradeProceedsDecimal(
    parsedState.qShares,
    parsedState.liquidityB,
    outcomeIndex,
    sharesSold
  );
  const proceedsReceived = floorMoneyDecimal(exactProceeds);

  if (proceedsReceived.lte(0)) {
    throw new Error(QUANTIZED_ZERO_SELL_MESSAGE);
  }

  const nextQShares = subtractShareDelta(parsedState.qShares, outcomeIndex, sharesSold);
  const priceAfter = calculateSinglePrice(nextQShares, parsedState.liquidityB, outcomeIndex);
  const averageExecutionPrice = calculateAverageExecutionPrice(proceedsReceived, sharesSold);

  return {
    side: "sell",
    requestedShareAmount: quantizeShares(sharesSold),
    sharesSold: quantizeShares(sharesSold),
    proceedsReceived: quantizeMoney(proceedsReceived),
    averageExecutionPrice,
    priceBefore: quantizePrice(priceBefore),
    priceAfter: quantizePrice(priceAfter),
    slippage: calculateSellSlippage(quantizePrice(priceBefore), averageExecutionPrice),
    nextQShares: normalizeQShares(nextQShares)
  };
}

export function quoteBuyComplementByCash(
  state: LmsrMarketState,
  anchorOutcomeIndex: number,
  cashAmountInput: string
): BuyQuote {
  const parsedState = parseState(state);
  assertOutcomeIndex(anchorOutcomeIndex, parsedState.qShares.length);

  const requestedCashAmount = parseDecimalString(cashAmountInput, {
    fieldName: "cashAmount",
    allowNegative: false,
    allowZero: false,
    maxScale: SHARES_SCALE
  });
  const priceBefore = calculateComplementPrice(
    parsedState.qShares,
    parsedState.liquidityB,
    anchorOutcomeIndex
  );
  const execution = fitComplementBuySharesToCash(
    parsedState.qShares,
    parsedState.liquidityB,
    anchorOutcomeIndex,
    requestedCashAmount
  );
  const priceAfter = calculateComplementPrice(
    execution.nextQShares,
    parsedState.liquidityB,
    anchorOutcomeIndex
  );
  const averageExecutionPrice = calculateAverageExecutionPrice(
    execution.cashSpent,
    execution.sharesBought
  );

  return {
    side: "buy",
    requestedCashAmount: quantizeMoney(requestedCashAmount),
    cashSpent: quantizeMoney(execution.cashSpent),
    unspentCash: quantizeMoney(requestedCashAmount.minus(execution.cashSpent)),
    sharesBought: quantizeShares(execution.sharesBought),
    averageExecutionPrice,
    priceBefore: quantizePrice(priceBefore),
    priceAfter: quantizePrice(priceAfter),
    slippage: calculateBuySlippage(averageExecutionPrice, quantizePrice(priceBefore)),
    nextQShares: normalizeQShares(execution.nextQShares)
  };
}

export function quoteSellComplementByShares(
  state: LmsrMarketState,
  anchorOutcomeIndex: number,
  shareAmountInput: string
): SellQuote {
  const parsedState = parseState(state);
  assertOutcomeIndex(anchorOutcomeIndex, parsedState.qShares.length);

  const sharesSold = parseDecimalString(shareAmountInput, {
    fieldName: "shareAmount",
    allowNegative: false,
    allowZero: false,
    maxScale: SHARES_SCALE
  });
  const priceBefore = calculateComplementPrice(
    parsedState.qShares,
    parsedState.liquidityB,
    anchorOutcomeIndex
  );
  const exactProceeds = calculateComplementTradeProceedsDecimal(
    parsedState.qShares,
    parsedState.liquidityB,
    anchorOutcomeIndex,
    sharesSold
  );
  const proceedsReceived = floorMoneyDecimal(exactProceeds);

  if (proceedsReceived.lte(0)) {
    throw new Error(QUANTIZED_ZERO_SELL_MESSAGE);
  }

  const nextQShares = subtractComplementShareDelta(
    parsedState.qShares,
    anchorOutcomeIndex,
    sharesSold
  );
  const priceAfter = calculateComplementPrice(
    nextQShares,
    parsedState.liquidityB,
    anchorOutcomeIndex
  );
  const averageExecutionPrice = calculateAverageExecutionPrice(proceedsReceived, sharesSold);

  return {
    side: "sell",
    requestedShareAmount: quantizeShares(sharesSold),
    sharesSold: quantizeShares(sharesSold),
    proceedsReceived: quantizeMoney(proceedsReceived),
    averageExecutionPrice,
    priceBefore: quantizePrice(priceBefore),
    priceAfter: quantizePrice(priceAfter),
    slippage: calculateSellSlippage(quantizePrice(priceBefore), averageExecutionPrice),
    nextQShares: normalizeQShares(nextQShares)
  };
}
