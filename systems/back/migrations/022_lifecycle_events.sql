create table if not exists lifecycle_events (
  id text primary key,
  market_id text not null,
  event_type text not null,
  source_system text not null,
  actor_id text not null,
  occurred_at timestamptz not null,
  correlation_id text,
  dedupe_key text,
  audit_event_id text,
  oracle_case_id text,
  resolution_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint fk_lifecycle_events_market
    foreign key (market_id) references markets (id) on delete restrict,
  constraint chk_lifecycle_events_type_not_empty
    check (length(trim(event_type)) > 0),
  constraint chk_lifecycle_events_source_not_empty
    check (length(trim(source_system)) > 0),
  constraint chk_lifecycle_events_actor_not_empty
    check (length(trim(actor_id)) > 0)
);

create index if not exists idx_lifecycle_events_market_occurred
  on lifecycle_events (market_id, occurred_at desc);

create index if not exists idx_lifecycle_events_type_occurred
  on lifecycle_events (event_type, occurred_at desc);

create unique index if not exists uq_lifecycle_events_dedupe_key
  on lifecycle_events (dedupe_key)
  where dedupe_key is not null;
