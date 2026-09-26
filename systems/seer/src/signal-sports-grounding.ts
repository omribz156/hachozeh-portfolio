import type { SportsRecurringTemplateId } from "./contracts";
import { compactWhitespace } from "./text";

const soccerKeywords = [
  /\bfootball\b/i,
  /\bsoccer\b/i,
  /\bla liga\b/i,
  /\bpremier league\b/i,
  /\bchampions league\b/i,
  /\buefa\b/i,
  /\bajax\b/i,
  /\bheracles\b/i,
  /\bbarcelona\b/i,
  /\bespanyol\b/i,
  /\bchelsea\b/i,
  /\bman(?:chester)? city\b/i,
  /\bsouthampton\b/i,
  /\bderby county\b/i,
  /צ['׳]לסי/u,
  /מנצ['׳]סטר סיטי/u,
  /כדורגל/u
];

const basketballKeywords = [
  /\bnba\b/i,
  /\beuroleague\b/i,
  /\btrail blazers\b/i,
  /\bclippers\b/i,
  /\blakers\b/i,
  /\bceltics\b/i,
  /\bknicks\b/i,
  /\bwarriors\b/i,
  /\bspurs\b/i,
  /כדורסל/u
];

const cricketKeywords = [/\bcsk\b/i, /\bdc\b/i, /\bgt\b/i, /\brr\b/i, /\brcb\b/i, /\bkkr\b/i, /\blsg\b/i, /\bipl\b/i];

const twoWayFightKeywords = [/\bufc\b/i, /\bmma\b/i, /\btennis\b/i, /\bboxing\b/i, /\batp\b/i, /\bmonte[\s-]?carlo\b/i, /\balcaraz\b/i, /\bsinner\b/i, /טניס/u];

const esportsKeywords = [
  /\besports?\b/i,
  /\bvalorant\b/i,
  /\bleague of legends\b/i,
  /\blol esports\b/i,
  /\bcounter[- ]?strike\b/i,
  /\bcs2\b/i,
  /\bdota(?:\s*2)?\b/i,
  /\blck\b/i,
  /\blpl\b/i,
  /\bvct\b/i,
  /איספורט/u
];

type SportsGroundingInput = {
  notes?: string[];
  observedAt: string;
};

export type SportsGrounding = {
  matchDate?: string;
  hasExplicitMatchDate: boolean;
  hasFixtureContext: boolean;
  competitionLabel?: string;
  hasFootballCoverageContext: boolean;
  canonicalSides?: [string, string];
  coverageContextText: string;
  fetchNeeds: string[];
  evidence: string[];
};

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function extractVsSides(title: string): [string, string] | undefined {
  const match = title.match(/^(.+?)\s+(?:vs\.?|נגד|מול)\s+(.+)$/i);
  const left = match?.[1]?.trim();
  const right = match?.[2]?.trim();

  if (!left || !right || left.length < 2 || right.length < 2) {
    return undefined;
  }

  return [left, right];
}

function extractHyphenSides(title: string): [string, string] | undefined {
  const compact = compactWhitespace(title)
    .replace(/\s+\d+:\d+(?:\s*\([^)]+\))?\s*$/u, "")
    .trim();
  const match = compact.match(/^(.+?)\s+[-–]\s+(.+)$/u);
  const left = match?.[1]?.trim();
  const right = match?.[2]?.trim();

  if (!left || !right || left.length < 2 || right.length < 2) {
    return undefined;
  }

  const cleanedRight = right
    .replace(/:\s*(?:הרכבים|preview|lineups?|team news|stats?|head-to-head|לקראת המשחק).*$/iu, "")
    .trim();

  if (cleanedRight.length < 2) {
    return undefined;
  }

  return [left, cleanedRight];
}

function stripCoveragePrefixes(value: string): string {
  let next = compactWhitespace(value);

  while (true) {
    const liveStripped = next.replace(/^דקה\s+\d+:\s*/u, "").trim();

    if (liveStripped !== next) {
      next = liveStripped;
      continue;
    }

    const sourcePrefix = next.match(/^([^:]{1,20}):\s*/u)?.[1]?.trim();

    if (
      sourcePrefix &&
      !/[-–]|vs\.?|נגד|מול/iu.test(sourcePrefix)
    ) {
      next = next.slice(sourcePrefix.length + 1).trim();
      continue;
    }

    return next;
  }
}

function extractSidesFromCoverageEntry(entry: string): [string, string] | undefined {
  const candidates = [stripCoveragePrefixes(entry)].filter((value) => value.length > 0);

  for (const candidate of candidates) {
    const parsed = extractVsSides(candidate) ?? extractHyphenSides(candidate);

    if (!parsed) {
      continue;
    }

    const [left, right] = parsed;

    if (
      /^(?:דקה\s+\d+|live|preview|lineups?|match|scorecard)$/iu.test(left) ||
      /^(?:דקה\s+\d+|live|preview|lineups?|match|scorecard)$/iu.test(right)
    ) {
      continue;
    }

    return parsed;
  }

  return undefined;
}

function hasAnyMatch(text: string, expressions: RegExp[]): boolean {
  return expressions.some((expression) => expression.test(text));
}

const sportsEntityAliases: Array<{ canonical: string; aliases: RegExp[] }> = [
  { canonical: "Chelsea", aliases: [/\bchelsea\b/i, /צ['׳]לסי/u] },
  { canonical: "Manchester City", aliases: [/\bman(?:chester)? city\b/i, /מנצ['׳]סטר סיטי/u] },
  { canonical: "Carlos Alcaraz", aliases: [/\bcarlos alcaraz\b/i, /\balcaraz\b/i, /אלקראז/u] },
  { canonical: "Jannik Sinner", aliases: [/\bjannik sinner\b/i, /\bsinner\b/i, /סינר/u] },
  { canonical: "Barcelona", aliases: [/\bbarcelona\b/i, /ברצלונה/u] },
  { canonical: "Espanyol", aliases: [/\bespanyol\b/i, /אספניול/u] },
  { canonical: "Ajax", aliases: [/\bajax\b/i] },
  { canonical: "Heracles", aliases: [/\bheracles\b/i] }
];

function tryDecodeUrl(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

function extractCoverageUrls(notes?: string[]): string[] {
  return (notes ?? [])
    .map((note) => note.match(/https?:\/\/\S+/i)?.[0]?.trim())
    .filter((value): value is string => Boolean(value));
}

function extractCoverageTitles(notes?: string[]): string[] {
  return (notes ?? [])
    .map((note) =>
      note
        .replace(/https?:\/\/\S+/gi, "")
        .replace(/\|\s*$/g, "")
        .replace(/^followup-title:\s*/i, "")
        .replace(/^followup-description:\s*/i, "")
        .trim()
    )
    .filter(
      (value) =>
        value.length > 0 &&
        !value.startsWith("approx-traffic=") &&
        !value.startsWith("followup-event-date=") &&
        !value.startsWith("followup-competition=")
    );
}

function extractStructuredNoteValues(notes: string[] | undefined, prefix: string): string[] {
  return (notes ?? [])
    .map((note) => note.match(new RegExp(`^${prefix}=(.+?)(?:\\s*\\|\\s*https?:\\/\\/\\S+)?$`, "i"))?.[1]?.trim())
    .filter((value): value is string => Boolean(value));
}

function isoDateToLabel(value: string): string | undefined {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match?.[1] || !match[2] || !match[3]) {
    return undefined;
  }

  return toIsoDateLabel(match[1], match[2], match[3]);
}

function toIsoDateLabel(year: string, month: string, day: string): string | undefined {
  const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00Z`);

  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  });
}

function extractDateFromCoverageUrl(url: string): string | undefined {
  const decoded = tryDecodeUrl(url.toLowerCase());
  const segmentedMatch = decoded.match(/\/(20\d{2})[\/_-](\d{2})[\/_-](\d{2})(?:\/|$)/);

  if (segmentedMatch?.[1] && segmentedMatch[2] && segmentedMatch[3]) {
    return toIsoDateLabel(segmentedMatch[1], segmentedMatch[2], segmentedMatch[3]);
  }

  const compactMatch = decoded.match(/(?:^|[^0-9])(20\d{2})(\d{2})(\d{2})(?:[^0-9]|$)/);

  if (compactMatch?.[1] && compactMatch[2] && compactMatch[3]) {
    return toIsoDateLabel(compactMatch[1], compactMatch[2], compactMatch[3]);
  }

  return undefined;
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

function orderedCanonicalMatches(text: string): string[] {
  const matches = sportsEntityAliases
    .map((entry) => {
      const firstMatch = entry.aliases
        .map((expression) => {
          const match = text.match(expression);
          return match?.index;
        })
        .filter((index): index is number => index !== undefined)
        .sort((left, right) => left - right)[0];

      return firstMatch === undefined ? undefined : { canonical: entry.canonical, index: firstMatch };
    })
    .filter((entry): entry is { canonical: string; index: number } => Boolean(entry))
    .sort((left, right) => left.index - right.index);

  return unique(matches.map((entry) => entry.canonical));
}

function inferCanonicalSidesFromCoverage(coverageEntries: string[]): [string, string] | undefined {
  const pairContext =
    /vs\.?|v\.?|preview|line\s*up|lineups?|match|scorecard|directo|direct|clash|derby|final|face|rivalry|מול|נגד/i;

  for (const entry of coverageEntries) {
    if (!pairContext.test(entry)) {
      const genericSides = extractSidesFromCoverageEntry(entry);

      if (genericSides) {
        return genericSides;
      }

      continue;
    }

    const matches = orderedCanonicalMatches(entry);

    if (matches.length >= 2) {
      return [matches[0]!, matches[1]!];
    }

    const genericSides = extractSidesFromCoverageEntry(entry);

    if (genericSides) {
      return genericSides;
    }
  }

  return undefined;
}

export function inferSportsGrounding(input: SportsGroundingInput, text: string): SportsGrounding {
  const urls = extractCoverageUrls(input.notes);
  const coverageTitles = extractCoverageTitles(input.notes);
  const structuredCompetition = extractStructuredNoteValues(input.notes, "followup-competition")[0];
  const structuredEventDate = extractStructuredNoteValues(input.notes, "followup-event-date")[0];
  const coverageEntries = [...coverageTitles, ...urls.map(tryDecodeUrl)];
  const coverageText = compactWhitespace(coverageEntries.join(" ")).toLowerCase();
  const combinedText = compactWhitespace(`${text} ${coverageText}`);
  const explicitMatchDate =
    isoDateToLabel(structuredEventDate ?? "") ??
    urls.map(extractDateFromCoverageUrl).find((value): value is string => Boolean(value));
  const competitionLabel = structuredCompetition ?? inferCompetitionLabel(combinedText);
  const canonicalSides = inferCanonicalSidesFromCoverage(coverageEntries.map((entry) => entry.toLowerCase()));
  const hasLiveCoverageContext =
    /\b(live|preview|lineups|lineup|match|scorecard|directo|direct|clash|derby|starting xi|final)\b/i.test(combinedText) ||
    /דקה\s+\d+/u.test(combinedText) ||
    /שידור חי/u.test(combinedText) ||
    /\b0:0\b/.test(combinedText);
  const hasFixtureContext =
    /\b(live|preview|lineups|lineup|match|scorecard|directo|direct|clash|derby|bowl first|teams unchanged|starting xi|final)\b/i.test(
      combinedText
    ) ||
    /בהרכב|הרכב|הרכבים|לקראת המשחק|מול/u.test(combinedText) ||
    /דקה\s+\d+/u.test(combinedText) ||
    urls.some((url) => /\/(live|preview|lineups?|scorecard|match-blog)\b/i.test(url));
  const hasFootballCoverageContext = /\b(football|futbol|soccer)\b/i.test(combinedText);
  const observedAtDate = new Date(input.observedAt).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  });
  const matchDate = explicitMatchDate ?? (hasFixtureContext && urls.length > 0 ? observedAtDate : undefined);
  const fetchNeeds = [
    ...(!explicitMatchDate && matchDate && !hasLiveCoverageContext ? ["exact-event-date"] : []),
    ...(!competitionLabel ? ["competition-name"] : [])
  ];
  const evidence = [
    ...(canonicalSides ? [`canonical-sides=${canonicalSides.join("|")}`] : []),
    ...(competitionLabel ? [`competition=${competitionLabel}`] : []),
    ...(explicitMatchDate ? [`event-date=${explicitMatchDate}`] : []),
    ...(!explicitMatchDate && matchDate ? [`event-date=observed-trend-window:${matchDate}`] : []),
    ...(hasFixtureContext ? ["fixture-context=coverage-match-page"] : [])
  ];

  return {
    matchDate,
    hasExplicitMatchDate: Boolean(explicitMatchDate),
    hasFixtureContext,
    competitionLabel,
    hasFootballCoverageContext,
    canonicalSides,
    coverageContextText: combinedText,
    fetchNeeds,
    evidence
  };
}

export function inferSportsRecurringTemplateId(text: string): SportsRecurringTemplateId | undefined {
  if (hasAnyMatch(text, soccerKeywords)) {
    return "sports-regulation-3way-v1";
  }

  if (/ליגת העל|ליגה לאומית|גביע המדינה/u.test(text)) {
    return "sports-regulation-3way-v1";
  }

  if (/ווינר סל|winner league/u.test(text)) {
    return "sports-match-winner-v1";
  }

  if (
    hasAnyMatch(text, basketballKeywords) ||
    hasAnyMatch(text, cricketKeywords) ||
    hasAnyMatch(text, twoWayFightKeywords) ||
    hasAnyMatch(text, esportsKeywords)
  ) {
    return "sports-match-winner-v1";
  }

  return undefined;
}

export function hasCompetitionGrounding(text: string): boolean {
  return /\b(final|semi[- ]?final|league|cup|derby|playoff|round|matchday|premier|la liga|serie a|bundesliga|champions)\b/i.test(
    text
  );
}

export function titled(value: string): string {
  return value
    .split(/\s+/)
    .map((part) => {
      if (part.length === 0) return part;
      if (/^[a-z]{1,3}$/i.test(part)) return part.toUpperCase();
      return `${part[0]!.toUpperCase()}${part.slice(1)}`;
    })
    .join(" ");
}
