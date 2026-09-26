import type { ManualSeerSignal } from "./contracts";
import { slugify } from "./text";

export const GOOGLE_TRENDING_IL_SOURCE_ID = "src_google_trending_il";
export const GOOGLE_TRENDING_IL_FEED_URL = "https://trends.google.com/trending/rss?geo=IL";
export const GOOGLE_TRENDING_IL_PAGE_URL = "https://trends.google.com/trending?geo=IL";

export type GoogleTrendingNewsItem = {
  title: string;
  url?: string;
  source?: string;
};

export type GoogleTrendingTopic = {
  title: string;
  approxTraffic?: string;
  publishedAt: string;
  newsItems: GoogleTrendingNewsItem[];
};

function escapeTag(tag: string): string {
  return tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function readTag(block: string, tag: string): string | undefined {
  const match = block.match(new RegExp(`<${escapeTag(tag)}>([\\s\\S]*?)</${escapeTag(tag)}>`, "i"));
  return match ? decodeXmlEntities(match[1] ?? "") : undefined;
}

function readAllBlocks(block: string, tag: string): string[] {
  return [...block.matchAll(new RegExp(`<${escapeTag(tag)}>([\\s\\S]*?)</${escapeTag(tag)}>`, "gi"))].map(
    (match) => match[1] ?? ""
  );
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function buildTopicSummary(topic: GoogleTrendingTopic): string {
  const sources = unique(topic.newsItems.map((item) => item.source).filter((source): source is string => Boolean(source)));
  const sourceSummary = sources.length > 0 ? ` Coverage sources: ${sources.join(", ")}.` : "";
  const trafficSummary = topic.approxTraffic ? ` Approx traffic: ${topic.approxTraffic}.` : "";

  return `Google Trends IL shows "${topic.title}" as an active trend.${trafficSummary}${sourceSummary}`.trim();
}

function buildTopicNotes(topic: GoogleTrendingTopic): string[] | undefined {
  const notes = [
    ...(topic.approxTraffic ? [`approx-traffic=${topic.approxTraffic}`] : []),
    ...topic.newsItems
      .slice(0, 5)
      .map((item) => {
        const source = item.source ?? "news";
        const title = item.title.trim();

        if (item.url && title.length > 0) {
          return `${source}: ${title} | ${item.url}`;
        }

        if (item.url) {
          return `${source}: ${item.url}`;
        }

        if (title.length > 0) {
          return `${source}: ${title}`;
        }

        return undefined;
      })
      .filter((note): note is string => Boolean(note))
  ];

  return notes.length > 0 ? notes : undefined;
}

export function parseGoogleTrendingRss(xml: string): GoogleTrendingTopic[] {
  const topics: Array<GoogleTrendingTopic | undefined> = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)]
    .map((match) => match[1] ?? "")
    .map((itemBlock) => {
      const title = readTag(itemBlock, "title");
      const pubDate = readTag(itemBlock, "pubDate");

      if (!title || !pubDate) {
        return undefined;
      }

      const publishedAt = new Date(pubDate).toISOString();
      const newsItems = readAllBlocks(itemBlock, "ht:news_item")
        .map((newsBlock) => ({
          title: readTag(newsBlock, "ht:news_item_title") ?? "",
          url: readTag(newsBlock, "ht:news_item_url"),
          source: readTag(newsBlock, "ht:news_item_source")
        }))
        .filter((newsItem) => newsItem.title.length > 0 || Boolean(newsItem.url));

      return {
        title,
        approxTraffic: readTag(itemBlock, "ht:approx_traffic"),
        publishedAt,
        newsItems
      } satisfies GoogleTrendingTopic;
    });

  return topics.filter((topic): topic is GoogleTrendingTopic => topic !== undefined);
}

export function toGoogleTrendingManualSignals(
  topics: GoogleTrendingTopic[],
  generatedAt: string
): ManualSeerSignal[] {
  return topics.map((topic) => {
    const titleSlug = slugify(topic.title);

    return {
      objectType: "manual_seer_signal",
      signalId: `msig_google_trending_il_${slugify(`${topic.publishedAt}_${topic.title}`)}`,
      sourceId: GOOGLE_TRENDING_IL_SOURCE_ID,
      title: topic.title,
      summary: buildTopicSummary(topic),
      category: "general",
      whyNow: topic.approxTraffic
        ? `"${topic.title}" is trending in Israel right now at roughly ${topic.approxTraffic}.`
        : `"${topic.title}" is trending in Israel right now.`,
      observedAt: topic.publishedAt,
      importedAt: generatedAt,
      sourceRef: `${GOOGLE_TRENDING_IL_PAGE_URL}#${titleSlug}`,
      sourceLabel: "Google Trending IL",
      clusterHint: `google_trending_il_${titleSlug}`,
      lineageHint: `google_trending_il_${titleSlug}`,
      keyEntities: [topic.title],
      notes: buildTopicNotes(topic),
      tags: ["google-trending", "geo-il", "heartbeat"]
    };
  });
}

export function filterNewManualSignals(
  existingSignals: ManualSeerSignal[],
  incomingSignals: ManualSeerSignal[]
): ManualSeerSignal[] {
  const existingSignalIds = new Set(existingSignals.map((signal) => signal.signalId));
  return incomingSignals.filter((signal) => !existingSignalIds.has(signal.signalId));
}

export async function fetchGoogleTrendingSignals(
  generatedAt: string,
  fetchImpl: typeof fetch = fetch
): Promise<ManualSeerSignal[]> {
  const response = await fetchImpl(GOOGLE_TRENDING_IL_FEED_URL, {
    headers: {
      "user-agent": "NaviSeerHeartbeat/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Google Trending IL fetch failed: ${response.status} ${response.statusText}`);
  }

  const xml = await response.text();
  return toGoogleTrendingManualSignals(parseGoogleTrendingRss(xml), generatedAt);
}
