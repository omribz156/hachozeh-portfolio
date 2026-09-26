import { describe, expect, it } from "vitest";

import {
  filterNewManualSignals,
  parseGoogleTrendingRss,
  toGoogleTrendingManualSignals
} from "../../../seer/src/google-trending";

const trendingRssFixture = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<rss xmlns:ht="https://trends.google.com/trending/rss" version="2.0">
  <channel>
    <item>
      <title>יונה יהב</title>
      <ht:approx_traffic>200+</ht:approx_traffic>
      <pubDate>Wed, 8 Apr 2026 02:20:00 -0700</pubDate>
      <ht:news_item>
        <ht:news_item_title>יונה יהב &quot;חזר&quot;</ht:news_item_title>
        <ht:news_item_url>https://example.com/story-1</ht:news_item_url>
        <ht:news_item_source>ynet</ht:news_item_source>
      </ht:news_item>
    </item>
    <item>
      <title>כדורסל</title>
      <ht:approx_traffic>5000+</ht:approx_traffic>
      <pubDate>Wed, 8 Apr 2026 03:20:00 -0700</pubDate>
      <ht:news_item>
        <ht:news_item_title>הפועל ת&quot;א</ht:news_item_title>
        <ht:news_item_url>https://example.com/story-2</ht:news_item_url>
        <ht:news_item_source>ספורט 5</ht:news_item_source>
      </ht:news_item>
    </item>
  </channel>
</rss>`;

describe("google trending rss", () => {
  it("parses the live rss shape into topics", () => {
    const topics = parseGoogleTrendingRss(trendingRssFixture);

    expect(topics).toHaveLength(2);
    expect(topics[0]).toMatchObject({
      title: "יונה יהב",
      approxTraffic: "200+"
    });
    expect(topics[0]?.newsItems[0]).toMatchObject({
      title: 'יונה יהב "חזר"',
      source: "ynet"
    });
  });

  it("turns hebrew trends into stable manual signals and dedupes them", () => {
    const generatedAt = "2026-04-08T10:00:00.000Z";
    const signals = toGoogleTrendingManualSignals(parseGoogleTrendingRss(trendingRssFixture), generatedAt);

    expect(signals[0]?.signalId.length).toBeGreaterThan(20);
    expect(signals[0]?.clusterHint).toContain("יונה_יהב");
    expect(signals[0]?.sourceId).toBe("src_google_trending_il");
    expect(signals[0]?.notes).toContain('ynet: יונה יהב "חזר" | https://example.com/story-1');

    const deduped = filterNewManualSignals([signals[0]!], signals);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.title).toBe("כדורסל");
  });
});
