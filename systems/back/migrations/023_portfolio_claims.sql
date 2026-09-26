alter table realization_events
  add column if not exists claim_status text not null default 'not_applicable',
  add column if not exists claimed_at timestamptz,
  add column if not exists claim_ledger_transaction_id text;

update realization_events
set claim_status = case
    when type = 'resolution_win' then 'claimed'
    else 'not_applicable'
  end,
  claimed_at = case
    when type = 'resolution_win' then created_at
    else null
  end
where claim_status = 'not_applicable';

alter table realization_events
  drop constraint if exists chk_realization_events_claim_status;

alter table realization_events
  add constraint chk_realization_events_claim_status
    check (claim_status in ('not_applicable', 'pending', 'claimed'));

alter table realization_events
  drop constraint if exists fk_realization_events_claim_ledger_transaction;

alter table realization_events
  add constraint fk_realization_events_claim_ledger_transaction
    foreign key (claim_ledger_transaction_id)
    references ledger_transactions (id)
    on delete restrict;

create index if not exists idx_realization_events_user_claim_status
  on realization_events (user_id, claim_status, created_at);
