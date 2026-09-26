create table if not exists discovery_curation_slots (
  surface text not null check (surface in ('hero', 'trending')),
  position integer not null check (position > 0),
  target_type text not null check (target_type in ('market', 'event')),
  target_key text not null,
  enabled boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (surface, position),
  check (starts_at is null or ends_at is null or starts_at < ends_at)
);

create index if not exists discovery_curation_slots_active_idx
  on discovery_curation_slots (surface, enabled, position);

create index if not exists discovery_curation_slots_target_idx
  on discovery_curation_slots (target_type, target_key);
