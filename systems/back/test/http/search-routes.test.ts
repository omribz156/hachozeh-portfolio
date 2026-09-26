import { afterEach, describe, expect, it } from "vitest";

import {
  closeAppTestServers,
  startServer
} from "./app-test-harness";

afterEach(async () => {
  await closeAppTestServers();
});

describe("search routes", () => {
  it("returns market search results shaped for the shell", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        expect(sql).toContain("from markets m");
        expect(sql).toContain("from market_outcomes so");
        expect(sql).toContain("market_search_terms");
        expect(sql).toContain("m.market_family_key");
        expect(sql).toContain("{taxonomy,aliases}");
        expect(sql).toContain("{taxonomy,visibleTags}");
        expect(values).toEqual(["%בנק%", "בנק%", 5]);

        return {
          rows: [
            {
              market_id: "disc-cm-boi-rate-decision-may-25-2026",
              title: "החלטת בנק ישראל במאי?",
              description: "שוק ריבית",
              category_key: "economics",
              market_status: "open",
              close_at: new Date("2026-05-25T16:00:00.000Z"),
              updated_at: new Date("2026-05-20T10:00:00.000Z"),
              outcome_count: 2,
              total_volume: "2500.000000",
              top_price: "0.84000000",
              rank_score: 0
            }
          ]
        };
      }
    });

    const response = await fetch(`${baseUrl}/api/search?q=${encodeURIComponent("בנק")}&kind=markets&limit=5`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      query: "בנק",
      kind: "markets",
      generatedAt: expect.any(String),
      results: [
        expect.objectContaining({
          kind: "market",
          id: "disc-cm-boi-rate-decision-may-25-2026",
          title: "החלטת בנק ישראל במאי?",
          href: "/markets/disc-cm-boi-rate-decision-may-25-2026",
          thumbText: "כ",
          chanceLabel: "84%",
          volumeLabel: "V₪ 2.5K",
          marketStatus: "open",
          rank: 0
        })
      ],
      markets: [
        expect.objectContaining({
          kind: "market",
          id: "disc-cm-boi-rate-decision-may-25-2026"
        })
      ],
      events: [],
      profiles: [],
      pagination: {
        limit: 5,
        hasMore: false
      }
    });
    expect(payload.results[0].sub).toContain("כלכלה");
    expect(payload.results[0].sub).toContain("נפח V₪ 2.5K");
  });

  it("does not query the database for tiny search terms", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async () => {
        throw new Error("tiny search should not hit db");
      }
    });

    const response = await fetch(`${baseUrl}/api/search?q=${encodeURIComponent("ב")}&kind=all`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      query: "ב",
      kind: "all",
      results: [],
      markets: [],
      profiles: [],
      pagination: {
        limit: 8,
        hasMore: false
      }
    });
  });

  it("bounds public search query text before database matching", async () => {
    const longQuery = "א".repeat(300);
    const boundedQuery = "א".repeat(120);
    const { baseUrl } = await startServer({
      queryImpl: async (_sql: string, values?: unknown[]) => {
        expect(values).toEqual([`%${boundedQuery}%`, `${boundedQuery}%`, 8]);
        return { rows: [] };
      }
    });

    const response = await fetch(`${baseUrl}/api/search?q=${encodeURIComponent(longQuery)}&kind=markets`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.query).toBe(boundedQuery);
    expect(payload.results).toEqual([]);
  });

  it("returns public profile results for the profiles tab", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        expect(sql).toContain("from users u");
        expect(sql).toContain("u.privacy_erased_at is null");
        expect(sql).toContain("u.display_name ilike $1");
        expect(sql).toContain("u.handle ilike $1");
        expect(sql).not.toContain("nullif(trim(u.display_name), '') is not null");
        expect(sql).not.toContain("user_identities");
        expect(sql).not.toContain("identifier_display");
        expect(sql).toContain("verification.tier as verified_tier");
        expect(values).toEqual(["%mrbz%", "mrbz%", 4]);

        return {
          rows: [
            {
              user_id: "user_omri",
              handle: "mrbz",
              display_name: "אומרי",
              avatar_url: "https://evil.example/user_omri.webp",
              verified_tier: "gold",
              created_at: new Date("2026-06-20T10:00:00.000Z"),
              rank_score: 0
            }
          ]
        };
      }
    });

    const response = await fetch(`${baseUrl}/api/search?q=${encodeURIComponent("mrbz")}&kind=profiles&limit=4`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      query: "mrbz",
      kind: "profiles",
      markets: [],
      profiles: [
        {
          kind: "profile",
          id: "mrbz",
          title: "אומרי",
          sub: "",
          href: "/@mrbz",
          thumbText: "א",
          thumbUrl: null,
          chanceLabel: null,
          volumeLabel: null,
          rank: 0,
          verifiedTier: "gold"
        }
      ]
    });
    expect(payload.results).toEqual(payload.profiles);
    expect(JSON.stringify(payload)).not.toContain("user_omri");
  });

  it("uses a hashed public display fallback for profile search results", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        expect(sql).toContain("from users u");
        expect(sql).toContain("u.handle ilike $1");
        expect(sql).not.toContain("identifier_display");
        expect(values).toEqual(["%user\\_abcd1234%", "user\\_abcd1234%", 4]);

        return {
          rows: [
            {
              user_id: "user_private_source",
              handle: "user_abcd1234",
              display_name: null,
              avatar_url: null,
              verified_tier: null,
              created_at: new Date("2026-06-20T10:00:00.000Z"),
              rank_score: 1
            }
          ]
        };
      }
    });

    const response = await fetch(`${baseUrl}/api/search?q=${encodeURIComponent("user_abcd1234")}&kind=profiles&limit=4`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.profiles[0]).toMatchObject({
      kind: "profile",
      id: "user_abcd1234",
      href: "/@user_abcd1234",
      thumbText: "ח"
    });
    expect(payload.profiles[0].title).toBe("חזאי ABCD1234");
    expect(JSON.stringify(payload)).not.toContain("user_private_source");
  });

  it("does not search private email identities for profiles", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        expect(sql).not.toContain("user_identities");
        expect(sql).not.toContain("identifier_display");
        expect(values).toEqual(["%omrib@navi.local%", "omrib@navi.local%", 4]);
        return { rows: [] };
      }
    });

    const response = await fetch(`${baseUrl}/api/search?q=${encodeURIComponent("omrib@navi.local")}&kind=profiles&limit=4`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.profiles).toEqual([]);
    expect(payload.results).toEqual([]);
  });
});
