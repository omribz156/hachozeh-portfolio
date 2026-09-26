export type MarketRow = {
  id: string;
  status: "draft" | "open" | "closed" | "resolved" | "voided";
  title: string;
  category_key: string | null;
  market_family_key: string | null;
  open_at: Date;
  close_at: Date;
  published_at: Date | null;
  liquidity_b: string;
  market_treasury_account_id: string | null;
  market_contract: unknown;
};

export type OutcomeRow = {
  id: string;
  market_id: string;
  sort_order: number;
};

export type PublishMarketRequest = {
  publishAt: string | null;
  seedAmount: string;
  note: string | null;
  reviewId: string | null;
  checklistVersion: string | null;
  managementApprovedAt: string | null;
  eventStartAt?: string | null;
  eventCategory?: string | null;
  idempotencyKey: string;
};

type PublishReserveCheck = {
  policy: "lmsr_reserve_floor";
  liquidityB: string;
  outcomeCount: number;
  requiredReserve: string;
  seedAmount: string;
  marketTreasuryBalanceBefore: string;
  marketTreasuryBalanceAfter: string;
  platformTreasuryBalanceBefore: string;
  platformTreasuryBalanceAfter: string;
  coverageStatus: "covered";
};

export type PublishMarketResponse = {
  marketId: string;
  status: "open";
  publishedAt: string;
  marketTreasuryAccountId: string;
  seedTransactionId: string;
  reserveCheck: PublishReserveCheck;
  marketStateVersion: number;
  auditEventId: string;
};
