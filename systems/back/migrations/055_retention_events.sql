-- Milestone 0 — product-wide retention instrumentation.
-- Two shapes, kept separate so analysis is a plain SQL join later:
--   1. retention_events     — one-time cohort milestones per user (signup, activation)
--   2. retention_active_days — daily-active dedup, for return-day (D1/D7) computation
-- Append-only / dedup-by-key; nothing here is read on a hot path. On user deletion
-- the rows cascade away (analytics ephemera, must not block or survive erasure).

create table if not exists retention_events (
  id text primary key,
  user_id text not null,
  event text not null,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint fk_retention_events_user
    foreign key (user_id) references users (id) on delete cascade,
  constraint chk_retention_events_event
    check (event in ('signup', 'first_loop_complete')),
  -- each milestone is recorded once per user (insert ... on conflict do nothing)
  constraint uq_retention_events_user_event unique (user_id, event)
);

create index if not exists idx_retention_events_event_created
  on retention_events (event, created_at);

create table if not exists retention_active_days (
  user_id text not null,
  -- Jerusalem-local calendar date (matches the faucet/profile-view daily convention),
  -- computed in app code so a UTC midnight doesn't split a local day.
  day_date date not null,
  first_seen_at timestamptz not null default now(),
  constraint pk_retention_active_days primary key (user_id, day_date),
  constraint fk_retention_active_days_user
    foreign key (user_id) references users (id) on delete cascade
);

create index if not exists idx_retention_active_days_date
  on retention_active_days (day_date);
