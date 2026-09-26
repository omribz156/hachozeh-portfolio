import {
  defaultFetchedAt,
  fetchOracleAdapterText,
  hashRawSnapshot,
  normalizeComparable,
  readContractResolutionSourceUrl,
  readContractSourceIds,
  readSourceHaystack,
  type OracleLifecycleSourceAdapter,
  type OracleLifecycleSourceContext,
  type OracleSourceAdapterFetchers,
  type OracleSourceInspection
} from "../source-adapter-contracts";

type EurovisionScoreboardEntry = {
  country: string;
  orderIndex: number;
  totalPoints: number | null;
  juryPoints: number | null;
  audiencePoints: number | null;
  runningOrder: number | null;
};

type EurovisionMarketPredicate =
  | { kind: "winner"; country: string }
  | { kind: "top_n"; country: string; n: number }
  | { kind: "jury_winner"; country: string }
  | { kind: "televote_winner"; country: string }
  | { kind: "last_place"; country: string }
  | { kind: "overall_winner" }
  | { kind: "overall_last_place" };

const EUROVISION_SOURCE_ID = "src_eurovision_official";
const DEFAULT_EUROVISION_FINAL_URL =
  "https://www.eurovision.com/eurovision-song-contest/vienna-2026/vienna-2026-grand-final/";
const EUROVISION_FETCH_HEADERS = {
  "user-agent": "Navi Oracle Eurovision scoreboard adapter"
};
const EUROVISION_ALLOWED_HOSTS = ["www.eurovision.com"];

const COUNTRY_ALIASES: Record<string, string[]> = {
  Israel: ["israel", "ישראל", "ישראלי", "הישראלית"],
  Finland: ["finland", "פינלנד"],
  Australia: ["australia", "אוסטרליה"],
  "United Kingdom": ["united kingdom", "uk", "בריטניה", "הממלכה המאוחדת"],
  Austria: ["austria", "אוסטריה"],
  Denmark: ["denmark", "דנמרק"],
  Germany: ["germany", "גרמניה"],
  Belgium: ["belgium", "בלגיה"],
  Albania: ["albania", "אלבניה"],
  Greece: ["greece", "יוון"],
  Ukraine: ["ukraine", "אוקראינה"],
  Serbia: ["serbia", "סרביה"],
  Malta: ["malta", "מלטה"],
  Czechia: ["czechia", "צ'כיה"],
  Bulgaria: ["bulgaria", "בולגריה"],
  Croatia: ["croatia", "קרואטיה"],
  France: ["france", "צרפת"],
  Moldova: ["moldova", "מולדובה"],
  Poland: ["poland", "פולין"],
  Lithuania: ["lithuania", "ליטא"],
  Sweden: ["sweden", "שוודיה"],
  Cyprus: ["cyprus", "קפריסין"],
  Italy: ["italy", "איטליה"],
  Norway: ["norway", "נורווגיה"],
  Romania: ["romania", "רומניה"]
};

function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

function readNumber(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/,/g, "").trim();

  if (!/^\d+$/.test(normalized)) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractMetric(block: string, label: "Jury" | "Audience" | "Running Order"): number | null {
  const htmlMatch = block.match(
    new RegExp(`data-row-entry-result-label[^>]*>\\s*${label}\\s*<\\/span>\\s*<span[^>]*>\\s*(\\d+|TBC)`, "i")
  );

  if (htmlMatch?.[1]) {
    return readNumber(htmlMatch[1]);
  }

  const match = stripHtml(block).match(new RegExp(`${label}\\s+(\\d+|TBC)`, "i"));
  return readNumber(match?.[1]);
}

export function parseEurovisionScoreboard(html: string): EurovisionScoreboardEntry[] {
  const entries: EurovisionScoreboardEntry[] = [];
  const entryPattern =
    /<div class="data-row-entry scoreboard-entry[\s\S]*?aria-label="Scoreboard entry for ([^"]+)"[\s\S]*?(?=<div class="data-row-entry scoreboard-entry|<\/section>|$)/gi;
  let match: RegExpExecArray | null;

  while ((match = entryPattern.exec(html)) != null) {
    const block = match[0];
    const country = stripHtml(match[1] ?? "");
    const totalPoints = readNumber(block.match(/>\s*([\d,]+)\s+points\s*<\/p>/i)?.[1]);

    if (!country) {
      continue;
    }

    entries.push({
      country,
      orderIndex: entries.length,
      totalPoints,
      juryPoints: extractMetric(block, "Jury"),
      audiencePoints: extractMetric(block, "Audience"),
      runningOrder: extractMetric(block, "Running Order")
    });
  }

  return entries;
}

function readEurovisionSourceUrl(context: OracleLifecycleSourceContext): string {
  return readContractResolutionSourceUrl(context) ?? context.resolutionSource.match(/https:\/\/www\.eurovision\.com\/\S+/i)?.[0] ?? DEFAULT_EUROVISION_FINAL_URL;
}

function inferCountry(haystack: string): string | null {
  const normalizedHaystack = normalizeComparable(haystack);
  const matches = Object.entries(COUNTRY_ALIASES)
    .filter(([, aliases]) => aliases.some((alias) => normalizedHaystack.includes(normalizeComparable(alias))))
    .map(([country]) => country);

  return matches.length === 1 ? matches[0] ?? null : null;
}

function inferPredicate(context: OracleLifecycleSourceContext): EurovisionMarketPredicate | null {
  const haystack = readSourceHaystack(context);
  const titleText = [context.marketTitle, context.marketContract?.measurement].filter(Boolean).join(" ");
  const country = inferCountry(haystack);

  if (context.marketContract?.resultShape === "multi_outcome" || context.marketContract?.resultShape === "multi-outcome") {
    if (/אחרונה|מקום\s+ה?אחרון|last place/i.test(titleText)) {
      return { kind: "overall_last_place" };
    }

    if (/מי\s+תזכה|מי\s+ינצח|winner|who\s+will\s+win/i.test(titleText)) {
      return { kind: "overall_winner" };
    }
  }

  if (!country) {
    return null;
  }

  const topMatch = titleText.match(/(?:טופ\s*(3|5|10)|top\s*(3|5|10))/i);

  if (topMatch?.[1] || topMatch?.[2]) {
    return { kind: "top_n", country, n: Number(topMatch[1] ?? topMatch[2]) };
  }

  if (/הצבעת\s+הקהל|televote|public vote/i.test(titleText)) {
    return { kind: "televote_winner", country };
  }

  if (/הצבעת\s+השופטים|jury/i.test(titleText)) {
    return { kind: "jury_winner", country };
  }

  if (/אחרונה|מקום\s+ה?אחרון|last place/i.test(titleText)) {
    return { kind: "last_place", country };
  }

  if (/תזכה|תנצח|לנצח|winner|win/i.test(titleText)) {
    return { kind: "winner", country };
  }

  return null;
}

function rankEntries(
  entries: EurovisionScoreboardEntry[],
  metric: "totalPoints" | "juryPoints" | "audiencePoints"
): EurovisionScoreboardEntry[] {
  return entries
    .filter((entry) => entry[metric] != null)
    .sort((left, right) => {
      const rightMetric = right[metric] ?? -1;
      const leftMetric = left[metric] ?? -1;
      return rightMetric - leftMetric || left.orderIndex - right.orderIndex;
    });
}

function rankMap(
  entries: EurovisionScoreboardEntry[],
  metric: "totalPoints" | "juryPoints" | "audiencePoints"
): Map<string, number> {
  const ranked = rankEntries(entries, metric);
  return new Map(ranked.map((entry, index) => [entry.country, index + 1]));
}

function evidenceKeyForCountry(country: string): string {
  return `country:${country.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
}

function evaluatePredicate(predicate: EurovisionMarketPredicate, entries: EurovisionScoreboardEntry[]): {
  yesWins: boolean;
  targetEntry: EurovisionScoreboardEntry;
  targetRank: number;
  metric: "totalPoints" | "juryPoints" | "audiencePoints";
} | null {
  if (predicate.kind === "overall_winner" || predicate.kind === "overall_last_place") {
    const ranked = rankEntries(entries, "totalPoints");
    const targetEntry = predicate.kind === "overall_winner" ? ranked[0] : ranked[ranked.length - 1];

    if (!targetEntry) {
      return null;
    }

    return {
      yesWins: true,
      targetEntry,
      targetRank: predicate.kind === "overall_winner" ? 1 : ranked.length,
      metric: "totalPoints"
    };
  }

  const targetEntry = entries.find((entry) => entry.country === predicate.country);

  if (!targetEntry) {
    return null;
  }

  const metric =
    predicate.kind === "jury_winner"
      ? "juryPoints"
      : predicate.kind === "televote_winner"
        ? "audiencePoints"
        : "totalPoints";
  const ranks = rankMap(entries, metric);
  const targetRank = ranks.get(predicate.country);

  if (!targetRank) {
    return null;
  }

  if (predicate.kind === "top_n") {
    return { yesWins: targetRank <= predicate.n, targetEntry, targetRank, metric };
  }

  if (predicate.kind === "last_place") {
    return { yesWins: targetRank === ranks.size, targetEntry, targetRank, metric };
  }

  return { yesWins: targetRank === 1, targetEntry, targetRank, metric };
}

function predicateLabel(predicate: EurovisionMarketPredicate): string {
  switch (predicate.kind) {
    case "top_n":
      return `${predicate.country} top ${predicate.n}`;
    case "jury_winner":
      return `${predicate.country} jury winner`;
    case "televote_winner":
      return `${predicate.country} televote winner`;
    case "last_place":
      return `${predicate.country} last place`;
    case "overall_winner":
      return "overall winner";
    case "overall_last_place":
      return "overall last place";
    case "winner":
      return `${predicate.country} winner`;
  }
}

async function inspectEurovisionScoreboard(
  context: OracleLifecycleSourceContext,
  fetchers: OracleSourceAdapterFetchers
): Promise<OracleSourceInspection> {
  const fetchedAt = defaultFetchedAt(fetchers);
  const sourceUrl = readEurovisionSourceUrl(context);
  const html = await (
    fetchers.fetchText ??
    ((url) => fetchOracleAdapterText(url, {
      headers: EUROVISION_FETCH_HEADERS,
      allowedHosts: EUROVISION_ALLOWED_HOSTS
    }))
  )(sourceUrl);
  const entries = parseEurovisionScoreboard(html);
  const predicate = inferPredicate(context);
  const baseSnapshot = {
    officialStatus: "scoreboard",
    entryCount: entries.length,
    entries,
    predicate
  };

  if (!predicate) {
    return {
      objectType: "oracle_source_inspection",
      sourceFamily: "eurovision_official_scoreboard",
      sourceUrl,
      status: "unknown",
      closeConditionSatisfied: true,
      resolutionAvailable: false,
      fetchedAt,
      rawHash: hashRawSnapshot(html),
      normalizedSnapshot: baseSnapshot,
      claimSummary: "Eurovision contract is missing a parseable country/result predicate.",
      confidence: "low",
      blockers: ["eurovision_predicate_unparseable"]
    };
  }

  if (entries.length < 2 || entries.every((entry) => entry.totalPoints == null)) {
    return {
      objectType: "oracle_source_inspection",
      sourceFamily: "eurovision_official_scoreboard",
      sourceUrl,
      status: "not_started",
      closeConditionSatisfied: false,
      resolutionAvailable: false,
      fetchedAt,
      rawHash: hashRawSnapshot(html),
      normalizedSnapshot: baseSnapshot,
      claimSummary: "Eurovision official scoreboard is not final yet.",
      confidence: "medium",
      blockers: ["eurovision_scoreboard_not_final"]
    };
  }

  const evaluated = evaluatePredicate(predicate, entries);

  if (!evaluated) {
    return {
      objectType: "oracle_source_inspection",
      sourceFamily: "eurovision_official_scoreboard",
      sourceUrl,
      status: "unknown",
      closeConditionSatisfied: true,
      resolutionAvailable: false,
      fetchedAt,
      rawHash: hashRawSnapshot(html),
      normalizedSnapshot: baseSnapshot,
      claimSummary: `Eurovision official scoreboard did not expose enough data for ${predicateLabel(predicate)}.`,
      confidence: "medium",
      blockers: ["eurovision_scoreboard_predicate_no_match"]
    };
  }

  return {
    objectType: "oracle_source_inspection",
    sourceFamily: "eurovision_official_scoreboard",
    sourceUrl,
    status: "final",
    closeConditionSatisfied: true,
    resolutionAvailable: true,
    evidenceKey:
      predicate.kind === "overall_winner" || predicate.kind === "overall_last_place"
        ? evidenceKeyForCountry(evaluated.targetEntry.country)
        : evaluated.yesWins
          ? "yes"
          : "no",
    winnerKind: "named",
    winnerLabel:
      predicate.kind === "overall_winner" || predicate.kind === "overall_last_place"
        ? evaluated.targetEntry.country
        : evaluated.yesWins
          ? "כן"
          : "לא",
    fetchedAt,
    rawHash: hashRawSnapshot(html),
    normalizedSnapshot: {
      ...baseSnapshot,
      targetEntry: evaluated.targetEntry,
      targetRank: evaluated.targetRank,
      metric: evaluated.metric,
      winnerLabel: evaluated.targetEntry.country,
      yesWins: evaluated.yesWins
    },
    claimSummary:
      predicate.kind === "overall_winner" || predicate.kind === "overall_last_place"
        ? `Eurovision official scoreboard maps ${predicateLabel(predicate)} to ${evaluated.targetEntry.country}: rank ${evaluated.targetRank} by ${evaluated.metric}.`
        : `Eurovision official scoreboard maps ${predicateLabel(predicate)} to ${evaluated.yesWins ? "כן" : "לא"}: rank ${evaluated.targetRank} by ${evaluated.metric}.`,
    confidence: "high",
    blockers: []
  };
}

export const EUROVISION_SCOREBOARD_SOURCE_ADAPTER: OracleLifecycleSourceAdapter = {
  sourceFamily: "eurovision_official_scoreboard",
  sourceLabel: "Eurovision official scoreboard",
  sourceIds: [EUROVISION_SOURCE_ID],
  measurementKinds: ["final_winner", "official_value"],
  resultShapes: ["yes_no", "multi_outcome"],
  routes: [
    { measurementKind: "final_winner", resultShape: "yes_no" },
    { measurementKind: "official_value", resultShape: "multi_outcome" }
  ],
  capabilities: {
    closeCondition: false,
    resolution: true
  },
  supportsSource: (context) =>
    readContractSourceIds(context).includes(EUROVISION_SOURCE_ID) ||
    /eurovision\.com\/eurovision-song-contest\/.+grand-final/i.test(readSourceHaystack(context)),
  inspectCloseCondition: inspectEurovisionScoreboard,
  inspectResolution: inspectEurovisionScoreboard
};
