create unique index if not exists uq_accounts_user_cash_owner
  on accounts (owner_id)
  where type = 'user_cash';

create unique index if not exists uq_accounts_market_treasury_owner
  on accounts (owner_id)
  where type = 'market_treasury';

create unique index if not exists uq_accounts_platform_treasury_singleton
  on accounts (type)
  where type = 'platform_treasury';

create unique index if not exists uq_accounts_mint_source_singleton
  on accounts (type)
  where type = 'mint_source';

create unique index if not exists uq_accounts_sink_singleton
  on accounts (type)
  where type = 'sink';

create unique index if not exists uq_ledger_transactions_sequence_number
  on ledger_transactions (sequence_number);

create unique index if not exists uq_ledger_transactions_transaction_hash
  on ledger_transactions (transaction_hash);

create unique index if not exists uq_idempotency_records_scope_actor_key
  on idempotency_records (scope, actor_id, idempotency_key);

create index if not exists idx_markets_status on markets (status);
create index if not exists idx_markets_close_at on markets (close_at);
create index if not exists idx_markets_status_close_at on markets (status, close_at);

create index if not exists idx_market_outcomes_market_id on market_outcomes (market_id);

create index if not exists idx_accounts_owner_id on accounts (owner_id);
create index if not exists idx_accounts_type_owner_id on accounts (type, owner_id);

create index if not exists idx_ledger_transactions_reference
  on ledger_transactions (reference_type, reference_id);
create index if not exists idx_ledger_transactions_market_id
  on ledger_transactions (market_id);
create index if not exists idx_ledger_transactions_outcome_id
  on ledger_transactions (outcome_id);
create index if not exists idx_ledger_transactions_posted_at
  on ledger_transactions (posted_at);
create index if not exists idx_ledger_transactions_compensates
  on ledger_transactions (compensates_transaction_id);

create index if not exists idx_ledger_entries_transaction_id
  on ledger_entries (transaction_id);
create index if not exists idx_ledger_entries_account_id
  on ledger_entries (account_id);
create index if not exists idx_ledger_entries_account_transaction
  on ledger_entries (account_id, transaction_id);

create index if not exists idx_trades_user_id on trades (user_id);
create index if not exists idx_trades_market_id on trades (market_id);
create index if not exists idx_trades_user_created_at on trades (user_id, created_at);
create index if not exists idx_trades_market_created_at on trades (market_id, created_at);

create index if not exists idx_positions_user_id on positions (user_id);
create index if not exists idx_positions_market_id on positions (market_id);

create index if not exists idx_realization_events_user_id
  on realization_events (user_id);
create index if not exists idx_realization_events_market_id
  on realization_events (market_id);
create index if not exists idx_realization_events_resolution_id
  on realization_events (resolution_id);
create index if not exists idx_realization_events_user_created_at
  on realization_events (user_id, created_at);

create index if not exists idx_market_resolutions_resolved_at
  on market_resolutions (resolved_at);

create index if not exists idx_idempotency_records_created_at
  on idempotency_records (created_at);
create index if not exists idx_idempotency_records_resource
  on idempotency_records (resource_type, resource_id);

create index if not exists idx_audit_events_actor_id on audit_events (actor_id);
create index if not exists idx_audit_events_entity
  on audit_events (entity_type, entity_id);
create index if not exists idx_audit_events_created_at
  on audit_events (created_at);
