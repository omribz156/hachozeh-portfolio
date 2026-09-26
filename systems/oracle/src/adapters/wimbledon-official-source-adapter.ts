import {
  defaultFetchedAt,
  fetchOracleAdapterJson,
  hashRawSnapshot,
  normalizeComparable,
  readContractSourceIds,
  type OracleLifecycleSourceAdapter,
  type OracleLifecycleSourceContext,
  type OracleSourceAdapterFetchers,
  type OracleSourceInspection,
  type OracleSourceWinnerKind
} from "../source-adapter-contracts";

const WIMBLEDON_SOURCE_FAMILY = "wimbledon_official";
const WIMBLEDON_GRAPHQL_URL = "https://www.wimbledon.com/graphql";
const WIMBLEDON_ALLOWED_HOSTS = ["www.wimbledon.com"];
// Public client identifier embedded in Wimbledon's own schedule HTML, verified
// 2026-09-26. Not a Hachozeh credential; see workspace/docs/publication-readiness.md.
const WIMBLEDON_GRAPHQL_AUTH = "77d2d900-b41b-4a6a-8700-b98f80bef920";
const WIMBLEDON_YEAR = 2026;

const WIMBLEDON_FETCH_HEADERS = {
  accept: "application/json",
  "content-type": "application/json",
  "user-agent": "Hachozeh Oracle Wimbledon official adapter",
  "x-api-key": WIMBLEDON_GRAPHQL_AUTH
};

const SCHEDULE_DAYS_QUERY = `
  query ScheduleDays($year: Int!) {
    scheduleDays(year: $year) {
      year
      tournDay
      released
      currentDay
      message
      messageShort
    }
  }
`;

const SCHEDULE_QUERY = `
  query Schedule($year: Int!, $day: Int!) {
    schedule(year: $year, tournDay: $day) {
      year
      tournDay
      courts {
        courtName
        courtId
        matches {
          matchId
          eventName
          eventCode
          roundName
          roundNameShort
          status
          statusCode
          winner
          shortScore
          notBefore
          epoch
          order
          team1 {
            displayNameA
            firstNameA
            lastNameA
            idA
            won
            nationA
            seed
          }
          team2 {
            displayNameA
            firstNameA
            lastNameA
            idA
            won
            nationA
            seed
          }
          score {
            tennisSets {
              set
              team1 {
                scoreDisplay
                tiebreakDisplay
              }
              team2 {
                scoreDisplay
                tiebreakDisplay
              }
            }
          }
        }
      }
    }
  }
`;

type WimbledonScheduleDay = {
  year?: unknown;
  tournDay?: unknown;
  released?: unknown;
  currentDay?: unknown;
  message?: unknown;
  messageShort?: unknown;
};

type WimbledonTeamMember = {
  displayNameA?: unknown;
  firstNameA?: unknown;
  lastNameA?: unknown;
  idA?: unknown;
  won?: unknown;
  nationA?: unknown;
  seed?: unknown;
};

type WimbledonMatch = {
  matchId?: unknown;
  eventName?: unknown;
  eventCode?: unknown;
  roundName?: unknown;
  roundNameShort?: unknown;
  status?: unknown;
  statusCode?: unknown;
  shortScore?: unknown;
  notBefore?: unknown;
  epoch?: unknown;
  order?: unknown;
  team1?: WimbledonTeamMember[];
  team2?: WimbledonTeamMember[];
  courtName?: string;
  tournDay?: number;
  score?: unknown;
};

type WimbledonSchedulePayload = {
  data?: {
    scheduleDays?: WimbledonScheduleDay[];
    schedule?: {
      year?: unknown;
      tournDay?: unknown;
      courts?: Array<{
        courtName?: unknown;
        courtId?: unknown;
        matches?: WimbledonMatch[];
      }>;
    };
  };
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

function readCustomString(context: OracleLifecycleSourceContext, path: string[]): string {
  let current: unknown = context.marketContract as unknown;

  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return "";
    }
    current = (current as Record<string, unknown>)[key];
  }

  return readString(current);
}

function readAliases(context: OracleLifecycleSourceContext): string[] {
  const taxonomy = (context.marketContract as unknown as { taxonomy?: { aliases?: unknown } } | null)
    ?.taxonomy;
  return Array.isArray(taxonomy?.aliases)
    ? taxonomy.aliases.map(readString).filter(Boolean)
    : [];
}

function readPlayerName(team: WimbledonTeamMember | null | undefined): string {
  if (!team) {
    return "";
  }

  return [readString(team.firstNameA), readString(team.lastNameA)].filter(Boolean).join(" ");
}

function readDisplayName(team: WimbledonTeamMember | null | undefined): string {
  return readPlayerName(team) || readString(team?.displayNameA);
}

function teamWon(team: WimbledonTeamMember | null | undefined): boolean {
  return team?.won === true;
}

function firstTeam(match: WimbledonMatch, key: "team1" | "team2"): WimbledonTeamMember | null {
  const team = match[key];
  return Array.isArray(team) ? team[0] ?? null : null;
}

function matchIncludesPlayer(match: WimbledonMatch, playerAliases: string[]): boolean {
  const normalizedAliases = playerAliases.map(normalizeComparable).filter(Boolean);
  const teamNames = [readDisplayName(firstTeam(match, "team1")), readDisplayName(firstTeam(match, "team2"))]
    .map(normalizeComparable)
    .filter(Boolean);

  return normalizedAliases.some((alias) => teamNames.some((teamName) => teamName.includes(alias) || alias.includes(teamName)));
}

function extractTargetPlayerAliases(context: OracleLifecycleSourceContext): string[] {
  const fromOperational = readCustomString(context, ["operational", "wimbledonPlayerName"]);
  const fromDisplay = readCustomString(context, ["displayHints", "targetEntity"]);
  const fromTimeline = readCustomString(context, ["timeline", "targetEntity"]);
  const fromRule =
    context.marketContract?.outcomeMap
      ?.map((outcome) => outcome.resolutionPath ?? "")
      .map((path) => path.match(/^(.+?)\s+(?:wins|is eliminated)/i)?.[1]?.trim() ?? "")
      .find(Boolean) ?? "";
  const aliases = readAliases(context).filter((alias) => !/^(wimbledon|tennis|gentlemen singles)$/i.test(alias));

  return [fromOperational, fromDisplay, fromTimeline, fromRule, ...aliases].filter(Boolean);
}

function extractTargetMatchId(context: OracleLifecycleSourceContext): string {
  return (
    readCustomString(context, ["operational", "wimbledonMatchId"]) ||
    readCustomString(context, ["timeline", "wimbledonMatchId"]) ||
    readCustomString(context, ["displayHints", "wimbledonMatchId"])
  );
}

function targetMatchAliases(context: OracleLifecycleSourceContext): string[] {
  const contractAliases = readAliases(context).filter((alias) => !/^(wimbledon|tennis)$/i.test(alias));
  const outcomeAliases =
    context.marketContract?.outcomeMap
      ?.flatMap((outcome) => [
        outcome.outcomeLabel ?? "",
        outcome.resolutionPath?.match(/^(.+?)\s+is the official Wimbledon match winner/i)?.[1] ?? ""
      ])
      .filter(Boolean) ?? [];

  return [...contractAliases, ...outcomeAliases].filter(Boolean);
}

function isCompleted(match: WimbledonMatch): boolean {
  return readString(match.statusCode).toUpperCase() === "D" || readString(match.status).toLowerCase() === "completed";
}

function isLive(match: WimbledonMatch): boolean {
  const status = readString(match.status).toLowerCase();
  const code = readString(match.statusCode).toUpperCase();
  return ["in progress", "live"].includes(status) || ["L", "C"].includes(code);
}

function isGentlemensSingles(match: WimbledonMatch): boolean {
  return readString(match.eventCode) === "MS" || /gentlemen/i.test(readString(match.eventName));
}

function isTournamentFinalRound(match: WimbledonMatch): boolean {
  const roundName = readString(match.roundName).toLowerCase();
  const roundNameShort = readString(match.roundNameShort).toUpperCase();

  return roundName === "final" || roundName === "the final" || roundNameShort === "F";
}

function winnerForMatch(match: WimbledonMatch): {
  winnerKind: OracleSourceWinnerKind;
  winnerLabel?: string;
  evidenceKey?: string;
} {
  const team1 = firstTeam(match, "team1");
  const team2 = firstTeam(match, "team2");

  if (teamWon(team1)) {
    return { winnerKind: "home", winnerLabel: readDisplayName(team1), evidenceKey: "home" };
  }

  if (teamWon(team2)) {
    return { winnerKind: "away", winnerLabel: readDisplayName(team2), evidenceKey: "away" };
  }

  return { winnerKind: "unknown" };
}

function normalizeMatch(match: WimbledonMatch): Record<string, unknown> {
  return {
    sourceFamily: WIMBLEDON_SOURCE_FAMILY,
    matchId: readString(match.matchId),
    tournDay: match.tournDay,
    courtName: match.courtName,
    eventName: readString(match.eventName),
    roundName: readString(match.roundName),
    status: readString(match.status),
    statusCode: readString(match.statusCode),
    shortScore: readString(match.shortScore),
    notBefore: readString(match.notBefore),
    epoch: readNumber(match.epoch),
    team1: {
      label: readDisplayName(firstTeam(match, "team1")),
      id: readString(firstTeam(match, "team1")?.idA),
      won: teamWon(firstTeam(match, "team1"))
    },
    team2: {
      label: readDisplayName(firstTeam(match, "team2")),
      id: readString(firstTeam(match, "team2")?.idA),
      won: teamWon(firstTeam(match, "team2"))
    }
  };
}

function describeMatch(match: WimbledonMatch | null | undefined): string {
  if (!match) {
    return "unknown match";
  }

  const matchId = readString(match.matchId) || "unknown";
  const roundName = readString(match.roundName) || "unknown round";
  return `match ${matchId}, round ${roundName}`;
}

async function fetchWimbledonGraphql(
  body: Record<string, unknown>,
  fetchers: OracleSourceAdapterFetchers
): Promise<unknown> {
  if (fetchers.fetchJson) {
    return fetchers.fetchJson(WIMBLEDON_GRAPHQL_URL);
  }

  return fetchOracleAdapterJson(WIMBLEDON_GRAPHQL_URL, {
    method: "POST",
    headers: WIMBLEDON_FETCH_HEADERS,
    body: JSON.stringify(body),
    allowedHosts: WIMBLEDON_ALLOWED_HOSTS
  });
}

async function fetchScheduleDays(fetchers: OracleSourceAdapterFetchers): Promise<WimbledonScheduleDay[]> {
  const payload = (await fetchWimbledonGraphql(
    {
      operationName: "ScheduleDays",
      query: SCHEDULE_DAYS_QUERY,
      variables: { year: WIMBLEDON_YEAR }
    },
    fetchers
  )) as WimbledonSchedulePayload;

  return Array.isArray(payload.data?.scheduleDays) ? payload.data.scheduleDays : [];
}

async function fetchSchedule(day: number, fetchers: OracleSourceAdapterFetchers): Promise<WimbledonMatch[]> {
  const payload = (await fetchWimbledonGraphql(
    {
      operationName: "Schedule",
      query: SCHEDULE_QUERY,
      variables: { year: WIMBLEDON_YEAR, day }
    },
    fetchers
  )) as WimbledonSchedulePayload;
  const schedule = payload.data?.schedule;
  const tournDay = readNumber(schedule?.tournDay) ?? day;

  return (
    schedule?.courts?.flatMap((court) =>
      (court.matches ?? []).map((match) => ({
        ...match,
        courtName: readString(court.courtName),
        tournDay
      }))
    ) ?? []
  );
}

async function fetchReleasedMatches(fetchers: OracleSourceAdapterFetchers): Promise<{
  daysPayload: WimbledonScheduleDay[];
  matches: WimbledonMatch[];
}> {
  const daysPayload = await fetchScheduleDays(fetchers);
  const releasedDays = daysPayload
    .filter((day) => day.released === true)
    .map((day) => readNumber(day.tournDay))
    .filter((day): day is number => day != null);
  const matches = (await Promise.all(releasedDays.map((day) => fetchSchedule(day, fetchers)))).flat();

  return { daysPayload, matches };
}

function findMatchForBinary(context: OracleLifecycleSourceContext, matches: WimbledonMatch[]): WimbledonMatch | null {
  const targetMatchId = extractTargetMatchId(context);
  if (targetMatchId) {
    const byId = matches.find((match) => readString(match.matchId) === targetMatchId);
    if (byId) {
      return byId;
    }
  }

  const aliases = targetMatchAliases(context);
  return (
    matches.find((match) => {
      if (!isGentlemensSingles(match)) {
        return false;
      }
      const team1 = readDisplayName(firstTeam(match, "team1"));
      const team2 = readDisplayName(firstTeam(match, "team2"));
      return aliases.some((alias) => normalizeComparable(team1).includes(normalizeComparable(alias))) &&
        aliases.some((alias) => normalizeComparable(team2).includes(normalizeComparable(alias)));
    }) ?? null
  );
}

function inspectBinaryMatch(
  context: OracleLifecycleSourceContext,
  rawSnapshot: unknown,
  fetchedAt: string,
  match: WimbledonMatch | null
): OracleSourceInspection {
  if (!match) {
    return {
      objectType: "oracle_source_inspection",
      sourceFamily: WIMBLEDON_SOURCE_FAMILY,
      sourceUrl: WIMBLEDON_GRAPHQL_URL,
      officialJsonUrl: WIMBLEDON_GRAPHQL_URL,
      status: "unknown",
      closeConditionSatisfied: false,
      resolutionAvailable: false,
      fetchedAt,
      rawHash: hashRawSnapshot(rawSnapshot),
      normalizedSnapshot: {},
      claimSummary: "Wimbledon official schedule did not include the target match yet.",
      confidence: "low",
      blockers: ["wimbledon_match_not_found"]
    };
  }

  const winner = winnerForMatch(match);
  const status = isCompleted(match) ? "final" : isLive(match) ? "live" : "not_started";
  const resolutionAvailable = status === "final" && winner.winnerKind !== "unknown";
  const normalizedSnapshot = normalizeMatch(match);

  return {
    objectType: "oracle_source_inspection",
    sourceFamily: WIMBLEDON_SOURCE_FAMILY,
    sourceUrl: WIMBLEDON_GRAPHQL_URL,
    officialJsonUrl: WIMBLEDON_GRAPHQL_URL,
    status,
    closeConditionSatisfied: status === "live" || status === "final",
    resolutionAvailable,
    evidenceKey: winner.evidenceKey,
    winnerKind: winner.winnerKind,
    winnerLabel: winner.winnerLabel,
    fetchedAt,
    rawHash: hashRawSnapshot(rawSnapshot),
    normalizedSnapshot,
    claimSummary: resolutionAvailable
      ? `Wimbledon official result: ${winner.winnerLabel} won match ${readString(match.matchId)}.`
      : `Wimbledon official match ${readString(match.matchId)} is not final yet.`,
    confidence: "high",
    blockers: []
  };
}

function inspectTournamentChild(
  context: OracleLifecycleSourceContext,
  rawSnapshot: unknown,
  fetchedAt: string,
  matches: WimbledonMatch[]
): OracleSourceInspection {
  const aliases = extractTargetPlayerAliases(context);
  const targetMatches = matches.filter((match) => isGentlemensSingles(match) && matchIncludesPlayer(match, aliases));
  const completedTargetMatches = targetMatches.filter(isCompleted);
  const targetLoss = completedTargetMatches.find((match) => {
    const team1 = firstTeam(match, "team1");
    const team2 = firstTeam(match, "team2");
    const targetIsTeam1 = matchIncludesPlayer({ ...match, team2: [] }, aliases);
    const targetIsTeam2 = matchIncludesPlayer({ ...match, team1: [] }, aliases);
    return (targetIsTeam1 && !teamWon(team1)) || (targetIsTeam2 && !teamWon(team2));
  });
  const finalMatch = matches.find(
    (match) => isGentlemensSingles(match) && isTournamentFinalRound(match) && isCompleted(match)
  );
  const targetWonFinal = finalMatch ? matchIncludesPlayer(finalMatch, aliases) && winnerForMatch(finalMatch).winnerLabel && matchIncludesPlayer({
    ...finalMatch,
    team1: teamWon(firstTeam(finalMatch, "team1")) ? finalMatch.team1 : [],
    team2: teamWon(firstTeam(finalMatch, "team2")) ? finalMatch.team2 : []
  }, aliases) : false;

  const evidenceKey = targetWonFinal ? "yes" : targetLoss || finalMatch ? "no" : undefined;
  const resolutionMatch = targetWonFinal ? finalMatch : targetLoss ?? finalMatch ?? targetMatches.at(-1) ?? null;
  const resolutionAvailable = Boolean(evidenceKey);
  const status = finalMatch ? "final" : targetLoss ? "final" : targetMatches.some(isLive) ? "live" : "not_started";

  return {
    objectType: "oracle_source_inspection",
    sourceFamily: WIMBLEDON_SOURCE_FAMILY,
    sourceUrl: WIMBLEDON_GRAPHQL_URL,
    officialJsonUrl: WIMBLEDON_GRAPHQL_URL,
    status,
    closeConditionSatisfied: resolutionAvailable || status === "live",
    resolutionAvailable,
    evidenceKey,
    winnerKind: evidenceKey ? "named" : "unknown",
    winnerLabel: evidenceKey === "yes" ? aliases[0] : evidenceKey === "no" ? "לא" : undefined,
    fetchedAt,
    rawHash: hashRawSnapshot(rawSnapshot),
    normalizedSnapshot: {
      sourceFamily: WIMBLEDON_SOURCE_FAMILY,
      targetAliases: aliases,
      targetMatches: targetMatches.map(normalizeMatch),
      finalMatch: finalMatch ? normalizeMatch(finalMatch) : null,
      resolutionMatch: resolutionMatch ? normalizeMatch(resolutionMatch) : null
    },
    claimSummary: evidenceKey === "yes"
      ? `Wimbledon official result shows ${aliases[0]} won the gentlemen's singles final (${describeMatch(finalMatch)}).`
      : evidenceKey === "no"
        ? targetLoss
          ? `Wimbledon official result shows ${aliases[0]} was eliminated (${describeMatch(targetLoss)}).`
          : `Wimbledon official result shows ${aliases[0]} did not win the gentlemen's singles title (${describeMatch(finalMatch)}).`
        : `Wimbledon official schedule has no completed elimination/final result for ${aliases[0] ?? "target player"} yet.`,
    confidence: aliases.length > 0 ? "high" : "low",
    blockers: aliases.length > 0 ? [] : ["wimbledon_target_player_missing"]
  };
}

async function inspectWimbledon(
  context: OracleLifecycleSourceContext,
  fetchers: OracleSourceAdapterFetchers
): Promise<OracleSourceInspection> {
  const fetchedAt = defaultFetchedAt(fetchers);
  const payload = await fetchReleasedMatches(fetchers);
  const rawSnapshot = {
    days: payload.daysPayload,
    matches: payload.matches
  };

  if (context.marketContract?.resultShape === "yes_no") {
    return inspectTournamentChild(context, rawSnapshot, fetchedAt, payload.matches);
  }

  return inspectBinaryMatch(context, rawSnapshot, fetchedAt, findMatchForBinary(context, payload.matches));
}

export const WIMBLEDON_OFFICIAL_SOURCE_ADAPTER: OracleLifecycleSourceAdapter = {
  sourceFamily: WIMBLEDON_SOURCE_FAMILY,
  sourceLabel: "Wimbledon official results",
  sourceIds: ["src_wimbledon_official"],
  measurementKinds: ["final_winner"],
  resultShapes: ["home_away_winner", "yes_no"],
  routes: [
    { measurementKind: "final_winner", resultShape: "home_away_winner" },
    { measurementKind: "final_winner", resultShape: "yes_no" }
  ],
  capabilities: {
    closeCondition: true,
    resolution: true
  },
  supportsSource: (context) =>
    readContractSourceIds(context).includes("src_wimbledon_official") ||
    /wimbledon/i.test(context.resolutionSource) ||
    /wimbledon/i.test(context.marketContract?.resolutionSource?.url ?? ""),
  inspectCloseCondition: inspectWimbledon,
  inspectResolution: inspectWimbledon
};
