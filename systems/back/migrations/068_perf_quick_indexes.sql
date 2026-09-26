-- Perf quick wins (performance-audit.md F13/F14/F15):
--  1. Partial indexes for open-position lookups. contract_positions has no
--     index covering settled_at — discovery viewer-positions
--     (discovery/feed/query.ts), closing-soon holder lookups
--     (notification-feed-service.ts), and leaderboard open marks
--     (social/leaderboard-service.ts) all filter on
--     `settled_at is null` scoped by market or by user.
--  2. realization_events has no created_at-leading index; the leaderboard
--     time-window scan (social/leaderboard-service.ts) is an unscoped
--     full-table scan today.
--  3. idx_market_base_candles_window (migration 048) exactly duplicates the
--     table's primary key (market_id, bucket_at) — pure write amplification
--     on the per-trade candle upsert path. Dropped.

create index if not exists idx_contract_positions_market_open
  on contract_positions (market_id, settled_at)
  where settled_at is null;

create index if not exists idx_contract_positions_user_open
  on contract_positions (user_id, settled_at)
  where settled_at is null;

create index if not exists idx_realization_events_created_at
  on realization_events (created_at);

drop index if exists idx_market_base_candles_window;
