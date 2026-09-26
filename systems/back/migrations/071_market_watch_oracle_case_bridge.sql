alter table market_watch_signals
  add column if not exists oracle_case_id text references oracle_cases(id) on delete set null,
  add column if not exists promotion_error text;

create index if not exists market_watch_signals_oracle_case_idx
  on market_watch_signals (oracle_case_id)
  where oracle_case_id is not null;
