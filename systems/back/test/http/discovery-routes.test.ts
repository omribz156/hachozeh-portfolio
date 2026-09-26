import { createHash } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import {
  closeAppTestServers,
  startServer
} from "./app-test-harness";

afterEach(async () => {
  await closeAppTestServers();
});

function isDiscoveryCurationSlotsQuery(sql: string): boolean {
  return sql.includes("from discovery_curation_slots") ||
    sql.includes("from discovery_curation_settings");
}

describe("discovery routes", () => {
  it("returns a db-backed discovery feed for live market cards", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql.includes("from trades t")) {
          expect(values).toEqual([["disc-cm-boi-rate-decision-may-25-2026"]]);
          return { rows: [] };
        }

        if (sql.includes("from markets m")) {
          expect(values).toEqual([null, 800]);
          expect(sql).toContain("m.id not like 'market_seed_%'");

          return {
            rows: [
              {
                market_id: "disc-cm-boi-rate-decision-may-25-2026",
                market_status: "open",
                title: "החלטת בנק ישראל במאי?",
                description: "שוק ריבית",
                category_key: "economics",
                published_at: new Date("2026-04-16T09:20:57.075Z"),
                open_at: new Date("2026-04-16T09:20:57.075Z"),
                close_at: new Date("2026-05-25T16:00:00.000Z"),
                updated_at: new Date("2026-04-12T18:40:00.000Z"),
                outcome_count: 2,
                total_volume: "300.000000",
                outcome_id: "disc-cm-boi-rate-decision-may-25-2026-hold",
                outcome_label: "ללא שינוי",
                outcome_short_label: "ללא שינוי",
                outcome_image_url: null,
                sort_order: 0,
                last_price: "0.82000000"
              },
              {
                market_id: "disc-cm-boi-rate-decision-may-25-2026",
                market_status: "open",
                title: "החלטת בנק ישראל במאי?",
                description: "שוק ריבית",
                category_key: "economics",
                published_at: new Date("2026-04-16T09:20:57.075Z"),
                open_at: new Date("2026-04-16T09:20:57.075Z"),
                close_at: new Date("2026-05-25T16:00:00.000Z"),
                updated_at: new Date("2026-04-12T18:40:00.000Z"),
                outcome_count: 2,
                total_volume: "300.000000",
                outcome_id: "disc-cm-boi-rate-decision-may-25-2026-cut",
                outcome_label: "הורדה",
                outcome_short_label: "הורדה",
                outcome_image_url: null,
                sort_order: 1,
                last_price: "0.18000000"
              }
            ]
          };
        }

        if (isDiscoveryCurationSlotsQuery(sql)) {
          return { rows: [] };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected db query in app test: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/api/discovery/feed`);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=10, stale-while-revalidate=60"
    );
    expect(response.headers.get("cloudflare-cdn-cache-control")).toBe(
      "public, max-age=30, stale-while-revalidate=60"
    );
    const payload = await response.json();

    expect(payload).toMatchObject({
      feed: "trending",
      featured: {
        marketKey: "disc-cm-boi-rate-decision-may-25-2026",
        reasonCode: "most_traded",
        metric: {
          kind: "trade_volume",
          window: "all_time",
          value: "300.000000",
          label: "V₪ 300"
        }
      },
      items: [
        {
          marketKey: "disc-cm-boi-rate-decision-may-25-2026",
          shape: "binary",
          category: {
            key: "economy",
            label: "כלכלה"
          },
          preview: {
            marketType: "binary"
          }
        }
      ]
    });
    expect(payload.items[0].preview.topOutcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          outcomeKey: "disc-cm-boi-rate-decision-may-25-2026-hold",
          displayProbability: "82%",
          role: null
        })
      ])
    );
    expect(payload.items[0].outcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          outcomeKey: "disc-cm-boi-rate-decision-may-25-2026-hold",
          role: null
        }),
        expect.objectContaining({
          outcomeKey: "disc-cm-boi-rate-decision-may-25-2026-cut",
          role: null
        })
      ])
    );
  });

  it("returns category-ranked discovery feeds with normalized category keys", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql.includes("from trades t")) {
          expect(values).toEqual([["economy-volume-leader", "economy-fresh-update"]]);
          return { rows: [] };
        }

        if (sql.includes("from markets m")) {
          expect(values).toEqual([["economics", "economy"], 800]);

          return {
            rows: [
              {
                market_id: "economy-volume-leader",
                market_status: "open",
                title: "האם בנק ישראל יוריד ריבית במאי?",
                description: "שוק כלכלי",
                category_key: "economics",
                published_at: new Date("2026-04-08T10:00:00.000Z"),
                open_at: new Date("2026-04-08T10:00:00.000Z"),
                close_at: new Date("2026-05-01T18:00:00.000Z"),
                updated_at: new Date("2026-04-10T08:00:00.000Z"),
                outcome_count: 2,
                total_volume: "2500.000000",
                outcome_id: "economy-volume-leader-cut",
                outcome_label: "כן",
                outcome_short_label: "כן",
                outcome_image_url: null,
                sort_order: 0,
                last_price: "0.61000000"
              },
              {
                market_id: "economy-volume-leader",
                market_status: "open",
                title: "האם בנק ישראל יוריד ריבית במאי?",
                description: "שוק כלכלי",
                category_key: "economics",
                published_at: new Date("2026-04-08T10:00:00.000Z"),
                open_at: new Date("2026-04-08T10:00:00.000Z"),
                close_at: new Date("2026-05-01T18:00:00.000Z"),
                updated_at: new Date("2026-04-10T08:00:00.000Z"),
                outcome_count: 2,
                total_volume: "2500.000000",
                outcome_id: "economy-volume-leader-hold",
                outcome_label: "לא",
                outcome_short_label: "לא",
                outcome_image_url: null,
                sort_order: 1,
                last_price: "0.39000000"
              },
              {
                market_id: "economy-fresh-update",
                market_status: "open",
                title: "מה יהיה מדד המחירים הבא?",
                description: "שוק כלכלי",
                category_key: "economics",
                published_at: new Date("2026-04-09T09:00:00.000Z"),
                open_at: new Date("2026-04-09T09:00:00.000Z"),
                close_at: new Date("2026-04-20T18:00:00.000Z"),
                updated_at: new Date("2026-04-12T18:40:00.000Z"),
                outcome_count: 2,
                total_volume: "200.000000",
                outcome_id: "economy-fresh-update-hot",
                outcome_label: "מעל הצפי",
                outcome_short_label: "מעל",
                outcome_image_url: null,
                sort_order: 0,
                last_price: "0.54000000"
              },
              {
                market_id: "economy-fresh-update",
                market_status: "open",
                title: "מה יהיה מדד המחירים הבא?",
                description: "שוק כלכלי",
                category_key: "economics",
                published_at: new Date("2026-04-09T09:00:00.000Z"),
                open_at: new Date("2026-04-09T09:00:00.000Z"),
                close_at: new Date("2026-04-20T18:00:00.000Z"),
                updated_at: new Date("2026-04-12T18:40:00.000Z"),
                outcome_count: 2,
                total_volume: "200.000000",
                outcome_id: "economy-fresh-update-cool",
                outcome_label: "מתחת לצפי",
                outcome_short_label: "מתחת",
                outcome_image_url: null,
                sort_order: 1,
                last_price: "0.46000000"
              }
            ]
          };
        }

        if (isDiscoveryCurationSlotsQuery(sql)) {
          return { rows: [] };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected db query in app test: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/api/discovery/feed?category=economy`);

    expect(response.status).toBe(200);
    const payload = await response.json();

    expect(payload.category).toBe("economy");
    expect(payload.featured).toMatchObject({
      marketKey: "economy-volume-leader",
      reasonCode: "most_traded"
    });
    expect(payload.items.map((item: { marketKey: string }) => item.marketKey)).toEqual([
      "economy-volume-leader",
      "economy-fresh-update"
    ]);
  });

  it("adds viewerPosition for authenticated discovery requests", async () => {
    const token = "viewer-session-token";
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql.includes("from sessions s")) {
          expect(values).toEqual([tokenHash]);
          return {
            rows: [
              {
                session_id: "session_viewer_1",
                user_id: "user_viewer_1",
                session_status: "active",
                created_at: new Date(Date.now() - 3_600_000),
                last_seen_at: new Date(),
                expires_at: new Date(Date.now() + 60_000),
                user_status: "active",
                user_role: "user"
              }
            ]
          };
        }

        if (sql.includes("from trades t")) {
          expect(values).toEqual([["viewer-position-market"]]);
          return { rows: [] };
        }

        if (sql.includes("from contract_positions cp")) {
          expect(values).toEqual(["user_viewer_1", ["viewer-position-market"], "0.010000"]);
          return {
            rows: [
              {
                market_id: "viewer-position-market",
                outcome_id: "viewer-position-market-yes",
                contract_side: "yes",
                shares: "50.000000",
                cost_basis: "20.000000",
                current_price: "0.60000000"
              }
            ]
          };
        }

        if (sql.includes("from markets m")) {
          expect(values).toEqual([null, 800]);
          return {
            rows: [
              {
                market_id: "viewer-position-market",
                market_status: "open",
                title: "האם יקרה?",
                description: "שוק בדיקה",
                category_key: "politics",
                published_at: new Date("2026-05-12T08:00:00.000Z"),
                open_at: new Date("2026-05-12T08:00:00.000Z"),
                close_at: new Date("2026-05-13T02:00:00.000Z"),
                updated_at: new Date("2026-05-12T09:00:00.000Z"),
                outcome_count: 2,
                total_volume: "100.000000",
                outcome_id: "viewer-position-market-yes",
                outcome_label: "כן",
                outcome_short_label: "כן",
                outcome_image_url: null,
                sort_order: 0,
                last_price: "0.60000000"
              },
              {
                market_id: "viewer-position-market",
                market_status: "open",
                title: "האם יקרה?",
                description: "שוק בדיקה",
                category_key: "politics",
                published_at: new Date("2026-05-12T08:00:00.000Z"),
                open_at: new Date("2026-05-12T08:00:00.000Z"),
                close_at: new Date("2026-05-13T02:00:00.000Z"),
                updated_at: new Date("2026-05-12T09:00:00.000Z"),
                outcome_count: 2,
                total_volume: "100.000000",
                outcome_id: "viewer-position-market-no",
                outcome_label: "לא",
                outcome_short_label: "לא",
                outcome_image_url: null,
                sort_order: 1,
                last_price: "0.40000000"
              }
            ]
          };
        }

        if (isDiscoveryCurationSlotsQuery(sql)) {
          return { rows: [] };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected db query in app test: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/api/discovery/feed`, {
      headers: {
        cookie: `navi_session=${token}`
      }
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("cloudflare-cdn-cache-control")).toBeNull();
    const payload = await response.json();

    expect(payload.items[0].viewerPosition).toMatchObject({
      side: "yes",
      shares: 50,
      averageCost: 0.4,
      pnlLabel: "V₪ +10",
      outcomeKey: "viewer-position-market-yes",
      contractSide: "yes"
    });
  });

  it("clears stale discovery viewer sessions while returning a guest feed", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql.includes("from sessions s")) {
          expect(values).toEqual([expect.any(String)]);
          return { rows: [] };
        }

        if (sql.includes("from markets m")) {
          expect(values).toEqual([null, 800]);
          return { rows: [] };
        }

        if (isDiscoveryCurationSlotsQuery(sql)) {
          return { rows: [] };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }

        throw new Error(`Unexpected db query in stale discovery test: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/api/discovery/feed`, {
      headers: {
        cookie: "navi_session=stale"
      }
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("cloudflare-cdn-cache-control")).toBeNull();
    expect(response.headers.get("set-cookie")).toContain("navi_session=");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(payload).toMatchObject({
      feed: "trending",
      category: null
    });
    expect(payload.items.every((item: { viewerPosition?: unknown }) => item.viewerPosition === null)).toBe(true);
  });

  it("returns breaking feed items only when markets have real movement", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql.includes("target_outcomes")) {
          expect(values).toEqual([["breaking-mover", "breaking-flat"]]);
          return {
            rows: [
              {
                market_id: "breaking-mover",
                outcome_id: "breaking-mover-yes",
                window_key: "24h",
                from_price: "0.52000000",
                to_price: "0.70000000",
                delta: "0.18000000",
                abs_delta: "0.18000000",
                trade_count: 4,
                trade_volume: "1200.000000"
              }
            ]
          };
        }

        if (sql.includes("from trades t")) {
          expect(values).toEqual([["breaking-mover", "breaking-flat"]]);
          return { rows: [] };
        }

        if (sql.includes("from markets m")) {
          expect(values).toEqual([null, 800]);
          return {
            rows: [
              {
                market_id: "breaking-mover",
                market_status: "open",
                title: "שוק שזז",
                description: "בדיקת תזוזה",
                category_key: "politics",
                published_at: new Date("2026-05-12T08:00:00.000Z"),
                open_at: new Date("2026-05-12T08:00:00.000Z"),
                close_at: new Date("2026-06-13T02:00:00.000Z"),
                updated_at: new Date("2026-05-12T09:00:00.000Z"),
                recent_trade_count: 4,
                recent_trade_volume: "1200.000000",
                outcome_count: 2,
                total_volume: "2000.000000",
                outcome_id: "breaking-mover-yes",
                outcome_label: "כן",
                outcome_short_label: "כן",
                outcome_image_url: null,
                sort_order: 0,
                last_price: "0.70000000"
              },
              {
                market_id: "breaking-mover",
                market_status: "open",
                title: "שוק שזז",
                description: "בדיקת תזוזה",
                category_key: "politics",
                published_at: new Date("2026-05-12T08:00:00.000Z"),
                open_at: new Date("2026-05-12T08:00:00.000Z"),
                close_at: new Date("2026-06-13T02:00:00.000Z"),
                updated_at: new Date("2026-05-12T09:00:00.000Z"),
                recent_trade_count: 4,
                recent_trade_volume: "1200.000000",
                outcome_count: 2,
                total_volume: "2000.000000",
                outcome_id: "breaking-mover-no",
                outcome_label: "לא",
                outcome_short_label: "לא",
                outcome_image_url: null,
                sort_order: 1,
                last_price: "0.30000000"
              },
              {
                market_id: "breaking-flat",
                market_status: "open",
                title: "שוק שטוח",
                description: "לא אמור להופיע",
                category_key: "politics",
                published_at: new Date("2026-05-12T08:00:00.000Z"),
                open_at: new Date("2026-05-12T08:00:00.000Z"),
                close_at: new Date("2026-06-13T02:00:00.000Z"),
                updated_at: new Date("2026-05-12T09:00:00.000Z"),
                recent_trade_count: 0,
                recent_trade_volume: "0.000000",
                outcome_count: 2,
                total_volume: "20.000000",
                outcome_id: "breaking-flat-yes",
                outcome_label: "כן",
                outcome_short_label: "כן",
                outcome_image_url: null,
                sort_order: 0,
                last_price: "0.51000000"
              },
              {
                market_id: "breaking-flat",
                market_status: "open",
                title: "שוק שטוח",
                description: "לא אמור להופיע",
                category_key: "politics",
                published_at: new Date("2026-05-12T08:00:00.000Z"),
                open_at: new Date("2026-05-12T08:00:00.000Z"),
                close_at: new Date("2026-06-13T02:00:00.000Z"),
                updated_at: new Date("2026-05-12T09:00:00.000Z"),
                recent_trade_count: 0,
                recent_trade_volume: "0.000000",
                outcome_count: 2,
                total_volume: "20.000000",
                outcome_id: "breaking-flat-no",
                outcome_label: "לא",
                outcome_short_label: "לא",
                outcome_image_url: null,
                sort_order: 1,
                last_price: "0.49000000"
              }
            ]
          };
        }

        if (isDiscoveryCurationSlotsQuery(sql)) {
          return { rows: [] };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected db query in app test: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/api/discovery/feed?feed=breaking`);

    expect(response.status).toBe(200);
    const payload = await response.json();

    expect(payload.feed).toBe("breaking");
    expect(payload.items.map((item: { marketKey: string }) => item.marketKey)).toEqual([
      "breaking-mover"
    ]);
    expect(payload.items[0].movement).toMatchObject({
      outcomeKey: "breaking-mover-yes",
      window: "24h",
      fromProbability: "0.52000000",
      toProbability: "0.70000000",
      deltaPercent: 18,
      absDeltaPercent: 18,
      tradeCount: 4,
      volume: {
        value: "1200.000000",
        label: "V₪ 1.2K"
      }
    });
    expect(payload.items[0].signals[0]).toMatchObject({
      type: "moved",
      reason: "price_movement",
      outcomeKey: "breaking-mover-yes",
      deltaPercent: 18,
      absDeltaPercent: 18
    });
  });
});
