create table if not exists market_watch_plans (
  id text primary key,
  market_id text references markets(id) on delete cascade,
  event_id text references events(id) on delete cascade,
  checker_kind text not null check (checker_kind in ('show_official_keywords')),
  enabled boolean not null default true,
  timezone text not null default 'Asia/Jerusalem',
  run_policy jsonb not null default '{}'::jsonb,
  next_run_at timestamptz,
  source_urls jsonb not null default '[]'::jsonb,
  entities jsonb not null default '[]'::jsonb,
  keywords jsonb not null default '[]'::jsonb,
  last_checked_at timestamptz,
  last_alert_fingerprint text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (market_id is not null or event_id is not null),
  check (jsonb_typeof(source_urls) = 'array'),
  check (jsonb_typeof(entities) = 'array'),
  check (jsonb_typeof(keywords) = 'array'),
  check (jsonb_typeof(run_policy) = 'object')
);

create index if not exists market_watch_plans_due_idx
  on market_watch_plans (enabled, next_run_at)
  where enabled = true;

create index if not exists market_watch_plans_market_idx
  on market_watch_plans (market_id)
  where market_id is not null;

create index if not exists market_watch_plans_event_idx
  on market_watch_plans (event_id)
  where event_id is not null;

create table if not exists market_watch_signals (
  id text primary key,
  watch_plan_id text not null references market_watch_plans(id) on delete cascade,
  market_id text references markets(id) on delete set null,
  event_id text references events(id) on delete set null,
  signal_kind text not null,
  matched_entity text,
  matched_keyword text,
  source_url text,
  source_title text,
  summary text not null,
  fingerprint text not null,
  status text not null default 'new' check (status in ('new', 'dismissed', 'promoted')),
  delivery_status text not null default 'pending' check (delivery_status in ('pending', 'sent', 'failed', 'skipped')),
  delivery_error text,
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  payload_snapshot jsonb not null default '{}'::jsonb,
  unique (watch_plan_id, fingerprint)
);

create index if not exists market_watch_signals_plan_status_idx
  on market_watch_signals (watch_plan_id, status, created_at desc);

create index if not exists market_watch_signals_event_idx
  on market_watch_signals (event_id, created_at desc)
  where event_id is not null;
