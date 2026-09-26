create table if not exists contract_positions (
  user_id text not null,
  market_id text not null,
  requested_outcome_id text not null,
  requested_outcome_key text not null,
  contract_side text not null,
  shares numeric(20, 6) not null,
  cost_basis numeric(20, 6) not null,
  realized_pnl numeric(20, 6) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_trade_at timestamptz,
  settled_at timestamptz,
  constraint pk_contract_positions
    primary key (user_id, market_id, requested_outcome_id, contract_side),
  constraint fk_contract_positions_market
    foreign key (market_id) references markets (id) on delete restrict,
  constraint fk_contract_positions_market_outcome
    foreign key (market_id, requested_outcome_id)
    references market_outcomes (market_id, id) on delete restrict,
  constraint chk_contract_positions_contract_side check (contract_side in ('yes', 'no')),
  constraint chk_contract_positions_shares_positive check (shares > 0),
  constraint chk_contract_positions_cost_basis_non_negative check (cost_basis >= 0)
);

create index if not exists idx_contract_positions_market_side
  on contract_positions (market_id, requested_outcome_id, contract_side);

create index if not exists idx_contract_positions_user
  on contract_positions (user_id);

insert into contract_positions (
  user_id,
  market_id,
  requested_outcome_id,
  requested_outcome_key,
  contract_side,
  shares,
  cost_basis,
  realized_pnl,
  created_at,
  updated_at,
  last_trade_at
)
select
  grouped.user_id,
  grouped.market_id,
  grouped.requested_outcome_id,
  grouped.requested_outcome_key,
  grouped.contract_side,
  grouped.open_shares::numeric(20, 6) as shares,
  greatest(grouped.buy_cash - grouped.sell_cash, 0)::numeric(20, 6) as cost_basis,
  greatest(grouped.sell_cash - grouped.buy_cash, 0)::numeric(20, 6) as realized_pnl,
  grouped.first_trade_at,
  grouped.last_trade_at,
  grouped.last_trade_at
from (
  select
    t.user_id,
    t.market_id,
    coalesce(requested_outcome.id, t.requested_outcome_key) as requested_outcome_id,
    t.requested_outcome_key,
    t.contract_side,
    sum(case when t.side = 'buy' then t.share_amount else -t.share_amount end) as open_shares,
    coalesce(sum(case when t.side = 'buy' then t.cash_amount else 0 end), 0) as buy_cash,
    coalesce(sum(case when t.side = 'sell' then t.cash_amount else 0 end), 0) as sell_cash,
    min(t.created_at) as first_trade_at,
    max(t.created_at) as last_trade_at
  from trades t
  left join market_outcomes requested_outcome
    on requested_outcome.market_id = t.market_id
   and requested_outcome.id = t.requested_outcome_key
  group by
    t.user_id,
    t.market_id,
    coalesce(requested_outcome.id, t.requested_outcome_key),
    t.requested_outcome_key,
    t.contract_side
) grouped
join market_outcomes outcome_guard
  on outcome_guard.market_id = grouped.market_id
 and outcome_guard.id = grouped.requested_outcome_id
where grouped.open_shares > 0
on conflict (user_id, market_id, requested_outcome_id, contract_side) do nothing;
