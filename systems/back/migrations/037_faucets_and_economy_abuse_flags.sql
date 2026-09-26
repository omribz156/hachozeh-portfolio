create table if not exists user_faucet_state (
  user_id text not null,
  faucet_type text not null,
  current_streak_day integer not null default 0,
  last_claimed_at timestamptz,
  last_claimed_local_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pk_user_faucet_state primary key (user_id, faucet_type),
  constraint fk_user_faucet_state_user
    foreign key (user_id) references users (id) on delete restrict,
  constraint chk_user_faucet_state_type
    check (faucet_type in ('daily_login', 'emergency_bankruptcy')),
  constraint chk_user_faucet_state_streak_day
    check (current_streak_day >= 0 and current_streak_day <= 7)
);

create table if not exists faucet_claims (
  id text primary key,
  user_id text not null,
  faucet_type text not null,
  reward_amount numeric(20, 6) not null,
  streak_day_awarded integer,
  claim_window_key text not null,
  claim_local_date date,
  eligibility_reason text not null,
  ledger_transaction_id text not null,
  created_at timestamptz not null default now(),
  constraint fk_faucet_claims_user
    foreign key (user_id) references users (id) on delete restrict,
  constraint fk_faucet_claims_ledger_transaction
    foreign key (ledger_transaction_id) references ledger_transactions (id) on delete restrict,
  constraint chk_faucet_claims_type
    check (faucet_type in ('daily_login', 'emergency_bankruptcy')),
  constraint chk_faucet_claims_reward_positive check (reward_amount > 0),
  constraint chk_faucet_claims_streak_day
    check (streak_day_awarded is null or (streak_day_awarded >= 1 and streak_day_awarded <= 7)),
  constraint chk_faucet_claims_eligibility_reason
    check (eligibility_reason in ('active_position_streak', 'no_active_position_baseline', 'bankruptcy_emergency'))
);

create unique index if not exists uq_faucet_claims_user_type_window
  on faucet_claims (user_id, faucet_type, claim_window_key);

create index if not exists idx_faucet_claims_user_created
  on faucet_claims (user_id, created_at desc);

create table if not exists user_abuse_flags (
  id text primary key,
  user_id text not null,
  flag_type text not null,
  severity text not null,
  status text not null default 'open',
  evidence jsonb not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint fk_user_abuse_flags_user
    foreign key (user_id) references users (id) on delete restrict,
  constraint chk_user_abuse_flags_type
    check (flag_type in ('signup_velocity', 'faucet_velocity')),
  constraint chk_user_abuse_flags_severity check (severity in ('watch', 'review')),
  constraint chk_user_abuse_flags_status check (status in ('open', 'resolved', 'ignored'))
);

create index if not exists idx_user_abuse_flags_user_status
  on user_abuse_flags (user_id, status, created_at desc);

create index if not exists idx_user_abuse_flags_type_created
  on user_abuse_flags (flag_type, created_at desc);
