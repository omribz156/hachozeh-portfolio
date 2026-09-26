import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createInMemoryRateLimiter } from "../../src/http/rate-limit";
import { clearMarketApiReadCacheForTest } from "../../src/markets/market-api-read-service";
import {
  closeAppTestServers,
  startServer
} from "./app-test-harness";

beforeEach(() => {
  clearMarketApiReadCacheForTest();
});

afterEach(async () => {
  await closeAppTestServers();
});

describe("public market read routes", () => {
  it("returns an honest live market count for the shell pill", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string) => {
        expect(sql).toContain("timeline,liveStartAt");
        expect(sql).toContain("liveStatus");

        return {
          rows: [
            {
              count: 2
            }
          ]
        };
      }
    });

    const response = await fetch(`${baseUrl}/api/markets/live-count`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=15, stale-while-revalidate=120"
    );
    expect(response.headers.get("cloudflare-cdn-cache-control")).toBe(
      "public, max-age=60, stale-while-revalidate=120"
    );
    expect(payload).toEqual({
      count: 2,
      generatedAt: expect.any(String)
    });
  });

  it("returns canonical market catalog cards outside the discovery feed", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql.includes("from markets m")) {
          expect(values).toEqual(["open", "economics", 2, null]);

          return {
            rows: [
              {
                market_id: "disc-cm-boi-rate-decision-may-25-2026",
                market_status: "open",
                title: "החלטת בנק ישראל במאי?",
                description: "שוק ריבית",
                category_key: "economics",
                open_at: new Date("2026-04-01T09:00:00.000Z"),
                close_at: new Date("2026-05-25T16:00:00.000Z"),
                published_at: new Date("2026-04-16T09:20:57.075Z"),
                updated_at: new Date("2026-04-12T18:40:00.000Z"),
                market_state_version: "7",
                outcome_count: 2,
                total_volume: "300.000000",
                outcome_id: "disc-cm-boi-rate-decision-may-25-2026-hold",
                outcome_label: "ללא שינוי",
                outcome_short_label: "ללא שינוי",
                sort_order: 0,
                last_price: "0.82000000"
              },
              {
                market_id: "disc-cm-boi-rate-decision-may-25-2026",
                market_status: "open",
                title: "החלטת בנק ישראל במאי?",
                description: "שוק ריבית",
                category_key: "economics",
                open_at: new Date("2026-04-01T09:00:00.000Z"),
                close_at: new Date("2026-05-25T16:00:00.000Z"),
                published_at: new Date("2026-04-16T09:20:57.075Z"),
                updated_at: new Date("2026-04-12T18:40:00.000Z"),
                market_state_version: "7",
                outcome_count: 2,
                total_volume: "300.000000",
                outcome_id: "disc-cm-boi-rate-decision-may-25-2026-cut",
                outcome_label: "הורדה",
                outcome_short_label: "הורדה",
                sort_order: 1,
                last_price: "0.18000000"
              }
            ]
          };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected db query in app test: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/api/markets?status=open&category=economy&limit=2`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=15, stale-while-revalidate=120"
    );
    expect(response.headers.get("cloudflare-cdn-cache-control")).toBe(
      "public, max-age=60, stale-while-revalidate=120"
    );
    expect(payload.markets).toEqual([
      expect.objectContaining({
        marketKey: "disc-cm-boi-rate-decision-may-25-2026",
        marketStatus: "open",
        title: "החלטת בנק ישראל במאי?",
        outcomeCount: 2,
        marketStateVersion: 7,
        category: {
          key: "economy",
          label: "כלכלה"
        },
        volume: {
          value: "300.000000",
          label: "V₪ 300"
        },
        prices: {
          "disc-cm-boi-rate-decision-may-25-2026-hold": "0.82000000",
          "disc-cm-boi-rate-decision-may-25-2026-cut": "0.18000000"
        }
      })
    ]);
    expect(payload.pagination).toEqual({
      limit: 2,
      nextCursor: null
    });
  });

  it("filters and sorts the canonical market catalog for tooling queries", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql.includes("from markets m")) {
          expect(sql).toContain("m.title ilike");
          expect(sql).toContain("m.close_at >= $6::timestamptz");
          expect(sql).toContain("m.close_at <= $7::timestamptz");
          expect(sql).toContain("order by m.close_at asc, m.id asc");
          expect(values).toEqual([
            null,
            null,
            1,
            null,
            "%ריבית%",
            "2026-04-01T00:00:00.000Z",
            "2026-06-01T00:00:00.000Z"
          ]);

          return {
            rows: [
              {
                market_id: "disc-cm-boi-rate-decision-may-25-2026",
                market_status: "open",
                title: "החלטת ריבית בנק ישראל במאי?",
                description: "שוק ריבית",
                category_key: "economics",
                open_at: new Date("2026-04-01T09:00:00.000Z"),
                close_at: new Date("2026-05-25T16:00:00.000Z"),
                published_at: new Date("2026-04-16T09:20:57.075Z"),
                updated_at: new Date("2026-04-12T18:40:00.000Z"),
                market_state_version: "7",
                outcome_count: 2,
                total_volume: "300.000000",
                outcome_id: "disc-cm-boi-rate-decision-may-25-2026-hold",
                outcome_label: "ללא שינוי",
                outcome_short_label: "ללא שינוי",
                sort_order: 0,
                last_price: "0.82000000"
              }
            ]
          };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected db query in app test: ${sql}`);
      }
    });

    const response = await fetch(
      `${baseUrl}/api/markets?status=all&q=${encodeURIComponent(
        "ריבית"
      )}&closeAfter=2026-04-01T00:00:00.000Z&closeBefore=2026-06-01T00:00:00.000Z&sort=close_asc&limit=1`
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.filters).toEqual({
      status: null,
      category: null,
      q: "ריבית",
      closeAfter: "2026-04-01T00:00:00.000Z",
      closeBefore: "2026-06-01T00:00:00.000Z",
      sort: "close_asc"
    });
    expect(payload.markets[0]).toMatchObject({
      marketKey: "disc-cm-boi-rate-decision-may-25-2026",
      title: "החלטת ריבית בנק ישראל במאי?"
    });
  });

  it("bounds catalog query text before database matching", async () => {
    const longQuery = "ר".repeat(300);
    const boundedQuery = "ר".repeat(120);
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql.includes("from markets m")) {
          expect(sql).toContain("m.title ilike");
          expect(values).toEqual(["open", null, 50, null, `%${boundedQuery}%`]);
          return { rows: [] };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected db query in app test: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/api/markets?q=${encodeURIComponent(longQuery)}`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.filters.q).toBe(boundedQuery);
    expect(payload.markets).toEqual([]);
  });

  it("returns canonical market detail and reusable market data routes", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql.includes("from markets m")) {
          expect(values?.[0]).toBe("market_seed_next_prime_minister");

          return {
            rowCount: 2,
            rows: [
              {
                market_id: "market_seed_next_prime_minister",
                market_status: "open",
                title: "מי יהיה ראש הממשלה הבא?",
                description: "שוק backend",
                category_key: "politics",
                open_at: new Date("2026-03-01T08:00:00.000Z"),
                close_at: new Date("2026-06-22T18:00:00.000Z"),
                published_at: new Date("2026-03-01T09:00:00.000Z"),
                updated_at: new Date("2026-03-29T09:00:00.000Z"),
                market_state_version: "12",
                liquidity_b: "100.00000000",
                outcome_count: 2,
                total_volume: "38.000000",
                outcome_id: "market_seed_next_prime_minister_outcome_option_a",
                outcome_label: "מועמד א'",
                outcome_short_label: "מועמד א'",
                q_shares: "10.000000",
                sort_order: 0,
                last_price: "0.61000000"
              },
              {
                market_id: "market_seed_next_prime_minister",
                market_status: "open",
                title: "מי יהיה ראש הממשלה הבא?",
                description: "שוק backend",
                category_key: "politics",
                open_at: new Date("2026-03-01T08:00:00.000Z"),
                close_at: new Date("2026-06-22T18:00:00.000Z"),
                published_at: new Date("2026-03-01T09:00:00.000Z"),
                updated_at: new Date("2026-03-29T09:00:00.000Z"),
                market_state_version: "12",
                liquidity_b: "100.00000000",
                outcome_count: 2,
                total_volume: "38.000000",
                outcome_id: "market_seed_next_prime_minister_outcome_option_b",
                outcome_label: "מועמד ב'",
                outcome_short_label: "מועמד ב'",
                q_shares: "0.000000",
                sort_order: 1,
                last_price: "0.39000000"
              }
            ]
          };
        }

        if (sql.includes("from trades t")) {
          expect(values?.[0]).toBe("market_seed_next_prime_minister");

          return {
            rows: [
              {
                trade_id: "trade_2",
                created_at: new Date("2026-04-07T10:00:00.000Z"),
                side: "sell",
                contract_side: "yes",
                requested_outcome_key: "market_seed_next_prime_minister_outcome_option_a",
                cash_amount: "18.000000",
                share_amount: "20.000000",
                avg_price: "0.90000000",
                price_before: "0.88000000",
                price_after: "0.87000000",
                outcome_id: "market_seed_next_prime_minister_outcome_option_a",
                outcome_label: "מועמד א'",
                execution_legs: []
              }
            ]
          };
        }

        if (sql.includes("select bucket_at from market_base_candles")) {
          expect(values?.[0]).toBe("market_seed_next_prime_minister");

          return {
            rows: [
              {
                bucket_at: new Date("2026-04-07T10:00:00.000Z")
              }
            ]
          };
        }

        if (sql.includes("from market_base_candles")) {
          expect(values?.[0]).toBe("market_seed_next_prime_minister");

          return {
            rows: [
              {
                bucket_at: new Date("2026-04-07T10:00:00.000Z"),
                values: {
                  "option-a": 0.52497919,
                  "option-b": 0.47502081
                }
              }
            ]
          };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected db query in app test: ${sql}`);
      }
    });

    const detailResponse = await fetch(`${baseUrl}/api/markets/next-prime-minister`);
    const detailPayload = await detailResponse.json();

    expect(detailResponse.status).toBe(200);
    expect(detailPayload.market).toMatchObject({
      marketKey: "next-prime-minister",
      marketId: "market_seed_next_prime_minister",
      marketStatus: "open",
      lifecycle: {
        persistedStatus: "open",
        effectiveStatus: "open",
        closeAt: "2026-06-22T18:00:00.000Z"
      },
      orderModel: "immediate_execution",
      prices: {
        "option-a": "0.61000000",
        "option-b": "0.39000000"
      }
    });

    const pricesResponse = await fetch(`${baseUrl}/api/markets/next-prime-minister/prices`);
    const pricesPayload = await pricesResponse.json();

    expect(pricesResponse.status).toBe(200);
    expect(pricesPayload).toMatchObject({
      marketKey: "next-prime-minister",
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
        closeAt: "2026-06-22T18:00:00.000Z"
      }
    });
    expect(pricesPayload.prices).toEqual([
      {
        outcomeKey: "option-a",
        outcomeId: "market_seed_next_prime_minister_outcome_option_a",
        label: "מועמד א'",
        price: "0.61000000"
      },
      {
        outcomeKey: "option-b",
        outcomeId: "market_seed_next_prime_minister_outcome_option_b",
        label: "מועמד ב'",
        price: "0.39000000"
      }
    ]);

    const tradesResponse = await fetch(`${baseUrl}/api/markets/next-prime-minister/trades?limit=1`);
    const tradesPayload = await tradesResponse.json();

    expect(tradesResponse.status).toBe(200);
    expect(tradesPayload.trades).toEqual([
      expect.objectContaining({
        tradeId: "trade_2",
        outcomeKey: "option-a",
        outcomeLabel: "מועמד א'",
        side: "sell",
        contractSide: "yes",
        cashAmount: "18.000000"
      })
    ]);

    const historyResponse = await fetch(
      `${baseUrl}/api/markets/next-prime-minister/price-history?range=all`
    );
    const historyPayload = await historyResponse.json();

    expect(historyResponse.status).toBe(200);
    expect(historyPayload).toMatchObject({
      marketKey: "next-prime-minister",
      range: "all",
      points: expect.arrayContaining([
        expect.objectContaining({
          values: {
            "option-a": 0.52497919,
            "option-b": 0.47502081
          }
        })
      ])
    });

    const reusableHistoryResponse = await fetch(
      `${baseUrl}/api/markets/next-prime-minister/history?range=1D`
    );
    const reusableHistoryPayload = await reusableHistoryResponse.json();

    expect(reusableHistoryResponse.status).toBe(200);
    expect(reusableHistoryResponse.headers.get("cache-control")).toBe(
      "public, max-age=30, stale-while-revalidate=60"
    );
    expect(reusableHistoryResponse.headers.get("cloudflare-cdn-cache-control")).toBe(
      "public, max-age=30, stale-while-revalidate=60"
    );
    expect(reusableHistoryPayload).toMatchObject({
      marketKey: "next-prime-minister",
      range: "1D",
      resolutionSeconds: 300,
      source: {
        kind: "persisted_candles",
        persistedCandles: true
      },
      outcomes: [
        expect.objectContaining({
          outcomeKey: "option-a"
        }),
        expect.objectContaining({
          outcomeKey: "option-b"
        })
      ],
      points: expect.arrayContaining([
        expect.objectContaining({
          values: expect.objectContaining({
            "option-a": expect.any(Number),
            "option-b": expect.any(Number)
          })
        })
      ])
    });
  });

  it("falls back to reusable public history trade replay when base candles are missing", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql.includes("from markets m")) {
          expect(values?.[0]).toBe("market_seed_next_prime_minister");

          return {
            rowCount: 2,
            rows: [
              {
                market_id: "market_seed_next_prime_minister",
                market_status: "open",
                title: "מי יהיה ראש הממשלה הבא?",
                description: null,
                category_key: "politics",
                open_at: new Date("2026-03-01T08:00:00.000Z"),
                close_at: new Date("2026-06-22T18:00:00.000Z"),
                published_at: new Date("2026-03-01T09:00:00.000Z"),
                updated_at: new Date("2026-03-29T09:00:00.000Z"),
                market_state_version: "12",
                liquidity_b: "100.00000000",
                outcome_count: 2,
                total_volume: "38.000000",
                outcome_id: "market_seed_next_prime_minister_outcome_option_a",
                outcome_label: "מועמד א'",
                outcome_short_label: "מועמד א'",
                q_shares: "10.000000",
                sort_order: 0,
                last_price: "0.61000000"
              },
              {
                market_id: "market_seed_next_prime_minister",
                market_status: "open",
                title: "מי יהיה ראש הממשלה הבא?",
                description: null,
                category_key: "politics",
                open_at: new Date("2026-03-01T08:00:00.000Z"),
                close_at: new Date("2026-06-22T18:00:00.000Z"),
                published_at: new Date("2026-03-01T09:00:00.000Z"),
                updated_at: new Date("2026-03-29T09:00:00.000Z"),
                market_state_version: "12",
                liquidity_b: "100.00000000",
                outcome_count: 2,
                total_volume: "38.000000",
                outcome_id: "market_seed_next_prime_minister_outcome_option_b",
                outcome_label: "מועמד ב'",
                outcome_short_label: "מועמד ב'",
                q_shares: "0.000000",
                sort_order: 1,
                last_price: "0.39000000"
              }
            ]
          };
        }

        if (sql.includes("from market_base_candles")) {
          expect(values?.[0]).toBe("market_seed_next_prime_minister");
          return { rows: [] };
        }

        if (sql.includes("from trades t")) {
          // The un-backfilled-market fallback (readAllHistoryTradeRows) is
          // capped at FALLBACK_TRADE_REPLAY_CAP (market-history-service.ts)
          // so a market with no base candles can't force an unbounded JS
          // trade replay — this query now carries a LIMIT and the cap value.
          expect(sql).toContain("limit $2");
          expect(values).toEqual(["market_seed_next_prime_minister", 20000]);

          return {
            rows: [
              {
                trade_id: "trade_2",
                user_id: "user_1",
                created_at: new Date("2026-04-07T10:00:00.000Z"),
                side: "sell",
                contract_side: "yes",
                requested_outcome_key: "market_seed_next_prime_minister_outcome_option_a",
                cash_amount: "18.000000",
                share_amount: "20.000000",
                avg_price: "0.90000000",
                price_before: "0.88000000",
                price_after: "0.87000000",
                outcome_id: "market_seed_next_prime_minister_outcome_option_a",
                outcome_label: "מועמד א'",
                execution_legs: []
              }
            ]
          };
        }

        if (
          sql.includes("delete from market_base_candles") ||
          sql.includes("insert into market_base_candles")
        ) {
          expect(values?.[0]).toBe("market_seed_next_prime_minister");
          return { rows: [], rowCount: 1 };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }

        throw new Error(`Unexpected db query in app test: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/api/markets/next-prime-minister/history?range=1D`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.pagination).toMatchObject({
      limit: 500,
      truncated: false,
      replayedTrades: 1
    });
  });

  it("keeps effective lifecycle fields aligned across exact market and prices reads", async () => {
    const marketRows = [
      {
        market_id: "market_seed_next_prime_minister",
        market_status: "closed",
        persisted_status: "open",
        title: "מי יהיה ראש הממשלה הבא?",
        description: "שוק backend",
        category_key: "politics",
        open_at: new Date("2026-03-01T08:00:00.000Z"),
        close_at: new Date("2026-06-22T18:00:00.000Z"),
        published_at: new Date("2026-03-01T09:00:00.000Z"),
        updated_at: new Date("2026-06-22T18:05:00.000Z"),
        market_state_version: "99",
        liquidity_b: "100.00000000",
        settlement_status: null,
        market_resolved_at: null,
        outcome_count: 2,
        total_volume: "38.000000",
        outcome_id: "market_seed_next_prime_minister_outcome_option_a",
        outcome_label: "מועמד א'",
        outcome_short_label: "מועמד א'",
        q_shares: "10.000000",
        sort_order: 0,
        last_price: "0.61000000"
      },
      {
        market_id: "market_seed_next_prime_minister",
        market_status: "closed",
        persisted_status: "open",
        title: "מי יהיה ראש הממשלה הבא?",
        description: "שוק backend",
        category_key: "politics",
        open_at: new Date("2026-03-01T08:00:00.000Z"),
        close_at: new Date("2026-06-22T18:00:00.000Z"),
        published_at: new Date("2026-03-01T09:00:00.000Z"),
        updated_at: new Date("2026-06-22T18:05:00.000Z"),
        market_state_version: "99",
        liquidity_b: "100.00000000",
        settlement_status: null,
        market_resolved_at: null,
        outcome_count: 2,
        total_volume: "38.000000",
        outcome_id: "market_seed_next_prime_minister_outcome_option_b",
        outcome_label: "מועמד ב'",
        outcome_short_label: "מועמד ב'",
        q_shares: "0.000000",
        sort_order: 1,
        last_price: "0.39000000"
      }
    ];
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql.includes("from markets m")) {
          expect(values?.[0]).toBe("market_seed_next_prime_minister");

          return {
            rowCount: marketRows.length,
            rows: marketRows
          };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected db query in app test: ${sql}`);
      }
    });

    const [detailResponse, pricesResponse] = await Promise.all([
      fetch(`${baseUrl}/api/markets/next-prime-minister`),
      fetch(`${baseUrl}/api/markets/next-prime-minister/prices`)
    ]);
    const detailPayload = await detailResponse.json();
    const pricesPayload = await pricesResponse.json();

    expect(detailPayload.market).toMatchObject({
      marketStatus: "closed",
      result: {
        status: "closed"
      },
      lifecycle: {
        persistedStatus: "open",
        effectiveStatus: "closed",
        closeAt: "2026-06-22T18:00:00.000Z"
      }
    });
    expect(pricesPayload).toMatchObject({
      marketStatus: "closed",
      result: {
        status: "closed"
      },
      lifecycle: {
        persistedStatus: "open",
        effectiveStatus: "closed",
        closeAt: "2026-06-22T18:00:00.000Z"
      }
    });
  });

  it("filters public market trades by side, contract side, and outcome", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql.includes("from markets m")) {
          return {
            rowCount: 2,
            rows: [
              {
                market_id: "market_seed_next_prime_minister",
                market_status: "open",
                title: "מי יהיה ראש הממשלה הבא?",
                description: "שוק backend",
                category_key: "politics",
                open_at: new Date("2026-03-01T08:00:00.000Z"),
                close_at: new Date("2026-06-22T18:00:00.000Z"),
                published_at: new Date("2026-03-01T09:00:00.000Z"),
                updated_at: new Date("2026-03-29T09:00:00.000Z"),
                market_state_version: "12",
                liquidity_b: "100.00000000",
                outcome_count: 2,
                total_volume: "38.000000",
                outcome_id: "market_seed_next_prime_minister_outcome_option_a",
                outcome_label: "מועמד א'",
                outcome_short_label: "מועמד א'",
                q_shares: "10.000000",
                sort_order: 0,
                last_price: "0.61000000"
              },
              {
                market_id: "market_seed_next_prime_minister",
                market_status: "open",
                title: "מי יהיה ראש הממשלה הבא?",
                description: "שוק backend",
                category_key: "politics",
                open_at: new Date("2026-03-01T08:00:00.000Z"),
                close_at: new Date("2026-06-22T18:00:00.000Z"),
                published_at: new Date("2026-03-01T09:00:00.000Z"),
                updated_at: new Date("2026-03-29T09:00:00.000Z"),
                market_state_version: "12",
                liquidity_b: "100.00000000",
                outcome_count: 2,
                total_volume: "38.000000",
                outcome_id: "market_seed_next_prime_minister_outcome_option_b",
                outcome_label: "מועמד ב'",
                outcome_short_label: "מועמד ב'",
                q_shares: "0.000000",
                sort_order: 1,
                last_price: "0.39000000"
              }
            ]
          };
        }

        if (sql.includes("from trades t")) {
          expect(sql).toContain("t.side = $4");
          expect(sql).toContain("t.contract_side = $5");
          expect(sql).toContain("t.outcome_id = $6");
          expect(values).toEqual([
            "market_seed_next_prime_minister",
            3,
            null,
            "buy",
            "no",
            "market_seed_next_prime_minister_outcome_option_b"
          ]);

          return {
            rows: [
              {
                trade_id: "trade_no_b",
                created_at: new Date("2026-04-07T10:00:00.000Z"),
                side: "buy",
                contract_side: "no",
                requested_outcome_key: "option-b",
                cash_amount: "18.000000",
                share_amount: "20.000000",
                avg_price: "0.90000000",
                price_before: "0.88000000",
                price_after: "0.87000000",
                outcome_id: "market_seed_next_prime_minister_outcome_option_b",
                outcome_label: "מועמד ב'",
                execution_legs: []
              }
            ]
          };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected db query in app test: ${sql}`);
      }
    });

    const response = await fetch(
      `${baseUrl}/api/markets/next-prime-minister/trades?side=buy&contractSide=no&outcome=option-b&limit=3`
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.filters).toEqual({
      side: "buy",
      contractSide: "no",
      outcomeKey: "option-b"
    });
    expect(payload.trades).toEqual([
      expect.objectContaining({
        tradeId: "trade_no_b",
        side: "buy",
        contractSide: "no",
        outcomeKey: "option-b"
      })
    ]);
  });

  it("streams a one-shot market snapshot over server-sent events", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql.includes("from markets m")) {
          expect(values?.[0]).toBe("market_seed_next_prime_minister");

          return {
            rowCount: 2,
            rows: [
              {
                market_id: "market_seed_next_prime_minister",
                market_status: "open",
                title: "מי יהיה ראש הממשלה הבא?",
                description: "שוק backend",
                category_key: "politics",
                open_at: new Date("2026-03-01T08:00:00.000Z"),
                close_at: new Date("2026-06-22T18:00:00.000Z"),
                published_at: new Date("2026-03-01T09:00:00.000Z"),
                updated_at: new Date("2026-03-29T09:00:00.000Z"),
                market_state_version: "12",
                liquidity_b: "100.00000000",
                outcome_count: 2,
                total_volume: "38.000000",
                outcome_id: "market_seed_next_prime_minister_outcome_option_a",
                outcome_label: "מועמד א'",
                outcome_short_label: "מועמד א'",
                q_shares: "10.000000",
                sort_order: 0,
                last_price: "0.61000000"
              },
              {
                market_id: "market_seed_next_prime_minister",
                market_status: "open",
                title: "מי יהיה ראש הממשלה הבא?",
                description: "שוק backend",
                category_key: "politics",
                open_at: new Date("2026-03-01T08:00:00.000Z"),
                close_at: new Date("2026-06-22T18:00:00.000Z"),
                published_at: new Date("2026-03-01T09:00:00.000Z"),
                updated_at: new Date("2026-03-29T09:00:00.000Z"),
                market_state_version: "12",
                liquidity_b: "100.00000000",
                outcome_count: 2,
                total_volume: "38.000000",
                outcome_id: "market_seed_next_prime_minister_outcome_option_b",
                outcome_label: "מועמד ב'",
                outcome_short_label: "מועמד ב'",
                q_shares: "0.000000",
                sort_order: 1,
                last_price: "0.39000000"
              }
            ]
          };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected db query in app test: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/api/markets/next-prime-minister/stream?once=1`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(body).toContain("event: market.snapshot");
    expect(body).toContain('"marketKey":"next-prime-minister"');
    expect(body).toContain('"eventType":"snapshot"');
  });

  it("rate limits route families with a stable 429 shape", async () => {
    const rateLimiter = createInMemoryRateLimiter({
      market_read: {
        limit: 1,
        windowMs: 60_000
      }
    });
    const { baseUrl } = await startServer({
      rateLimiter,
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql.includes("from markets m")) {
          expect(values).toEqual(["open", null, 1, null]);

          return {
            rows: []
          };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected db query in app test: ${sql}`);
      }
    });

    const firstResponse = await fetch(`${baseUrl}/api/markets?limit=1`);
    const secondResponse = await fetch(`${baseUrl}/api/markets?limit=1`);
    const payload = await secondResponse.json();

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(429);
    expect(secondResponse.headers.get("retry-after")).toBe("60");
    expect(payload).toEqual({
      error: {
        code: "rate_limited",
        message: "Too many requests for this route family."
      },
      family: "market_read",
      retryAfterSeconds: 60
    });
  });

});
