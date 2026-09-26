-- Referral grants: a signup attributed to a user's shared win link credits the
-- sharer (decided 2026-07-02: 1000 V₪ per attributed signup). One grant per new
-- user, ever — the unique key is the abuse backstop the code path relies on.
create table if not exists referral_grants (
  id text primary key,
  new_user_id text not null unique,
  sharer_user_id text not null,
  claim_id text,
  amount numeric(18, 6) not null,
  created_at timestamptz not null default now(),
  constraint fk_referral_grants_new_user
    foreign key (new_user_id) references users (id) on delete cascade,
  constraint fk_referral_grants_sharer
    foreign key (sharer_user_id) references users (id) on delete cascade,
  constraint fk_referral_grants_claim
    foreign key (claim_id) references realization_events (id) on delete set null
);

create index if not exists idx_referral_grants_sharer_created
  on referral_grants (sharer_user_id, created_at desc);

-- New abuse-flag type for referral farming (daily cap breaches).
alter table user_abuse_flags
  drop constraint if exists chk_user_abuse_flags_type;

alter table user_abuse_flags
  add constraint chk_user_abuse_flags_type
    check (flag_type in ('signup_velocity', 'faucet_velocity', 'referral_velocity'));
