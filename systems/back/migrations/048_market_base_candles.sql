-- 048_market_base_candles.sql
--
-- One always-current base price series per market, at 1-minute resolution.
-- Replaces the six independently-rebuilt-and-cached per-range candle blobs in
-- market_history_candles (1H/6H/1D/1W/1M/all), whose lazy, reader-driven,
-- per-range revalidation let a market's less-viewed ranges drift hours/days
-- stale while its default range stayed fresh — the "1M/1W/6H are flat/truncated
-- but 1H moves" bug, platform-wide on actively-trading markets.
--
-- The base is maintained INCREMENTALLY (upserted on each trade from the
-- post-trade market_outcome_state.last_price), so it is current by construction
-- — no full-history replay, no per-range cache to go stale. Every /history
-- range becomes a fresh window+downsample VIEW of this one source (the Poly
-- model). One freshness state for the whole market, shared by all ranges and
-- all chart consumers (market-detail, trending hero, compact mounts, portfolio).
--
-- Shape mirrors market_history_candles.values: one row per (market, minute),
-- values = { outcomeKey: price } — so the existing carry-forward sampler reads
-- it with minimal change. Sparse: only minutes that saw a price change get a
-- row; the read carries the last value forward across gaps.

create table if not exists market_base_candles (
  market_id text not null,
  bucket_at timestamptz not null,
  values jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (market_id, bucket_at),
  constraint fk_market_base_candles_market
    foreign key (market_id) references markets(id) on delete cascade
);

-- Read path is always "rows for one market within [start, asOf], ordered" —
-- the PK (market_id, bucket_at) already serves that range scan.
create index if not exists idx_market_base_candles_window
  on market_base_candles (market_id, bucket_at);
