import type {
  MarketContractBlocker,
  MarketContractV1,
  MarketMeasurementKind,
  MarketTaxonomyV1,
  MarketForm,
  MarketResultShape,
  OracleCapabilityStatus,
  ProposedOutcome,
  ResolutionAuthorityType,
  SourceRolePlan
} from "./contracts";
import { curateMarketImage } from "./market-image";

type BuildMarketContractInput = {
  question: string;
  marketKindId?: string;
  marketForm: MarketForm;
  proposedOutcomes: ProposedOutcome[];
  suggestedCloseShape?: string;
  suggestedResolutionAnchor?: string;
  sourceRolePlan?: SourceRolePlan;
  fetchNeeds?: string[];
  topSourceIds?: string[];
  topSourceRefs?: string[];
  topRisks?: string[];
  resolutionRule?: string;
  delayPolicy?: string;
  payoutPolicy?: string;
  expectedResolutionAt?: string | null;
  category?: string | null;
  measurement?: string;
  measurementKind?: MarketMeasurementKind;
  resultShape?: MarketResultShape;
  oracleCapability?: OracleCapabilityStatus;
  resolutionAuthorityType?: ResolutionAuthorityType;
};

const OFFICIAL_RESOLUTION_SOURCE_IDS = new Set([
  "src_boi_announcements",
  "src_coinbase_exchange_candles",
  "src_ecb_rss",
  "src_eurovision_official",
  "src_federal_reserve_rss",
  "src_fiba_basketball_games",
  "src_gdacs_alerts",
  "src_gov_il_news",
  "src_home_front_command",
  "src_iaa_notifications",
  "src_ibba_schedules",
  "src_ims_daily_observations",
  "src_ifa_fixtures_results",
  "src_ita_tournaments",
  "src_knesset_official",
  "src_nba_official_games",
  "src_nike_liga_official",
  "src_tradingview_fx",
  "src_usgs_alerts",
  "src_winner_league_basketball"
]);

const ATTENTION_ONLY_SOURCE_IDS = new Set([
  "src_google_trending_il",
  "src_google_trends_israel_interest_rate",
  "src_kalshi_market_reference",
  "src_news_burst_eurovision",
  "src_one_local_sports",
  "src_polymarket_market_reference",
  "src_sport5_local_sports"
]);

const IFA_FALLBACK_EVIDENCE_STANDARD =
  "אם אתר ההתאחדות לכדורגל חסום או אינו נגיש למכונה בזמן ההכרעה, מפעיל רשאי לאמת ידנית מול דף ההתאחדות הרשמי בדפדפן או מול פרסום רשמי של ההתאחדות לכדורגל, ולשמור קישור/צילום מסך/חותמת זמן בביקורת ההכרעה.";

const CATEGORY_VISIBLE_TAGS: Record<string, string> = {
  ai: "טכנולוגיה",
  companies: "חברות",
  crypto: "קריפטו",
  culture: "תרבות",
  economy: "כלכלה",
  economics: "כלכלה",
  energy: "אנרגיה",
  entertainment: "תרבות",
  general: "כללי",
  geopolitics: "עולם",
  health: "בריאות",
  legislation: "חקיקה",
  politics: "פוליטיקה",
  science: "מדע",
  security: "ביטחון",
  sports: "ספורט",
  technology: "טכנולוגיה",
  travel: "תחבורה",
  weather: "מזג אוויר"
};

type SourceTaxonomyHint = {
  family: string;
  visibleTag: string;
  entities: string[];
  aliases: string[];
  geography?: string[];
};

const SOURCE_TAXONOMY_HINTS: Record<string, SourceTaxonomyHint> = {
  src_boi_announcements: {
    family: "interest-rates",
    visibleTag: "ריבית",
    entities: ["bank-of-israel"],
    aliases: ["BOI", "Bank of Israel", "בנק ישראל", "נגיד", "ריבית"],
    geography: ["israel"]
  },
  src_coinbase_exchange_candles: {
    family: "crypto-prices",
    visibleTag: "מחירי קריפטו",
    entities: ["coinbase"],
    aliases: ["Coinbase", "BTC", "ETH", "SOL", "crypto", "bitcoin", "קריפטו"]
  },
  src_tradingview_fx: {
    family: "fx-live-prices",
    visibleTag: "מט״ח",
    entities: ["tradingview"],
    aliases: ["TradingView", "FX", "forex", "USDILS", "EURILS", "EURUSD", "מט״ח", "דולר", "אירו"]
  },
  src_ifa_fixtures_results: {
    family: "sports-fixtures",
    visibleTag: "כדורגל",
    entities: ["ifa"],
    aliases: ["IFA", "Israel Football Association", "ההתאחדות לכדורגל", "כדורגל ישראלי"],
    geography: ["israel"]
  },
  src_ims_daily_observations: {
    family: "weather-daily-observations",
    visibleTag: "טמפרטורה",
    entities: ["ims"],
    aliases: ["IMS", "Israel Meteorological Service", "השירות המטאורולוגי", "מזג אוויר", "טמפרטורה"],
    geography: ["israel"]
  },
  src_knesset_official: {
    family: "knesset",
    visibleTag: "כנסת",
    entities: ["knesset"],
    aliases: ["Knesset", "הכנסת", "כנסת", "חקיקה", "חוק", "מליאה"],
    geography: ["israel"]
  },
  src_nba_official_games: {
    family: "sports-fixtures",
    visibleTag: "NBA",
    entities: ["nba"],
    aliases: ["NBA", "basketball", "כדורסל"]
  },
  src_fiba_basketball_games: {
    family: "sports-fixtures",
    visibleTag: "כדורסל",
    entities: ["fiba", "israel-u20-basketball"],
    aliases: ["FIBA", "EuroBasket", "U20 EuroBasket", "כדורסל", "נבחרת ישראל"],
    geography: ["israel", "international"]
  },
  src_winner_league_basketball: {
    family: "sports-fixtures",
    visibleTag: "כדורסל",
    entities: ["winner-league"],
    aliases: ["Winner League", "ליגת ווינר", "כדורסל ישראלי"],
    geography: ["israel"]
  }
};

const EUROVISION_COUNTRY_EVIDENCE_KEYS: Record<string, string[]> = {
  "country:albania": ["albania", "אלבניה"],
  "country:australia": ["australia", "אוסטרליה"],
  "country:austria": ["austria", "אוסטריה"],
  "country:belgium": ["belgium", "בלגיה"],
  "country:bulgaria": ["bulgaria", "בולגריה"],
  "country:croatia": ["croatia", "קרואטיה"],
  "country:cyprus": ["cyprus", "קפריסין"],
  "country:czechia": ["czechia", "צ'כיה"],
  "country:denmark": ["denmark", "דנמרק"],
  "country:finland": ["finland", "פינלנד"],
  "country:france": ["france", "צרפת"],
  "country:germany": ["germany", "גרמניה"],
  "country:greece": ["greece", "יוון"],
  "country:israel": ["israel", "ישראל"],
  "country:italy": ["italy", "איטליה"],
  "country:lithuania": ["lithuania", "ליטא"],
  "country:malta": ["malta", "מלטה"],
  "country:moldova": ["moldova", "מולדובה"],
  "country:norway": ["norway", "נורווגיה"],
  "country:poland": ["poland", "פולין"],
  "country:romania": ["romania", "רומניה"],
  "country:serbia": ["serbia", "סרביה"],
  "country:sweden": ["sweden", "שוודיה"],
  "country:ukraine": ["ukraine", "אוקראינה"],
  "country:united-kingdom": ["united kingdom", "בריטניה", "הממלכה המאוחדת"]
};

function uniqueNonEmpty(values: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const trimmed = value?.trim();

    if (!trimmed) {
      continue;
    }

    const key = trimmed.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(trimmed);
  }

  return result;
}

function readCategoryVisibleTag(category: string | null | undefined): string | undefined {
  const key = category?.trim().toLowerCase();
  return key ? CATEGORY_VISIBLE_TAGS[key] : undefined;
}

function inferTaxonomyFamily(input: BuildMarketContractInput, sourceHints: SourceTaxonomyHint[]): string | undefined {
  if (sourceHints[0]?.family) {
    return sourceHints[0].family;
  }

  if (input.measurementKind === "rate_direction") {
    return "interest-rates";
  }

  if (input.category?.toLowerCase() === "sports") {
    return "sports-fixtures";
  }

  return input.category?.trim().toLowerCase() || undefined;
}

function buildMarketTaxonomy(input: BuildMarketContractInput): MarketTaxonomyV1 {
  const sourceIds = input.topSourceIds ?? [];
  const sourceHints = sourceIds.map((sourceId) => SOURCE_TAXONOMY_HINTS[sourceId]).filter(Boolean);
  const category = input.category?.trim().toLowerCase() || undefined;
  const family = inferTaxonomyFamily(input, sourceHints);
  const visibleTags = uniqueNonEmpty([
    readCategoryVisibleTag(category),
    sourceHints[0]?.visibleTag
  ]).slice(0, 3);
  const outcomeAliases = input.proposedOutcomes.flatMap((outcome) => [outcome.label, outcome.notes]);
  const sourceAliases = sourceHints.flatMap((hint) => hint.aliases);
  const entities = uniqueNonEmpty(sourceHints.flatMap((hint) => hint.entities));
  const geography = uniqueNonEmpty(sourceHints.flatMap((hint) => hint.geography ?? []));
  const aliases = uniqueNonEmpty([
    ...sourceAliases,
    input.measurementKind,
    input.resultShape,
    ...outcomeAliases
  ]).slice(0, 24);

  return {
    objectType: "market_taxonomy_v1",
    visibleTags,
    category,
    family,
    entities: entities.length ? entities : undefined,
    aliases: aliases.length ? aliases : undefined,
    sourceIds: sourceIds.length ? sourceIds : undefined,
    geography: geography.length ? geography : undefined,
    language: ["he", "en"],
    shape: input.marketForm
  };
}

function isIfaResolutionSource(sourceIds: string[] | undefined): boolean {
  return sourceIds?.includes("src_ifa_fixtures_results") ?? false;
}

function extractFirstUrl(value: string | undefined): string | null {
  return value?.match(/https?:\/\/\S+/)?.[0]?.replace(/[),.;]+$/, "") ?? null;
}

function parseCloseAtFromShape(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const match = value.match(/([A-Za-z]+ \d{1,2}, 20\d{2})(?: at (\d{1,2}:\d{2}))?/);

  if (!match?.[1]) {
    return null;
  }

  const parsed = new Date(match[2] ? `${match[1]} ${match[2]} UTC` : `${match[1]} UTC`);

  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function shouldUseNamedOpponentBinaryPresentation(input: BuildMarketContractInput): boolean {
  return (
    (input.marketForm === "binary" ||
      input.marketForm === "multi-outcome" ||
      input.resultShape === "home_away_winner") &&
    input.proposedOutcomes.length === 2 &&
    input.proposedOutcomes.every((outcome) => outcome.kind === "named-outcome") &&
    !input.proposedOutcomes.some((outcome) => ["כן", "לא", "yes", "no"].includes(outcome.label.trim().toLowerCase()))
  );
}

function buildDisplayHints(input: BuildMarketContractInput): MarketContractV1["displayHints"] | undefined {
  if (!shouldUseNamedOpponentBinaryPresentation(input)) {
    return undefined;
  }

  const [affirmative, negative] = input.proposedOutcomes;

  return {
    binaryPresentation: "named_opponents",
    affirmativeLabel: affirmative?.label,
    negativeLabel: negative?.label,
    notes: ["Render the binary ticket as named opponents, not yes/no copy."]
  };
}

function buildOutcomeResolutionPath(
  input: BuildMarketContractInput,
  outcome: ProposedOutcome,
  index: number
): string {
  const label = outcome.label.trim();
  const marketForm = input.marketForm;

  if (shouldUseNamedOpponentBinaryPresentation(input)) {
    return `התוצאה זוכה אם ${label} היא המנצחת הרשמית בתוצאה הסופית.`;
  }

  if (marketForm === "date-bucket") {
    return `התוצאה זוכה אם זה חלון הזמן הראשון שמתקיים לפי חוקי ההכרעה: ${label}`;
  }

  if (marketForm === "threshold") {
    return `התוצאה זוכה אם הערך הנמדד נמצא בסף הזה לפי חוקי ההכרעה: ${label}`;
  }

  if (marketForm === "range") {
    return `התוצאה זוכה אם הערך הנמדד נמצא בטווח הזה לפי חוקי ההכרעה: ${label}`;
  }

  if (marketForm === "binary") {
    return index === 0
      ? `התוצאה זוכה אם חוקי ההכרעה מתקיימים עבור: ${label}`
      : `התוצאה זוכה אם חוקי ההכרעה אינם מתקיימים או שהצד הנגדי מוכרע כזוכה: ${label}`;
  }

  return `התוצאה זוכה אם התוצאה הרשמית הסופית תואמת את האפשרות הזו: ${label}`;
}

function normalizeLabel(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function inferEurovisionCountryEvidenceKey(label: string): string | undefined {
  const normalized = normalizeLabel(label);
  const match = Object.entries(EUROVISION_COUNTRY_EVIDENCE_KEYS).find(([, aliases]) =>
    aliases.some((alias) => normalized === normalizeLabel(alias))
  );

  return match?.[0];
}

function inferEvidenceKey(
  input: BuildMarketContractInput,
  outcome: ProposedOutcome,
  index: number
): string | undefined {
  const normalized = outcome.label.trim().toLowerCase();

  if (input.topSourceIds?.includes("src_eurovision_official") && input.marketForm === "multi-outcome") {
    return inferEurovisionCountryEvidenceKey(outcome.label);
  }

  if (normalized.includes("ללא שינוי") || normalized.includes("no change") || normalized.includes("hold")) {
    return "hold";
  }

  if (normalized.includes("ירידה") || normalized.includes("decrease") || normalized.includes("cut")) {
    if (normalized.includes("0.50") || normalized.includes("50+")) {
      return "cut-050-plus";
    }

    if (normalized.includes("0.25") || normalized.includes("25")) {
      return "cut-025";
    }

    return "cut";
  }

  if (normalized.includes("עלייה") || normalized.includes("increase") || normalized.includes("hike")) {
    if (normalized.includes("0.50") || normalized.includes("50+")) {
      return "hike-050-plus";
    }

    if (normalized.includes("0.25") || normalized.includes("25")) {
      return "hike-025";
    }

    return "hike";
  }

  if (normalized.includes("תיקו") || normalized.includes("draw")) {
    return "draw";
  }

  if (input.marketForm === "binary" || input.marketForm === "threshold") {
    return index === 0 ? "yes" : "no";
  }

  if (input.marketForm === "range" || input.marketForm === "multi-outcome") {
    const numbers = [...normalized.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((match) =>
      match[0].replace(/,/g, "")
    );

    if ((normalized.includes("מתחת") || normalized.includes("below") || normalized.includes("under")) && numbers[0]) {
      return `below-${numbers[0]}`;
    }

    if ((normalized.includes("מעל") || normalized.includes("above") || normalized.includes("over")) && numbers[0]) {
      return `above-${numbers[0]}`;
    }

    if (numbers.length >= 2 && numbers[0] && numbers[1]) {
      return `range-${numbers[0]}-${numbers[1]}`;
    }
  }

  return undefined;
}

const SOURCE_LABELS_HE: Record<string, string> = {
  src_boi_announcements: "פרסומי בנק ישראל",
  src_boi_exchange_rates: "שערים יציגים של בנק ישראל",
  src_coinbase_exchange_candles: "נתוני מסחר של Coinbase",
  src_credible_reporting_bundle: "דיווחים מאומתים ממקורות עצמאיים",
  src_fiba_basketball_games: "אתר FIBA הרשמי",
  src_ifa_fixtures_results: "אתר ההתאחדות לכדורגל בישראל",
  src_ims_daily_observations: "נתוני השירות המטאורולוגי",
  src_nba_official_games: "אתר ה-NBA הרשמי",
  src_nike_liga_official: "אתר הליגה הרשמי",
  src_tradingview_fx: "נתוני מט״ח",
  src_winner_league_basketball: "מנהלת ליגת Winner סל"
};

function inferResolutionSourceLabelForSources(
  anchor: string | undefined,
  sourceRolePlan: SourceRolePlan | undefined,
  sourceIds: readonly string[]
): string {
  for (const sourceId of sourceIds) {
    const label = SOURCE_LABELS_HE[sourceId];

    if (label) {
      return label;
    }
  }

  const raw = anchor?.trim() || sourceRolePlan?.resolve[0]?.trim() || "";
  const withoutUrl = raw.replace(/https?:\/\/\S+/g, "").replace(/[:：]\s*$/, "").trim();

  return withoutUrl || "מקור הכרעה רשמי";
}

function countDistinctUrls(values: (string | undefined)[]): number {
  const urls = values
    .flatMap((value) => value?.match(/https?:\/\/[^\s)]+/gi) ?? [])
    .map((url) => url.replace(/[),.;]+$/, ""))
    .map((url) => {
      try {
        const parsed = new URL(url);
        return `${parsed.hostname}${parsed.pathname}`.toLowerCase().replace(/\/+$/, "");
      } catch {
        return url.toLowerCase().replace(/[#?].*$/, "").replace(/\/+$/, "");
      }
    });

  return new Set(urls).size;
}

function inferResolutionAuthorityType(
  input: BuildMarketContractInput,
  resolutionSourceUrl: string | null
): ResolutionAuthorityType {
  if (input.resolutionAuthorityType) {
    return input.resolutionAuthorityType;
  }

  const sourceIds = input.topSourceIds ?? [];
  const hasOfficialSource = sourceIds.some((sourceId) => OFFICIAL_RESOLUTION_SOURCE_IDS.has(sourceId));
  const onlyAttentionSources =
    sourceIds.length > 0 && sourceIds.every((sourceId) => ATTENTION_ONLY_SOURCE_IDS.has(sourceId));
  const haystack = [
    input.suggestedResolutionAnchor,
    input.sourceRolePlan?.resolve.join(" "),
    input.resolutionRule,
    resolutionSourceUrl ?? ""
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (hasOfficialSource && !onlyAttentionSources) {
    return "official";
  }

  if (haystack.includes("portwatch") || haystack.includes("imf") || haystack.includes("dataset") || haystack.includes("index")) {
    return "canonical-data";
  }

  if (
    countDistinctUrls([
      input.suggestedResolutionAnchor,
      input.resolutionRule,
      ...(input.sourceRolePlan?.resolve ?? []),
      ...(input.topSourceRefs ?? [])
    ]) >= 2
  ) {
    return "credible-reporting";
  }

  return "platform-defined";
}

function resolveReviewBlockers(
  input: BuildMarketContractInput,
  resolutionSourceUrl: string | null,
  resolutionRule: string,
  measurement: string
): MarketContractBlocker[] {
  const blockers: MarketContractBlocker[] = [];

  if (!measurement.trim()) {
    blockers.push("missing-measurement");
  }

  if (!input.suggestedCloseShape?.trim()) {
    blockers.push("missing-close-shape");
  }

  if (!input.suggestedResolutionAnchor?.trim() && !(input.sourceRolePlan?.resolve.length ?? 0)) {
    blockers.push("missing-resolution-source");
  }

  if (!resolutionSourceUrl) {
    blockers.push("missing-source-url");
  }

  if (!resolutionRule.trim()) {
    blockers.push("missing-resolution-rule");
  }

  if (input.proposedOutcomes.length === 0) {
    blockers.push("missing-outcome-map");
  }

  if ((input.fetchNeeds?.length ?? 0) > 0) {
    blockers.push("fetch-needs-open");
  }

  return blockers;
}

export function buildMarketContractV1(input: BuildMarketContractInput): MarketContractV1 {
  const resolutionSourceUrl =
    extractFirstUrl(input.suggestedResolutionAnchor) ??
    input.sourceRolePlan?.resolve.map(extractFirstUrl).find((value): value is string => Boolean(value)) ??
    null;
  const measurement = input.measurement?.trim() || input.question.trim();
  const resolutionRule =
    input.resolutionRule?.trim() ||
    input.suggestedResolutionAnchor?.trim() ||
    input.sourceRolePlan?.resolve[0]?.trim() ||
    "";

  return {
    objectType: "market_contract_v1",
    version: "seer-contract-v1",
    marketKindId: input.marketKindId,
    measurement,
    measurementKind: input.measurementKind,
    resultShape: input.resultShape,
    oracleCapability: input.oracleCapability,
    lifecycleFit: isIfaResolutionSource(input.topSourceIds) ? "event_full_cycle" : undefined,
    allowFallbackResolution: isIfaResolutionSource(input.topSourceIds) ? true : undefined,
    fallbackEvidenceStandard: isIfaResolutionSource(input.topSourceIds) ? IFA_FALLBACK_EVIDENCE_STANDARD : undefined,
    displayHints: buildDisplayHints(input),
    resolutionAuthorityType: inferResolutionAuthorityType(input, resolutionSourceUrl),
    resolutionSource: {
      label: inferResolutionSourceLabelForSources(
        input.suggestedResolutionAnchor,
        input.sourceRolePlan,
        input.topSourceIds ?? []
      ),
      url: resolutionSourceUrl,
      sourceIds: input.topSourceIds?.length ? input.topSourceIds : undefined
    },
    resolutionRule,
    timeline: {
      closeShape: input.suggestedCloseShape?.trim() || "",
      closeAt: parseCloseAtFromShape(input.suggestedCloseShape),
      expectedResolutionAt: input.expectedResolutionAt ?? undefined,
      timezone: input.suggestedCloseShape?.includes(" at ") ? "UTC" : "unknown",
      notes: input.suggestedCloseShape ? undefined : ["Timeline must be supplied before active review."]
    },
    outcomeMap: input.proposedOutcomes.map((outcome, index) => ({
      outcomeLabel: outcome.label,
      outcomeKind: outcome.kind,
      resolutionPath: buildOutcomeResolutionPath(input, outcome, index),
      evidenceKey: inferEvidenceKey(input, outcome, index)
    })),
    delayPolicy:
      input.delayPolicy?.trim() ||
      "אם המקור הרשמי מתעכב או לא ברור, השוק נשאר בהמתנה עד שמפעיל מאמת את התוצאה הרשמית.",
    payoutPolicy:
      input.payoutPolicy?.trim() ||
      "התשלום מתבצע רק לאחר שהמקור הרשמי מפרסם תוצאה, מפעיל מאשר את ההכרעה, והשוק מסומן כנפתר.",
    dataRevisionPolicy:
      input.marketForm === "date-bucket" || input.marketForm === "threshold"
        ? "Use the latest official data published inside the market timeframe unless the contract states a stricter revision cutoff."
        : undefined,
    ambiguityPolicy: input.topRisks?.length ? input.topRisks.join(" | ") : undefined,
    image: curateMarketImage({
      question: input.question,
      category: input.category,
      sourceIds: input.topSourceIds,
      sourceRolePlan: input.sourceRolePlan,
      suggestedResolutionAnchor: input.suggestedResolutionAnchor,
      proposedOutcomes: input.proposedOutcomes
    }),
    taxonomy: buildMarketTaxonomy(input),
    reviewBlockers: resolveReviewBlockers(input, resolutionSourceUrl, resolutionRule, measurement),
    sourceRolePlan: input.sourceRolePlan
  };
}
