import { describe, expect, it, vi } from "vitest";

import { readWeeklyLeaderboard } from "../../src/social/leaderboard-service";

describe("leaderboard service", () => {
  it("ranks by positive rolling PnL with minimum activity, display name, and profile link", async () => {
    const db = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        expect(sql.match(/u\.privacy_erased_at is null/g)).toHaveLength(3);
        expect(sql).toContain("(realized_pnl::numeric + open_mark_pnl::numeric) > 0");
        expect(values).toEqual([7, 3, 20]);
        return {
          rows: [
            {
              user_id: "user_alpha",
              handle: "user_a1b2c3d4",
              display_name: "Alpha Forecaster",
              realized_pnl: "12.500000",
              open_mark_pnl: "2.000000",
              resolved_count: 2,
              active_market_count: 1,
              market_count: 3
            },
            {
              user_id: "user_beta",
              handle: "user_b5c6d7e8",
              display_name: null,
              realized_pnl: "3.000000",
              open_mark_pnl: "-1.250000",
              resolved_count: 3,
              active_market_count: 0,
              market_count: 3
            }
          ]
        };
      })
    };

    const response = await readWeeklyLeaderboard(db);

    expect(response.windowDays).toBe(7);
    expect(response.minimumMarkets).toBe(3);
    expect(response.entries).toEqual([
      expect.objectContaining({
        rank: 1,
        displayName: "Alpha Forecaster",
        profileHref: "/@user_a1b2c3d4",
        weeklyPnl: "14.500000",
        resolvedCount: 2,
        activeMarketCount: 1
      }),
      expect.objectContaining({
        rank: 2,
        displayName: "חזאי B5C6D7E8",
        profileHref: "/@user_b5c6d7e8",
        weeklyPnl: "1.750000",
        resolvedCount: 3,
        activeMarketCount: 0
      })
    ]);
    expect(response.entries[0]).not.toHaveProperty("userId");
    expect(JSON.stringify(response)).not.toContain("user_alpha");
    expect(JSON.stringify(response)).not.toContain("user_beta");
  });

  it("clamps public knobs", async () => {
    const db = {
      query: vi.fn(async (_sql: string, values?: unknown[]) => {
        expect(values).toEqual([30, 1, 100]);
        return { rows: [] };
      })
    };

    const response = await readWeeklyLeaderboard(db, {
      windowDays: 900,
      minimumMarkets: -1,
      limit: 500
    });

    expect(response.entries).toEqual([]);
  });
});
