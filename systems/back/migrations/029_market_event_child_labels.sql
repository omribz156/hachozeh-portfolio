-- Persist the child-row label used by event-mode market-detail pages.
--
-- Seer already emits eventChildLabel, but backend previously stored only
-- markets.event_id. Multi-child event pages need a stable child label instead
-- of guessing from the full market title.

alter table markets
  add column if not exists event_child_label text;
