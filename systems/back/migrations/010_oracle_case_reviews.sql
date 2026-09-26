create table if not exists oracle_case_reviews (
  id text primary key,
  oracle_case_id text not null references oracle_cases(id) on delete cascade,
  market_id text not null references markets(id) on delete cascade,
  review_action text not null check (
    review_action in (
      'approve_resolution'
    )
  ),
  result_status text not null check (
    result_status in (
      'attempted',
      'completed',
      'failed'
    )
  ),
  actor_id text not null,
  actor_role text not null check (
    actor_role in (
      'user',
      'admin'
    )
  ),
  review_note text,
  idempotency_key text not null,
  resolution_id text references market_resolutions(id) on delete set null,
  resolve_response_snapshot jsonb,
  failure_code text,
  failure_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  failed_at timestamptz
);

create index if not exists idx_oracle_case_reviews_case_created
  on oracle_case_reviews (oracle_case_id, created_at desc);

create unique index if not exists idx_oracle_case_reviews_case_action_idempotency
  on oracle_case_reviews (oracle_case_id, review_action, idempotency_key);
