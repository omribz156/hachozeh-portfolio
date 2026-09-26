import {
  defaultFetchedAt,
  fetchOracleAdapterJson,
  hashRawSnapshot,
  readContractSourceIds,
  readSourceHaystack,
  type OracleLifecycleSourceAdapter,
  type OracleLifecycleSourceContext,
  type OracleSourceAdapterFetchers,
  type OracleSourceInspection
} from "../source-adapter-contracts";

const IBBA_SOURCE_ID = "src_ibba_schedules";
const IBBA_EVENTS_URL = "https://ibasketball.co.il/wp-json/sportspress/v2/events";
const IBBA_FETCH_HEADERS = {
  "user-agent": "Navi Oracle IBBA adapter"
};
const IBBA_ALLOWED_HOSTS = ["ibasketball.co.il"];

type IbbaEvent = {
  id?: number | string;
  slug?: string;
  date?: string;
  link?: string;
  title?: {
    rendered?: string;
  };
  home?: {
    team?: string;
    points?: number | string | null;
  };
  away?: {
    team?: string;
    points?: number | string | null;
  };
  main_results?: Array<number | string | null> | null;
  state?: string;
  winner?: number | string | null;
};

function decodeHtml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#8211;/g, "–")
    .replace(/&#8212;/g, "—")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function extractIbbaMatchSlug(context: OracleLifecycleSourceContext): string | null {
  const haystack = readSourceHaystack(context);
  const patterns = [
    /ibasketball\.co\.il\/match\/([0-9]+)/i,
    /[?&]slug=([0-9]+)/i,
    /sportspress\/v2\/events\?slug=([0-9]+)/i
  ];

  for (const pattern of patterns) {
    const match = haystack.match(pattern);

    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function extractIbbaEventId(context: OracleLifecycleSourceContext): string | null {
  const haystack = readSourceHaystack(context);
  const match = haystack.match(/sportspress\/v2\/events\/([0-9]+)/i);
  return match?.[1] ?? null;
}

function extractIbbaSourceUrl(context: OracleLifecycleSourceContext): string | null {
  const haystack = readSourceHaystack(context);
  const match = haystack.match(/https:\/\/(?:www\.)?ibasketball\.co\.il\/\S+/i);
  return match?.[0]?.replace(/[),.;]+$/g, "") ?? null;
}

function parseIsraeliLocalDate(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);

  if (!match?.[1] || !match[2] || !match[3] || !match[4] || !match[5]) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const israelOffsetHours = month >= 3 && month <= 10 ? 3 : 2;
  return new Date(Date.UTC(year, month - 1, day, hour - israelOffsetHours, minute, 0));
}

function readIbbaScore(event: IbbaEvent): { home: number; away: number } | null {
  const home = readNumber(event.home?.points) ?? readNumber(event.main_results?.[0]);
  const away = readNumber(event.away?.points) ?? readNumber(event.main_results?.[1]);

  return home == null || away == null ? null : { home, away };
}

function parseIbbaEventsPayload(payload: unknown): IbbaEvent[] {
  return Array.isArray(payload) ? (payload as IbbaEvent[]) : [];
}

function readFetchUrl(context: OracleLifecycleSourceContext): string {
  const eventId = extractIbbaEventId(context);

  if (eventId) {
    return `${IBBA_EVENTS_URL}/${encodeURIComponent(eventId)}`;
  }

  const slug = extractIbbaMatchSlug(context);

  if (slug) {
    return `${IBBA_EVENTS_URL}?slug=${encodeURIComponent(slug)}`;
  }

  return `${IBBA_EVENTS_URL}?per_page=25&order=desc&orderby=date`;
}

function findIbbaEvent(payload: unknown, context: OracleLifecycleSourceContext): IbbaEvent | null {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as IbbaEvent;
  }

  const events = parseIbbaEventsPayload(payload);
  const slug = extractIbbaMatchSlug(context);

  if (slug) {
    const bySlug = events.find((event) => String(event.slug ?? "") === slug || event.link?.includes(`/match/${slug}/`));

    if (bySlug) {
      return bySlug;
    }
  }

  const outcomeLabels = context.outcomes.map((outcome) => outcome.label);
  return (
    events.find((event) => {
      const homeTeam = decodeHtml(event.home?.team ?? "");
      const awayTeam = decodeHtml(event.away?.team ?? "");
      return outcomeLabels.some((label) => label === homeTeam) && outcomeLabels.some((label) => label === awayTeam);
    }) ?? null
  );
}

function inspectIbbaEvent(
  context: OracleLifecycleSourceContext,
  sourceUrl: string,
  event: IbbaEvent | null,
  rawSnapshot: unknown,
  fetchedAt: string,
  officialJsonUrl: string
): OracleSourceInspection {
  if (!event) {
    return {
      objectType: "oracle_source_inspection",
      sourceFamily: "ibba_schedules",
      sourceUrl,
      officialJsonUrl,
      status: "unknown",
      closeConditionSatisfied: false,
      resolutionAvailable: false,
      fetchedAt,
      rawHash: hashRawSnapshot(rawSnapshot),
      normalizedSnapshot: {},
      claimSummary: "No matching IBBA event found in the official Sportspress feed.",
      confidence: "low",
      blockers: ["missing_ibba_event"]
    };
  }

  const homeTeam = decodeHtml(event.home?.team ?? "");
  const awayTeam = decodeHtml(event.away?.team ?? "");
  const score = readIbbaScore(event);
  const scheduledAt = parseIsraeliLocalDate(event.date);
  const fetchedTime = Date.parse(fetchedAt);
  const state = String(event.state ?? "").toLowerCase();
  const finalByState = state === "finished";
  const likelyLive =
    scheduledAt != null &&
    Number.isFinite(fetchedTime) &&
    fetchedTime >= scheduledAt.getTime();
  const status =
    score && finalByState
      ? "final"
      : likelyLive
        ? "live"
        : "not_started";
  const winnerKind =
    !score
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
          ? "תיקו"
          : undefined;

  return {
    objectType: "oracle_source_inspection",
    sourceFamily: "ibba_schedules",
    sourceUrl,
    officialJsonUrl,
    status,
    closeConditionSatisfied: status === "live" || status === "final",
    resolutionAvailable: status === "final",
    winnerKind,
    winnerLabel,
    score: score ?? undefined,
    fetchedAt,
    rawHash: hashRawSnapshot(rawSnapshot),
    normalizedSnapshot: {
      sourceFamily: "ibba_schedules",
      eventId: event.id ?? null,
      slug: event.slug ?? null,
      homeTeam,
      awayTeam,
      score,
      state,
      winnerKind,
      winnerLabel,
      scheduledAt: scheduledAt?.toISOString() ?? null
    },
    claimSummary:
      !score
        ? `IBBA official feed has no score yet for ${homeTeam || "home"} vs ${awayTeam || "away"}.`
        : status === "final"
          ? `IBBA official final result: ${homeTeam} ${score.home}, ${awayTeam} ${score.away}. Winner kind: ${winnerKind}.`
          : `IBBA official feed shows ${homeTeam} ${score.home}, ${awayTeam} ${score.away}; game appears live or not final.`,
    confidence: homeTeam && awayTeam ? "high" : "medium",
    blockers: []
  };
}

async function inspectIbba(
  context: OracleLifecycleSourceContext,
  fetchers: OracleSourceAdapterFetchers
): Promise<OracleSourceInspection> {
  const fetchedAt = defaultFetchedAt(fetchers);
  const sourceUrl = extractIbbaSourceUrl(context) ?? IBBA_EVENTS_URL;
  const officialJsonUrl = readFetchUrl(context);
  const payload = await (
    fetchers.fetchJson ??
    ((url) => fetchOracleAdapterJson(url, {
      headers: IBBA_FETCH_HEADERS,
      allowedHosts: IBBA_ALLOWED_HOSTS
    }))
  )(officialJsonUrl);
  const event = findIbbaEvent(payload, context);

  return inspectIbbaEvent(context, sourceUrl, event, payload, fetchedAt, officialJsonUrl);
}

export const IBBA_SOURCE_ADAPTER: OracleLifecycleSourceAdapter = {
  sourceFamily: "ibba_schedules",
  sourceLabel: "IBBA official Sportspress events",
  sourceIds: [IBBA_SOURCE_ID],
  measurementKinds: ["final_winner"],
  resultShapes: ["home_away_winner"],
  routes: [{ measurementKind: "final_winner", resultShape: "home_away_winner" }],
  capabilities: {
    closeCondition: true,
    resolution: true
  },
  supportsSource: (context) =>
    readContractSourceIds(context).includes(IBBA_SOURCE_ID) ||
    /ibasketball\.co\.il/i.test(readSourceHaystack(context)),
  inspectCloseCondition: inspectIbba,
  inspectResolution: inspectIbba
};
