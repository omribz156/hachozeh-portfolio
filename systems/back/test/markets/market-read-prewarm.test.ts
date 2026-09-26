import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import {
  prewarmTrendingMarketReads,
  readMarketReadPrewarmRuntimeConfig,
  type MarketReadPrewarmOptions
} from "../../src/markets/market-read-prewarm";

function createPool(): Pool {
  return { query: vi.fn() } as unknown as Pool;
}

function createFeed(items: Array<{ marketKey: string; marketStatus?: string }>) {
  return {
    feed: "trending",
    category: null,
    generatedAt: new Date("2026-06-09T10:00:00.000Z").toISOString(),
    featured: null,
    items: items.map((item) => ({
      marketKey: item.marketKey,
      marketStatus: item.marketStatus ?? "open"
    }))
  } as Awaited<ReturnType<NonNullable<MarketReadPrewarmOptions["readFeed"]>>>;
}

describe("market read prewarm", () => {
  it("warms top open trending market-detail and 1D history reads", async () => {
    const dbPool = createPool();
    const readFeed = vi.fn(async () =>
      createFeed([
        { marketKey: "market-a" },
        { marketKey: "closed-market", marketStatus: "resolved" },
        { marketKey: "market-b" },
        { marketKey: "market-c" }
      ])
    );
    const readMarketDetail = vi.fn(async () => ({ snapshot: {} }));
    const readHistory = vi.fn(async () => ({ points: [] }));

    const report = await prewarmTrendingMarketReads(dbPool, {
      limit: 2,
      readFeed,
      readMarketDetail,
      readHistory
    });

    expect(readFeed).toHaveBeenCalledWith(dbPool, { feed: "trending" });
    expect(readMarketDetail).toHaveBeenCalledTimes(2);
    expect(readMarketDetail).toHaveBeenNthCalledWith(1, dbPool, "market-a");
    expect(readMarketDetail).toHaveBeenNthCalledWith(2, dbPool, "market-b");
    expect(readHistory).toHaveBeenCalledTimes(2);
    expect(readHistory).toHaveBeenNthCalledWith(1, dbPool, "market-a", { range: "1D" });
    expect(readHistory).toHaveBeenNthCalledWith(2, dbPool, "market-b", { range: "1D" });
    expect(report.selectedMarkets).toEqual(["market-a", "market-b"]);
    expect(report.marketDetail.warmed).toBe(2);
    expect(report.history.warmed).toBe(2);
    expect(report.failures).toEqual([]);
  });

  it("records per-target failures and keeps warming the rest", async () => {
    const dbPool = createPool();
    const readFeed = vi.fn(async () => createFeed([{ marketKey: "market-a" }, { marketKey: "market-b" }]));
    const readMarketDetail = vi.fn(async (_pool: Pool, marketKey: string) => {
      if (marketKey === "market-a") {
        throw new Error("detail dragon");
      }

      return { snapshot: {} };
    });
    const readHistory = vi.fn(async (_pool: Pool, marketKey: string) => {
      if (marketKey === "market-b") {
        throw new Error("history goblin");
      }

      return { points: [] };
    });

    const report = await prewarmTrendingMarketReads(dbPool, {
      historyRange: "6h",
      readFeed,
      readMarketDetail,
      readHistory
    });

    expect(report.marketDetail).toEqual({ attempted: 2, warmed: 1 });
    expect(report.history).toEqual({ range: "6H", attempted: 2, warmed: 1 });
    expect(report.failures).toEqual([
      {
        marketKey: "market-a",
        target: "market_detail",
        error: "detail dragon"
      },
      {
        marketKey: "market-b",
        target: "history",
        error: "history goblin"
      }
    ]);
  });

  it("reads runtime env toggles with safe defaults", () => {
    expect(readMarketReadPrewarmRuntimeConfig({}, "development")).toEqual({
      enabled: false,
      limit: 6,
      historyRange: "1D"
    });
    expect(
      readMarketReadPrewarmRuntimeConfig(
        {
          BACKEND_PREWARM_TRENDING_READS: "false",
          BACKEND_PREWARM_TRENDING_LIMIT: "200",
          BACKEND_PREWARM_HISTORY_RANGE: "1w"
        },
        "production"
      )
    ).toEqual({
      enabled: false,
      limit: 25,
      historyRange: "1W"
    });
    expect(readMarketReadPrewarmRuntimeConfig({}, "test").enabled).toBe(false);
  });
});
