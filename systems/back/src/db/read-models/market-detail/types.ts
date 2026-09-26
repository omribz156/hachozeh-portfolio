export type MarketDetailRow = {
  market_id: string;
  market_status: string;
  persisted_status?: string | null;
  title: string;
  description: string | null;
  category_key: string | null;
  market_family_key: string | null;
  event_id: string | null;
  event_slug?: string | null;
  open_at: Date;
  close_at: Date;
  published_at?: Date | null;
  liquidity_b: string;
  market_state_version: string;
  settlement_status: string | null;
  market_resolved_at: Date | null;
  updated_at: Date;
  outcome_id: string;
  short_label: string | null;
  label: string;
  sort_order: number;
  last_price: string;
  winning_outcome_id: string | null;
  winning_outcome_label: string | null;
  resolution_source: string | null;
  resolution_rules: string | null;
  oracle_source_policy: unknown;
  market_contract: unknown;
  resolution_source_url: string | null;
  resolution_note: string | null;
  resolution_resolved_at: Date | null;
};

export type MarketFamilyRow = {
  market_id: string;
  event_slug: string | null;
  status: string;
  close_at: Date;
  label_at?: Date | null;
};

export type MarketPriceTradeRow = {
  id: string;
  outcome_id: string;
  side: "buy" | "sell";
  cash_amount: string;
  share_amount: string;
  created_at: Date;
  price_before: string;
  price_after: string;
  execution_legs: unknown;
};

export type MarketPriceExecutionLeg = {
  outcome_id: string;
  share_amount: string;
};

export type OracleSourcePolicy = {
  preferredSourceIds?: string[];
  fallbackSourceIds?: string[];
  contextSourceIds?: string[];
  closeConditionSourceIds?: string[];
  resolutionSourceIds?: string[];
  requiresHumanReviewOnSourceConflict?: boolean;
  requiresHumanReviewOnWeakAuthority?: boolean;
  notes?: string[];
};

export type CategoryMeta = {
  label: string;
  href: string;
  brandAlt: string;
  brandImageUrl: string;
};
