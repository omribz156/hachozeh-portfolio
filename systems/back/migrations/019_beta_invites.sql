create table if not exists beta_invites (
  id text primary key,
  token_hash text not null,
  status text not null default 'pending',
  label text,
  notes text,
  expires_at timestamptz,
  consumed_at timestamptz,
  consumed_by_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_beta_invites_status
    check (status in ('pending', 'consumed', 'revoked', 'expired')),
  constraint uq_beta_invites_token_hash
    unique (token_hash),
  constraint fk_beta_invites_consumed_by_user
    foreign key (consumed_by_user_id)
    references users(id)
);

create index if not exists idx_beta_invites_status_expires
  on beta_invites (status, expires_at);

alter table otp_challenges
  add column if not exists beta_invite_id text;

alter table otp_challenges
  add constraint fk_otp_challenges_beta_invite
    foreign key (beta_invite_id)
    references beta_invites(id);

create index if not exists idx_otp_challenges_beta_invite_id
  on otp_challenges (beta_invite_id)
  where beta_invite_id is not null;
