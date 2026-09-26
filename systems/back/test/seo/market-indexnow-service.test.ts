import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildMarketIndexNowUrls,
  pingMarketIndexNow
} from "../../src/seo/market-indexnow-service";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("market IndexNow service", () => {
  it("builds the canonical event URL and visible tag hubs without duplicates", () => {
    expect(buildMarketIndexNowUrls("market_dynamic", {
      event_slug: "israel-election-2026",
      tag_slugs: ["politics", "benjamin-netanyahu", "politics"]
    })).toEqual([
      "https://hachozeh.com/event/israel-election-2026",
      "https://hachozeh.com/t/politics",
      "https://hachozeh.com/t/benjamin-netanyahu"
    ]);
  });

  it("falls back to the public market route when no event exists", () => {
    expect(buildMarketIndexNowUrls("market/new one", {
      event_slug: null,
      tag_slugs: []
    })).toEqual(["https://hachozeh.com/markets/market%2Fnew%20one"]);
  });

  it("reads public paths and submits them asynchronously", async () => {
    const query = vi.fn(async () => ({
      rows: [{ event_slug: "world-cup-final", tag_slugs: ["football"] }]
    }));
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    pingMarketIndexNow({ query } as never, "market_final");

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(query).toHaveBeenCalledWith(expect.stringContaining("from markets m"), ["market_final"]);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      urlList: [
        "https://hachozeh.com/event/world-cup-final",
        "https://hachozeh.com/t/football"
      ]
    });
  });

  it("warns when the market URL lookup fails without throwing into the caller", async () => {
    const query = vi.fn(async () => {
      throw new Error("database unavailable");
    });
    const warn = vi.fn();

    expect(() => pingMarketIndexNow({ query } as never, "market_final", { warn })).not.toThrow();

    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(
      "indexnow.market_url_lookup_failed",
      {
        marketId: "market_final",
        error: "Error: database unavailable"
      }
    ));
  });

  it("warns on a non-ok IndexNow response without affecting the caller", async () => {
    const query = vi.fn(async () => ({
      rows: [{ event_slug: "world-cup-final", tag_slugs: [] }]
    }));
    const fetchMock = vi.fn(async () => ({ ok: false, status: 503 }));
    const warn = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(() => pingMarketIndexNow({ query } as never, "market_final", { warn })).not.toThrow();

    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(
      "indexnow.submit_non_ok",
      { status: 503, count: 1 }
    ));
  });
});
