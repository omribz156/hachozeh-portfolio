-- Market volume denormalization (performance-audit.md T1.1):
--  1. Three hot readers (discovery feed, market-detail row reader, public
--     search) plus the catalog reader aggregated the whole trades table at
--     read time (`sum(cash_amount) group by market_id`). Volume now lives on
--     market_pricing_state.total_volume, incremented inside the trade
--     transaction by the same UPDATE that bumps the LMSR state version —
--     zero added round trips in the money path.
--     Semantics match the old CTE exactly: buys add cashSpent, sells add
--     proceedsReceived, both positive (chk_trades_cash_amount_positive);
--     voided markets keep their trades, so they keep their volume.
--     Drift guard: `npm run audit:total-volume` (tolerance = exact 0).
--  2. Trigram GIN indexes for public search: the search query ILIKEs
--     markets.title and market_outcomes.label with a leading wildcard,
--     which btree indexes cannot serve. (description + JSONB taxonomy
--     terms are follow-up scope.)

alter table market_pricing_state
  add column if not exists total_volume numeric(20, 6) not null default 0;

update market_pricing_state ps
set total_volume = coalesce(
  (select sum(t.cash_amount) from trades t where t.market_id = ps.market_id),
  0
);

create extension if not exists pg_trgm;

create index if not exists idx_markets_title_trgm
  on markets using gin (title gin_trgm_ops);

create index if not exists idx_market_outcomes_label_trgm
  on market_outcomes using gin (label gin_trgm_ops);
