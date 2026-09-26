alter table trades
  add column if not exists requested_outcome_key text;

update trades
set requested_outcome_key = outcome_id
where requested_outcome_key is null;

alter table trades
  alter column requested_outcome_key set not null;

alter table trades
  add column if not exists contract_side text;

update trades
set contract_side = 'yes'
where contract_side is null;

alter table trades
  alter column contract_side set not null;

alter table trades
  drop constraint if exists chk_trades_contract_side;

alter table trades
  add constraint chk_trades_contract_side
  check (contract_side in ('yes', 'no'));

create index if not exists idx_trades_contract_side on trades (contract_side);
