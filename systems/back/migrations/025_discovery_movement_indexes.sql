create index if not exists idx_trades_market_outcome_created_at
  on trades (market_id, outcome_id, created_at);
