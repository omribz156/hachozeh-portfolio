import {
  floorMoneyDecimal,
  parseDecimalString,
  quantizeMoney,
  toDecimal
} from "../../shared/decimals";
import { calculateLmsrPrices } from "../pricing";

export type LegProceedsInput = {
  proceedsReceived: string;
  legs: ReadonlyArray<{ outcomeId: string }>;
  liquidityB: string;
  qShares: readonly string[];
  outcomeIndexById: ReadonlyMap<string, number>;
};

/**
 * Splits a complement-bundle sell's total proceeds across its execution legs.
 *
 * LMSR prices the bundle jointly, so there is no engine-native per-leg
 * proceeds figure — this attribution is a product convention. We weight each
 * leg by its pre-trade outcome price so per-leg realized PnL tracks what the
 * leg was actually worth at execution, instead of an equal split that books
 * phantom gains on cheap legs and phantom losses on expensive ones.
 *
 * Invariant: the returned amounts sum to proceedsReceived EXACTLY. Every leg
 * except the heaviest is floored to money scale; the heaviest leg absorbs the
 * rounding residual (smallest relative distortion).
 */
export function attributeLegProceeds(input: LegProceedsInput): Map<string, string> {
  const proceeds = parseDecimalString(input.proceedsReceived, {
    fieldName: "proceedsReceived",
    allowNegative: false,
    allowZero: false,
    maxScale: 6
  });

  if (input.legs.length === 1) {
    const onlyLeg = input.legs[0]!;
    return new Map([[onlyLeg.outcomeId, quantizeMoney(proceeds)]]);
  }

  const prices = calculateLmsrPrices({
    liquidityB: input.liquidityB,
    qShares: input.qShares
  });

  const weights = input.legs.map((leg) => {
    const outcomeIndex = input.outcomeIndexById.get(leg.outcomeId);
    const price = outcomeIndex === undefined ? undefined : prices[outcomeIndex];
    return price === undefined ? toDecimal(0) : toDecimal(price);
  });
  let totalWeight = weights.reduce((sum, weight) => sum.plus(weight), toDecimal(0));

  // Degenerate market state (all leg prices zero) — fall back to equal
  // weights rather than dividing by zero. The residual rule still holds.
  if (totalWeight.lte(0)) {
    weights.fill(toDecimal(1));
    totalWeight = toDecimal(input.legs.length);
  }

  let residualLegIndex = 0;
  weights.forEach((weight, index) => {
    if (weight.gt(weights[residualLegIndex]!)) {
      residualLegIndex = index;
    }
  });

  const attribution = new Map<string, string>();
  let allocated = toDecimal(0);

  input.legs.forEach((leg, index) => {
    if (index === residualLegIndex) {
      return;
    }

    const legShare = floorMoneyDecimal(proceeds.mul(weights[index]!).div(totalWeight));
    attribution.set(leg.outcomeId, quantizeMoney(legShare));
    allocated = allocated.plus(legShare);
  });

  const residualLeg = input.legs[residualLegIndex]!;
  attribution.set(residualLeg.outcomeId, quantizeMoney(proceeds.minus(allocated)));

  return attribution;
}
