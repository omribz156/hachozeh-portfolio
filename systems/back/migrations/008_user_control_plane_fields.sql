alter table users
  add column if not exists trade_access_status text,
  add column if not exists lock_reason_code text,
  add column if not exists locked_at timestamptz;

update users
set trade_access_status = 'enabled'
where trade_access_status is null;

alter table users
  alter column trade_access_status set default 'enabled',
  alter column trade_access_status set not null;

alter table users
  drop constraint if exists chk_users_status;

alter table users
  drop constraint if exists chk_users_trade_access_status;

alter table users
  add constraint chk_users_status check (status in ('active', 'locked', 'archived')),
  add constraint chk_users_trade_access_status
    check (trade_access_status in ('enabled', 'blocked'));
