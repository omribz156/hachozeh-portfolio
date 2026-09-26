create table if not exists discovery_curation_settings (
  surface text primary key check (surface in ('hero', 'trending')),
  max_items integer check (max_items is null or max_items > 0),
  fill boolean,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
