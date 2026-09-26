import {
  defaultFetchedAt,
  fetchOracleAdapterJson,
  hashRawSnapshot,
  readContractSourceIds,
  readSourceHaystack,
  type OracleLifecycleSourceAdapter,
  type OracleLifecycleSourceContext,
  type OracleSourceAdapterFetchers,
  type OracleSourceInspection,
  type OracleSourceWinnerKind
} from "../source-adapter-contracts";

const FIFA_SOURCE_FAMILY = "fifa_match_centre";
const FIFA_MATCH_URL_PATTERN =
  /https:\/\/www\.fifa\.com\/(?:[a-z]{2}\/)?match-centre\/match\/(\d+)\/(\d+)\/(\d+)\/(\d+)/i;
const FIFA_FETCH_HEADERS = {
  accept: "application/json",
  "user-agent": "Navi Oracle lifecycle source adapter"
};
const FIFA_ALLOWED_HOSTS = ["api.fifa.com"];

type FifaLocalizedLabel = {
  Locale?: unknown;
  Description?: unknown;
};

type FifaTeamSnapshot = {
  IdTeam?: unknown;
  TeamName?: unknown;
  ShortClubName?: unknown;
  Abbreviation?: unknown;
  Score?: unknown;
};

type FifaMatchSnapshot = {
  IdMatch?: unknown;
  IdCompetition?: unknown;
  IdSeason?: unknown;
  IdStage?: unknown;
  Date?: unknown;
  Home?: FifaTeamSnapshot;
  Away?: FifaTeamSnapshot;
  HomeTeamScore?: unknown;
  AwayTeamScore?: unknown;
  Winner?: unknown;
  MatchStatus?: unknown;
  ResultType?: unknown;
  MatchTime?: unknown;
  CompetitionName?: unknown;
  SeasonName?: unknown;
  StageName?: unknown;
};

type FifaCalendarPayload = {
  Results?: FifaMatchSnapshot[];
};

type FifaMatchSpec = {
  sourceUrl: string;
  competitionId: string;
  seasonId: string;
  stageId: string;
  matchId: string;
};

type ParsedFifaTeam = {
  id: string;
  label: string;
  abbreviation: string;
  score: number | null;
};

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readLocalizedLabel(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }

  const labels = value as FifaLocalizedLabel[];
  const english =
    labels.find((entry) => readString(entry.Locale).toLowerCase().startsWith("en")) ??
    labels[0];

  return readString(english?.Description);
}

export function extractFifaMatchSpec(context: OracleLifecycleSourceContext): FifaMatchSpec | null {
  const match = readSourceHaystack(context).match(FIFA_MATCH_URL_PATTERN);

  if (!match?.[0] || !match[1] || !match[2] || !match[3] || !match[4]) {
    return null;
  }

  return {
    sourceUrl: match[0],
    competitionId: match[1],
    seasonId: match[2],
    stageId: match[3],
    matchId: match[4]
  };
}

function buildFifaCalendarUrl(spec: FifaMatchSpec): string {
  const params = new URLSearchParams({
    language: "en",
    idCompetition: spec.competitionId,
    idSeason: spec.seasonId,
    idStage: spec.stageId,
    idMatch: spec.matchId,
    count: "400"
  });

  return `https://api.fifa.com/api/v3/calendar/matches?${params.toString()}`;
}

function parseTeam(team: FifaTeamSnapshot | undefined, directScore: unknown): ParsedFifaTeam | null {
  if (!team) {
    return null;
  }

  const label =
    readString(team.ShortClubName) ||
    readLocalizedLabel(team.TeamName) ||
    readString(team.Abbreviation);

  if (!label) {
    return null;
  }

  return {
    id: readString(team.IdTeam),
    label,
    abbreviation: readString(team.Abbreviation),
    score: readNumber(directScore) ?? readNumber(team.Score)
  };
}

function readWinnerTeamId(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim();
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as { IdTeam?: unknown; idTeam?: unknown; Id?: unknown; id?: unknown };
    return readString(record.IdTeam) || readString(record.idTeam) || readString(record.Id) || readString(record.id);
  }

  return "";
}

function winnerForMatch(
  match: FifaMatchSnapshot,
  homeTeam: ParsedFifaTeam | null,
  awayTeam: ParsedFifaTeam | null
): { winnerKind: OracleSourceWinnerKind; winnerLabel?: string; evidenceKey?: string } {
  const winnerTeamId = readWinnerTeamId(match.Winner);

  if (winnerTeamId && homeTeam?.id === winnerTeamId) {
    return {
      winnerKind: "home",
      winnerLabel: homeTeam.label,
      evidenceKey: "home"
    };
  }

  if (winnerTeamId && awayTeam?.id === winnerTeamId) {
    return {
      winnerKind: "away",
      winnerLabel: awayTeam.label,
      evidenceKey: "away"
    };
  }

  if (homeTeam?.score == null || awayTeam?.score == null) {
    return {
      winnerKind: "unknown"
    };
  }

  if (homeTeam.score === awayTeam.score) {
    return {
      winnerKind: "draw",
      winnerLabel: "draw",
      evidenceKey: "draw"
    };
  }

  return homeTeam.score > awayTeam.score
    ? {
        winnerKind: "home",
        winnerLabel: homeTeam.label,
        evidenceKey: "home"
      }
    : {
        winnerKind: "away",
        winnerLabel: awayTeam.label,
        evidenceKey: "away"
      };
}

function readFifaStatus(match: FifaMatchSnapshot, hasScore: boolean): OracleSourceInspection["status"] {
  const statusCode = readNumber(match.MatchStatus);
  const resultType = readNumber(match.ResultType);

  if (!hasScore) {
    return statusCode === 1 ? "not_started" : "unknown";
  }

  if (statusCode === 0 && resultType != null) {
    return "final";
  }

  return "live";
}

function findFifaMatch(payload: unknown, matchId: string): FifaMatchSnapshot | null {
  const record =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as FifaCalendarPayload)
      : {};
  return record.Results?.find((match) => readString(match.IdMatch) === matchId) ?? null;
}

function inspectFifaPayload(
  context: OracleLifecycleSourceContext,
  spec: FifaMatchSpec,
  officialJsonUrl: string,
  payload: unknown,
  fetchedAt: string
): OracleSourceInspection {
  const match = findFifaMatch(payload, spec.matchId);

  if (!match) {
    return {
      objectType: "oracle_source_inspection",
      sourceFamily: FIFA_SOURCE_FAMILY,
      sourceUrl: spec.sourceUrl,
      officialJsonUrl,
      status: "unknown",
      closeConditionSatisfied: false,
      resolutionAvailable: false,
      fetchedAt,
      rawHash: hashRawSnapshot(payload),
      normalizedSnapshot: {},
      claimSummary: `FIFA calendar payload did not include match ${spec.matchId}.`,
      confidence: "low",
      blockers: ["fifa_match_not_found"]
    };
  }

  const homeTeam = parseTeam(match.Home, match.HomeTeamScore);
  const awayTeam = parseTeam(match.Away, match.AwayTeamScore);
  const hasScore = homeTeam?.score != null && awayTeam?.score != null;
  const status = readFifaStatus(match, hasScore);
  const winner = winnerForMatch(match, homeTeam, awayTeam);
  const isHomeAwayMarket = context.marketContract?.resultShape === "home_away_winner";
  const drawnHomeAwayMarket = isHomeAwayMarket && winner.winnerKind === "draw";
  const resolutionAvailable = status === "final" && !drawnHomeAwayMarket && winner.winnerKind !== "unknown";
  const normalizedSnapshot = {
    sourceFamily: FIFA_SOURCE_FAMILY,
    matchId: spec.matchId,
    competitionId: readString(match.IdCompetition) || spec.competitionId,
    seasonId: readString(match.IdSeason) || spec.seasonId,
    stageId: readString(match.IdStage) || spec.stageId,
    competitionName: readLocalizedLabel(match.CompetitionName),
    seasonName: readLocalizedLabel(match.SeasonName),
    stageName: readLocalizedLabel(match.StageName),
    kickoffAt: readString(match.Date),
    matchStatus: match.MatchStatus,
    resultType: match.ResultType,
    matchTime: readString(match.MatchTime),
    homeTeam,
    awayTeam,
    winnerKind: winner.winnerKind,
    winnerLabel: winner.winnerLabel,
    evidenceKey: winner.evidenceKey,
    closeAt: context.closeAt
  };

  return {
    objectType: "oracle_source_inspection",
    sourceFamily: FIFA_SOURCE_FAMILY,
    sourceUrl: spec.sourceUrl,
    officialJsonUrl,
    status,
    closeConditionSatisfied: status === "live" || status === "final",
    resolutionAvailable,
    evidenceKey: winner.evidenceKey,
    winnerKind: winner.winnerKind,
    winnerLabel: winner.winnerLabel,
    score:
      homeTeam?.score != null && awayTeam?.score != null
        ? {
            home: homeTeam.score,
            away: awayTeam.score
          }
        : undefined,
    fetchedAt,
    rawHash: hashRawSnapshot(payload),
    normalizedSnapshot,
    claimSummary:
      homeTeam?.score == null || awayTeam?.score == null
        ? `FIFA official match ${spec.matchId} has no score yet.`
        : status === "final"
          ? `FIFA official final result: ${homeTeam.label} ${homeTeam.score}, ${awayTeam.label} ${awayTeam.score}. Winner kind: ${winner.winnerKind}.`
          : `FIFA official match ${spec.matchId} shows ${homeTeam.label} ${homeTeam.score}, ${awayTeam.label} ${awayTeam.score}; match appears live.`,
    confidence: homeTeam && awayTeam ? "high" : "medium",
    blockers: drawnHomeAwayMarket ? ["fifa_home_away_market_finished_drawn"] : []
  };
}

async function inspectFifa(
  context: OracleLifecycleSourceContext,
  fetchers: OracleSourceAdapterFetchers
): Promise<OracleSourceInspection> {
  const spec = extractFifaMatchSpec(context);
  const fetchedAt = defaultFetchedAt(fetchers);

  if (!spec) {
    return {
      objectType: "oracle_source_inspection",
      sourceFamily: FIFA_SOURCE_FAMILY,
      sourceUrl: "",
      status: "unknown",
      closeConditionSatisfied: false,
      resolutionAvailable: false,
      fetchedAt,
      rawHash: hashRawSnapshot(""),
      normalizedSnapshot: {},
      claimSummary: "No FIFA official match centre URL found.",
      confidence: "low",
      blockers: ["missing_fifa_match_centre_url"]
    };
  }

  const officialJsonUrl = buildFifaCalendarUrl(spec);
  const payload = await (
    fetchers.fetchJson ??
    ((url) => fetchOracleAdapterJson(url, {
      headers: FIFA_FETCH_HEADERS,
      allowedHosts: FIFA_ALLOWED_HOSTS
    }))
  )(officialJsonUrl);
  return inspectFifaPayload(context, spec, officialJsonUrl, payload, fetchedAt);
}

export const FIFA_MATCH_CENTRE_SOURCE_ADAPTER: OracleLifecycleSourceAdapter = {
  sourceFamily: FIFA_SOURCE_FAMILY,
  sourceLabel: "FIFA official Match Centre",
  sourceIds: ["src_fifa_match_centre"],
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
    readContractSourceIds(context).includes("src_fifa_match_centre") ||
    Boolean(extractFifaMatchSpec(context)),
  inspectCloseCondition: inspectFifa,
  inspectResolution: inspectFifa
};
