import { extractXmlTag, isWithinLookback, toIsoDate } from "./source-text-utils";

export type RssFeedItem = {
  title: string;
  link: string;
  description?: string;
  pubDate: string;
  category?: string;
  guid?: string;
};

export function parseRssFeed(xml: string): RssFeedItem[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)]
    .map((match) => {
      const block = match[1] ?? "";

      return {
        title: extractXmlTag(block, "title") ?? "",
        link: extractXmlTag(block, "link") ?? "",
        description: extractXmlTag(block, "description"),
        pubDate: toIsoDate(extractXmlTag(block, "pubDate") ?? ""),
        category: extractXmlTag(block, "category"),
        guid: extractXmlTag(block, "guid")
      };
    })
    .filter((item) => item.title.length > 0 && item.pubDate.length > 0);
}

export function takeRecentRssItems(
  items: RssFeedItem[],
  generatedAt: string,
  lookbackDays: number,
  limit: number
): RssFeedItem[] {
  return items
    .filter((item) => isWithinLookback(item.pubDate, generatedAt, lookbackDays))
    .slice(0, limit);
}
