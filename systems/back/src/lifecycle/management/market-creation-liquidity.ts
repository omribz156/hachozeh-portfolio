import { normalizeDecimal, parseDecimalString } from "../../shared/decimals";

type MarketCreationLiquidityInput = {
  marketId?: string | null;
  categoryKey?: string | null;
  familyKey?: string | null;
  liquidityB: string;
  outcomeCount: number;
};

function isExplicitTestOrStressMarket(input: MarketCreationLiquidityInput): boolean {
  const marketId = (input.marketId ?? "").toLowerCase();
  const categoryKey = (input.categoryKey ?? "").toLowerCase();
  const familyKey = (input.familyKey ?? "").toLowerCase();

  return (
    marketId.startsWith("stress-") ||
    marketId.includes("gauntlet") ||
    marketId.includes("toy") ||
    categoryKey === "stress" ||
    categoryKey === "test" ||
    categoryKey === "toy" ||
    familyKey.includes("stress") ||
    familyKey.includes("gauntlet") ||
    familyKey.includes("toy")
  );
}

export function resolveMarketCreationLiquidityB(
  input: MarketCreationLiquidityInput
): string {
  const candidateLiquidity = parseDecimalString(input.liquidityB, {
    fieldName: "liquidityB",
    allowNegative: false,
    allowZero: false,
    maxScale: 8
  });

  // Test/stress/gauntlet rigs set b by hand for a precise mechanics target —
  // honor it exactly, no outcome scaling.
  if (isExplicitTestOrStressMarket(input)) {
    return normalizeDecimal(candidateLiquidity, 8);
  }

  // Real markets: no preset floor — depth is gated by hand at publish, and the
  // supplied liquidityB IS the intended (binary-equivalent) depth. Scale it by
  // N/2 for the outcome count: LMSR depth is shared across all of a market's
  // outcomes, so the same b is swingier per V₪ as N grows (each outcome starts
  // at 1/N with more headroom, and flow splits more ways). N=2 ×1, 3 ×1.5,
  // 4 ×2 keeps the per-outcome feel constant. The treasury reserve (b·ln N)
  // follows the scaled b automatically (see publish-market/reserve-policy.ts).
  const outcomeCount = Math.max(2, input.outcomeCount);
  const scaledLiquidity = candidateLiquidity.mul(outcomeCount).div(2);

  return normalizeDecimal(scaledLiquidity, 8);
}
