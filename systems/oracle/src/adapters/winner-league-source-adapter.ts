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

const WINNER_LEAGUE_SOURCE_ID = "src_winner_league_basketball";
const WINNER_LEAGUE_GAMES_URL = "https://basket.co.il/pbp/json/games_all.json";
const WINNER_LEAGUE_FETCH_HEADERS = {
  "user-agent": "Navi Oracle Winner League adapter"
};
const WINNER_LEAGUE_ALLOWED_HOSTS = ["basket.co.il"];

type WinnerLeagueGame = {
  id?: number | string;
  ExternalID?: number | string;
  team_name_1?: string;
  team_name_2?: string;
  team_name_eng_1?: string;
  team_name_eng_2?: string;
  score_team1?: number | string | null;
  score_team2?: number | string | null;
  game_date_txt?: string;
  game_time?: string;
  pbp_link?: string;
  isLive?: number | string | boolean | null;
};

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractWinnerLeagueGameId(context: OracleLifecycleSourceContext): string | null {
  const haystack = readSourceHaystack(context);
  const patterns = [
    /#game-([0-9]+)/i,
    /[?&]GameId=([0-9]+)/i,
    /[?&]game_id=([0-9]+)/i,
    /basket\.co\.il\/pbp\/json\/games_all\.json[^0-9]*([0-9]+)/i
  ];

  for (const pattern of patterns) {
    const match = haystack.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function extractWinnerLeagueSourceUrl(context: OracleLifecycleSourceContext): string | null {
  const haystack = readSourceHaystack(context);
  const match = haystack.match(/https:\/\/(?:www\.)?basket\.co\.il\/\S+/i);
  return match?.[0]?.replace(/[),.]+$/g, "") ?? null;
}

function parseNumber(value: number | string | null | undefined): number | null {
  if (value == null || value === "") {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseWinnerLeagueGamesJson(raw: unknown): WinnerLeagueGame[] {
  const parsed = typeof raw === "string" ? JSON.parse(raw.replace(/^\uFEFF/, "")) : raw;
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.flatMap((item) => {
    if (item && typeof item === "object" && Array.isArray((item as { games?: unknown }).games)) {
      return (item as { games: WinnerLeagueGame[] }).games;
    }

    return [];
  });
}

function readSourceFetchUrl(sourceUrl: string | null): string {
  if (!sourceUrl) {
    return WINNER_LEAGUE_GAMES_URL;
  }

  if (sourceUrl.includes("/pbp/json/games_all.json")) {
    return sourceUrl.split("#")[0] ?? WINNER_LEAGUE_GAMES_URL;
  }

  return WINNER_LEAGUE_GAMES_URL;
}

function findWinnerLeagueGame(
  games: WinnerLeagueGame[],
  gameId: string | null,
  context: OracleLifecycleSourceContext
): WinnerLeagueGame | null {
  if (gameId) {
    const byId = games.find((game) => String(game.id ?? "") === gameId || String(game.ExternalID ?? "") === gameId);
    if (byId) {
      return byId;
    }
  }

  const outcomeLabels = context.outcomes.map((outcome) => outcome.label);
  return (
    games.find((game) => {
      const teamOne = decodeHtmlEntities(game.team_name_1 ?? "");
      const teamTwo = decodeHtmlEntities(game.team_name_2 ?? "");
      return outcomeLabels.some((label) => label === teamOne) && outcomeLabels.some((label) => label === teamTwo);
    }) ?? null
  );
}

function parseIsraeliScheduledAt(game: WinnerLeagueGame): Date | null {
  const dateMatch = String(game.game_date_txt ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const timeMatch = String(game.game_time ?? "").match(/^(\d{1,2}):(\d{2})$/);

  if (!dateMatch || !timeMatch) {
    return null;
  }

  const day = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const year = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const israelOffsetHours = month >= 3 && month <= 10 ? 3 : 2;
  return new Date(Date.UTC(year, month - 1, day, hour - israelOffsetHours, minute, 0));
}

function inspectWinnerLeagueGame(
  context: OracleLifecycleSourceContext,
  sourceUrl: string,
  game: WinnerLeagueGame | null,
  rawSnapshot: unknown,
  fetchedAt: string
): OracleSourceInspection {
  if (!game) {
    return {
      objectType: "oracle_source_inspection",
      sourceFamily: "winner_league_basketball",
      sourceUrl,
      status: "unknown",
      closeConditionSatisfied: false,
      resolutionAvailable: false,
      fetchedAt,
      rawHash: hashRawSnapshot(rawSnapshot),
      normalizedSnapshot: {},
      claimSummary: "No matching Winner League game found in the official games feed.",
      confidence: "low",
      blockers: ["missing_winner_league_game"]
    };
  }

  const homeTeam = decodeHtmlEntities(game.team_name_1 ?? "home");
  const awayTeam = decodeHtmlEntities(game.team_name_2 ?? "away");
  const homeScore = parseNumber(game.score_team1);
  const awayScore = parseNumber(game.score_team2);
  const score = homeScore == null || awayScore == null ? null : { home: homeScore, away: awayScore };
  const scheduledAt = parseIsraeliScheduledAt(game);
  const fetchedTime = Date.parse(fetchedAt);
  const beforeTipoff =
    scheduledAt != null &&
    Number.isFinite(fetchedTime) &&
    fetchedTime < scheduledAt.getTime();
  const likelyFinished =
    score != null &&
    scheduledAt != null &&
    Number.isFinite(fetchedTime) &&
    fetchedTime >= scheduledAt.getTime() + 90 * 60 * 1000;
  const status =
    beforeTipoff
      ? "not_started"
      : score == null
      ? scheduledAt != null && Number.isFinite(fetchedTime) && fetchedTime >= scheduledAt.getTime()
        ? "live"
        : "not_started"
      : likelyFinished
        ? "final"
        : "live";
  const winnerKind =
    status !== "final" || score == null
      ? "unknown"
      : score.home === score.away
        ? "draw"
        : score.home > score.away
          ? "home"
          : "away";
  const winnerLabel =
    winnerKind === "home"
      ? homeTeam
      : winnerKind === "away"
        ? awayTeam
        : winnerKind === "draw"
          ? "draw"
          : undefined;

  return {
    objectType: "oracle_source_inspection",
    sourceFamily: "winner_league_basketball",
    sourceUrl,
    status,
    closeConditionSatisfied: status === "live" || status === "final",
    resolutionAvailable: status === "final",
    winnerKind,
    winnerLabel,
    score: score ?? undefined,
    officialJsonUrl: WINNER_LEAGUE_GAMES_URL,
    fetchedAt,
    rawHash: hashRawSnapshot(rawSnapshot),
    normalizedSnapshot: {
      sourceFamily: "winner_league_basketball",
      gameId: game.id ?? null,
      externalId: game.ExternalID ?? null,
      homeTeam,
      awayTeam,
      score,
      status,
      winnerKind,
      winnerLabel,
      scheduledAt: scheduledAt?.toISOString() ?? null
    },
    claimSummary:
      score == null
        ? `Winner League official feed has no score yet for ${homeTeam} vs ${awayTeam}.`
        : status === "final"
          ? `Winner League official final result: ${homeTeam} ${score.home}, ${awayTeam} ${score.away}. Winner kind: ${winnerKind}.`
          : `Winner League official feed shows ${homeTeam} ${score.home}, ${awayTeam} ${score.away}; game appears live.`,
    confidence: homeTeam !== "home" && awayTeam !== "away" ? "high" : "medium",
    blockers: []
  };
}

async function inspectWinnerLeague(
  context: OracleLifecycleSourceContext,
  fetchers: OracleSourceAdapterFetchers
): Promise<OracleSourceInspection> {
  const sourceUrl = extractWinnerLeagueSourceUrl(context) ?? WINNER_LEAGUE_GAMES_URL;
  const fetchUrl = readSourceFetchUrl(sourceUrl);
  const fetchedAt = defaultFetchedAt(fetchers);
  const raw = fetchers.fetchJson
    ? await fetchers.fetchJson(fetchUrl)
    : await fetchOracleAdapterText(fetchUrl, {
      headers: WINNER_LEAGUE_FETCH_HEADERS,
      allowedHosts: WINNER_LEAGUE_ALLOWED_HOSTS
    });
  const games = parseWinnerLeagueGamesJson(raw);
  const game = findWinnerLeagueGame(games, extractWinnerLeagueGameId(context), context);
  return inspectWinnerLeagueGame(context, sourceUrl, game, raw, fetchedAt);
}

export const WINNER_LEAGUE_SOURCE_ADAPTER: OracleLifecycleSourceAdapter = {
  sourceFamily: "winner_league_basketball",
  sourceLabel: "Winner League official games feed",
  sourceIds: [WINNER_LEAGUE_SOURCE_ID],
  measurementKinds: ["final_winner"],
  resultShapes: ["home_away_winner"],
  routes: [
    { measurementKind: "final_winner", resultShape: "home_away_winner" }
  ],
  capabilities: {
    closeCondition: true,
    resolution: true
  },
  supportsSource: (context) =>
    readContractSourceIds(context).includes(WINNER_LEAGUE_SOURCE_ID) ||
    /basket\.co\.il/i.test(readSourceHaystack(context)),
  inspectCloseCondition: inspectWinnerLeague,
  inspectResolution: inspectWinnerLeague
};
