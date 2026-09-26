import {
  EngineDecimal,
  normalizeDecimal,
  PRICE_SCALE,
  SHARES_SCALE,
  toDecimal
} from "../../shared/decimals";
import {
  calculateLmsrCost,
  calculateLmsrPrices,
  deriveQSharesFromProbabilities
} from "./lmsr";

export type LiquidityRebasePlanInput = {
  currentLiquidityB: string;
  targetLiquidityB: string;
  currentQShares: readonly string[];
};

export type LiquidityRebasePlan = {
  currentLiquidityB: string;
  targetLiquidityB: string;
  outcomeCount: number;
  currentQShares: string[];
  targetQShares: string[];
  currentPrices: string[];
  targetPrices: string[];
  maxPriceDrift: string;
  lmsrCostBefore: string;
  lmsrCostAfter: string;
  lmsrCostDelta: string;
};

export const MAX_EXECUTABLE_REBASE_PRICE_DRIFT = "0.00000001";

function maxPriceDrift(currentPrices: readonly string[], targetPrices: readonly string[]): string {
  const max = currentPrices.reduce((largest, price, index) => {
    const drift = toDecimal(targetPrices[index] ?? "0").minus(price).abs();
    return drift.greaterThan(largest) ? drift : largest;
  }, toDecimal(0));

  return normalizeDecimal(max, PRICE_SCALE);
}

function normalizeProbabilityVector(probabilities: readonly string[]): string[] {
  const parsed = probabilities.map((value) => toDecimal(value));
  const sum = parsed.reduce((total, value) => total.plus(value), toDecimal(0));
  const diff = toDecimal(1).minus(sum);

  if (diff.isZero()) {
    return [...probabilities];
  }

  let largestIndex = 0;

  for (let index = 1; index < parsed.length; index += 1) {
    if (parsed[index]!.greaterThan(parsed[largestIndex]!)) {
      largestIndex = index;
    }
  }

  parsed[largestIndex] = parsed[largestIndex]!.plus(diff);

  return parsed.map((value) => normalizeDecimal(value, PRICE_SCALE));
}

function readMinimumQShare(qShares: readonly string[]) {
  return EngineDecimal.min(...qShares.map((value) => toDecimal(value)));
}

function preserveQShareGauge(
  targetQShares: readonly string[],
  currentQShares: readonly string[]
): string[] {
  const currentMin = readMinimumQShare(currentQShares);

  return targetQShares.map((value) =>
    normalizeDecimal(toDecimal(value).plus(currentMin), SHARES_SCALE)
  );
}

export function buildPricePreservingLiquidityRebasePlan(
  input: LiquidityRebasePlanInput
): LiquidityRebasePlan {
  const currentPrices = normalizeProbabilityVector(calculateLmsrPrices({
    liquidityB: input.currentLiquidityB,
    qShares: input.currentQShares
  }));
  const targetQShares = preserveQShareGauge(
    deriveQSharesFromProbabilities(currentPrices, input.targetLiquidityB),
    input.currentQShares
  );
  const targetPrices = calculateLmsrPrices({
    liquidityB: input.targetLiquidityB,
    qShares: targetQShares
  });
  const lmsrCostBefore = calculateLmsrCost({
    liquidityB: input.currentLiquidityB,
    qShares: input.currentQShares
  });
  const lmsrCostAfter = calculateLmsrCost({
    liquidityB: input.targetLiquidityB,
    qShares: targetQShares
  });

  return {
    currentLiquidityB: normalizeDecimal(input.currentLiquidityB, PRICE_SCALE),
    targetLiquidityB: normalizeDecimal(input.targetLiquidityB, PRICE_SCALE),
    outcomeCount: input.currentQShares.length,
    currentQShares: input.currentQShares.map((value) => normalizeDecimal(value, SHARES_SCALE)),
    targetQShares,
    currentPrices,
    targetPrices,
    maxPriceDrift: maxPriceDrift(currentPrices, targetPrices),
    lmsrCostBefore,
    lmsrCostAfter,
    lmsrCostDelta: toDecimal(lmsrCostAfter).minus(lmsrCostBefore).toFixed(18)
  };
}

export function assertExecutableLiquidityRebasePlan(plan: LiquidityRebasePlan): void {
  if (toDecimal(plan.maxPriceDrift).greaterThan(MAX_EXECUTABLE_REBASE_PRICE_DRIFT)) {
    throw new Error(
      `liquidity rebase price drift ${plan.maxPriceDrift} exceeds ${MAX_EXECUTABLE_REBASE_PRICE_DRIFT}`
    );
  }
}
