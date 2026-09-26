import {
  calculateLmsrPrices,
  deriveQSharesFromProbabilities,
  quoteBuyByCash,
  quoteBuyComplementByCash
} from "./lmsr";

export type DepthLadderAction = "buy_yes" | "buy_no";

export type DepthLadderInput = {
  liquidityBands: readonly string[];
  cashAmounts: readonly string[];
  probabilities: readonly string[];
  action: DepthLadderAction;
  anchorOutcomeIndex?: number;
};

export type DepthLadderRow = {
  action: DepthLadderAction;
  liquidityB: string;
  cashAmount: string;
  outcomeCount: number;
  anchorOutcomeIndex: number;
  priceBefore: string;
  priceAfter: string;
  priceDelta: string;
  absPriceDelta: string;
  cashSpent: string;
  unspentCash: string;
  sharesBought: string;
  averageExecutionPrice: string;
  priceImpactPercentPoints: string;
};

function formatFixed(value: number, decimals: number): string {
  return value.toFixed(decimals);
}

function resolveAnchorOutcomeIndex(input: DepthLadderInput): number {
  const anchorOutcomeIndex = input.anchorOutcomeIndex ?? 0;

  if (
    !Number.isInteger(anchorOutcomeIndex) ||
    anchorOutcomeIndex < 0 ||
    anchorOutcomeIndex >= input.probabilities.length
  ) {
    throw new Error("anchorOutcomeIndex must point at an existing probability");
  }

  return anchorOutcomeIndex;
}

export function buildLmsrDepthLadder(input: DepthLadderInput): DepthLadderRow[] {
  if (input.probabilities.length < 2) {
    throw new Error("Depth ladder requires at least two outcome probabilities");
  }

  const anchorOutcomeIndex = resolveAnchorOutcomeIndex(input);

  return input.liquidityBands.flatMap((liquidityB) => {
    const qShares = deriveQSharesFromProbabilities(input.probabilities, liquidityB);

    return input.cashAmounts.map((cashAmount) => {
      const quote =
        input.action === "buy_no"
          ? quoteBuyComplementByCash(
              {
                liquidityB,
                qShares
              },
              anchorOutcomeIndex,
              cashAmount
            )
          : quoteBuyByCash(
              {
                liquidityB,
                qShares
              },
              anchorOutcomeIndex,
              cashAmount
            );
      const priceDelta = Number(quote.priceAfter) - Number(quote.priceBefore);
      const nextPrices = calculateLmsrPrices({
        liquidityB,
        qShares: quote.nextQShares
      });
      const priceSum = nextPrices.reduce((sum, price) => sum + Number(price), 0);

      if (Math.abs(priceSum - 1) > 0.0000001) {
        throw new Error(`LMSR price sum drifted after depth quote: ${priceSum}`);
      }

      return {
        action: input.action,
        liquidityB,
        cashAmount,
        outcomeCount: input.probabilities.length,
        anchorOutcomeIndex,
        priceBefore: quote.priceBefore,
        priceAfter: quote.priceAfter,
        priceDelta: formatFixed(priceDelta, 8),
        absPriceDelta: formatFixed(Math.abs(priceDelta), 8),
        cashSpent: quote.cashSpent,
        unspentCash: quote.unspentCash,
        sharesBought: quote.sharesBought,
        averageExecutionPrice: quote.averageExecutionPrice,
        priceImpactPercentPoints: formatFixed(priceDelta * 100, 4)
      };
    });
  });
}
