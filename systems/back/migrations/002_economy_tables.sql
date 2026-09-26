create table if not exists accounts (
  id text primary key,
  type text not null,
  owner_id text not null,
  status text not null,
  balance_cached numeric(20, 6) not null default 0,
  locked_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_accounts_type
    check (type in ('user_cash', 'market_treasury', 'platform_treasury', 'mint_source', 'sink')),
  constraint chk_accounts_status check (status in ('active', 'locked'))
);

alter table markets
  add constraint fk_markets_market_treasury_account
  foreign key (market_treasury_account_id) references accounts (id) on delete restrict;

create table if not exists ledger_transactions (
  id text primary key,
  sequence_number bigint not null,
  type text not null,
  reference_type text not null,
  reference_id text not null,
  idempotency_key text,
  created_by text not null,
  created_at timestamptz not null default now(),
  posted_at timestamptz not null,
  market_id text,
  outcome_id text,
  compensates_transaction_id text,
  compensation_reason text,
  triggered_by text,
  triggered_by_id text,
  position_id text,
  position_cycle_id text,
  trade_side text,
  trade_price_before numeric(12, 8),
  trade_price_after numeric(12, 8),
  resolution_id text,
  shares_settled numeric(20, 6),
  settlement_price numeric(12, 8),
  settlement_batch_id text,
  previous_transaction_hash text not null,
  transaction_hash text not null,
  constraint fk_ledger_transactions_market
    foreign key (market_id) references markets (id) on delete restrict,
  constraint fk_ledger_transactions_compensates
    foreign key (compensates_transaction_id) references ledger_transactions (id) on delete restrict,
  constraint chk_ledger_transactions_sequence_positive check (sequence_number > 0),
  constraint chk_ledger_transactions_trade_side
    check (trade_side is null or trade_side in ('buy', 'sell'))
);

create table if not exists ledger_entries (
  id text primary key,
  transaction_id text not null,
  account_id text not null,
  amount numeric(20, 6) not null,
  entry_role text not null,
  memo text,
  constraint fk_ledger_entries_transaction
    foreign key (transaction_id) references ledger_transactions (id) on delete restrict,
  constraint fk_ledger_entries_account
    foreign key (account_id) references accounts (id) on delete restrict,
  constraint chk_ledger_entries_amount_non_zero check (amount <> 0)
);
