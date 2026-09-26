create table if not exists user_social_links (
  user_id text not null,
  platform text not null,
  handle text,
  url text not null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pk_user_social_links primary key (user_id, platform),
  constraint fk_user_social_links_user
    foreign key (user_id) references users (id) on delete restrict,
  constraint chk_user_social_links_platform
    check (platform in ('x', 'telegram', 'instagram', 'website')),
  constraint chk_user_social_links_handle_length
    check (handle is null or char_length(handle) <= 40),
  constraint chk_user_social_links_url_length
    check (char_length(url) <= 240)
);

create index if not exists idx_user_social_links_user_updated
  on user_social_links (user_id, updated_at desc);

create table if not exists account_deletion_requests (
  id text primary key,
  user_id text not null,
  status text not null,
  reason text,
  previous_trade_access_status text not null,
  created_session_id text,
  scheduled_at timestamptz not null default now(),
  delete_after timestamptz not null,
  cancelled_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint fk_account_deletion_requests_user
    foreign key (user_id) references users (id) on delete restrict,
  constraint chk_account_deletion_requests_status
    check (status in ('scheduled', 'cancelled', 'completed')),
  constraint chk_account_deletion_requests_previous_trade_access
    check (previous_trade_access_status in ('enabled', 'blocked')),
  constraint chk_account_deletion_requests_reason_length
    check (reason is null or char_length(reason) <= 240),
  constraint chk_account_deletion_requests_window
    check (delete_after > scheduled_at)
);

create unique index if not exists uq_account_deletion_requests_user_scheduled
  on account_deletion_requests (user_id)
  where status = 'scheduled';

create index if not exists idx_account_deletion_requests_due
  on account_deletion_requests (delete_after)
  where status = 'scheduled';
