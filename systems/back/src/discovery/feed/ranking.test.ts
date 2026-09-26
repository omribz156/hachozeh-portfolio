import { describe, expect, it } from "vitest";

import {
  buildDiscoveryComparator,
  diversifyDiscoveryItems,
  normalizeFeed
} from "./ranking";
import type { DiscoveryFeedItem } from "./types";

function item(
  key: string,
  overrides: Partial<DiscoveryFeedItem> & {
    categoryKey?: string | null;
    recentTradeVolume?: string;
    recentTradeCount?: number;
    volumeValue?: string;
    updatedAt?: string;
    shape?: DiscoveryFeedItem["shape"];
  } = {}
): DiscoveryFeedItem {
  const categoryKey = overrides.categoryKey ?? "politics";
  const volume = overrides.volumeValue ?? "0";
  const recentTradeVolume = overrides.recentTradeVolume ?? "0";

  return {
    feedKey: key,
    marketKey: key,
    href: `/markets/${key}`,
    event: null,
    marketStatus: "open",
    shape: overrides.shape ?? "binary",
    title: key,
    description: null,
    category: {
      key: categoryKey,
      label: categoryKey ?? "שווקים"
    },
    closeAt: "2026-07-10T00:00:00.000Z",
    closeLabel: "",
    updatedAt: overrides.updatedAt ?? "2026-07-01T00:00:00.000Z",
    updatedLabel: "",
    publishedAt: "2026-07-01T00:00:00.000Z",
    settlementStatus: null,
    resolvedAt: null,
    lifecycle: {} as DiscoveryFeedItem["lifecycle"],
    winner: null,
    result: {} as DiscoveryFeedItem["result"],
    image: null,
    volume: {
      value: volume,
      label: volume
    },
    activity: {
      recentTradeCount: overrides.recentTradeCount ?? 0,
      recentTradeVolume: {
        value: recentTradeVolume,
        label: recentTradeVolume
      }
    },
    viewerPosition: null,
    movement: null,
    outcomes: [],
    preview: {
      marketType: "binary",
      topOutcomes: []
    },
    signals: [],
    ...overrides
  };
}

describe("buildDiscoveryComparator", () => {
  it("accepts closing as a first-class feed", () => {
    expect(normalizeFeed("closing")).toBe("closing");
  });

  it("ranks trending by interaction before freshness", () => {
    const quietFresh = item("quiet-fresh", {
      updatedAt: "2026-07-01T12:00:00.000Z",
      volumeValue: "0",
      recentTradeVolume: "0",
      recentTradeCount: 0
    });
    const tradedOlder = item("traded-older", {
      updatedAt: "2026-07-01T10:00:00.000Z",
      volumeValue: "100",
      recentTradeVolume: "50",
      recentTradeCount: 2
    });

    const sorted = [quietFresh, tradedOlder].sort(buildDiscoveryComparator("trending", null));

    expect(sorted.map((entry) => entry.marketKey)).toEqual(["traded-older", "quiet-fresh"]);
  });

  it("ranks closing by earliest close time before activity", () => {
    const higherVolumeLater = item("higher-volume-later", {
      closeAt: "2026-07-02T20:00:00.000Z",
      recentTradeVolume: "500",
      recentTradeCount: 5,
      volumeValue: "1000"
    });
    const urgentLowerVolume = item("urgent-lower-volume", {
      closeAt: "2026-07-02T18:00:00.000Z",
      recentTradeVolume: "10",
      recentTradeCount: 1,
      volumeValue: "20"
    });

    const sorted = [higherVolumeLater, urgentLowerVolume].sort(
      buildDiscoveryComparator("closing", null)
    );

    expect(sorted.map((entry) => entry.marketKey)).toEqual([
      "urgent-lower-volume",
      "higher-volume-later"
    ]);
  });
});

describe("diversifyDiscoveryItems", () => {
  it("avoids adjacent market type clusters when alternatives exist", () => {
    const ranked = [
      item("sports-1", { categoryKey: "sports", shape: "matchup" }),
      item("sports-2", { categoryKey: "sports", shape: "matchup" }),
      item("politics-1", { categoryKey: "politics", shape: "multi" }),
      item("economy-1", { categoryKey: "economy", shape: "binary" })
    ];

    const diversified = diversifyDiscoveryItems(ranked);

    expect(diversified.map((entry) => entry.marketKey)).toEqual([
      "sports-1",
      "politics-1",
      "sports-2",
      "economy-1"
    ]);
  });
});
