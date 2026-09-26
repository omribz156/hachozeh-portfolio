import { afterEach, describe, expect, it } from "vitest";

import { closeAppTestServers, startServer } from "./app-test-harness";

afterEach(async () => {
  await closeAppTestServers();
});

describe("social routes", () => {
  it("serves a public real profile without private identity fields", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql.includes("from users") && sql.includes("privacy_erased_at")) {
          expect(values).toEqual(["alpha"]);
          return {
            rows: [
              {
                user_id: "user_alpha",
                handle: "alpha",
                display_name: "Alpha Forecaster",
                bio: "Open profile",
                avatar_url: "/api/uploads/avatars/avatar-alpha.webp",
                showcase_categories: ["sports"],
                created_at: new Date("2026-06-01T10:00:00.000Z")
              }
            ]
          };
        }

        if (sql.includes("from user_social_links")) {
          expect(values).toEqual(["user_alpha"]);
          return {
            rows: [
              { platform: "x", url: "https://x.com/alpha" },
              { platform: "telegram", url: "https://t.me/privateignored" }
            ]
          };
        }

        if (sql.includes("successful_return_count")) {
          expect(values).toEqual(["user_alpha"]);
          return { rows: [{ successful_return_count: "10" }] };
        }

        if (sql.includes("from user_verification_tier_purchases")) {
          expect(values).toEqual(["user_alpha"]);
          return { rows: [{ tier: "gray", purchased_at: new Date("2026-06-02T10:00:00.000Z") }] };
        }

        if (sql.includes("follower_count") && sql.includes("profile_view_count")) {
          expect(values).toEqual(["user_alpha", null]);
          return {
            rows: [
              {
                follower_count: 1,
                following_count: 2,
                profile_view_count: 3,
                viewer_follows: null
              }
            ]
          };
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/api/social/users/alpha`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).not.toHaveProperty("userId");
    expect(payload).toMatchObject({
      handle: "alpha",
      displayName: "Alpha Forecaster",
      avatarUrl: "/api/uploads/avatars/avatar-alpha.webp",
      bio: "Open profile",
      verifiedTier: "gray",
      followerCount: 1,
      followingCount: 2,
      profileViewCount: 3,
      viewerFollows: null,
      viewerIsOwner: null,
      showcaseCategories: ["sports"],
      showcaseBadges: [],
      achievements: {
        status: "skeleton",
        sourceReference: "systems/design/to-integrate/achievements"
      }
    });
    expect(payload.socialLinks.x.url).toBe("https://x.com/alpha");
    expect(JSON.stringify(payload)).not.toContain("telegram");
    expect(JSON.stringify(payload)).not.toContain("identifierHint");
    expect(JSON.stringify(payload)).not.toContain("user_alpha");
    expect(JSON.stringify(payload)).not.toContain("@");
  });

  it("does not serve public profiles by raw internal user id", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        expect(sql).toContain("where handle = lower($1)");
        expect(values).toEqual(["user_alpha"]);
        return { rows: [] };
      }
    });

    const response = await fetch(`${baseUrl}/api/social/users/user_alpha`);
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error.code).toBe("user_not_found");
  });

  it("keeps follow writes session-only", async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/api/social/users/user_alpha/follow`, {
      method: "POST"
    });
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error.code).toBe("unauthorized");
  });

  it("serves weekly leaderboard entries without private identity fields", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        expect(sql).toContain("recent_realized");
        expect(sql.match(/u\.privacy_erased_at is null/g)).toHaveLength(3);
        expect(values).toEqual([7, 3, 20]);
        return {
          rows: [
            {
              user_id: "user_alpha",
              handle: "user_a1b2c3d4",
              display_name: "Alpha Forecaster",
              realized_pnl: "10.000000",
              open_mark_pnl: "2.250000",
              resolved_count: 2,
              active_market_count: 1,
              market_count: 3
            }
          ]
        };
      }
    });

    const response = await fetch(`${baseUrl}/api/social/leaderboard/weekly`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.entries).toHaveLength(1);
    expect(payload.entries[0]).toMatchObject({
      rank: 1,
      displayName: "Alpha Forecaster",
      profileHref: "/@user_a1b2c3d4",
      weeklyPnl: "12.250000",
      resolvedCount: 2,
      activeMarketCount: 1
    });
    expect(payload.entries[0]).not.toHaveProperty("userId");
    expect(JSON.stringify(payload)).not.toContain("user_alpha");
  });

  it("serves public user track record", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
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
              { category_key: "sports", resolved_count: 2, win_count: 1 }
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
                realized_pnl: "9.000000",
                resolved_at: new Date("2026-06-01T10:00:00.000Z")
              }
            ]
          };
        }

        expect(values).toEqual(["user_alpha"]);
        return {
          rows: [{ resolved_count: 4, win_count: 3 }]
        };
      }
    });

    const response = await fetch(`${baseUrl}/api/social/users/alpha/track-record`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).not.toHaveProperty("userId");
    expect(payload).toMatchObject({
      handle: "alpha",
      displayName: "Alpha Forecaster",
      accuracy: 0.75,
      resolvedCount: 4,
      categoryBreakdown: [
        { categoryKey: "sports", categoryLabel: "ספורט", accuracy: 0.5, resolvedCount: 2 }
      ],
      highlights: {
        longestWinStreak: 1,
        biggestWin: {
          amount: "9.000000",
          marketKey: "next-prime-minister",
          title: "מי יהיה ראש הממשלה הבא?",
          resolvedAt: "2026-06-01T10:00:00.000Z"
        }
      }
    });
    expect(JSON.stringify(payload)).not.toContain("user_alpha");
  });

  it("returns 404 for missing public user track records without querying realization rows", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        expect(values).toEqual(["missing_user"]);

        if (sql.includes("from users") && sql.includes("privacy_erased_at")) {
          return { rows: [] };
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/api/social/users/missing_user/track-record`);
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error.code).toBe("user_not_found");
  });
});
