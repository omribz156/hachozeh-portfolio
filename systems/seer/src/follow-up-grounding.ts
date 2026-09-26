import type { ManualSeerSignal, SignalEnrichment } from "./contracts";
import { compactWhitespace } from "./text";

const SPORTS_FOLLOW_UP_MAX_URLS = 2;
const SPORTS_FOLLOW_UP_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const SPORTS_FOLLOW_UP_TIMEOUT_MS = 3000;
const SPORTS_FOLLOW_UP_MAX_BYTES = 256 * 1024;

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'");
}

function extractCoverageUrls(notes?: string[]): string[] {
  return unique(
    (notes ?? [])
      .map((note) => note.match(/https?:\/\/\S+/i)?.[0]?.trim())
      .filter((value): value is string => Boolean(value))
  );
}

function readTagContents(html: string, tag: string): string | undefined {
  const match = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  const value = match?.[1]?.replace(/<[^>]+>/g, " ").trim();
  return value ? decodeHtmlEntities(compactWhitespace(value)) : undefined;
}

function readMetaContent(html: string, attr: "property" | "name", key: string): string | undefined {
  const match = html.match(new RegExp(`<meta[^>]+${attr}=["']${key}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"));
  const value = match?.[1]?.trim();
  return value ? decodeHtmlEntities(compactWhitespace(value)) : undefined;
}

function toIsoDate(value: string): string | undefined {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed.toISOString().slice(0, 10);
}

function extractStructuredDate(html: string): string | undefined {
  const candidates = [
    ...html.matchAll(/"(?:startDate|start_date|eventDate|datePublished|dateModified)"\s*:\s*"([^"]+)"/gi)
  ]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const iso = toIsoDate(candidate);

    if (iso) {
      return iso;
    }
  }

  return undefined;
}

function extractTextualDate(text: string, observedAt: string): string | undefined {
  const monthDateWithYear =
    text.match(
      /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2},\s*20\d{2}\b/i
    )?.[0] ??
    text.match(
      /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},\s*20\d{2}\b/i
    )?.[0];

  if (monthDateWithYear) {
    return toIsoDate(monthDateWithYear);
  }

  const monthDateNoYear = text.match(
    /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}\b/i
  )?.[0];

  if (!monthDateNoYear) {
    return undefined;
  }

  const observedYear = new Date(observedAt).getUTCFullYear();
  return toIsoDate(`${monthDateNoYear}, ${observedYear}`);
}

function inferCompetitionLabel(text: string): string | undefined {
  const labels: Array<[RegExp, string]> = [
    [/\bipl\b/i, "IPL"],
    [/\bla liga\b/i, "La Liga"],
    [/\bpremier league\b/i, "Premier League"],
    [/ליגת העל/u, "ליגת העל"],
    [/ליגה לאומית/u, "ליגה לאומית"],
    [/גביע המדינה/u, "גביע המדינה"],
    [/ווינר סל|winner league/i, "Winner League"],
    [/\bchampions league\b/i, "Champions League"],
    [/\beuroleague\b/i, "EuroLeague"],
    [/יורוליג/u, "EuroLeague"],
    [/\bnba\b/i, "NBA"],
    [/\bered(?:ivisie|evisie)\b/i, "Eredivisie"],
    [/\bmonte[\s-]?carlo(?: masters)?\b/i, "Monte Carlo Masters"],
    [/\bfa cup\b/i, "FA Cup"],
    [/\bcarabao cup\b/i, "Carabao Cup"]
  ];

  return labels.find(([expression]) => expression.test(text))?.[1];
}

async function readResponseTextWithLimit(response: Response): Promise<string | null> {
  const contentLength = Number(response.headers.get("content-length"));

  if (Number.isFinite(contentLength) && contentLength > SPORTS_FOLLOW_UP_MAX_BYTES) {
    return null;
  }

  if (!response.body) {
    const text = await response.text();
    return text.length > SPORTS_FOLLOW_UP_MAX_BYTES ? null : text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    receivedBytes += value.byteLength;

    if (receivedBytes > SPORTS_FOLLOW_UP_MAX_BYTES) {
      await reader.cancel();
      return null;
    }

    text += decoder.decode(value, {
      stream: true
    });
  }

  text += decoder.decode();
  return text;
}

function shouldFetchSportsFollowUp(signal: ManualSeerSignal, enrichment: SignalEnrichment): boolean {
  if (signal.sourceId !== "src_google_trending_il") {
    return false;
  }

  if (enrichment.inferredCategory !== "sports") {
    return false;
  }

  const fetchNeeds = (enrichment.draftAmbiguityNotes ?? [])
    .map((note) => note.match(/^fetch-needed=(.+)$/i)?.[1]?.trim())
    .filter((value): value is string => Boolean(value));

  if (!fetchNeeds.some((need) => need === "exact-event-date" || need === "competition-name")) {
    return false;
  }

  if (Date.now() - Date.parse(signal.observedAt) > SPORTS_FOLLOW_UP_MAX_AGE_MS) {
    return false;
  }

  return extractCoverageUrls(signal.notes).length > 0;
}

export async function buildSignalFollowUpNotes(
  signal: ManualSeerSignal,
  enrichment: SignalEnrichment,
  fetchImpl: typeof fetch = fetch
): Promise<string[]> {
  if (!shouldFetchSportsFollowUp(signal, enrichment)) {
    return [];
  }

  const urls = extractCoverageUrls(signal.notes).slice(0, SPORTS_FOLLOW_UP_MAX_URLS);
  const notes: string[] = [];

  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), SPORTS_FOLLOW_UP_TIMEOUT_MS);
      const response = await fetchImpl(url, {
        signal: controller.signal,
        headers: {
          "user-agent": "NaviSeerFollowup/1.0"
        }
      }).finally(() => clearTimeout(timeout));

      if (!response.ok) {
        continue;
      }

      const html = await readResponseTextWithLimit(response);

      if (!html) {
        continue;
      }

      const title =
        readMetaContent(html, "property", "og:title") ??
        readMetaContent(html, "name", "twitter:title") ??
        readTagContents(html, "title");
      const description =
        readMetaContent(html, "name", "description") ??
        readMetaContent(html, "property", "og:description") ??
        readMetaContent(html, "name", "twitter:description");
      const combinedText = compactWhitespace([title, description].filter((value): value is string => Boolean(value)).join(" "));
      const eventDate = extractStructuredDate(html) ?? extractTextualDate(combinedText, signal.observedAt);
      const competitionLabel = inferCompetitionLabel(combinedText);

      if (title) {
        notes.push(`followup-title: ${title} | ${url}`);
      }

      if (competitionLabel) {
        notes.push(`followup-competition=${competitionLabel} | ${url}`);
      }

      if (eventDate) {
        notes.push(`followup-event-date=${eventDate} | ${url}`);
      }
    } catch {
      continue;
    }
  }

  return unique(notes);
}
