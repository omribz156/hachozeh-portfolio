import type { Pool } from "pg";

import { insertLifecycleEvent } from "../../back/src/platform-surface/oracle";
import {
  fetchOracleAdapterJson,
  hashRawSnapshot
} from "./source-adapter-contracts";

const TRADINGVIEW_FX_SOURCE_FAMILY = "tradingview_fx";
const TRADINGVIEW_SCANNER_URL = "https://scanner.tradingview.com/forex/scan";
const TRADINGVIEW_ALLOWED_HOSTS = ["scanner.tradingview.com"];
const SCANNER_COLUMNS = [
  "name",
  "description",
  "type",
  "subtype",
  "exchange",
  "close",
  "bid",
  "ask",
  "change",
  "change_abs",
  "update_mode",
  "pricescale",
  "currency"
] as const;

type TradingViewScannerColumn = (typeof SCANNER_COLUMNS)[number];

type TradingViewScannerRecord = {
  s?: unknown;
  d?: unknown;
};

export type TradingViewFxSnapshot = {
  objectType: "tradingview_fx_snapshot_v1";
  sourceFamily: "tradingview_fx";
  provider: "tradingview_scanner";
  symbol: string;
  ticker: string;
  sourceUrl: string;
  scannerUrl: string;
  observedAt: string;
  fetchedAt: string;
  status: "final";
  price: number;
  close: number;
  bid: number | null;
  ask: number | null;
  currency: string | null;
  updateMode: string | null;
  description: string | null;
  rawHash: string;
  rawPayload: unknown;
};

export type TradingViewFxSnapshotResult = {
  objectType: "oracle_tradingview_fx_snapshot_capture_result";
  marketId: string;
  lifecycleEventId: string | null;
  deduped: boolean;
  snapshot: TradingViewFxSnapshot;
  machineResolutionEndpoint: string;
};

export type CaptureTradingViewFxSnapshotOptions = {
  marketId: string;
  symbol: string;
  observedAt?: Date;
  now?: Date;
  idempotencyKey?: string;
  fetchScannerJson?: (url: string, body: unknown) => Promise<unknown>;
};

export type ReadTradingViewFxSnapshotOptions = {
  marketId: string;
  symbol?: string;
  at?: string;
  from?: string;
  to?: string;
};

function normalizeCompactSymbol(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/^FX_IDC:/, "")
    .replace(/[^A-Z0-9]/g, "");
}

function buildTicker(symbol: string): string {
  return `FX_IDC:${normalizeCompactSymbol(symbol)}`;
}

function buildTradingViewSymbolUrl(symbol: string): string {
  return `https://www.tradingview.com/symbols/${normalizeCompactSymbol(symbol)}/`;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readColumn(record: TradingViewScannerRecord, column: TradingViewScannerColumn): unknown {
  const values = Array.isArray(record.d) ? record.d : [];
  return values[SCANNER_COLUMNS.indexOf(column)];
}

function readScannerRecords(payload: unknown): TradingViewScannerRecord[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }

  const data = (payload as { data?: unknown }).data;
  return Array.isArray(data)
    ? data.filter((item): item is TradingViewScannerRecord => Boolean(item && typeof item === "object"))
    : [];
}

function buildScannerRequestBody(ticker: string): unknown {
  return {
    symbols: {
      tickers: [ticker],
      query: {
        types: []
      }
    },
    columns: SCANNER_COLUMNS
  };
}

async function defaultFetchScannerJson(url: string, body: unknown): Promise<unknown> {
  return fetchOracleAdapterJson(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "Navi Oracle TradingView FX snapshot"
    },
    body: JSON.stringify(body),
    allowedHosts: TRADINGVIEW_ALLOWED_HOSTS
  });
}

function buildSnapshotFromScannerPayload(input: {
  symbol: string;
  ticker: string;
  observedAt: string;
  fetchedAt: string;
  payload: unknown;
}): TradingViewFxSnapshot {
  const record = readScannerRecords(input.payload).find(
    (item) => readString(item.s)?.toUpperCase() === input.ticker
  );

  if (!record) {
    throw new Error(`TradingView scanner did not return ${input.ticker}.`);
  }

  const close = readNumber(readColumn(record, "close"));

  if (close == null) {
    throw new Error(`TradingView scanner returned ${input.ticker} without a parseable close price.`);
  }

  return {
    objectType: "tradingview_fx_snapshot_v1",
    sourceFamily: TRADINGVIEW_FX_SOURCE_FAMILY,
    provider: "tradingview_scanner",
    symbol: input.symbol,
    ticker: input.ticker,
    sourceUrl: buildTradingViewSymbolUrl(input.symbol),
    scannerUrl: TRADINGVIEW_SCANNER_URL,
    observedAt: input.observedAt,
    fetchedAt: input.fetchedAt,
    status: "final",
    price: close,
    close,
    bid: readNumber(readColumn(record, "bid")),
    ask: readNumber(readColumn(record, "ask")),
    currency: readString(readColumn(record, "currency")),
    updateMode: readString(readColumn(record, "update_mode")),
    description: readString(readColumn(record, "description")),
    rawHash: hashRawSnapshot(input.payload),
    rawPayload: input.payload
  };
}

export function buildTradingViewFxSnapshotEndpoint(input: {
  marketId: string;
  symbol: string;
  at: string;
}): string {
  const params = new URLSearchParams({
    market: input.marketId,
    symbol: normalizeCompactSymbol(input.symbol),
    at: input.at
  });

  return `hachozeh://oracle/tradingview-fx-snapshot?${params.toString()}`;
}

export function buildTradingViewFxSnapshotWindowEndpoint(input: {
  marketId: string;
  symbol: string;
  from: string;
  to: string;
}): string {
  const params = new URLSearchParams({
    market: input.marketId,
    symbol: normalizeCompactSymbol(input.symbol),
    from: input.from,
    to: input.to
  });

  return `hachozeh://oracle/tradingview-fx-snapshot?${params.toString()}`;
}

export async function captureTradingViewFxSnapshot(
  db: Pool,
  options: CaptureTradingViewFxSnapshotOptions
): Promise<TradingViewFxSnapshotResult> {
  const symbol = normalizeCompactSymbol(options.symbol);
  const ticker = buildTicker(symbol);
  const observedAt = (options.observedAt ?? options.now ?? new Date()).toISOString();
  const fetchedAt = (options.now ?? new Date()).toISOString();
  const scannerBody = buildScannerRequestBody(ticker);
  const rawPayload = await (options.fetchScannerJson ?? defaultFetchScannerJson)(
    TRADINGVIEW_SCANNER_URL,
    scannerBody
  );
  const snapshot = buildSnapshotFromScannerPayload({
    symbol,
    ticker,
    observedAt,
    fetchedAt,
    payload: rawPayload
  });
  const dedupeSeed = options.idempotencyKey ?? `${ticker}:${observedAt}`;
  const lifecycleEventId = await insertLifecycleEvent(db, {
    marketId: options.marketId,
    eventType: "source_snapshot_captured",
    sourceSystem: "oracle",
    actorId: "system:oracle",
    occurredAt: observedAt,
    correlationId: snapshot.rawHash,
    dedupeKey: `source_snapshot_captured:${options.marketId}:tradingview_fx:${dedupeSeed}`,
    payload: snapshot
  });

  return {
    objectType: "oracle_tradingview_fx_snapshot_capture_result",
    marketId: options.marketId,
    lifecycleEventId,
    deduped: lifecycleEventId == null,
    snapshot,
    machineResolutionEndpoint: buildTradingViewFxSnapshotEndpoint({
      marketId: options.marketId,
      symbol,
      at: observedAt
    })
  };
}

export async function readTradingViewFxSnapshot(
  db: Pool,
  options: ReadTradingViewFxSnapshotOptions
): Promise<TradingViewFxSnapshot | null> {
  const snapshots = await readTradingViewFxSnapshots(db, options);
  return snapshots[0] ?? null;
}

export async function readTradingViewFxSnapshots(
  db: Pool,
  options: ReadTradingViewFxSnapshotOptions
): Promise<TradingViewFxSnapshot[]> {
  const values: unknown[] = [options.marketId];
  const where = [
    "market_id = $1",
    "event_type = 'source_snapshot_captured'",
    "payload->>'sourceFamily' = 'tradingview_fx'"
  ];

  if (options.symbol) {
    values.push(normalizeCompactSymbol(options.symbol));
    values.push(buildTicker(options.symbol));
    where.push(`(payload->>'symbol' = $${values.length - 1} or payload->>'ticker' = $${values.length})`);
  }

  let orderBy = "occurred_at desc, created_at desc";

  if (options.at) {
    values.push(options.at);
    orderBy = `abs(extract(epoch from ((payload->>'observedAt')::timestamptz - $${values.length}::timestamptz))) asc, occurred_at desc, created_at desc`;
  } else if (options.from || options.to) {
    if (options.from) {
      values.push(options.from);
      where.push(`(payload->>'observedAt')::timestamptz >= $${values.length}::timestamptz`);
    }

    if (options.to) {
      values.push(options.to);
      where.push(`(payload->>'observedAt')::timestamptz <= $${values.length}::timestamptz`);
    }

    orderBy = "(payload->>'observedAt')::timestamptz asc, occurred_at asc, created_at asc";
  }

  const result = await db.query<{ payload: TradingViewFxSnapshot }>(
    `
      select payload
      from lifecycle_events
      where ${where.join(" and ")}
      order by ${orderBy}
      ${options.at ? "limit 1" : ""}
    `,
    values
  );

  return result.rows.map((row) => row.payload);
}

export function isTradingViewFxSnapshotEndpoint(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "hachozeh:" && parsed.hostname === "oracle" && parsed.pathname === "/tradingview-fx-snapshot";
  } catch {
    return false;
  }
}

function normalizeEndpointTimestamp(value: string): string {
  const trimmed = value.trim();
  const timestamp = new Date(trimmed);

  if (!trimmed || Number.isNaN(timestamp.getTime())) {
    throw new Error("TradingView FX snapshot endpoint has invalid timestamp.");
  }

  return timestamp.toISOString();
}

function readNormalizedEndpointTimestamp(parsed: URL, key: "at" | "from" | "to"): string | undefined {
  const value = parsed.searchParams.get(key)?.trim();
  return value ? normalizeEndpointTimestamp(value) : undefined;
}

export function parseTradingViewFxSnapshotEndpoint(url: string): ReadTradingViewFxSnapshotOptions {
  const parsed = new URL(url);
  const marketId = parsed.searchParams.get("market")?.trim();
  const symbol = parsed.searchParams.get("symbol")?.trim() || undefined;

  if (!marketId) {
    throw new Error("TradingView FX snapshot endpoint is missing market.");
  }

  return {
    marketId,
    symbol,
    at: readNormalizedEndpointTimestamp(parsed, "at"),
    from: readNormalizedEndpointTimestamp(parsed, "from"),
    to: readNormalizedEndpointTimestamp(parsed, "to")
  };
}

export function createTradingViewFxSnapshotFetchJson(db: Pool): (url: string) => Promise<unknown> {
  return async (url: string) => {
    if (!isTradingViewFxSnapshotEndpoint(url)) {
      return fetchOracleAdapterJson(url, {
        allowedHosts: TRADINGVIEW_ALLOWED_HOSTS
      });
    }

    const endpoint = parseTradingViewFxSnapshotEndpoint(url);
    const payload = endpoint.from || endpoint.to
      ? await readTradingViewFxSnapshots(db, endpoint)
      : await readTradingViewFxSnapshot(db, endpoint);

    if (!payload || (Array.isArray(payload) && payload.length === 0)) {
      throw new Error(`No TradingView FX snapshot found for ${url}.`);
    }

    return payload;
  };
}
