import {
  defaultFetchedAt,
  fetchOracleAdapterJson,
  hashRawSnapshot,
  normalizeComparable,
  readContractSourceIds,
  readSourceHaystack,
  type OracleLifecycleSourceAdapter,
  type OracleLifecycleSourceContext,
  type OracleSourceAdapterFetchers,
  type OracleSourceInspection
} from "../source-adapter-contracts";

const NBA_FETCH_HEADERS = {
  "user-agent": "Navi Oracle lifecycle source adapter"
};
const NBA_ALLOWED_HOSTS = ["nba-prod-us-east-1-mediaops-stats.s3.amazonaws.com"];

type NbaTeamSnapshot = {
  teamCity?: unknown;
  teamName?: unknown;
  teamTricode?: unknown;
  score?: unknown;
};

type NbaGameSnapshot = {
  gameId?: unknown;
  gameStatus?: unknown;
  gameStatusText?: unknown;
  gameTimeUTC?: unknown;
  homeTeam?: NbaTeamSnapshot;
  awayTeam?: NbaTeamSnapshot;
};

type ParsedNbaTeam = {
  label: string;
  shortName: string;
  tricode: string;
  score: number;
};

type ParsedNbaGame = {
  gameId: string;
  officialStatus: string;
  observedAt: string | null;
  homeTeam: ParsedNbaTeam | null;
  awayTeam: ParsedNbaTeam | null;
  winner: ParsedNbaTeam | null;
  loser: ParsedNbaTeam | null;
};

const NBA_TEAM_ALIASES_BY_TRICODE: Record<string, string[]> = {
  ATL: ["Atlanta Hawks", "Hawks", "אטלנטה הוקס", "הוקס"],
  BOS: ["Boston Celtics", "Celtics", "בוסטון סלטיקס", "סלטיקס"],
  BKN: ["Brooklyn Nets", "Nets", "ברוקלין נטס", "נטס"],
  CHA: ["Charlotte Hornets", "Hornets", "שארלוט הורנטס", "הורנטס"],
  CHI: ["Chicago Bulls", "Bulls", "שיקגו בולס", "בולס"],
  CLE: ["Cleveland Cavaliers", "Cavaliers", "קליבלנד קאבלירס", "קאבלירס"],
  DAL: ["Dallas Mavericks", "Mavericks", "Mavs", "דאלאס מאבריקס", "מאבריקס"],
  DEN: ["Denver Nuggets", "Nuggets", "דנבר נאגטס", "נאגטס"],
  DET: ["Detroit Pistons", "Pistons", "דטרויט פיסטונס", "פיסטונס"],
  GSW: ["Golden State Warriors", "Warriors", "גולדן סטייט ווריורס", "ווריורס"],
  HOU: ["Houston Rockets", "Rockets", "יוסטון רוקטס", "רוקטס"],
  IND: ["Indiana Pacers", "Pacers", "אינדיאנה פייסרס", "פייסרס"],
  LAC: ["LA Clippers", "Los Angeles Clippers", "Clippers", "לוס אנג'לס קליפרס", "קליפרס"],
  LAL: ["Los Angeles Lakers", "LA Lakers", "Lakers", "לוס אנג'לס לייקרס", "לייקרס"],
  MEM: ["Memphis Grizzlies", "Grizzlies", "ממפיס גריזליס", "גריזליס"],
  MIA: ["Miami Heat", "Heat", "מיאמי היט", "היט"],
  MIL: ["Milwaukee Bucks", "Bucks", "מילווקי באקס", "באקס"],
  MIN: ["Minnesota Timberwolves", "Timberwolves", "Wolves", "מינסוטה טימברוולבס", "טימברוולבס"],
  NOP: ["New Orleans Pelicans", "Pelicans", "ניו אורלינס פליקנס", "פליקנס"],
  NYK: ["New York Knicks", "Knicks", "ניו יורק ניקס", "ניקס"],
  OKC: ["Oklahoma City Thunder", "OKC Thunder", "Thunder", "אוקלהומה סיטי ת'אנדר", "אוקלהומה סיטי", "ת'אנדר"],
  ORL: ["Orlando Magic", "Magic", "אורלנדו מג'יק", "מג'יק"],
  PHI: ["Philadelphia 76ers", "76ers", "Sixers", "פילדלפיה סיקסרס", "סיקסרס"],
  PHX: ["Phoenix Suns", "Suns", "פיניקס סאנס", "סאנס"],
  POR: ["Portland Trail Blazers", "Trail Blazers", "Blazers", "פורטלנד טרייל בלייזרס", "בלייזרס"],
  SAC: ["Sacramento Kings", "Kings", "סקרמנטו קינגס", "קינגס"],
  SAS: ["San Antonio Spurs", "Spurs", "סן אנטוניו ספרס", "ספרס"],
  TOR: ["Toronto Raptors", "Raptors", "טורונטו ראפטורס", "ראפטורס"],
  UTA: ["Utah Jazz", "Jazz", "יוטה ג'אז", "ג'אז"],
  WAS: ["Washington Wizards", "Wizards", "וושינגטון וויזארדס", "וויזארדס"]
};

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readScore(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function extractNbaGameUrl(context: OracleLifecycleSourceContext): string | null {
  const match = readSourceHaystack(context).match(/https:\/\/www\.nba\.com\/game\/[a-z0-9-]+-\d{10}/i);
  return match?.[0] ?? null;
}

function extractNbaGameId(sourceUrl: string): string | null {
  const match = sourceUrl.match(/-(\d{10})(?:\b|$)/);
  return match?.[1] ?? null;
}

function buildNbaBoxscoreUrl(gameId: string): string {
  return `https://nba-prod-us-east-1-mediaops-stats.s3.amazonaws.com/NBA/liveData/boxscore/boxscore_${gameId}.json`;
}

function buildNbaTodayScoreboardUrl(): string {
  return "https://nba-prod-us-east-1-mediaops-stats.s3.amazonaws.com/NBA/liveData/scoreboard/todaysScoreboard_00.json";
}

function parseTeamSnapshot(team: NbaTeamSnapshot | undefined): ParsedNbaTeam | null {
  const city = readString(team?.teamCity);
  const name = readString(team?.teamName);
  const tricode = readString(team?.teamTricode);
  const score = readScore(team?.score);

  if (!name || score == null) {
    return null;
  }

  return {
    label: city ? `${city} ${name}` : name,
    shortName: name,
    tricode,
    score
  };
}

function parseNbaGame(gameId: string, payload: unknown): ParsedNbaGame | null {
  const record =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as { game?: NbaGameSnapshot; scoreboard?: { games?: NbaGameSnapshot[] } })
      : undefined;
  const root =
    record?.game ??
    record?.scoreboard?.games?.find((game) => readString(game.gameId) === gameId);

  if (!root) {
    return null;
  }

  const statusText = readString(root.gameStatusText);
  const statusCode = readScore(root.gameStatus);
  const officialStatus = statusText || String(statusCode ?? "unknown");
  const homeTeam = parseTeamSnapshot(root.homeTeam);
  const awayTeam = parseTeamSnapshot(root.awayTeam);
  const isFinal = statusCode === 3 || statusText.toLowerCase() === "final";
  const winner =
    isFinal && homeTeam && awayTeam && homeTeam.score !== awayTeam.score
      ? homeTeam.score > awayTeam.score
        ? homeTeam
        : awayTeam
      : null;
  const loser =
    winner && homeTeam && awayTeam ? (winner === homeTeam ? awayTeam : homeTeam) : null;

  return {
    gameId,
    officialStatus,
    observedAt: readString(root.gameTimeUTC) || null,
    homeTeam,
    awayTeam,
    winner,
    loser
  };
}

const defaultFetchJson = (url: string): Promise<unknown> =>
  fetchOracleAdapterJson(url, {
    headers: NBA_FETCH_HEADERS,
    allowedHosts: NBA_ALLOWED_HOSTS
  });

async function fetchNbaPayload(
  gameId: string,
  fetchJson: (url: string) => Promise<unknown>
): Promise<{ payload: unknown; officialJsonUrl: string; fallbackReason?: string }> {
  const boxscoreUrl = buildNbaBoxscoreUrl(gameId);

  try {
    return {
      payload: await fetchJson(boxscoreUrl),
      officialJsonUrl: boxscoreUrl
    };
  } catch (error) {
    const scoreboardUrl = buildNbaTodayScoreboardUrl();
    return {
      payload: await fetchJson(scoreboardUrl),
      officialJsonUrl: scoreboardUrl,
      fallbackReason: error instanceof Error ? error.message : "boxscore_fetch_failed"
    };
  }
}

async function inspectNba(context: OracleLifecycleSourceContext, fetchers: OracleSourceAdapterFetchers): Promise<OracleSourceInspection> {
  const sourceUrl = extractNbaGameUrl(context);
  const fetchedAt = defaultFetchedAt(fetchers);

  if (!sourceUrl) {
    return {
      objectType: "oracle_source_inspection",
      sourceFamily: "nba_official_game",
      sourceUrl: "",
      status: "unknown",
      closeConditionSatisfied: false,
      resolutionAvailable: false,
      fetchedAt,
      rawHash: hashRawSnapshot(""),
      normalizedSnapshot: {},
      claimSummary: "No NBA official game URL found.",
      confidence: "low",
      blockers: ["missing_nba_game_url"]
    };
  }

  const gameId = extractNbaGameId(sourceUrl);

  if (!gameId) {
    return {
      objectType: "oracle_source_inspection",
      sourceFamily: "nba_official_game",
      sourceUrl,
      status: "unknown",
      closeConditionSatisfied: false,
      resolutionAvailable: false,
      fetchedAt,
      rawHash: hashRawSnapshot(sourceUrl),
      normalizedSnapshot: {},
      claimSummary: "NBA official source URL did not include a parseable game id.",
      confidence: "low",
      blockers: ["missing_nba_game_id"]
    };
  }

  const fetched = await fetchNbaPayload(gameId, fetchers.fetchJson ?? defaultFetchJson);
  const { officialJsonUrl, payload } = fetched;
  const parsed = parseNbaGame(gameId, payload);

  if (!parsed) {
    return {
      objectType: "oracle_source_inspection",
      sourceFamily: "nba_official_game",
      sourceUrl,
      officialJsonUrl,
      status: "unknown",
      closeConditionSatisfied: false,
      resolutionAvailable: false,
      fetchedAt,
      rawHash: hashRawSnapshot(payload),
      normalizedSnapshot: {},
      claimSummary: "NBA boxscore payload did not match expected game/team shape.",
      confidence: "low",
      blockers: ["nba_payload_unparseable"]
    };
  }

  const officialStatusLower = parsed.officialStatus.toLowerCase();
  const officialStatusCode = Number(parsed.officialStatus);
  const status =
    officialStatusCode === 3 || officialStatusLower === "final"
      ? "final"
      : officialStatusCode === 2 || officialStatusLower.includes("qtr") || officialStatusLower.includes("halftime")
        ? "live"
        : officialStatusCode === 1 || /\d{1,2}:\d{2}\s*(am|pm)\s*et/i.test(parsed.officialStatus)
          ? "not_started"
          : "unknown";
  const normalizedSnapshot = {
    gameId,
    officialStatus: parsed.officialStatus,
    observedAt: parsed.observedAt,
    homeTeam: parsed.homeTeam,
    awayTeam: parsed.awayTeam,
    winner: parsed.winner,
    fallbackReason: fetched.fallbackReason
  };

  return {
    objectType: "oracle_source_inspection",
    sourceFamily: "nba_official_game",
    sourceUrl,
    officialJsonUrl,
    status,
    closeConditionSatisfied: status === "live" || status === "final",
    resolutionAvailable: status === "final" && Boolean(parsed.winner),
    winnerKind:
      parsed.winner && parsed.homeTeam
        ? parsed.winner.label === parsed.homeTeam.label
          ? "home"
          : "away"
        : parsed.homeTeam && parsed.awayTeam && parsed.homeTeam.score === parsed.awayTeam.score
          ? "draw"
          : "unknown",
    winnerLabel: parsed.winner?.label,
    score:
      parsed.homeTeam && parsed.awayTeam
        ? {
            home: parsed.homeTeam.score,
            away: parsed.awayTeam.score
          }
        : undefined,
    fetchedAt,
    rawHash: hashRawSnapshot(payload),
    normalizedSnapshot,
    claimSummary: parsed.winner && parsed.loser
      ? `Official NBA final result for game ${gameId} is ${parsed.officialStatus}: ${parsed.winner.label} ${parsed.winner.score}, ${parsed.loser.label} ${parsed.loser.score}. Winning outcome maps to ${parsed.winner.label}.`
      : `Official NBA game ${gameId} status is ${parsed.officialStatus}.`,
    confidence: parsed.winner ? "high" : "medium",
    blockers: []
  };
}

export function buildNbaWinnerAliases(winnerLabel: string, tricode?: string): string[] {
  const normalizedTricode = tricode?.trim().toUpperCase();

  return [
    ...new Set([
      winnerLabel,
      ...(normalizedTricode ? [normalizedTricode, ...(NBA_TEAM_ALIASES_BY_TRICODE[normalizedTricode] ?? [])] : [])
    ])
  ].filter(Boolean);
}

export function outcomeMatchesNbaWinner(outcomeLabel: string, outcomeKeyTail: string, inspection: OracleSourceInspection): boolean {
  const winner = inspection.normalizedSnapshot.winner as { label?: string; shortName?: string; tricode?: string } | undefined;
  const aliases = buildNbaWinnerAliases(
    inspection.winnerLabel ?? winner?.label ?? "",
    winner?.tricode
  ).map(normalizeComparable);
  const label = normalizeComparable(outcomeLabel);
  const key = normalizeComparable(outcomeKeyTail);

  return aliases.some(
    (candidate) =>
      candidate.length > 0 &&
      (label === candidate || key === candidate || label.includes(candidate))
  );
}

export const NBA_SOURCE_ADAPTER: OracleLifecycleSourceAdapter = {
  sourceFamily: "nba_official_game",
  sourceLabel: "NBA official game page",
  sourceIds: ["src_nba_official_games"],
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
    readContractSourceIds(context).includes("src_nba_official_games") ||
    Boolean(extractNbaGameUrl(context)),
  inspectCloseCondition: inspectNba,
  inspectResolution: inspectNba
};
