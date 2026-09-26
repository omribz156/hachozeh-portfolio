alter table users
  add column if not exists handle_updated_at timestamptz;

create index if not exists idx_users_handle_updated_at
  on users (handle_updated_at)
  where handle_updated_at is not null;
