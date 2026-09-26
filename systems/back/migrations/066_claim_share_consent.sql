-- Share-by-consent for win claims: a resolution_win realization becomes publicly
-- readable (share card + landing page) only after its owner takes a share action.
-- The stamp is one-way: once shared, the snapshot stays public.
alter table realization_events
  add column if not exists share_consented_at timestamptz;
