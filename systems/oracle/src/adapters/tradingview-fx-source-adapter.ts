import {
  defaultFetchedAt,
  fetchOracleAdapterJson,
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

type TradingViewFxSpec = {
  symbol: string;
  closeAt: string;
  machineResolutionEndpoint: string;
  maxCloseLagMinutes: number;
  windowFrom?: string;
  windowTo?: string;
};

type TradingViewFxObservation = {
  symbol: string | null;
  price: number | null;
  observedAt: string | null;
  status: string | null;
};

type ThresholdOperator = ">" | ">=" | "<" | "<=";

type ThresholdSpec = {
  threshold: number;
  operator: ThresholdOperator;
};

type RangeBucket = {
  label: string;
  evidenceKey?: string;
  kind: "below" | "between" | "above";
  lower?: number;
  upper?: number;
};

const TRADINGVIEW_FX_SOURCE_ID = "src_tradingview_fx";
const DEFAULT_MAX_CLOSE_LAG_MINUTES = 15;
const TRADINGVIEW_FX_ALLOWED_HOSTS = ["scanner.tradingview.com"];

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function extractNumbers(value: string): number[] {
  return [...value.matchAll(/\d[\d,]*(?:\.\d+)?/g)]
    .map((match) => readNumber(match[0]))
    .filter((number): number is number => number != null);
}

function extractSymbol(value: string): string | null {
  const fromTradingViewUrl = value.match(/tradingview\.com\/symbols\/([A-Z0-9:_-]+)/i)?.[1]?.toUpperCase();

  if (fromTradingViewUrl) {
    return fromTradingViewUrl.replace(/[^A-Z0-9:_-]/g, "");
  }

  const fromSymbolParam = value.match(/[?&](?:symbol|ticker)=([A-Z0-9:_-]+)/i)?.[1]?.toUpperCase();

  if (fromSymbolParam) {
    return fromSymbolParam;
  }

  const fromSlashPair = value.match(/\b([A-Z]{3})\s*\/\s*([A-Z]{3})\b/i);

  if (fromSlashPair?.[1] && fromSlashPair[2]) {
    return `${fromSlashPair[1].toUpperCase()}${fromSlashPair[2].toUpperCase()}`;
  }

  const fromCompactPair = value.match(/\b([A-Z]{6})\b/i)?.[1]?.toUpperCase();

  return fromCompactPair ?? null;
}

function readTimelineNumber(context: OracleLifecycleSourceContext, key: string): number | null {
  const value = context.marketContract?.timeline?.[key];
  return readNumber(value);
}

function readEndpointTimestamp(value: string, key: "from" | "to"): string | undefined {
  try {
    const timestamp = new URL(value).searchParams.get(key);
    const parsed = timestamp ? Date.parse(timestamp) : NaN;
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
  } catch {
    return undefined;
  }
}

export function extractTradingViewFxSpec(context: OracleLifecycleSourceContext): TradingViewFxSpec | null {
  const machineResolutionEndpoint = readString(context.marketContract?.machineResolutionEndpoint);

  if (!machineResolutionEndpoint) {
    return null;
  }

  const closeAtMs = Date.parse(context.closeAt);

  if (!Number.isFinite(closeAtMs)) {
    return null;
  }

  const haystack = readSourceHaystack(context);
  const symbol = extractSymbol([machineResolutionEndpoint, haystack].join("\n"));

  if (!symbol) {
    return null;
  }

  return {
    symbol,
    closeAt: new Date(closeAtMs).toISOString(),
    machineResolutionEndpoint,
    windowFrom: readEndpointTimestamp(machineResolutionEndpoint, "from"),
    windowTo: readEndpointTimestamp(machineResolutionEndpoint, "to"),
    maxCloseLagMinutes:
      readTimelineNumber(context, "maxCloseLagMinutes") ?? DEFAULT_MAX_CLOSE_LAG_MINUTES
  };
}

function readFirstRecord(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  if (Array.isArray(payload)) {
    return payload.find((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item))) ?? null;
  }

  const record = payload as Record<string, unknown>;
  const data = record.data;

  if (Array.isArray(data)) {
    return readFirstRecord(data);
  }

  const quote = record.quote;

  if (quote && typeof quote === "object" && !Array.isArray(quote)) {
    return quote as Record<string, unknown>;
  }

  return record;
}

function readTimestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value < 10_000_000_000 ? value * 1000 : value;
    const date = new Date(millis);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }

  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function readObservation(payload: unknown, spec: TradingViewFxSpec): TradingViewFxObservation {
  const record = readFirstRecord(payload);

  if (!record) {
    return {
      symbol: null,
      price: null,
      observedAt: null,
      status: null
    };
  }

  const d = Array.isArray(record.d) ? record.d : null;
  const price =
    readNumber(record.price) ??
    readNumber(record.close) ??
    readNumber(record.last) ??
    readNumber(record.value) ??
    readNumber(record.lp) ??
    (d ? d.map(readNumber).find((number): number is number => number != null) ?? null : null);
  const symbol =
    readString(record.symbol) ??
    readString(record.s) ??
    readString(record.ticker) ??
    spec.symbol;
  const observedAt =
    readTimestamp(record.observedAt) ??
    readTimestamp(record.timestamp) ??
    readTimestamp(record.time) ??
    readTimestamp(record.updatedAt) ??
    readTimestamp(record.lastUpdateTime) ??
    readTimestamp(record.sourceTimestamp);

  return {
    symbol,
    price,
    observedAt,
    status: readString(record.status)
  };
}

function readObservations(payload: unknown, spec: TradingViewFxSpec): TradingViewFxObservation[] {
  if (Array.isArray(payload)) {
    return payload.map((item) => readObservation(item, spec));
  }

  return [readObservation(payload, spec)];
}

function isObservationFinal(observation: TradingViewFxObservation, spec: TradingViewFxSpec): boolean {
  if (observation.status && /final|closed|complete/i.test(observation.status)) {
    return true;
  }

  if (!observation.observedAt) {
    return false;
  }

  const observedAtMs = Date.parse(observation.observedAt);
  const closeAtMs = Date.parse(spec.closeAt);
  const maxLagMs = spec.maxCloseLagMinutes * 60 * 1000;

  return Number.isFinite(observedAtMs) && observedAtMs >= closeAtMs && observedAtMs <= closeAtMs + maxLagMs;
}

function isWindowedThreshold(context: OracleLifecycleSourceContext, spec: TradingViewFxSpec): boolean {
  const mode = context.marketContract?.timeline?.fxObservationMode;
  return (
    mode === "window" ||
    Boolean(spec.windowFrom || spec.windowTo) ||
    /crossed before|any time before|ירד(?:ה)?\s+מתחת|חצה(?:ה)?\s+מתחת|לפני\s+מועד\s+הסיום/i.test(readSourceHaystack(context))
  );
}

function isObservationInsideWindow(
  observation: TradingViewFxObservation,
  spec: TradingViewFxSpec
): boolean {
  if (!observation.observedAt) {
    return false;
  }

  const observedAtMs = Date.parse(observation.observedAt);
  const fromMs = spec.windowFrom ? Date.parse(spec.windowFrom) : -Infinity;
  const toMs = spec.windowTo ? Date.parse(spec.windowTo) : Date.parse(spec.closeAt);

  return Number.isFinite(observedAtMs) && observedAtMs >= fromMs && observedAtMs <= toMs;
}

function extractThresholdSpec(value: string): ThresholdSpec | null {
  const belowInclusiveMatch = value.match(
    /(?:לכל\s+היותר|ומטה|או\s+פחות|at most|or below|<=)\s*₪?\$?(\d[\d,]*(?:\.\d+)?)/i
  );

  if (belowInclusiveMatch?.[1]) {
    const threshold = readNumber(belowInclusiveMatch[1]);
    return threshold == null ? null : { threshold, operator: "<=" };
  }

  const belowMatch = value.match(
    /(?:מתחת\s+ל-|מתחת\s+ל|פחות\s+מ-|פחות\s+מ|נמוך\s+מ-|נמוך\s+מ|below|under|less than|<)\s*₪?\$?(\d[\d,]*(?:\.\d+)?)/i
  );

  if (belowMatch?.[1]) {
    const threshold = readNumber(belowMatch[1]);
    return threshold == null ? null : { threshold, operator: "<" };
  }

  const aboveInclusiveMatch = value.match(/(?:לפחות|ומעלה|at least|>=)\s*₪?\$?(\d[\d,]*(?:\.\d+)?)/i);

  if (aboveInclusiveMatch?.[1]) {
    const threshold = readNumber(aboveInclusiveMatch[1]);
    return threshold == null ? null : { threshold, operator: ">=" };
  }

  const aboveMatch = value.match(/(?:מעל|גבוה מ-|גבוה מ|above|higher than|>)\s*₪?\$?(\d[\d,]*(?:\.\d+)?)/i);

  if (aboveMatch?.[1]) {
    const threshold = readNumber(aboveMatch[1]);
    return threshold == null ? null : { threshold, operator: ">" };
  }

  return null;
}

function thresholdMatches(price: number, spec: ThresholdSpec): boolean {
  switch (spec.operator) {
    case ">":
      return price > spec.threshold;
    case ">=":
      return price >= spec.threshold;
    case "<":
      return price < spec.threshold;
    case "<=":
      return price <= spec.threshold;
  }
}

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

function rangeFallbackKey(bucket: Omit<RangeBucket, "label">): string | undefined {
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

function readRangeBuckets(context: OracleLifecycleSourceContext): RangeBucket[] {
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

  return buckets.flatMap((outcome): RangeBucket[] => {
    const label = outcome.label ?? "";
    const text = outcome.parseText ?? label;
    const numbers = extractNumbers(text);
    const lowerText = text.toLowerCase();

    if ((/מתחת|below|under|less than/i.test(lowerText) || text.includes("פחות")) && numbers[0] != null) {
      const bucket = {
        label,
        kind: "below" as const,
        upper: numbers[0]
      };

      return [
        {
          ...bucket,
          evidenceKey: outcome.evidenceKey ?? evidenceKeyForLabel(context, label, rangeFallbackKey(bucket))
        }
      ];
    }

    if ((/מעל|above|over|greater than/i.test(lowerText) || text.includes("יותר")) && numbers[0] != null) {
      const bucket = {
        label,
        kind: "above" as const,
        lower: numbers[0]
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

function bucketContains(bucket: RangeBucket, value: number): boolean {
  if (bucket.kind === "below") {
    return bucket.upper != null && value < bucket.upper;
  }

  if (bucket.kind === "above") {
    return bucket.lower != null && value > bucket.lower;
  }

  return bucket.lower != null && bucket.upper != null && value >= bucket.lower && value <= bucket.upper;
}

async function defaultFetchJson(url: string): Promise<unknown> {
  return fetchOracleAdapterJson(url, {
    headers: {
      "user-agent": "Navi Oracle TradingView FX adapter"
    },
    allowedHosts: TRADINGVIEW_FX_ALLOWED_HOSTS
  });
}

async function inspectTradingViewFx(
  context: OracleLifecycleSourceContext,
  fetchers: OracleSourceAdapterFetchers
): Promise<OracleSourceInspection> {
  const fetchedAt = defaultFetchedAt(fetchers);
  const sourceUrl =
    context.marketContract?.trustDisplayUrl ??
    readContractResolutionSourceUrl(context) ??
    context.resolutionSource;
  const spec = extractTradingViewFxSpec(context);

  if (!spec) {
    return {
      objectType: "oracle_source_inspection",
      sourceFamily: "tradingview_fx",
      sourceUrl,
      status: "unknown",
      closeConditionSatisfied: false,
      resolutionAvailable: false,
      fetchedAt,
      rawHash: hashRawSnapshot(""),
      normalizedSnapshot: {},
      claimSummary: "TradingView FX contract is missing a parseable symbol, close time, or machineResolutionEndpoint.",
      confidence: "low",
      blockers: ["tradingview_fx_contract_unparseable"]
    };
  }

  const payload = await (fetchers.fetchJson ?? defaultFetchJson)(spec.machineResolutionEndpoint);
  const observations = readObservations(payload, spec);
  const observation = observations[0] ?? {
    symbol: null,
    price: null,
    observedAt: null,
    status: null
  };
  const baseSnapshot = {
    spec,
    observation,
    observations: observations.length > 1 ? observations : undefined
  };

  if (context.marketContract?.measurementKind === "threshold_crossing" && isWindowedThreshold(context, spec)) {
    const thresholdSpec = extractThresholdSpec(readSourceHaystack(context));

    if (!thresholdSpec) {
      return {
        objectType: "oracle_source_inspection",
        sourceFamily: "tradingview_fx",
        sourceUrl,
        officialJsonUrl: spec.machineResolutionEndpoint,
        status: "unknown",
        closeConditionSatisfied: true,
        resolutionAvailable: false,
        fetchedAt,
        rawHash: hashRawSnapshot(payload),
        normalizedSnapshot: baseSnapshot,
        claimSummary: "TradingView FX threshold contract is missing a parseable threshold.",
        confidence: "low",
        blockers: ["tradingview_fx_threshold_missing"]
      };
    }

    const windowObservations = observations.filter((item) => item.price != null && isObservationInsideWindow(item, spec));
    const matchingObservation = windowObservations.find((item) => item.price != null && thresholdMatches(item.price, thresholdSpec));

    if (windowObservations.length === 0) {
      return {
        objectType: "oracle_source_inspection",
        sourceFamily: "tradingview_fx",
        sourceUrl,
        officialJsonUrl: spec.machineResolutionEndpoint,
        status: "unknown",
        closeConditionSatisfied: true,
        resolutionAvailable: false,
        fetchedAt,
        rawHash: hashRawSnapshot(payload),
        normalizedSnapshot: {
          ...baseSnapshot,
          threshold: thresholdSpec.threshold,
          operator: thresholdSpec.operator,
          window: {
            from: spec.windowFrom ?? null,
            to: spec.windowTo ?? spec.closeAt
          }
        },
        claimSummary: `TradingView FX window for ${spec.symbol} has no stored timestamped observations in the required window.`,
        confidence: "low",
        blockers: ["tradingview_fx_window_snapshots_missing"]
      };
    }

    const yesWins = Boolean(matchingObservation);

    return {
      objectType: "oracle_source_inspection",
      sourceFamily: "tradingview_fx",
      sourceUrl,
      officialJsonUrl: spec.machineResolutionEndpoint,
      status: "final",
      closeConditionSatisfied: true,
      resolutionAvailable: true,
      evidenceKey: yesWins ? "yes" : "no",
      winnerKind: "named",
      winnerLabel: yesWins ? "כן" : "לא",
      fetchedAt,
      rawHash: hashRawSnapshot(payload),
      normalizedSnapshot: {
        ...baseSnapshot,
        threshold: thresholdSpec.threshold,
        operator: thresholdSpec.operator,
        window: {
          from: spec.windowFrom ?? null,
          to: spec.windowTo ?? spec.closeAt
        },
        observationCount: windowObservations.length,
        matchingObservation: matchingObservation ?? null
      },
      claimSummary: yesWins
        ? `TradingView FX ${spec.symbol} crossed the threshold ${thresholdSpec.operator} ${thresholdSpec.threshold}; matching snapshot was ${matchingObservation?.price} at ${matchingObservation?.observedAt}.`
        : `TradingView FX ${spec.symbol} did not cross the threshold ${thresholdSpec.operator} ${thresholdSpec.threshold} across ${windowObservations.length} stored observations.`,
      confidence: "high",
      blockers: []
    };
  }

  if (observation.price == null) {
    return {
      objectType: "oracle_source_inspection",
      sourceFamily: "tradingview_fx",
      sourceUrl,
      officialJsonUrl: spec.machineResolutionEndpoint,
      status: "unknown",
      closeConditionSatisfied: false,
      resolutionAvailable: false,
      fetchedAt,
      rawHash: hashRawSnapshot(payload),
      normalizedSnapshot: baseSnapshot,
      claimSummary: `TradingView FX snapshot did not include a parseable ${spec.symbol} price.`,
      confidence: "low",
      blockers: ["tradingview_fx_price_missing"]
    };
  }

  if (!observation.observedAt && !observation.status) {
    return {
      objectType: "oracle_source_inspection",
      sourceFamily: "tradingview_fx",
      sourceUrl,
      officialJsonUrl: spec.machineResolutionEndpoint,
      status: "live",
      closeConditionSatisfied: true,
      resolutionAvailable: false,
      fetchedAt,
      rawHash: hashRawSnapshot(payload),
      normalizedSnapshot: baseSnapshot,
      claimSummary: `TradingView FX snapshot returned ${spec.symbol}=${observation.price}, but no source timestamp/final status was present.`,
      confidence: "medium",
      blockers: ["tradingview_fx_timestamp_missing"]
    };
  }

  if (!isObservationFinal(observation, spec)) {
    return {
      objectType: "oracle_source_inspection",
      sourceFamily: "tradingview_fx",
      sourceUrl,
      officialJsonUrl: spec.machineResolutionEndpoint,
      status: "live",
      closeConditionSatisfied: true,
      resolutionAvailable: false,
      fetchedAt,
      rawHash: hashRawSnapshot(payload),
      normalizedSnapshot: baseSnapshot,
      claimSummary: `TradingView FX snapshot for ${spec.symbol} is not final for close ${spec.closeAt}.`,
      confidence: "medium",
      blockers: ["tradingview_fx_snapshot_not_final"]
    };
  }

  if (context.marketContract?.measurementKind === "threshold_crossing") {
    const thresholdSpec = extractThresholdSpec(readSourceHaystack(context));

    if (!thresholdSpec) {
      return {
        objectType: "oracle_source_inspection",
        sourceFamily: "tradingview_fx",
        sourceUrl,
        officialJsonUrl: spec.machineResolutionEndpoint,
        status: "unknown",
        closeConditionSatisfied: true,
        resolutionAvailable: false,
        fetchedAt,
        rawHash: hashRawSnapshot(payload),
        normalizedSnapshot: baseSnapshot,
        claimSummary: "TradingView FX threshold contract is missing a parseable threshold.",
        confidence: "low",
        blockers: ["tradingview_fx_threshold_missing"]
      };
    }

    const yesWins = thresholdMatches(observation.price, thresholdSpec);

    return {
      objectType: "oracle_source_inspection",
      sourceFamily: "tradingview_fx",
      sourceUrl,
      officialJsonUrl: spec.machineResolutionEndpoint,
      status: "final",
      closeConditionSatisfied: true,
      resolutionAvailable: true,
      evidenceKey: yesWins ? "yes" : "no",
      winnerKind: "named",
      winnerLabel: yesWins ? "כן" : "לא",
      fetchedAt,
      rawHash: hashRawSnapshot(payload),
      normalizedSnapshot: {
        ...baseSnapshot,
        threshold: thresholdSpec.threshold,
        operator: thresholdSpec.operator
      },
      claimSummary: `TradingView FX ${spec.symbol} snapshot at ${observation.observedAt ?? "final source"} was ${observation.price}; threshold is ${thresholdSpec.operator} ${thresholdSpec.threshold}.`,
      confidence: "high",
      blockers: []
    };
  }

  const winningBucket = readRangeBuckets(context).find((bucket) => bucketContains(bucket, observation.price!));

  if (!winningBucket) {
    return {
      objectType: "oracle_source_inspection",
      sourceFamily: "tradingview_fx",
      sourceUrl,
      officialJsonUrl: spec.machineResolutionEndpoint,
      status: "unknown",
      closeConditionSatisfied: true,
      resolutionAvailable: false,
      fetchedAt,
      rawHash: hashRawSnapshot(payload),
      normalizedSnapshot: baseSnapshot,
      claimSummary: `TradingView FX ${spec.symbol} snapshot was ${observation.price}, but no listed range bucket matched.`,
      confidence: "medium",
      blockers: ["tradingview_fx_range_no_match"]
    };
  }

  return {
    objectType: "oracle_source_inspection",
    sourceFamily: "tradingview_fx",
    sourceUrl,
    officialJsonUrl: spec.machineResolutionEndpoint,
    status: "final",
    closeConditionSatisfied: true,
    resolutionAvailable: true,
    evidenceKey: winningBucket.evidenceKey,
    winnerKind: "named",
    winnerLabel: winningBucket.label,
    fetchedAt,
    rawHash: hashRawSnapshot(payload),
    normalizedSnapshot: {
      ...baseSnapshot,
      winningBucket
    },
    claimSummary: `TradingView FX ${spec.symbol} snapshot at ${observation.observedAt ?? "final source"} was ${observation.price}; winning bucket is ${winningBucket.label}.`,
    confidence: "high",
    blockers: []
  };
}

export const TRADINGVIEW_FX_SOURCE_ADAPTER: OracleLifecycleSourceAdapter = {
  sourceFamily: "tradingview_fx",
  sourceLabel: "TradingView FX price snapshot",
  sourceIds: [TRADINGVIEW_FX_SOURCE_ID],
  measurementKinds: ["threshold_crossing", "official_value"],
  resultShapes: ["yes_no", "multi_outcome"],
  routes: [
    { measurementKind: "threshold_crossing", resultShape: "yes_no" },
    { measurementKind: "official_value", resultShape: "multi_outcome" }
  ],
  capabilities: {
    closeCondition: false,
    resolution: true
  },
  supportsSource: (context) =>
    readContractSourceIds(context).includes(TRADINGVIEW_FX_SOURCE_ID) ||
    /tradingview\.com\/symbols\/|tradingview[_ -]?fx/i.test(readSourceHaystack(context)),
  inspectCloseCondition: inspectTradingViewFx,
  inspectResolution: inspectTradingViewFx
};
