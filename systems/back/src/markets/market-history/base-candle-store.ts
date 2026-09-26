import type { Queryable } from "../../db/client/pool";
import { readOutcomeKey } from "../market-api/identity";
import { HISTORY_RANGE_MS } from "../market-api/normalizers";
import type { MarketHistoryRange } from "../market-api/types";
import type { HistoryPoint } from "../market-api/history-builder";
import { buildClockAlignedBucketTimes } from "./bucket-times";

/**
 * base-candle-store — the single always-current price source per market.
 *
 * One row per (market, minute): values = { outcomeKey: price }. Maintained
 * incrementally (upserted on each trade from the post-trade outcome prices), so
 * it is current by construction — no full-history replay, no per-range cache to
 * go stale. Every /history range is a fresh window+downsample VIEW of this one
 * source. See migration 048 for the why (it replaces the six independently-
 * staleable market_history_candles blobs).
 */

const MINUTE_MS = 60_000;

const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function floorToMinuteMs(ms: number): number {
  return Math.floor(ms / MINUTE_MS) * MINUTE_MS;
}

// Bucket cadence is driven purely by the VISIBLE SPAN (how much time is on
// screen), never by the range label. Two ranges showing the same window render
// the identical chart — so on a market younger than 6h, 6H/1D/1W/1M/ALL all
// clamp to the same life span and collapse to one view. (Polymarket does the
// same: it fetches 1-min data once and downsamples client-side by span.)
//
// The rungs are set so a MATURE market maps each range's window back to its
// familiar cadence — 1H/6H→1m, 1D→5m, 1W→30m, 1M→4h — while a YOUNG market
// stays fine instead of jumping to a coarse step (the 1H-in-5-min bug).
export function resolutionSecondsForSpan(spanMs: number): number {
  if (spanMs <= 6 * HOUR_MS) return 60;            // ≤ 6h  → 1m   (1H, 6H)
  if (spanMs <= DAY_MS) return 5 * 60;             // ≤ 1d  → 5m   (1D)
  if (spanMs <= 7 * DAY_MS) return 30 * 60;        // ≤ 1w  → 30m  (1W)
  if (spanMs <= 30 * DAY_MS) return 4 * 60 * 60;   // ≤ 1mo → 4h   (1M)
  if (spanMs <= 120 * DAY_MS) return 12 * 60 * 60; // ≤ 4mo → 12h  (ALL, long)
  return 24 * 60 * 60;                             // else  → 1d
}

function formatInterval(resolutionSeconds: number): string {
  if (resolutionSeconds % 3600 === 0) return `${resolutionSeconds / 3600}h`;
  if (resolutionSeconds % 60 === 0) return `${resolutionSeconds / 60}m`;
  return `${resolutionSeconds}s`;
}

/**
 * Upsert one market's current-minute base row. Last write in a minute wins
 * (= the minute's close), matching the chart's carry-forward-last-value line.
 */
export async function upsertBaseCandle(
  db: Queryable,
  marketId: string,
  atMs: number,
  values: Record<string, number>
): Promise<void> {
  await db.query(
    `
      insert into market_base_candles (market_id, bucket_at, values, updated_at)
      values ($1, to_timestamp($2 / 1000.0), $3::jsonb, now())
      on conflict (market_id, bucket_at)
      do update set values = excluded.values, updated_at = now()
    `,
    [marketId, floorToMinuteMs(atMs), JSON.stringify(values)]
  );
}

/**
 * Post-trade hook: read the market's current outcome prices and upsert the
 * current-minute base row. BEST-EFFORT — callers must not let a failure here
 * fail a trade (the trades table remains the source of truth; the base is a
 * derived view a backfill can always rebuild).
 */
export async function appendBaseCandleFromState(
  db: Queryable,
  marketId: string,
  atMs: number = Date.now()
): Promise<void> {
  const result = await db.query<{ outcome_id: string; last_price: string }>(
    `select outcome_id, last_price::text as last_price
       from market_outcome_state where market_id = $1`,
    [marketId]
  );

  if (!result.rows.length) {
    return;
  }

  const values: Record<string, number> = {};
  for (const row of result.rows) {
    const price = Number.parseFloat(row.last_price);
    if (Number.isFinite(price)) {
      values[readOutcomeKey(row.outcome_id)] = price;
    }
  }

  if (Object.keys(values).length === 0) {
    return;
  }

  await upsertBaseCandle(db, marketId, atMs, values);
}

type BaseRow = { bucket_at: Date; values: Record<string, number> };

// Window rows for [startMs, endMs], plus the one row at/before startMs so the
// first bucket opens with the carried-forward value rather than blank.
async function readBaseRows(
  db: Queryable,
  marketId: string,
  startMs: number,
  endMs: number
): Promise<BaseRow[]> {
  const result = await db.query<BaseRow>(
    `
      (
        select bucket_at, values
        from market_base_candles
        where market_id = $1 and bucket_at <= to_timestamp($2 / 1000.0)
        order by bucket_at desc
        limit 1
      )
      union all
      (
        select bucket_at, values
        from market_base_candles
        where market_id = $1
          and bucket_at > to_timestamp($2 / 1000.0)
          and bucket_at <= to_timestamp($3 / 1000.0)
        order by bucket_at asc
      )
    `,
    [marketId, startMs, endMs]
  );

  return result.rows
    .filter((row) => row.bucket_at instanceof Date)
    .sort((left, right) => left.bucket_at.getTime() - right.bucket_at.getTime());
}

async function readFirstBucketMs(db: Queryable, marketId: string): Promise<number | null> {
  const result = await db.query<{ bucket_at: Date }>(
    `select bucket_at from market_base_candles where market_id = $1 order by bucket_at asc limit 1`,
    [marketId]
  );
  const first = result.rows[0]?.bucket_at;
  return first instanceof Date ? first.getTime() : null;
}

/**
 * Read one range as a fresh window+downsample of the base. Carry-forward across
 * gaps (a minute with no row holds the last value). Returns null when the base
 * has no rows for the market (caller falls back to a trade-replay build).
 */
export async function readSampledBaseHistory(
  db: Queryable,
  marketId: string,
  options: {
    range: MarketHistoryRange;
    asOf: string;
    startTs: number | null;
    endTs: number | null;
  }
): Promise<{
  interval: string;
  resolutionSeconds: number;
  sampleQuality: "active" | "sparse" | "flat_no_trades";
  points: HistoryPoint[];
} | null> {
  const asOfMs = Date.parse(options.asOf);
  if (!Number.isFinite(asOfMs)) {
    return null;
  }

  const endMs = options.endTs ? options.endTs * 1000 : asOfMs;

  // Clamp the window to when the market's data actually begins — never show
  // empty time before creation (a 1M view on a market made June 15 was showing
  // from May 24). For a range wider than the market's life this makes the view
  // effectively "since creation".
  const firstBucketMs = await readFirstBucketMs(db, marketId);
  if (firstBucketMs === null) {
    return null;
  }

  const windowStartMs =
    options.range === "all"
      ? firstBucketMs
      : Math.max(endMs - HISTORY_RANGE_MS[options.range], firstBucketMs);

  const startMs = options.startTs ? options.startTs * 1000 : windowStartMs;
  const safeEndMs = Math.max(startMs, endMs);

  // Cadence from the visible span, not the range label — so ranges showing the
  // same window (a young market's clamped life) collapse to one identical view.
  // See resolutionSecondsForSpan.
  const spanMs = safeEndMs - startMs;
  const resolutionSeconds = resolutionSecondsForSpan(spanMs);

  const rows = await readBaseRows(db, marketId, startMs, safeEndMs);
  if (!rows.length) {
    return null;
  }

  const bucketTimes = buildClockAlignedBucketTimes(startMs, safeEndMs, resolutionSeconds);
  if (!bucketTimes.length) {
    return null;
  }

  const points: HistoryPoint[] = [];
  let cursor = 0;
  let runningValues: Record<string, number> = { ...rows[0].values };
  let changed = false;

  for (const bucketMs of bucketTimes) {
    while (cursor < rows.length && rows[cursor].bucket_at.getTime() <= bucketMs) {
      const next = rows[cursor].values;
      if (!changed && cursor > 0 && JSON.stringify(next) !== JSON.stringify(rows[0].values)) {
        changed = true;
      }
      runningValues = { ...next };
      cursor += 1;
    }

    points.push({
      at: new Date(bucketMs).toISOString(),
      t: Math.floor(bucketMs / 1000),
      label: "sample",
      values: { ...runningValues }
    });
  }

  return {
    interval: formatInterval(resolutionSeconds),
    resolutionSeconds,
    // "active" when the windowed base actually moved; else flat (no trades in
    // window) — drives the same sampleQuality hook the old candles used.
    sampleQuality: changed || rows.length > 1 ? "active" : "flat_no_trades",
    points
  };
}
