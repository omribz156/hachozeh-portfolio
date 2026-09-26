-- Per-event display flags (operator authoring choices that don't belong on any
-- single child market's contract). First flag: `showGraph` — whether the event
-- detail view renders the multi-line probability chart (one line per child).
-- Default '{}' so existing events read as showGraph=false (chart off).
alter table events
  add column if not exists display_flags jsonb not null default '{}'::jsonb;
