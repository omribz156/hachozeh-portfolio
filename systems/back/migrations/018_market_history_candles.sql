create table if not exists market_history_candles (
  market_id text not null,
  range_key text not null,
  interval_key text not null,
  resolution_seconds integer not null,
  bucket_at timestamptz not null,
  values jsonb not null,
  sample_quality text not null,
  source_kind text not null default 'derived_from_trades',
  source_market_state_version text not null,
  source_trade_count integer not null default 0,
  generated_at timestamptz not null default now(),
  primary key (market_id, range_key, resolution_seconds, bucket_at),
  constraint fk_market_history_candles_market
    foreign key (market_id) references markets(id) on delete cascade,
  constraint chk_market_history_candles_resolution_positive
    check (resolution_seconds > 0),
  constraint chk_market_history_candles_sample_quality
    check (sample_quality in ('active', 'sparse', 'flat_no_trades')),
  constraint chk_market_history_candles_source_kind
    check (source_kind in ('derived_from_trades', 'persisted_candles'))
);

create index if not exists idx_market_history_candles_lookup
  on market_history_candles (
    market_id,
    range_key,
    source_market_state_version,
    bucket_at
  );
