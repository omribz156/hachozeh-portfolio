import {
  defaultFetchedAt,
  fetchOracleAdapterText,
  hashRawSnapshot,
  readContractSourceIds,
  readSourceHaystack,
  type OracleLifecycleSourceAdapter,
  type OracleLifecycleSourceContext,
  type OracleSourceAdapterFetchers,
  type OracleSourceInspection,
  type OracleSourceWinnerKind
} from "../source-adapter-contracts";

const IFA_SOURCE_FAMILY = "ifa_fixtures_results";
const IFA_NATIONAL_CUP_URL_PATTERN = /https:\/\/www\.football\.org\.il\/national-cup\/\?[^\s"'<>]+/i;
const IFA_GAME_URL_PATTERN = /https:\/\/www\.football\.org\.il\/(?:leagues\/games\/game|games)\/\?[^\s"'<>]+/i;
const IFA_FETCH_HEADERS = {
  accept: "text/html,application/xhtml+xml",
  "accept-language": "he-IL,he;q=0.9,en;q=0.8",
  "user-agent": "Navi Oracle lifecycle source adapter"
};
const IFA_ALLOWED_HOSTS = ["www.football.org.il"];

type IfaTeams = {
  home: string;
  away: string;
};

type IfaScore = {
  home: number;
  away: number;
};

function extractIfaUrl(context: OracleLifecycleSourceContext): string | null {
  const haystack = readSourceHaystack(context);
  const directMatch = haystack.match(IFA_GAME_URL_PATTERN);
  const nationalCupMatch = haystack.match(IFA_NATIONAL_CUP_URL_PATTERN);

  return directMatch?.[0] ?? nationalCupMatch?.[0] ?? null;
}

function stripTags(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeIfaTeamLabel(value: string): string {
  return value
    .replace(/ב"ש/g, "באר שבע")
    .replace(/ת"א/g, "תל אביב")
    .replace(/מכבי תל אביב/g, "מכבי תל אביב")
    .replace(/הפועל באר שבע/g, "הפועל באר שבע")
    .replace(/\s+/g, " ")
    .trim();
}

function statusForScore(score: IfaScore | null, isFinal: boolean): OracleSourceInspection["status"] {
  if (isFinal) {
    return "final";
  }

  return score ? "live" : "not_started";
}

function winnerLabelForScore(
  winner: { winnerKind: OracleSourceWinnerKind },
  teams: IfaTeams
): string | undefined {
  switch (winner.winnerKind) {
    case "home":
      return teams.home;
    case "away":
      return teams.away;
    case "draw":
      return "תיקו";
    default:
      return undefined;
  }
}

function readTeams(text: string): IfaTeams {
  const gameMatch = text.match(/משחק\s+(.{2,80}?)\s*[-–]\s*(.{2,80}?)(?:\s+מגרש|\s+שעה|\s+תוצאה|$)/);
  if (gameMatch) {
    return {
      home: normalizeIfaTeamLabel(gameMatch[1] ?? "בית"),
      away: normalizeIfaTeamLabel(gameMatch[2] ?? "חוץ")
    };
  }

  const pairedMatch = text.match(/(הפועל\s+ב(?:אר\s+שבע|"?ש)|מכבי\s+ת(?:ל\s+אביב|"?א))\s*[-–]\s*(הפועל\s+ב(?:אר\s+שבע|"?ש)|מכבי\s+ת(?:ל\s+אביב|"?א))/);
  if (pairedMatch) {
    return {
      home: normalizeIfaTeamLabel(pairedMatch[1] ?? "בית"),
      away: normalizeIfaTeamLabel(pairedMatch[2] ?? "חוץ")
    };
  }

  return {
    home: "בית",
    away: "חוץ"
  };
}

function readScore(text: string): IfaScore | null {
  const scorePatterns = [
    /תוצאה\s+(\d{1,2})\s*[:\-]\s*(\d{1,2})/,
    /(\d{1,2})\s*[:\-]\s*(\d{1,2})\s+(?:הסתיים|סיום|גמר|תוצאת)/
  ];

  for (const pattern of scorePatterns) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }

    const home = Number(match[1]);
    const away = Number(match[2]);
    if (Number.isFinite(home) && Number.isFinite(away)) {
      return {
        home,
        away
      };
    }
  }

  return null;
}

function readIsFinal(text: string): boolean {
  return [
    "הסתיים",
    "סיום",
    "תוצאת סיום",
    "תוצאה סופית",
    "דו\"ח משחק",
    "דוח משחק",
    "full time",
    "final"
  ].some((needle) => text.toLowerCase().includes(needle.toLowerCase()));
}

function winnerForScore(score: IfaScore | null): {
  winnerKind: OracleSourceWinnerKind;
  evidenceKey?: string;
} {
  if (!score) {
    return {
      winnerKind: "unknown"
    };
  }

  if (score.home === score.away) {
    return {
      winnerKind: "draw",
      evidenceKey: "draw"
    };
  }

  if (score.home > score.away) {
    return {
      winnerKind: "home",
      evidenceKey: "home"
    };
  }

  return {
    winnerKind: "away",
    evidenceKey: "away"
  };
}

function goalRangeForScore(score: IfaScore): { evidenceKey: string; winnerLabel: string } {
  const totalGoals = score.home + score.away;
  if (totalGoals <= 1) {
    return {
      evidenceKey: "goals_0_1",
      winnerLabel: "0-1 שערים"
    };
  }

  if (totalGoals <= 3) {
    return {
      evidenceKey: "goals_2_3",
      winnerLabel: "2-3 שערים"
    };
  }

  return {
    evidenceKey: "goals_4_plus",
    winnerLabel: "4+ שערים"
  };
}

function inspectIfaHtml(
  context: OracleLifecycleSourceContext,
  sourceUrl: string,
  html: string,
  fetchedAt: string
): OracleSourceInspection {
  const text = stripTags(html);
  const teams = readTeams(text);
  const score = readScore(text);
  const isFinal = score != null && readIsFinal(text);
  const status = statusForScore(score, isFinal);
  const isGoalRange = context.marketContract?.resultShape === "multi_outcome";
  const winner = winnerForScore(score);
  const range = isGoalRange && score ? goalRangeForScore(score) : null;
  const winnerLabel = range?.winnerLabel ?? winnerLabelForScore(winner, teams);
  const evidenceKey = range?.evidenceKey ?? winner.evidenceKey;
  const totalGoals = score ? score.home + score.away : null;
  const normalizedSnapshot = {
    sourceFamily: IFA_SOURCE_FAMILY,
    homeTeam: teams.home,
    awayTeam: teams.away,
    score,
    totalGoals,
    status,
    winnerKind: range ? "named" : winner.winnerKind,
    winnerLabel,
    evidenceKey,
    closeAt: context.closeAt
  };

  return {
    objectType: "oracle_source_inspection",
    sourceFamily: IFA_SOURCE_FAMILY,
    sourceUrl,
    status,
    closeConditionSatisfied: false,
    resolutionAvailable: status === "final",
    evidenceKey,
    winnerKind: range ? "named" : winner.winnerKind,
    winnerLabel,
    score: score ?? undefined,
    fetchedAt,
    rawHash: hashRawSnapshot(html),
    normalizedSnapshot,
    claimSummary:
      score == null
        ? `IFA official page for ${teams.home} vs ${teams.away} has not started or has no score yet.`
        : isFinal
          ? range
            ? `IFA official final score: ${teams.home} ${score.home}, ${teams.away} ${score.away}. Total goals: ${totalGoals}; bucket: ${range.winnerLabel}.`
            : `IFA official final score: ${teams.home} ${score.home}, ${teams.away} ${score.away}. Winner kind: ${winner.winnerKind}.`
          : `IFA official page shows ${teams.home} ${score.home}, ${teams.away} ${score.away}; match appears live.`,
    confidence: teams.home !== "בית" && teams.away !== "חוץ" ? "high" : "medium",
    blockers: []
  };
}

async function inspectIfa(
  context: OracleLifecycleSourceContext,
  fetchers: OracleSourceAdapterFetchers
): Promise<OracleSourceInspection> {
  const sourceUrl = extractIfaUrl(context);
  const fetchedAt = defaultFetchedAt(fetchers);

  if (!sourceUrl) {
    return {
      objectType: "oracle_source_inspection",
      sourceFamily: IFA_SOURCE_FAMILY,
      sourceUrl: "",
      status: "unknown",
      closeConditionSatisfied: false,
      resolutionAvailable: false,
      fetchedAt,
      rawHash: hashRawSnapshot(""),
      normalizedSnapshot: {},
      claimSummary: "No IFA official fixture/results URL found.",
      confidence: "low",
      blockers: ["missing_ifa_fixture_results_url"]
    };
  }

  const html = await (
    fetchers.fetchText ??
    ((url) => fetchOracleAdapterText(url, {
      headers: IFA_FETCH_HEADERS,
      allowedHosts: IFA_ALLOWED_HOSTS
    }))
  )(sourceUrl);
  return inspectIfaHtml(context, sourceUrl, html, fetchedAt);
}

export const IFA_SOURCE_ADAPTER: OracleLifecycleSourceAdapter = {
  sourceFamily: IFA_SOURCE_FAMILY,
  sourceLabel: "Israel Football Association fixtures and results",
  sourceIds: ["src_ifa_fixtures_results"],
  measurementKinds: ["final_winner", "official_value"],
  resultShapes: ["three_way_result", "multi_outcome"],
  routes: [
    { measurementKind: "final_winner", resultShape: "three_way_result" },
    { measurementKind: "official_value", resultShape: "multi_outcome" }
  ],
  capabilities: {
    closeCondition: false,
    resolution: true
  },
  supportsSource: (context) =>
    readContractSourceIds(context).includes("src_ifa_fixtures_results") ||
    Boolean(extractIfaUrl(context)),
  inspectCloseCondition: inspectIfa,
  inspectResolution: inspectIfa
};
