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

const FIBA_SOURCE_ID = "src_fiba_basketball_games";
const FIBA_FETCH_HEADERS = {
  "user-agent": "Navi Oracle FIBA adapter"
};

type ParsedFibaGame = {
  gameId: string;
  teamA: { code: string; label: string; score: number };
  teamB: { code: string; label: string; score: number };
  isLive: boolean;
  liveGameStatus: number | null;
  currentPeriodStatus: string;
  scheduledAt: string | null;
  postponed: boolean;
};

function readString(value: RegExpMatchArray | null, index: number): string {
  return value?.[index]?.trim() ?? "";
}

function readNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractFibaGameUrl(context: OracleLifecycleSourceContext): string | null {
  const match = readSourceHaystack(context).match(
    /https:\/\/www\.fiba\.basketball\/en\/events\/[^"'\s<>]+\/games\/[0-9]+-[A-Z]{3}-[A-Z]{3}/i
  );
  return match?.[0] ?? null;
}

function extractFibaGameId(sourceUrl: string): string | null {
  return sourceUrl.match(/\/games\/([0-9]+)-/i)?.[1] ?? null;
}

function parseFibaGame(gameId: string, raw: string): ParsedFibaGame | null {
  const normalized = raw.replace(/\\"/g, '"');
  const start = normalized.indexOf(`"gameId":${gameId}`);
  const chunk = start >= 0 ? normalized.slice(start, start + 3000) : normalized;
  const match = chunk.match(
    /"teamA":\{.*?"code":"([^"]+)".*?"officialName":"([^"]+)".*?\},"teamB":\{.*?"code":"([^"]+)".*?"officialName":"([^"]+)".*?\},"teamAScore":([0-9]+),"teamBScore":([0-9]+),"isLive":(true|false).*?"liveGameStatus":([0-9]+|null).*?"currentPeriodStatus":("[^"]*"|null).*?"gameDateTimeUTC":"([^"]+)".*?"isPostponed":(true|false)/s
  );

  if (!match) {
    return null;
  }

  return {
    gameId,
    teamA: {
      code: readString(match, 1),
      label: readString(match, 2),
      score: readNumber(readString(match, 5))
    },
    teamB: {
      code: readString(match, 3),
      label: readString(match, 4),
      score: readNumber(readString(match, 6))
    },
    isLive: readString(match, 7) === "true",
    liveGameStatus: readString(match, 8) === "null" ? null : readNumber(readString(match, 8)),
    currentPeriodStatus: readString(match, 9).replace(/^"|"$/g, ""),
    scheduledAt: readString(match, 10) || null,
    postponed: readString(match, 11) === "true"
  };
}

function parseFibaUtc(value: string | null): number {
  if (!value) {
    return NaN;
  }

  return Date.parse(/[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`);
}

function normalizeFibaUtc(value: string | null): string | null {
  return value && !/[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? `${value}Z` : value;
}

function inspectFibaGame(
  context: OracleLifecycleSourceContext,
  sourceUrl: string,
  raw: string,
  fetchedAt: string
): OracleSourceInspection {
  const gameId = extractFibaGameId(sourceUrl);

  if (!gameId) {
    return {
      objectType: "oracle_source_inspection",
      sourceFamily: "fiba_basketball_game",
      sourceUrl,
      status: "unknown",
      closeConditionSatisfied: false,
      resolutionAvailable: false,
      fetchedAt,
      rawHash: hashRawSnapshot(sourceUrl),
      normalizedSnapshot: {},
      claimSummary: "FIBA source URL did not include a parseable game id.",
      confidence: "low",
      blockers: ["missing_fiba_game_id"]
    };
  }

  const game = parseFibaGame(gameId, raw);

  if (!game) {
    return {
      objectType: "oracle_source_inspection",
      sourceFamily: "fiba_basketball_game",
      sourceUrl,
      officialJsonUrl: sourceUrl,
      status: "unknown",
      closeConditionSatisfied: false,
      resolutionAvailable: false,
      fetchedAt,
      rawHash: hashRawSnapshot(raw),
      normalizedSnapshot: {},
      claimSummary: "FIBA page payload did not expose the expected game fields.",
      confidence: "low",
      blockers: ["fiba_payload_unparseable"]
    };
  }

  const fetchedTime = Date.parse(fetchedAt);
  const scheduledTime = parseFibaUtc(game.scheduledAt);
  const final = game.liveGameStatus === 999 || game.currentPeriodStatus === "E";
  const status = game.postponed
    ? "postponed"
    : final
      ? "final"
      : game.isLive || (Number.isFinite(fetchedTime) && Number.isFinite(scheduledTime) && fetchedTime >= scheduledTime)
        ? "live"
        : "not_started";
  const winnerKind =
    !final || game.teamA.score === game.teamB.score
      ? game.teamA.score === game.teamB.score && final
        ? "draw"
        : "unknown"
      : game.teamA.score > game.teamB.score
        ? "home"
        : "away";
  const winnerLabel =
    winnerKind === "home"
      ? game.teamA.label
      : winnerKind === "away"
        ? game.teamB.label
        : winnerKind === "draw"
          ? "draw"
          : undefined;

  return {
    objectType: "oracle_source_inspection",
    sourceFamily: "fiba_basketball_game",
    sourceUrl,
    officialJsonUrl: sourceUrl,
    status,
    closeConditionSatisfied: status === "live" || status === "final",
    resolutionAvailable: status === "final" && winnerKind !== "unknown",
    evidenceKey: winnerKind === "home" || winnerKind === "away" ? winnerKind : undefined,
    winnerKind,
    winnerLabel,
    score: {
      home: game.teamA.score,
      away: game.teamB.score
    },
    fetchedAt,
    rawHash: hashRawSnapshot(raw),
    normalizedSnapshot: {
      sourceFamily: "fiba_basketball_game",
      gameId: game.gameId,
      teamA: game.teamA,
      teamB: game.teamB,
      scheduledAt: normalizeFibaUtc(game.scheduledAt),
      officialStatus: status,
      winnerKind,
      winnerLabel
    },
    claimSummary:
      status === "final" && winnerLabel
        ? `FIBA official final result: ${game.teamA.label} ${game.teamA.score}, ${game.teamB.label} ${game.teamB.score}. Winner kind: ${winnerKind}.`
        : `FIBA official game ${gameId} status is ${status}.`,
    confidence: "high",
    blockers: []
  };
}

async function inspectFiba(
  context: OracleLifecycleSourceContext,
  fetchers: OracleSourceAdapterFetchers
): Promise<OracleSourceInspection> {
  const sourceUrl = extractFibaGameUrl(context);
  const fetchedAt = defaultFetchedAt(fetchers);

  if (!sourceUrl) {
    return {
      objectType: "oracle_source_inspection",
      sourceFamily: "fiba_basketball_game",
      sourceUrl: "",
      status: "unknown",
      closeConditionSatisfied: false,
      resolutionAvailable: false,
      fetchedAt,
      rawHash: hashRawSnapshot(""),
      normalizedSnapshot: {},
      claimSummary: "No FIBA official game URL found.",
      confidence: "low",
      blockers: ["missing_fiba_game_url"]
    };
  }

  const raw = fetchers.fetchText
    ? await fetchers.fetchText(sourceUrl)
    : await fetchOracleAdapterText(sourceUrl, { headers: FIBA_FETCH_HEADERS });

  return inspectFibaGame(context, sourceUrl, raw, fetchedAt);
}

export const FIBA_BASKETBALL_SOURCE_ADAPTER: OracleLifecycleSourceAdapter = {
  sourceFamily: "fiba_basketball_game",
  sourceLabel: "FIBA official game page",
  sourceIds: [FIBA_SOURCE_ID],
  measurementKinds: ["final_winner"],
  resultShapes: ["home_away_winner"],
  routes: [{ measurementKind: "final_winner", resultShape: "home_away_winner" }],
  capabilities: {
    closeCondition: true,
    resolution: true
  },
  supportsSource: (context) =>
    readContractSourceIds(context).includes(FIBA_SOURCE_ID) ||
    /fiba\.basketball\/en\/events\/.+\/games\/[0-9]+-/i.test(readSourceHaystack(context)),
  inspectCloseCondition: inspectFiba,
  inspectResolution: inspectFiba
};
