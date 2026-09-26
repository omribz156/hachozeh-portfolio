alter table markets
  add column if not exists oracle_source_policy jsonb not null default '{}'::jsonb;

create table if not exists oracle_cases (
  id text primary key,
  market_id text not null,
  case_type text not null,
  market_status text not null,
  case_status text not null,
  ambiguity_level text,
  summary text,
  scheduled_close_at timestamptz,
  current_winning_outcome_id text,
  source_policy_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint fk_oracle_cases_market
    foreign key (market_id) references markets (id) on delete restrict,
  constraint fk_oracle_cases_current_winner
    foreign key (market_id, current_winning_outcome_id) references market_outcomes (market_id, id) on delete restrict,
  constraint chk_oracle_cases_case_type
    check (case_type in ('close_condition_check', 'resolution_check')),
  constraint chk_oracle_cases_market_status
    check (market_status in ('draft', 'open', 'closed', 'resolved')),
  constraint chk_oracle_cases_case_status
    check (case_status in ('recommended', 'review_needed', 'no_action')),
  constraint chk_oracle_cases_ambiguity_level
    check (ambiguity_level is null or ambiguity_level in ('low', 'medium', 'high'))
);

create index if not exists idx_oracle_cases_market_created_at
  on oracle_cases (market_id, created_at desc);

create table if not exists oracle_evidence_packets (
  id text primary key,
  oracle_case_id text not null,
  market_id text not null,
  evidence_summary text not null,
  sources_snapshot jsonb not null,
  captured_at timestamptz not null,
  winning_outcome_id text,
  close_condition_satisfied boolean,
  notes text,
  created_at timestamptz not null default now(),
  constraint fk_oracle_evidence_packets_case
    foreign key (oracle_case_id) references oracle_cases (id) on delete restrict,
  constraint fk_oracle_evidence_packets_market
    foreign key (market_id) references markets (id) on delete restrict,
  constraint fk_oracle_evidence_packets_winner
    foreign key (market_id, winning_outcome_id) references market_outcomes (market_id, id) on delete restrict
);

create index if not exists idx_oracle_evidence_packets_case_created_at
  on oracle_evidence_packets (oracle_case_id, created_at desc);

create table if not exists oracle_case_outputs (
  id text primary key,
  oracle_case_id text not null,
  market_id text not null,
  output_type text not null,
  output_snapshot jsonb not null,
  created_at timestamptz not null,
  constraint fk_oracle_case_outputs_case
    foreign key (oracle_case_id) references oracle_cases (id) on delete restrict,
  constraint fk_oracle_case_outputs_market
    foreign key (market_id) references markets (id) on delete restrict,
  constraint chk_oracle_case_outputs_type
    check (
      output_type in (
        'early_close_recommendation',
        'resolution_recommendation',
        'oracle_review_signal'
      )
    )
);

create index if not exists idx_oracle_case_outputs_case_created_at
  on oracle_case_outputs (oracle_case_id, created_at desc);
