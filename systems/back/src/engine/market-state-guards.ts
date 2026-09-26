export type MarketTradingStateRow = {
  market_status: string;
  market_close_at?: Date | string | null;
};

export type OutcomeIndexedMarketRow = {
  outcome_id: string;
};

export type ContractExecutionIndexInput = {
  requestedOutcomeId: string;
  executionOutcomeId: string | null;
};

export type ContractExecutionIndexes =
  | {
      ok: true;
      requestedOutcomeIndex: number;
      executionOutcomeIndex: number;
    }
  | {
      ok: false;
      code: "outcome_not_found";
    };

export function isPastMarketClose(
  marketRow: Pick<MarketTradingStateRow, "market_close_at">
): boolean {
  const closeAt = marketRow.market_close_at
    ? new Date(marketRow.market_close_at).getTime()
    : Number.NaN;

  return Number.isFinite(closeAt) && Date.now() >= closeAt;
}

export function isMarketOpenForTrading(marketRow: MarketTradingStateRow): boolean {
  return marketRow.market_status === "open" && !isPastMarketClose(marketRow);
}

export function resolveContractExecutionIndexes(
  marketRows: readonly OutcomeIndexedMarketRow[],
  contractResolution: ContractExecutionIndexInput
): ContractExecutionIndexes {
  const requestedOutcomeIndex = marketRows.findIndex(
    (row) => row.outcome_id === contractResolution.requestedOutcomeId
  );

  if (requestedOutcomeIndex < 0) {
    return {
      ok: false,
      code: "outcome_not_found"
    };
  }

  const executionOutcomeIndex =
    contractResolution.executionOutcomeId === null
      ? -1
      : marketRows.findIndex(
          (row) => row.outcome_id === contractResolution.executionOutcomeId
        );

  if (
    contractResolution.executionOutcomeId !== null &&
    executionOutcomeIndex < 0
  ) {
    return {
      ok: false,
      code: "outcome_not_found"
    };
  }

  return {
    ok: true,
    requestedOutcomeIndex,
    executionOutcomeIndex
  };
}
