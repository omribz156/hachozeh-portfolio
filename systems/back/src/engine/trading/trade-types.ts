import type { ContractSide } from "../contract-side-normalization";
import type { PriceImpact } from "../pricing/price-impact";

export type TradeSide = "buy" | "sell";

export type TradeRequest =
  | {
      side: "buy";
      outcomeKey: string;
      contractSide: ContractSide;
      cashAmount: string;
      idempotencyKey: string;
      quoteId: string | null;
      quotedAt: string | null;
      quoteExpiresAt: string | null;
      expectedMarketStateVersion: number | null;
    }
  | {
      side: "sell";
      outcomeKey: string;
      contractSide: ContractSide;
      shareAmount: string;
      idempotencyKey: string;
      quoteId: string | null;
      quotedAt: string | null;
      quoteExpiresAt: string | null;
      expectedMarketStateVersion: number | null;
    };

export type MarketRow = {
  market_id: string;
  market_status: string;
  market_close_at?: Date | string;
  event_id: string | null;
  market_contract: unknown;
  market_treasury_account_id: string;
  market_state_version: string;
  liquidity_b: string;
  outcome_id: string;
  q_shares: string;
  sort_order: number;
};

export type AccountRow = {
  id: string;
  status: string;
  balance_cached: string;
};

export type PositionRow = {
  user_id: string;
  market_id: string;
  outcome_id: string;
  shares: string;
  cost_basis: string;
  realized_pnl: string;
};

export type ContractPositionRow = {
  user_id: string;
  market_id: string;
  requested_outcome_id: string;
  requested_outcome_key: string;
  contract_side: ContractSide;
  shares: string;
  cost_basis: string;
  realized_pnl: string;
};

type CommonTradeResponse = {
  tradeId: string;
  requestId: string | null;
  marketKey: string;
  marketId: string;
  marketStateVersionBefore: number;
  marketStateVersionAfter: number;
  executedAt: string;
  side: TradeSide;
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
  quoteId: string | null;
  priceBefore: string;
  priceAfter: string;
  priceImpact: PriceImpact;
  averagePrice: string;
  availableCashAfter: string;
  positionSharesAfter: string | null;
  positionCostBasisAfter: string | null;
};

export type TradeResponse =
  | (CommonTradeResponse & {
      side: "buy";
      cashSpent: string;
      sharesBought: string;
    })
  | (CommonTradeResponse & {
      side: "sell";
      sharesSold: string;
      proceedsReceived: string;
      realizedPnlDelta: string;
    });
