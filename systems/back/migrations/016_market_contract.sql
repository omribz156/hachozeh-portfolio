alter table markets
  add column if not exists market_contract jsonb not null default '{}'::jsonb;
