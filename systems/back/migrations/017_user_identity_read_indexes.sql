create index if not exists idx_user_identities_active_user_lookup
  on user_identities (user_id, verified_at desc nulls last, created_at asc)
  where status = 'active';
