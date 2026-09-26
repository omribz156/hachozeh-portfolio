import { describe, expect, it, vi } from "vitest";

import type { Queryable } from "../../../src/db/client/pool";
import type { AppEnv } from "../../../src/config/env";
import { readMarketHistory } from "../../../src/markets/market-history/market-history-service";
import { composePortfolioMarkSeries } from "../../../src/engine/portfolio/portfolio-mark-series";

vi.mock("../../../src/markets/market-history/market-history-service", () => ({
  readMarketHistory: vi.fn()
}));

describe("composePortfolioMarkSeries", () => {
  it("replays share history so buys and sells only affect later buckets", async () => {
    vi.mocked(readMarketHistory).mockResolvedValue({
      marketKey: "next-prime-minister",
      range: "1D",
      interval: "6h",
      resolutionSeconds: 6 * 60 * 60,
      sampleQuality: "active",
      source: {
        kind: "derived_from_trades",
        persistedCandles: false
      },
      outcomes: [],
      points: [],
      seriesByOutcome: [
        {
          outcomeKey: "option-a",
          outcomeLabel: "מועמד א'",
          points: [
            { t: Date.parse("2026-05-27T12:00:00.000Z") / 1000, value: 0.4 },
            { t: Date.parse("2026-05-30T00:00:00.000Z") / 1000, value: 0.5 },
            { t: Date.parse("2026-05-30T06:00:00.000Z") / 1000, value: 0.6 },
            { t: Date.parse("2026-05-30T12:00:00.000Z") / 1000, value: 0.7 }
          ]
        }
      ],
      movementByOutcome: {},
      pagination: {
        limit: 500,
        truncated: false
      }
    });

    const db: Queryable = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from positions")) {
          return {
            rows: [
              {
                market_id: "market_seed_next_prime_minister",
                outcome_id: "market_seed_next_prime_minister_outcome_option_a",
                shares: "5.000000",
                cost_basis: "2.000000",
                current_price: "0.70000000"
              }
            ]
          };
        }

        if (sql.includes("with event_rows")) {
          return {
            rows: [
              {
                happened_at: new Date("2026-05-30T03:00:00.000Z"),
                market_id: "market_seed_next_prime_minister",
                outcome_id: "market_seed_next_prime_minister_outcome_option_a",
                share_delta: "10.000000",
                cost_basis_delta: "4.000000"
              },
              {
                happened_at: new Date("2026-05-30T09:00:00.000Z"),
                market_id: "market_seed_next_prime_minister",
                outcome_id: "market_seed_next_prime_minister_outcome_option_a",
                share_delta: "-5.000000",
                cost_basis_delta: "-2.000000"
              }
            ]
          };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected query: ${sql}`);
      }) as Queryable["query"]
    };

    const points = await composePortfolioMarkSeries(
      db,
      {} as AppEnv,
      "user_live_1",
      {
        actorMode: "session",
        asOf: "2026-05-30T12:00:00.000Z",
        summary: {
          availableCash: "0.000000",
          portfolioValue: "3.500000",
          totalAccountValue: "3.500000",
          realizedPnl: "0.000000",
          unrealizedPnl: "0.000000",
          openPositionsCount: 1
        },
        positions: [],
        contractPositions: []
      },
      "1D"
    );

    expect(points).toEqual([
      { at: "2026-05-29T12:00:00.000Z", markValue: "0.000000", costBasisValue: "0.000000" },
      { at: "2026-05-30T00:00:00.000Z", markValue: "0.000000", costBasisValue: "0.000000" },
      { at: "2026-05-30T03:00:00.000Z", markValue: "5.000000", costBasisValue: "4.000000" },
      { at: "2026-05-30T06:00:00.000Z", markValue: "6.000000", costBasisValue: "4.000000" },
      { at: "2026-05-30T09:00:00.000Z", markValue: "3.000000", costBasisValue: "2.000000" },
      { at: "2026-05-30T12:00:00.000Z", markValue: "3.500000", costBasisValue: "2.000000" }
    ]);
    expect(readMarketHistory).toHaveBeenCalledWith(
      db,
      "next-prime-minister",
      {
        range: "1D"
      }
    );
    const positionSql = vi.mocked(db.query).mock.calls
      .map(([sql]) => String(sql))
      .find((sql) => sql.includes("from positions p"));
    expect(positionSql).toContain("p.settled_at is null");
    expect(positionSql).toContain("m.status not in ('resolved', 'voided')");
  });

  it("moves held-position mark value when market price history moves without user trades", async () => {
    vi.mocked(readMarketHistory).mockResolvedValue({
      marketKey: "next-prime-minister",
      range: "1D",
      interval: "6h",
      resolutionSeconds: 6 * 60 * 60,
      sampleQuality: "active",
      source: {
        kind: "derived_from_trades",
        persistedCandles: false
      },
      outcomes: [],
      points: [],
      seriesByOutcome: [
        {
          outcomeKey: "option-a",
          outcomeLabel: "מועמד א'",
          points: [
            { t: Date.parse("2026-05-30T00:00:00.000Z") / 1000, value: 0.5 },
            { t: Date.parse("2026-05-30T06:00:00.000Z") / 1000, value: 0.62 },
            { t: Date.parse("2026-05-30T12:00:00.000Z") / 1000, value: 0.7 }
          ]
        }
      ],
      movementByOutcome: {},
      pagination: {
        limit: 500,
        truncated: false
      }
    });

    const db: Queryable = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from positions")) {
          return {
            rows: [
              {
                market_id: "market_seed_next_prime_minister",
                outcome_id: "market_seed_next_prime_minister_outcome_option_a",
                shares: "10.000000",
                cost_basis: "5.000000",
                current_price: "0.70000000"
              }
            ]
          };
        }

        if (sql.includes("with event_rows")) {
          return {
            rows: [
              {
                happened_at: new Date("2026-05-29T06:00:00.000Z"),
                market_id: "market_seed_next_prime_minister",
                outcome_id: "market_seed_next_prime_minister_outcome_option_a",
                share_delta: "10.000000",
                cost_basis_delta: "5.000000"
              }
            ]
          };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected query: ${sql}`);
      }) as Queryable["query"]
    };

    const points = await composePortfolioMarkSeries(
      db,
      {} as AppEnv,
      "user_live_1",
      {
        actorMode: "session",
        asOf: "2026-05-30T12:00:00.000Z",
        summary: {
          availableCash: "0.000000",
          portfolioValue: "7.000000",
          totalAccountValue: "7.000000",
          realizedPnl: "0.000000",
          unrealizedPnl: "2.000000",
          openPositionsCount: 1
        },
        positions: [],
        contractPositions: []
      },
      "1D"
    );

    expect(points).toEqual([
      { at: "2026-05-29T12:00:00.000Z", markValue: "5.000000", costBasisValue: "5.000000" },
      { at: "2026-05-30T00:00:00.000Z", markValue: "5.000000", costBasisValue: "5.000000" },
      { at: "2026-05-30T06:00:00.000Z", markValue: "6.200000", costBasisValue: "5.000000" },
      { at: "2026-05-30T12:00:00.000Z", markValue: "7.000000", costBasisValue: "5.000000" }
    ]);
  });

  it("does not let old resolved-market history create buckets outside a non-all window", async () => {
    vi.mocked(readMarketHistory).mockResolvedValue({
      marketKey: "resolved-old-market",
      range: "1D",
      interval: "6h",
      resolutionSeconds: 6 * 60 * 60,
      sampleQuality: "closed",
      source: {
        kind: "derived_from_trades",
        persistedCandles: false
      },
      outcomes: [],
      points: [],
      seriesByOutcome: [
        {
          outcomeKey: "option-a",
          outcomeLabel: "מועמד א'",
          points: [
            { t: Date.parse("2026-05-27T09:20:00.000Z") / 1000, value: 0.55 },
            { t: Date.parse("2026-05-27T10:54:00.000Z") / 1000, value: 1 }
          ]
        }
      ],
      movementByOutcome: {},
      pagination: {
        limit: 500,
        truncated: false
      }
    });

    const db: Queryable = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from positions")) {
          return {
            rows: [
              {
                market_id: "market_seed_next_prime_minister",
                outcome_id: "market_seed_next_prime_minister_outcome_option_a",
                shares: "5.000000",
                cost_basis: "2.000000",
                current_price: "1.00000000"
              }
            ]
          };
        }

        if (sql.includes("with event_rows")) {
          return { rows: [] };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected query: ${sql}`);
      }) as Queryable["query"]
    };

    const points = await composePortfolioMarkSeries(
      db,
      {} as AppEnv,
      "user_live_1",
      {
        actorMode: "session",
        asOf: "2026-05-30T12:00:00.000Z",
        summary: {
          availableCash: "0.000000",
          portfolioValue: "5.000000",
          totalAccountValue: "5.000000",
          realizedPnl: "0.000000",
          unrealizedPnl: "0.000000",
          openPositionsCount: 1
        },
        positions: [],
        contractPositions: []
      },
      "1D"
    );

    expect(points).toEqual([
      {
        at: "2026-05-29T12:00:00.000Z",
        markValue: "5.000000",
        costBasisValue: "2.000000"
      },
      {
        at: "2026-05-30T12:00:00.000Z",
        markValue: "5.000000",
        costBasisValue: "2.000000"
      }
    ]);
  });

	  it("reconstructs all-range mark and cost basis for fully closed exposure", async () => {
    vi.mocked(readMarketHistory).mockResolvedValue({
      marketKey: "next-prime-minister",
      range: "all",
      interval: "adaptive",
      resolutionSeconds: 60 * 60,
      sampleQuality: "active",
      source: {
        kind: "derived_from_trades",
        persistedCandles: false
      },
      outcomes: [],
      points: [],
      seriesByOutcome: [
        {
          outcomeKey: "option-a",
          outcomeLabel: "מועמד א'",
          points: [
            { t: Date.parse("2026-05-30T00:00:00.000Z") / 1000, value: 0.5 },
            { t: Date.parse("2026-05-30T06:00:00.000Z") / 1000, value: 0.7 },
            { t: Date.parse("2026-05-30T12:00:00.000Z") / 1000, value: 0.8 }
          ]
        }
      ],
      movementByOutcome: {},
      pagination: {
        limit: 500,
        truncated: false
      }
    });

    const db: Queryable = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from positions")) {
          return { rows: [] };
        }

        if (sql.includes("with event_rows")) {
          return {
            rows: [
              {
                happened_at: new Date("2026-05-30T03:00:00.000Z"),
                market_id: "market_seed_next_prime_minister",
                outcome_id: "market_seed_next_prime_minister_outcome_option_a",
                share_delta: "10.000000",
                cost_basis_delta: "4.000000"
              },
              {
                happened_at: new Date("2026-05-30T09:00:00.000Z"),
                market_id: "market_seed_next_prime_minister",
                outcome_id: "market_seed_next_prime_minister_outcome_option_a",
                share_delta: "-10.000000",
                cost_basis_delta: "-4.000000"
              }
            ]
          };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected query: ${sql}`);
      }) as Queryable["query"]
    };

    const points = await composePortfolioMarkSeries(
      db,
      {} as AppEnv,
      "user_live_1",
      {
        actorMode: "session",
        asOf: "2026-05-30T12:00:00.000Z",
        summary: {
          availableCash: "0.000000",
          portfolioValue: "0.000000",
          totalAccountValue: "0.000000",
          realizedPnl: "0.000000",
          unrealizedPnl: "0.000000",
          openPositionsCount: 0
        },
        positions: [],
        contractPositions: []
      },
      "all"
    );

	    expect(points).toEqual([
	      { at: "2026-05-30T00:00:00.000Z", markValue: "0.000000", costBasisValue: "0.000000" },
	      { at: "2026-05-30T03:00:00.000Z", markValue: "5.000000", costBasisValue: "4.000000" },
	      { at: "2026-05-30T06:00:00.000Z", markValue: "7.000000", costBasisValue: "4.000000" },
	      { at: "2026-05-30T09:00:00.000Z", markValue: "0.000000", costBasisValue: "0.000000" },
	      { at: "2026-05-30T12:00:00.000Z", markValue: "0.000000", costBasisValue: "0.000000" }
	    ]);
	  });

  it("clips resolved-market tracks at resolved_at instead of carrying shares forward", async () => {
    vi.mocked(readMarketHistory).mockResolvedValue({
      marketKey: "resolved-old-market",
      range: "all",
      interval: "adaptive",
      resolutionSeconds: 60 * 60,
      sampleQuality: "closed",
      source: {
        kind: "derived_from_trades",
        persistedCandles: false
      },
      outcomes: [],
      points: [],
      seriesByOutcome: [
        {
          outcomeKey: "option-a",
          outcomeLabel: "מועמד א'",
          points: [
            { t: Date.parse("2026-05-30T00:00:00.000Z") / 1000, value: 0.5 },
            { t: Date.parse("2026-05-30T06:00:00.000Z") / 1000, value: 0.7 },
            { t: Date.parse("2026-05-30T12:00:00.000Z") / 1000, value: 0.9 }
          ]
        }
      ],
      movementByOutcome: {},
      pagination: {
        limit: 500,
        truncated: false
      }
    });

    const db: Queryable = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from positions")) {
          return { rows: [] };
        }

        if (sql.includes("with event_rows")) {
          expect(sql).toContain("m.resolved_at as terminal_at");
          return {
            rows: [
              {
                happened_at: new Date("2026-05-30T03:00:00.000Z"),
                market_id: "market_seed_next_prime_minister",
                outcome_id: "market_seed_next_prime_minister_outcome_option_a",
                share_delta: "10.000000",
                cost_basis_delta: "4.000000",
                terminal_at: new Date("2026-05-30T09:00:00.000Z")
              }
            ]
          };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected query: ${sql}`);
      }) as Queryable["query"]
    };

    const points = await composePortfolioMarkSeries(
      db,
      {} as AppEnv,
      "user_live_1",
      {
        actorMode: "session",
        asOf: "2026-05-30T12:00:00.000Z",
        summary: {
          availableCash: "0.000000",
          portfolioValue: "0.000000",
          totalAccountValue: "0.000000",
          realizedPnl: "0.000000",
          unrealizedPnl: "0.000000",
          openPositionsCount: 0
        },
        positions: [],
        contractPositions: []
      },
      "all"
    );

    expect(points).toEqual([
      { at: "2026-05-30T00:00:00.000Z", markValue: "0.000000", costBasisValue: "0.000000" },
      { at: "2026-05-30T03:00:00.000Z", markValue: "5.000000", costBasisValue: "4.000000" },
      { at: "2026-05-30T06:00:00.000Z", markValue: "7.000000", costBasisValue: "4.000000" },
      { at: "2026-05-30T09:00:00.000Z", markValue: "7.000000", costBasisValue: "4.000000" }
    ]);
  });

	  it("filters voided-market deltas out of portfolio mark reconstruction", async () => {
	    vi.mocked(readMarketHistory).mockClear();
	    const db: Queryable = {
	      query: vi.fn(async (sql: string) => {
	        if (sql.includes("from positions")) {
	          return { rows: [] };
	        }

	        if (sql.includes("with event_rows")) {
	          expect(sql).toContain("join markets m");
	          expect(sql).toContain("m.status <> 'voided'");
	          return { rows: [] };
	        }

	        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
	          return { rows: [], rowCount: 0 };
	        }
	        throw new Error(`Unexpected query: ${sql}`);
	      }) as Queryable["query"]
	    };

	    const points = await composePortfolioMarkSeries(
	      db,
	      {} as AppEnv,
	      "user_live_1",
	      {
	        actorMode: "session",
	        asOf: "2026-06-17T12:00:00.000Z",
	        summary: {
	          availableCash: "0.000000",
	          portfolioValue: "0.000000",
	          totalAccountValue: "0.000000",
	          realizedPnl: "0.000000",
	          unrealizedPnl: "0.000000",
	          openPositionsCount: 0
	        },
	        positions: [],
	        contractPositions: []
	      },
	      "1W"
	    );

	    expect(points).toEqual([]);
	    expect(readMarketHistory).not.toHaveBeenCalled();
	  });
	});
