import { afterEach, describe, expect, it, vi } from "vitest";

import type { Queryable } from "../../src/db/client/pool";
import { buildFeedItem } from "../../src/discovery/feed/presenter";
import { readDiscoveryFeed } from "../../src/discovery/read-discovery-feed-service";

afterEach(() => {
  vi.useRealTimers();
});

function isDiscoveryCurationQuery(sql: string): boolean {
  return sql.includes("from discovery_curation_slots") ||
    sql.includes("from discovery_curation_settings");
}

function emptyDiscoveryCurationSlots() {
  return { rows: [] };
}

function createQueryable(): Queryable {
  return {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      if (isDiscoveryCurationQuery(sql)) {
        expect(values).toBeUndefined();
        return emptyDiscoveryCurationSlots();
      }

      if (sql.includes("from trades t")) {
        expect(values).toEqual([[
          "bank-israel-mar-18",
          "market-custom-open-777",
          "market-custom-1234"
        ]]);

        return {
          rows: [
            {
              market_id: "bank-israel-mar-18",
              created_at: new Date("2026-04-12T18:35:00.000Z"),
              outcome_id: "bank-israel-mar-18-outcome-hold",
              price_after: "0.82000000"
            },
            {
              market_id: "market-custom-open-777",
              created_at: new Date("2026-04-10T08:55:00.000Z"),
              outcome_id: "market-custom-open-777-outcome-option-a",
              price_after: "0.62000000"
            }
          ]
        };
      }

      expect(values).toEqual([null, 800]);

      return {
        rows: [
          {
            market_id: "bank-israel-mar-18",
            market_status: "open",
            title: "החלטת הריבית הקרובה של בנק ישראל",
            description: "שוק ריבית",
            category_key: "economics",
            published_at: new Date("2026-04-08T15:49:31.914Z"),
            open_at: new Date("2026-04-08T15:49:31.914Z"),
            close_at: new Date("2026-05-08T15:49:31.920Z"),
            updated_at: new Date("2026-04-12T18:40:00.000Z"),
            market_contract: {
              objectType: "market_contract_v1",
              version: "seer-contract-v1",
              oracleCapability: "manual_resolution_required",
              measurementKind: "rate_decision",
              resultShape: "multi_outcome",
              referenceQuarantine: {
                referenceOnly: true
              },
              payoutPolicy: {
                kind: "after_resolution"
              },
              image: {
                bucket: "source",
                src: "https://example.com/boi.png",
                alt: "בנק ישראל",
                provenance: "source:bank-of-israel",
                rights: {
                  status: "approved-third-party",
                  publicUse: "allowed",
                  owner: "Bank of Israel",
                  sourceUrl: "https://example.com/boi.png"
                }
              }
            },
            outcome_count: 4,
            total_volume: "0.000000",
            outcome_id: "bank-israel-mar-18-outcome-hold",
            outcome_label: "ללא שינוי",
            outcome_short_label: "ללא שינוי",
            outcome_image_url: null,
            sort_order: 0,
            last_price: "0.82000000"
          },
          {
            market_id: "bank-israel-mar-18",
            market_status: "open",
            title: "החלטת הריבית הקרובה של בנק ישראל",
            description: "שוק ריבית",
            category_key: "economics",
            published_at: new Date("2026-04-08T15:49:31.914Z"),
            open_at: new Date("2026-04-08T15:49:31.914Z"),
            close_at: new Date("2026-05-08T15:49:31.920Z"),
            updated_at: new Date("2026-04-12T18:40:00.000Z"),
            outcome_count: 4,
            total_volume: "0.000000",
            outcome_id: "bank-israel-mar-18-outcome-cut",
            outcome_label: "הורדה",
            outcome_short_label: "הורדה",
            outcome_image_url: null,
            sort_order: 1,
            last_price: "0.18000000"
          },
          {
            market_id: "bank-israel-mar-18",
            market_status: "open",
            title: "החלטת הריבית הקרובה של בנק ישראל",
            description: "שוק ריבית",
            category_key: "economics",
            published_at: new Date("2026-04-08T15:49:31.914Z"),
            open_at: new Date("2026-04-08T15:49:31.914Z"),
            close_at: new Date("2026-05-08T15:49:31.920Z"),
            updated_at: new Date("2026-04-12T18:40:00.000Z"),
            outcome_count: 4,
            total_volume: "0.000000",
            outcome_id: "bank-israel-mar-18-outcome-raise",
            outcome_label: "העלאה",
            outcome_short_label: "העלאה",
            outcome_image_url: null,
            sort_order: 2,
            last_price: "0.05000000"
          },
          {
            market_id: "bank-israel-mar-18",
            market_status: "open",
            title: "החלטת הריבית הקרובה של בנק ישראל",
            description: "שוק ריבית",
            category_key: "economics",
            published_at: new Date("2026-04-08T15:49:31.914Z"),
            open_at: new Date("2026-04-08T15:49:31.914Z"),
            close_at: new Date("2026-05-08T15:49:31.920Z"),
            updated_at: new Date("2026-04-12T18:40:00.000Z"),
            outcome_count: 4,
            total_volume: "0.000000",
            outcome_id: "bank-israel-mar-18-outcome-large-cut",
            outcome_label: "הורדה חדה",
            outcome_short_label: "הורדה חדה",
            outcome_image_url: null,
            sort_order: 3,
            last_price: "0.01000000"
          },
          {
            market_id: "market-custom-open-777",
            market_status: "open",
            title: "האם הממשלה תודיע על בחירות?",
            description: "שוק פוליטי",
            category_key: "politics",
            published_at: new Date("2026-04-09T11:00:00.000Z"),
            open_at: new Date("2026-04-09T11:00:00.000Z"),
            close_at: new Date("2026-06-22T18:00:00.000Z"),
            updated_at: new Date("2026-04-10T09:00:00.000Z"),
            outcome_count: 2,
            total_volume: "1450.000000",
            outcome_id: "market-custom-open-777-outcome-option-a",
            outcome_label: "כן",
            outcome_short_label: "כן",
            outcome_image_url: "https://example.com/politics.png",
            sort_order: 0,
            last_price: "0.62000000"
          },
          {
            market_id: "market-custom-open-777",
            market_status: "open",
            title: "האם הממשלה תודיע על בחירות?",
            description: "שוק פוליטי",
            category_key: "politics",
            published_at: new Date("2026-04-09T11:00:00.000Z"),
            open_at: new Date("2026-04-09T11:00:00.000Z"),
            close_at: new Date("2026-06-22T18:00:00.000Z"),
            updated_at: new Date("2026-04-10T09:00:00.000Z"),
            outcome_count: 2,
            total_volume: "1450.000000",
            outcome_id: "market-custom-open-777-outcome-option-b",
            outcome_label: "לא",
            outcome_short_label: "לא",
            outcome_image_url: null,
            sort_order: 1,
            last_price: "0.38000000"
          },
          {
            market_id: "market-custom-1234",
            market_status: "resolved",
            title: "מי יהיה ראש הממשלה הבא?",
            description: "שוק פוליטי",
            category_key: "politics",
            published_at: new Date("2026-04-09T11:00:00.000Z"),
            open_at: new Date("2026-04-09T11:00:00.000Z"),
            close_at: new Date("2026-06-22T18:00:00.000Z"),
            updated_at: new Date("2026-04-10T09:00:00.000Z"),
            outcome_count: 2,
            total_volume: "1450.000000",
            outcome_id: "market-custom-1234-outcome-option-a",
            outcome_label: "מועמד א'",
            outcome_short_label: "מועמד א'",
            outcome_image_url: "https://example.com/politics.png",
            sort_order: 0,
            last_price: "0.62000000"
          },
          {
            market_id: "market-custom-1234",
            market_status: "resolved",
            title: "מי יהיה ראש הממשלה הבא?",
            description: "שוק פוליטי",
            category_key: "politics",
            published_at: new Date("2026-04-09T11:00:00.000Z"),
            open_at: new Date("2026-04-09T11:00:00.000Z"),
            close_at: new Date("2026-06-22T18:00:00.000Z"),
            updated_at: new Date("2026-04-10T09:00:00.000Z"),
            outcome_count: 2,
            total_volume: "1450.000000",
            outcome_id: "market-custom-1234-outcome-option-b",
            outcome_label: "מועמד ב'",
            outcome_short_label: "מועמד ב'",
            outcome_image_url: null,
            sort_order: 1,
            last_price: "0.38000000"
          }
        ]
      };
    }) as Queryable["query"]
  };
}

function createEconomyCategoryQueryable(): Queryable {
  return {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      if (isDiscoveryCurationQuery(sql)) {
        expect(values).toBeUndefined();
        return emptyDiscoveryCurationSlots();
      }

      if (sql.includes("from trades t")) {
        expect(values).toEqual([[
          "economy-volume-leader",
          "economy-fresh-update"
        ]]);

        return { rows: [] };
      }

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
    }) as Queryable["query"]
  };
}

describe("discovery feed service", () => {
  it("emits only earned discovery signals", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-18T10:00:00.000Z"));

    function rowsForMarket(input: {
      marketId: string;
      title: string;
      publishedAt: Date;
      closeAt: Date;
      updatedAt: Date;
      recentTradeCount?: number;
      recentTradeVolume?: string;
      totalVolume?: string;
      categoryKey?: string;
      marketContract?: unknown;
    }) {
      return [
        {
          market_id: input.marketId,
          market_status: "open",
          title: input.title,
          description: null,
          category_key: input.categoryKey ?? "politics",
          published_at: input.publishedAt,
          open_at: input.publishedAt,
          close_at: input.closeAt,
          market_contract: input.marketContract,
          updated_at: input.updatedAt,
          recent_trade_count: input.recentTradeCount ?? 0,
          recent_trade_volume: input.recentTradeVolume ?? "0.000000",
          outcome_count: 2,
          total_volume: input.totalVolume ?? "0.000000",
          outcome_id: `${input.marketId}-yes`,
          outcome_label: "כן",
          outcome_short_label: "כן",
          outcome_image_url: null,
          sort_order: 0,
          last_price: "0.55000000"
        },
        {
          market_id: input.marketId,
          market_status: "open",
          title: input.title,
          description: null,
          category_key: input.categoryKey ?? "politics",
          published_at: input.publishedAt,
          open_at: input.publishedAt,
          close_at: input.closeAt,
          market_contract: input.marketContract,
          updated_at: input.updatedAt,
          recent_trade_count: input.recentTradeCount ?? 0,
          recent_trade_volume: input.recentTradeVolume ?? "0.000000",
          outcome_count: 2,
          total_volume: input.totalVolume ?? "0.000000",
          outcome_id: `${input.marketId}-no`,
          outcome_label: "לא",
          outcome_short_label: "לא",
          outcome_image_url: null,
          sort_order: 1,
          last_price: "0.45000000"
        }
      ];
    }

    const queryable: Queryable = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (isDiscoveryCurationQuery(sql)) {
          expect(values).toBeUndefined();
          return emptyDiscoveryCurationSlots();
        }

        if (sql.includes("from trades t")) {
          expect(values).toEqual([[
            "hot-market",
            "live-market",
            "closing-market",
            "new-market",
            "future-boi-market",
            "stable-market"
          ]]);
          return { rows: [] };
        }

        expect(values).toEqual([null, 800]);

        return {
          rows: [
            ...rowsForMarket({
              marketId: "hot-market",
              title: "שוק עם פעילות אמיתית",
              publishedAt: new Date("2026-05-17T08:00:00.000Z"),
              closeAt: new Date("2026-05-18T18:00:00.000Z"),
              updatedAt: new Date("2026-05-18T09:55:00.000Z"),
              recentTradeCount: 4,
              recentTradeVolume: "800.000000",
              totalVolume: "1200.000000"
            }),
            ...rowsForMarket({
              marketId: "live-market",
              title: "משחק שרץ עכשיו",
              publishedAt: new Date("2026-05-17T08:00:00.000Z"),
              closeAt: new Date("2026-05-18T18:00:00.000Z"),
              updatedAt: new Date("2026-05-18T09:55:00.000Z"),
              categoryKey: "sports",
              marketContract: {
                objectType: "market_contract_v1",
                displayHints: {
                  liveStatus: "live_now"
                }
              }
            }),
            ...rowsForMarket({
              marketId: "closing-market",
              title: "שוק שסוגר היום",
              publishedAt: new Date("2026-05-17T08:00:00.000Z"),
              closeAt: new Date("2026-05-18T18:00:00.000Z"),
              updatedAt: new Date("2026-05-10T08:00:00.000Z")
            }),
            ...rowsForMarket({
              marketId: "new-market",
              title: "שוק חדש",
              publishedAt: new Date("2026-05-17T08:00:00.000Z"),
              closeAt: new Date("2026-06-01T08:00:00.000Z"),
              updatedAt: new Date("2026-05-17T08:00:00.000Z")
            }),
            ...rowsForMarket({
              marketId: "future-boi-market",
              title: "האם בנק ישראל ישאיר את הריבית?",
              publishedAt: new Date("2026-05-01T08:00:00.000Z"),
              closeAt: new Date("2026-06-01T08:00:00.000Z"),
              updatedAt: new Date("2026-05-10T08:00:00.000Z"),
              categoryKey: "economics",
              marketContract: {
                objectType: "market_contract_v1",
                measurementKind: "rate_decision",
                resultShape: "binary"
              }
            }),
            ...rowsForMarket({
              marketId: "stable-market",
              title: "שוק רגוע",
              publishedAt: new Date("2026-05-01T08:00:00.000Z"),
              closeAt: new Date("2026-06-01T08:00:00.000Z"),
              updatedAt: new Date("2026-05-10T08:00:00.000Z")
            })
          ]
        };
      }) as Queryable["query"]
    };

    const response = await readDiscoveryFeed(queryable, { feed: "trending" });
    const signalsByMarket = new Map(
      response.items.map((item) => [
        item.marketKey,
        item.signals.map((signal) => signal.type)
      ])
    );

    expect(signalsByMarket.get("hot-market")).toEqual(["hot"]);
    expect(signalsByMarket.get("live-market")).toEqual(["live"]);
    expect(signalsByMarket.get("closing-market")).toEqual(["closing"]);
    expect(signalsByMarket.get("new-market")).toEqual(["new"]);
    expect(signalsByMarket.get("future-boi-market")).toEqual([]);
    expect(signalsByMarket.get("stable-market")).toEqual([]);
    expect(response.items.every((item) => item.signals.length <= 1)).toBe(true);
    expect(response.items.filter((item) => item.signals.length > 0)).toHaveLength(4);
  });

  it("returns db-backed items with category normalization and raw market ids", async () => {
    const response = await readDiscoveryFeed(createQueryable(), {
      feed: "trending"
    });

    expect(response.feed).toBe("trending");
    expect(response.items).toHaveLength(2);
    expect(response.featured).toMatchObject({
      marketKey: "market-custom-open-777",
      reasonCode: "most_traded",
      metric: {
        kind: "trade_volume",
        window: "all_time",
        value: "1450.000000"
      }
    });
    const bankItem = response.items.find((item) => item.marketKey === "bank-israel-mar-18");
    const politicsItem = response.items.find((item) => item.marketKey === "market-custom-open-777");
    expect(bankItem).toMatchObject({
      marketKey: "bank-israel-mar-18",
      marketStatus: "open",
      category: {
        key: "economy",
        label: "כלכלה"
      },
      preview: {
        marketType: "multi_outcome"
      },
      shape: "multi",
      viewerPosition: null,
      volume: {
        // zero trades: below the public-volume floor → label omitted (null)
        label: null
      }
    });
    expect(politicsItem).toMatchObject({
      marketKey: "market-custom-open-777",
      marketStatus: "open",
      category: {
        key: "politics",
        label: "פוליטיקה"
      },
      preview: {
        marketType: "binary"
      },
      shape: "binary",
      viewerPosition: null,
      volume: {
        label: "V₪ 1.5K"
      }
    });
    expect(response.featured?.reasonLabel).toBe("הכי נסחר");
    expect(response.featured?.metric.label).toBe("V₪ 1.5K");
    expect(bankItem?.preview.topOutcomes).toHaveLength(4);
    expect(bankItem?.outcomes.map((outcome) => outcome.role)).toEqual([
      null,
      null,
      null,
      null
    ]);
    expect(bankItem?.preview.topOutcomes.map((outcome) => outcome.outcomeKey)).toEqual([
      "bank-israel-mar-18-outcome-hold",
      "bank-israel-mar-18-outcome-cut",
      "bank-israel-mar-18-outcome-raise",
      "bank-israel-mar-18-outcome-large-cut"
    ]);
    expect(bankItem?.preview.topOutcomes[0]).toMatchObject({
      outcomeKey: "bank-israel-mar-18-outcome-hold",
      displayProbability: "82%"
    });
    expect(politicsItem?.outcomes.map((outcome) => outcome.role)).toEqual(["yes", "no"]);
    expect(politicsItem?.preview.topOutcomes.map((outcome) => outcome.role)).toEqual([
      "yes",
      "no"
    ]);
    expect(bankItem?.preview).not.toHaveProperty("chart");
    expect(bankItem?.trust?.contract).toMatchObject({
      oracleCapability: "manual_resolution_required",
      measurementKind: "rate_decision",
      resultShape: "multi_outcome",
      image: {
        bucket: "source",
        src: "https://example.com/boi.png",
        alt: "בנק ישראל",
        rights: {
          status: "approved-third-party",
          publicUse: "allowed"
        }
      },
      referenceQuarantine: {
        referenceOnly: true
      }
    });
    // Contract has an explicit third-party src and no assetId — the presenter
    // trusts it verbatim with no rematch, no photo hydration. Alias rematch
    // only fires when the contract stamped a category-kind asset (a category
    // fallback that could be improved by finding a more specific match).
    expect(bankItem?.image).toEqual({
      src: "https://example.com/boi.png",
      alt: "בנק ישראל"
    });
    expect(politicsItem?.image).toMatchObject({
      src: "https://example.com/politics.png",
      alt: "האם הממשלה תודיע על בחירות?"
    });
    expect(bankItem?.lifecycle).toMatchObject({
      effectiveStatus: "open",
      persistedStatus: "open",
      payoutPolicy: {
        kind: "after_resolution"
      }
    });
  });

  it("collapses multi-child events to one representative discovery card", async () => {
    function rowsForBinaryMarket(input: {
      marketId: string;
      eventId?: string | null;
      eventSlug?: string | null;
      eventTitle?: string | null;
      eventChildLabel?: string | null;
      title: string;
      closeAt: Date;
      totalVolume: string;
      recentTradeCount?: number;
      recentTradeVolume?: string;
    }) {
      return [
        {
          market_id: input.marketId,
          event_id: input.eventId ?? null,
          event_slug: input.eventSlug ?? null,
          event_title: input.eventTitle ?? null,
          event_child_label: input.eventChildLabel ?? null,
          market_status: "open",
          title: input.title,
          description: "שוק בדיקה",
          category_key: "politics",
          published_at: new Date("2026-05-12T08:00:00.000Z"),
          open_at: new Date("2026-05-12T08:00:00.000Z"),
          close_at: input.closeAt,
          updated_at: new Date("2026-05-12T09:00:00.000Z"),
          recent_trade_count: input.recentTradeCount ?? 0,
          recent_trade_volume: input.recentTradeVolume ?? "0.000000",
          outcome_count: 2,
          total_volume: input.totalVolume,
          outcome_id: `${input.marketId}-yes`,
          outcome_label: "כן",
          outcome_short_label: "כן",
          outcome_image_url: null,
          sort_order: 0,
          last_price: "0.56000000"
        },
        {
          market_id: input.marketId,
          event_id: input.eventId ?? null,
          event_slug: input.eventSlug ?? null,
          event_title: input.eventTitle ?? null,
          event_child_label: input.eventChildLabel ?? null,
          market_status: "open",
          title: input.title,
          description: "שוק בדיקה",
          category_key: "politics",
          published_at: new Date("2026-05-12T08:00:00.000Z"),
          open_at: new Date("2026-05-12T08:00:00.000Z"),
          close_at: input.closeAt,
          updated_at: new Date("2026-05-12T09:00:00.000Z"),
          recent_trade_count: input.recentTradeCount ?? 0,
          recent_trade_volume: input.recentTradeVolume ?? "0.000000",
          outcome_count: 2,
          total_volume: input.totalVolume,
          outcome_id: `${input.marketId}-no`,
          outcome_label: "לא",
          outcome_short_label: "לא",
          outcome_image_url: null,
          sort_order: 1,
          last_price: "0.44000000"
        }
      ];
    }

    const queryable: Queryable = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (isDiscoveryCurationQuery(sql)) {
          expect(values).toBeUndefined();
          return emptyDiscoveryCurationSlots();
        }

        expect(values).toEqual([null, 800]);

        return {
          rows: [
            ...rowsForBinaryMarket({
              marketId: "event-election-jul",
              eventId: "evt-election-months",
              eventSlug: "election-months-2026",
              eventTitle: "מתי יתקיימו הבחירות בישראל ב-2026?",
              eventChildLabel: "יולי",
              title: "האם הבחירות בישראל יתקיימו ביולי?",
              closeAt: new Date("2026-07-31T20:59:00.000Z"),
              totalVolume: "130.000000",
              recentTradeCount: 2,
              recentTradeVolume: "300.000000"
            }),
            ...rowsForBinaryMarket({
              marketId: "event-election-jun",
              eventId: "evt-election-months",
              eventSlug: "election-months-2026",
              eventTitle: "מתי יתקיימו הבחירות בישראל ב-2026?",
              eventChildLabel: "יוני",
              title: "האם הבחירות בישראל יתקיימו ביוני?",
              closeAt: new Date("2026-06-30T20:59:00.000Z"),
              totalVolume: "125.000000",
              recentTradeCount: 2,
              recentTradeVolume: "300.000000"
            }),
            ...rowsForBinaryMarket({
              marketId: "ordinary-market",
              title: "האם הממשלה תודיע על בחירות?",
              closeAt: new Date("2026-06-22T18:00:00.000Z"),
              totalVolume: "90.000000"
            })
          ]
        };
      }) as Queryable["query"]
    };

    const response = await readDiscoveryFeed(queryable, { feed: "trending" });

    expect(response.items).toHaveLength(2);
    expect(response.items[0]).toMatchObject({
      marketKey: "event-election-jun",
      href: "/event/election-months-2026",
      event: {
        eventKey: "evt-election-months",
        eventSlug: "election-months-2026",
        publicPath: "/event/election-months-2026",
        parentKey: "evt-election-months",
        representativeMarketKey: "event-election-jun",
        childMarketKeys: ["event-election-jun", "event-election-jul"]
      },
      title: "מתי יתקיימו הבחירות בישראל ב-2026?",
      volume: {
        value: "255.000000",
        label: "V₪ 255"
      }
    });
    expect(response.items[0]?.shape).toBe("multi");
    expect(response.items[0]?.preview.marketType).toBe("multi_outcome");
    expect(response.items[0]?.outcomes.map((outcome) => outcome.label)).toEqual([
      "יוני",
      "יולי"
    ]);
    expect(response.items[0]?.outcomes.map((outcome) => outcome.outcomeKey)).toEqual([
      "event-election-jun",
      "event-election-jul"
    ]);
    expect(response.items[0]?.signals.map((signal) => signal.type)).toEqual(["hot"]);
    expect(response.items[0]?.preview.topOutcomes).toHaveLength(2);
    expect(response.items.map((item) => item.marketKey)).toEqual([
      "event-election-jun",
      "ordinary-market"
    ]);
  });

  it("links event child discovery cards to their focused child market", () => {
    const rowBase = {
      market_id: "event-election-jul",
      event_id: "evt-election-months",
      event_slug: "election-months-2026",
      event_title: "מתי יתקיימו הבחירות בישראל ב-2026?",
      event_child_label: "יולי",
      discovery_event_child_card: true,
      market_status: "open",
      title: "האם הבחירות בישראל יתקיימו ביולי?",
      description: "שוק בדיקה",
      category_key: "politics",
      market_contract: null,
      published_at: new Date("2026-05-12T08:00:00.000Z"),
      open_at: new Date("2026-05-12T08:00:00.000Z"),
      close_at: new Date("2026-07-31T20:59:00.000Z"),
      updated_at: new Date("2026-05-12T09:00:00.000Z"),
      recent_trade_count: 0,
      recent_trade_volume: "0.000000",
      outcome_count: 2,
      total_volume: "130.000000"
    };
    const item = buildFeedItem([
      {
        ...rowBase,
        outcome_id: "event-election-jul-yes",
        outcome_label: "כן",
        outcome_short_label: "כן",
        outcome_image_url: null,
        sort_order: 0,
        last_price: "0.56000000"
      },
      {
        ...rowBase,
        outcome_id: "event-election-jul-no",
        outcome_label: "לא",
        outcome_short_label: "לא",
        outcome_image_url: null,
        sort_order: 1,
        last_price: "0.44000000"
      }
    ]);

    expect(item?.href).toBe("/markets/event-election-jul?focus=1");
  });

  it("hides event child cards from main trending while preserving them in category feeds", async () => {
    function rowsForBinaryMarket(input: {
      marketId: string;
      eventId?: string | null;
      eventSlug?: string | null;
      eventTitle?: string | null;
      eventChildLabel?: string | null;
      title: string;
      closeAt: Date;
      totalVolume: string;
    }) {
      const eventDisplayFlags = input.eventId
        ? { showParentInDiscovery: true, showChildrenInDiscovery: true }
        : null;

      return [
        {
          market_id: input.marketId,
          event_id: input.eventId ?? null,
          event_slug: input.eventSlug ?? null,
          event_title: input.eventTitle ?? null,
          event_child_label: input.eventChildLabel ?? null,
          event_display_flags: eventDisplayFlags,
          market_status: "open",
          title: input.title,
          description: "שוק בדיקה",
          category_key: "politics",
          published_at: new Date("2026-05-12T08:00:00.000Z"),
          open_at: new Date("2026-05-12T08:00:00.000Z"),
          close_at: input.closeAt,
          updated_at: new Date("2026-05-12T09:00:00.000Z"),
          recent_trade_count: 2,
          recent_trade_volume: "300.000000",
          outcome_count: 2,
          total_volume: input.totalVolume,
          outcome_id: `${input.marketId}-yes`,
          outcome_label: "כן",
          outcome_short_label: "כן",
          outcome_image_url: null,
          sort_order: 0,
          last_price: "0.56000000"
        },
        {
          market_id: input.marketId,
          event_id: input.eventId ?? null,
          event_slug: input.eventSlug ?? null,
          event_title: input.eventTitle ?? null,
          event_child_label: input.eventChildLabel ?? null,
          event_display_flags: eventDisplayFlags,
          market_status: "open",
          title: input.title,
          description: "שוק בדיקה",
          category_key: "politics",
          published_at: new Date("2026-05-12T08:00:00.000Z"),
          open_at: new Date("2026-05-12T08:00:00.000Z"),
          close_at: input.closeAt,
          updated_at: new Date("2026-05-12T09:00:00.000Z"),
          recent_trade_count: 2,
          recent_trade_volume: "300.000000",
          outcome_count: 2,
          total_volume: input.totalVolume,
          outcome_id: `${input.marketId}-no`,
          outcome_label: "לא",
          outcome_short_label: "לא",
          outcome_image_url: null,
          sort_order: 1,
          last_price: "0.44000000"
        }
      ];
    }

    const rows = [
      ...rowsForBinaryMarket({
        marketId: "event-election-jul",
        eventId: "evt-election-months",
        eventSlug: "election-months-2026",
        eventTitle: "מתי יתקיימו הבחירות בישראל ב-2026?",
        eventChildLabel: "יולי",
        title: "האם הבחירות בישראל יתקיימו ביולי?",
        closeAt: new Date("2026-07-31T20:59:00.000Z"),
        totalVolume: "130.000000"
      }),
      ...rowsForBinaryMarket({
        marketId: "event-election-jun",
        eventId: "evt-election-months",
        eventSlug: "election-months-2026",
        eventTitle: "מתי יתקיימו הבחירות בישראל ב-2026?",
        eventChildLabel: "יוני",
        title: "האם הבחירות בישראל יתקיימו ביוני?",
        closeAt: new Date("2026-06-30T20:59:00.000Z"),
        totalVolume: "125.000000"
      }),
      ...rowsForBinaryMarket({
        marketId: "ordinary-market",
        title: "האם הממשלה תודיע על בחירות?",
        closeAt: new Date("2026-06-22T18:00:00.000Z"),
        totalVolume: "90.000000"
      })
    ];
    const queryable: Queryable = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (isDiscoveryCurationQuery(sql)) {
          expect(values).toBeUndefined();
          return emptyDiscoveryCurationSlots();
        }

        expect(values?.[0] === null || JSON.stringify(values?.[0]) === JSON.stringify(["politics"])).toBe(true);
        expect(values?.[1]).toBe(800);
        return { rows };
      }) as Queryable["query"]
    };

    const mainTrending = await readDiscoveryFeed(queryable, { feed: "trending" });
    const politicsTrending = await readDiscoveryFeed(queryable, {
      feed: "trending",
      category: "politics"
    });

    expect(mainTrending.items.map((item) => item.feedKey)).toEqual([
      "event:evt-election-months",
      "ordinary-market"
    ]);
    expect(mainTrending.items.some((item) => item.isEventChildCard)).toBe(false);
    expect(politicsTrending.items.filter((item) => item.isEventChildCard).map((item) => item.marketKey).sort()).toEqual([
      "event-election-jul",
      "event-election-jun"
    ]);
  });

  it("keeps a single visible category event child linked to its focused market", async () => {
    const rows = [
      {
        market_id: "disc-gta-6-direct-israel-iran-conflict",
        event_id: "event-gta-6-before-israel",
        event_slug: "what-will-happen-in-israel-before-gta-6",
        event_title: "מה יקרה בישראל לפני GTA 6?",
        event_child_label: "עימות צבאי נוסף בין ישראל ואיראן",
        event_display_flags: null,
        market_status: "open",
        title: "האם ישראל ואיראן ייכנסו לעימות צבאי נוסף לפני GTA 6?",
        description: "שוק בדיקה",
        category_key: "security",
        published_at: new Date("2026-07-01T08:00:00.000Z"),
        open_at: new Date("2026-07-01T08:00:00.000Z"),
        close_at: new Date("2026-11-18T21:59:00.000Z"),
        updated_at: new Date("2026-07-08T09:00:00.000Z"),
        recent_trade_count: 1,
        recent_trade_volume: "10.000000",
        outcome_count: 2,
        total_volume: "210.000000",
        outcome_id: "disc-gta-6-direct-israel-iran-conflict-yes",
        outcome_label: "כן",
        outcome_short_label: "כן",
        outcome_image_url: null,
        sort_order: 0,
        last_price: "0.52000000"
      },
      {
        market_id: "disc-gta-6-direct-israel-iran-conflict",
        event_id: "event-gta-6-before-israel",
        event_slug: "what-will-happen-in-israel-before-gta-6",
        event_title: "מה יקרה בישראל לפני GTA 6?",
        event_child_label: "עימות צבאי נוסף בין ישראל ואיראן",
        event_display_flags: null,
        market_status: "open",
        title: "האם ישראל ואיראן ייכנסו לעימות צבאי נוסף לפני GTA 6?",
        description: "שוק בדיקה",
        category_key: "security",
        published_at: new Date("2026-07-01T08:00:00.000Z"),
        open_at: new Date("2026-07-01T08:00:00.000Z"),
        close_at: new Date("2026-11-18T21:59:00.000Z"),
        updated_at: new Date("2026-07-08T09:00:00.000Z"),
        recent_trade_count: 1,
        recent_trade_volume: "10.000000",
        outcome_count: 2,
        total_volume: "210.000000",
        outcome_id: "disc-gta-6-direct-israel-iran-conflict-no",
        outcome_label: "לא",
        outcome_short_label: "לא",
        outcome_image_url: null,
        sort_order: 1,
        last_price: "0.48000000"
      }
    ];
    const queryable: Queryable = {
      query: vi.fn(async (sql: string) => {
        if (isDiscoveryCurationQuery(sql)) return emptyDiscoveryCurationSlots();
        return { rows };
      }) as Queryable["query"]
    };

    const mainTrending = await readDiscoveryFeed(queryable, { feed: "trending" });
    const securityTrending = await readDiscoveryFeed(queryable, {
      feed: "trending",
      category: "security"
    });

    expect(mainTrending.items[0]).toMatchObject({
      href: "/event/what-will-happen-in-israel-before-gta-6",
      isEventChildCard: false
    });
    expect(securityTrending.items[0]).toMatchObject({
      marketKey: "disc-gta-6-direct-israel-iran-conflict",
      href: "/markets/disc-gta-6-direct-israel-iran-conflict?focus=1",
      isEventChildCard: true
    });
  });

  it("uses category-owned ordering for economy feeds instead of generic updated-first sorting", async () => {
    const response = await readDiscoveryFeed(createEconomyCategoryQueryable(), {
      feed: "trending",
      category: "economy"
    });

    expect(response.category).toBe("economy");
    expect(response.items).toHaveLength(2);
    expect(response.items[0]?.marketKey).toBe("economy-volume-leader");
    expect(response.items[1]?.marketKey).toBe("economy-fresh-update");
    expect(response.featured?.marketKey).toBe("economy-volume-leader");
    expect(response.featured?.metric.label).toBe("V₪ 2.5K");
  });

  it("exposes matchup shape and outcome roles for sports cards", async () => {
    const sportsContract = {
      objectType: "market_contract_v1",
      resultShape: "three_way_result",
      resolutionSource: {
        sourceIds: ["src_ifa_fixtures_results"]
      }
    };
    const queryable: Queryable = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (isDiscoveryCurationQuery(sql)) {
          expect(values).toBeUndefined();
          return emptyDiscoveryCurationSlots();
        }

        if (sql.includes("from trades t")) {
          expect(values).toEqual([["sports-matchup-market"]]);
          return { rows: [] };
        }

        expect(values).toEqual([null, 800]);

        return {
          rows: [
            {
              market_id: "sports-matchup-market",
              market_status: "open",
              title: "מי ינצח במשחק?",
              description: "שוק ספורט",
              category_key: "sports",
              market_contract: sportsContract,
              published_at: new Date("2026-05-12T08:00:00.000Z"),
              open_at: new Date("2026-05-12T08:00:00.000Z"),
              close_at: new Date("2026-05-13T02:00:00.000Z"),
              updated_at: new Date("2026-05-12T09:00:00.000Z"),
              outcome_count: 3,
              total_volume: "900.000000",
              outcome_id: "sports-matchup-market-home",
              outcome_label: "מכבי",
              outcome_short_label: "מכבי",
              outcome_image_url: null,
              sort_order: 0,
              last_price: "0.44000000"
            },
            {
              market_id: "sports-matchup-market",
              market_status: "open",
              title: "מי ינצח במשחק?",
              description: "שוק ספורט",
              category_key: "sports",
              market_contract: sportsContract,
              published_at: new Date("2026-05-12T08:00:00.000Z"),
              open_at: new Date("2026-05-12T08:00:00.000Z"),
              close_at: new Date("2026-05-13T02:00:00.000Z"),
              updated_at: new Date("2026-05-12T09:00:00.000Z"),
              outcome_count: 3,
              total_volume: "900.000000",
              outcome_id: "sports-matchup-market-draw",
              outcome_label: "תיקו",
              outcome_short_label: "תיקו",
              outcome_image_url: null,
              sort_order: 1,
              last_price: "0.12000000"
            },
            {
              market_id: "sports-matchup-market",
              market_status: "open",
              title: "מי ינצח במשחק?",
              description: "שוק ספורט",
              category_key: "sports",
              market_contract: sportsContract,
              published_at: new Date("2026-05-12T08:00:00.000Z"),
              open_at: new Date("2026-05-12T08:00:00.000Z"),
              close_at: new Date("2026-05-13T02:00:00.000Z"),
              updated_at: new Date("2026-05-12T09:00:00.000Z"),
              outcome_count: 3,
              total_volume: "900.000000",
              outcome_id: "sports-matchup-market-away",
              outcome_label: "הפועל",
              outcome_short_label: "הפועל",
              outcome_image_url: null,
              sort_order: 2,
              last_price: "0.44000000"
            }
          ]
        };
      }) as Queryable["query"]
    };

    const response = await readDiscoveryFeed(queryable, { feed: "trending" });

    expect(response.items).toHaveLength(1);
    expect(response.items[0]).toMatchObject({
      marketKey: "sports-matchup-market",
      shape: "matchup",
      category: {
        key: "sports"
      },
      sports: {
        sport: {
          key: "football",
          label: "כדורגל"
        },
        league: {
          key: "israeli-football",
          label: "כדורגל ישראלי"
        },
        sourceIds: ["src_ifa_fixtures_results"],
        resultShape: "three_way_result",
        matchupKind: "three_way",
        hasDraw: true
      }
    });
    expect(response.items[0].outcomes.map((outcome) => outcome.role)).toEqual([
      "side_a",
      "draw",
      "side_b"
    ]);
    expect(response.items[0].preview.topOutcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "מכבי", role: "side_a" }),
        expect.objectContaining({ label: "תיקו", role: "draw" }),
        expect.objectContaining({ label: "הפועל", role: "side_b" })
      ])
    );
  });

  it("hydrates basketball team assets without falling back to football aliases", async () => {
    const basketballContract = {
      objectType: "market_contract_v1",
      resultShape: "home_away_winner",
      resolutionSource: {
        sourceIds: ["src_winner_league_basketball"]
      }
    };
    const queryable: Queryable = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (isDiscoveryCurationQuery(sql)) {
          expect(values).toBeUndefined();
          return emptyDiscoveryCurationSlots();
        }

        if (sql.includes("from trades t")) {
          expect(values).toEqual([["basketball-matchup-market"]]);
          return { rows: [] };
        }

        expect(values).toEqual([null, 800]);

        return {
          rows: [
            {
              market_id: "basketball-matchup-market",
              market_status: "open",
              title: "מי תנצח בכדורסל?",
              description: "שוק כדורסל",
              category_key: "sports",
              market_contract: basketballContract,
              published_at: new Date("2026-05-12T08:00:00.000Z"),
              open_at: new Date("2026-05-12T08:00:00.000Z"),
              close_at: new Date("2026-05-13T02:00:00.000Z"),
              updated_at: new Date("2026-05-12T09:00:00.000Z"),
              outcome_count: 2,
              total_volume: "900.000000",
              outcome_id: "basketball-matchup-market-home",
              outcome_label: "מכבי תל אביב",
              outcome_short_label: "מכבי תל אביב",
              outcome_image_url: null,
              sort_order: 0,
              last_price: "0.50000000"
            },
            {
              market_id: "basketball-matchup-market",
              market_status: "open",
              title: "מי תנצח בכדורסל?",
              description: "שוק כדורסל",
              category_key: "sports",
              market_contract: basketballContract,
              published_at: new Date("2026-05-12T08:00:00.000Z"),
              open_at: new Date("2026-05-12T08:00:00.000Z"),
              close_at: new Date("2026-05-13T02:00:00.000Z"),
              updated_at: new Date("2026-05-12T09:00:00.000Z"),
              outcome_count: 2,
              total_volume: "900.000000",
              outcome_id: "basketball-matchup-market-away",
              outcome_label: "הפועל ירושלים",
              outcome_short_label: "הפועל ירושלים",
              outcome_image_url: null,
              sort_order: 1,
              last_price: "0.50000000"
            }
          ]
        };
      }) as Queryable["query"]
    };

    const response = await readDiscoveryFeed(queryable, { feed: "trending" });

    expect(response.items[0]).toMatchObject({
      shape: "matchup",
      sports: {
        sport: {
          key: "basketball",
          label: "כדורסל"
        },
        league: {
          key: "winner-league",
          label: "ליגת Winner סל"
        },
        matchupKind: "two_way",
        hasDraw: false
      },
      sportsTeams: {
        home: {
          crestPath: "/assets/images/sports/basketball/il-winner-league/maccabi-tel-aviv.svg"
        },
        away: {
          crestPath: "/assets/images/sports/basketball/il-winner-league/hapoel-jerusalem.svg"
        }
      }
    });
  });

  it("overlays the authenticated viewer's largest open position per discovery card", async () => {
    const queryable: Queryable = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (isDiscoveryCurationQuery(sql)) {
          expect(values).toBeUndefined();
          return emptyDiscoveryCurationSlots();
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
                shares: "25.000000",
                cost_basis: "10.000000",
                current_price: "0.60000000"
              }
            ]
          };
        }

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
      }) as Queryable["query"]
    };

    const response = await readDiscoveryFeed(queryable, {
      feed: "trending",
      viewerUserId: "user_viewer_1"
    });

    expect(response.items).toHaveLength(1);
    expect(response.items[0].viewerPosition).toMatchObject({
      side: "yes",
      shares: 25,
      averageCost: 0.4,
      pnlLabel: "V₪ +5",
      outcomeKey: "viewer-position-market-yes",
      contractSide: "yes"
    });
  });

  it("honors hero curation settings without auto-filling beyond pinned cards", async () => {
    const row = (
      marketId: string,
      outcomeId: string,
      outcomeLabel: string,
      sortOrder: number,
      lastPrice: string,
      totalVolume: string,
      updatedAt: string
    ) => ({
      market_id: marketId,
      market_status: "open",
      title: marketId,
      description: "שוק בדיקה",
      category_key: "sports",
      published_at: new Date("2026-05-12T08:00:00.000Z"),
      open_at: new Date("2026-05-12T08:00:00.000Z"),
      close_at: new Date("2026-08-13T02:00:00.000Z"),
      updated_at: new Date(updatedAt),
      outcome_count: 2,
      total_volume: totalVolume,
      outcome_id: outcomeId,
      outcome_label: outcomeLabel,
      outcome_short_label: outcomeLabel,
      outcome_image_url: null,
      sort_order: sortOrder,
      last_price: lastPrice
    });
    const queryable: Queryable = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes("from discovery_curation_slots")) {
          expect(values).toBeUndefined();
          return {
            rows: [
              { surface: "hero", position: 1, target_type: "market", target_key: "pin-1", note: null },
              { surface: "hero", position: 2, target_type: "market", target_key: "pin-2", note: null }
            ]
          };
        }

        if (sql.includes("from discovery_curation_settings")) {
          expect(values).toBeUndefined();
          return {
            rows: [
              { surface: "hero", max_items: 5, fill: false, note: "operator pinned-only hero" }
            ]
          };
        }

        if (sql.includes("from trades t")) {
          expect(values).toEqual([["pin-1", "pin-2", "auto-3"]]);
          return { rows: [] };
        }

        expect(values).toEqual([null, 800]);

        return {
          rows: [
            row("pin-1", "pin-1-yes", "כן", 0, "0.60000000", "100.000000", "2026-05-12T10:00:00.000Z"),
            row("pin-1", "pin-1-no", "לא", 1, "0.40000000", "100.000000", "2026-05-12T10:00:00.000Z"),
            row("pin-2", "pin-2-yes", "כן", 0, "0.55000000", "90.000000", "2026-05-12T09:00:00.000Z"),
            row("pin-2", "pin-2-no", "לא", 1, "0.45000000", "90.000000", "2026-05-12T09:00:00.000Z"),
            row("auto-3", "auto-3-yes", "כן", 0, "0.52000000", "500.000000", "2026-05-12T11:00:00.000Z"),
            row("auto-3", "auto-3-no", "לא", 1, "0.48000000", "500.000000", "2026-05-12T11:00:00.000Z")
          ]
        };
      }) as Queryable["query"]
    };

    const response = await readDiscoveryFeed(queryable, { feed: "trending" });

    expect(response.items.map((item) => item.marketKey)).toContain("auto-3");
    expect(response.heroItems?.map((item) => item.marketKey)).toEqual(["pin-1", "pin-2"]);
  });
});
