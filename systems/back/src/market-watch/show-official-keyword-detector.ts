import { createHash } from "node:crypto";

export type MarketWatchSignal = {
  signalKind: "keyword_match";
  matchedEntity: string;
  matchedKeyword: string;
  sourceUrl: string;
  sourceTitle: string | null;
  summary: string;
  fingerprint: string;
  observedAt: string;
  payload: Record<string, unknown>;
};

type DetectionPlan = {
  id: string;
  runPolicy: Record<string, unknown>;
  entities: string[];
  keywords: string[];
};

type SignalMatch = {
  segmentIndex: number;
  entityIndex: number;
  keywordIndex: number;
  entity: string;
  keyword: string;
  snippet: string;
};

const DEFAULT_PROXIMITY_CHARS = 700;

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripHtmlToText(html: string): string {
  return compactWhitespace(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&")
  );
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? stripHtmlToText(match[1] ?? "").slice(0, 240) : null;
}

function findIndexes(text: string, needle: string): number[] {
  const indexes: number[] = [];
  const lowerText = text.toLocaleLowerCase("he-IL");
  const lowerNeedle = needle.toLocaleLowerCase("he-IL");
  let index = lowerText.indexOf(lowerNeedle);

  while (index >= 0) {
    indexes.push(index);
    index = lowerText.indexOf(lowerNeedle, index + Math.max(1, lowerNeedle.length));
  }

  return indexes;
}

function snippetAround(text: string, index: number, radius = 180): string {
  return compactWhitespace(text.slice(Math.max(0, index - radius), Math.min(text.length, index + radius)));
}

function htmlToSignalSegments(html: string): string[] {
  const marked = html.replace(
    /<\/(a|article|div|li|p|section|tr)>/gi,
    (match) => `${match}\n<<<hachozeh-watch-segment>>>\n`
  );
  const segments = marked
    .split("<<<hachozeh-watch-segment>>>")
    .map((segment) => compactWhitespace(stripHtmlToText(segment)))
    .filter((segment) => segment.length > 0);

  return segments.length > 0 ? segments : [stripHtmlToText(html)];
}

function fingerprintFor(input: {
  planId: string;
  sourceUrl: string;
  matchedEntity: string;
  matchedKeyword: string;
  snippet: string;
}): string {
  return createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex")
    .slice(0, 32);
}

function readProximityChars(runPolicy: Record<string, unknown>): number {
  const raw = runPolicy.proximityChars;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_PROXIMITY_CHARS;
  }
  return Math.min(5000, Math.max(100, Math.round(raw)));
}

function normalizeMatchToken(value: string): string {
  return value.toLocaleLowerCase("he-IL").replace(/[^\p{L}\p{N}]+/gu, "");
}

function tokensOverlap(left: string, right: string): boolean {
  const normalizedLeft = normalizeMatchToken(left);
  const normalizedRight = normalizeMatchToken(right);
  return normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft);
}

function collapseOverlappingMatches(matches: SignalMatch[]): SignalMatch[] {
  const preferred = [...matches].sort((left, right) =>
    right.entity.length - left.entity.length ||
    right.keyword.length - left.keyword.length ||
    left.segmentIndex - right.segmentIndex ||
    left.entityIndex - right.entityIndex ||
    left.keywordIndex - right.keywordIndex
  );
  const selected: SignalMatch[] = [];

  for (const candidate of preferred) {
    const overlapsSelected = selected.some((existing) =>
      existing.segmentIndex === candidate.segmentIndex &&
      tokensOverlap(existing.entity, candidate.entity) &&
      tokensOverlap(existing.keyword, candidate.keyword) &&
      Math.abs(existing.entityIndex - candidate.entityIndex) <=
        Math.max(existing.entity.length, candidate.entity.length) &&
      Math.abs(existing.keywordIndex - candidate.keywordIndex) <=
        Math.max(existing.keyword.length, candidate.keyword.length)
    );

    if (!overlapsSelected) selected.push(candidate);
  }

  return selected.sort((left, right) =>
    left.segmentIndex - right.segmentIndex ||
    left.entityIndex - right.entityIndex ||
    left.keywordIndex - right.keywordIndex
  );
}

export function detectShowOfficialKeywordSignals(input: {
  plan: DetectionPlan;
  sourceUrl: string;
  html: string;
  observedAt: string;
}): MarketWatchSignal[] {
  const segments = htmlToSignalSegments(input.html);
  const sourceTitle = extractTitle(input.html);
  const proximityChars = readProximityChars(input.plan.runPolicy);
  const matches: SignalMatch[] = [];

  for (const [segmentIndex, segment] of segments.entries()) {
    for (const entity of input.plan.entities) {
      const entityIndexes = findIndexes(segment, entity);
      if (entityIndexes.length === 0) continue;

      for (const keyword of input.plan.keywords) {
        const keywordIndexes = findIndexes(segment, keyword);
        if (keywordIndexes.length === 0) continue;

        for (const entityIndex of entityIndexes) {
          const keywordIndex = keywordIndexes.find(
            (candidate) => Math.abs(candidate - entityIndex) <= proximityChars
          );
          if (keywordIndex === undefined) continue;

          matches.push({
            segmentIndex,
            entityIndex,
            keywordIndex,
            entity,
            keyword,
            snippet: snippetAround(segment, Math.min(entityIndex, keywordIndex))
          });
          break;
        }
      }
    }
  }

  return collapseOverlappingMatches(matches).map((match) => ({
    signalKind: "keyword_match",
    matchedEntity: match.entity,
    matchedKeyword: match.keyword,
    sourceUrl: input.sourceUrl,
    sourceTitle,
    summary: `Possible watch signal: "${match.keyword}" near "${match.entity}".`,
    fingerprint: fingerprintFor({
      planId: input.plan.id,
      sourceUrl: input.sourceUrl,
      matchedEntity: match.entity,
      matchedKeyword: match.keyword,
      snippet: match.snippet
    }),
    observedAt: input.observedAt,
    payload: {
      snippet: match.snippet,
      sourceTitle,
      proximityChars
    }
  }));
}
