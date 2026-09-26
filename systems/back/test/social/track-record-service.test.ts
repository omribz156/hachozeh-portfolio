import { describe, expect, it, vi } from "vitest";

import { readUserTrackRecord } from "../../src/social/track-record-service";

describe("track record service", () => {
  it("computes accuracy from resolved wins/losses and category splits", async () => {
    const db = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes("from users") && sql.includes("privacy_erased_at")) {
          expect(values).toEqual(["alpha"]);
          return {
            rows: [
              {
                user_id: "user_alpha",
                handle: "alpha",
                display_name: "Alpha Forecaster"
              }
            ]
          };
        }

        if (sql.includes("group by m.category_key")) {
          expect(values).toEqual(["user_alpha"]);
          return {
            rows: [
              { category_key: "sports", resolved_count: 3, win_count: 2 },
              { category_key: null, resolved_count: 1, win_count: 0 }
            ]
          };
        }

        if (sql.includes("coalesce(m.resolved_at, re.created_at) as resolved_at")) {
          expect(values).toEqual(["user_alpha", 500]);
          expect(sql).toContain("limit $2");
          return {
            rows: [
              {
                market_id: "market_seed_next_prime_minister",
                market_title: "מי יהיה ראש הממשלה הבא?",
                type: "resolution_win",
                realized_pnl: "12.500000",
                resolved_at: new Date("2026-06-01T10:00:00.000Z")
              },
              {
                market_id: "market_seed_knesset_dissolution",
                market_title: "האם הכנסת תתפזר?",
                type: "resolution_win",
                realized_pnl: "25.250000",
                resolved_at: new Date("2026-06-02T10:00:00.000Z")
              },
              {
                market_id: "market_loss",
                market_title: "הפסד",
                type: "resolution_loss",
                realized_pnl: "-5.000000",
                resolved_at: new Date("2026-06-03T10:00:00.000Z")
              },
              {
                market_id: "market_win_after_loss",
                market_title: "ניצחון אחרי הפסד",
                type: "resolution_win",
                realized_pnl: "3.000000",
                resolved_at: new Date("2026-06-04T10:00:00.000Z")
              }
            ]
          };
        }

        expect(values).toEqual(["user_alpha"]);
        return {
          rows: [{ resolved_count: 4, win_count: 2 }]
        };
      })
    };

    const response = await readUserTrackRecord(db, "alpha");

    expect(response).not.toHaveProperty("userId");
    expect(response).toMatchObject({
      handle: "alpha",
      displayName: "Alpha Forecaster",
      accuracy: 0.5,
      resolvedCount: 4,
      categoryBreakdown: [
        { categoryKey: "sports", categoryLabel: "ספורט", accuracy: 0.6667, resolvedCount: 3 },
        { categoryKey: "uncategorized", categoryLabel: "כללי", accuracy: 0, resolvedCount: 1 }
      ],
      highlights: {
        longestWinStreak: 2,
        biggestWin: {
          amount: "25.250000",
          marketKey: "market_seed_knesset_dissolution",
          title: "האם הכנסת תתפזר?",
          resolvedAt: "2026-06-02T10:00:00.000Z"
        }
      }
    });
  });

  it("uses a stable hashed display fallback", async () => {
    const db = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes("from users") && sql.includes("privacy_erased_at")) {
          expect(values).toEqual(["alpha"]);
          return {
            rows: [
              {
                user_id: "user_alpha",
                handle: "alpha",
                display_name: null
              }
            ]
          };
        }

        if (sql.includes("group by m.category_key")) return { rows: [] };
        if (sql.includes("coalesce(m.resolved_at, re.created_at) as resolved_at")) return { rows: [] };
        return {
          rows: [{ resolved_count: 0, win_count: 0 }]
        };
      })
    };

    const response = await readUserTrackRecord(db, "alpha");

    expect(response.displayName).toMatch(/^חזאי [0-9A-F]{8}$/);
    expect(response.displayName).not.toBe("חוֹזֶה");
  });

  it("rejects track-record reads for missing or erased public users", async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from users") && sql.includes("privacy_erased_at")) {
          return { rows: [] };
        }

        throw new Error(`Unexpected query: ${sql}`);
      })
    };

    await expect(readUserTrackRecord(db, "user_empty")).rejects.toMatchObject({
      statusCode: 404,
      code: "user_not_found"
    });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it("rejects overlong user keys before querying", async () => {
    const db = {
      query: vi.fn()
    };

    await expect(readUserTrackRecord(db, "u".repeat(121))).rejects.toMatchObject({
      statusCode: 400,
      code: "invalid_request",
      message: "user key is too long."
    });
    expect(db.query).not.toHaveBeenCalled();
  });
});
