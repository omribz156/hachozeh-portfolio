import { normalizeDecimal, PRICE_SCALE, toDecimal } from "../../shared/decimals";

export type PriceImpactLevel = "low" | "medium" | "high" | "extreme";
export type PriceImpactDirection = "up" | "down" | "flat";

export type PriceImpact = {
  delta: string;
  absDelta: string;
  percentPoints: string;
  level: PriceImpactLevel;
  direction: PriceImpactDirection;
};

export function classifyPriceImpactPercentPoints(absPercentPoints: number): PriceImpactLevel {
  if (absPercentPoints >= 15) {
    return "extreme";
  }

  if (absPercentPoints >= 5) {
    return "high";
  }

  if (absPercentPoints >= 1) {
    return "medium";
  }

  return "low";
}

export function buildPriceImpact(priceBefore: string, priceAfter: string): PriceImpact {
  const delta = toDecimal(priceAfter).minus(priceBefore);
  const absDelta = delta.abs();
  const percentPoints = absDelta.mul(100);

  return {
    delta: normalizeDecimal(delta, PRICE_SCALE),
    absDelta: normalizeDecimal(absDelta, PRICE_SCALE),
    percentPoints: percentPoints.toFixed(4),
    level: classifyPriceImpactPercentPoints(percentPoints.toNumber()),
    direction: delta.isPositive() ? "up" : delta.isNegative() ? "down" : "flat"
  };
}
