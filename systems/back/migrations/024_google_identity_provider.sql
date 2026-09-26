alter table user_identities
  drop constraint if exists chk_user_identities_type;

alter table user_identities
  add constraint chk_user_identities_type check (type in ('email', 'google'));
