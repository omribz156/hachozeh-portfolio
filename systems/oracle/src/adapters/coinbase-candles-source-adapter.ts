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

const COINBASE_FETCH_HEADERS = {
  "user-agent": "Navi Oracle Coinbase candles adapter"
};
const COINBASE_ALLOWED_HOSTS = ["api.exchange.coinbase.com"];

type CoinbaseCandleSpec = {
  productId: string;
  candleDate: string;
};

type CoinbaseCandle = {
  time: number;
  low: number;
  high: number;
  open: number;
  close: number;
  volume: number;
};

type RangeBucket = {
  label: string;
  evidenceKey?: string;
  kind: "below" | "between" | "above";
  lower?: number;
  upper?: number;
};

const COINBASE_SOURCE_ID = "src_coinbase_exchange_candles";

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

function extractNumbers(value: string): number[] {
  return [...value.matchAll(/\d[\d,]*(?:\.\d+)?/g)]
    .map((match) => readNumber(match[0]))
    .filter((number): number is number => number != null);
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

function extractProductId(value: string): string | null {
  const fromUrl = value.match(/products\/([A-Z0-9-]+)\/candles/i)?.[1]?.toUpperCase();

  if (fromUrl) {
    return fromUrl;
  }

  const fromText = value.match(/\b([A-Z]{2,10}-USD)\b/i)?.[1]?.toUpperCase();

  if (fromText) {
    return fromText;
  }

  if (/ביטקוין|bitcoin|btc/i.test(value)) {
    return "BTC-USD";
  }

  if (/אתריום|ethereum|ether|eth/i.test(value)) {
    return "ETH-USD";
  }

  return null;
}

function extractCandleDate(context: OracleLifecycleSourceContext): string | null {
  const haystackDate = extractHebrewDate(readSourceHaystack(context));

  if (haystackDate) {
    return haystackDate;
  }

  const closeAt = Date.parse(context.closeAt);

  if (!Number.isFinite(closeAt)) {
    return null;
  }

  const candleStart = new Date(closeAt - 24 * 60 * 60 * 1000);
  return candleStart.toISOString().slice(0, 10);
}

export function extractCoinbaseCandleSpec(context: OracleLifecycleSourceContext): CoinbaseCandleSpec | null {
  const haystack = readSourceHaystack(context);
  const productId = extractProductId(haystack);
  const candleDate = extractCandleDate(context);

  if (!productId || !candleDate) {
    return null;
  }

  return {
    productId,
    candleDate
  };
}

function buildCoinbaseCandlesUrl(spec: CoinbaseCandleSpec): string {
  const start = `${spec.candleDate}T00:00:00.000Z`;
  const end = new Date(`${spec.candleDate}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);

  return `https://api.exchange.coinbase.com/products/${spec.productId}/candles?granularity=86400&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end.toISOString())}`;
}

function parseCandle(row: unknown): CoinbaseCandle | null {
  if (!Array.isArray(row) || row.length < 6) {
    return null;
  }

  const [time, low, high, open, close, volume] = row.map(readNumber);

  if (time == null || low == null || high == null || open == null || close == null || volume == null) {
    return null;
  }

  return {
    time,
    low,
    high,
    open,
    close,
    volume
  };
}

function findCandle(payload: unknown, spec: CoinbaseCandleSpec): CoinbaseCandle | null {
  if (!Array.isArray(payload)) {
    return null;
  }

  const targetStartSeconds = Date.parse(`${spec.candleDate}T00:00:00.000Z`) / 1000;
  const targetEndSeconds = targetStartSeconds + 24 * 60 * 60;

  return (
    payload
      .map(parseCandle)
      .find((candle): candle is CoinbaseCandle =>
        Boolean(candle && candle.time >= targetStartSeconds && candle.time < targetEndSeconds)
      ) ?? null
  );
}

function extractThreshold(value: string): number | null {
  const thresholdMatch =
    value.match(/(?:מעל|גבוה מ-|גבוה מ|above|higher than|>)\s*\$?(\d[\d,]*(?:\.\d+)?)/i) ??
    value.match(/(?:לפחות|ומעלה|at least|>=)\s*\$?(\d[\d,]*(?:\.\d+)?)/i);

  return thresholdMatch?.[1] ? readNumber(thresholdMatch[1]) : null;
}

function thresholdUsesInclusiveOperator(value: string): boolean {
  return /לפחות|ומעלה|at least|>=|equal or above/i.test(value);
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

function rangeBucketFromEvidenceKey(label: string, evidenceKey: string | undefined): RangeBucket | null {
  if (!evidenceKey) {
    return null;
  }

  const below = evidenceKey.match(/^below-(\d+(?:\.\d+)?)$/i);
  if (below?.[1]) {
    return {
      label,
      evidenceKey,
      kind: "below",
      upper: Number(below[1])
    };
  }

  const above = evidenceKey.match(/^(?:above|at-least)-(\d+(?:\.\d+)?)$/i);
  if (above?.[1]) {
    return {
      label,
      evidenceKey,
      kind: "above",
      lower: Number(above[1])
    };
  }

  const range = evidenceKey.match(/^range-(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/i);
  if (range?.[1] && range[2]) {
    const lower = Number(range[1]);
    const upper = Number(range[2]);

    return {
      label,
      evidenceKey,
      kind: "between",
      lower: Math.min(lower, upper),
      upper: Math.max(lower, upper)
    };
  }

  return null;
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
    const evidenceKeyBucket = rangeBucketFromEvidenceKey(label, outcome.evidenceKey);
    if (evidenceKeyBucket) {
      return [evidenceKeyBucket];
    }

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

const defaultFetchJson = (url: string): Promise<unknown> =>
  fetchOracleAdapterJson(url, {
    headers: COINBASE_FETCH_HEADERS,
    allowedHosts: COINBASE_ALLOWED_HOSTS
  });

async function inspectCoinbaseCandle(
  context: OracleLifecycleSourceContext,
  fetchers: OracleSourceAdapterFetchers
): Promise<OracleSourceInspection> {
  const fetchedAt = defaultFetchedAt(fetchers);
  const sourceUrl = readContractResolutionSourceUrl(context) ?? context.resolutionSource;
  const spec = extractCoinbaseCandleSpec(context);

  if (!spec) {
    return {
      objectType: "oracle_source_inspection",
      sourceFamily: "coinbase_exchange_candles",
      sourceUrl,
      status: "unknown",
      closeConditionSatisfied: false,
      resolutionAvailable: false,
      fetchedAt,
      rawHash: hashRawSnapshot(""),
      normalizedSnapshot: {},
      claimSummary: "Coinbase candle contract is missing a parseable product id or UTC candle date.",
      confidence: "low",
      blockers: ["coinbase_contract_unparseable"]
    };
  }

  const officialJsonUrl = buildCoinbaseCandlesUrl(spec);
  const payload = await (fetchers.fetchJson ?? defaultFetchJson)(officialJsonUrl);
  const candle = findCandle(payload, spec);
  const baseSnapshot = {
    spec,
    candle,
    officialStatus: candle ? "final" : "not_started"
  };

  if (!candle) {
    return {
      objectType: "oracle_source_inspection",
      sourceFamily: "coinbase_exchange_candles",
      sourceUrl,
      officialJsonUrl,
      status: "not_started",
      closeConditionSatisfied: false,
      resolutionAvailable: false,
      fetchedAt,
      rawHash: hashRawSnapshot(payload),
      normalizedSnapshot: baseSnapshot,
      claimSummary: `Coinbase Exchange did not return a daily ${spec.productId} candle for ${spec.candleDate}.`,
      confidence: "medium",
      blockers: ["coinbase_candle_missing"]
    };
  }

  if (context.marketContract?.measurementKind === "threshold_crossing") {
    const threshold = extractThreshold(readSourceHaystack(context));

    if (threshold == null) {
      return {
        objectType: "oracle_source_inspection",
        sourceFamily: "coinbase_exchange_candles",
        sourceUrl,
        officialJsonUrl,
        status: "unknown",
        closeConditionSatisfied: true,
        resolutionAvailable: false,
        fetchedAt,
        rawHash: hashRawSnapshot(payload),
        normalizedSnapshot: baseSnapshot,
        claimSummary: "Coinbase threshold contract is missing a parseable threshold.",
        confidence: "low",
        blockers: ["coinbase_threshold_missing"]
      };
    }

    const inclusive = thresholdUsesInclusiveOperator(readSourceHaystack(context));
    const yesWins = inclusive ? candle.close >= threshold : candle.close > threshold;

    return {
      objectType: "oracle_source_inspection",
      sourceFamily: "coinbase_exchange_candles",
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
      normalizedSnapshot: {
        ...baseSnapshot,
        threshold,
        operator: inclusive ? ">=" : ">"
      },
      claimSummary: `Coinbase Exchange daily ${spec.productId} candle for ${spec.candleDate} closed at ${candle.close}; threshold is ${inclusive ? ">=" : ">"} ${threshold}.`,
      confidence: "high",
      blockers: []
    };
  }

  const winningBucket = readRangeBuckets(context).find((bucket) => bucketContains(bucket, candle.close));

  if (!winningBucket) {
    return {
      objectType: "oracle_source_inspection",
      sourceFamily: "coinbase_exchange_candles",
      sourceUrl,
      officialJsonUrl,
      status: "unknown",
      closeConditionSatisfied: true,
      resolutionAvailable: false,
      fetchedAt,
      rawHash: hashRawSnapshot(payload),
      normalizedSnapshot: baseSnapshot,
      claimSummary: `Coinbase Exchange daily ${spec.productId} candle for ${spec.candleDate} closed at ${candle.close}, but no listed range bucket matched.`,
      confidence: "medium",
      blockers: ["coinbase_range_no_match"]
    };
  }

  return {
    objectType: "oracle_source_inspection",
    sourceFamily: "coinbase_exchange_candles",
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
      ...baseSnapshot,
      winningBucket
    },
    claimSummary: `Coinbase Exchange daily ${spec.productId} candle for ${spec.candleDate} closed at ${candle.close}; winning bucket is ${winningBucket.label}.`,
    confidence: "high",
    blockers: []
  };
}

export const COINBASE_CANDLES_SOURCE_ADAPTER: OracleLifecycleSourceAdapter = {
  sourceFamily: "coinbase_exchange_candles",
  sourceLabel: "Coinbase Exchange daily candles",
  sourceIds: [COINBASE_SOURCE_ID],
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
    readContractSourceIds(context).includes(COINBASE_SOURCE_ID) ||
    /api\.exchange\.coinbase\.com\/products\/[A-Z0-9-]+\/candles|coinbase exchange/i.test(readSourceHaystack(context)),
  inspectCloseCondition: inspectCoinbaseCandle,
  inspectResolution: inspectCoinbaseCandle
};
