-- Market tagging: a flat tag co-graph powering the "related markets" module.
--
-- Tags are a controlled, mixed-granularity vocabulary (broad topics AND named
-- entities in one flat set), modelled on Polymarket's live tag structure. Two
-- markets are "related" when they share a tag; `market_tags` is that co-graph.
--
-- Category (markets.category_key) stays authoritative and is ALSO mirrored as a
-- tag (kind 'topic') so it surfaces as the broadest tab. market_family_key
-- (recurring series) is NOT a tag — it is a ranking boost + has its own series hub.

create table if not exists tags (
  id text primary key,
  slug text not null,
  label text not null,
  kind text,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_tags_slug unique (slug),
  constraint chk_tags_kind check (kind is null or kind in ('topic', 'person', 'org', 'event'))
);

create table if not exists market_tags (
  market_id text not null,
  tag_id text not null,
  weight integer not null default 0,
  created_at timestamptz not null default now(),
  constraint pk_market_tags primary key (market_id, tag_id),
  constraint fk_market_tags_market foreign key (market_id) references markets (id) on delete cascade,
  constraint fk_market_tags_tag foreign key (tag_id) references tags (id) on delete cascade
);

-- "markets carrying tag X" (the related lookup) + "tags of market M" (the tab row).
create index if not exists idx_market_tags_tag on market_tags (tag_id, market_id);
create index if not exists idx_market_tags_market on market_tags (market_id);
