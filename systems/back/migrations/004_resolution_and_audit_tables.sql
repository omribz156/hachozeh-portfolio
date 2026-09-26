create table if not exists market_resolutions (
  id text primary key,
  market_id text not null,
  winning_outcome_id text not null,
  resolved_by text not null,
  source_url text not null,
  notes text not null,
  resolved_at timestamptz not null,
  constraint uq_market_resolutions_market unique (market_id),
  constraint fk_market_resolutions_market
    foreign key (market_id) references markets (id) on delete restrict,
  constraint fk_market_resolutions_winning_outcome
    foreign key (market_id, winning_outcome_id) references market_outcomes (market_id, id) on delete restrict
);

create table if not exists realization_events (
  id text primary key,
  user_id text not null,
  market_id text not null,
  outcome_id text not null,
  type text not null,
  shares_closed numeric(20, 6) not null,
  proceeds numeric(20, 6) not null,
  removed_cost_basis numeric(20, 6) not null,
  realized_pnl numeric(20, 6) not null,
  trade_id text,
  resolution_id text,
  created_at timestamptz not null default now(),
  constraint fk_realization_events_market
    foreign key (market_id) references markets (id) on delete restrict,
  constraint fk_realization_events_market_outcome
    foreign key (market_id, outcome_id) references market_outcomes (market_id, id) on delete restrict,
  constraint fk_realization_events_trade
    foreign key (trade_id) references trades (id) on delete restrict,
  constraint fk_realization_events_resolution
    foreign key (resolution_id) references market_resolutions (id) on delete restrict,
  constraint chk_realization_events_type
    check (type in ('sell', 'resolution_win', 'resolution_loss')),
  constraint chk_realization_events_shares_closed_positive check (shares_closed > 0)
);

create table if not exists audit_events (
  id text primary key,
  actor_id text not null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint chk_audit_events_action_not_empty check (length(trim(action)) > 0)
);
