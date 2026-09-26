import {
  defaultFetchedAt,
  fetchOracleAdapterJson,
  hashRawSnapshot,
  readContractResolutionSourceUrl,
  readContractSourceIds,
  readSourceHaystack,
  type OracleLifecycleSourceAdapter,
  type OracleLifecycleSourceContext,
  type OracleSourceAdapterFetchers,
  type OracleSourceInspection
} from "../source-adapter-contracts";

type ImsThresholdSpec = {
  metric: string;
  stationId: string;
  stationName: string;
  localDate: string;
  threshold: number;
};

type ImsObservationSpec = Omit<ImsThresholdSpec, "threshold"> & {
  threshold?: number;
};

type RangeBucket = {
  label: string;
  evidenceKey?: string;
  kind: "below" | "between" | "above";
  lower?: number;
  upper?: number;
  lowerInclusive?: boolean;
  upperInclusive?: boolean;
};

const IMS_API_TOKEN_ENV = "IMS_API_TOKEN";
const IMS_FETCH_USER_AGENT = "Navi Oracle IMS daily-observations adapter";
const IMS_ALLOWED_HOSTS = ["api.ims.gov.il"];
const TEL_AVIV_COAST_STATION_ID = "178";

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

function extractHebrewDate(value: string): string | null {
  const months: Record<string, string> = {
    בינואר: "01",
    בפברואר: "02",
    במרץ: "03",
    באפריל: "04",
    במאי: "05",
    ביוני: "06",
    ביולי: "07",
    באוגוסט: "08",
    בספטמבר: "09",
    באוקטובר: "10",
    בנובמבר: "11",
    בדצמבר: "12"
  };
  const match = value.match(/(\d{1,2})\s+(בינואר|בפברואר|במרץ|באפריל|במאי|ביוני|ביולי|באוגוסט|בספטמבר|באוקטובר|בנובמבר|בדצמבר)\s+(20\d{2})/);

  if (!match?.[1] || !match[2] || !match[3]) {
    const iso = value.match(/20\d{2}-\d{2}-\d{2}/);
    return iso?.[0] ?? null;
  }

  return `${match[3]}-${months[match[2]]}-${match[1].padStart(2, "0")}`;
}

function extractThreshold(value: string): number | null {
  const match = value.match(/(\d+(?:\.\d+)?)\s*(?:°|מעלות|צלזיוס|c\b)/i);
  return match?.[1] ? Number(match[1]) : null;
}

function extractNumbers(value: string): number[] {
  return [...value.matchAll(/\d[\d,]*(?:\.\d+)?/g)]
    .map((match) => readNumber(match[0].replace(/,/g, "")))
    .filter((number): number is number => number != null);
}

function extractMetric(value: string): string {
  const match = value.match(/\b(TDmax|TDmin|TD|Rain|RH|WSmax)\b/i);
  return match?.[1] ?? "TDmax";
}

function extractStationId(value: string): string {
  const explicit = value.match(/station[-_\s]?id=(\d+)/i);

  if (explicit?.[1]) {
    return explicit[1];
  }

  return /תל[- ]?אביב|tel aviv/i.test(value) ? TEL_AVIV_COAST_STATION_ID : "";
}

function extractStationName(value: string): string {
  if (/תל[- ]?אביב.*חוף|tel aviv coast/i.test(value)) {
    return "תל-אביב, חוף";
  }

  const match = value.match(/תחנת\s+([^.:;\n]+)/);
  return match?.[1]?.trim() || "תחנה רשמית";
}

export function extractImsThresholdSpec(context: OracleLifecycleSourceContext): ImsThresholdSpec | null {
  const spec = extractImsObservationSpec(context);

  if (!spec || spec.threshold == null) {
    return null;
  }

  return {
    ...spec,
    threshold: spec.threshold
  };
}

function extractImsObservationSpec(context: OracleLifecycleSourceContext): ImsObservationSpec | null {
  const haystack = readSourceHaystack(context);
  const threshold = extractThreshold(haystack);
  const localDate = extractHebrewDate(haystack);
  const stationId = extractStationId(haystack);

  if (!localDate || !stationId) {
    return null;
  }

  return {
    metric: extractMetric(haystack),
    stationId,
    stationName: extractStationName(haystack),
    localDate,
    threshold: threshold ?? undefined
  };
}

function findMetricValue(payload: unknown, metric: string): number | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  if (Array.isArray(payload)) {
    const values: number[] = [];

    for (const item of payload) {
      const found = findMetricValue(item, metric);

      if (found != null) {
        values.push(found);
      }
    }

    if (values.length === 0) {
      return null;
    }

    const metricKey = metric.toLowerCase();

    if (metricKey.includes("max")) {
      return Math.max(...values);
    }

    if (metricKey.includes("min")) {
      return Math.min(...values);
    }

    return values.at(-1) ?? null;
  }

  const record = payload as Record<string, unknown>;
  const wanted = metric.toLowerCase();

  const channelName = [
    record.name,
    record.channelName,
    record.channel_name,
    record.displayName,
    record.title,
    record.shortName,
    record.short_name
  ]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim().toLowerCase());
  const channelMatches = channelName.some((value) => value === wanted || value.includes(wanted));

  if (channelMatches) {
    for (const key of ["value", "val", "data", "reading", "lastValue"]) {
      const found = readNumber(record[key]);

      if (found != null) {
        return found;
      }
    }
  }

  for (const [key, value] of Object.entries(record)) {
    if (key.toLowerCase() === wanted) {
      return readNumber(value);
    }
  }

  for (const value of Object.values(record)) {
    const found = findMetricValue(value, metric);

    if (found != null) {
      return found;
    }
  }

  return null;
}

function buildImsDailyUrl(spec: ImsObservationSpec): string {
  const [year, month, day] = spec.localDate.split("-");
  return `https://api.ims.gov.il/v1/envista/stations/${spec.stationId}/data/daily/${year}/${month}/${day}`;
}

function rangeFallbackKey(bucket: Omit<RangeBucket, "label">): string | undefined {
  if (bucket.kind === "below" && bucket.upper != null) {
    return `below-${bucket.upper}`;
  }

  if (bucket.kind === "above" && bucket.lower != null) {
    return `at-least-${bucket.lower}`;
  }

  if (bucket.kind === "between" && bucket.lower != null && bucket.upper != null) {
    return `range-${bucket.lower}-${bucket.upper}`;
  }

  return undefined;
}

function readRangeBuckets(context: OracleLifecycleSourceContext): RangeBucket[] {
  const contractOutcomes =
    context.marketContract?.outcomeMap
      ?.map((outcome) => ({
        label: outcome.outcomeLabel,
        evidenceKey: outcome.evidenceKey,
        parseText: [outcome.resolutionPath, outcome.evidenceKey, outcome.outcomeLabel]
          .filter(Boolean)
          .join(" ")
      }))
      .filter((outcome) => outcome.label) ?? [];
  const outcomes = contractOutcomes.length > 0
    ? contractOutcomes
    : context.outcomes.map((outcome) => ({
        label: outcome.label,
        evidenceKey: outcome.outcomeKey,
        parseText: outcome.label
      }));

  return outcomes.flatMap((outcome): RangeBucket[] => {
    const label = outcome.label ?? "";
    const text = outcome.parseText ?? label;
    const numbers = extractNumbers(text);
    const lowerText = text.toLowerCase();

    if ((/מתחת|below|under|less than/i.test(lowerText) || text.includes("פחות")) && numbers[0] != null) {
      const bucket = {
        label,
        kind: "below" as const,
        upper: numbers[0],
        upperInclusive: /עד|כולל|or less|<=|at most/i.test(lowerText)
      };

      return [
        {
          ...bucket,
          evidenceKey: outcome.evidenceKey ?? rangeFallbackKey(bucket)
        }
      ];
    }

    if ((/מעל|ומעלה|לפחות|above|over|greater than|at least/i.test(lowerText) || text.includes("יותר")) && numbers[0] != null) {
      const bucket = {
        label,
        kind: "above" as const,
        lower: numbers[0],
        lowerInclusive: /ומעלה|לפחות|כולל|at least|>=/i.test(lowerText)
      };

      return [
        {
          ...bucket,
          evidenceKey: outcome.evidenceKey ?? rangeFallbackKey(bucket)
        }
      ];
    }

    if (numbers.length >= 2 && numbers[0] != null && numbers[1] != null) {
      const bucket = {
        label,
        kind: "between" as const,
        lower: Math.min(numbers[0], numbers[1]),
        upper: Math.max(numbers[0], numbers[1]),
        lowerInclusive: true,
        upperInclusive: true
      };

      return [
        {
          ...bucket,
          evidenceKey: outcome.evidenceKey ?? rangeFallbackKey(bucket)
        }
      ];
    }

    return [];
  });
}

function bucketContains(bucket: RangeBucket, value: number): boolean {
  if (bucket.kind === "below") {
    return bucket.upper != null && (bucket.upperInclusive ? value <= bucket.upper : value < bucket.upper);
  }

  if (bucket.kind === "above") {
    return bucket.lower != null && (bucket.lowerInclusive ? value >= bucket.lower : value > bucket.lower);
  }

  return (
    bucket.lower != null &&
    bucket.upper != null &&
    (bucket.lowerInclusive ? value >= bucket.lower : value > bucket.lower) &&
    (bucket.upperInclusive ? value <= bucket.upper : value < bucket.upper)
  );
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const token = process.env[IMS_API_TOKEN_ENV]?.trim();

  if (!token) {
    throw new Error(`missing_${IMS_API_TOKEN_ENV}`);
  }

  return fetchOracleAdapterJson(url, {
    headers: {
      Authorization: `ApiToken ${token}`,
      "user-agent": IMS_FETCH_USER_AGENT
    },
    allowedHosts: IMS_ALLOWED_HOSTS,
    nullOnNoContent: true,
    nullOnEmptyBody: true
  });
}

async function inspectImsThreshold(
  context: OracleLifecycleSourceContext,
  fetchers: OracleSourceAdapterFetchers
): Promise<OracleSourceInspection> {
  const fetchedAt = defaultFetchedAt(fetchers);
  const sourceUrl = readContractResolutionSourceUrl(context) ?? context.resolutionSource;
  const spec = extractImsObservationSpec(context);

  if (!spec) {
    return {
      objectType: "oracle_source_inspection",
      sourceFamily: "ims_daily_observations",
      sourceUrl,
      status: "unknown",
      closeConditionSatisfied: false,
      resolutionAvailable: false,
      fetchedAt,
      rawHash: hashRawSnapshot(""),
      normalizedSnapshot: {},
      claimSummary: "IMS threshold contract is missing a parseable station id, date, or threshold.",
      confidence: "low",
      blockers: ["ims_contract_unparseable"]
    };
  }

  const officialJsonUrl = buildImsDailyUrl(spec);

  if (!fetchers.fetchJson && !process.env[IMS_API_TOKEN_ENV]?.trim()) {
    return {
      objectType: "oracle_source_inspection",
      sourceFamily: "ims_daily_observations",
      sourceUrl,
      officialJsonUrl,
      status: "unknown",
      closeConditionSatisfied: false,
      resolutionAvailable: false,
      fetchedAt,
      rawHash: hashRawSnapshot(""),
      normalizedSnapshot: { spec },
      claimSummary: "IMS API token is not configured, so Oracle cannot fetch the official daily observation yet.",
      confidence: "low",
      blockers: ["missing_ims_api_token"]
    };
  }

  const payload = await (fetchers.fetchJson ?? defaultFetchJson)(officialJsonUrl);
  const observedValue = findMetricValue(payload, spec.metric);
  const normalizedSnapshot = {
    spec,
    observedValue
  };

  if (observedValue == null) {
    return {
      objectType: "oracle_source_inspection",
      sourceFamily: "ims_daily_observations",
      sourceUrl,
      officialJsonUrl,
      status: "not_started",
      closeConditionSatisfied: false,
      resolutionAvailable: false,
      fetchedAt,
      rawHash: hashRawSnapshot(payload),
      normalizedSnapshot,
      claimSummary: `IMS daily payload did not include a parseable ${spec.metric} value for station ${spec.stationId}.`,
      confidence: "medium",
      blockers: ["ims_metric_missing"]
    };
  }

  if (context.marketContract?.measurementKind === "threshold_crossing") {
    if (spec.threshold == null) {
      return {
        objectType: "oracle_source_inspection",
        sourceFamily: "ims_daily_observations",
        sourceUrl,
        officialJsonUrl,
        status: "unknown",
        closeConditionSatisfied: true,
        resolutionAvailable: false,
        fetchedAt,
        rawHash: hashRawSnapshot(payload),
        normalizedSnapshot,
        claimSummary: "IMS threshold contract is missing a parseable threshold.",
        confidence: "low",
        blockers: ["ims_threshold_missing"]
      };
    }

    const yesWins = observedValue >= spec.threshold;

    return {
      objectType: "oracle_source_inspection",
      sourceFamily: "ims_daily_observations",
      sourceUrl,
      officialJsonUrl,
      status: "final",
      closeConditionSatisfied: true,
      resolutionAvailable: true,
      evidenceKey: yesWins ? "yes" : "no",
      winnerKind: "named",
      winnerLabel: yesWins ? "כן" : "לא",
      fetchedAt,
      rawHash: hashRawSnapshot(payload),
      normalizedSnapshot,
      claimSummary: `IMS ${spec.metric} for ${spec.stationName} on ${spec.localDate} is ${observedValue}; threshold is ${spec.threshold}.`,
      confidence: "high",
      blockers: []
    };
  }

  const winningBucket = readRangeBuckets(context).find((bucket) => bucketContains(bucket, observedValue));

  if (!winningBucket) {
    return {
      objectType: "oracle_source_inspection",
      sourceFamily: "ims_daily_observations",
      sourceUrl,
      officialJsonUrl,
      status: "unknown",
      closeConditionSatisfied: true,
      resolutionAvailable: false,
      fetchedAt,
      rawHash: hashRawSnapshot(payload),
      normalizedSnapshot,
      claimSummary: `IMS ${spec.metric} for ${spec.stationName} on ${spec.localDate} is ${observedValue}, but no listed range bucket matched.`,
      confidence: "medium",
      blockers: ["ims_range_no_match"]
    };
  }

  return {
    objectType: "oracle_source_inspection",
    sourceFamily: "ims_daily_observations",
    sourceUrl,
    officialJsonUrl,
    status: "final",
    closeConditionSatisfied: true,
    resolutionAvailable: true,
    evidenceKey: winningBucket.evidenceKey,
    winnerKind: "named",
    winnerLabel: winningBucket.label,
    fetchedAt,
    rawHash: hashRawSnapshot(payload),
    normalizedSnapshot: {
      ...normalizedSnapshot,
      winningBucket
    },
    claimSummary: `IMS ${spec.metric} for ${spec.stationName} on ${spec.localDate} is ${observedValue}; winning bucket is ${winningBucket.label}.`,
    confidence: "high",
    blockers: []
  };
}

export const IMS_WEATHER_SOURCE_ADAPTER: OracleLifecycleSourceAdapter = {
  sourceFamily: "ims_daily_observations",
  sourceLabel: "Israel Meteorological Service daily observations",
  sourceIds: ["src_ims_daily_observations"],
  measurementKinds: ["threshold_crossing", "official_value"],
  resultShapes: ["yes_no", "multi_outcome"],
  routes: [
    { measurementKind: "threshold_crossing", resultShape: "yes_no" },
    { measurementKind: "official_value", resultShape: "multi_outcome" }
  ],
  requiredEnvVars: [IMS_API_TOKEN_ENV],
  capabilities: {
    closeCondition: false,
    resolution: true
  },
  supportsSource: (context) =>
    readContractSourceIds(context).includes("src_ims_daily_observations") ||
    /ims\.gov\.il|api\.ims\.gov\.il/i.test(readSourceHaystack(context)),
  inspectCloseCondition: inspectImsThreshold,
  inspectResolution: inspectImsThreshold
};
