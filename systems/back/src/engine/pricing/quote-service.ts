import { randomUUID } from "node:crypto";

import type { AppEnv } from "../../config/env";
import type { Queryable } from "../../db/client/pool";
import type { RequestActor } from "../../auth/actor-resolver";
import { readUserControlState } from "../../auth/user-control-state";
import { normalizeUserCashAmountInput } from "../../shared/cash-amount";
import {
  DecimalValidationError,
  quantizeMoney,
  parseDecimalString,
  quantizeShares,
  toDecimal
} from "../../shared/decimals";
import { resolveCanonicalMarketKeyById, resolveMarketIdentity } from "../../shared/market-identity";
import {
  parseObjectBody,
  parseRequiredStringField
} from "../../shared/zod-request-body";
import {
  ContractSideNormalizationError,
  normalizeContractExecution,
  parseContractSide,
  type ContractSide
} from "../contract-side-normalization";
import {
  isMarketOpenForTrading,
  resolveContractExecutionIndexes
} from "../market-state-guards";
import { checkSellOwnership } from "../sell-ownership";
import {
  isQuantizedZeroSellError,
  type BuyQuote,
  type SellQuote
} from "./lmsr";
import { buildExecutionQuote } from "./execution-quote";
import { buildPriceImpact } from "./price-impact";
import type { PriceImpact } from "./price-impact";

type QuoteSide = "buy" | "sell";

type QuoteRequest =
  | {
      side: "buy";
      outcomeKey: string;
      contractSide: ContractSide;
      cashAmount: string;
    }
  | {
      side: "sell";
      outcomeKey: string;
      contractSide: ContractSide;
      shareAmount: string;
    };

type QuoteMarketRow = {
  market_id: string;
  market_status: string;
  market_close_at?: Date | string;
  market_state_version: string;
  liquidity_b: string;
  outcome_id: string;
  q_shares: string;
  sort_order: number;
};

type UserCashAccountRow = {
  account_id: string;
  status: string;
  balance_cached: string;
};

type PositionRow = {
  shares: string;
  cost_basis: string;
};

type ContractPositionRow = {
  shares: string;
  cost_basis: string;
};

type CommonQuoteResponse = {
  quoteId: string;
  marketKey: string;
  marketId: string;
  marketStateVersion: number;
  quotedAt: string;
  expiresAt: string;
  side: QuoteSide;
  contractSide: ContractSide;
  outcomeKey: string;
  outcomeId: string;
  executionOutcomeKey: string | null;
  executionOutcomeId: string | null;
  executionLegs: Array<{
    outcomeKey: string;
    outcomeId: string;
    shareAmount: string;
  }>;
  averagePrice: string;
  priceBefore: string;
  priceAfter: string;
  priceImpact: PriceImpact;
};

export type QuoteResponse =
  | (CommonQuoteResponse & {
      side: "buy";
      cashAmount: string;
      shareAmount: string;
      unspentCash: string;
    })
  | (CommonQuoteResponse & {
      side: "sell";
      shareAmount: string;
      estimatedProceeds: string;
      estimatedRealizedPnlDelta: string;
    });

export class QuoteServiceError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "QuoteServiceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function mapSellQuoteError(error: unknown): never {
  if (isQuantizedZeroSellError(error)) {
    throw new QuoteServiceError(
      409,
      "untradeable_amount",
      "Requested sell amount is too small to produce executable proceeds at the current price."
    );
  }

  throw error;
}

const createQuoteRequestError = (message: string) =>
  new QuoteServiceError(400, "invalid_request", message);

function parseQuoteRequest(body: unknown): QuoteRequest {
  const record = parseObjectBody(body, "Quote body must be a JSON object.", createQuoteRequestError);

  const side = parseRequiredStringField(record, "side", createQuoteRequestError);
  const outcomeKey = parseRequiredStringField(record, "outcomeKey", createQuoteRequestError);
  let contractSide: ContractSide;

  try {
    contractSide = parseContractSide(record.contractSide);
  } catch (error) {
    if (error instanceof ContractSideNormalizationError) {
      throw new QuoteServiceError(400, "invalid_request", error.message);
    }

    throw error;
  }

  if (side === "buy") {
    if ("shareAmount" in record) {
      throw new QuoteServiceError(
        400,
        "invalid_request",
        "Buy quote requests must not include shareAmount."
      );
    }

    return {
      side,
      outcomeKey,
      contractSide,
      cashAmount: (() => {
        try {
          return normalizeUserCashAmountInput(parseRequiredStringField(record, "cashAmount", createQuoteRequestError));
        } catch (error) {
          if (error instanceof DecimalValidationError) {
            throw new QuoteServiceError(400, "invalid_request", error.message);
          }

          throw error;
        }
      })()
    };
  }

  if (side === "sell") {
    if ("cashAmount" in record) {
      throw new QuoteServiceError(
        400,
        "invalid_request",
        "Sell quote requests must not include cashAmount."
      );
    }

    return {
      side,
      outcomeKey,
      contractSide,
      shareAmount: parseRequiredStringField(record, "shareAmount", createQuoteRequestError)
    };
  }

  throw new QuoteServiceError(400, "invalid_request", "Quote side must be buy or sell.");
}

function buildExpiry(quotedAt: Date): string {
  return new Date(quotedAt.getTime() + 3_000).toISOString();
}

function buildCommonResponse(
  marketRow: QuoteMarketRow,
  contractResolution: ReturnType<typeof normalizeContractExecution>,
  side: QuoteSide,
  quotedAt: Date,
  quote: BuyQuote | SellQuote
): CommonQuoteResponse {
  const executionShareAmount =
    quote.side === "buy" ? quote.sharesBought : quote.sharesSold;

  return {
    quoteId: `quote_${randomUUID()}`,
    marketKey:
      resolveCanonicalMarketKeyById(marketRow.market_id) ?? marketRow.market_id,
    marketId: marketRow.market_id,
    marketStateVersion: Number(marketRow.market_state_version),
    quotedAt: quotedAt.toISOString(),
    expiresAt: buildExpiry(quotedAt),
    side,
    contractSide: contractResolution.contractSide,
    outcomeKey: contractResolution.requestedOutcomeKey,
    outcomeId: contractResolution.requestedOutcomeId,
    executionOutcomeKey: contractResolution.executionOutcomeKey,
    executionOutcomeId: contractResolution.executionOutcomeId,
    executionLegs: contractResolution.executionLegs.map((leg) => ({
      outcomeKey: leg.outcomeKey,
      outcomeId: leg.outcomeId,
      shareAmount: executionShareAmount
    })),
    averagePrice: quote.averageExecutionPrice,
    priceBefore: quote.priceBefore,
    priceAfter: quote.priceAfter,
    priceImpact: buildPriceImpact(quote.priceBefore, quote.priceAfter)
  };
}

async function readLiveMarketRows(
  db: Queryable,
  marketId: string
): Promise<QuoteMarketRow[]> {
  const result = await db.query<QuoteMarketRow>(
    `
      select
        m.id as market_id,
        m.status as market_status,
        m.close_at as market_close_at,
        ps.version as market_state_version,
        ps.liquidity_b,
        o.id as outcome_id,
        os.q_shares,
        o.sort_order
      from markets m
      join market_pricing_state ps
        on ps.market_id = m.id
      join market_outcomes o
        on o.market_id = m.id
      join market_outcome_state os
        on os.market_id = m.id
       and os.outcome_id = o.id
      where m.id = $1
      order by o.sort_order
    `,
    [marketId]
  );

  return result.rows;
}

async function readDemoActorCashAccount(
  db: Queryable,
  actorId: string
): Promise<UserCashAccountRow | null> {
  const result = await db.query<UserCashAccountRow>(
    `
      select
        id as account_id,
        status,
        balance_cached
      from accounts
      where type = 'user_cash'
        and owner_id = $1
      limit 1
    `,
    [actorId]
  );

  return result.rows[0] ?? null;
}

async function readActivePosition(
  db: Queryable,
  actorId: string,
  marketId: string,
  outcomeId: string
): Promise<PositionRow | null> {
  const result = await db.query<PositionRow>(
    `
      select shares, cost_basis
      from positions
      where user_id = $1
        and market_id = $2
        and outcome_id = $3
      limit 1
    `,
    [actorId, marketId, outcomeId]
  );

  return result.rows[0] ?? null;
}

async function readActivePositions(
  db: Queryable,
  actorId: string,
  marketId: string,
  outcomeIds: readonly string[]
): Promise<Map<string, PositionRow>> {
  if (!outcomeIds.length) {
    return new Map();
  }

  const result = await db.query<(PositionRow & { outcome_id: string })>(
    `
      select shares, cost_basis, outcome_id
      from positions
      where user_id = $1
        and market_id = $2
        and outcome_id = any($3::text[])
    `,
    [actorId, marketId, outcomeIds]
  );

  return new Map(result.rows.map((row) => [row.outcome_id, row]));
}

async function readActiveContractPosition(
  db: Queryable,
  actorId: string,
  marketId: string,
  requestedOutcomeId: string,
  contractSide: ContractSide
): Promise<ContractPositionRow | null> {
  const result = await db.query<ContractPositionRow>(
    `
      select shares, cost_basis
      from contract_positions
      where user_id = $1
        and market_id = $2
        and requested_outcome_id = $3
        and contract_side = $4
        and settled_at is null
      limit 1
    `,
    [actorId, marketId, requestedOutcomeId, contractSide]
  );

  return result.rows[0] ?? null;
}

function readDemoActorId(env: AppEnv): string {
  if (!env.actorMode.demoEnabled) {
    throw new QuoteServiceError(401, "unauthorized", "Demo actor mode is disabled.");
  }

  return env.actorMode.demoActorId;
}

function resolveQuoteActorId(
  env: AppEnv,
  actor?: Pick<RequestActor, "actorId">
): string {
  return actor?.actorId ?? readDemoActorId(env);
}

function buildSellEstimatedPnl(
  proceedsReceived: string,
  position: PositionRow,
  sharesSold: string
): string {
  const ownedShares = parseDecimalString(position.shares, {
    fieldName: "position.shares",
    allowNegative: false,
    allowZero: false,
    maxScale: 6
  });
  const costBasis = parseDecimalString(position.cost_basis, {
    fieldName: "position.costBasis",
    allowNegative: false,
    allowZero: true,
    maxScale: 6
  });
  const removedCostBasis = costBasis.div(ownedShares).mul(sharesSold);

  return quantizeMoney(toDecimal(proceedsReceived).minus(removedCostBasis));
}

function buildBundleSellEstimatedPnl(
  proceedsReceived: string,
  positions: Iterable<PositionRow>,
  sharesSoldPerLeg: string
): string {
  const removedCostBasis = Array.from(positions).reduce((sum, position) => {
    const ownedShares = parseDecimalString(position.shares, {
      fieldName: "position.shares",
      allowNegative: false,
      allowZero: false,
      maxScale: 6
    });
    const costBasis = parseDecimalString(position.cost_basis, {
      fieldName: "position.costBasis",
      allowNegative: false,
      allowZero: true,
      maxScale: 6
    });

    return sum.plus(costBasis.div(ownedShares).mul(sharesSoldPerLeg));
  }, toDecimal(0));

  return quantizeMoney(toDecimal(proceedsReceived).minus(removedCostBasis));
}

export async function createTradeTicketQuote(
  db: Queryable,
  env: AppEnv,
  marketKey: string,
  body: unknown,
  actor?: Pick<RequestActor, "actorId">
): Promise<QuoteResponse> {
  const marketIdentity = resolveMarketIdentity(marketKey);

  if (!marketIdentity) {
    throw new QuoteServiceError(404, "market_not_found", "Requested market was not found.");
  }

  const quoteRequest = parseQuoteRequest(body);
  const marketRows = await readLiveMarketRows(db, marketIdentity.marketId);

  if (!marketRows.length) {
    throw new QuoteServiceError(404, "market_not_found", "Requested market was not found.");
  }

  let contractResolution: ReturnType<typeof normalizeContractExecution>;

  try {
    contractResolution = normalizeContractExecution({
      marketKey,
      requestedOutcomeKey: quoteRequest.outcomeKey,
      contractSide: quoteRequest.contractSide,
      marketRows
    });
  } catch (error) {
    if (
      error instanceof ContractSideNormalizationError &&
      error.code === "outcome_not_found"
    ) {
      throw new QuoteServiceError(404, error.code, error.message);
    }

    if (
      error instanceof ContractSideNormalizationError &&
      error.code === "unsupported_contract_side"
    ) {
      throw new QuoteServiceError(400, error.code, error.message);
    }

    throw error;
  }

  const [marketRow] = marketRows;

  if (!isMarketOpenForTrading(marketRow)) {
    throw new QuoteServiceError(409, "market_not_open", "Requested market is not open.");
  }

  const actorId = resolveQuoteActorId(env, actor);
  const userControlState = await readUserControlState(db, actorId);

  if (!userControlState || userControlState.status !== "active") {
    throw new QuoteServiceError(403, "unauthorized", "Quote actor is not available.");
  }

  if (userControlState.tradeAccessStatus !== "enabled") {
    throw new QuoteServiceError(
      403,
      "trade_access_blocked",
      "Trading access is blocked for this user."
    );
  }

  const cashAccount = await readDemoActorCashAccount(db, actorId);

  if (!cashAccount) {
    throw new QuoteServiceError(401, "unauthorized", "Quote actor is not available.");
  }

  if (cashAccount.status !== "active") {
    throw new QuoteServiceError(403, "unauthorized", "Quote actor account is locked.");
  }

  const qShares = marketRows.map((row) => row.q_shares);
  const executionIndexes = resolveContractExecutionIndexes(marketRows, contractResolution);

  if (!executionIndexes.ok) {
    throw new QuoteServiceError(404, "outcome_not_found", "Requested outcome was not found.");
  }
  const { requestedOutcomeIndex, executionOutcomeIndex } = executionIndexes;

  const quotedAt = new Date();

  if (quoteRequest.side === "buy") {
    const quote = buildExecutionQuote({
      side: "buy",
      marketState: {
        liquidityB: marketRow.liquidity_b,
        qShares
      },
      executionLegCount: contractResolution.executionLegs.length,
      requestedOutcomeIndex,
      executionOutcomeIndex,
      cashAmount: quoteRequest.cashAmount
    });
    const currentCash = parseDecimalString(cashAccount.balance_cached, {
      fieldName: "availableCash",
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

    if (cashSpent.gt(currentCash)) {
      throw new QuoteServiceError(
        409,
        "insufficient_cash",
        "Quote cash amount exceeds available cash."
      );
    }

    return {
      ...buildCommonResponse(
        marketRow,
        contractResolution,
        "buy",
        quotedAt,
        quote
      ),
      side: "buy",
      cashAmount: quote.requestedCashAmount,
      shareAmount: quote.sharesBought,
      unspentCash: quote.unspentCash
    };
  }

  let requestedShares: ReturnType<typeof parseDecimalString>;

  try {
    requestedShares = parseDecimalString(quoteRequest.shareAmount, {
      fieldName: "shareAmount",
      allowNegative: false,
      allowZero: false,
      maxScale: 6
    });
  } catch (error) {
    if (error instanceof DecimalValidationError) {
      throw new QuoteServiceError(400, "invalid_request", error.message);
    }

    throw error;
  }

  const contractPosition = await readActiveContractPosition(
    db,
    actorId,
    marketIdentity.marketId,
    contractResolution.requestedOutcomeId,
    contractResolution.contractSide
  );

  const contractOwnership = checkSellOwnership(
    contractPosition,
    requestedShares,
    "contractPosition.shares"
  );

  if (!contractOwnership.ok) {
    throw new QuoteServiceError(
      400,
      "insufficient_shares",
      "Requested sell amount exceeds owned shares."
    );
  }

  if (contractResolution.executionLegs.length > 1) {
    const positions = await readActivePositions(
      db,
      actorId,
      marketIdentity.marketId,
      contractResolution.executionLegs.map((leg) => leg.outcomeId)
    );

    if (positions.size !== contractResolution.executionLegs.length) {
      throw new QuoteServiceError(
        400,
        "insufficient_shares",
        "Requested sell amount exceeds owned shares."
      );
    }

    let minOwnedShares: ReturnType<typeof toDecimal> | null = null;

    for (const leg of contractResolution.executionLegs) {
      const position = positions.get(leg.outcomeId);

      if (!position) {
        minOwnedShares = toDecimal(0);
        break;
      }

      const ownedShares = parseDecimalString(position.shares, {
        fieldName: "position.shares",
        allowNegative: false,
        allowZero: false,
        maxScale: 6
      });

      if (minOwnedShares === null || ownedShares.lt(minOwnedShares)) {
        minOwnedShares = ownedShares;
      }
    }

    if (!minOwnedShares || requestedShares.gt(minOwnedShares)) {
      throw new QuoteServiceError(
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
          shareAmount: quoteRequest.shareAmount
        });
      } catch (error) {
        throw mapSellQuoteError(error);
      }
    })();

    return {
      ...buildCommonResponse(
        marketRow,
        contractResolution,
        "sell",
        quotedAt,
        quote
      ),
      side: "sell",
      shareAmount: quantizeShares(requestedShares),
      estimatedProceeds: quote.proceedsReceived,
      estimatedRealizedPnlDelta: buildBundleSellEstimatedPnl(
        quote.proceedsReceived,
        positions.values(),
        quantizeShares(requestedShares)
      )
    };
  }

  const position = await readActivePosition(
    db,
    actorId,
    marketIdentity.marketId,
    contractResolution.executionOutcomeId!
  );

  if (!position) {
    throw new QuoteServiceError(
      400,
      "insufficient_shares",
      "Requested sell amount exceeds owned shares."
    );
  }

  const ownedShares = parseDecimalString(position.shares, {
    fieldName: "position.shares",
    allowNegative: false,
    allowZero: false,
    maxScale: 6
  });

  if (requestedShares.gt(ownedShares)) {
    throw new QuoteServiceError(
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
        shareAmount: quoteRequest.shareAmount
      });
    } catch (error) {
      throw mapSellQuoteError(error);
    }
  })();

  return {
    ...buildCommonResponse(
      marketRow,
      contractResolution,
      "sell",
      quotedAt,
      quote
    ),
    side: "sell",
    shareAmount: quantizeShares(requestedShares),
    estimatedProceeds: quote.proceedsReceived,
    estimatedRealizedPnlDelta: buildSellEstimatedPnl(
      quote.proceedsReceived,
      position,
      quantizeShares(requestedShares)
    )
  };
}
