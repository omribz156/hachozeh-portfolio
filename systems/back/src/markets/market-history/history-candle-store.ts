import type { Queryable } from "../../db/client/pool";
import type { MarketHistoryRange } from "../market-api/types";
import { HISTORY_RANGE_MS } from "../market-api/normalizers";
import { buildClockAlignedBucketTimes } from "./bucket-times";

type HistoryPoint = {
  at: string;
  t: number;
  label: string;
  values: Record<string, number>;
};

type SampledHistory = {
  interval: string;
  resolutionSeconds: number;
  sampleQuality: "active" | "sparse" | "flat_no_trades";
  points: HistoryPoint[];
};

type CandleRow = {
  interval_key: string;
  resolution_seconds: number;
  bucket_at: Date;
  values: unknown;
  sample_quality: "active" | "sparse" | "flat_no_trades";
  generated_at: Date;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readValues(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) {
    return null;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, rawValue]) => {
      const parsed = Number.parseFloat(String(rawValue ?? "0"));

      return [key, Number.isFinite(parsed) ? parsed : 0];
    })
  );
}

export function canUsePersistedHistory(options: {
  startTs: number | null;
  endTs: number | null;
}): boolean {
  return options.startTs === null && options.endTs === null;
}

function valuesChanged(points: HistoryPoint[]): boolean {
  const firstValues = points[0]?.values;

  if (!firstValues) {
    return false;
  }

  return points.some((point) =>
    Object.entries(point.values).some(
      ([key, value]) => Math.abs(value - (firstValues[key] ?? value)) > 0.000001
    )
  );
}

function buildPersistedSample(
  rows: CandleRow[],
  options: {
    range: MarketHistoryRange;
    asOf: string;
    maxAgeMs?: number | null;
    extendToAsOf?: boolean;
  }
): SampledHistory | null {
  const firstRow = rows[0];
  const asOfMs = Date.parse(options.asOf);

  if (!firstRow || !Number.isFinite(asOfMs)) {
    return null;
  }

  if (
    options.maxAgeMs !== null &&
    options.maxAgeMs !== undefined &&
    Date.now() - firstRow.generated_at.getTime() > options.maxAgeMs
  ) {
    return null;
  }

  const firstMs = firstRow.bucket_at.getTime();
  const sortedRows = [...rows].sort(
    (left, right) => left.bucket_at.getTime() - right.bucket_at.getTime()
  );
  const lastRowMs = sortedRows.at(-1)?.bucket_at.getTime() ?? firstMs;
  const endMs = options.extendToAsOf === false ? Math.min(asOfMs, lastRowMs) : asOfMs;
  const startMs =
    options.range === "all"
      ? firstMs
      : Math.max(firstMs, endMs - HISTORY_RANGE_MS[options.range]);
  const safeEndMs = Math.max(startMs, endMs);
  const bucketTimes = buildClockAlignedBucketTimes(
    startMs,
    safeEndMs,
    firstRow.resolution_seconds
  );
  const points: HistoryPoint[] = [];
  let cursor = 0;
  let runningValues = readValues(sortedRows[0]?.values) ?? {};

  for (const bucketMs of bucketTimes) {
    while (
      cursor < sortedRows.length &&
      sortedRows[cursor].bucket_at.getTime() <= bucketMs
    ) {
      runningValues = readValues(sortedRows[cursor].values) ?? runningValues;
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
    interval: firstRow.interval_key,
    resolutionSeconds: firstRow.resolution_seconds,
    sampleQuality: valuesChanged(points) ? firstRow.sample_quality : "flat_no_trades",
    points
  };
}

async function readPersistedHistoryCandles(
  db: Queryable,
  options: {
    marketId: string;
    range: MarketHistoryRange;
    sourceVersion: string;
    asOf: string;
    maxAgeMs?: number | null;
    extendToAsOf?: boolean;
  }
): Promise<SampledHistory | null> {
  const result = await db.query<CandleRow>(
    `
      select
        interval_key,
        resolution_seconds,
        bucket_at,
        values,
        sample_quality,
        generated_at
      from market_history_candles
      where market_id = $1
        and range_key = $2
        and source_market_state_version like $3
      order by bucket_at asc
    `,
    [options.marketId, options.range, `%:${options.sourceVersion}`]
  );
  const rows = result.rows.filter((row) => row.bucket_at instanceof Date);

  if (!rows.length) {
    return null;
  }

  return buildPersistedSample(rows, {
    range: options.range,
    asOf: options.asOf,
    maxAgeMs: options.maxAgeMs,
    extendToAsOf: options.extendToAsOf
  });
}

async function writePersistedHistoryCandles(
  db: Queryable,
  options: {
    marketId: string;
    range: MarketHistoryRange;
    marketStateVersion: string;
    tradeCount: number;
    sampled: SampledHistory;
  }
): Promise<void> {
  await db.query(
    `
      delete from market_history_candles
      where market_id = $1
        and range_key = $2
    `,
    [options.marketId, options.range]
  );

  for (const point of options.sampled.points) {
    await db.query(
      `
        insert into market_history_candles (
          market_id,
          range_key,
          interval_key,
          resolution_seconds,
          bucket_at,
          values,
          sample_quality,
          source_kind,
          source_market_state_version,
          source_trade_count
        )
        values ($1, $2, $3, $4, $5, $6::jsonb, $7, 'persisted_candles', $8, $9)
        on conflict (market_id, range_key, resolution_seconds, bucket_at)
        do update set
          interval_key = excluded.interval_key,
          values = excluded.values,
          sample_quality = excluded.sample_quality,
          source_kind = excluded.source_kind,
          source_market_state_version = excluded.source_market_state_version,
          source_trade_count = excluded.source_trade_count,
          generated_at = now()
      `,
      [
        options.marketId,
        options.range,
        options.sampled.interval,
        options.sampled.resolutionSeconds,
        point.at,
        JSON.stringify(point.values),
        options.sampled.sampleQuality,
        options.marketStateVersion,
        options.tradeCount
      ]
    );
  }
}
