import { describe, expect, it } from "vitest";

import { applyDiscoveryCuration, type DiscoveryCurationSlot } from "./curation";
import type { DiscoveryFeedItem } from "./types";

function item(
  marketKey: string,
  event?: NonNullable<DiscoveryFeedItem["event"]>
): DiscoveryFeedItem {
  return {
    feedKey: event ? `event:${event.eventKey}` : marketKey,
    marketKey,
    href: `/markets/${marketKey}`,
    event: event ?? null,
    marketStatus: "open",
    shape: "binary",
    title: marketKey,
    description: null,
    category: { key: "politics", label: "פוליטיקה" },
    closeAt: "2026-07-10T00:00:00.000Z",
    closeLabel: "",
    updatedAt: "2026-07-01T00:00:00.000Z",
    updatedLabel: "",
    publishedAt: "2026-07-01T00:00:00.000Z",
    settlementStatus: null,
    resolvedAt: null,
    lifecycle: {} as DiscoveryFeedItem["lifecycle"],
    winner: null,
    result: {} as DiscoveryFeedItem["result"],
    image: null,
    volume: { value: "0", label: "0" },
    activity: {
      recentTradeCount: 0,
      recentTradeVolume: { value: "0", label: "0" }
    },
    viewerPosition: null,
    movement: null,
    outcomes: [],
    preview: { marketType: "binary", topOutcomes: [] },
    signals: []
  };
}

function slot(
  surface: DiscoveryCurationSlot["surface"],
  position: number,
  targetKey: string,
  targetType: DiscoveryCurationSlot["targetType"] = "market"
): DiscoveryCurationSlot {
  return {
    surface,
    position,
    targetType,
    targetKey,
    note: null
  };
}

describe("applyDiscoveryCuration", () => {
  it("moves pinned trending slots first and fills with automatic order", () => {
    const items = [item("auto-1"), item("pin-2"), item("auto-3")];

    const curated = applyDiscoveryCuration(items, [slot("trending", 1, "pin-2")], "trending");

    expect(curated.map((entry) => entry.marketKey)).toEqual(["pin-2", "auto-1", "auto-3"]);
  });

  it("builds hero slots by explicit order then fills to limit", () => {
    const items = [item("auto-1"), item("pin-2"), item("auto-3"), item("pin-4")];
    const curated = applyDiscoveryCuration(
      items,
      [slot("hero", 2, "pin-4"), slot("hero", 1, "pin-2")],
      "hero",
      { limit: 3, fill: true }
    );

    expect(curated.map((entry) => entry.marketKey)).toEqual(["pin-2", "pin-4", "auto-1"]);
  });

  it("can build pinned-only hero slots without automatic fill", () => {
    const items = [item("auto-1"), item("pin-2"), item("auto-3"), item("pin-4")];
    const curated = applyDiscoveryCuration(
      items,
      [slot("hero", 2, "pin-4"), slot("hero", 1, "pin-2")],
      "hero",
      { limit: 5, fill: false }
    );

    expect(curated.map((entry) => entry.marketKey)).toEqual(["pin-2", "pin-4"]);
  });

  it("can target event cards by event slug", () => {
    const eventItem = item("representative", {
      eventKey: "event_1",
      eventSlug: "fifa-pack",
      publicPath: "/event/fifa-pack",
      parentKey: "event_1",
      representativeMarketKey: "representative",
      childMarketKeys: ["child_1"]
    });
    const curated = applyDiscoveryCuration(
      [item("auto-1"), eventItem],
      [slot("hero", 1, "fifa-pack", "event")],
      "hero",
      { limit: 1, fill: true }
    );

    expect(curated.map((entry) => entry.marketKey)).toEqual(["representative"]);
  });
});
