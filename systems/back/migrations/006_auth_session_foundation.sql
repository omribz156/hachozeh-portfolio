create table if not exists users (
  id text primary key,
  status text not null,
  role text not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz,
  constraint chk_users_status check (status in ('active', 'locked')),
  constraint chk_users_role check (role in ('user', 'admin'))
);

create table if not exists user_identities (
  id text primary key,
  user_id text not null,
  type text not null,
  identifier_normalized text not null,
  identifier_display text not null,
  status text not null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_user_identities_user
    foreign key (user_id) references users (id) on delete restrict,
  constraint chk_user_identities_type check (type in ('email')),
  constraint chk_user_identities_status check (status in ('active', 'blocked'))
);

create unique index if not exists uq_user_identities_type_identifier
  on user_identities (type, identifier_normalized);

create table if not exists otp_challenges (
  id text primary key,
  identifier_type text not null,
  identifier_normalized text not null,
  purpose text not null,
  code_hash text not null,
  status text not null,
  attempt_count integer not null default 0,
  max_attempts integer not null,
  last_sent_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_otp_challenges_identifier_type check (identifier_type in ('email')),
  constraint chk_otp_challenges_purpose check (purpose in ('login', 'signup')),
  constraint chk_otp_challenges_status check (status in ('pending', 'consumed', 'expired', 'cancelled')),
  constraint chk_otp_challenges_attempt_count_non_negative check (attempt_count >= 0),
  constraint chk_otp_challenges_max_attempts_positive check (max_attempts > 0)
);

create index if not exists idx_otp_challenges_identifier_created_at
  on otp_challenges (identifier_normalized, created_at desc);

create table if not exists sessions (
  id text primary key,
  user_id text not null,
  status text not null,
  token_hash text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_reason text,
  ip_hash text,
  user_agent_hash text,
  constraint fk_sessions_user
    foreign key (user_id) references users (id) on delete restrict,
  constraint chk_sessions_status check (status in ('active', 'revoked', 'expired'))
);

create unique index if not exists uq_sessions_token_hash
  on sessions (token_hash);

create index if not exists idx_sessions_user_status
  on sessions (user_id, status);
