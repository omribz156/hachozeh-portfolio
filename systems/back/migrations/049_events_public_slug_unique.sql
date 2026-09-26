create unique index if not exists idx_events_slug_unique
  on events (lower(slug))
  where slug is not null;
