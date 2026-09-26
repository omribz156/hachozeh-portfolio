import type { PoolClient } from "pg";

import { readMinStakeForLiquidityB } from "../../economy/economy-config";
import { updateAccountBalance } from "../../shared/account-balances";
import {
  parseDecimalString,
  quantizeMoney,
  quantizeShares,
  toDecimal
} from "../../shared/decimals";
import type { ContractExecutionResolution } from "../contract-side-normalization";
import { buildPriceImpact, buildExecutionQuote } from "../pricing";
import { completeIdempotencyRecord } from "./idempotency";
import { insertLedgerTransactionWithEntries } from "./ledger-writes";
import { readLockedContractPosition, readLockedPositions } from "./locked-reads";
import {
  updateMarketPricingState,
  updateOutcomeStatePrices
} from "./pricing-state-writes";
import { upsertContractPosition, upsertPosition } from "./position-writes";
import { splitCostBasisAcrossExecutionLegs } from "./trade-math";
import { TradeServiceError } from "./trade-errors";
import {
  insertAuditEvent,
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

type BuyRequest = {
  cashAmount: string;
  idempotencyKey: string;
  quoteId: string | null;
};

export async function executeBuyLegs(
  client: PoolClient,
  params: {
    actorId: string;
    marketId: string;
    contractResolution: ContractExecutionResolution;
    marketRow: MarketRow;
    qShares: string[];
    outcomeIds: string[];
    requestedOutcomeIndex: number;
    executionOutcomeIndex: number;
    userCashAccount: AccountRow;
    marketTreasuryAccount: AccountRow;
    request: BuyRequest;
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

  const quote = buildExecutionQuote({
    side: "buy",
    marketState: {
      liquidityB: marketRow.liquidity_b,
      qShares
    },
    executionLegCount: contractResolution.executionLegs.length,
    requestedOutcomeIndex,
    executionOutcomeIndex,
    cashAmount: request.cashAmount
  });

  const currentCash = parseDecimalString(userCashAccount.balance_cached, {
    fieldName: "userCashBalance",
    allowNegative: false,
    allowZero: true,
    maxScale: 6
  });
  const cashSpent = parseDecimalString(quote.cashSpent, {
    fieldName: "cashSpent",
    allowNegative: false,
    allowZero: false,
    maxScale: 6
  });
  const minStakeAmount = readMinStakeForLiquidityB(marketRow.liquidity_b);
  const minStake = parseDecimalString(minStakeAmount, {
    fieldName: "minStake",
    allowNegative: false,
    allowZero: false,
    maxScale: 6
  });

  if (cashSpent.lt(minStake)) {
    throw new TradeServiceError(
      400,
      "min_stake_not_met",
      `Buy trade requires at least V₪ ${minStakeAmount}.`
    );
  }

  if (cashSpent.gt(currentCash)) {
    throw new TradeServiceError(
      409,
      "insufficient_cash",
      "Trade cash amount exceeds available cash."
    );
  }

  const currentTreasury = parseDecimalString(marketTreasuryAccount.balance_cached, {
    fieldName: "marketTreasuryBalance",
    allowNegative: false,
    allowZero: true,
    maxScale: 6
  });
  const nextCashBalance = quantizeMoney(currentCash.minus(cashSpent));
  const nextTreasuryBalance = quantizeMoney(currentTreasury.plus(cashSpent));

  const contractPositionBefore = await readLockedContractPosition(
    client,
    actorId,
    marketId,
    contractResolution.requestedOutcomeId,
    contractResolution.contractSide
  );
  const executionLegRows = await readLockedPositions(
    client,
    actorId,
    marketId,
    contractResolution.executionLegs.map((leg) => leg.outcomeId)
  );
  const legCostBasisDeltas = splitCostBasisAcrossExecutionLegs(
    quote.cashSpent,
    contractResolution.executionLegs.length
  );
  const nextContractShares = quantizeShares(
    toDecimal(contractPositionBefore?.shares ?? "0.000000").plus(quote.sharesBought)
  );
  const nextContractCostBasis = quantizeMoney(
    toDecimal(contractPositionBefore?.cost_basis ?? "0.000000").plus(quote.cashSpent)
  );
  const nextContractRealizedPnl = quantizeMoney(
    contractPositionBefore?.realized_pnl ?? "0.000000"
  );

  const positionLegsAfter = contractResolution.executionLegs.map((leg, index) => {
    const existingPosition = executionLegRows.get(leg.outcomeId) ?? null;
    const nextShares = quantizeShares(
      toDecimal(existingPosition?.shares ?? "0.000000").plus(quote.sharesBought)
    );
    const nextCostBasis = quantizeMoney(
      toDecimal(existingPosition?.cost_basis ?? "0.000000").plus(
        legCostBasisDeltas[index] ?? "0.000000"
      )
    );
    const nextRealizedPnl = quantizeMoney(
      existingPosition?.realized_pnl ?? "0.000000"
    );

    return {
      outcomeId: leg.outcomeId,
      shares: nextShares,
      costBasis: nextCostBasis,
      realizedPnl: nextRealizedPnl
    };
  });

  await updateAccountBalance(client, userCashAccount.id, nextCashBalance);
  await updateAccountBalance(client, marketTreasuryAccount.id, nextTreasuryBalance);
  await updateOutcomeStatePrices(
    client,
    marketId,
    outcomeIds,
    quote.nextQShares,
    marketRow.liquidity_b
  );
  await updateMarketPricingState(client, marketId, quote.cashSpent);

  if (contractResolution.executionLegs.length > 1) {
    for (const positionLeg of positionLegsAfter) {
      await upsertPosition(
        client,
        actorId,
        marketId,
        positionLeg.outcomeId,
        positionLeg.shares,
        positionLeg.costBasis,
        positionLeg.realizedPnl
      );
    }
  } else {
    // Single-leg contract resolutions always carry an execution outcome;
    // prove it instead of asserting — a multi-leg resolution reaching
    // this branch is a contract-side bug, not a 500-by-null-deref.
    const executionOutcomeId = contractResolution.executionOutcomeId;

    if (!executionOutcomeId) {
      throw new TradeServiceError(
        500,
        "invalid_contract_resolution",
        "Single-leg execution is missing its execution outcome."
      );
    }

    const singlePosition = executionLegRows.get(executionOutcomeId) ?? null;
    const nextPositionShares = quantizeShares(
      toDecimal(singlePosition?.shares ?? "0.000000").plus(quote.sharesBought)
    );
    const nextPositionCostBasis = quantizeMoney(
      toDecimal(singlePosition?.cost_basis ?? "0.000000").plus(quote.cashSpent)
    );
    const nextPositionRealizedPnl = quantizeMoney(
      singlePosition?.realized_pnl ?? "0.000000"
    );

    await upsertPosition(
      client,
      actorId,
      marketId,
      executionOutcomeId,
      nextPositionShares,
      nextPositionCostBasis,
      nextPositionRealizedPnl
    );
  }
  await upsertContractPosition(
    client,
    actorId,
    marketId,
    contractResolution.requestedOutcomeId,
    contractResolution.requestedOutcomeKey,
    contractResolution.contractSide,
    nextContractShares,
    nextContractCostBasis,
    nextContractRealizedPnl
  );
  await insertTradeRecord(
    client,
    tradeId,
    marketId,
    contractResolution.requestedOutcomeKey,
    contractResolution.executionOutcomeId ?? contractResolution.requestedOutcomeId,
    actorId,
    "buy",
    contractResolution.contractSide,
    quote.cashSpent,
    quote.sharesBought,
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
      shareAmount: quote.sharesBought
    }))
  );
  await insertLedgerTransactionWithEntries(client, {
    tradeId,
    actorId,
    marketId,
    outcomeId:
      contractResolution.executionOutcomeId ?? contractResolution.requestedOutcomeId,
    side: "buy",
    idempotencyKey: request.idempotencyKey,
    amount: quote.cashSpent,
    priceBefore: quote.priceBefore,
    priceAfter: quote.priceAfter,
    userCashAccountId: userCashAccount.id,
    marketTreasuryAccountId: marketTreasuryAccount.id
  });

  const response: TradeResponse = {
    ...common,
    side: "buy",
    executionLegs: buildResponseExecutionLegs(
      contractResolution,
      quote.sharesBought
    ),
    priceBefore: quote.priceBefore,
    priceAfter: quote.priceAfter,
    priceImpact: buildPriceImpact(quote.priceBefore, quote.priceAfter),
    averagePrice: quote.averageExecutionPrice,
    availableCashAfter: nextCashBalance,
    positionSharesAfter:
      contractResolution.executionLegs.length === 1
        ? positionLegsAfter[0]?.shares ?? quote.sharesBought
        : null,
    positionCostBasisAfter:
      contractResolution.executionLegs.length === 1
        ? positionLegsAfter[0]?.costBasis ?? quote.cashSpent
        : null,
    cashSpent: quote.cashSpent,
    sharesBought: quote.sharesBought
  };

  await insertAuditEvent(client, actorId, tradeId, response);
  await completeIdempotencyRecord(client, idempotencyRecordId, tradeId, response);
  return response;
}
