create table if not exists markets (
  id text primary key,
  status text not null,
  settlement_status text,
  market_environment text not null default 'prod',
  title text not null,
  description text,
  category_key text,
  open_at timestamptz not null,
  close_at timestamptz not null,
  published_at timestamptz,
  closed_at timestamptz,
  resolved_at timestamptz,
  resolution_source text not null,
  resolution_rules text not null,
  liquidity_b numeric(20, 8) not null,
  market_treasury_account_id text,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_markets_status check (status in ('draft', 'open', 'closed', 'resolved')),
  constraint chk_markets_environment check (market_environment in ('prod', 'test')),
  constraint chk_markets_settlement_status
    check (settlement_status is null or settlement_status in ('pending', 'processing', 'completed')),
  constraint chk_markets_time_window check (open_at < close_at),
  constraint chk_markets_liquidity_b_positive check (liquidity_b > 0)
);

create table if not exists market_outcomes (
  id text primary key,
  market_id text not null,
  label text not null,
  short_label text,
  description text,
  image_url text,
  color_key text,
  sort_order integer not null,
  is_winner boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_market_outcomes_market
    foreign key (market_id) references markets (id) on delete restrict,
  constraint uq_market_outcomes_market_id_id unique (market_id, id),
  constraint uq_market_outcomes_market_sort unique (market_id, sort_order),
  constraint uq_market_outcomes_market_label unique (market_id, label),
  constraint chk_market_outcomes_sort_order check (sort_order >= 0)
);

create table if not exists market_pricing_state (
  market_id text primary key,
  version bigint not null default 0,
  liquidity_b numeric(20, 8) not null,
  updated_at timestamptz not null default now(),
  constraint fk_market_pricing_state_market
    foreign key (market_id) references markets (id) on delete restrict,
  constraint chk_market_pricing_state_version check (version >= 0),
  constraint chk_market_pricing_state_liquidity_b_positive check (liquidity_b > 0)
);

create table if not exists market_outcome_state (
  market_id text not null,
  outcome_id text not null,
  q_shares numeric(20, 6) not null default 0,
  last_price numeric(12, 8) not null,
  updated_at timestamptz not null default now(),
  constraint pk_market_outcome_state primary key (market_id, outcome_id),
  constraint fk_market_outcome_state_market
    foreign key (market_id) references markets (id) on delete restrict,
  constraint fk_market_outcome_state_outcome
    foreign key (market_id, outcome_id) references market_outcomes (market_id, id) on delete restrict,
  constraint chk_market_outcome_state_q_shares_non_negative check (q_shares >= 0),
  constraint chk_market_outcome_state_last_price_range check (last_price >= 0 and last_price <= 1)
);
