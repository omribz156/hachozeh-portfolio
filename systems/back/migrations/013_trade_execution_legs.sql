create table if not exists trade_execution_legs (
  id text primary key,
  trade_id text not null,
  outcome_id text not null,
  share_amount numeric(20, 6) not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint fk_trade_execution_legs_trade
    foreign key (trade_id) references trades (id) on delete cascade,
  constraint chk_trade_execution_legs_share_amount_positive
    check (share_amount > 0)
);

create index if not exists idx_trade_execution_legs_trade
  on trade_execution_legs (trade_id, sort_order);
