import type { ManualSeerSignal } from "./contracts";
import { parseRssFeed, takeRecentRssItems, type RssFeedItem } from "./rss-source-utils";
import { fetchSourceText } from "./source-fetch-client";
import { toSummary } from "./source-text-utils";
import { compactWhitespace, slugify } from "./text";

export const FEDERAL_RESERVE_SOURCE_ID = "src_federal_reserve_rss";
export const FEDERAL_RESERVE_PRESS_RSS_URL = "https://www.federalreserve.gov/feeds/press_all.xml";

export const ECB_SOURCE_ID = "src_ecb_rss";
export const ECB_PRESS_RSS_URL = "https://www.ecb.europa.eu/rss/press.html";

function shouldKeepFederalReserveItem(item: RssFeedItem): boolean {
  const category = (item.category ?? "").toLowerCase();
  const title = item.title.toLowerCase();

  if (category === "monetary policy") {
    return true;
  }

  return /\bfomc\b|\brate\b|\bpolicy\b|\bprojection\b|\bfednow\b|\bliquidity\b|\bfacility\b/.test(title);
}

function shouldKeepEcbItem(item: RssFeedItem): boolean {
  const link = item.link.toLowerCase();
  const title = item.title.toLowerCase();

  if (link.includes("/press/pr/") || link.includes("/press/govcdec/")) {
    return true;
  }

  return /\binterest rate\b|\bmonetary policy\b|\beuro area economy\b|\bwage\b|\binflation\b/.test(title);
}

function toFedManualSignals(items: RssFeedItem[], generatedAt: string): ManualSeerSignal[] {
  return items.map((item) => ({
    objectType: "manual_seer_signal",
    signalId: `msig_federal_reserve_${slugify(item.guid ?? (item.link || item.title))}`,
    sourceId: FEDERAL_RESERVE_SOURCE_ID,
    title: item.title,
    summary: toSummary("Federal Reserve release.", item.description ?? item.category),
    category: "economy",
    whyNow: `Federal Reserve published "${item.title}" at ${item.pubDate}.`,
    observedAt: item.pubDate,
    importedAt: generatedAt,
    sourceRef: item.link || item.guid,
    sourceLabel: "Federal Reserve",
    clusterHint: `federal_reserve_${slugify(item.title)}`,
    lineageHint: `federal_reserve_${slugify(item.title)}`,
    keyEntities: ["Federal Reserve", ...(item.category ? [item.category] : [])],
    suggestedResolutionAnchor: "Federal Reserve official release.",
    notes:
      compactWhitespace(item.description ?? "").length > 0
        ? [compactWhitespace(item.description ?? "")]
        : undefined,
    tags: ["heartbeat", "authority", "official", "federal-reserve"]
  }));
}

function toEcbManualSignals(items: RssFeedItem[], generatedAt: string): ManualSeerSignal[] {
  return items.map((item) => ({
    objectType: "manual_seer_signal",
    signalId: `msig_ecb_${slugify(item.guid ?? (item.link || item.title))}`,
    sourceId: ECB_SOURCE_ID,
    title: item.title,
    summary: toSummary("ECB release.", item.description ?? item.category),
    category: "economy",
    whyNow: `ECB published "${item.title}" at ${item.pubDate}.`,
    observedAt: item.pubDate,
    importedAt: generatedAt,
    sourceRef: item.link || item.guid,
    sourceLabel: "European Central Bank",
    clusterHint: `ecb_${slugify(item.title)}`,
    lineageHint: `ecb_${slugify(item.title)}`,
    keyEntities: ["European Central Bank"],
    suggestedResolutionAnchor: "European Central Bank official release.",
    notes:
      compactWhitespace(item.description ?? "").length > 0
        ? [compactWhitespace(item.description ?? "")]
        : undefined,
    tags: ["heartbeat", "authority", "official", "ecb"]
  }));
}

export async function fetchFederalReserveSignals(
  generatedAt: string,
  fetchImpl: typeof fetch = fetch
): Promise<ManualSeerSignal[]> {
  const xml = await fetchSourceText(FEDERAL_RESERVE_PRESS_RSS_URL, "Federal Reserve", fetchImpl);
  const items = takeRecentRssItems(parseRssFeed(xml), generatedAt, 14, 8).filter(shouldKeepFederalReserveItem);
  return toFedManualSignals(items, generatedAt);
}

export async function fetchEcbSignals(
  generatedAt: string,
  fetchImpl: typeof fetch = fetch
): Promise<ManualSeerSignal[]> {
  const xml = await fetchSourceText(ECB_PRESS_RSS_URL, "ECB", fetchImpl);
  const items = takeRecentRssItems(parseRssFeed(xml), generatedAt, 14, 8).filter(shouldKeepEcbItem);
  return toEcbManualSignals(items, generatedAt);
}
