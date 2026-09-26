import type { PoolClient } from "pg";

import { updateAccountBalance } from "../../shared/account-balances";
import {
  floorMoneyDecimal,
  parseDecimalString,
  quantizeMoney,
  quantizeShares,
  toDecimal
} from "../../shared/decimals";
import type { ContractExecutionResolution } from "../contract-side-normalization";
import { buildPriceImpact, buildExecutionQuote, isQuantizedZeroSellError, type SellQuote } from "../pricing";
import { checkSellOwnership } from "../sell-ownership";
import { completeIdempotencyRecord } from "./idempotency";
import { attributeLegProceeds } from "./leg-proceeds-attribution";
import { insertLedgerTransactionWithEntries } from "./ledger-writes";
import { readLockedContractPosition, readLockedPositions } from "./locked-reads";
import {
  updateMarketPricingState,
  updateOutcomeStatePrices
} from "./pricing-state-writes";
import {
  deleteContractPosition,
  deletePosition,
  upsertContractPosition,
  upsertPosition
} from "./position-writes";
import { TradeServiceError } from "./trade-errors";
import {
  insertAuditEvent,
  insertRealizationEvent,
  insertTradeExecutionLegs,
  insertTradeRecord
} from "./trade-record-writes";
import { buildResponseExecutionLegs } from "./trade-response";
import type { AccountRow, MarketRow, TradeResponse } from "./trade-types";

type CommonFields = {
  tradeId: string;
  requestId: string | null;
  marketKey: string;
  marketId: string;
  marketStateVersionBefore: number;
  marketStateVersionAfter: number;
  executedAt: string;
  contractSide: "yes" | "no";
  outcomeKey: string;
  outcomeId: string;
  executionOutcomeKey: string | null;
  executionOutcomeId: string | null;
  quoteId: string | null;
};

type SellRequest = {
  shareAmount: string;
  idempotencyKey: string;
  quoteId: string | null;
};

function mapSellQuoteError(error: unknown): never {
  if (isQuantizedZeroSellError(error)) {
    throw new TradeServiceError(
      409,
      "untradeable_amount",
      "Requested sell amount is too small to produce executable proceeds at the current price."
    );
  }

  throw error;
}

export async function executeSellLegs(
  client: PoolClient,
  params: {
    actorId: string;
    marketId: string;
    contractResolution: ContractExecutionResolution;
    marketRow: MarketRow;
    marketRows: readonly { outcome_id: string; q_shares: string }[];
    qShares: string[];
    outcomeIds: string[];
    requestedOutcomeIndex: number;
    executionOutcomeIndex: number;
    userCashAccount: AccountRow;
    marketTreasuryAccount: AccountRow;
    request: SellRequest;
    common: CommonFields;
    idempotencyRecordId: string;
    tradeId: string;
    marketStateVersionBefore: number;
  }
): Promise<TradeResponse> {
  const {
    actorId,
    marketId,
    contractResolution,
    marketRow,
    marketRows,
    qShares,
    outcomeIds,
    requestedOutcomeIndex,
    executionOutcomeIndex,
    userCashAccount,
    marketTreasuryAccount,
    request,
    common,
    idempotencyRecordId,
    tradeId,
    marketStateVersionBefore
  } = params;

  const requestedShares = parseDecimalString(request.shareAmount, {
    fieldName: "shareAmount",
    allowNegative: false,
    allowZero: false,
    maxScale: 6
  });
  const contractPositionBefore = await readLockedContractPosition(
    client,
    actorId,
    marketId,
    contractResolution.requestedOutcomeId,
    contractResolution.contractSide
  );

  const contractOwnership = checkSellOwnership(
    contractPositionBefore,
    requestedShares,
    "contractPositionShares"
  );

  if (!contractOwnership.ok || !contractPositionBefore) {
    throw new TradeServiceError(
      400,
      "insufficient_shares",
      "Requested sell amount exceeds owned shares."
    );
  }
  const ownedContractPosition = contractPositionBefore;
  const ownedContractShares = contractOwnership.ownedShares;

  const executionLegRows = await readLockedPositions(
    client,
    actorId,
    marketId,
    contractResolution.executionLegs.map((leg) => leg.outcomeId)
  );

  if (executionLegRows.size !== contractResolution.executionLegs.length) {
    throw new TradeServiceError(
      400,
      "insufficient_shares",
      "Requested sell amount exceeds owned shares."
    );
  }

  let minOwnedShares: ReturnType<typeof toDecimal> | null = null;

  for (const leg of contractResolution.executionLegs) {
    const position = executionLegRows.get(leg.outcomeId);

    if (!position) {
      minOwnedShares = toDecimal(0);
      break;
    }

    const ownedShares = parseDecimalString(position.shares, {
      fieldName: "positionShares",
      allowNegative: false,
      allowZero: false,
      maxScale: 6
    });

    if (minOwnedShares === null || ownedShares.lt(minOwnedShares)) {
      minOwnedShares = ownedShares;
    }
  }

  if (!minOwnedShares || requestedShares.gt(minOwnedShares)) {
    throw new TradeServiceError(
      400,
      "insufficient_shares",
      "Requested sell amount exceeds owned shares."
    );
  }

  const quote: SellQuote = (() => {
    try {
      return buildExecutionQuote({
        side: "sell",
        marketState: {
          liquidityB: marketRow.liquidity_b,
          qShares
        },
        executionLegCount: contractResolution.executionLegs.length,
        requestedOutcomeIndex,
        executionOutcomeIndex,
        shareAmount: request.shareAmount
      });
    } catch (error) {
      throw mapSellQuoteError(error);
    }
  })();
  const currentTreasury = parseDecimalString(marketTreasuryAccount.balance_cached, {
    fieldName: "marketTreasuryBalance",
    allowNegative: false,
    allowZero: true,
    maxScale: 6
  });
  const proceedsReceived = parseDecimalString(quote.proceedsReceived, {
    fieldName: "proceedsReceived",
    allowNegative: false,
    allowZero: false,
    maxScale: 6
  });

  if (proceedsReceived.gt(currentTreasury)) {
    throw new TradeServiceError(
      409,
      "insufficient_cash",
      "Market treasury cannot cover sell proceeds."
    );
  }

  const currentCash = parseDecimalString(userCashAccount.balance_cached, {
    fieldName: "userCashBalance",
    allowNegative: false,
    allowZero: true,
    maxScale: 6
  });
  // Per-leg proceeds are value-weighted by pre-trade outcome price and sum
  // exactly to proceedsReceived — see leg-proceeds-attribution.ts.
  const legProceeds = attributeLegProceeds({
    proceedsReceived: quote.proceedsReceived,
    legs: contractResolution.executionLegs,
    liquidityB: marketRow.liquidity_b,
    qShares,
    outcomeIndexById: new Map(marketRows.map((row, index) => [row.outcome_id, index]))
  });
  const legSettlements = contractResolution.executionLegs.map((leg) => {
    const position = executionLegRows.get(leg.outcomeId)!;
    const currentCostBasis = parseDecimalString(position.cost_basis, {
      fieldName: "positionCostBasis",
      allowNegative: false,
      allowZero: true,
      maxScale: 6
    });
    const ownedShares = parseDecimalString(position.shares, {
      fieldName: "positionShares",
      allowNegative: false,
      allowZero: false,
      maxScale: 6
    });
    const averageEntryPrice = currentCostBasis.div(ownedShares);
    const removedCostBasis = quantizeMoney(
      currentCostBasis.eq(0)
        ? "0.000000"
        : floorMoneyDecimal(averageEntryPrice.mul(requestedShares))
    );
    const nextSharesDecimal = ownedShares.minus(requestedShares);
    const nextCostBasis = nextSharesDecimal.gt(0)
      ? quantizeMoney(
          currentCostBasis.minus(parseDecimalString(removedCostBasis, {
            fieldName: "removedCostBasis",
            allowNegative: false,
            allowZero: true,
            maxScale: 6
          }))
        )
      : "0.000000";
    const shareOfProceeds = legProceeds.get(leg.outcomeId)!;
    const realizedPnlDelta = quantizeMoney(
      toDecimal(shareOfProceeds).minus(parseDecimalString(removedCostBasis, {
        fieldName: "removedCostBasis",
        allowNegative: false,
        allowZero: true,
        maxScale: 6
      }))
    );

    return {
      outcomeId: leg.outcomeId,
      removedCostBasis,
      nextSharesDecimal,
      nextShares: quantizeShares(nextSharesDecimal),
      nextCostBasis,
      nextRealizedPnl: quantizeMoney(
        toDecimal(position.realized_pnl).plus(realizedPnlDelta)
      ),
      shareOfProceeds,
      realizedPnlDelta
    };
  });
  const removedCostBasisTotal = quantizeMoney(
    legSettlements.reduce(
      (sum, leg) =>
        sum.plus(
          parseDecimalString(leg.removedCostBasis, {
            fieldName: "removedCostBasis",
            allowNegative: false,
            allowZero: true,
            maxScale: 6
          })
        ),
      toDecimal(0)
    )
  );
  const contractCostBasisBefore = parseDecimalString(ownedContractPosition.cost_basis, {
    fieldName: "contractPositionCostBasis",
    allowNegative: false,
    allowZero: true,
    maxScale: 6
  });
  const contractRemovedCostBasis = quantizeMoney(
    contractCostBasisBefore.eq(0)
      ? "0.000000"
      : floorMoneyDecimal(contractCostBasisBefore.div(ownedContractShares).mul(requestedShares))
  );
  const nextContractSharesDecimal = ownedContractShares.minus(requestedShares);
  const nextContractCostBasis = nextContractSharesDecimal.gt(0)
    ? quantizeMoney(
        contractCostBasisBefore.minus(parseDecimalString(contractRemovedCostBasis, {
          fieldName: "contractRemovedCostBasis",
          allowNegative: false,
          allowZero: true,
          maxScale: 6
        }))
      )
    : "0.000000";
  const contractRealizedPnlDelta = quantizeMoney(
    proceedsReceived.minus(parseDecimalString(contractRemovedCostBasis, {
      fieldName: "contractRemovedCostBasis",
      allowNegative: false,
      allowZero: true,
      maxScale: 6
    }))
  );
  const nextContractRealizedPnl = quantizeMoney(
    toDecimal(ownedContractPosition.realized_pnl).plus(contractRealizedPnlDelta)
  );
  const realizedPnlDelta = quantizeMoney(
    proceedsReceived.minus(parseDecimalString(removedCostBasisTotal, {
      fieldName: "removedCostBasisTotal",
      allowNegative: false,
      allowZero: true,
      maxScale: 6
    }))
  );
  const nextCashBalance = quantizeMoney(currentCash.plus(proceedsReceived));
  const nextTreasuryBalance = quantizeMoney(currentTreasury.minus(proceedsReceived));

  await updateAccountBalance(client, userCashAccount.id, nextCashBalance);
  await updateAccountBalance(client, marketTreasuryAccount.id, nextTreasuryBalance);
  await updateOutcomeStatePrices(
    client,
    marketId,
    outcomeIds,
    quote.nextQShares,
    marketRow.liquidity_b
  );
  await updateMarketPricingState(client, marketId, quote.proceedsReceived);

  for (const leg of legSettlements) {
    if (leg.nextSharesDecimal.gt(0)) {
      await upsertPosition(
        client,
        actorId,
        marketId,
        leg.outcomeId,
        leg.nextShares,
        leg.nextCostBasis,
        leg.nextRealizedPnl
      );
    } else {
      await deletePosition(
        client,
        actorId,
        marketId,
        leg.outcomeId
      );
    }
  }
  if (nextContractSharesDecimal.gt(0)) {
    await upsertContractPosition(
      client,
      actorId,
      marketId,
      contractResolution.requestedOutcomeId,
      contractResolution.requestedOutcomeKey,
      contractResolution.contractSide,
      quantizeShares(nextContractSharesDecimal),
      nextContractCostBasis,
      nextContractRealizedPnl
    );
  } else {
    await deleteContractPosition(
      client,
      actorId,
      marketId,
      contractResolution.requestedOutcomeId,
      contractResolution.contractSide
    );
  }

  await insertTradeRecord(
    client,
    tradeId,
    marketId,
    contractResolution.requestedOutcomeKey,
    contractResolution.executionOutcomeId ?? contractResolution.requestedOutcomeId,
    actorId,
    "sell",
    contractResolution.contractSide,
    quote.proceedsReceived,
    quantizeShares(requestedShares),
    quote.averageExecutionPrice,
    quote.priceBefore,
    quote.priceAfter,
    request.idempotencyKey,
    marketStateVersionBefore + 1
  );
  await insertTradeExecutionLegs(
    client,
    tradeId,
    contractResolution.executionLegs.map((leg) => ({
      outcomeId: leg.outcomeId,
      shareAmount: quantizeShares(requestedShares)
    }))
  );
  for (const leg of legSettlements) {
    await insertRealizationEvent(
      client,
      actorId,
      marketId,
      leg.outcomeId,
      tradeId,
      quantizeShares(requestedShares),
      leg.shareOfProceeds,
      leg.removedCostBasis,
      leg.realizedPnlDelta
    );
  }
  await insertLedgerTransactionWithEntries(client, {
    tradeId,
    actorId,
    marketId,
    outcomeId:
      contractResolution.executionOutcomeId ?? contractResolution.requestedOutcomeId,
    side: "sell",
    idempotencyKey: request.idempotencyKey,
    amount: quote.proceedsReceived,
    priceBefore: quote.priceBefore,
    priceAfter: quote.priceAfter,
    userCashAccountId: userCashAccount.id,
    marketTreasuryAccountId: marketTreasuryAccount.id
  });

  const response: TradeResponse = {
    ...common,
    side: "sell",
    executionLegs: buildResponseExecutionLegs(
      contractResolution,
      quantizeShares(requestedShares)
    ),
    priceBefore: quote.priceBefore,
    priceAfter: quote.priceAfter,
    priceImpact: buildPriceImpact(quote.priceBefore, quote.priceAfter),
    averagePrice: quote.averageExecutionPrice,
    availableCashAfter: nextCashBalance,
    positionSharesAfter:
      contractResolution.executionLegs.length === 1
        ? legSettlements[0]?.nextShares ?? null
        : null,
    positionCostBasisAfter:
      contractResolution.executionLegs.length === 1
        ? legSettlements[0]?.nextCostBasis ?? null
        : null,
    sharesSold: quantizeShares(requestedShares),
    proceedsReceived: quote.proceedsReceived,
    realizedPnlDelta
  };

  await insertAuditEvent(client, actorId, tradeId, response);
  await completeIdempotencyRecord(client, idempotencyRecordId, tradeId, response);
  return response;
}
