export type MarketApiRow = {
  market_id: string;
  event_id?: string | null;
  event_slug?: string | null;
  market_status: string;
  persisted_status?: string | null;
  title: string;
  description: string | null;
  category_key: string | null;
  open_at: Date;
  close_at: Date;
  published_at: Date | null;
  settlement_status?: string | null;
  market_resolved_at?: Date | null;
  resolution_source?: string | null;
  resolution_rules?: string | null;
  market_contract?: unknown;
  winning_outcome_id?: string | null;
  winning_outcome_label?: string | null;
  resolution_source_url?: string | null;
  resolution_note?: string | null;
  resolution_resolved_at?: Date | null;
  updated_at: Date;
  market_state_version: string;
  liquidity_b?: string;
  outcome_count: number;
  total_volume: string;
  outcome_id: string;
  outcome_label: string;
  outcome_short_label: string | null;
  q_shares?: string;
  sort_order: number;
  last_price: string;
};

export type MarketTradeRow = {
  trade_id: string;
  user_id: string;
  user_handle?: string | null;
  user_display_name?: string | null;
  user_avatar_url?: string | null;
  created_at: Date;
  side: "buy" | "sell";
  contract_side: "yes" | "no";
  requested_outcome_key: string;
  cash_amount: string;
  share_amount: string;
  avg_price: string;
  price_before: string;
  price_after: string;
  outcome_id: string;
  outcome_label: string;
  execution_legs: unknown;
};

export type MarketPositionRow = {
  user_id: string;
  user_handle?: string | null;
  user_display_name?: string | null;
  user_avatar_url?: string | null;
  outcome_id: string;
  outcome_label: string;
  outcome_short_label: string | null;
  complement_outcome_id?: string | null;
  complement_outcome_label?: string | null;
  complement_outcome_short_label?: string | null;
  outcome_count?: number | string | null;
  contract_side: "yes" | "no";
  sort_order: number;
  shares: string;
  cost_basis: string;
  realized_pnl: string;
  current_price: string;
  updated_at: Date;
};

export type MarketCommunityBoardEntry = {
  yes: Array<Record<string, unknown>>;
  no: Array<Record<string, unknown>>;
};

export type MarketCatalogSort = "updated_desc" | "close_asc" | "volume_desc" | "id_asc";
export type MarketHistoryRange = "1H" | "6H" | "1D" | "1W" | "1M" | "all";
export type MarketTradeSide = "buy" | "sell";
export type MarketContractSide = "yes" | "no";
