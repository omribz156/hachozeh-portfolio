import { describe, expect, it } from "vitest";

import { buildDiscoveryGroups } from "./discovery/feed/event-groups";
import { buildFeedItem } from "./discovery/feed/presenter";
import type { DiscoveryFeedRow } from "./discovery/feed/types";

function row(overrides: Partial<DiscoveryFeedRow>): DiscoveryFeedRow {
  const now = new Date("2026-07-01T00:00:00.000Z");

  return {
    market_id: "disc-child-a",
    event_id: "event-gta-6-before-israel-2026",
    event_slug: "what-will-happen-in-israel-before-gta-6",
    event_title: "מה יקרה בישראל לפני GTA 6?",
    event_icon: "/assets/images/market-photos/gta-6-before-israel/what-will-happen.webp",
    event_display_flags: null,
    event_child_label: "ילד",
    market_status: "open",
    persisted_status: "open",
    title: "האם משהו יקרה לפני GTA 6?",
    description: null,
    category_key: "culture",
    published_at: now,
    open_at: now,
    close_at: new Date("2026-11-18T21:59:00.000Z"),
    settlement_status: null,
    market_resolved_at: null,
    resolution_source: "מקור",
    resolution_rules: "כללים",
    market_contract: {
      objectType: "market_contract_v1",
      image: {
        src: "/assets/images/market-photos/gta-6-before-israel/iran-vs-israel.webp",
        alt: "ילד"
      }
    },
    winning_outcome_id: null,
    winning_outcome_label: null,
    resolution_source_url: null,
    resolution_note: null,
    resolution_resolved_at: null,
    updated_at: now,
    recent_trade_count: 0,
    recent_trade_volume: "0",
    outcome_count: 2,
    total_volume: "0",
    outcome_id: "disc-child-a-yes",
    outcome_label: "כן",
    outcome_short_label: "כן",
    outcome_image_url: null,
    sort_order: 0,
    last_price: "0.5",
    ...overrides
  };
}

describe("discovery event images", () => {
  it("hydrates Wimbledon player matchups into sports team-style cards", () => {
    const item = buildFeedItem([
      row({
        market_id: "disc-wimbledon-fery-zverev",
        event_id: "event-wimbledon-fery-zverev",
        event_slug: "wimbledon-fery-zverev-2026-07-10",
        event_title: "פרי נגד זברב",
        event_icon: "/assets/images/market-photos/tennis-stars/fery-zverev.webp",
        event_child_label: "מנצח",
        title: "פרי נגד זברב",
        category_key: "sports",
        market_contract: {
          objectType: "market_contract_v1",
          resultShape: "home_away_winner",
          resolutionSource: {
            sourceIds: ["src_wimbledon_official"]
          }
        },
        outcome_count: 2,
        outcome_id: "disc-wimbledon-fery-zverev-outcome-0",
        outcome_label: "ארתור פרי",
        outcome_short_label: "פרי",
        sort_order: 0,
        last_price: "0.5"
      }),
      row({
        market_id: "disc-wimbledon-fery-zverev",
        event_id: "event-wimbledon-fery-zverev",
        event_slug: "wimbledon-fery-zverev-2026-07-10",
        event_title: "פרי נגד זברב",
        event_icon: "/assets/images/market-photos/tennis-stars/fery-zverev.webp",
        event_child_label: "מנצח",
        title: "פרי נגד זברב",
        category_key: "sports",
        market_contract: {
          objectType: "market_contract_v1",
          resultShape: "home_away_winner",
          resolutionSource: {
            sourceIds: ["src_wimbledon_official"]
          }
        },
        outcome_count: 2,
        outcome_id: "disc-wimbledon-fery-zverev-outcome-1",
        outcome_label: "אלכסנדר זברב",
        outcome_short_label: "זברב",
        sort_order: 1,
        last_price: "0.5"
      })
    ]);

    expect(item?.shape).toBe("matchup");
    expect(item?.sports?.sport).toEqual({ key: "tennis", label: "טניס" });
    expect(item?.sports?.league).toEqual({ key: "wimbledon", label: "ווימבלדון" });
    expect(item?.sportsTeams?.home?.displayName).toBe("ארתור פרי");
    expect(item?.sportsTeams?.home?.crestPath).toBe("/assets/images/market-photos/tennis-stars/arthur-fery.webp");
    expect(item?.sportsTeams?.away?.displayName).toBe("אלכסנדר זברב");
    expect(item?.sportsTeams?.away?.crestPath).toBe("/assets/images/market-photos/tennis-stars/alexander-zverev.webp");
  });

  it("uses the parent event icon for multi-child event cards", () => {
    const groups = buildDiscoveryGroups(new Map([
      ["disc-child-a", [
        row({
          market_id: "disc-child-a",
          event_child_label: "עימות",
          outcome_id: "disc-child-a-yes",
          outcome_label: "כן",
          sort_order: 0
        }),
        row({
          market_id: "disc-child-a",
          event_child_label: "עימות",
          outcome_id: "disc-child-a-no",
          outcome_label: "לא",
          sort_order: 1,
          last_price: "0.5"
        })
      ]],
      ["disc-child-b", [
        row({
          market_id: "disc-child-b",
          event_child_label: "בחירות",
          outcome_id: "disc-child-b-yes",
          outcome_label: "כן",
          sort_order: 0,
          market_contract: {
            objectType: "market_contract_v1",
            image: {
              src: "/assets/images/market-photos/gta-6-before-israel/election.webp",
              alt: "בחירות"
            }
          }
        }),
        row({
          market_id: "disc-child-b",
          event_child_label: "בחירות",
          outcome_id: "disc-child-b-no",
          outcome_label: "לא",
          sort_order: 1,
          last_price: "0.5"
        })
      ]]
    ]));

    const item = buildFeedItem(groups[0]?.rows ?? []);

    expect(item?.event?.eventSlug).toBe("what-will-happen-in-israel-before-gta-6");
    expect(item?.image?.src).toBe("/assets/images/market-photos/gta-6-before-israel/what-will-happen.webp");
    expect(item?.image?.alt).toBe("מה יקרה בישראל לפני GTA 6?");
  });

  it("keeps multi-child events collapsed to the parent card by default", () => {
    const groups = buildDiscoveryGroups(new Map([
      ["disc-child-a", [
        row({ market_id: "disc-child-a", event_child_label: "עימות" })
      ]],
      ["disc-child-b", [
        row({ market_id: "disc-child-b", event_child_label: "בחירות" })
      ]]
    ]));

    expect(groups.map((group) => group.groupKey)).toEqual([
      "event:event-gta-6-before-israel-2026"
    ]);
  });

  it("can show both the parent event card and child market cards in discovery", () => {
    const groups = buildDiscoveryGroups(new Map([
      ["disc-child-a", [
        row({
          market_id: "disc-child-a",
          event_child_label: "נתניהו",
          event_display_flags: {
            showParentInDiscovery: true,
            showChildrenInDiscovery: true
          }
        })
      ]],
      ["disc-child-b", [
        row({
          market_id: "disc-child-b",
          event_child_label: "יאיר גולן",
          event_display_flags: {
            showParentInDiscovery: true,
            showChildrenInDiscovery: true
          }
        })
      ]]
    ]));

    expect(groups.map((group) => group.groupKey)).toEqual([
      "event:event-gta-6-before-israel-2026",
      "market:disc-child-a",
      "market:disc-child-b"
    ]);

    const parentItem = buildFeedItem(groups[0]?.rows ?? []);
    const firstChildItem = buildFeedItem(groups[1]?.rows ?? []);

    expect(parentItem?.href).toBe("/event/what-will-happen-in-israel-before-gta-6");
    expect(parentItem?.event?.childMarketKeys).toEqual(["disc-child-a", "disc-child-b"]);
    expect(firstChildItem?.href).toBe("/markets/disc-child-a?focus=1");
    expect(firstChildItem?.event).toBeNull();
  });
});
