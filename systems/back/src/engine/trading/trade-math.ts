import {
  floorMoneyDecimal,
  parseDecimalString,
  quantizeMoney
} from "../../shared/decimals";

export function splitCostBasisAcrossExecutionLegs(
  cashSpent: string,
  legCount: number
): string[] {
  if (legCount <= 0) {
    return [];
  }

  const total = parseDecimalString(cashSpent, {
    fieldName: "cashSpent",
    allowNegative: false,
    allowZero: false,
    maxScale: 6
  });
  const baseLegCost = floorMoneyDecimal(total.div(legCount));

  return Array.from({ length: legCount }, (_, index) => {
    if (index === legCount - 1) {
      return quantizeMoney(total.minus(baseLegCost.mul(legCount - 1)));
    }

    return quantizeMoney(baseLegCost);
  });
}
