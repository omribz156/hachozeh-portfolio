import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import {
  buildTradingViewFxSnapshotEndpoint,
  buildTradingViewFxSnapshotWindowEndpoint,
  captureTradingViewFxSnapshot,
  createTradingViewFxSnapshotFetchJson
} from "../../../../oracle/src/tradingview-fx-snapshot-service";

const SCANNER_PAYLOAD = {
  data: [
    {
      s: "FX_IDC:USDILS",
      d: [
        "USDILS",
        "U.S. DOLLAR / ISRAELI SHEKEL",
        "forex",
        "",
        "FX_IDC",
        2.8218,
        2.82183,
        2.82313,
        0.277,
        0.0078,
        "streaming",
        10000,
        "ILS"
      ]
    }
  ]
};

function createDb(options?: { insertedEventId?: string | null; storedPayload?: unknown }) {
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.includes("insert into lifecycle_events")) {
      return {
        rows: options?.insertedEventId === null ? [] : [{ id: options?.insertedEventId ?? "lifevt_fx_1" }],
        rowCount: options?.insertedEventId === null ? 0 : 1
      };
    }

    if (sql.includes("from lifecycle_events")) {
      const rows = Array.isArray(options?.storedPayload)
        ? options.storedPayload.map((payload) => ({ payload }))
        : options?.storedPayload
          ? [{ payload: options.storedPayload }]
          : [];

      return {
        rows,
        rowCount: rows.length
      };
    }

    if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`Unexpected query: ${sql}; values=${JSON.stringify(values)}`);
  });

  return {
    db: { query } as unknown as Pool,
    query
  };
}

describe("TradingView FX snapshot service", () => {
  it("captures scanner output as a timestamped lifecycle snapshot", async () => {
    const { db, query } = createDb();
    const fetchScannerJson = vi.fn(async () => SCANNER_PAYLOAD);

    const result = await captureTradingViewFxSnapshot(db, {
      marketId: "disc-cm-live-fx-usdils",
      symbol: "USDILS",
      observedAt: new Date("2026-06-02T20:59:00.000Z"),
      now: new Date("2026-06-02T20:59:04.000Z"),
      idempotencyKey: "usdils-close",
      fetchScannerJson
    });

    expect(fetchScannerJson).toHaveBeenCalledWith(
      "https://scanner.tradingview.com/forex/scan",
      expect.objectContaining({
        symbols: {
          tickers: ["FX_IDC:USDILS"],
          query: {
            types: []
          }
        }
      })
    );
    expect(result).toMatchObject({
      marketId: "disc-cm-live-fx-usdils",
      lifecycleEventId: "lifevt_fx_1",
      deduped: false,
      snapshot: {
        sourceFamily: "tradingview_fx",
        provider: "tradingview_scanner",
        symbol: "USDILS",
        ticker: "FX_IDC:USDILS",
        observedAt: "2026-06-02T20:59:00.000Z",
        fetchedAt: "2026-06-02T20:59:04.000Z",
        status: "final",
        price: 2.8218,
        bid: 2.82183,
        ask: 2.82313
      },
      machineResolutionEndpoint:
        "hachozeh://oracle/tradingview-fx-snapshot?market=disc-cm-live-fx-usdils&symbol=USDILS&at=2026-06-02T20%3A59%3A00.000Z"
    });

    const insertValues = query.mock.calls[0]?.[1] as unknown[];
    expect(insertValues).toEqual(
      expect.arrayContaining([
        "disc-cm-live-fx-usdils",
        "source_snapshot_captured",
        "oracle",
        "system:oracle",
        "2026-06-02T20:59:00.000Z",
        expect.any(String),
        "source_snapshot_captured:disc-cm-live-fx-usdils:tradingview_fx:usdils-close"
      ])
    );
  });

  it("reads hachozeh snapshot endpoints for Oracle adapter fetches", async () => {
    const storedPayload = {
      objectType: "tradingview_fx_snapshot_v1",
      sourceFamily: "tradingview_fx",
      symbol: "EURUSD",
      ticker: "FX_IDC:EURUSD",
      price: 1.1617,
      observedAt: "2026-06-02T20:59:00.000Z",
      status: "final"
    };
    const { db, query } = createDb({ storedPayload });
    const fetchJson = createTradingViewFxSnapshotFetchJson(db);

    const payload = await fetchJson(
      buildTradingViewFxSnapshotEndpoint({
        marketId: "disc-cm-live-fx-eurusd",
        symbol: "EURUSD",
        at: "2026-06-02T20:59:00.000Z"
      })
    );

    expect(payload).toStrictEqual(storedPayload);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("from lifecycle_events"),
      [
        "disc-cm-live-fx-eurusd",
        "EURUSD",
        "FX_IDC:EURUSD",
        "2026-06-02T20:59:00.000Z"
      ]
    );
  });

  it("reads hachozeh window snapshot endpoints as ordered observation arrays", async () => {
    const storedPayload = [
      {
        objectType: "tradingview_fx_snapshot_v1",
        sourceFamily: "tradingview_fx",
        symbol: "USDILS",
        ticker: "FX_IDC:USDILS",
        price: 2.76,
        observedAt: "2026-06-02T10:00:00.000Z",
        status: "final"
      },
      {
        objectType: "tradingview_fx_snapshot_v1",
        sourceFamily: "tradingview_fx",
        symbol: "USDILS",
        ticker: "FX_IDC:USDILS",
        price: 2.74,
        observedAt: "2026-06-02T11:00:00.000Z",
        status: "final"
      }
    ];
    const { db, query } = createDb({ storedPayload });
    const fetchJson = createTradingViewFxSnapshotFetchJson(db);

    const payload = await fetchJson(
      buildTradingViewFxSnapshotWindowEndpoint({
        marketId: "disc-cm-live-fx-usdils",
        symbol: "USDILS",
        from: "2026-06-02T00:00:00.000Z",
        to: "2026-06-02T20:59:00.000Z"
      })
    );

    expect(payload).toStrictEqual(storedPayload);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("(payload->>'observedAt')::timestamptz asc"),
      [
        "disc-cm-live-fx-usdils",
        "USDILS",
        "FX_IDC:USDILS",
        "2026-06-02T00:00:00.000Z",
        "2026-06-02T20:59:00.000Z"
      ]
    );
  });

  it("rejects malformed hachozeh snapshot endpoint timestamps before DB work", async () => {
    const { db, query } = createDb();
    const fetchJson = createTradingViewFxSnapshotFetchJson(db);

    await expect(
      fetchJson("hachozeh://oracle/tradingview-fx-snapshot?market=disc-cm-live-fx-eurusd&symbol=EURUSD&at=not-a-date")
    ).rejects.toThrow(/TradingView FX snapshot endpoint has invalid timestamp/);

    expect(query).not.toHaveBeenCalled();
  });

  it("rejects unsafe external fallback URLs for Oracle adapter fetches", async () => {
    const { db } = createDb();
    const fetchJson = createTradingViewFxSnapshotFetchJson(db);

    await expect(fetchJson("http://127.0.0.1:3001/health/diagnostics")).rejects.toThrow(
      /must use https/
    );
  });
});
