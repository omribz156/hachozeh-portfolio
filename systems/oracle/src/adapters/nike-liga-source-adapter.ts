import {
  defaultFetchedAt,
  fetchOracleAdapterText,
  hashRawSnapshot,
  readContractSourceIds,
  readSourceHaystack,
  type OracleLifecycleSourceAdapter,
  type OracleLifecycleSourceContext,
  type OracleSourceAdapterFetchers,
  type OracleSourceInspection
} from "../source-adapter-contracts";

const NIKE_LIGA_FETCH_HEADERS = {
  "user-agent": "Navi Oracle lifecycle source adapter"
};
const NIKE_LIGA_ALLOWED_HOSTS = ["www.nikeliga.sk"];

function extractNikeLigaUrl(context: OracleLifecycleSourceContext): string | null {
  const match = readSourceHaystack(context).match(/https:\/\/www\.nikeliga\.sk\/zapas\/[0-9]+-[a-z0-9-]+/i);
  return match?.[0] ?? null;
}

function stripTags(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function statusForScore(score: { home: number; away: number } | null, isFinal: boolean): OracleSourceInspection["status"] {
  if (isFinal) {
    return "final";
  }

  return score ? "live" : "not_started";
}

function winnerKindForScore(score: { home: number; away: number } | null): "home" | "away" | "draw" | "unknown" {
  if (!score) {
    return "unknown";
  }

  if (score.home === score.away) {
    return "draw";
  }

  return score.home > score.away ? "home" : "away";
}

function winnerLabelForKind(
  winnerKind: "home" | "away" | "draw" | "unknown",
  teams: { home: string; away: string }
): string | undefined {
  switch (winnerKind) {
    case "home":
      return teams.home;
    case "away":
      return teams.away;
    case "draw":
      return "draw";
    default:
      return undefined;
  }
}

function readMainScoreboardBlock(html: string): string {
  const start = html.indexOf("game__scoreboard");

  if (start === -1) {
    return html;
  }

  const end = html.indexOf("game__additional", start);
  return html.slice(start, end === -1 ? undefined : end);
}

function readTeamNames(block: string): { home: string; away: string } {
  const matches = [...block.matchAll(/<span class="hidden-xs">\s*([^<]+?)\s*<\/span>/gi)]
    .map((match) => stripTags(match[1] ?? ""))
    .filter(Boolean);

  return {
    home: matches[0] ?? "home",
    away: matches[1] ?? "away"
  };
}

function readScore(block: string): { home: number; away: number } | null {
  const scoreSectionMatch = block.match(/game__scoreboard__score[\s\S]*?(?=game__scoreboard__team--away|<\/div><\/div>)/i);
  const scoreSection = scoreSectionMatch?.[0] ?? block;
  const match = scoreSection.match(/(?:>|^)\s*(\d{1,2})\s*:\s*(\d{1,2})\s*(?:<|$)/);

  if (!match) {
    return null;
  }

  const home = Number(match[1]);
  const away = Number(match[2]);

  if (!Number.isFinite(home) || !Number.isFinite(away)) {
    return null;
  }

  return {
    home,
    away
  };
}

function readIsFinal(block: string): boolean {
  if (/game__scoreboard__fulltime/i.test(block)) {
    return true;
  }

  const text = stripTags(block).toLowerCase();
  return [
    "koniec zápasu",
    "koniec zapasu",
    "po zápase",
    "po zapase",
    "final",
    "full time"
  ].some((needle) => text.includes(needle));
}

function inspectNikeLigaHtml(
  context: OracleLifecycleSourceContext,
  sourceUrl: string,
  html: string,
  fetchedAt: string
): OracleSourceInspection {
  const block = readMainScoreboardBlock(html);
  const teams = readTeamNames(block);
  const score = readScore(block);
  const isFinal = score != null && readIsFinal(block);
  const status = statusForScore(score, isFinal);
  const winnerKind = winnerKindForScore(score);
  const winnerLabel = winnerLabelForKind(winnerKind, teams);
  const normalizedSnapshot = {
    sourceFamily: "nike_liga_match_page",
    homeTeam: teams.home,
    awayTeam: teams.away,
    score,
    status,
    winnerKind,
    winnerLabel,
    closeAt: context.closeAt
  };

  return {
    objectType: "oracle_source_inspection",
    sourceFamily: "nike_liga_match_page",
    sourceUrl,
    status,
    closeConditionSatisfied: status === "live" || status === "final",
    resolutionAvailable: status === "final",
    winnerKind,
    winnerLabel,
    score: score ?? undefined,
    fetchedAt,
    rawHash: hashRawSnapshot(html),
    normalizedSnapshot,
    claimSummary:
      score == null
        ? `Niké Liga official page for ${teams.home} vs ${teams.away} has not started yet.`
        : isFinal
          ? `Niké Liga official final result: ${teams.home} ${score.home}, ${teams.away} ${score.away}. Winner kind: ${winnerKind}.`
          : `Niké Liga official page shows ${teams.home} ${score.home}, ${teams.away} ${score.away}; match appears live.`,
    confidence: teams.home !== "home" && teams.away !== "away" ? "high" : "medium",
    blockers: []
  };
}

async function inspectNikeLiga(
  context: OracleLifecycleSourceContext,
  fetchers: OracleSourceAdapterFetchers
): Promise<OracleSourceInspection> {
  const sourceUrl = extractNikeLigaUrl(context);
  const fetchedAt = defaultFetchedAt(fetchers);

  if (!sourceUrl) {
    return {
      objectType: "oracle_source_inspection",
      sourceFamily: "nike_liga_match_page",
      sourceUrl: "",
      status: "unknown",
      closeConditionSatisfied: false,
      resolutionAvailable: false,
      fetchedAt,
      rawHash: hashRawSnapshot(""),
      normalizedSnapshot: {},
      claimSummary: "No Niké Liga official match URL found.",
      confidence: "low",
      blockers: ["missing_nike_liga_match_url"]
    };
  }

  const html = await (
    fetchers.fetchText ??
    ((url) => fetchOracleAdapterText(url, {
      headers: NIKE_LIGA_FETCH_HEADERS,
      allowedHosts: NIKE_LIGA_ALLOWED_HOSTS
    }))
  )(sourceUrl);
  return inspectNikeLigaHtml(context, sourceUrl, html, fetchedAt);
}

export const NIKE_LIGA_SOURCE_ADAPTER: OracleLifecycleSourceAdapter = {
  sourceFamily: "nike_liga_match_page",
  sourceLabel: "Niké Liga official match page",
  sourceIds: ["src_nike_liga_official"],
  measurementKinds: ["final_winner"],
  resultShapes: ["home_away_winner", "three_way_result"],
  routes: [
    { measurementKind: "final_winner", resultShape: "home_away_winner" },
    { measurementKind: "final_winner", resultShape: "three_way_result" }
  ],
  capabilities: {
    closeCondition: true,
    resolution: true
  },
  supportsSource: (context) =>
    readContractSourceIds(context).includes("src_nike_liga_official") ||
    Boolean(extractNikeLigaUrl(context)),
  inspectCloseCondition: inspectNikeLiga,
  inspectResolution: inspectNikeLiga
};
