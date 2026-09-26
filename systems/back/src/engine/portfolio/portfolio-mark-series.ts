/**
 * Portfolio mark-to-market series composition.
 *
 * Composes per-market price candles (from `market-history` infrastructure)
 * into a portfolio-level PnL series. At each bucket time:
 *
 *   mark_value(t) = sum(shares_at_t * candle_price_t)
 *   cost_basis(t) = sum(open_position_cost_basis_at_t)
 *
 * Shares and cost basis are replayed from current positions plus timestamped
 * trade/realization deltas. `ALL` can therefore include unrealized movement
 * from inception, while shorter windows still carry pre-window holdings.
 */

import type { AppEnv } from "../../config/env";
import type { Queryable } from "../../db/client/pool";
import type { MarketHistoryRange } from "../../markets/market-api/types";
import { readMarketHistory } from "../../markets/market-history/market-history-service";
import { quantizeMoney, toDecimal } from "../../shared/decimals";
import {
  resolveCanonicalMarketKeyById,
  resolveOutcomeKey
} from "../../shared/market-identity";
import type { readPortfolioSnapshot } from "./portfolio-snapshot-service";

export type PortfolioMarkSeriesPoint = {
  at: string;
  /** mark value of the user's positions at this bucket time, V₪. */
  markValue: string;
  /** open-position cost basis at this bucket time, V₪. */
  costBasisValue: string;
};

type DecimalLike = ReturnType<typeof toDecimal>;

type ShareRow = {
  market_id: string;
  outcome_id: string;
  shares: string;
  cost_basis: string;
  current_price: string;
  terminal_at: Date | null;
};

type ShareDeltaRow = {
  happened_at: Date;
  market_id: string;
  outcome_id: string;
  share_delta: string;
  cost_basis_delta: string;
  terminal_at: Date | null;
};

type ShareTrack = {
  marketId: string;
  outcomeId: string;
  currentShares: DecimalLike;
  currentCostBasis: DecimalLike;
  currentPrice: number | null;
  terminalAtMs: number | null;
  deltas: Array<{
    atMs: number;
    delta: DecimalLike;
    costBasisDelta: DecimalLike;
  }>;
};

type TrackMarkSeries = ShareTrack & {
  points: Array<{ t: number; price: number }>;
};

/**
 * Compose a portfolio mark-to-market series for the given range.
 *
 * Returns an empty array when:
 *   - no current or in-window position exposure
 *   - none of the exposure markets have candle history yet
 *   - all per-market histories failed to read
 *
 * Caller treats empty as "no chart data" and falls back to the
 * realization-only series.
 */
export async function composePortfolioMarkSeries(
  db: Queryable,
  env: AppEnv,
  actorId: string,
  snapshot: Awaited<ReturnType<typeof readPortfolioSnapshot>>,
  range: MarketHistoryRange,
  options: {
    windowStartMs?: number | null;
  } = {}
): Promise<PortfolioMarkSeriesPoint[]> {
  const asOfMs = Date.parse(snapshot.asOf);

  if (!Number.isFinite(asOfMs)) return [];

  const rangeStartMs =
    options.windowStartMs === undefined
      ? resolveRangeStartMs(range, asOfMs)
      : options.windowStartMs;
  const tracks = await readShareTracks(
    db,
    actorId,
    snapshot.asOf
  );

  if (!tracks.length) return [];

  // Fetch per-market candle history in parallel. `readMarketHistory`
  // already handles the cache layer + falls back to building from
  // trades if candles aren't persisted yet.
  const perTrackSeries = await Promise.all(
    tracks.map((track) => readTrackMarkPoints(db, env, track, range, asOfMs))
  );
  const validSeries = perTrackSeries.filter(
    (entry): entry is TrackMarkSeries => entry !== null && entry.points.length > 0
  );

  if (!validSeries.length) return [];

  // Bucket times: take the union of all per-market bucket times so we
  // don't lose intermediate marks. In practice all candles at a given
  // range share the same resolution, so timestamps largely align;
  // dedup + sort keeps it correct even when they don't.
  const bucketTimes = collectBucketTimes(validSeries, {
    startMs: rangeStartMs,
    endMs: asOfMs
  });

  if (!bucketTimes.length) return [];

  return bucketTimes.map((bucketMs) => {
    let markValue = toDecimal(0);
    let costBasisValue = toDecimal(0);

    for (const series of validSeries) {
      const price =
        findPriceAtOrBefore(series.points, bucketMs) ??
        (rangeStartMs !== null && bucketMs === rangeStartMs
          ? findFirstPriceAtOrAfter(series.points, bucketMs)
          : null);
      if (price === null) continue;
      const shares = readSharesAt(series, bucketMs, asOfMs);
      if (shares.lte(0)) continue;
      markValue = markValue.plus(shares.mul(price));
      costBasisValue = costBasisValue.plus(readCostBasisAt(series, bucketMs, asOfMs));
    }

    return {
      at: new Date(bucketMs).toISOString(),
      markValue: quantizeMoney(markValue),
      costBasisValue: quantizeMoney(costBasisValue)
    };
  });
}

function resolveRangeStartMs(range: MarketHistoryRange, asOfMs: number): number | null {
  switch (range) {
    case "1H":
      return asOfMs - 60 * 60 * 1000;
    case "6H":
      return asOfMs - 6 * 60 * 60 * 1000;
    case "1D":
      return asOfMs - 24 * 60 * 60 * 1000;
    case "1W":
      return asOfMs - 7 * 24 * 60 * 60 * 1000;
    case "1M":
      return asOfMs - 30 * 24 * 60 * 60 * 1000;
    case "all":
      return null;
  }
}

async function readCurrentShareRows(db: Queryable, actorId: string): Promise<ShareRow[]> {
  const result = await db.query<ShareRow>(
    `
      select
        p.market_id,
        p.outcome_id,
        p.shares::text as shares,
        p.cost_basis::text as cost_basis,
        os.last_price::text as current_price,
        m.resolved_at as terminal_at
      from positions p
      join markets m
        on m.id = p.market_id
      join market_outcome_state os
        on os.market_id = p.market_id
       and os.outcome_id = p.outcome_id
      where p.user_id = $1
        and p.shares > 0
        and p.settled_at is null
        and m.status not in ('resolved', 'voided')
    `,
    [actorId]
  );

  return result.rows;
}

async function readShareDeltaRows(
  db: Queryable,
  actorId: string,
  asOf: string
): Promise<ShareDeltaRow[]> {
  const result = await db.query<ShareDeltaRow>(
    `
      with event_rows as (
        select
          buy_legs.happened_at,
          buy_legs.market_id,
          buy_legs.outcome_id,
          buy_legs.share_delta,
          (buy_legs.cash_amount / buy_legs.leg_count)::text as cost_basis_delta,
          buy_legs.terminal_at
        from (
          select
            t.created_at as happened_at,
            t.market_id,
            leg.outcome_id,
            leg.share_amount::text as share_delta,
            m.resolved_at as terminal_at,
            t.cash_amount,
            count(*) over (partition by t.id) as leg_count
          from trades t
	          join trade_execution_legs leg
	            on leg.trade_id = t.id
	          join markets m
	            on m.id = t.market_id
	          where t.user_id = $1
	            and t.side = 'buy'
	            and t.created_at <= $2
	            and m.status <> 'voided'
	        ) buy_legs

        union all

        select
          re.created_at as happened_at,
          re.market_id,
          re.outcome_id,
          ('-' || re.shares_closed::text) as share_delta,
          ('-' || re.removed_cost_basis::text) as cost_basis_delta,
          m.resolved_at as terminal_at
	        from realization_events re
	        join markets m
	          on m.id = re.market_id
	        where re.user_id = $1
	          and re.created_at <= $2
	          and m.status <> 'voided'
	      )
      select
        happened_at,
        market_id,
        outcome_id,
        share_delta,
        cost_basis_delta,
        terminal_at
      from event_rows
      order by happened_at asc, market_id asc, outcome_id asc
    `,
    [actorId, new Date(asOf)]
  );

  return result.rows;
}

async function readShareTracks(
  db: Queryable,
  actorId: string,
  asOf: string
): Promise<ShareTrack[]> {
  const [currentRows, deltaRows] = await Promise.all([
    readCurrentShareRows(db, actorId),
    readShareDeltaRows(db, actorId, asOf)
  ]);
  const tracks = new Map<string, ShareTrack>();

  function key(marketId: string, outcomeId: string): string {
    return `${marketId}\u0000${outcomeId}`;
  }

  for (const row of currentRows) {
    tracks.set(key(row.market_id, row.outcome_id), {
      marketId: row.market_id,
      outcomeId: row.outcome_id,
      currentShares: toDecimal(row.shares),
      currentCostBasis: toDecimal(row.cost_basis),
      currentPrice: Number(row.current_price),
      terminalAtMs: readTerminalAtMs(row.terminal_at),
      deltas: []
    });
  }

  for (const row of deltaRows) {
    const trackKey = key(row.market_id, row.outcome_id);
    const track =
      tracks.get(trackKey) ??
      {
        marketId: row.market_id,
        outcomeId: row.outcome_id,
        currentShares: toDecimal(0),
        currentCostBasis: toDecimal(0),
        currentPrice: null,
        terminalAtMs: null,
        deltas: []
      };
    const atMs = row.happened_at.getTime();
    const terminalAtMs = readTerminalAtMs(row.terminal_at);

    track.terminalAtMs =
      track.terminalAtMs === null
        ? terminalAtMs
        : terminalAtMs === null
          ? track.terminalAtMs
          : Math.min(track.terminalAtMs, terminalAtMs);

    if (Number.isFinite(atMs)) {
      track.deltas.push({
        atMs,
        delta: toDecimal(row.share_delta),
        costBasisDelta: toDecimal(row.cost_basis_delta)
      });
    }

    tracks.set(trackKey, track);
  }

  return Array.from(tracks.values()).filter((track) =>
    track.currentShares.gt(0) || track.currentCostBasis.gt(0) || track.deltas.length > 0
  );
}

function readTerminalAtMs(value: Date | null): number | null {
  const atMs = value instanceof Date ? value.getTime() : NaN;

  return Number.isFinite(atMs) ? atMs : null;
}

/**
 * For a single share track: read its market's candle history and project
 * the outcome's price-over-time. Returns null when the market or outcome
 * isn't found in the history payload.
 */
async function readTrackMarkPoints(
  db: Queryable,
  env: AppEnv,
  track: ShareTrack,
  range: MarketHistoryRange,
  asOfMs: number
): Promise<TrackMarkSeries | null> {
  let history;

  try {
    history = await readMarketHistory(
      db,
      resolveCanonicalMarketKeyById(track.marketId) ?? track.marketId,
      {
        range
      }
    );
  } catch {
    return null;
  }

  if (!history?.seriesByOutcome) return null;

  const outcomeKey = resolveOutcomeKey(track.outcomeId) ?? track.outcomeId;
  const outcomeSeries = history.seriesByOutcome.find(
    (entry) => entry.outcomeKey === outcomeKey
  );

  if (!outcomeSeries?.points?.length) return null;

  const points = outcomeSeries.points
    .filter((point) => Number.isFinite(point.value) && Number.isFinite(point.t))
    .map((point) => ({
      // `point.t` from market-history is seconds-since-epoch; convert
      // to ms here so the compose step deals in a single unit.
      t: point.t * 1000,
      price: point.value as number
    }))
    .sort((left, right) => left.t - right.t);
  appendLiveSnapshotPoint(points, track, asOfMs);

  if (!points.length) return null;

  return {
    ...track,
    points
  };
}

function appendLiveSnapshotPoint(
  points: Array<{ t: number; price: number }>,
  track: ShareTrack,
  asOfMs: number
): void {
  if (track.currentPrice === null || !Number.isFinite(track.currentPrice)) {
    return;
  }

  const existingIndex = points.findIndex((point) => point.t === asOfMs);

  if (existingIndex >= 0) {
    points[existingIndex] = {
      t: asOfMs,
      price: track.currentPrice
    };
    return;
  }

  points.push({
    t: asOfMs,
    price: track.currentPrice
  });
  points.sort((left, right) => left.t - right.t);
}

function collectBucketTimes(
  series: TrackMarkSeries[],
  window: { startMs: number | null; endMs: number }
): number[] {
  const set = new Set<number>();
  if (window.startMs !== null) {
    set.add(window.startMs);
  }
  for (const entry of series) {
    const endMs = entry.terminalAtMs === null
      ? window.endMs
      : Math.min(window.endMs, entry.terminalAtMs);
    if (window.startMs !== null && endMs < window.startMs) continue;

    for (const point of entry.points) {
      if (window.startMs !== null && point.t < window.startMs) continue;
      if (point.t > endMs) continue;
      set.add(point.t);
    }
    for (const event of entry.deltas) {
      if (window.startMs !== null && event.atMs < window.startMs) continue;
      if (event.atMs > endMs) continue;
      set.add(event.atMs);
    }
    if (entry.terminalAtMs !== null && entry.terminalAtMs <= window.endMs) {
      set.add(entry.terminalAtMs);
    }
  }
  if (series.some((entry) => entry.terminalAtMs === null || entry.terminalAtMs >= window.endMs)) {
    set.add(window.endMs);
  }
  return Array.from(set).sort((left, right) => left - right);
}

function readSharesAt(track: ShareTrack, bucketMs: number, asOfMs: number): DecimalLike {
  if (track.terminalAtMs !== null && bucketMs > track.terminalAtMs) {
    return toDecimal(0);
  }

  if (!track.deltas.length) {
    return bucketMs <= asOfMs && track.currentShares.gt(0)
      ? track.currentShares
      : toDecimal(0);
  }

  const shares = track.deltas.reduce((sum, event) => {
    if (event.atMs <= bucketMs && event.atMs <= asOfMs) {
      return sum.plus(event.delta);
    }

    return sum;
  }, toDecimal(0));

  return shares.lt(0) ? toDecimal(0) : shares;
}

function readCostBasisAt(track: ShareTrack, bucketMs: number, asOfMs: number): DecimalLike {
  if (track.terminalAtMs !== null && bucketMs > track.terminalAtMs) {
    return toDecimal(0);
  }

  if (!track.deltas.length) {
    return bucketMs <= asOfMs && track.currentCostBasis.gt(0)
      ? track.currentCostBasis
      : toDecimal(0);
  }

  const costBasis = track.deltas.reduce((sum, event) => {
    if (event.atMs <= bucketMs && event.atMs <= asOfMs) {
      return sum.plus(event.costBasisDelta);
    }

    return sum;
  }, toDecimal(0));

  return costBasis.lt(0) ? toDecimal(0) : costBasis;
}

/**
 * Carry-forward price lookup: returns the most recent price at or
 * before the given bucket time. Null when the bucket is before the
 * first available data point (we don't extrapolate backwards).
 */
function findPriceAtOrBefore(
  points: Array<{ t: number; price: number }>,
  bucketMs: number
): number | null {
  let lastPrice: number | null = null;
  for (const point of points) {
    if (point.t > bucketMs) break;
    lastPrice = point.price;
  }
  return lastPrice;
}

/**
 * Boundary fallback for clipped ranges: when the caller injects an exact
 * window-start bucket but market-history starts at the first bucket *inside*
 * the range, use that first in-range price as the baseline instead of
 * emitting a fake zero mark.
 */
function findFirstPriceAtOrAfter(
  points: Array<{ t: number; price: number }>,
  bucketMs: number
): number | null {
  for (const point of points) {
    if (point.t >= bucketMs) {
      return point.price;
    }
  }

  return null;
}
