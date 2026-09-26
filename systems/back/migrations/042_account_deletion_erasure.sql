alter table users
  add column if not exists privacy_erased_at timestamptz,
  add column if not exists privacy_erasure_reason text;

alter table users
  drop constraint if exists chk_users_privacy_erasure_reason_length;

alter table users
  add constraint chk_users_privacy_erasure_reason_length
    check (privacy_erasure_reason is null or char_length(privacy_erasure_reason) <= 80);
