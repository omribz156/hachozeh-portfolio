create table if not exists oracle_operator_reminders (
  id text primary key,
  reminder_key text not null unique,
  reminder_type text not null,
  market_id text,
  oracle_case_id text,
  first_seen_at timestamptz not null,
  sent_at timestamptz,
  channel text not null,
  delivery_status text not null default 'pending' check (
    delivery_status in ('pending', 'sent', 'failed')
  ),
  attempt_count integer not null default 0,
  last_attempt_at timestamptz,
  delivery_error text,
  payload_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_oracle_operator_reminders_market
    foreign key (market_id) references markets (id) on delete set null,
  constraint fk_oracle_operator_reminders_case
    foreign key (oracle_case_id) references oracle_cases (id) on delete set null,
  constraint chk_oracle_operator_reminders_key_not_empty
    check (length(trim(reminder_key)) > 0),
  constraint chk_oracle_operator_reminders_type_not_empty
    check (length(trim(reminder_type)) > 0),
  constraint chk_oracle_operator_reminders_channel_not_empty
    check (length(trim(channel)) > 0)
);

create index if not exists idx_oracle_operator_reminders_market_created
  on oracle_operator_reminders (market_id, created_at desc);

create index if not exists idx_oracle_operator_reminders_status_created
  on oracle_operator_reminders (delivery_status, created_at desc);
