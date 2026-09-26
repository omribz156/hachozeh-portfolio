import {
  quoteBuyByCash,
  quoteBuyComplementByCash,
  quoteSellByShares,
  quoteSellComplementByShares,
  type BuyQuote,
  type SellQuote
} from "./lmsr";

export type ExecutionQuoteMarketState = {
  liquidityB: string;
  qShares: readonly string[];
};

export type ExecutionQuoteInput =
  | {
      side: "buy";
      marketState: ExecutionQuoteMarketState;
      executionLegCount: number;
      requestedOutcomeIndex: number;
      executionOutcomeIndex: number;
      cashAmount: string;
    }
  | {
      side: "sell";
      marketState: ExecutionQuoteMarketState;
      executionLegCount: number;
      requestedOutcomeIndex: number;
      executionOutcomeIndex: number;
      shareAmount: string;
    };

export function buildExecutionQuote(
  input: Extract<ExecutionQuoteInput, { side: "buy" }>
): BuyQuote;
export function buildExecutionQuote(
  input: Extract<ExecutionQuoteInput, { side: "sell" }>
): SellQuote;
export function buildExecutionQuote(input: ExecutionQuoteInput): BuyQuote | SellQuote {
  if (input.executionLegCount > 1) {
    return input.side === "buy"
      ? quoteBuyComplementByCash(
          input.marketState,
          input.requestedOutcomeIndex,
          input.cashAmount
        )
      : quoteSellComplementByShares(
          input.marketState,
          input.requestedOutcomeIndex,
          input.shareAmount
        );
  }

  return input.side === "buy"
    ? quoteBuyByCash(
        input.marketState,
        input.executionOutcomeIndex,
        input.cashAmount
      )
    : quoteSellByShares(
        input.marketState,
        input.executionOutcomeIndex,
        input.shareAmount
      );
}
