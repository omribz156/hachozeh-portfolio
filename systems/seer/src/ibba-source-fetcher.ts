import type { ManualSeerSignal } from "./contracts";
import { parseRssFeed, takeRecentRssItems, type RssFeedItem } from "./rss-source-utils";
import { fetchSourceText } from "./source-fetch-client";
import { toSummary } from "./source-text-utils";
import { compactWhitespace, slugify } from "./text";

export const IBBA_SOURCE_ID = "src_ibba_schedules";
export const IBBA_FEED_URL = "https://ibasketball.co.il/feed/";

type IbbaSignalKind = "return-to-play" | "competition-draw" | "schedule-update";

function shouldKeepIbbaItem(item: RssFeedItem): boolean {
  const text = compactWhitespace(`${item.title} ${item.description ?? ""}`);
  const hasFormalUpdateFrame =
    /מתווה/u.test(text) ||
    /חזרת המשחקים/u.test(text) ||
    /לוח(?:\s+המשחקים)?/u.test(text) ||
    /הגרל(?:ה|ו)/u.test(text) ||
    /שובצ(?:ה|ו)/u.test(text) ||
    /מוקדמות/u.test(text) ||
    /אליפות/u.test(text) ||
    /גמר/u.test(text) ||
    /חצי גמר/u.test(text) ||
    /פליי[\s-]?אוף/u.test(text) ||
    /גביע/u.test(text) ||
    /טורניר/u.test(text);
  const hasFutureTimingFrame =
    /יתקיים/u.test(text) ||
    /תתקיים/u.test(text) ||
    /ייערך/u.test(text) ||
    /ייערכו/u.test(text) ||
    /יחל/u.test(text) ||
    /תחל/u.test(text) ||
    /ישוחק/u.test(text) ||
    /ישוחקו/u.test(text) ||
    /תפגוש/u.test(text) ||
    /תפגושנה/u.test(text) ||
    /החל מיום/u.test(text) ||
    /ביום (?:ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)/u.test(text) ||
    /בשעה \d{1,2}:\d{2}/u.test(text) ||
    /ב-\d{1,2}\s+ב(?:ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר)/u.test(
      text
    );
  const looksLikeRecapOrFeature =
    /\b(?:4\d|[5-9]\d|1\d{2})\s*[:\-]\s*(?:4\d|[5-9]\d|1\d{2})\b/.test(text) ||
    /סיכום/u.test(text) ||
    /ניצחה/u.test(text) ||
    /ניצחון/u.test(text) ||
    /ניצחונות/u.test(text) ||
    /הפסד/u.test(text) ||
    /קלע/u.test(text) ||
    /קלעו/u.test(text) ||
    /גברה/u.test(text) ||
    /השלימה/u.test(text) ||
    /דרסה/u.test(text) ||
    /השיגו ניצחונות/u.test(text) ||
    /תוצאות בפנים/u.test(text) ||
    /נמשך הערב/u.test(text) ||
    /נערכו היום/u.test(text) ||
    /אולסטאר/u.test(text) ||
    /דראפט/u.test(text) ||
    /סטטיסטיקה/u.test(text) ||
    /כיכוב/u.test(text) ||
    /כיכבו/u.test(text) ||
    /סיימה את דרכה/u.test(text);

  if (looksLikeRecapOrFeature) {
    return false;
  }

  if (/מתווה|חזרת המשחקים/u.test(text)) {
    return true;
  }

  return hasFormalUpdateFrame && hasFutureTimingFrame;
}

function classifyIbbaItem(item: RssFeedItem): {
  kind: IbbaSignalKind;
  suggestedResolutionAnchor: string;
  keyEntities: string[];
} {
  const text = compactWhitespace(`${item.title} ${item.description ?? ""}`);

  if (/מתווה|חזרת המשחקים/u.test(text)) {
    return {
      kind: "return-to-play",
      suggestedResolutionAnchor: "IBBA official return-to-play or competition resumption update.",
      keyEntities: ["IBBA", "return to play"]
    };
  }

  if (/הגרל(?:ה|ו)|שובצ(?:ה|ו)|מוקדמות|בית [א-ת]/u.test(text)) {
    return {
      kind: "competition-draw",
      suggestedResolutionAnchor: "IBBA official draw, qualification, or competition update.",
      keyEntities: ["IBBA", "competition draw"]
    };
  }

  return {
    kind: "schedule-update",
    suggestedResolutionAnchor: "IBBA official competition schedule or match result.",
    keyEntities: ["IBBA", "competition schedule"]
  };
}

function toIbbaManualSignals(items: RssFeedItem[], generatedAt: string): ManualSeerSignal[] {
  return items.map((item) => {
    const classification = classifyIbbaItem(item);

    return {
      objectType: "manual_seer_signal",
      signalId: `msig_ibba_${slugify(item.guid ?? (item.link || `${item.title}_${item.pubDate}`))}`,
      sourceId: IBBA_SOURCE_ID,
      intakeLane: "planned",
      title: item.title,
      summary: toSummary("IBBA official sports update.", item.description),
      category: "sports",
      whyNow: `IBBA published "${item.title}" at ${item.pubDate}.`,
      observedAt: item.pubDate,
      importedAt: generatedAt,
      sourceRef: item.link || item.guid,
      sourceLabel: "IBBA",
      clusterHint: `ibba_${classification.kind}_${slugify(item.title)}`,
      lineageHint: `ibba_${classification.kind}`,
      keyEntities: [...classification.keyEntities, item.title],
      suggestedResolutionAnchor: classification.suggestedResolutionAnchor,
      notes: [
        ...(compactWhitespace(item.description ?? "").length > 0
          ? [compactWhitespace(item.description ?? "")]
          : []),
        `grounding: ibba-update-kind=${classification.kind}`,
        "intake-lane=planned"
      ],
      tags: ["heartbeat", "authority", "official", "sports", "ibba", "planned", classification.kind]
    };
  });
}

export async function fetchIbbaSignals(
  generatedAt: string,
  fetchImpl: typeof fetch = fetch
): Promise<ManualSeerSignal[]> {
  const xml = await fetchSourceText(IBBA_FEED_URL, "IBBA", fetchImpl);
  const items = takeRecentRssItems(parseRssFeed(xml), generatedAt, 14, 10).filter(shouldKeepIbbaItem);
  return toIbbaManualSignals(items, generatedAt);
}
