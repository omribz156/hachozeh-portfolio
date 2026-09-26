create table if not exists trades (
  id text primary key,
  market_id text not null,
  outcome_id text not null,
  user_id text not null,
  side text not null,
  cash_amount numeric(20, 6) not null,
  share_amount numeric(20, 6) not null,
  avg_price numeric(12, 8) not null,
  price_before numeric(12, 8) not null,
  price_after numeric(12, 8) not null,
  idempotency_key text not null,
  market_state_version bigint,
  created_at timestamptz not null default now(),
  constraint fk_trades_market
    foreign key (market_id) references markets (id) on delete restrict,
  constraint fk_trades_market_outcome
    foreign key (market_id, outcome_id) references market_outcomes (market_id, id) on delete restrict,
  constraint chk_trades_side check (side in ('buy', 'sell')),
  constraint chk_trades_cash_amount_positive check (cash_amount > 0),
  constraint chk_trades_share_amount_positive check (share_amount > 0),
  constraint chk_trades_avg_price_range check (avg_price >= 0 and avg_price <= 1),
  constraint chk_trades_price_before_range check (price_before >= 0 and price_before <= 1),
  constraint chk_trades_price_after_range check (price_after >= 0 and price_after <= 1)
);

create table if not exists positions (
  user_id text not null,
  market_id text not null,
  outcome_id text not null,
  shares numeric(20, 6) not null,
  cost_basis numeric(20, 6) not null,
  realized_pnl numeric(20, 6) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_trade_at timestamptz,
  settled_at timestamptz,
  constraint pk_positions primary key (user_id, market_id, outcome_id),
  constraint fk_positions_market
    foreign key (market_id) references markets (id) on delete restrict,
  constraint fk_positions_market_outcome
    foreign key (market_id, outcome_id) references market_outcomes (market_id, id) on delete restrict,
  constraint chk_positions_shares_positive check (shares > 0),
  constraint chk_positions_cost_basis_non_negative check (cost_basis >= 0)
);

create table if not exists idempotency_records (
  id text primary key,
  scope text not null,
  actor_id text not null,
  idempotency_key text not null,
  request_hash text not null,
  status text not null,
  response_snapshot jsonb,
  resource_type text,
  resource_id text,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint chk_idempotency_records_status
    check (status in ('in_progress', 'completed', 'failed')),
  constraint chk_idempotency_records_request_hash_not_empty
    check (length(trim(request_hash)) > 0)
);
