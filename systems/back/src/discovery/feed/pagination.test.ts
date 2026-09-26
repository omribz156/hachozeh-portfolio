import { describe, expect, it } from "vitest";

import {
  paginateDiscoveryFeed,
  parseDiscoveryLimit
} from "./pagination";
import type { DiscoveryFeedItem, DiscoveryFeedResponse } from "./types";

function item(marketKey: string, feedKey = marketKey): DiscoveryFeedItem {
  return { feedKey, marketKey } as DiscoveryFeedItem;
}

function feed(items: DiscoveryFeedItem[]): DiscoveryFeedResponse {
  return {
    feed: "trending",
    category: null,
    generatedAt: "2026-07-01T00:00:00.000Z",
    featured: null,
    items
  };
}

describe("discovery feed pagination", () => {
  it("clamps requested limits", () => {
    expect(parseDiscoveryLimit(null)).toBeNull();
    expect(parseDiscoveryLimit("0")).toBe(1);
    expect(parseDiscoveryLimit("not-a-number")).toBe(16);
    expect(parseDiscoveryLimit("200")).toBe(48);
  });

  it("returns a cursor for the next page", () => {
    const firstPage = paginateDiscoveryFeed(feed([
      item("market-a"),
      item("market-b"),
      item("market-c")
    ]), {
      limit: 2,
      cursor: null
    });

    const secondPage = paginateDiscoveryFeed(feed([
      item("market-a"),
      item("market-b"),
      item("market-c")
    ]), {
      limit: 2,
      cursor: firstPage.pagination?.nextCursor ?? null
    });

    expect(firstPage.items.map((entry) => entry.marketKey)).toEqual(["market-a", "market-b"]);
    expect(firstPage.pagination).toMatchObject({
      limit: 2,
      hasMore: true,
      totalAvailable: 3
    });
    expect(typeof firstPage.pagination?.nextCursor).toBe("string");
    expect(secondPage.items.map((entry) => entry.marketKey)).toEqual(["market-c"]);
    expect(secondPage.pagination).toEqual({
      limit: 2,
      nextCursor: null,
      hasMore: false,
      totalAvailable: 3
    });
  });

  it("treats invalid cursors as a first-page request", () => {
    const page = paginateDiscoveryFeed(feed([item("market-a"), item("market-b")]), {
      limit: 1,
      cursor: "bad-cursor"
    });

    expect(page.items.map((entry) => entry.marketKey)).toEqual(["market-a"]);
  });

  it("uses feed keys so event parent and child cards can share a market key", () => {
    const payload = feed([
      item("representative-market", "event:event-1"),
      item("representative-market"),
      item("next-market")
    ]);
    const firstPage = paginateDiscoveryFeed(payload, {
      limit: 1,
      cursor: null
    });
    const secondPage = paginateDiscoveryFeed(payload, {
      limit: 1,
      cursor: firstPage.pagination?.nextCursor ?? null
    });

    expect(firstPage.items.map((entry) => entry.feedKey)).toEqual(["event:event-1"]);
    expect(secondPage.items.map((entry) => entry.feedKey)).toEqual(["representative-market"]);
  });
});
