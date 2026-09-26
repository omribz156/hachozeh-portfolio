alter table beta_invites
  add column if not exists identifier_normalized text;

create index if not exists idx_beta_invites_identifier_normalized
  on beta_invites (identifier_normalized)
  where identifier_normalized is not null;
