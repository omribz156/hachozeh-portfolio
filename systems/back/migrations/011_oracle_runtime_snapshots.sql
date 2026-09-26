create table if not exists oracle_runtime_snapshots (
  id text primary key,
  runtime_type text not null check (
    runtime_type in (
      'heartbeat',
      'alerts'
    )
  ),
  market_status_filter text not null check (
    market_status_filter in (
      'open',
      'closed',
      'all'
    )
  ),
  generated_at timestamptz not null,
  summary_snapshot jsonb not null default '{}'::jsonb,
  payload_snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_oracle_runtime_snapshots_type_generated
  on oracle_runtime_snapshots (runtime_type, generated_at desc);
