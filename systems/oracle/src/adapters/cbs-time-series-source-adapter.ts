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

const CBS_TIME_SERIES_FETCH_HEADERS = {
  "user-agent": "Navi Oracle CBS time-series adapter"
};
const CBS_TIME_SERIES_ALLOWED_HOSTS = ["api.cbs.gov.il"];
const CBS_TIME_SERIES_SOURCE_ID = "src_cbs_time_series";
const CBS_CPI_TIME_SERIES_CODE = "120010";

type CbsTimeSeriesSpec = {
  machineResolutionEndpoint: string;
  targetPeriod?: string | null;
  seriesCode: string;
};

type CbsReadingCandidate = {
  value: number;
  period: string | null;
  sourcePath: string;
};

const VALUE_KEY_PATTERNS = [
  "value",
  "cpi",
  "seriesvalue",
  "observation",
  "obsvalue",
  "monthly_change",
  "monthlychange",
  "monthly-change",
  "change",
  "changeValue",
  "change_value",
  "pointvalue",
  "point_value",
  "result"
];

const PERIOD_KEY_PATTERNS = [
  "period",
  "timeperiod",
  "time_period",
  "time-period",
  "date",
  "obs_time",
  "observedat",
  "observed_at",
  "periodcode",
  "period_code",
  "period-code",
  "month",
  "refperiod",
  "ref_period",
  "ref-period",
  "referenceperiod",
  "reference_period"
];

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value.replace(/%/g, "").replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  return null;
}

function normalizePath(path: string): string {
  return path || "root";
}

function normalizeMonthPeriod(value: string): string | null {
  const trimmed = value.trim();
  const patterns = [
    /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/u,
    /(\d{4})(\d{2})/u,
    /(\d{4})\/(\d{1,2})(?:\/\d{1,2})?/u
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (!match) {
      continue;
    }

    const year = Number.parseInt(match[1], 10);
    const month = Number.parseInt(match[2], 10);

    if (year >= 1950 && year <= 2200 && month >= 1 && month <= 12) {
      return `${year}-${String(month).padStart(2, "0")}-01`;
    }
  }

  const numericDate = Date.parse(trimmed);
  return Number.isFinite(numericDate) ? new Date(numericDate).toISOString().slice(0, 10) : null;
}

function normalizeHebrewMonthName(value: string): string | null {
  const normalized = value.trim();
  const monthMap: Record<string, string> = {
    ינואר: "01",
    בינואר: "01",
    פברואר: "02",
    בפברואר: "02",
    מרץ: "03",
    במרץ: "03",
    אפריל: "04",
    באפריל: "04",
    מאי: "05",
    במאי: "05",
    יוני: "06",
    ביוני: "06",
    יולי: "07",
    ביולי: "07",
    אוגוסט: "08",
    באוגוסט: "08",
    ספטמבר: "09",
    בספטמבר: "09",
    אוקטובר: "10",
    באוקטובר: "10",
    נובמבר: "11",
    בנובמבר: "11",
    דצמבר: "12",
    בדצמבר: "12"
  };

  return monthMap[normalized] ?? monthMap[normalized.toLowerCase()] ?? null;
}

function parseHebrewMonthPeriod(yearText: string, monthText: string): string | null {
  const year = Number.parseInt(yearText, 10);
  const month = normalizeHebrewMonthName(monthText);

  if (!Number.isFinite(year) || !month) {
    return null;
  }

  return `${year}-${month}-01`;
}

function parsePeriodMs(period: string | null): number | null {
  if (!period) {
    return null;
  }

  const normalized = normalizeMonthPeriod(period);
  if (!normalized) {
    return null;
  }

  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function sameMonthLike(left: string | null, right: string | null): boolean {
  if (!left || !right) {
    return false;
  }

  return left.slice(0, 7) === right.slice(0, 7);
}

function isValueKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[\s_-]/g, "");
  return VALUE_KEY_PATTERNS.some((pattern) => {
    const normalizedPattern = pattern.toLowerCase().replace(/[\s_-]/g, "");
    return normalized === normalizedPattern || normalized.includes(normalizedPattern);
  });
}

function isPeriodKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[\s_-]/g, "");
  return PERIOD_KEY_PATTERNS.some((pattern) => {
    const normalizedPattern = pattern.toLowerCase().replace(/[\s_-]/g, "");
    return normalized.includes(normalizedPattern);
  });
}

function extractPeriodHint(record: Record<string, unknown>): string | null {
  for (const [key, value] of Object.entries(record)) {
    if (!isPeriodKey(key)) {
      continue;
    }

    const text = readString(value);
    if (text) {
      const normalized = normalizeMonthPeriod(text);
      if (normalized) {
        return normalized;
      }
    }
  }

  return null;
}

function collectCbsReadingCandidates(
  payload: unknown,
  path: string,
  candidates: CbsReadingCandidate[]
): void {
  if (!payload) {
    return;
  }

  if (Array.isArray(payload)) {
    payload.forEach((entry, index) => collectCbsReadingCandidates(entry, `${path}[${index}]`, candidates));
    return;
  }

  if (typeof payload !== "object") {
    return;
  }

  const record = payload as Record<string, unknown>;
  const candidatePeriod = extractPeriodHint(record);

  for (const [key, value] of Object.entries(record)) {
    if (!isValueKey(key)) {
      continue;
    }

    const numeric = readNumber(value);
    if (numeric != null && Number.isFinite(numeric)) {
      candidates.push({
        value: numeric,
        period: candidatePeriod,
        sourcePath: normalizePath(path)
      });
    }
  }

  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "object") {
      collectCbsReadingCandidates(value, `${path}.${key}`, candidates);
    }
  }
}

function collectCbsReadingCandidatesFromXml(
  payload: string,
  candidates: CbsReadingCandidate[],
  expectedSeriesCode: string
): void {
  const dateBlocks = [...payload.matchAll(/<date\b([^>]*)>([\s\S]*?)<\/date>/giu)];
  if (dateBlocks.length === 0) {
    return;
  }

  dateBlocks.forEach((dateBlock, dateIndex) => {
    const dateAttrs = dateBlock[1] ?? "";
    const dateBody = dateBlock[2] ?? "";
    const year = dateAttrs.match(/\byear\s*=\s*["'](\d{4})["']/iu)?.[1];
    const month = dateAttrs.match(/\bmonth\s*=\s*["']([^"']+)["']/iu)?.[1];
    const period = year && month ? parseHebrewMonthPeriod(year, month) : null;

    const codeBlocks = [...dateBody.matchAll(/<code\b([^>]*)>([\s\S]*?)<\/code>/giu)];

    codeBlocks.forEach((codeBlock, codeIndex) => {
      const codeAttrs = codeBlock[1] ?? "";
      const codeValue = codeAttrs.match(/\bcode\s*=\s*["']([^"']+)["']/i)?.[1] ?? null;

      if (codeValue == null || codeValue !== expectedSeriesCode) {
        return;
      }

      const percentValue =
        codeBlock[2].match(/<percent[^>]*>([^<]+)<\/percent>/iu)?.[1] ??
        codeBlock[2].match(/<percent[^>]*\s+value\s*=\s*["']([^"']+)["'][^>]*\/?>/iu)?.[1] ??
        null;
      const numeric = readNumber(percentValue);

      if (numeric == null || !Number.isFinite(numeric)) {
        return;
      }

      candidates.push({
        value: numeric,
        period,
        sourcePath: `root.date[${dateIndex}].code[${codeIndex}]`
      });
    });
  });
}

function collectCbsReadingCandidatesFromPayload(
  payload: unknown,
  expectedSeriesCode: string,
  candidates: CbsReadingCandidate[]
): void {
  if (typeof payload === "string") {
    collectCbsReadingCandidatesFromXml(payload, candidates, expectedSeriesCode);

    if (candidates.length > 0) {
      return;
    }

    try {
      const parsed = JSON.parse(payload);
      collectCbsReadingCandidates(parsed, "root", candidates);
      return;
    } catch {
      return;
    }
  }

  collectCbsReadingCandidates(payload, "root", candidates);
}

function resolvePayloadHash(payloadText: string): string {
  try {
    return hashRawSnapshot(JSON.parse(payloadText));
  } catch {
    return hashRawSnapshot(payloadText);
  }
}

function parseTargetPeriod(machineResolutionEndpoint: string): string | null {
  try {
    const parsed = new URL(machineResolutionEndpoint);
    const orderedKeys = [
      "period",
      "timeperiod",
      "time_period",
      "timePeriod",
      "refperiod",
      "refPeriod",
      "month",
      "date",
      "periodCode",
      "period_code"
    ];

    for (const key of orderedKeys) {
      const normalizedNeedle = key.toLowerCase();
      const raw = [...parsed.searchParams.entries()].find(([name]) => name.toLowerCase() === normalizedNeedle)?.[1];
      const normalized = raw ? normalizeMonthPeriod(raw) : null;
      if (normalized) {
        return normalized;
      }
    }

    const pathMonth = parsed.pathname.match(/(19|20)\d{2}[/-](\d{1,2})(?:[/-](\d{1,2})?)?/u)?.[0];
    return pathMonth ? normalizeMonthPeriod(pathMonth) : null;
  } catch {
    return null;
  }
}

function extractSeriesCode(machineResolutionEndpoint: string): string {
  try {
    const parsed = new URL(machineResolutionEndpoint);
    const explicitCode = [...parsed.searchParams.entries()].find(([name]) => name.toLowerCase() === "code")?.[1];
    return explicitCode ?? CBS_CPI_TIME_SERIES_CODE;
  } catch {
    return CBS_CPI_TIME_SERIES_CODE;
  }
}

export function extractCbsTimeSeriesSpec(context: OracleLifecycleSourceContext): CbsTimeSeriesSpec | null {
  const machineResolutionEndpoint = readString(context.marketContract?.machineResolutionEndpoint);
  if (!machineResolutionEndpoint) {
    return null;
  }

  return {
    machineResolutionEndpoint,
    targetPeriod: parseTargetPeriod(machineResolutionEndpoint),
    seriesCode: extractSeriesCode(machineResolutionEndpoint)
  };
}

function pickLatestObservation(
  candidates: CbsReadingCandidate[],
  closeAt: string,
  targetPeriod: string | null
): CbsReadingCandidate | null {
  if (candidates.length === 0) {
    return null;
  }

  const withParsed = candidates
    .map((candidate) => ({
      ...candidate,
      normalizedPeriod: normalizeMonthPeriod(candidate.period ?? ""),
      periodMs: parsePeriodMs(candidate.period ?? "")
    }))
    .filter((candidate) => Number.isFinite(candidate.value));

  if (withParsed.length === 0) {
    return null;
  }

  const exactTarget = targetPeriod
    ? withParsed.filter((candidate) => sameMonthLike(candidate.normalizedPeriod, targetPeriod))
    : [];

  if (exactTarget.length > 0) {
    return exactTarget.reduce((best, current) =>
      (current.periodMs ?? Number.NEGATIVE_INFINITY) > (best.periodMs ?? Number.NEGATIVE_INFINITY)
        ? current
        : best
    );
  }

  if (targetPeriod) {
    return null;
  }

  const closeMs = Date.parse(closeAt);
  if (Number.isFinite(closeMs)) {
    const closedOrEarlier = withParsed.filter((candidate) => (candidate.periodMs ?? Number.POSITIVE_INFINITY) <= closeMs);
    if (closedOrEarlier.length > 0) {
      return closedOrEarlier.reduce((best, current) =>
        (current.periodMs ?? Number.NEGATIVE_INFINITY) > (best.periodMs ?? Number.NEGATIVE_INFINITY)
          ? current
          : best
      );
    }
  }

  const dated = withParsed.filter((candidate) => candidate.periodMs != null);
  if (dated.length > 0) {
    return dated.reduce((best, current) =>
      (current.periodMs ?? Number.NEGATIVE_INFINITY) > (best.periodMs ?? Number.NEGATIVE_INFINITY)
        ? current
        : best
    );
  }

  return withParsed[withParsed.length - 1] ?? null;
}

export function pickCbsMonthlyValue(
  payload: unknown,
  context: OracleLifecycleSourceContext
): number | null {
  const spec = extractCbsTimeSeriesSpec(context);
  if (!spec) {
    return null;
  }

  const candidates: CbsReadingCandidate[] = [];
  collectCbsReadingCandidatesFromPayload(payload, spec.seriesCode, candidates);
  const chosen = pickLatestObservation(candidates, context.closeAt, spec.targetPeriod ?? null);
  return chosen?.value ?? null;
}

type CbsRangeBucket = {
  label: string;
  evidenceKey?: string;
  kind: "below" | "between" | "above";
  lower?: number;
  upper?: number;
  inclusive?: boolean;
};

function evidenceKeyForLabel(
  context: OracleLifecycleSourceContext,
  label: string,
  fallback: string | undefined
): string | undefined {
  const normalized = normalizeComparable(label);
  const mapped = context.marketContract?.outcomeMap?.find(
    (outcome) => outcome.outcomeLabel && normalizeComparable(outcome.outcomeLabel) === normalized
  );

  return mapped?.evidenceKey ?? fallback;
}

function rangeFallbackKey(bucket: Omit<CbsRangeBucket, "label">): string | undefined {
  if (bucket.kind === "below" && bucket.upper != null) {
    return `below-${bucket.upper}`;
  }

  if (bucket.kind === "above" && bucket.lower != null) {
    return `above-${bucket.lower}`;
  }

  if (bucket.kind === "between" && bucket.lower != null && bucket.upper != null) {
    return `range-${bucket.lower}-${bucket.upper}`;
  }

  return undefined;
}

function extractNumbers(value: string): number[] {
  const normalized = value.replace(/%/g, " ");
  const dashedRange = normalized.match(/(-?\d[\d,]*(?:\.\d+)?)\s*[-–—]\s*(-?\d[\d,]*(?:\.\d+)?)/u);
  if (dashedRange?.[1] && dashedRange?.[2]) {
    return [readNumber(dashedRange[1]), readNumber(dashedRange[2])].filter((number): number is number => number != null);
  }

  const separatedRange = normalized.match(/(-?\d[\d,]*(?:\.\d+)?)\s*(?:to|עד)\s*(-?\d[\d,]*(?:\.\d+)?)/ui);
  if (separatedRange?.[1] && separatedRange?.[2]) {
    return [readNumber(separatedRange[1]), readNumber(separatedRange[2])].filter((number): number is number => number != null);
  }

  return [...normalized.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)]
    .map((match) => readNumber(match[0]))
    .filter((number): number is number => number != null);
}

function readRangeBuckets(context: OracleLifecycleSourceContext): CbsRangeBucket[] {
  const contractOutcomes =
    context.marketContract?.outcomeMap
      ?.map((outcome) => ({
        label: outcome.outcomeLabel,
        evidenceKey: outcome.evidenceKey,
        parseText: [outcome.outcomeLabel, outcome.evidenceKey, outcome.resolutionPath]
          .filter(Boolean)
          .join(" ")
      }))
      .filter((outcome) => outcome.label) ?? [];
  const buckets = contractOutcomes.length > 0
    ? contractOutcomes
    : context.outcomes.map((outcome) => ({
        label: outcome.label,
        evidenceKey: undefined,
        parseText: outcome.label
      }));

  return buckets.flatMap((outcome): CbsRangeBucket[] => {
    const label = outcome.label ?? "";
    const text = outcome.parseText ?? label;
    const numbers = extractNumbers(text);
    const lowerText = text.toLowerCase();

    if (
      (/מתחת|מתחת\s*מ-|below|under|less than|<=/i.test(lowerText) || text.includes("פחות") || text.includes("עד"))
      && numbers[0] != null
    ) {
      const bucket = {
        label,
        kind: "below" as const,
        upper: numbers[0],
        inclusive: /<=|עד|לכל\s+היותר|ומטה|חוסר\s+שינוי/i.test(text)
      };

      return [
        {
          ...bucket,
          evidenceKey: outcome.evidenceKey ?? evidenceKeyForLabel(context, label, rangeFallbackKey(bucket))
        }
      ];
    }

    if (
      (/מעל|מעל\s*מ-|above|over|greater than|>=/i.test(lowerText)
        || text.includes("יותר")
        || text.includes("מעל"))
      && numbers[0] != null
    ) {
      const bucket = {
        label,
        kind: "above" as const,
        lower: numbers[0],
        inclusive: />=|לפחות|ומעלה|או\s+יותר/i.test(text)
      };

      return [
        {
          ...bucket,
          evidenceKey: outcome.evidenceKey ?? evidenceKeyForLabel(context, label, rangeFallbackKey(bucket))
        }
      ];
    }

    if (numbers.length >= 2 && numbers[0] != null && numbers[1] != null) {
      const bucket = {
        label,
        kind: "between" as const,
        lower: Math.min(numbers[0], numbers[1]),
        upper: Math.max(numbers[0], numbers[1])
      };

      return [
        {
          ...bucket,
          evidenceKey: outcome.evidenceKey ?? evidenceKeyForLabel(context, label, rangeFallbackKey(bucket))
        }
      ];
    }

    return [];
  });
}

function bucketContains(bucket: CbsRangeBucket, value: number): boolean {
  if (bucket.kind === "below") {
    return bucket.upper != null && (bucket.inclusive ? value <= bucket.upper : value < bucket.upper);
  }

  if (bucket.kind === "above") {
    return bucket.lower != null && (bucket.inclusive ? value >= bucket.lower : value > bucket.lower);
  }

  return bucket.lower != null && bucket.upper != null && value >= bucket.lower && value <= bucket.upper;
}

async function inspectCBS(
  context: OracleLifecycleSourceContext,
  fetchers: OracleSourceAdapterFetchers
): Promise<OracleSourceInspection> {
  const fetchedAt = defaultFetchedAt(fetchers);
  const sourceUrl = readContractResolutionSourceUrl(context) ?? context.resolutionSource;
  const spec = extractCbsTimeSeriesSpec(context);

  if (!spec) {
    return {
      objectType: "oracle_source_inspection",
      sourceFamily: "cbs_time_series",
      sourceUrl,
      status: "unknown",
      closeConditionSatisfied: false,
      resolutionAvailable: false,
      fetchedAt,
      rawHash: hashRawSnapshot(""),
      normalizedSnapshot: {},
      claimSummary: "CBS contract is missing machineResolutionEndpoint for exact time-series fetch.",
      confidence: "low",
      blockers: ["cbs_contract_unparseable"]
    };
  }

  const payloadText = await (fetchers.fetchText ?? ((url) => fetchOracleAdapterText(url, {
    headers: CBS_TIME_SERIES_FETCH_HEADERS,
    allowedHosts: CBS_TIME_SERIES_ALLOWED_HOSTS
  })))(spec.machineResolutionEndpoint);
  const candidates: CbsReadingCandidate[] = [];
  collectCbsReadingCandidatesFromPayload(payloadText, spec.seriesCode, candidates);
  const reading = pickLatestObservation(candidates, context.closeAt, spec.targetPeriod ?? null);

  if (!reading) {
    return {
      objectType: "oracle_source_inspection",
      sourceFamily: "cbs_time_series",
      sourceUrl,
      officialJsonUrl: spec.machineResolutionEndpoint,
      status: "not_started",
      closeConditionSatisfied: false,
      resolutionAvailable: false,
      fetchedAt,
      rawHash: resolvePayloadHash(payloadText),
      normalizedSnapshot: {
        spec,
        candidateCount: candidates.length
      },
      claimSummary: "CBS time-series machine endpoint did not expose a parseable monthly value.",
      confidence: "medium",
      blockers: ["cbs_value_missing"]
    };
  }

  const rangeBuckets = readRangeBuckets(context);
  const winningBucket = rangeBuckets.find((bucket) => bucketContains(bucket, reading.value));

  if (!winningBucket) {
    return {
      objectType: "oracle_source_inspection",
      sourceFamily: "cbs_time_series",
      sourceUrl,
      officialJsonUrl: spec.machineResolutionEndpoint,
      status: "unknown",
      closeConditionSatisfied: true,
      resolutionAvailable: false,
      fetchedAt,
      rawHash: resolvePayloadHash(payloadText),
      normalizedSnapshot: {
        spec,
        reading,
        buckets: rangeBuckets
      },
      claimSummary: `CBS monthly value ${reading.value} did not match any configured outcome range bucket.`,
      confidence: "medium",
      blockers: ["cbs_range_no_match"]
    };
  }

  return {
    objectType: "oracle_source_inspection",
    sourceFamily: "cbs_time_series",
    sourceUrl,
    officialJsonUrl: spec.machineResolutionEndpoint,
    status: "final",
    closeConditionSatisfied: true,
    resolutionAvailable: true,
    evidenceKey: winningBucket.evidenceKey,
    winnerKind: "named",
    winnerLabel: winningBucket.label,
    fetchedAt,
    rawHash: resolvePayloadHash(payloadText),
    normalizedSnapshot: {
      spec,
      reading,
      selectedBucket: winningBucket
    },
    claimSummary:
      `CBS monthly time-series value was ${reading.value}${reading.period ? ` (${reading.period.slice(0, 7)})` : ""}; winning bucket is ${winningBucket.label}.`,
    confidence: "high",
    blockers: []
  };
}

export const CBS_TIME_SERIES_SOURCE_ADAPTER: OracleLifecycleSourceAdapter = {
  sourceFamily: "cbs_time_series",
  sourceLabel: "CBS official monthly time-series",
  sourceIds: [CBS_TIME_SERIES_SOURCE_ID],
  measurementKinds: ["official_value"],
  resultShapes: ["multi_outcome"],
  routes: [{ measurementKind: "official_value", resultShape: "multi_outcome" }],
  capabilities: {
    closeCondition: false,
    resolution: true
  },
  supportsSource: (context) =>
    readContractSourceIds(context).includes(CBS_TIME_SERIES_SOURCE_ID) ||
    /cbs\.gov\.il\/.*api/i.test(readSourceHaystack(context)),
  inspectCloseCondition: inspectCBS,
  inspectResolution: inspectCBS
};
