import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearMarketApiReadCacheForTest,
  readMarketHistory,
  readMarket,
  readMarketPrices,
  readMarketTrades,
  readMarketPositions,
  readMarketPriceHistory
} from "../../src/markets/market-api-read-service";
import { readPositionRows } from "../../src/markets/market-api/position-row-reader";

const openedAt = new Date("2026-04-29T10:00:00.000Z");
const updatedAt = new Date("2026-04-29T10:03:00.000Z");
const updatedAtTs = String(Math.floor(updatedAt.getTime() / 1000));

const marketRows = [
  {
    market_id: "stress-market",
    market_status: "open",
    title: "Stress market",
    description: null,
    category_key: "politics",
    open_at: openedAt,
    close_at: new Date("2026-05-04T10:00:00.000Z"),
    published_at: openedAt,
    updated_at: updatedAt,
    market_state_version: "3",
    liquidity_b: "1000",
    outcome_count: 2,
    total_volume: "50",
    outcome_id: "stress-alpha",
    outcome_label: "Stress alpha",
    outcome_short_label: "Alpha",
    q_shares: "42.86",
    sort_order: 0,
    last_price: "0.49404778"
  },
  {
    market_id: "stress-market",
    market_status: "open",
    title: "Stress market",
    description: null,
    category_key: "politics",
    open_at: openedAt,
    close_at: new Date("2026-05-04T10:00:00.000Z"),
    published_at: openedAt,
    updated_at: updatedAt,
    market_state_version: "3",
    liquidity_b: "1000",
    outcome_count: 2,
    total_volume: "50",
    outcome_id: "stress-bravo",
    outcome_label: "Stress bravo",
    outcome_short_label: "Bravo",
    q_shares: "66.67",
    sort_order: 1,
    last_price: "0.50595222"
  }
];

const tradeRows = [
  {
    trade_id: "trade_2",
    created_at: new Date("2026-04-29T10:02:00.000Z"),
    side: "buy",
    contract_side: "yes",
    requested_outcome_key: "stress-bravo",
    cash_amount: "20",
    share_amount: "66.67",
    avg_price: "0.3",
    price_before: "0.2",
    price_after: "0.300000",
    outcome_id: "stress-bravo",
    outcome_label: "Stress bravo",
    execution_legs: []
  },
  {
    trade_id: "trade_1",
    created_at: new Date("2026-04-29T10:01:00.000Z"),
    side: "buy",
    contract_side: "yes",
    requested_outcome_key: "stress-alpha",
    cash_amount: "30",
    share_amount: "42.86",
    avg_price: "0.7",
    price_before: "0.5",
    price_after: "0.700000",
    outcome_id: "stress-alpha",
    outcome_label: "Stress alpha",
    execution_legs: []
  }
];

describe("market API read service", () => {
  beforeEach(() => {
    clearMarketApiReadCacheForTest();
  });

  it("limits market positions per outcome and contract side bucket", async () => {
    const db = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        expect(sql).toContain("partition by cp.requested_outcome_id, cp.contract_side");
        expect(sql).toContain("where bucket_rank <= $3");
        expect(sql).not.toContain("user_identities");
        expect(sql).not.toContain("identifier_display");
        expect(values).toEqual(["stress-market", expect.any(String), 2]);

        return {
          rows: [
            {
              user_id: "yes_whale",
              identifier_display: "yes-whale@navi.local",
              outcome_id: "stress-alpha",
              outcome_label: "Stress alpha",
              outcome_short_label: "Alpha",
              complement_outcome_id: null,
              complement_outcome_label: null,
              complement_outcome_short_label: null,
              outcome_count: 4,
              contract_side: "yes",
              sort_order: 0,
              shares: "1000.000000",
              cost_basis: "300.000000",
              realized_pnl: "0.000000",
              current_price: "0.300000",
              updated_at: updatedAt
            },
            {
              user_id: "no_holder",
              identifier_display: "no-holder@navi.local",
              outcome_id: "stress-alpha",
              outcome_label: "Stress alpha",
              outcome_short_label: "Alpha",
              complement_outcome_id: null,
              complement_outcome_label: null,
              complement_outcome_short_label: null,
              outcome_count: 4,
              contract_side: "no",
              sort_order: 0,
              shares: "20.000000",
              cost_basis: "12.000000",
              realized_pnl: "0.000000",
              current_price: "0.700000",
              updated_at: updatedAt
            }
          ]
        };
      })
    };

    const rows = await readPositionRows(db, "stress-market", { limit: "2" });

    expect(rows.map((row) => row.contract_side)).toEqual(["yes", "no"]);
  });

  it("exposes public actor labels on market trades without user ids or identities", async () => {
    const db = {
      async query(sql: string, values: unknown[]) {
        if (sql.includes("from trades t")) {
          expect(sql).not.toContain("user_identities");
          expect(sql).not.toContain("identifier_display");
          expect(values).toEqual(["stress-market", 2, null]);
          return {
            rows: [
              {
                trade_id: "trade_2",
                user_id: "user_omri",
                user_handle: "mrbz",
                user_display_name: "MrBz",
                user_avatar_url: "/api/uploads/avatars/avatar-mrbz.webp",
                identifier_display: "omrib@navi.local",
                created_at: new Date("2026-04-29T10:02:00.000Z"),
                side: "buy",
                contract_side: "yes",
                requested_outcome_key: "stress-bravo",
                cash_amount: "20.000000",
                share_amount: "66.670000",
                avg_price: "0.30000000",
                price_before: "0.20000000",
                price_after: "0.30000000",
                outcome_id: "stress-bravo",
                outcome_label: "Stress bravo",
                execution_legs: []
              },
              {
                trade_id: "trade_1",
                user_id: "user_unknown",
                identifier_display: null,
                created_at: new Date("2026-04-29T10:01:00.000Z"),
                side: "buy",
                contract_side: "no",
                requested_outcome_key: "stress-alpha",
                cash_amount: "10.000000",
                share_amount: "14.290000",
                avg_price: "0.70000000",
                price_before: "0.50000000",
                price_after: "0.70000000",
                outcome_id: "stress-alpha",
                outcome_label: "Stress alpha",
                execution_legs: []
              }
            ]
          };
        }

        return { rows: marketRows };
      }
    };

    const payload = await readMarketTrades(db, "stress-market", {
      limit: "2"
    });

    expect(payload?.trades[0]).toMatchObject({
      tradeId: "trade_2",
      userLabel: "MrBz",
      userHandle: "mrbz",
      avatarLabel: "M",
      avatarUrl: "/api/uploads/avatars/avatar-mrbz.webp",
      outcomeKey: "stress-bravo"
    });
    expect(payload?.trades[1]).toMatchObject({
      tradeId: "trade_1",
      userLabel: expect.stringMatching(/^חזאי [0-9A-F]{8}$/),
      avatarLabel: "ח"
    });
    expect(payload?.trades[0]).not.toHaveProperty("userId");
  });

  it("builds one public market truth capsule for result, lifecycle, contract, and winners", async () => {
    const resolvedRows = marketRows.map((row) => ({
      ...row,
      market_status: "resolved",
      persisted_status: "resolved",
      settlement_status: "completed",
      market_resolved_at: new Date("2026-05-04T10:10:00.000Z"),
      resolution_source: "Binance candles",
      resolution_rules: "Resolve from official candle close.",
      market_contract: {
        objectType: "market_contract_v1",
        version: "seer-contract-v1",
        measurementKind: "price_direction",
        resultShape: "binary",
        referenceQuarantine: {
          referenceOnly: true
        },
        payoutPolicy: {
          kind: "after_resolution",
          label: "After official resolution"
        },
        timeline: {
          expectedResolutionAt: "2026-05-04T10:05:00.000Z"
        },
        oracleCapability: "manual_resolution_required"
      },
      winning_outcome_id: "stress-bravo",
      winning_outcome_label: "Stress bravo"
    }));
    const db = {
      async query(sql: string) {
        if (sql.includes("from trades t")) {
          return { rows: [] };
        }

        return { rows: resolvedRows };
      }
    };

    const payload = await readMarket(db, "stress-market");

    expect(payload?.market).toMatchObject({
      marketStatus: "resolved",
      settlementStatus: "completed",
      resolvedAt: "2026-05-04T10:10:00.000Z",
      winner: {
        outcomeKey: "stress-bravo",
        label: "Stress bravo"
      },
      result: {
        status: "resolved",
        settlementStatus: "completed"
      },
      lifecycle: {
        closeAt: "2026-05-04T10:00:00.000Z",
        expectedResolutionAt: "2026-05-04T10:05:00.000Z",
        persistedStatus: "resolved",
        effectiveStatus: "resolved",
        payoutPolicy: {
          kind: "after_resolution"
        }
      },
      trust: {
        contract: {
          measurementKind: "price_direction",
          resultShape: "binary",
          referenceQuarantine: {
            referenceOnly: true
          },
          oracleCapability: "manual_resolution_required"
        }
      }
    });
    expect(payload?.market.outcomes).toEqual([
      expect.objectContaining({
        outcomeKey: "stress-alpha",
        isWinner: false,
        finalValue: 0
      }),
      expect.objectContaining({
        outcomeKey: "stress-bravo",
        isWinner: true,
        finalValue: 1
      })
    ]);
  });

  it("keeps price snapshots on the same lifecycle truth as market detail", async () => {
    const db = {
      async query() {
        return {
          rows: marketRows.map((row) => ({
            ...row,
            persisted_status: "open"
          }))
        };
      }
    };

    const payload = await readMarketPrices(db, "stress-market");

    expect(payload).toMatchObject({
      marketKey: "stress-market",
      marketStatus: "open",
      settlementStatus: null,
      resolvedAt: null,
      winner: null,
      result: {
        status: "open",
        settlementStatus: null
      },
      lifecycle: {
        persistedStatus: "open",
        effectiveStatus: "open",
        closeAt: "2026-05-04T10:00:00.000Z"
      }
    });
    expect(payload?.prices).toHaveLength(2);
  });

  it("single-flights raw market read payloads by market version and options", async () => {
    let tradeQueryCount = 0;
    const db = {
      async query(sql: string, values: unknown[]) {
        if (sql.includes("from trades t")) {
          tradeQueryCount += 1;
          expect(values).toEqual(["stress-market", 1000]);
          await new Promise((resolve) => setTimeout(resolve, 1));

          return { rows: tradeRows };
        }

        return { rows: marketRows };
      }
    };

    const [firstPayload, secondPayload] = await Promise.all([
      readMarketPriceHistory(db, "stress-market", {
        range: "all",
        limit: "1000"
      }),
      readMarketPriceHistory(db, "stress-market", {
        range: "all",
        limit: "1000"
      })
    ]);

    expect(tradeQueryCount).toBe(1);
    expect(secondPayload).toBe(firstPayload);
  });

  it("builds price history by replaying trades instead of cloning current prices", async () => {
    const db = {
      async query(sql: string, values: unknown[]) {
        if (sql.includes("from trades t")) {
          expect(values).toEqual(["stress-market", 1000]);
          return { rows: tradeRows };
        }

        return { rows: marketRows };
      }
    };

    const payload = await readMarketPriceHistory(db, "stress-market", {
      range: "all",
      endTs: updatedAtTs,
      limit: "1000"
    });

    expect(payload?.points.map((point) => point.label)).toEqual([
      "open",
      "trade",
      "trade",
      "current"
    ]);
    expect(payload?.points[0].values).toEqual({
      "stress-alpha": 0.5,
      "stress-bravo": 0.5
    });
    expect(payload?.points[1].values).toEqual({
      "stress-alpha": 0.51071336,
      "stress-bravo": 0.48928664
    });
    expect(payload?.points[2].values).toEqual({
      "stress-alpha": 0.49404778,
      "stress-bravo": 0.50595222
    });
    expect(payload?.points[3].values).toEqual({
      "stress-alpha": 0.49404778,
      "stress-bravo": 0.50595222
    });
    expect(payload?.source).toEqual({
      kind: "trade_replay",
      persistedCandles: false
    });
    expect(payload?.interval).toBe("trade");
    expect(payload?.outcomeOrder.map((outcome) => outcome.outcomeKey)).toEqual([
      "stress-alpha",
      "stress-bravo"
    ]);
    expect(payload?.seriesByOutcome[0]).toMatchObject({
      outcomeKey: "stress-alpha",
      label: "Stress alpha",
      points: [
        { value: 0.5 },
        { value: 0.51071336 },
        { value: 0.49404778 },
        { value: 0.49404778 }
      ]
    });
    expect(payload?.movementByOutcome["stress-alpha"]).toMatchObject({
      firstPrice: "0.50000000",
      lastPrice: "0.49404778",
      delta: "-0.00595222",
      displayDelta: "-1%"
    });
  });

  it("builds reusable market history with bucketed carry-forward points", async () => {
    const db = {
      async query(sql: string, values: unknown[]) {
        if (sql.includes("from trades t")) {
          expect(values).toEqual(["stress-market", 1000]);
          return { rows: tradeRows };
        }

        return { rows: marketRows };
      }
    };

    const payload = await readMarketHistory(db, "stress-market", {
      range: "1H",
      endTs: updatedAtTs,
      limit: "1000"
    });

    expect(payload).toMatchObject({
      marketKey: "stress-market",
      range: "1H",
      interval: "1m",
      resolutionSeconds: 60,
      source: {
        kind: "derived_from_trades",
        persistedCandles: false
      },
      sampleQuality: "active"
    });
    expect(payload?.outcomes.map((outcome) => outcome.outcomeKey)).toEqual([
      "stress-alpha",
      "stress-bravo"
    ]);
    expect(payload?.points.map((point) => point.at)).toEqual([
      "2026-04-29T10:00:00.000Z",
      "2026-04-29T10:01:00.000Z",
      "2026-04-29T10:02:00.000Z",
      "2026-04-29T10:03:00.000Z"
    ]);
    expect(payload?.points.map((point) => point.values)).toEqual([
      {
        "stress-alpha": 0.5,
        "stress-bravo": 0.5
      },
      {
        "stress-alpha": 0.51071336,
        "stress-bravo": 0.48928664
      },
      {
        "stress-alpha": 0.49404778,
        "stress-bravo": 0.50595222
      },
      {
        "stress-alpha": 0.49404778,
        "stress-bravo": 0.50595222
      }
    ]);
    expect(payload?.seriesByOutcome[0]).toMatchObject({
      outcomeKey: "stress-alpha",
      points: [
        { value: 0.5 },
        { value: 0.51071336 },
        { value: 0.49404778 },
        { value: 0.49404778 }
      ]
    });
  });

  it("keeps fresh reusable graph ranges on the smallest enclosing cadence", async () => {
    const db = {
      async query(sql: string, values: unknown[]) {
        if (sql.includes("from trades t")) {
          expect(values).toEqual(["stress-market", 1000]);
          return { rows: tradeRows };
        }

        return { rows: marketRows };
      }
    };

    const sixHourPayload = await readMarketHistory(db, "stress-market", {
      range: "6H",
      endTs: updatedAtTs,
      limit: "1000"
    });
    const oneDayPayload = await readMarketHistory(db, "stress-market", {
      range: "1D",
      endTs: updatedAtTs,
      limit: "1000"
    });
    const oneWeekPayload = await readMarketHistory(db, "stress-market", {
      range: "1W",
      endTs: updatedAtTs,
      limit: "1000"
    });
    const oneMonthPayload = await readMarketHistory(db, "stress-market", {
      range: "1M",
      endTs: updatedAtTs,
      limit: "1000"
    });

    expect(sixHourPayload).toMatchObject({
      interval: "1m",
      resolutionSeconds: 60
    });
    expect(oneDayPayload).toMatchObject({
      interval: "1m",
      resolutionSeconds: 60
    });
    expect(oneWeekPayload).toMatchObject({
      interval: "1m",
      resolutionSeconds: 60
    });
    expect(oneMonthPayload).toMatchObject({
      interval: "1m",
      resolutionSeconds: 60
    });
  });

  it("does not coarsen broad graph ranges when actual span fits inside 1D", async () => {
    const youngRows = marketRows.map((row) => ({
      ...row,
      open_at: new Date("2026-04-28T12:03:00.000Z")
    }));
    const db = {
      async query(sql: string, values: unknown[]) {
        if (sql.includes("from trades t")) {
          expect(values).toEqual(["stress-market", 1000]);
          return { rows: tradeRows };
        }

        return { rows: youngRows };
      }
    };

    const oneDayPayload = await readMarketHistory(db, "stress-market", {
      range: "1D",
      endTs: updatedAtTs,
      limit: "1000"
    });
    const oneWeekPayload = await readMarketHistory(db, "stress-market", {
      range: "1W",
      endTs: updatedAtTs,
      limit: "1000"
    });
    const oneMonthPayload = await readMarketHistory(db, "stress-market", {
      range: "1M",
      endTs: updatedAtTs,
      limit: "1000"
    });
    const allPayload = await readMarketHistory(db, "stress-market", {
      range: "all",
      endTs: updatedAtTs,
      limit: "1000"
    });

    for (const payload of [oneDayPayload, oneWeekPayload, oneMonthPayload, allPayload]) {
      expect(payload).toMatchObject({
        interval: "5m",
        resolutionSeconds: 300
      });
    }
    expect(oneWeekPayload?.points.length).toBe(oneDayPayload?.points.length);
    expect(oneMonthPayload?.points.length).toBe(oneDayPayload?.points.length);
    expect(allPayload?.points.length).toBe(oneDayPayload?.points.length);
  });

  it("keeps all-range history denser than visible long-range labels", async () => {
    const longRangeRows = marketRows.map((row) => ({
      ...row,
      open_at: new Date("2026-03-23T10:00:00.000Z")
    }));
    const longRangeEndTs = String(
      Math.floor(new Date("2026-05-10T10:00:00.000Z").getTime() / 1000)
    );
    const db = {
      async query(sql: string, values: unknown[]) {
        if (sql.includes("from trades t")) {
          expect(values).toEqual(["stress-market", 1000]);
          return { rows: tradeRows };
        }

        return { rows: longRangeRows };
      }
    };

    const payload = await readMarketHistory(db, "stress-market", {
      range: "all",
      endTs: longRangeEndTs,
      limit: "1000"
    });

    expect(payload).toMatchObject({
      interval: "12h",
      resolutionSeconds: 43200
    });
  });

  it("prefers base candles for standard reusable market history reads", async () => {
    const closedMarketRows = marketRows.map((row) => ({
      ...row,
      market_status: "closed"
    }));
    const db = {
      async query(sql: string) {
        if (sql.includes("select bucket_at from market_base_candles")) {
          return {
            rows: [
              {
                bucket_at: new Date("2026-04-29T10:00:00.000Z")
              }
            ]
          };
        }

        if (sql.includes("from market_base_candles")) {
          return {
            rows: [
              {
                bucket_at: new Date("2026-04-29T10:00:00.000Z"),
                values: {
                  "stress-alpha": 0.5,
                  "stress-bravo": 0.5
                }
              },
              {
                bucket_at: new Date("2026-04-29T10:03:00.000Z"),
                values: {
                  "stress-alpha": 0.49404778,
                  "stress-bravo": 0.50595222
                }
              }
            ]
          };
        }

        if (sql.includes("from trades t")) {
          throw new Error("persisted candle read should not replay trades");
        }

        return { rows: closedMarketRows };
      }
    };

    const payload = await readMarketHistory(db, "stress-market", {
      range: "1H"
    });

    expect(payload?.source).toEqual({
      kind: "persisted_candles",
      persistedCandles: true,
      stale: false
    });
    expect(payload?.points.length).toBeGreaterThanOrEqual(2);
    expect(payload?.points.at(-1)?.values).toEqual({
      "stress-alpha": 0.49404778,
      "stress-bravo": 0.50595222
    });
  });

  it("appends a derived settlement point to resolved history without replaying trades", async () => {
    const resolvedAt = new Date("2026-04-29T10:10:00.000Z");
    const resolvedMarketRows = marketRows.map((row) => ({
      ...row,
      market_status: "resolved",
      persisted_status: "resolved",
      settlement_status: "completed",
      market_resolved_at: resolvedAt,
      resolution_resolved_at: resolvedAt,
      winning_outcome_id: "stress-bravo",
      updated_at: resolvedAt
    }));
    const db = {
      async query(sql: string) {
        if (sql.includes("select bucket_at from market_base_candles")) {
          return {
            rows: [
              {
                bucket_at: new Date("2026-04-29T10:00:00.000Z")
              }
            ]
          };
        }

        if (sql.includes("from market_base_candles")) {
          return {
            rows: [
              {
                bucket_at: new Date("2026-04-29T10:00:00.000Z"),
                values: {
                  "stress-alpha": 0.5,
                  "stress-bravo": 0.5
                }
              },
              {
                bucket_at: new Date("2026-04-29T10:03:00.000Z"),
                values: {
                  "stress-alpha": 0.49404778,
                  "stress-bravo": 0.50595222
                }
              }
            ]
          };
        }

        if (sql.includes("from trades t")) {
          throw new Error("resolved persisted history should not replay trades");
        }

        return { rows: resolvedMarketRows };
      }
    };

    const payload = await readMarketHistory(db, "stress-market", {
      range: "1H"
    });

    expect(payload?.source).toEqual({
      kind: "persisted_candles",
      persistedCandles: true,
      stale: false
    });
    expect(payload?.points.at(-1)).toMatchObject({
      at: "2026-04-29T10:10:00.000Z",
      label: "settlement",
      kind: "settlement",
      values: {
        "stress-alpha": 0,
        "stress-bravo": 1
      }
    });
    expect(payload?.seriesByOutcome[0].points.at(-1)).toEqual({
      at: "2026-04-29T10:10:00.000Z",
      t: 1777457400,
      kind: "settlement",
      value: 0
    });
    expect(payload?.seriesByOutcome[1].points.at(-1)).toEqual({
      at: "2026-04-29T10:10:00.000Z",
      t: 1777457400,
      kind: "settlement",
      value: 1
    });
    expect(payload?.movementByOutcome["stress-bravo"]).toMatchObject({
      lastPrice: "1.00000000",
      displayDelta: "+50%"
    });
  });

  it("reuses fresh open-market candles across market version churn", async () => {
    const replayTrades = vi.fn();
    const versionChurnRows = marketRows.map((row) => ({
      ...row,
      market_state_version: "99"
    }));
    const db = {
      async query(sql: string) {
        if (sql.includes("select bucket_at from market_base_candles")) {
          return {
            rows: [
              {
                bucket_at: new Date("2026-04-29T10:00:00.000Z")
              }
            ]
          };
        }

        if (sql.includes("from market_base_candles")) {
          return {
            rows: [
              {
                bucket_at: new Date("2026-04-29T10:00:00.000Z"),
                values: {
                  "stress-alpha": 0.5,
                  "stress-bravo": 0.5
                }
              }
            ]
          };
        }

        if (sql.includes("from trades t")) {
          replayTrades();
          return { rows: tradeRows };
        }

        return { rows: versionChurnRows };
      }
    };

    const payload = await readMarketHistory(db, "stress-market", {
      range: "1H"
    });

    expect(payload?.source).toEqual({
      kind: "persisted_candles",
      persistedCandles: true,
      stale: false
    });
    expect(payload?.marketStateVersion).toBe(99);
    expect(replayTrades).not.toHaveBeenCalled();
  });

  it("serves base candles immediately without synchronous trade replay", async () => {
    const replayTrades = vi.fn();
    const db = {
      async query(sql: string) {
        if (sql.includes("select bucket_at from market_base_candles")) {
          return {
            rows: [
              {
                bucket_at: new Date("2026-04-29T10:00:00.000Z")
              }
            ]
          };
        }

        if (sql.includes("from market_base_candles")) {
          return {
            rows: [
              {
                bucket_at: new Date("2026-04-29T10:00:00.000Z"),
                values: {
                  "stress-alpha": 0.5,
                  "stress-bravo": 0.5
                }
              }
            ]
          };
        }

        if (sql.includes("from trades t")) {
          replayTrades();
          return { rows: tradeRows };
        }

        if (
          sql.includes("delete from market_base_candles") ||
          sql.includes("insert into market_base_candles")
        ) {
          return { rows: [], rowCount: 1 };
        }

        return { rows: marketRows };
      }
    };

    const payload = await readMarketHistory(db, "stress-market", {
      range: "1H"
    });

    expect(payload?.source).toEqual({
      kind: "persisted_candles",
      persistedCandles: true,
      stale: false
    });
    expect(payload?.points.at(-1)).toMatchObject({
      values: {
        "stress-alpha": 0.5,
        "stress-bravo": 0.5
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(replayTrades).not.toHaveBeenCalled();
  });

  it("keeps multi-outcome NO trade history as one coherent probability vector", async () => {
    const multiRows = ["alpha", "bravo", "charlie", "delta"].map((name, index) => ({
      ...marketRows[0],
      outcome_count: 4,
      outcome_id: `stress-${name}`,
      outcome_label: `Stress ${name}`,
      outcome_short_label: name,
      q_shares: index === 0 ? "0" : "100",
      sort_order: index,
      last_price: index === 0 ? "0.23172217" : "0.25609261"
    }));
    const multiTrades = [
      {
        ...tradeRows[1],
        trade_id: "trade_no_alpha",
        side: "buy",
        contract_side: "no",
        requested_outcome_key: "stress-alpha",
        outcome_id: "stress-alpha",
        outcome_label: "Stress alpha",
        share_amount: "100",
        price_after: "0.76827783",
        execution_legs: [
          { outcome_id: "stress-bravo", share_amount: "100" },
          { outcome_id: "stress-charlie", share_amount: "100" },
          { outcome_id: "stress-delta", share_amount: "100" }
        ]
      }
    ];
    const db = {
      async query(sql: string, values: unknown[]) {
        if (sql.includes("from trades t")) {
          expect(values).toEqual(["stress-market", 1000]);
          return { rows: multiTrades };
        }

        return { rows: multiRows };
      }
    };

    const payload = await readMarketPriceHistory(db, "stress-market", {
      range: "all",
      endTs: updatedAtTs,
      limit: "1000"
    });
    const afterNoTrade = payload?.points.find((point) => point.label === "trade")?.values;

    expect(afterNoTrade).toEqual({
      "stress-alpha": 0.23172217,
      "stress-bravo": 0.25609261,
      "stress-charlie": 0.25609261,
      "stress-delta": 0.25609261
    });
    expect(Object.values(afterNoTrade ?? {}).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 8);
    expect(afterNoTrade?.["stress-alpha"]).toBeLessThan(0.25);
  });

  it("returns a flat reusable market history line when no trades exist in range", async () => {
    const olderMarketRows = marketRows.map((row) => ({
      ...row,
      open_at: new Date("2026-04-29T08:00:00.000Z"),
      updated_at: new Date("2026-04-29T10:03:00.000Z"),
      last_price: row.outcome_id === "stress-bravo" ? "0.500000" : row.last_price
    }));
    const olderTradeRows = [
      {
        ...tradeRows[1],
        trade_id: "trade_old",
        created_at: new Date("2026-04-29T08:30:00.000Z"),
        outcome_id: "stress-alpha",
        price_after: "0.700000"
      }
    ];
    const db = {
      async query(sql: string, values: unknown[]) {
        if (sql.includes("from trades t")) {
          expect(values).toEqual(["stress-market", 1000]);
          return { rows: olderTradeRows };
        }

        return { rows: olderMarketRows };
      }
    };

    const payload = await readMarketHistory(db, "stress-market", {
      range: "1H",
      endTs: updatedAtTs,
      limit: "1000"
    });

    expect(payload?.sampleQuality).toBe("flat_no_trades");
    expect(payload?.points[0]).toMatchObject({
      at: "2026-04-29T09:03:00.000Z",
      values: {
        "stress-alpha": 0.49404778,
        "stress-bravo": 0.50595222
      }
    });
    expect(payload?.points.at(-1)).toMatchObject({
      at: "2026-04-29T10:03:00.000Z",
      values: {
        "stress-alpha": 0.49404778,
        "stress-bravo": 0.50595222
      }
    });
    expect(payload?.points.every((point) => point.values["stress-alpha"] === 0.49404778)).toBe(true);
  });

  it("scopes price history ranges with a carry-forward range start", async () => {
    const olderMarketRows = marketRows.map((row) => ({
      ...row,
      open_at: new Date("2026-04-29T08:00:00.000Z"),
      updated_at: new Date("2026-04-29T10:03:00.000Z")
    }));
    const olderTradeRows = [
      {
        ...tradeRows[0],
        trade_id: "trade_recent",
        created_at: new Date("2026-04-29T10:01:00.000Z"),
        outcome_id: "stress-bravo",
        price_after: "0.300000"
      },
      {
        ...tradeRows[1],
        trade_id: "trade_old",
        created_at: new Date("2026-04-29T08:30:00.000Z"),
        outcome_id: "stress-alpha",
        price_after: "0.700000"
      }
    ];
    const db = {
      async query(sql: string, values: unknown[]) {
        if (sql.includes("from trades t")) {
          expect(values).toEqual(["stress-market", 1000]);
          return { rows: olderTradeRows };
        }

        return { rows: olderMarketRows };
      }
    };

    const payload = await readMarketPriceHistory(db, "stress-market", {
      range: "1H",
      endTs: updatedAtTs,
      limit: "1000"
    });

    expect(payload?.range).toBe("1H");
    expect(payload?.interval).toBe("1m");
    expect(payload?.points.map((point) => point.label)).toEqual([
      "range_start",
      "trade",
      "current"
    ]);
    expect(payload?.points[0]).toMatchObject({
      at: "2026-04-29T09:03:00.000Z",
      values: {
        "stress-alpha": 0.51071336,
        "stress-bravo": 0.48928664
      }
    });
  });

  it("accepts Polymarket-style interval and timestamp bounds for history reads", async () => {
    const db = {
      async query(sql: string, values: unknown[]) {
        if (sql.includes("from trades t")) {
          expect(values).toEqual(["stress-market", 1000]);
          return { rows: tradeRows };
        }

        return { rows: marketRows };
      }
    };

    const payload = await readMarketPriceHistory(db, "stress-market", {
      interval: "1h",
      startTs: "1777456830",
      endTs: "1777456980",
      fidelity: "5",
      limit: "1000"
    });

    expect(payload?.range).toBe("1H");
    expect(payload?.interval).toBe("1h");
    expect(payload?.startTs).toBe(1777456830);
    expect(payload?.endTs).toBe(1777456980);
    expect(payload?.fidelityMinutes).toBe(5);
    expect(payload?.points.map((point) => point.label)).toEqual([
      "range_start",
      "trade",
      "trade",
      "current"
    ]);
  });

  it("builds anonymized top holders and positions from open market positions", async () => {
    const db = {
      async query(sql: string, values: unknown[]) {
        if (sql.includes("from contract_positions cp")) {
          expect(sql).not.toContain("user_identities");
          expect(sql).not.toContain("identifier_display");
          expect(values).toEqual(["stress-market", "0.010000", 5]);
          expect(sql).toContain("cp.settled_at is null");
          return {
            rows: [
              {
                user_id: "user_omri",
                user_handle: "mrbz",
                user_display_name: "MrBz",
                user_avatar_url: "/api/uploads/avatars/avatar-mrbz.webp",
                identifier_display: "omrib@navi.local",
                outcome_id: "stress-alpha",
                outcome_label: "Stress alpha",
                outcome_short_label: "Alpha",
                complement_outcome_id: "stress-bravo",
                complement_outcome_label: "Stress bravo",
                complement_outcome_short_label: "Bravo",
                outcome_count: 2,
                contract_side: "yes",
                sort_order: 0,
                shares: "20.000000",
                cost_basis: "10.000000",
                realized_pnl: "1.000000",
                current_price: "0.700000",
                updated_at: updatedAt
              },
              {
                user_id: "user_no",
                identifier_display: "no-holder@navi.local",
                outcome_id: "stress-alpha",
                outcome_label: "Stress alpha",
                outcome_short_label: "Alpha",
                complement_outcome_id: "stress-bravo",
                complement_outcome_label: "Stress bravo",
                complement_outcome_short_label: "Bravo",
                outcome_count: 2,
                contract_side: "no",
                sort_order: 0,
                shares: "7.000000",
                cost_basis: "2.100000",
                realized_pnl: "0.000000",
                current_price: "0.300000",
                updated_at: updatedAt
              },
              {
                user_id: "user_two",
                identifier_display: null,
                outcome_id: "stress-bravo",
                outcome_label: "Stress bravo",
                outcome_short_label: "Bravo",
                complement_outcome_id: "stress-alpha",
                complement_outcome_label: "Stress alpha",
                complement_outcome_short_label: "Alpha",
                outcome_count: 2,
                contract_side: "yes",
                sort_order: 1,
                shares: "5.000000",
                cost_basis: "2.000000",
                realized_pnl: "0.000000",
                current_price: "0.300000",
                updated_at: updatedAt
              },
              {
                user_id: "user_omri",
                user_handle: "mrbz",
                user_display_name: "MrBz",
                user_avatar_url: "/api/uploads/avatars/avatar-mrbz.webp",
                identifier_display: "omrib@navi.local",
                outcome_id: "stress-bravo",
                outcome_label: "Stress bravo",
                outcome_short_label: "Bravo",
                complement_outcome_id: "stress-alpha",
                complement_outcome_label: "Stress alpha",
                complement_outcome_short_label: "Alpha",
                outcome_count: 2,
                contract_side: "no",
                sort_order: 1,
                shares: "11.000000",
                cost_basis: "4.000000",
                realized_pnl: "0.000000",
                current_price: "0.700000",
                updated_at: updatedAt
              },
              {
                user_id: "dust_user",
                identifier_display: "dust@navi.local",
                outcome_id: "stress-alpha",
                outcome_label: "Stress alpha",
                outcome_short_label: "Alpha",
                complement_outcome_id: "stress-bravo",
                complement_outcome_label: "Stress bravo",
                complement_outcome_short_label: "Bravo",
                outcome_count: 2,
                contract_side: "yes",
                sort_order: 0,
                shares: "0.001568",
                cost_basis: "0.000302",
                realized_pnl: "0.000000",
                current_price: "0.700000",
                updated_at: updatedAt
              }
            ]
          };
        }

        return { rows: marketRows };
      }
    };

    const payload = await readMarketPositions(db, "stress-market", {
      limit: "5"
    });

    expect(payload?.openPositionsCount).toBe(3);
    expect(payload).toMatchObject({
      marketStatus: "open",
      settlementStatus: null,
      lifecycle: {
        effectiveStatus: "open",
        closeAt: "2026-05-04T10:00:00.000Z"
      }
    });
    expect(payload?.holdersByOutcome["stress-alpha"].yes[0]).toMatchObject({
      userLabel: "MrBz",
      userHandle: "mrbz",
      avatarLabel: "M",
      avatarUrl: "/api/uploads/avatars/avatar-mrbz.webp",
      contractSide: "yes",
      shares: "31.000000"
    });
    expect(payload?.holdersByOutcome["stress-alpha"].no).toEqual([]);
    expect(payload?.holdersByOutcome["stress-bravo"].yes[0]).toMatchObject({
      userLabel: expect.stringMatching(/^חזאי [0-9A-F]{8}$/),
      avatarLabel: "ח",
      contractSide: "yes",
      shares: "7.000000"
    });
    expect(payload?.positionsByOutcome["stress-alpha"].yes[0]).toMatchObject({
      averageCost: "0.45161290",
      currentPrice: "0.70000000",
      pnl: "8.700000"
    });
    expect(payload?.positionsByOutcome["stress-alpha"].no).toEqual([]);
    expect(payload?.positionsByOutcome["stress-bravo"].yes[0]).toMatchObject({
      averageCost: "0.30000000",
      currentPrice: "0.30000000",
      pnl: "0.000000"
    });
    expect(payload?.positionsByOutcome["stress-bravo"].yes[1]).toMatchObject({
      userLabel: expect.stringMatching(/^חזאי [0-9A-F]{8}$/),
      pnl: "-0.500000"
    });
    expect(payload?.positionsByOutcome["stress-alpha"].yes[0]).not.toHaveProperty("userId");
  });
});
