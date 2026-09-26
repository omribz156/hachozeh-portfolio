import {
  HISTORY_RANGE_MS,
  normalizeHistoryInterval
} from "../market-api/normalizers";
import type {
  MarketApiRow,
  MarketHistoryRange
} from "../market-api/types";
import { buildClockAlignedBucketTimes } from "./bucket-times";
import { resolutionSecondsForSpan } from "./base-candle-store";

type HistoryPoint = {
  at: string;
  t: number;
  label: string;
  values: Record<string, number>;
};

type SampleQuality = "active" | "sparse" | "flat_no_trades";

const INTERVAL_SECONDS: Record<string, number> = {
  "1m": 60,
  "5m": 5 * 60,
  "15m": 15 * 60,
  "1h": 60 * 60,
  "4h": 4 * 60 * 60
};

function readPointMs(point: HistoryPoint): number {
  return Number.isFinite(point.t) ? point.t * 1000 : Date.parse(point.at);
}

function readOpenMs(rows: MarketApiRow[], points: HistoryPoint[]): number {
  const [firstPoint] = points;
  const [firstRow] = rows;
  const pointMs = firstPoint ? readPointMs(firstPoint) : NaN;

  if (Number.isFinite(pointMs)) {
    return pointMs;
  }

  return firstRow ? firstRow.open_at.getTime() : Date.now();
}

function readResolutionSeconds(
  interval: string,
  startMs: number,
  endMs: number,
  intervalWasExplicit = false
): number {
  const intervalSeconds = INTERVAL_SECONDS[interval];

  if (intervalSeconds && intervalWasExplicit) {
    return intervalSeconds;
  }

  // Cadence from the visible span — shared with the base-candle path so the
  // trade-replay fallback buckets identically to the persisted source.
  return resolutionSecondsForSpan(endMs - startMs);
}

function formatInterval(resolutionSeconds: number): string {
  if (resolutionSeconds % 3600 === 0) {
    return `${resolutionSeconds / 3600}h`;
  }

  if (resolutionSeconds % 60 === 0) {
    return `${resolutionSeconds / 60}m`;
  }

  return `${resolutionSeconds}s`;
}

function countTradePointsInRange(points: HistoryPoint[], startMs: number, endMs: number): number {
  return points.filter((point) => {
    const pointMs = readPointMs(point);

    return point.label === "trade" && pointMs >= startMs && pointMs <= endMs;
  }).length;
}

function readSampleQuality(tradeCount: number): SampleQuality {
  if (tradeCount === 0) {
    return "flat_no_trades";
  }

  if (tradeCount === 1) {
    return "sparse";
  }

  return "active";
}

export function buildSampledHistoryPoints(
  rows: MarketApiRow[],
  points: HistoryPoint[],
  options: {
    range: MarketHistoryRange;
    interval: string;
    startTs: number | null;
    endTs: number | null;
    asOf: string;
    intervalWasExplicit?: boolean;
  }
) {
  if (points.length === 0) {
    return {
      interval: normalizeHistoryInterval(options.range, options.interval),
      resolutionSeconds: readResolutionSeconds(
        options.interval,
        0,
        0,
        options.intervalWasExplicit
      ),
      sampleQuality: "flat_no_trades" as SampleQuality,
      points: []
    };
  }

  const asOfMs = Date.parse(options.asOf);
  const openMs = readOpenMs(rows, points);
  const fallbackEndMs = Number.isFinite(asOfMs) ? asOfMs : readPointMs(points.at(-1) ?? points[0]);
  const endMs = options.endTs ? options.endTs * 1000 : fallbackEndMs;
  const rangeStartMs =
    options.range === "all" ? openMs : Math.max(openMs, endMs - HISTORY_RANGE_MS[options.range]);
  const startMs = options.startTs ? options.startTs * 1000 : rangeStartMs;
  const safeEndMs = Math.max(startMs, endMs);
  const normalizedInterval = normalizeHistoryInterval(options.range, options.interval);
  const resolutionSeconds = readResolutionSeconds(
    normalizedInterval,
    startMs,
    safeEndMs,
    options.intervalWasExplicit
  );
  const sortedPoints = [...points].sort((left, right) => readPointMs(left) - readPointMs(right));
  const bucketTimes = buildClockAlignedBucketTimes(startMs, safeEndMs, resolutionSeconds);
  const sampledPoints: HistoryPoint[] = [];
  let cursor = 0;
  let runningValues = { ...sortedPoints[0].values };

  for (const bucketMs of bucketTimes) {
    while (cursor < sortedPoints.length && readPointMs(sortedPoints[cursor]) <= bucketMs) {
      runningValues = { ...sortedPoints[cursor].values };
      cursor += 1;
    }

    sampledPoints.push({
      at: new Date(bucketMs).toISOString(),
      t: Math.floor(bucketMs / 1000),
      label: "sample",
      values: { ...runningValues }
    });
  }

  return {
    interval: formatInterval(resolutionSeconds),
    resolutionSeconds,
    sampleQuality: readSampleQuality(countTradePointsInRange(sortedPoints, startMs, safeEndMs)),
    points: sampledPoints
  };
}
