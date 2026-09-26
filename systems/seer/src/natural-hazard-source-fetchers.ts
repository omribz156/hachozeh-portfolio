import type { ManualSeerSignal } from "./contracts";
import { fetchSourceText } from "./source-fetch-client";
import { extractXmlTag, isWithinLookback, toIsoDate, toSummary } from "./source-text-utils";
import { compactWhitespace, slugify } from "./text";

export const USGS_SOURCE_ID = "src_usgs_alerts";
export const USGS_SIGNIFICANT_EARTHQUAKE_URL =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_day.geojson";

export const GDACS_SOURCE_ID = "src_gdacs_alerts";
export const GDACS_RSS_URL = "https://www.gdacs.org/xml/rss.xml";

type GdacsFeedItem = {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  guid: string;
  alertLevel: string;
  eventType: string;
  country?: string;
};

type UsgsFeatureCollection = {
  features?: Array<{
    id?: string;
    properties?: {
      title?: string;
      mag?: number | null;
      place?: string;
      time?: number;
      url?: string;
      alert?: string | null;
      tsunami?: number;
      status?: string;
    };
  }>;
};

type UsgsEarthquakeItem = {
  id: string;
  title: string;
  mag?: number;
  place?: string;
  observedAt: string;
  sourceRef: string;
  alertLevel?: string;
  tsunami?: number;
  status?: string;
};

function mapGdacsEventType(eventType: string): string {
  switch (eventType.toUpperCase()) {
    case "EQ":
      return "earthquake";
    case "TC":
      return "cyclone";
    case "FL":
      return "flood";
    case "VO":
      return "volcano";
    case "WF":
      return "wildfire";
    default:
      return eventType.toLowerCase() || "hazard";
  }
}

export function parseGdacsRss(xml: string): GdacsFeedItem[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)]
    .map((match) => {
      const block = match[1] ?? "";

      return {
        title: extractXmlTag(block, "title") ?? "",
        description: extractXmlTag(block, "description") ?? "",
        link: extractXmlTag(block, "link") ?? "",
        pubDate: toIsoDate(extractXmlTag(block, "pubDate") ?? ""),
        guid: extractXmlTag(block, "guid") ?? "",
        alertLevel: extractXmlTag(block, "gdacs:alertlevel") ?? "",
        eventType: extractXmlTag(block, "gdacs:eventtype") ?? "",
        country: extractXmlTag(block, "gdacs:country")
      };
    })
    .filter((item) => item.title.length > 0 && item.pubDate.length > 0);
}

function toGdacsManualSignals(items: GdacsFeedItem[], generatedAt: string): ManualSeerSignal[] {
  return items.map((item) => {
    const hazardLabel = mapGdacsEventType(item.eventType);
    const countryLabel = item.country ?? "unknown location";
    const alertLabel = item.alertLevel.length > 0 ? item.alertLevel : "unknown";

    return {
      objectType: "manual_seer_signal",
      signalId: `msig_gdacs_${slugify(item.guid || `${item.title}_${item.pubDate}`)}`,
      sourceId: GDACS_SOURCE_ID,
      title: item.title,
      summary: toSummary("GDACS alert.", item.description),
      category: "science",
      whyNow: `GDACS raised a ${alertLabel} ${hazardLabel} alert for ${countryLabel} at ${item.pubDate}.`,
      observedAt: item.pubDate,
      importedAt: generatedAt,
      sourceRef: item.link,
      sourceLabel: "GDACS",
      clusterHint: `gdacs_${hazardLabel}_${slugify(countryLabel)}`,
      lineageHint: `gdacs_${hazardLabel}_${slugify(countryLabel)}`,
      keyEntities: [countryLabel, hazardLabel.toUpperCase(), alertLabel],
      suggestedResolutionAnchor:
        "GDACS alert update or the relevant official disaster authority follow-up.",
      notes: [
        compactWhitespace(`event-type=${hazardLabel}; alert-level=${alertLabel}`),
        item.description
      ].filter((value) => value.length > 0),
      tags: [
        "heartbeat",
        "authority",
        "official",
        "gdacs",
        `alert-${alertLabel.toLowerCase()}`,
        hazardLabel
      ]
    };
  });
}

export function parseUsgsEarthquakes(json: string): UsgsEarthquakeItem[] {
  const parsed = JSON.parse(json) as UsgsFeatureCollection;

  return (parsed.features ?? [])
    .map((feature) => {
      const properties = feature.properties;
      const observedAt = properties?.time ? new Date(properties.time).toISOString() : "";
      const title = compactWhitespace(properties?.title ?? "");
      const sourceRef = properties?.url?.trim() ?? "";

      return {
        id: feature.id?.trim() ?? "",
        title,
        mag: typeof properties?.mag === "number" ? properties.mag : undefined,
        place: compactWhitespace(properties?.place ?? ""),
        observedAt,
        sourceRef,
        alertLevel: properties?.alert?.trim() ?? undefined,
        tsunami: properties?.tsunami,
        status: properties?.status?.trim()
      };
    })
    .filter(
      (item) =>
        item.id.length > 0 &&
        item.title.length > 0 &&
        item.observedAt.length > 0 &&
        item.sourceRef.length > 0
    );
}

function toUsgsManualSignals(items: UsgsEarthquakeItem[], generatedAt: string): ManualSeerSignal[] {
  return items.map((item) => {
    const magnitudeNote = typeof item.mag === "number" ? `magnitude=${item.mag.toFixed(1)}` : undefined;
    const alertNote = item.alertLevel ? `alert=${item.alertLevel}` : undefined;
    const tsunamiNote = typeof item.tsunami === "number" ? `tsunami=${item.tsunami}` : undefined;

    return {
      objectType: "manual_seer_signal",
      signalId: `msig_usgs_${slugify(item.id)}`,
      sourceId: USGS_SOURCE_ID,
      title: item.title,
      summary: toSummary("USGS earthquake alert.", item.place ? `Location: ${item.place}.` : undefined),
      category: "science",
      whyNow: `USGS recorded "${item.title}" at ${item.observedAt}.`,
      observedAt: item.observedAt,
      importedAt: generatedAt,
      sourceRef: item.sourceRef,
      sourceLabel: "USGS",
      clusterHint: `usgs_${slugify(item.place || item.id)}`,
      lineageHint: `usgs_${slugify(item.place || item.id)}`,
      keyEntities: ["USGS", ...(item.place ? [item.place] : [])],
      suggestedResolutionAnchor: "USGS event detail page.",
      notes: [magnitudeNote, alertNote, tsunamiNote, item.status].filter(
        (value): value is string => Boolean(value && value.length > 0)
      ),
      tags: ["heartbeat", "authority", "official", "usgs", "earthquake"]
    };
  });
}

export async function fetchUsgsSignals(
  generatedAt: string,
  fetchImpl: typeof fetch = fetch
): Promise<ManualSeerSignal[]> {
  const json = await fetchSourceText(USGS_SIGNIFICANT_EARTHQUAKE_URL, "USGS", fetchImpl);
  return toUsgsManualSignals(parseUsgsEarthquakes(json), generatedAt);
}

export async function fetchGdacsSignals(
  generatedAt: string,
  fetchImpl: typeof fetch = fetch
): Promise<ManualSeerSignal[]> {
  const xml = await fetchSourceText(GDACS_RSS_URL, "GDACS", fetchImpl);
  const items = parseGdacsRss(xml)
    .filter((item) => item.alertLevel.toLowerCase() !== "green")
    .filter((item) => isWithinLookback(item.pubDate, generatedAt, 7))
    .slice(0, 8);

  return toGdacsManualSignals(items, generatedAt);
}
