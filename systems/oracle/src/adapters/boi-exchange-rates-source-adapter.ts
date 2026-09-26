import {
  defaultFetchedAt,
  fetchOracleAdapterJson,
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

type BoiExchangeRateSpec = {
  currencyKey: string;
  targetDate: string;
  threshold: number;
  operator: ThresholdOperator;
};

type BoiExchangeRateObservation = {
  currencyKey: string;
  rate: number;
  unit?: number | null;
  observedDate: string;
  sourceMode: "sdmx" | "current";
};

type ThresholdOperator = ">" | ">=" | "<" | "<=";

const BOI_EXCHANGE_RATES_SOURCE_ID = "src_boi_exchange_rates";
const BOI_EXCHANGE_RATES_FETCH_HEADERS = {
  "user-agent": "Navi Oracle BOI exchange-rates adapter"
};
const BOI_EXCHANGE_RATES_ALLOWED_HOSTS = ["edge.boi.org.il", "boi.org.il"];

const HEBREW_MONTHS: Record<string, string> = {
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

function extractCurrencyKey(value: string): string | null {
  const fromUrl = value.match(/[?&]key=([A-Z]{3})\b/i)?.[1]?.toUpperCase();

  if (fromUrl) {
    return fromUrl;
  }

  const fromText = value.match(/\b(USD|EUR|GBP|JPY|CHF|CAD|AUD|SEK|NOK|DKK|JOD|EGP)\b/i)?.[1]?.toUpperCase();

  if (fromText) {
    return fromText;
  }

  if (/דולר|dollar|usd/i.test(value)) {
    return "USD";
  }

  if (/אירו|יורו|euro|eur/i.test(value)) {
    return "EUR";
  }

  if (/ליש["׳']?ט|פאונד|sterling|pound|gbp/i.test(value)) {
    return "GBP";
  }

  if (/ין|yen|jpy/i.test(value)) {
    return "JPY";
  }

  return null;
}

function extractHebrewDate(value: string): string | null {
  const match = value.match(/(\d{1,2})\s+(בינואר|בפברואר|במרץ|באפריל|במאי|ביוני|ביולי|באוגוסט|בספטמבר|באוקטובר|בנובמבר|בדצמבר)\s+(20\d{2})/);

  if (!match?.[1] || !match[2] || !match[3]) {
    return null;
  }

  return `${match[3]}-${HEBREW_MONTHS[match[2]]}-${match[1].padStart(2, "0")}`;
}

function extractTargetDate(context: OracleLifecycleSourceContext): string | null {
  const haystack = readSourceHaystack(context);
  const iso = haystack.match(/20\d{2}-\d{2}-\d{2}/)?.[0];

  if (iso) {
    return iso;
  }

  const hebrew = extractHebrewDate(haystack);

  if (hebrew) {
    return hebrew;
  }

  const expectedResolutionAt = context.marketContract?.timeline?.expectedResolutionAt;
  const timelineDate = typeof expectedResolutionAt === "string" ? expectedResolutionAt : context.closeAt;
  const parsed = Date.parse(timelineDate);

  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}

function extractThreshold(value: string): number | null {
  const decimalCandidate = value.match(/\b\d{1,3}\.\d+\b/)?.[0];

  if (decimalCandidate) {
    return readNumber(decimalCandidate);
  }

  const thresholdMatch =
    value.match(/(?:מעל|גבוה מ-|גבוה מ|לפחות|ומעלה|יגיע(?:ה)? ל-|יגיע(?:ה)? אל|יהיה|תהיה|above|higher than|at least|>=|>)\s*₪?\$?(\d[\d,]*(?:\.\d+)?)/i) ??
    value.match(/(?:סף|threshold)[^\d]*(\d[\d,]*(?:\.\d+)?)/i);

  return thresholdMatch?.[1] ? readNumber(thresholdMatch[1]) : null;
}

function extractThresholdOperator(value: string): ThresholdOperator {
  if (/לכל\s+היותר|ומטה|או\s+פחות|at most|or below|<=/i.test(value)) {
    return "<=";
  }

  if (/מתחת\s+ל-?|פחות\s+מ-?|נמוך\s+מ-?|below|under|less than|</i.test(value)) {
    return "<";
  }

  if (/לפחות|ומעלה|או\s+יותר|יגיע(?:ה)? ל-|יגיע(?:ה)? אל|at least|>=|equal or above|reach/i.test(value)) {
    return ">=";
  }

  return ">";
}

export function extractBoiExchangeRateSpec(context: OracleLifecycleSourceContext): BoiExchangeRateSpec | null {
  const haystack = readSourceHaystack(context);
  const currencyKey = extractCurrencyKey(haystack);
  const targetDate = extractTargetDate(context);
  const threshold = extractThreshold(haystack);

  if (!currencyKey || !targetDate || threshold == null) {
    return null;
  }

  return {
    currencyKey,
    targetDate,
    threshold,
    operator: extractThresholdOperator(haystack)
  };
}

function buildBoiSdmxUrl(spec: BoiExchangeRateSpec): string {
  const params = new URLSearchParams({
    "c[BASE_CURRENCY]": spec.currencyKey,
    startperiod: spec.targetDate,
    endperiod: spec.targetDate
  });

  return `https://edge.boi.org.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0/?${params.toString()}`;
}

function buildBoiCurrentUrl(spec: BoiExchangeRateSpec): string {
  return `https://boi.org.il/PublicApi/GetExchangeRate?key=${encodeURIComponent(spec.currencyKey)}`;
}

function parseBoiSdmxObservation(payload: string, spec: BoiExchangeRateSpec): BoiExchangeRateObservation | null {
  const seriesPattern = new RegExp(
    `<Series\\b(?=[^>]*BASE_CURRENCY="${spec.currencyKey}")(?=[^>]*COUNTER_CURRENCY="ILS")(?=[^>]*UNIT_MEASURE="ILS")(?=[^>]*DATA_TYPE="OF00")[^>]*>([\\s\\S]*?)<\\/Series>`,
    "i"
  );
  const series = payload.match(seriesPattern)?.[1];

  if (!series) {
    return null;
  }

  const obsPattern = new RegExp(`<Obs\\b(?=[^>]*TIME_PERIOD="${spec.targetDate}")(?=[^>]*OBS_VALUE="([^"]+)")[^>]*>`, "i");
  const rate = readNumber(series.match(obsPattern)?.[1]);

  if (rate == null) {
    return null;
  }

  return {
    currencyKey: spec.currencyKey,
    rate,
    observedDate: spec.targetDate,
    sourceMode: "sdmx"
  };
}

function parseBoiCurrentObservation(payload: unknown, spec: BoiExchangeRateSpec): BoiExchangeRateObservation | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const currencyKey = typeof record.key === "string" ? record.key.toUpperCase() : null;
  const rate = readNumber(record.currentExchangeRate);
  const lastUpdate = typeof record.lastUpdate === "string" ? record.lastUpdate : null;
  const parsedUpdate = lastUpdate ? Date.parse(lastUpdate) : NaN;

  if (currencyKey !== spec.currencyKey || rate == null || !Number.isFinite(parsedUpdate)) {
    return null;
  }

  return {
    currencyKey,
    rate,
    unit: readNumber(record.unit),
    observedDate: new Date(parsedUpdate).toISOString().slice(0, 10),
    sourceMode: "current"
  };
}

function evidenceKeyForObservation(spec: BoiExchangeRateSpec, observation: BoiExchangeRateObservation): "yes" | "no" {
  switch (spec.operator) {
    case ">":
      return observation.rate > spec.threshold ? "yes" : "no";
    case ">=":
      return observation.rate >= spec.threshold ? "yes" : "no";
    case "<":
      return observation.rate < spec.threshold ? "yes" : "no";
    case "<=":
      return observation.rate <= spec.threshold ? "yes" : "no";
  }
}

function readOutcomeLabel(context: OracleLifecycleSourceContext, evidenceKey: "yes" | "no"): string {
  const mapped = context.marketContract?.outcomeMap?.find((outcome) => outcome.evidenceKey === evidenceKey);

  if (mapped?.outcomeLabel) {
    return mapped.outcomeLabel;
  }

  const fallbackLabel = evidenceKey === "yes" ? "כן" : "לא";
  const matchingOutcome = context.outcomes.find(
    (outcome) => normalizeComparable(outcome.label) === normalizeComparable(fallbackLabel)
  );

  return matchingOutcome?.label ?? fallbackLabel;
}

function unknownInspection(
  context: OracleLifecycleSourceContext,
  fetchedAt: string,
  reason: string,
  blocker: string
): OracleSourceInspection {
  return {
    objectType: "oracle_source_inspection",
    sourceFamily: "boi_exchange_rates",
    sourceUrl: readContractResolutionSourceUrl(context) ?? context.resolutionSource,
    status: "unknown",
    closeConditionSatisfied: false,
    resolutionAvailable: false,
    fetchedAt,
    rawHash: hashRawSnapshot(""),
    normalizedSnapshot: {},
    claimSummary: reason,
    confidence: "low",
    blockers: [blocker]
  };
}

async function inspectBoiExchangeRate(
  context: OracleLifecycleSourceContext,
  fetchers: OracleSourceAdapterFetchers
): Promise<OracleSourceInspection> {
  const fetchedAt = defaultFetchedAt(fetchers);
  const sourceUrl = readContractResolutionSourceUrl(context) ?? context.resolutionSource;
  const spec = extractBoiExchangeRateSpec(context);

  if (!spec) {
    return unknownInspection(
      context,
      fetchedAt,
      "Bank of Israel FX contract is missing a parseable currency, target date, or threshold.",
      "boi_fx_contract_unparseable"
    );
  }

  const officialSdmxUrl = buildBoiSdmxUrl(spec);
  const sdmxPayload = await (
    fetchers.fetchText ??
    ((url) => fetchOracleAdapterText(url, {
      headers: BOI_EXCHANGE_RATES_FETCH_HEADERS,
      allowedHosts: BOI_EXCHANGE_RATES_ALLOWED_HOSTS
    }))
  )(officialSdmxUrl);
  const sdmxObservation = parseBoiSdmxObservation(sdmxPayload, spec);
  const officialCurrentUrl = buildBoiCurrentUrl(spec);
  const currentPayload = sdmxObservation
    ? null
    : await (
        fetchers.fetchJson ??
        ((url) => fetchOracleAdapterJson(url, {
          headers: BOI_EXCHANGE_RATES_FETCH_HEADERS,
          allowedHosts: BOI_EXCHANGE_RATES_ALLOWED_HOSTS
        }))
      )(officialCurrentUrl);
  const currentObservation = sdmxObservation ? null : parseBoiCurrentObservation(currentPayload, spec);
  const observation = sdmxObservation ?? (currentObservation?.observedDate === spec.targetDate ? currentObservation : null);
  const rawPayload = sdmxObservation ? sdmxPayload : currentPayload;

  if (!observation) {
    return {
      objectType: "oracle_source_inspection",
      sourceFamily: "boi_exchange_rates",
      sourceUrl,
      officialJsonUrl: officialSdmxUrl,
      status: "not_started",
      closeConditionSatisfied: false,
      resolutionAvailable: false,
      fetchedAt,
      rawHash: hashRawSnapshot(rawPayload ?? ""),
      normalizedSnapshot: {
        spec,
        currentObservation,
        officialStatus: "not_started"
      },
      claimSummary: `Bank of Israel did not return a representative ${spec.currencyKey}/ILS rate for ${spec.targetDate}.`,
      confidence: "medium",
      blockers: ["boi_fx_observation_missing"]
    };
  }

  const evidenceKey = evidenceKeyForObservation(spec, observation);
  const winnerLabel = readOutcomeLabel(context, evidenceKey);

  return {
    objectType: "oracle_source_inspection",
    sourceFamily: "boi_exchange_rates",
    sourceUrl,
    officialJsonUrl: observation.sourceMode === "sdmx" ? officialSdmxUrl : officialCurrentUrl,
    status: "final",
    closeConditionSatisfied: true,
    resolutionAvailable: true,
    evidenceKey,
    winnerKind: "named",
    winnerLabel,
    fetchedAt,
    rawHash: hashRawSnapshot(rawPayload ?? ""),
    normalizedSnapshot: {
      spec,
      observation,
      operator: spec.operator
    },
    claimSummary: `Bank of Israel representative ${spec.currencyKey}/ILS rate for ${spec.targetDate} was ${observation.rate}; threshold is ${spec.operator} ${spec.threshold}.`,
    confidence: "high",
    blockers: []
  };
}

export const BOI_EXCHANGE_RATES_SOURCE_ADAPTER: OracleLifecycleSourceAdapter = {
  sourceFamily: "boi_exchange_rates",
  sourceLabel: "Bank of Israel representative exchange rates",
  sourceIds: [BOI_EXCHANGE_RATES_SOURCE_ID],
  measurementKinds: ["threshold_crossing"],
  resultShapes: ["yes_no"],
  routes: [{ measurementKind: "threshold_crossing", resultShape: "yes_no" }],
  capabilities: {
    closeCondition: false,
    resolution: true
  },
  supportsSource: (context) =>
    readContractSourceIds(context).includes(BOI_EXCHANGE_RATES_SOURCE_ID) ||
    /boi\.org\.il\/PublicApi\/GetExchangeRates|boi\.org\.il\/PublicApi\/GetExchangeRate|שער(?:י)?\s+חליפין|שער\s+יציג/i.test(readSourceHaystack(context)),
  inspectCloseCondition: inspectBoiExchangeRate,
  inspectResolution: inspectBoiExchangeRate
};
