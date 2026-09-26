import type { AppEnv } from "../../config/env";
import type { Queryable } from "../../db/client/pool";
import type { RequestActor } from "../../auth/actor-resolver";
import type { MarketHistoryRange } from "../../markets/market-api/types";
import { buildClockAlignedBucketTimes } from "../../markets/market-history/bucket-times";
import { resolvePortfolioActor, type PortfolioActorMode } from "./portfolio-actor";
import {
  PortfolioSnapshotServiceError,
  readPortfolioSnapshot
} from "./portfolio-snapshot-service";
import {
  composePortfolioMarkSeries,
  type PortfolioMarkSeriesPoint
} from "./portfolio-mark-series";
import {
  filterHistoryItemsForTimeframe,
  mergeAndLimitHistoryItems,
  readHistoryCounts,
  readRealizationHistoryRows,
  readTradeHistoryRows,
  type HistoryCountsRow,
  type PortfolioHistoryItem
} from "./portfolio-history";
import {
  quantizeMoney,
  toDecimal
} from "../../shared/decimals";
import {
  EFFECTIVE_REALIZED_PNL_SQL,
  INCIDENT_COMPENSATION_LATERAL_JOIN
} from "../../shared/incident-compensation";

export type PortfolioOrdersResponse = {
  actorMode: PortfolioActorMode;
  asOf: string;
  orderModel: "immediate_execution";
  openOrders: [];
  summary: {
    openOrderCount: number;
  };
};

export type PortfolioHistoryResponse = {
  actorMode: PortfolioActorMode;
  asOf: string;
  summary: {
    totalEvents: number;
    tradeCount: number;
    buyTradeCount: number;
    sellTradeCount: number;
    realizationCount: number;
  };
  items: PortfolioHistoryItem[];
};

export type PortfolioPerformanceResponse = {
  actorMode: PortfolioActorMode;
  asOf: string;
  activeTimeframe: PerformanceTimeframeId;
  timeframes: Array<{
    id: PerformanceTimeframeId;
    label: string;
    active: boolean;
  }>;
  summary: {
    availableCash: string;
    portfolioValue: string;
    totalAccountValue: string;
    realizedPnl: string;
    unrealizedPnl: string;
    openPositionsCount: number;
    tradeCount: number;
    buyTradeCount: number;
    sellTradeCount: number;
    realizationCount: number;
  };
  dayMovement?: {
    basis: "portfolio_mark";
    totalNow: string;
    dayChangeAbs: string;
    dayChangePct: string;
    dayChangeSign: "up" | "down" | "flat";
    series: Array<{
      t: string;
      v: string;
    }>;
    note: string;
  };
  views: Partial<Record<
    PerformanceTimeframeId,
    {
      kind: "snapshot";
      label: string;
      value: string;
      timeframeLabel: string;
      directionIcon: string;
      /**
       * Typed movement block for the timeframe. Same shape as the
       * top-level `dayMovement` (which stays for backward compat).
       * Front consumers should prefer reading `views.<tf>.movement`
       * uniformly across timeframes instead of branching on day.
       *
       * - `basis`: kind of value being moved (currently always
       *   `portfolio_mark` — open-position mark + realized PnL inside
       *   the timeframe window).
       * - `totalNow`: current total account value (cash + portfolio
       *   mark) at `asOf`. Same across views; included per-view so
       *   the movement block is self-describing.
       * - `changeAbs`: signed quantize-money string. Equals `value`.
       *   Named explicitly so consumers don't have to alias.
       * - `changePct`: signed quantize-money percentage relative to
       *   the period's starting balance (= `totalNow - changeAbs`).
       *   `"0.000000"` when the starting balance is zero.
       * - `changeSign`: explicit `"up" | "down" | "flat"` so UIs
       *   don't have to recompute from the sign of `changeAbs`.
       */
      movement: {
        basis: "portfolio_mark";
        totalNow: string;
        changeAbs: string;
        changePct: string;
        changeSign: "up" | "down" | "flat";
      };
      /**
       * Time-ordered points for the timeframe's PnL series. Points are
       * built from portfolio mark history when available: held shares
       * are valued against market price history, with cost basis and
       * realized PnL replayed through time. Realized-only fallback is
       * used only when no mark history exists.
       */
      series: {
        kind: "portfolio_mark";
        points: Array<{
          at: string;
          value: string;
        }>;
      };
      note: string;
    }
  >>;
};

type PerformanceTimeframeId = "day" | "week" | "month" | "year" | "ytd" | "all";

export type PortfolioPerformanceOptions = {
  timeframe?: PerformanceTimeframeId | null;
};

const PERFORMANCE_TIMEFRAME_DEFS: Array<{
  id: PerformanceTimeframeId;
  label: string;
  lookbackHours: number | null;
  historyRange: MarketHistoryRange;
}> = [
  { id: "day", label: "יום", lookbackHours: 24, historyRange: "1D" },
  { id: "week", label: "שבוע", lookbackHours: 24 * 7, historyRange: "1W" },
  { id: "month", label: "חודש", lookbackHours: 24 * 30, historyRange: "1M" },
  { id: "year", label: "שנה", lookbackHours: 24 * 365, historyRange: "all" },
  { id: "ytd", label: "YTD", lookbackHours: null, historyRange: "all" },
  { id: "all", label: "הכל", lookbackHours: null, historyRange: "all" }
];

const PERFORMANCE_TIMEFRAME_IDS = new Set<PerformanceTimeframeId>(
  PERFORMANCE_TIMEFRAME_DEFS.map((timeframe) => timeframe.id)
);

const PERFORMANCE_SERIES_BUCKET_SECONDS: Record<PerformanceTimeframeId, number> = {
  day: 5 * 60,
  week: 60 * 60,
  month: 4 * 60 * 60,
  year: 24 * 60 * 60,
  ytd: 24 * 60 * 60,
  all: 24 * 60 * 60
};

export function readPortfolioPerformanceTimeframe(value: string | null | undefined): PerformanceTimeframeId | null {
  const normalized = value?.trim().toLowerCase();

  if (!normalized || !PERFORMANCE_TIMEFRAME_IDS.has(normalized as PerformanceTimeframeId)) {
    return null;
  }

  return normalized as PerformanceTimeframeId;
}

function classifyMovementSign(value: string): "up" | "down" | "flat" {
  const decimal = toDecimal(value);

  if (decimal.gt(0)) return "up";
  if (decimal.lt(0)) return "down";
  return "flat";
}

function calculateMovementPct(totalNow: string, changeAbs: string): string {
  const change = toDecimal(changeAbs);
  const previous = toDecimal(totalNow).minus(change);

  if (previous.isZero()) {
    return quantizeMoney(0);
  }

  return quantizeMoney(change.div(previous).mul(100));
}

/**
 * Compose a portfolio PnL series from the per-bucket mark-to-market
 * series + the realized-PnL events that fall inside the window.
 *
 *   pnl(t) = realized_pnl_before_window
 *          + (mark_value(t) - cost_basis(t))
 *          + Σ realized_pnl_in_window_through(t)
 *
 * The last point is the authoritative view value. Consumers should
 * derive the hero from this series endpoint, not from a separate
 * two-point movement query.
 */
export function buildMarkPnlSeries(
  markSeries: PortfolioMarkSeriesPoint[],
  filteredItems: PortfolioHistoryItem[],
  realizedPnlBeforeWindow = "0"
): Array<{ at: string; value: string }> {
  if (!markSeries.length) {
    return [];
  }

  const sortedRealizations = filteredItems
    .filter((item): item is Extract<PortfolioHistoryItem, { kind: "realization" }> => item.kind === "realization")
    .slice()
    .sort((left, right) => Date.parse(left.happenedAt) - Date.parse(right.happenedAt));
  const baseline = toDecimal(realizedPnlBeforeWindow);

  return markSeries.map((point) => {
    const bucketMs = Date.parse(point.at);
    const realizedThrough = sortedRealizations.reduce((sum, item) => {
      if (Date.parse(item.happenedAt) <= bucketMs) {
        return sum.plus(item.realizedPnl);
      }
      return sum;
    }, toDecimal(0));
    const openPnl = toDecimal(point.markValue).minus(point.costBasisValue);
    return {
      at: point.at,
      value: quantizeMoney(baseline.plus(openPnl).plus(realizedThrough)),
    };
  });
}

function fillPnlSeriesBuckets(
  points: Array<{ at: string; value: string }>,
  timeframeId: PerformanceTimeframeId,
  windowStartMs: number | null,
  asOf: string
): Array<{ at: string; value: string }> {
  if (points.length < 2) {
    return points;
  }

  const asOfMs = Date.parse(asOf);
  const firstMs = windowStartMs ?? Date.parse(points[0].at);

  if (!Number.isFinite(firstMs) || !Number.isFinite(asOfMs)) {
    return points;
  }

  const sorted = [...points].sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  const buckets = Array.from(new Set([
    firstMs,
    ...buildClockAlignedBucketTimes(
      firstMs,
      asOfMs,
      PERFORMANCE_SERIES_BUCKET_SECONDS[timeframeId]
    )
  ])).sort((left, right) => left - right);
  const filled: Array<{ at: string; value: string }> = [];
  let cursor = 0;
  let currentValue = sorted[0]?.value ?? quantizeMoney("0");

  for (const bucketMs of buckets) {
    while (cursor < sorted.length && Date.parse(sorted[cursor].at) <= bucketMs) {
      currentValue = sorted[cursor].value;
      cursor += 1;
    }

    filled.push({
      at: new Date(bucketMs).toISOString(),
      value: currentValue
    });
  }

  return filled;
}

/**
 * Realized-events-only fallback series — used when the mark-to-
 * market series is unavailable (no open positions, or no candle
 * history for the position markets yet). Starts at the carried
 * realized-PnL baseline, adds one point per realization, and closes
 * at asOf so no-movement spans render as flat carried value.
 */
function buildRealizedFallbackSeries(
  snapshot: Awaited<ReturnType<typeof readPortfolioSnapshot>>,
  filteredItems: PortfolioHistoryItem[],
  lookbackHours: number | null,
  windowStartMs: number | null,
  realizedPnlBeforeWindow: string
): Array<{ at: string; value: string }> {
  const snapshotAsOfMs = Date.parse(snapshot.asOf);
  const fallbackLookbackMs = (lookbackHours ?? 24 * 30) * 60 * 60 * 1000;
  const baselineMs =
    windowStartMs ??
    (Number.isFinite(snapshotAsOfMs) ? snapshotAsOfMs - fallbackLookbackMs : Date.now() - fallbackLookbackMs);
  const realizationItems = filteredItems
    .filter((item): item is Extract<PortfolioHistoryItem, { kind: "realization" }> => item.kind === "realization")
    .sort((left, right) => Date.parse(left.happenedAt) - Date.parse(right.happenedAt));
  const points: Array<{ at: string; value: string }> = [
    { at: new Date(baselineMs).toISOString(), value: quantizeMoney(realizedPnlBeforeWindow) }
  ];
  let runningValue = toDecimal(realizedPnlBeforeWindow);

  for (const item of realizationItems) {
    runningValue = runningValue.plus(item.realizedPnl);
    points.push({
      at: item.happenedAt,
      value: quantizeMoney(runningValue)
    });
  }

  if (points.at(-1)?.at !== snapshot.asOf) {
    points.push({
      at: snapshot.asOf,
      value: points.at(-1)?.value ?? quantizeMoney(realizedPnlBeforeWindow)
    });
  }

  return points;
}

function resolveYtdStartMs(asOf: string): number | null {
  const asOfDate = new Date(asOf);

  if (!Number.isFinite(asOfDate.getTime())) {
    return null;
  }

  return Date.UTC(asOfDate.getUTCFullYear(), 0, 1, 0, 0, 0, 0);
}

function resolvePerformanceWindowStartMs(
  timeframe: {
    id: PerformanceTimeframeId;
    lookbackHours: number | null;
  },
  asOf: string
): number | null {
  if (timeframe.id === "all") {
    return null;
  }

  if (timeframe.id === "ytd") {
    return resolveYtdStartMs(asOf);
  }

  const asOfMs = Date.parse(asOf);

  if (!Number.isFinite(asOfMs) || timeframe.lookbackHours == null) {
    return null;
  }

  return asOfMs - timeframe.lookbackHours * 60 * 60 * 1000;
}

async function readRealizedPnlBefore(
  db: Queryable,
  actorId: string,
  windowStartMs: number | null
): Promise<string> {
  if (windowStartMs === null) return quantizeMoney("0");

  const result = await db.query<{ realized_pnl_before: string | null }>(
    `
      select coalesce(sum(${EFFECTIVE_REALIZED_PNL_SQL}), 0)::text as realized_pnl_before
      from realization_events re
      left join market_resolutions mr
        on mr.id = re.resolution_id
      ${INCIDENT_COMPENSATION_LATERAL_JOIN}
      where re.user_id = $1
        and re.created_at < $2
    `,
    [actorId, new Date(windowStartMs)]
  );

  return quantizeMoney(result.rows[0]?.realized_pnl_before ?? "0");
}

async function readPortfolioAccountCreatedMs(
  db: Queryable,
  actorId: string
): Promise<number | null> {
  const result = await db.query<{ created_at: Date | null }>(
    `
      select created_at
      from accounts
      where type = 'user_cash'
        and owner_id = $1
      order by created_at asc
      limit 1
    `,
    [actorId]
  );
  const createdAt = result.rows[0]?.created_at;
  const ms = createdAt instanceof Date ? createdAt.getTime() : NaN;

  return Number.isFinite(ms) ? ms : null;
}

function clampWindowStartToAccount(
  windowStartMs: number | null,
  accountCreatedMs: number | null
): number | null {
  if (accountCreatedMs === null) return windowStartMs;
  if (windowStartMs === null) return accountCreatedMs;

  return Math.max(windowStartMs, accountCreatedMs);
}

function buildPerformanceView(
  timeframe: {
    id: PerformanceTimeframeId;
    label: string;
    lookbackHours: number | null;
    historyRange: MarketHistoryRange;
  },
  snapshot: Awaited<ReturnType<typeof readPortfolioSnapshot>>,
  historyItems: PortfolioHistoryItem[],
  windowStartMs: number | null,
  realizedPnlBeforeWindow: string,
  markSeries?: PortfolioMarkSeriesPoint[]
): {
  kind: "snapshot";
  label: string;
  value: string;
  timeframeLabel: string;
  directionIcon: string;
  movement: {
    basis: "portfolio_mark";
    totalNow: string;
    changeAbs: string;
    changePct: string;
    changeSign: "up" | "down" | "flat";
  };
  series: {
    kind: "portfolio_mark";
    points: Array<{
      at: string;
      value: string;
    }>;
  };
  note: string;
} {
  const filteredItems = filterHistoryItemsForTimeframe(
    historyItems,
    snapshot.asOf,
    timeframe.lookbackHours,
    windowStartMs
  );
  const markPoints =
    markSeries && markSeries.length >= 2
      ? buildMarkPnlSeries(markSeries, filteredItems, realizedPnlBeforeWindow)
      : null;
  // Series shape — two paths:
  //
  // 1. PRIMARY: portfolio mark-to-market series composed by
  //    `composePortfolioMarkSeries` from per-market history and replayed
  //    share/cost-basis deltas. At each bucket time the chart shows:
  //      pnl(t) = realized_pnl_before_window
  //             + (mark_value(t) - cost_basis(t))
  //             + Σ realized_pnl_in_window_through(t)
  //    This is the real shape — densely sampled (matches the cadences
  //    market-detail charts use) and time-aware for buys/sells inside
  //    the selected window.
  //
  // 2. FALLBACK: realized-events-only series for accounts with no
  //    open positions (or markets that don't have candle history
  //    yet). It starts at the carried realized baseline and closes
  //    at asOf. Honest but stark.
  //
  // The primary path makes series.points the chart source of truth.
  // The view value is derived as last - first so movement stays
  // period-based while the rendered chart stays continuous.
  const points: Array<{ at: string; value: string }> =
    markPoints
      ? fillPnlSeriesBuckets(markPoints, timeframe.id, windowStartMs, snapshot.asOf)
      : fillPnlSeriesBuckets(
          buildRealizedFallbackSeries(
            snapshot,
            filteredItems,
            timeframe.lookbackHours,
            windowStartMs,
            realizedPnlBeforeWindow
          ),
          timeframe.id,
          windowStartMs,
          snapshot.asOf
        );
  const firstValue = points[0]?.value ?? realizedPnlBeforeWindow;
  const lastValue = points.at(-1)?.value ?? firstValue;
  const value = quantizeMoney(toDecimal(lastValue).minus(firstValue));
  const valueNumber = Number(value);
  const totalNow = snapshot.summary.totalAccountValue;

  return {
    kind: "snapshot",
    label: timeframe.id === "all" ? "ביצועים חיים" : `ביצועי ${timeframe.label}`,
    value,
    timeframeLabel: timeframe.id === "all" ? "כל הזמן" : timeframe.label,
    directionIcon:
      valueNumber > 0 ? "trending_up" : valueNumber < 0 ? "trending_down" : "insights",
    // Typed movement block — uniform shape across timeframes. The
    // pct is relative to the timeframe's starting balance
    // (totalNow - changeAbs). For "all" this is effectively the
    // initial deposit since first activity; for periods it's the
    // portfolio value at the start of the window.
    movement: {
      basis: "portfolio_mark",
      totalNow,
      changeAbs: value,
      changePct: calculateMovementPct(totalNow, value),
      changeSign: classifyMovementSign(value)
    },
    series: {
      kind: "portfolio_mark",
      points
    },
    note:
      timeframe.id === "all"
        ? "השווי מגיע מה-snapshot האחרון ומשלב PnL ממומש ופתוח."
        : "הטווח משלב שינוי מחיר מסומן על פוזיציות פתוחות עם PnL ממומש שכבר נרשם."
  };
}

function resolvePortfolioActorOrThrow(
  env: AppEnv,
  actor?: Pick<RequestActor, "actorId" | "mode">
): { actorId: string; mode: PortfolioActorMode } {
  try {
    return resolvePortfolioActor(env, actor);
  } catch {
    throw new PortfolioSnapshotServiceError(
      401,
      "unauthorized",
      "Demo actor mode is disabled."
    );
  }
}

async function readPortfolioHistoryFeed(
  db: Queryable,
  env: AppEnv,
  actor?: Pick<RequestActor, "actorId" | "mode">,
  limit = 25
): Promise<{
  actorMode: PortfolioActorMode;
  asOf: string;
  summary: HistoryCountsRow;
  items: PortfolioHistoryItem[];
}> {
  const resolvedActor = resolvePortfolioActorOrThrow(env, actor);
  const [snapshot, counts, trades, realizations] = await Promise.all([
    readPortfolioSnapshot(db, env, resolvedActor),
    readHistoryCounts(db, resolvedActor.actorId),
    readTradeHistoryRows(db, resolvedActor.actorId, limit),
    readRealizationHistoryRows(db, resolvedActor.actorId, limit)
  ]);

  return {
    actorMode: snapshot.actorMode,
    asOf: snapshot.asOf,
    summary: counts,
    items: mergeAndLimitHistoryItems(trades, realizations, limit)
  };
}

export async function readPortfolioOrders(
  db: Queryable,
  env: AppEnv,
  actor?: Pick<RequestActor, "actorId" | "mode">
): Promise<PortfolioOrdersResponse> {
  const resolvedActor = resolvePortfolioActorOrThrow(env, actor);
  const snapshot = await readPortfolioSnapshot(db, env, resolvedActor);

  return {
    actorMode: snapshot.actorMode,
    asOf: snapshot.asOf,
    orderModel: "immediate_execution",
    openOrders: [],
    summary: {
      openOrderCount: 0
    }
  };
}

export async function readPortfolioHistory(
  db: Queryable,
  env: AppEnv,
  actor?: Pick<RequestActor, "actorId" | "mode">
): Promise<PortfolioHistoryResponse> {
  const feed = await readPortfolioHistoryFeed(db, env, actor);

  return {
    actorMode: feed.actorMode,
    asOf: feed.asOf,
    summary: {
      totalEvents: feed.summary.trade_count + feed.summary.realization_count,
      tradeCount: feed.summary.trade_count,
      buyTradeCount: feed.summary.buy_trade_count,
      sellTradeCount: feed.summary.sell_trade_count,
      realizationCount: feed.summary.realization_count
    },
    items: feed.items
  };
}

// The performance SERIES needs EVERY realization in the window. It used to read
// realizations off the capped recent-activity feed (readPortfolioHistoryFeed,
// limit 5), so older realized PnL got sliced out by mergeAndLimitHistoryItems'
// top-N cut — and the lifetime views (all/year/ytd, where realizedPnlBeforeWindow
// is 0) dropped realized PnL from the chart entirely. This reads the FULL
// realization history instead. Trades don't feed the series — the mark trajectory
// already replays share/cost deltas in composePortfolioMarkSeries — so we only
// fetch realizations. Realizations per user are bounded; the cap is a runaway
// guard, not an expected ceiling.
const PERFORMANCE_REALIZATION_CAP = 10000;
async function readPerformanceSeriesHistoryItems(
  db: Queryable,
  actorId: string
): Promise<PortfolioHistoryItem[]> {
  const realizations = await readRealizationHistoryRows(db, actorId, PERFORMANCE_REALIZATION_CAP);
  return mergeAndLimitHistoryItems([], realizations, realizations.length);
}

export async function readPortfolioPerformance(
  db: Queryable,
  env: AppEnv,
  actor?: Pick<RequestActor, "actorId" | "mode">,
  options?: PortfolioPerformanceOptions
): Promise<PortfolioPerformanceResponse> {
  const resolvedActor = resolvePortfolioActorOrThrow(env, actor);
  const snapshot = await readPortfolioSnapshot(db, env, resolvedActor);
  const activeTimeframe = options?.timeframe ?? "all";
  const selectedTimeframes = options?.timeframe
    ? PERFORMANCE_TIMEFRAME_DEFS.filter((timeframe) => timeframe.id === activeTimeframe)
    : PERFORMANCE_TIMEFRAME_DEFS;
  const [historyCounts, seriesHistoryItems, viewEntries] = await Promise.all([
    readHistoryCounts(db, resolvedActor.actorId),
    readPerformanceSeriesHistoryItems(db, resolvedActor.actorId),
    (async () => {
      const accountCreatedMs = await readPortfolioAccountCreatedMs(db, resolvedActor.actorId);
      return Promise.all(selectedTimeframes.map(async (timeframe) => {
        const requestedWindowStartMs = resolvePerformanceWindowStartMs(timeframe, snapshot.asOf);
        const windowStartMs = clampWindowStartToAccount(
          requestedWindowStartMs,
          accountCreatedMs
        );
        const realizedPnlBeforeWindow = await readRealizedPnlBefore(
          db,
          resolvedActor.actorId,
          windowStartMs
        );
        const series = await composePortfolioMarkSeries(
          db,
          env,
          resolvedActor.actorId,
          snapshot,
          timeframe.historyRange,
          {
            windowStartMs
          }
        );

        return [
          timeframe.id,
          {
            realizedPnlBeforeWindow,
            windowStartMs,
            series
          }
        ] as const;
      }));
    })()
  ]);
  const viewData = Object.fromEntries(viewEntries) as Record<
    PerformanceTimeframeId,
    {
      realizedPnlBeforeWindow: string;
      windowStartMs: number | null;
      series: PortfolioMarkSeriesPoint[];
    }
  >;
  const views = Object.fromEntries(
    selectedTimeframes.map((timeframe) => [
      timeframe.id,
      buildPerformanceView(
        timeframe,
        snapshot,
        seriesHistoryItems,
        viewData[timeframe.id]?.windowStartMs ?? null,
        viewData[timeframe.id]?.realizedPnlBeforeWindow ?? "0",
        viewData[timeframe.id]?.series
      )
    ])
  ) as PortfolioPerformanceResponse["views"];
  const dayView = views.day;
  const dayMovement = dayView
    ? (() => {
        const dayChangeAbs = dayView.value;

        return {
          basis: "portfolio_mark" as const,
          totalNow: snapshot.summary.totalAccountValue,
          dayChangeAbs,
          dayChangePct: calculateMovementPct(snapshot.summary.totalAccountValue, dayChangeAbs),
          dayChangeSign: classifyMovementSign(dayChangeAbs),
          series: dayView.series.points.map((point) => ({
            t: point.at,
            v: point.value
          })),
          note:
            "Day movement combines marked open-position price movement with realized PnL events in the last 24h."
        };
      })()
    : undefined;

  const response: PortfolioPerformanceResponse = {
    actorMode: snapshot.actorMode,
    asOf: snapshot.asOf,
    activeTimeframe,
    timeframes: PERFORMANCE_TIMEFRAME_DEFS.map((timeframe) => ({
      id: timeframe.id,
      label: timeframe.label,
      active: timeframe.id === activeTimeframe
    })),
    summary: {
      ...snapshot.summary,
      tradeCount: historyCounts.trade_count,
      buyTradeCount: historyCounts.buy_trade_count,
      sellTradeCount: historyCounts.sell_trade_count,
      realizationCount: historyCounts.realization_count
    },
    views
  };

  if (dayMovement) {
    response.dayMovement = dayMovement;
  }

  return response;
}
