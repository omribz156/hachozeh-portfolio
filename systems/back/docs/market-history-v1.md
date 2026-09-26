# Market History V1

Updated: 2026-05-27
Status: current
Owner: backend / front seam

Purpose:
- define the backend-owned market history seam for graph-first product use
- let the broader history contract absorb the current `price-history` route
- keep chart/history truth reusable across market-detail, discovery, QA, and future product surfaces

Type:
- active backend contract

Read with:
- `systems/back/docs/current-status.md`
- `systems/back/docs/v1-contract-brief.md`
- `workspace/tasks/reference/current-backend-api-map.md`
- `workspace/tasks/reference/front-back-seams-map.md`

This doc is not:
- a frontend chart design
- a full exchange analytics plan
- a full exchange candle/OHLC analytics plan

## Decision

Build one backend-owned market movement source of truth.

The new seam is:

```text
GET /api/markets/:marketKey/history
```

The existing route stays alive:

```text
GET /api/markets/:marketKey/price-history
```

But it should become a compatibility consumer of the same `MarketHistoryService`,
not a second history truth.

Short rule:
- `/history` is the border API
- `/price-history` is the narrow compatibility shape
- both are powered by one backend service

## V2 — Always-current base candle source (2026-06-23)

The per-range persisted-candle model described below (six `market_history_candles`
blobs, lazily rebuilt and cached per range) is **superseded**. It let each range
go stale on its own clock — reader-driven, deduped per `market:range` — so a
market's less-viewed ranges (6H/1W/1M) drifted hours/days stale while its default
range stayed fresh ("1M/1W flat or truncated while 1H moves"), platform-wide on
actively-trading markets.

New shape: **one always-current base series per market** — `market_base_candles`,
one row per `(market_id, minute)`, `values = { outcomeKey: price }`. Maintained
**incrementally**: each trade upserts the current-minute row from the post-trade
`market_outcome_state.last_price` (`trade-service.ts`, post-commit + best-effort —
a candle write can never fail a trade). So it is current by construction — no
full-history replay, no per-range cache to go stale.

`/history` derives **every range** as a fresh window+downsample VIEW of the base
(`base-candle-store.ts` → `readSampledBaseHistory`): window `[asOf − rangeMs, asOf]`
clamped to the market's first base bucket (never shows pre-creation time),
downsampled to the range cadence (1H/6H=1m, 1D=5m, 1W=30m, 1M=4h, ALL=span-adaptive),
carry-forward across gaps. A market with no base rows yet (un-backfilled /
pre-first-trade) falls back to a fresh trade replay — still no persisted per-range
cache, so still never stale. One freshness state per market, shared by all ranges
and all `/history` consumers (market-detail, trending hero, compact mounts).

Retires: the per-range `market_history_candles` writes,
`scheduleHistoryCandleRevalidation` (stale-while-revalidate), and the
`extendToAsOf:false` stale-truncation handling. `canUsePersistedHistory` (the
start/end-window guard) stays. Migration `048` adds the base table; one-time
backfill via `scripts/backfill-base-candles.ts`.

**The per-range candle sections below (Storage V1, Replay Truth, the stale-serve
bullets) describe the retired model — kept for history; the base-candle source
above is authoritative.**

## Why

The current graph problem is not only a frontend rendering problem.

Today `price-history` already does useful work:
- reads market and outcomes
- replays recent trades into probability points
- supports ranges such as `1H`, `6H`, `1D`, `1W`, `1M`, and `all`
- returns outcome order, series, movement summary, and source metadata

But it is still a narrow trade-replay surface. It can look sparse or cliffy on
quiet markets, and each product surface can be tempted to interpret the shape
differently.

Backend should own the market-history logic. Front should consume and render it.

## Product Scope

V1 is graph-first and reusable.

It should answer:

> How did this market's probabilities move over the selected range?

It should not try to answer every possible market-history question.

Consumers can include:
- market-detail full probability graph
- discovery compact preview graph
- QA and smoke checks
- future portfolio/trust context

But V1 should be proven first through the market graph.

## V1 Contract

Request:

```text
GET /api/markets/:marketKey/history?range=1D
```

Supported parameters:
- `range`: `1H`, `6H`, `1D`, `1W`, `1M`, `all`
- `startTs`: optional Unix seconds lower bound
- `endTs`: optional Unix seconds upper bound
- `interval`: optional compatibility hint; backend chooses by default in V1
- `limit`: optional safety cap

Default stance:
- Front asks for a range.
- Backend chooses the sampling resolution.
- Backend returns graph-ready points.

Example response shape:

```json
{
  "marketKey": "disc-cm-example",
  "marketId": "disc-cm-example",
  "range": "1D",
  "resolutionSeconds": 900,
  "asOf": "2026-05-06T09:00:00.000Z",
  "marketStateVersion": 42,
  "source": {
    "kind": "persisted_candles",
    "persistedCandles": true
  },
  "sampleQuality": "active",
  "outcomes": [
    {
      "outcomeKey": "yes",
      "outcomeId": "out_yes",
      "label": "כן",
      "shortLabel": "כן",
      "sortOrder": 0
    }
  ],
  "points": [
    {
      "at": "2026-05-06T08:45:00.000Z",
      "t": 1778057100,
      "values": {
        "yes": 0.62
      }
    }
  ],
  "movementByOutcome": {
    "yes": {
      "outcomeKey": "yes",
      "firstPrice": "0.58000000",
      "lastPrice": "0.62000000",
      "delta": "0.04000000",
      "displayDelta": "+4%"
    }
  }
}
```

## Sampling Rules

Backend owns sampling.

Recommended default buckets:
- `1H`: 1 minute
- `6H`: 1 minute
- `1D`: 5 minutes
- `1W`: 1 hour
- `1M`: 4 hours
- `all`: backend-chosen bounded resolution

Rules:
- each bucket returns the latest known probability at that bucket time
- if trades happened inside the bucket, use the last post-trade price in that bucket
- if no trades happened, carry forward the previous known price
- if no trades happened in the selected range, return a flat line
- if no previous point exists, use the market open/current baseline
- do not invent interpolation between trades
- do not smooth probabilities in backend

Frontend may visually soften lines, but backend data remains carry-forward bucket
truth.

Market-detail display cadence mirrors the Polymarket-style split between data
resolution and visible axis labels:
- `1H`: backend points every 1 minute; visible axis labels around 10-minute jumps
- `6H`: backend points every 1 minute; visible axis labels around 1-hour jumps
- `1D`: backend points every 5 minutes; visible axis labels around 4-hour jumps
- `1W`: backend points every 1 hour; visible axis labels around 2-day jumps
- `1M`: backend points every 4 hours; visible axis labels around 1-week jumps
- `all`: backend keeps denser buckets for recent/medium markets, while the visible axis steps from 2-day to weekly, 14-day, or monthly landmarks by span

Cadence is span-aware. When the actual returned data span is younger than the
nominal range, the backend uses the smallest enclosing cadence instead of
coarsening the same data. Example: a 22-hour market returns 5-minute points for
`1D`, `1W`, `1M`, and `all`, so tab changes do not redraw the same history into
a different shape.

## Replay Truth

History points are market probability vectors, not per-trade scalar labels.

For exclusive multi-outcome markets:
- every returned point must describe the full outcome vector
- the visible outcome probabilities should sum to roughly `1.0`
- `YES` trades move the requested outcome leg
- `NO` trades move the complement execution legs, not the requested outcome line
- equal cumulative outcome volume does not imply equal probability; LMSR price is a function of the current share vector and liquidity

The read model reconstructs graph points from current `q_shares` and recorded
`trade_execution_legs`. It walks recent trades backward from the current market
state so shorter ranges can still start from the right probability vector. This
avoids the old bug where `trade.price_after` for a `NO` trade was written onto
the requested outcome line and produced impossible multi-outcome sums above
`1.0`.

Open markets carry the current vector forward to request time. If no trade
happened in the selected window, the correct result is a flat line ending at
`now`, not a stale final trade timestamp.

Resolved markets append one derived terminal settlement point at `resolvedAt`.
The winning outcome value is `1.0`, losers are `0.0`, and the point carries
`kind: "settlement"` so Front can style the final segment without treating it
as a trade. This is derived on read from resolution truth; it is not written to
`market_history_candles`.

Current cap policy:
- standard unbounded `/history` reads are not capped by the API `limit`
- first standard read materializes persisted candles from all known trades for that market/range/source-version
- later standard reads use `market_history_candles` and carry the last candle forward to request time
- stale open-market candles are served only through their last stored bucket;
  they do not fabricate a flat tail to request time while background
  revalidation catches up
- old-source candle rows are ignored so cadence-source changes rebuild instead of serving stale bucket shapes
- timestamp-bounded/custom reads still use capped replay as a debug/compatibility bridge
- `/price-history` remains the capped compatibility route for older consumers

Performance note:
- chart replay uses a numeric softmax projection for read speed and rounds to 8 decimals
- trading, settlement, and money math remain Decimal/fixed precision in the engine
- the stress proof market with `15601` trades materialized full `all` history in roughly `0.29s` locally
- the same stress proof market then served persisted `all` history in roughly `0.02s` locally

## Sparse Markets

Quiet markets should not look broken.

No trades in range:
- return flat points across the selected range
- set `sampleQuality` to `flat_no_trades`
- keep source metadata honest

Few trades in range:
- return bucketed carry-forward points
- set `sampleQuality` to `sparse`

Active range:
- return bucketed carry-forward points
- set `sampleQuality` to `active`

## Relationship To Polymarket And Kalshi

Borrow the boundary, not the exchange complexity.

Polymarket-style lesson:
- a compact timestamp/price history endpoint is useful
- the current `price-history` route is close to this shape

Kalshi-style lesson:
- product-grade charts should be range-bound and bucketed
- continuity before the selected range matters
- storage can add richer candle fields without changing the consumer boundary

Hachozeh V1:
- multi-outcome LMSR probability lines
- close probability per bucket
- no orderbook candles yet
- no bid/ask OHLC yet

## Storage V1

The first storage step is a read-through candle table:

```text
market_history_candles
```

It stores:
- market id
- range key
- interval key and resolution seconds
- bucket timestamp
- full probability vector as JSON
- sample quality
- source market-state version
- source trade count
- generated timestamp

It does not store:
- OHLC fields
- bid/ask spread
- volume bars
- open interest
- settlement/redemption points
- per-trader history

Standard `/history` reads use this table. If no matching candles exist for the
market/range/state version, backend materializes them from all known trades,
writes them, then returns the same API shape.

Custom bounded reads with `startTs` or `endTs` intentionally bypass persisted
candles and use replay so QA can inspect exact windows without pretending that
the archive has every possible custom cut precomputed.

## Not V1

Do not build these in the first proof:
- full event-sourced market diary
- OHLC fields
- volume bars
- open interest
- CLOB/orderbook history
- public profile or leaderboard history
- frontend chart redesign

The contract should leave room for those, but the first proof is a clear line.

## Future Expansion

The response can later grow additively:
- `candlesByOutcome`
- `volumeByBucket`
- `markers`
- `lifecycleEvents`
- `openInterest`

The route should not need to change when storage changes.

Future storage can deepen behind `MarketHistoryService`:
- background refresh instead of first-read materialization
- resolved-market archival tables
- volume and open-interest sidecars
- invalidation hooks that do not wait for market-state version churn

## Implementation Shape

Current implementation:

```text
systems/back/src/markets/market-history/
```

Modules:
- `market-history-service.ts`
- `history-candle-store.ts`
- `history-sampler.ts`

Route behavior:
- `/api/markets/:marketKey/history` returns the broader contract
- `/api/markets/:marketKey/price-history` maps the same service output into the existing compatibility shape
- standard `/history` reads prefer persisted candles
- `/price-history` and custom bounded `/history` reads still use capped replay

## Verification

Minimum proof:
- unit tests for sparse, active, and no-trade ranges
- route test for `/history`
- compatibility test for `/price-history`
- smoke check against a live market
- market-detail adapter can consume `/history` without inventing chart logic

Browser proof should check:
- `1H`
- `6H`
- `1D`
- `1W`
- `1M`
- `all`

The visual goal is not drama.
The visual goal is readable market movement that users can trust.
