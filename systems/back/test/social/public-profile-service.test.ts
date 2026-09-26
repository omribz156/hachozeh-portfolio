import { describe, expect, it, vi } from "vitest";

import type { Queryable } from "../../src/db/client/pool";
import {
  followPublicUser,
  readPublicProfileCatalog,
  readPublicProfilePositions,
  readPublicProfileRecord,
  readPublicUserProfile,
  unfollowPublicUser
} from "../../src/social/public-profile-service";

function createQueryable(options?: {
  socialRows?: Array<{ platform: string; url: string }>;
  avatarUrl?: string | null;
  displayName?: string | null;
  handle?: string;
  positionRows?: Array<Record<string, unknown>>;
  recordRows?: Array<Record<string, unknown>>;
}) {
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.includes("from users") && sql.includes("privacy_erased_at")) {
      const handle = options?.handle ?? "navitester";
      expect(values?.[0]).toBe(handle);
      return {
        rows: [
          {
            user_id: "user_public",
            handle,
            display_name: options && Object.prototype.hasOwnProperty.call(options, "displayName")
              ? options.displayName
              : "Navi Tester",
            bio: "Public proof",
            avatar_url: options?.avatarUrl ?? "/api/uploads/avatars/avatar-public.webp",
            showcase_categories: ["sports", "politics"],
            created_at: new Date("2026-06-01T10:00:00.000Z")
          }
        ]
      };
    }

    if (sql.includes("from user_social_links")) {
      expect(values).toEqual(["user_public"]);
      return {
        rows: options?.socialRows ?? [
          { platform: "x", url: "https://x.com/navitester" },
          { platform: "telegram", url: "https://t.me/privateignored" },
          { platform: "website", url: "https://example.com/" }
        ]
      };
    }

    if (sql.includes("from realization_events") && sql.includes("successful_return_count")) {
      return { rows: [{ successful_return_count: "21" }] };
    }

    if (sql.includes("from user_verification_tier_purchases")) {
      return {
        rows: [
          { tier: "gray", purchased_at: new Date("2026-06-02T10:00:00.000Z") },
          { tier: "gold", purchased_at: new Date("2026-06-03T10:00:00.000Z") }
        ]
      };
    }

    if (sql.includes("insert into user_profile_views_daily")) {
      expect(values).toEqual(["user_public", "viewer_1"]);
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes("follower_count") && sql.includes("profile_view_count")) {
      expect(sql).toContain("coalesce(sum(upv.view_count), 0)::int");
      expect(values).toEqual(["user_public", "viewer_1"]);
      return {
        rows: [
          {
            follower_count: 7,
            following_count: 4,
            profile_view_count: 12,
            viewer_follows: true
          }
        ]
      };
    }

    if (sql.includes("insert into user_follows")) {
      expect(values).toEqual(["viewer_1", "user_public"]);
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes("delete from user_follows")) {
      expect(values).toEqual(["viewer_1", "user_public"]);
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes("from contract_positions cp")) {
      expect(values).toEqual(["user_public", 3]);
      return {
        rows: options?.positionRows ?? [
          {
            market_id: "market_seed_next_prime_minister",
            market_title: "מי יהיה ראש הממשלה הבא?",
            category_key: "politics",
            market_contract: {
              objectType: "market_contract_v1",
              image: {
                src: "/assets/images/market-buckets/politics.svg",
                alt: "פוליטיקה",
                rights: {
                  publicUse: "allowed",
                  status: "hachozeh-owned"
                }
              }
            },
            requested_outcome_id: "market_seed_next_prime_minister_outcome_option_a",
            requested_outcome_label: "מועמד א",
            outcome_count: 4,
            complement_outcome_label: "מועמד ב",
            contract_side: "yes",
            shares: "10.000000",
            cost_basis: "4.000000",
            current_price: "0.60000000"
          }
        ]
      };
    }

    if (sql.includes("from realization_events re") && sql.includes("resolution_win")) {
      expect(values).toEqual(["user_public", 3]);
      return {
        rows: options?.recordRows ?? [
          {
            realization_id: "real_1",
            created_at: new Date("2026-06-10T12:00:00.000Z"),
            type: "resolution_win",
            shares_closed: "10.000000",
            proceeds: "10.000000",
            removed_cost_basis: "4.000000",
            realized_pnl: "6.000000",
            market_id: "market_seed_next_prime_minister",
            market_title: "מי יהיה ראש הממשלה הבא?",
            category_key: "politics",
            market_contract: {
              objectType: "market_contract_v1",
              image: {
                src: "/assets/images/market-buckets/politics.svg",
                alt: "פוליטיקה",
                rights: {
                  publicUse: "allowed",
                  status: "hachozeh-owned"
                }
              }
            },
            outcome_id: "market_seed_next_prime_minister_outcome_option_a",
            outcome_label: "מועמד א"
          }
        ]
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  return { query } as unknown as Queryable;
}

describe("public profile service", () => {
  it("reads a public-safe real profile and counts a distinct signed-in view", async () => {
    const payload = await readPublicUserProfile(createQueryable(), "navitester", {
      viewerUserId: "viewer_1",
      countView: true
    });

    expect(payload).not.toHaveProperty("userId");
    expect(payload).toMatchObject({
      handle: "navitester",
      displayName: "Navi Tester",
      avatarUrl: "/api/uploads/avatars/avatar-public.webp",
      bio: "Public proof",
      verifiedTier: "gold",
      followerCount: 7,
      followingCount: 4,
      profileViewCount: 12,
      viewerFollows: true,
      viewerIsOwner: false,
      showcaseCategories: ["sports", "politics"],
      showcaseBadges: [],
      achievements: {
        status: "skeleton",
        sourceReference: "systems/design/to-integrate/achievements"
      }
    });
    expect(payload.socialLinks.x?.url).toBe("https://x.com/navitester");
    expect(payload.socialLinks.website?.url).toBe("https://example.com/");
    expect(JSON.stringify(payload)).not.toContain("telegram");
    expect(JSON.stringify(payload)).not.toContain("@");
  });

  it("uses a stable hashed display fallback instead of a generic fallback", async () => {
    const payload = await readPublicUserProfile(
      createQueryable({
        displayName: null,
        handle: "user_f3962d15"
      }),
      "user_f3962d15",
      {
        viewerUserId: "viewer_1",
        countView: true
      }
    );

    expect(payload.displayName).toBe("חזאי F3962D15");
    expect(payload.displayName).not.toBe("חוֹזֶה");
  });

  it("does not resolve public profiles by raw internal user id", async () => {
    const db = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        expect(sql).toContain("where handle = lower($1)");
        expect(values).toEqual(["user_public"]);
        return { rows: [] };
      })
    } as unknown as Queryable;

    await expect(readPublicUserProfile(db, "user_public")).rejects.toMatchObject({
      statusCode: 404,
      code: "user_not_found"
    });
  });

  it("reads a profile catalog page without a total by default", async () => {
    const db = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        expect(sql).toContain("from users");
        expect(sql).toContain("status = 'active'");
        expect(sql).toContain("order by handle asc");
        expect(values).toEqual([null, 1001, 0]);
        return {
          rows: [
            {
              user_id: "user_a",
              handle: "alice",
              display_name: "Alice",
              updated_at: new Date("2026-07-01T00:00:00.000Z"),
              created_at: new Date("2026-06-01T00:00:00.000Z")
            }
          ]
        };
      })
    } as unknown as Queryable;

    const payload = await readPublicProfileCatalog(db, {});

    expect(db.query).toHaveBeenCalledTimes(1);
    expect(payload.profiles).toEqual([
      { handle: "alice", displayName: "Alice", updatedAt: "2026-07-01T00:00:00.000Z" }
    ]);
    expect(payload.pagination).toEqual({ limit: 1000, nextCursor: null });
    expect(payload.pagination.total).toBeUndefined();
  });

  it("includes a total count only when includeTotal is requested, via one extra count query", async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("count(*)")) {
          expect(sql).toContain("status = 'active'");
          expect(sql).toContain("privacy_erased_at is null");
          return { rows: [{ count: "14143" }] };
        }
        return {
          rows: [
            {
              user_id: "user_a",
              handle: "alice",
              display_name: "Alice",
              updated_at: null,
              created_at: new Date("2026-06-01T00:00:00.000Z")
            }
          ]
        };
      })
    } as unknown as Queryable;

    const payload = await readPublicProfileCatalog(db, { includeTotal: true });

    // one catalog page query + one count(*) query — never a full-catalog walk
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(payload.pagination.total).toBe(14143);
  });

  it("caps the catalog page at the shared per-chunk limit and hands back a cursor when more remain", async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => ({
      user_id: `user_${i}`,
      handle: `handle${String(i).padStart(4, "0")}`,
      display_name: null,
      updated_at: null,
      created_at: new Date("2026-06-01T00:00:00.000Z")
    }));
    const db = {
      query: vi.fn(async () => ({ rows }))
    } as unknown as Queryable;

    const payload = await readPublicProfileCatalog(db, {});

    expect(payload.profiles).toHaveLength(1000);
    expect(payload.pagination.nextCursor).toBe("handle0999");
  });

  it("fetches a sitemap-index chunk directly via offset, without a cursor walk", async () => {
    const db = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        expect(sql).toContain("order by handle asc");
        expect(sql).toContain("offset $3");
        // offset wins over any stray cursor — direct chunk-N addressing never
        // depends on having walked chunks 0..N-1 first
        expect(values).toEqual([null, 1001, 2000]);
        return { rows: [] };
      })
    } as unknown as Queryable;

    await readPublicProfileCatalog(db, { offset: 2000, cursor: "someone" });

    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it("drops unsafe stored social URLs from public profiles", async () => {
    const payload = await readPublicUserProfile(
      createQueryable({
        socialRows: [
          { platform: "x", url: "javascript:alert(1)" },
          { platform: "instagram", url: "data:text/html,boom" },
          { platform: "website", url: "http://example.com/" }
        ]
      }),
      "navitester",
      {
        viewerUserId: "viewer_1",
        countView: true
      }
    );

    expect(payload.socialLinks.x).toBeNull();
    expect(payload.socialLinks.instagram).toBeNull();
    expect(payload.socialLinks.website).toBeNull();
  });

  it("drops unsafe stored avatar URLs from public profiles", async () => {
    const payload = await readPublicUserProfile(
      createQueryable({
        avatarUrl: "https://evil.example/avatar.webp"
      }),
      "navitester",
      {
        viewerUserId: "viewer_1",
        countView: true
      }
    );

    expect(payload.avatarUrl).toBeNull();
  });

  it("drops stored avatar URLs that expose obvious internal user ids", async () => {
    const payload = await readPublicUserProfile(
      createQueryable({
        avatarUrl: "/api/uploads/avatars/user_public.webp"
      }),
      "navitester",
      {
        viewerUserId: "viewer_1",
        countView: true
      }
    );

    expect(payload.avatarUrl).toBeNull();
  });

  it("follows and unfollows idempotently through the public graph", async () => {
    const follow = await followPublicUser(createQueryable(), "navitester", "viewer_1");
    const unfollow = await unfollowPublicUser(createQueryable(), "navitester", "viewer_1");

    expect(follow).not.toHaveProperty("userId");
    expect(unfollow).not.toHaveProperty("userId");
    expect(follow).toEqual({
      handle: "navitester",
      following: true,
      followerCount: 7
    });
    expect(unfollow).toEqual({
      handle: "navitester",
      following: false,
      followerCount: 7
    });
  });

  it("rejects self-follow", async () => {
    await expect(
      followPublicUser(createQueryable(), "navitester", "user_public")
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "invalid_request"
    });
  });

  it("reads capped public-safe open positions", async () => {
    const payload = await readPublicProfilePositions(createQueryable(), "navitester", {
      limit: "2"
    });

    expect(payload).not.toHaveProperty("userId");
    expect(payload.positions).toEqual([
      {
        marketKey: "next-prime-minister",
        title: "מי יהיה ראש הממשלה הבא?",
        image: {
          src: "/assets/images/market-buckets/politics.svg",
          alt: "פוליטיקה"
        },
        outcomeLabel: "מועמד א",
        contractSide: "yes",
        side: "buy",
        contracts: "10.000000",
        avgPrice: "0.40000000",
        currentPrice: "0.60000000",
        value: "6.000000",
        pnlPct: "50.000000"
      }
    ]);
  });

  it("shows the complement label for binary no positions", async () => {
    const payload = await readPublicProfilePositions(
      createQueryable({
        positionRows: [
          {
            market_id: "market_binary_pm_lapid",
            market_title: "האם יאיר לפיד יהיה ראש הממשלה?",
            category_key: "politics",
            market_contract: null,
            requested_outcome_id: "yes",
            requested_outcome_label: "כן",
            outcome_count: 2,
            complement_outcome_label: "לא",
            contract_side: "no",
            shares: "677.094636",
            cost_basis: "349.958000",
            current_price: "0.53380309"
          }
        ]
      }),
      "navitester",
      { limit: "2" }
    );

    expect(payload.positions[0]).toMatchObject({
      marketKey: "market_binary_pm_lapid",
      outcomeLabel: "לא",
      contractSide: "no",
      side: "buy"
    });
  });

  it("reads public-safe resolved record rows", async () => {
    const payload = await readPublicProfileRecord(createQueryable(), "navitester", {
      limit: "2"
    });

    expect(payload).not.toHaveProperty("userId");
    expect(payload.items[0]).toMatchObject({
      marketKey: "next-prime-minister",
      image: {
        src: "/assets/images/market-buckets/politics.svg",
        alt: "פוליטיקה"
      },
      verdict: "correct",
      amount: "10.000000",
      realizedPnl: "6.000000",
      resolvedAt: "2026-06-10T12:00:00.000Z"
    });
  });

  it("maps incident-compensated false losses as corrected public wins", async () => {
    const db = createQueryable({
      recordRows: [
        {
          realization_id: "real_compensated",
          created_at: new Date("2026-07-10T18:00:00.000Z"),
          type: "resolution_win",
          shares_closed: "1000.000000",
          proceeds: "1000.000000",
          removed_cost_basis: "1000.000000",
          realized_pnl: "0.000000",
          market_id: "disc-wimbledon-djokovic",
          market_title: "האם נובאק ג׳וקוביץ׳ יזכה בווימבלדון?",
          category_key: "sports",
          market_contract: null,
          outcome_id: "yes",
          outcome_label: "כן"
        }
      ]
    });

    const payload = await readPublicProfileRecord(db, "navitester", {
      limit: "2"
    });

    const recordQuery = vi.mocked(db.query).mock.calls.find(([sql]) =>
      String(sql).includes("from realization_events re")
    )?.[0] as string;
    expect(recordQuery).toContain("market_resolutions");
    expect(recordQuery).toContain("market_incident_compensation");
    expect(recordQuery).toContain("credit_user_cash_incident_compensation");
    expect(payload.items[0]).toMatchObject({
      marketKey: "disc-wimbledon-djokovic",
      verdict: "correct",
      amount: "1000.000000",
      realizedPnl: "0.000000"
    });
  });
});
