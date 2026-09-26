import { randomUUID } from "node:crypto";

import type { AppEnv } from "../../config/env";
import type { Pool } from "pg";
import type { RequestActor } from "../../auth/actor-resolver";
import { readUserControlState } from "../../auth/user-control-state";
import { recordRetentionMilestone } from "../../analytics/retention-events-service";
import { withTransaction } from "../../db/tx/with-transaction";
import { resolveCanonicalMarketKeyById, resolveMarketIdentity } from "../../shared/market-identity";
import {
  ContractSideNormalizationError,
  normalizeContractExecution
} from "../contract-side-normalization";
import {
  isMarketOpenForTrading,
  resolveContractExecutionIndexes
} from "../market-state-guards";
import { buildExecutionQuote, buildPriceImpact } from "../pricing";
import {
  claimIdempotencyScope
} from "./idempotency";
import { readLockedMarketRows, readLockedMarketTreasuryAccount, readLockedUserCashAccount } from "./locked-reads";
import { resolveTradeActorId } from "./trade-actor";
import { TradeServiceError } from "./trade-errors";
export { TradeServiceError } from "./trade-errors";
import {
  buildBuyPayloadForHash,
  buildSellPayloadForHash,
  hashRequest
} from "./trade-hash";
import { parseTradeRequest } from "./trade-request";
import { executeBuyLegs } from "./trade-buy-execution";
import { executeSellLegs } from "./trade-sell-execution";
import { appendBaseCandleFromState } from "../../markets/market-history/base-candle-store";
import { findKnownDependentResult } from "../../lifecycle/events/dependent-trade-guard";
import type { TradeResponse } from "./trade-types";
export type { TradeResponse } from "./trade-types";

type TradeExecutionOptions = {
  requestId?: string | null;
};

function buildCurrentQuoteDetails(input: {
  request: ReturnType<typeof parseTradeRequest>;
  marketRow: { liquidity_b: string };
  qShares: string[];
  executionLegCount: number;
  requestedOutcomeIndex: number;
  executionOutcomeIndex: number;
}): Record<string, unknown> | null {
  try {
    const quote = input.request.side === "buy"
      ? buildExecutionQuote({
          side: "buy",
          marketState: {
            liquidityB: input.marketRow.liquidity_b,
            qShares: input.qShares
          },
          executionLegCount: input.executionLegCount,
          requestedOutcomeIndex: input.requestedOutcomeIndex,
          executionOutcomeIndex: input.executionOutcomeIndex,
          cashAmount: input.request.cashAmount
        })
      : buildExecutionQuote({
          side: "sell",
          marketState: {
            liquidityB: input.marketRow.liquidity_b,
            qShares: input.qShares
          },
          executionLegCount: input.executionLegCount,
          requestedOutcomeIndex: input.requestedOutcomeIndex,
          executionOutcomeIndex: input.executionOutcomeIndex,
          shareAmount: input.request.shareAmount
        });

    const commonDetails = {
      side: quote.side,
      priceBefore: quote.priceBefore,
      priceAfter: quote.priceAfter,
      averagePrice: quote.averageExecutionPrice,
      slippage: quote.slippage,
      priceImpact: buildPriceImpact(quote.priceBefore, quote.priceAfter)
    };

    if (quote.side === "buy") {
      return {
        ...commonDetails,
        cashSpent: quote.cashSpent,
        sharesBought: quote.sharesBought
      };
    }

    return {
      ...commonDetails,
      sharesSold: quote.sharesSold,
      proceedsReceived: quote.proceedsReceived
    };
  } catch {
    return null;
  }
}

function assertQuoteStillValid(input: {
  request: ReturnType<typeof parseTradeRequest>;
  marketStateVersionBefore: number;
  currentQuote: Record<string, unknown> | null;
  nowMs?: number;
}): void {
  if (
    input.request.expectedMarketStateVersion !== null &&
    input.request.expectedMarketStateVersion !== input.marketStateVersionBefore
  ) {
    throw new TradeServiceError(
      409,
      "market_state_moved",
      "Market price moved. Review the updated quote before trading.",
      {
        currentMarketStateVersion: input.marketStateVersionBefore,
        expectedMarketStateVersion: input.request.expectedMarketStateVersion,
        quoteId: input.request.quoteId,
        currentQuote: input.currentQuote
      }
    );
  }

  if (input.request.quoteExpiresAt) {
    const expiresAtMs = Date.parse(input.request.quoteExpiresAt);
    if (Number.isFinite(expiresAtMs) && expiresAtMs <= (input.nowMs ?? Date.now())) {
      throw new TradeServiceError(
        409,
        "quote_expired",
        "Trade quote expired. Review the updated quote before trading.",
        {
          currentMarketStateVersion: input.marketStateVersionBefore,
          quoteId: input.request.quoteId,
          quoteExpiresAt: input.request.quoteExpiresAt,
          currentQuote: input.currentQuote
        }
      );
    }
  }
}

export async function executeTrade(
  pool: Pool,
  env: AppEnv,
  marketKey: string,
  body: unknown,
  actor?: Pick<RequestActor, "actorId">,
  options: TradeExecutionOptions = {}
): Promise<TradeResponse> {
  const marketIdentity = resolveMarketIdentity(marketKey);

  if (!marketIdentity) {
    throw new TradeServiceError(404, "market_not_found", "Requested market was not found.");
  }

  const request = parseTradeRequest(body);
  const actorId = resolveTradeActorId(env, actor);

  const response = await withTransaction(pool, async (client) => {
    const userControlState = await readUserControlState(client, actorId);

    if (!userControlState || userControlState.status !== "active") {
      throw new TradeServiceError(403, "unauthorized", "Trade actor is not available.");
    }

    if (userControlState.tradeAccessStatus !== "enabled") {
      throw new TradeServiceError(
        403,
        "trade_access_blocked",
        "Trading access is blocked for this user."
      );
    }

    const marketRows = await readLockedMarketRows(client, marketIdentity.marketId);

    if (!marketRows.length) {
      throw new TradeServiceError(404, "market_not_found", "Requested market was not found.");
    }

    let contractResolution: ReturnType<typeof normalizeContractExecution>;

    try {
      contractResolution = normalizeContractExecution({
        marketKey,
        requestedOutcomeKey: request.outcomeKey,
        contractSide: request.contractSide,
        marketRows
      });
    } catch (error) {
      if (
        error instanceof ContractSideNormalizationError &&
        error.code === "outcome_not_found"
      ) {
        throw new TradeServiceError(404, error.code, error.message);
      }

      if (
        error instanceof ContractSideNormalizationError &&
        error.code === "unsupported_contract_side"
      ) {
        throw new TradeServiceError(400, error.code, error.message);
      }

      throw error;
    }

    const requestHash = hashRequest(
      request.side === "buy"
        ? buildBuyPayloadForHash(marketIdentity.marketId, contractResolution, request)
        : buildSellPayloadForHash(marketIdentity.marketId, contractResolution, request)
    );
    const idempotency = await claimIdempotencyScope(
      client,
      actorId,
      request.idempotencyKey,
      requestHash
    );

    if (idempotency.completedResponse) {
      return idempotency.completedResponse;
    }

    const [marketRow] = marketRows;

    if (!isMarketOpenForTrading(marketRow)) {
      throw new TradeServiceError(409, "market_not_open", "Requested market is not open.");
    }

    const knownDependentResult = await findKnownDependentResult(client, {
      marketId: marketRow.market_id,
      eventId: marketRow.event_id,
      marketContract: marketRow.market_contract
    });
    if (knownDependentResult) {
      throw new TradeServiceError(
        409,
        "market_result_known",
        "This market can no longer be traded because its dependent result is already known.",
        knownDependentResult
      );
    }

    if (!marketRow.market_treasury_account_id) {
      throw new Error("Market treasury account is missing for this market.");
    }

    const outcomeIds = marketRows.map((row) => row.outcome_id);
    const qShares = marketRows.map((row) => row.q_shares);
    const executionIndexes = resolveContractExecutionIndexes(marketRows, contractResolution);

    if (!executionIndexes.ok) {
      throw new TradeServiceError(404, "outcome_not_found", "Requested outcome was not found.");
    }
    const { requestedOutcomeIndex, executionOutcomeIndex } = executionIndexes;

    const marketStateVersionBefore = Number(marketRow.market_state_version);
    const currentQuote = buildCurrentQuoteDetails({
      request,
      marketRow,
      qShares,
      executionLegCount: contractResolution.executionLegs.length,
      requestedOutcomeIndex,
      executionOutcomeIndex
    });
    assertQuoteStillValid({
      request,
      marketStateVersionBefore,
      currentQuote
    });

    const userCashAccount = await readLockedUserCashAccount(client, actorId);
    const marketTreasuryAccount = await readLockedMarketTreasuryAccount(
      client,
      marketRow.market_treasury_account_id
    );

    if (!userCashAccount || userCashAccount.status !== "active") {
      throw new TradeServiceError(403, "unauthorized", "Trade actor account is unavailable.");
    }

    if (!marketTreasuryAccount || marketTreasuryAccount.status !== "active") {
      throw new Error("Market treasury account is unavailable.");
    }

    const tradeId = `trade_${randomUUID()}`;
    const executedAt = new Date().toISOString();
    const common = {
      tradeId,
      requestId: options.requestId ?? null,
      marketKey: resolveCanonicalMarketKeyById(marketRow.market_id) ?? marketRow.market_id,
      marketId: marketRow.market_id,
      marketStateVersionBefore,
      marketStateVersionAfter: marketStateVersionBefore + 1,
      executedAt,
      contractSide: contractResolution.contractSide,
      outcomeKey: contractResolution.requestedOutcomeKey,
      outcomeId: contractResolution.requestedOutcomeId,
      executionOutcomeKey: contractResolution.executionOutcomeKey,
      executionOutcomeId: contractResolution.executionOutcomeId,
      quoteId: request.quoteId
    };

    if (request.side === "buy") {
      return executeBuyLegs(client, {
        actorId,
        marketId: marketIdentity.marketId,
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
        idempotencyRecordId: idempotency.recordId,
        tradeId,
        marketStateVersionBefore
      });
    }

    return executeSellLegs(client, {
      actorId,
      marketId: marketIdentity.marketId,
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
      idempotencyRecordId: idempotency.recordId,
      tradeId,
      marketStateVersionBefore
    });
  });

  // Keep the always-current base price series fresh on every trade (migration
  // 048). POST-COMMIT + BEST-EFFORT: reads the just-committed
  // market_outcome_state prices; a candle-write failure must never affect the
  // committed trade (the base is a derived view a backfill can always rebuild).
  try {
    await appendBaseCandleFromState(pool, marketIdentity.marketId);
  } catch {
    // swallow — never let chart bookkeeping disturb a settled trade
  }

  // Activation signal: first completed loop (first trade). Idempotent per user,
  // real users only, fire-and-forget so it never disturbs a settled trade.
  if (actor?.actorId) {
    void recordRetentionMilestone(pool, actor.actorId, "first_loop_complete").catch(() => {});
  }

  return response;
}
