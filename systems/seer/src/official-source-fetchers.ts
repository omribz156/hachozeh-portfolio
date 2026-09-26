import type { ManualSeerSignal } from "./contracts";
import { slugify, stripHtmlTags, decodeHtmlEntities, compactWhitespace } from "./text";

export const HOME_FRONT_COMMAND_SOURCE_ID = "src_home_front_command";
export const HOME_FRONT_COMMAND_API_URL = "https://api.oref.org.il/api/v1/news/eng";
export const HOME_FRONT_COMMAND_PAGE_URL = "https://www.oref.org.il/en";

export const IAA_NOTIFICATIONS_SOURCE_ID = "src_iaa_notifications";
export const IAA_NOTIFICATIONS_PAGE_URL =
  "https://www.iaa.gov.il/en/airports/ben-gurion/notifications-and-updates/";

export type HomeFrontNewsItem = {
  id: number;
  time: string;
  title: string;
  text: string;
};

export type IaaNotificationItem = {
  id: string;
  title: string;
  publishedAt: string;
  body: string;
  sourceRef: string;
};

function extractFirstHref(value: string): string | undefined {
  const match = value.match(/href="([^"]+)"/i);
  return match?.[1]?.trim();
}

function toIsoish(value: string): string {
  const normalized = value.trim();

  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(normalized)) {
    return normalized;
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized)) {
    return `${normalized}:00`;
  }

  return normalized;
}

function toSummary(prefix: string, body: string): string {
  const cleanBody = compactWhitespace(stripHtmlTags(body));

  if (cleanBody.length === 0) {
    return prefix;
  }

  if (cleanBody.length <= 220) {
    return `${prefix} ${cleanBody}`.trim();
  }

  return `${prefix} ${cleanBody.slice(0, 217).trimEnd()}...`.trim();
}

export function parseHomeFrontNewsResponse(json: string): HomeFrontNewsItem[] {
  const parsed = JSON.parse(json) as {
    content?: Array<{
      id?: number;
      time?: string;
      title?: string;
      text?: string;
    }>;
  };

  return (parsed.content ?? [])
    .filter((item) => typeof item.id === "number" && typeof item.time === "string" && typeof item.title === "string")
    .map((item) => ({
      id: item.id!,
      time: toIsoish(item.time!),
      title: item.title!.trim(),
      text: item.text?.trim() ?? ""
    }));
}

export function toHomeFrontManualSignals(
  items: HomeFrontNewsItem[],
  generatedAt: string
): ManualSeerSignal[] {
  return items.map((item) => {
    const titleSlug = slugify(item.title);
    const sourceRef = extractFirstHref(item.text) ?? `${HOME_FRONT_COMMAND_API_URL}#item-${item.id}`;

    return {
      objectType: "manual_seer_signal",
      signalId: `msig_home_front_command_${item.id}_${slugify(item.time)}`,
      sourceId: HOME_FRONT_COMMAND_SOURCE_ID,
      title: item.title,
      summary: toSummary("Home Front Command update.", item.text),
      category: "security",
      whyNow: `Home Front Command published "${item.title}" at ${item.time}.`,
      observedAt: item.time,
      importedAt: generatedAt,
      sourceRef,
      sourceLabel: "Home Front Command",
      clusterHint: `home_front_${titleSlug}`,
      lineageHint: `home_front_${titleSlug}`,
      keyEntities: ["Home Front Command", item.title],
      suggestedResolutionAnchor: "Home Front Command official follow-up notice.",
      notes: compactWhitespace(stripHtmlTags(item.text)).length > 0 ? [compactWhitespace(stripHtmlTags(item.text))] : undefined,
      tags: ["heartbeat", "authority", "official", "home-front-command"]
    };
  });
}

export function parseIaaNotificationsHtml(html: string): IaaNotificationItem[] {
  return [...html.matchAll(/<section class="box-wrapper[\s\S]*?id="noteid-([^"]+)"[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>[\s\S]*?<time datetime="([^"]+)"[\s\S]*?<\/time>[\s\S]*?<div class="box--content d-inline-block">([\s\S]*?)<\/div>[\s\S]*?data-url="([^"]+)"/gi)]
    .map((match) => ({
      id: match[1]!.trim(),
      title: compactWhitespace(stripHtmlTags(decodeHtmlEntities(match[2] ?? ""))),
      publishedAt: toIsoish(match[3] ?? ""),
      body: compactWhitespace(stripHtmlTags(decodeHtmlEntities(match[4] ?? ""))),
      sourceRef: decodeHtmlEntities(match[5] ?? "").trim()
    }))
    .filter((item) => item.id.length > 0 && item.title.length > 0 && item.publishedAt.length > 0);
}

export function toIaaManualSignals(
  items: IaaNotificationItem[],
  generatedAt: string
): ManualSeerSignal[] {
  return items.map((item) => {
    const titleSlug = slugify(item.title);

    return {
      objectType: "manual_seer_signal",
      signalId: `msig_iaa_notifications_${item.id}_${slugify(item.publishedAt)}`,
      sourceId: IAA_NOTIFICATIONS_SOURCE_ID,
      title: item.title,
      summary: toSummary("IAA notification.", item.body),
      category: "travel",
      whyNow: `IAA published "${item.title}" at ${item.publishedAt}.`,
      observedAt: item.publishedAt,
      importedAt: generatedAt,
      sourceRef: item.sourceRef || `${IAA_NOTIFICATIONS_PAGE_URL}#noteid-${item.id}`,
      sourceLabel: "Israel Airports Authority",
      clusterHint: `iaa_${titleSlug}`,
      lineageHint: `iaa_${titleSlug}`,
      keyEntities: ["Israel Airports Authority", "Ben Gurion Airport", item.title],
      suggestedResolutionAnchor: "Israel Airports Authority official follow-up notice.",
      notes: item.body.length > 0 ? [item.body] : undefined,
      tags: ["heartbeat", "authority", "official", "iaa"]
    };
  });
}

export async function fetchHomeFrontSignals(
  generatedAt: string,
  fetchImpl: typeof fetch = fetch
): Promise<ManualSeerSignal[]> {
  const response = await fetchImpl(HOME_FRONT_COMMAND_API_URL, {
    headers: {
      "user-agent": "NaviSeerHeartbeat/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Home Front Command fetch failed: ${response.status} ${response.statusText}`);
  }

  return toHomeFrontManualSignals(parseHomeFrontNewsResponse(await response.text()), generatedAt);
}

export async function fetchIaaNotificationSignals(
  generatedAt: string,
  fetchImpl: typeof fetch = fetch
): Promise<ManualSeerSignal[]> {
  const response = await fetchImpl(IAA_NOTIFICATIONS_PAGE_URL, {
    headers: {
      "user-agent": "NaviSeerHeartbeat/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`IAA notifications fetch failed: ${response.status} ${response.statusText}`);
  }

  return toIaaManualSignals(parseIaaNotificationsHtml(await response.text()), generatedAt);
}
