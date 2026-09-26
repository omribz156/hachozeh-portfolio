import type { ExternalPlatform, ManualSeerSignal, MarketForm, PlatformShapeExample, PlatformShapeSnapshot } from "./contracts";
import { compactWhitespace } from "./text";

export const POLYMARKET_SOURCE_ID = "src_polymarket_market_reference";
export const POLYMARKET_MARKETS_URL = "https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=12";
export const POLYMARKET_SITE_URL = "https://polymarket.com/";

export const KALSHI_SOURCE_ID = "src_kalshi_market_reference";
export const KALSHI_MARKETS_URL = "https://api.elections.kalshi.com/trade-api/v2/markets?limit=12";
export const KALSHI_EVENTS_URL = "https://api.elections.kalshi.com/trade-api/v2/events?limit=12";
export const KALSHI_SITE_URL = "https://kalshi.com/";

type PolymarketMarket = {
  id: string | number;
  question?: string;
  endDate?: string;
  category?: string;
  volume?: string | number;
  liquidity?: string | number;
  slug?: string;
};

type KalshiMarket = {
  ticker?: string;
  title?: string;
  subtitle?: string;
  close_time?: string;
  volume?: number;
  open_interest?: number;
};

type ReferenceContractPattern = NonNullable<PlatformShapeExample["contractPattern"]>;

type KalshiEvent = {
  event_ticker?: string;
  title?: string;
  category?: string;
  sub_title?: string;
};

function isCleanReferenceTitle(title: string): boolean {
  const normalized = title.trim();

  if (normalized.length === 0) {
    return false;
  }

  if (/^(will|who|which|what)\b/i.test(normalized)) {
    return true;
  }

  if (normalized.includes(",") && normalized.split(",").length > 2) {
    return false;
  }

  if (/^(yes|no)\b/i.test(normalized)) {
    return false;
  }

  return normalized.split(" ").length >= 4;
}

function inferMarketForm(title: string): MarketForm {
  const normalized = title.trim().toLowerCase();

  if (normalized.startsWith("will ")) {
    if (/\bbetween\b|\bover\b|\bunder\b|\bmore than\b|\bless than\b/.test(normalized)) {
      return "threshold";
    }

    return "binary";
  }

  if (normalized.startsWith("which ") || normalized.startsWith("who ")) {
    return "multi-outcome";
  }

  if (normalized.startsWith("what will ")) {
    if (/\bhit\b|\bclose at\b|\bbe\b|\bsettle\b/.test(normalized)) {
      return "range";
    }

    return "threshold";
  }

  if (/\bbetween\b|\bover\b|\bunder\b|\bmore than\b|\bless than\b/.test(normalized)) {
    return "threshold";
  }

  return "binary";
}

function inferFamilyHint(title: string, category: string | undefined): string {
  const normalized = `${title} ${category ?? ""}`.toLowerCase();

  if (/\bfed\b|federal reserve|interest|rate|cpi|inflation|gdp|unemployment/.test(normalized)) {
    return "macro/rates";
  }

  if (/iran|israel|russia|ukraine|taiwan|china|war|ceasefire|military|invasion|geopolitics|security/.test(normalized)) {
    return "geopolitics/security";
  }

  if (/pope|election|candidate|nomination|president|mayor|senate|winner/.test(normalized)) {
    return "election/winner";
  }

  if (/\btemp\b|temperature|weather|\brain\b|\bsnow\b|climate|hurricane/.test(normalized)) {
    return "weather/climate";
  }

  if (/nba|nfl|mlb|nhl|fifa|soccer|game|match|score|runs|goals|bases/.test(normalized)) {
    return "sports";
  }

  if (/bitcoin|btc|ethereum|crypto|oil|wti|stock|nasdaq|s&p|dow/.test(normalized)) {
    return "markets/commodities";
  }

  if (/album|movie|video|celebrity|gta|oscar|grammy|mrbeast/.test(normalized)) {
    return "culture/attention";
  }

  return "world/event";
}

function inferContractPattern(input: {
  title: string;
  category?: string;
  marketForm: MarketForm;
  closeTime?: string;
  platform: ExternalPlatform;
}): ReferenceContractPattern {
  const normalized = `${input.title} ${input.category ?? ""}`.toLowerCase();

  if (/^(yes|no)\b/.test(normalized) || (normalized.includes(",") && normalized.split(",").length > 2)) {
    return "combo-noise";
  }

  if (input.marketForm === "multi-outcome") {
    return "multi-market-event";
  }

  if (
    input.closeTime &&
    /\bfed\b|federal reserve|cpi|rate|\btemp\b|temperature|weather|daily|monthly|meeting/.test(normalized)
  ) {
    return "recurring-template";
  }

  return "standard-contract";
}

function toVolumeHint(value?: string | number): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return String(value);
}

function buildShapeExample(input: {
  platform: ExternalPlatform;
  exampleId: string;
  title: string;
  category?: string;
  closeTime?: string;
  marketUrl?: string;
  sourceRef: string;
  volumeHint?: string;
  openInterestHint?: string;
  notes?: string[];
}): PlatformShapeExample {
  const marketForm = inferMarketForm(input.title);
  const contractPattern = inferContractPattern({
    platform: input.platform,
    title: input.title,
    category: input.category,
    marketForm,
    closeTime: input.closeTime
  });
  const familyHint = inferFamilyHint(input.title, input.category);

  return {
    objectType: "platform_shape_example",
    platform: input.platform,
    exampleId: input.exampleId,
    title: compactWhitespace(input.title),
    category: input.category ? compactWhitespace(input.category) : undefined,
    marketForm,
    referenceLane: "reference-shapes",
    contractPattern,
    familyHint,
    qualityNotes: [
      contractPattern === "combo-noise"
        ? "Combo/MVE shape: useful as a noise warning, not a creation target."
        : "Reference-only craft sample: learn wording/rule shape, not truth."
    ],
    closeTime: input.closeTime,
    marketUrl: input.marketUrl,
    sourceRef: input.sourceRef,
    volumeHint: input.volumeHint,
    openInterestHint: input.openInterestHint,
    notes: input.notes?.map((note) => compactWhitespace(note)).filter((note) => note.length > 0)
  };
}

export function parsePolymarketShapeSnapshot(json: string, generatedAt: string): PlatformShapeSnapshot {
  const parsed = JSON.parse(json) as PolymarketMarket[];
  const examples = parsed
    .filter((item) => item.question?.trim())
    .slice(0, 8)
    .map((item) =>
      buildShapeExample({
        platform: "polymarket",
        exampleId: `poly_${item.id}`,
        title: item.question!,
        category: item.category,
        closeTime: item.endDate,
        marketUrl: item.slug ? `${POLYMARKET_SITE_URL}event/${item.slug}` : undefined,
        sourceRef: item.slug ? `${POLYMARKET_SITE_URL}event/${item.slug}` : POLYMARKET_MARKETS_URL,
        volumeHint: toVolumeHint(item.volume),
        openInterestHint: toVolumeHint(item.liquidity),
        notes: ["Reference-only shape sample from Polymarket active markets."]
      })
    );

  return {
    objectType: "platform_shape_snapshot",
    platform: "polymarket",
    generatedAt,
    sourceId: POLYMARKET_SOURCE_ID,
    fetchUrl: POLYMARKET_MARKETS_URL,
    exampleCount: examples.length,
    examples,
    notes: ["Use for market-form bias and wording patterns, not as a truth anchor."]
  };
}

export function parseKalshiShapeSnapshot(marketsJson: string, eventsJson: string, generatedAt: string): PlatformShapeSnapshot {
  const marketsParsed = JSON.parse(marketsJson) as { markets?: KalshiMarket[] };
  const eventsParsed = JSON.parse(eventsJson) as { events?: KalshiEvent[] };
  const examples: PlatformShapeExample[] = [];

  for (const event of eventsParsed.events ?? []) {
    if (!event.title?.trim() || !isCleanReferenceTitle(event.title) || examples.length >= 5) {
      continue;
    }

    examples.push(
      buildShapeExample({
        platform: "kalshi",
        exampleId: `kalshi_event_${event.event_ticker ?? examples.length + 1}`,
        title: event.title,
        category: event.category,
        marketUrl: event.event_ticker ? `${KALSHI_SITE_URL}event/${event.event_ticker}` : undefined,
        sourceRef: event.event_ticker ? `${KALSHI_SITE_URL}event/${event.event_ticker}` : KALSHI_EVENTS_URL,
        notes: [event.sub_title ? `Subtitle: ${event.sub_title}` : "Reference-only shape sample from Kalshi public event data."]
      })
    );
  }

  for (const market of marketsParsed.markets ?? []) {
    if (!market.title?.trim() || !isCleanReferenceTitle(market.title) || examples.length >= 8) {
      continue;
    }

    examples.push(
      buildShapeExample({
        platform: "kalshi",
        exampleId: `kalshi_market_${market.ticker ?? examples.length + 1}`,
        title: market.title,
        closeTime: market.close_time,
        marketUrl: market.ticker ? `${KALSHI_SITE_URL}markets/${market.ticker}` : undefined,
        sourceRef: market.ticker ? `${KALSHI_SITE_URL}markets/${market.ticker}` : KALSHI_MARKETS_URL,
        volumeHint: toVolumeHint(market.volume),
        openInterestHint: toVolumeHint(market.open_interest),
        notes: [market.subtitle ? `Subtitle: ${market.subtitle}` : "Reference-only shape sample from Kalshi public market data."]
      })
    );
  }

  return {
    objectType: "platform_shape_snapshot",
    platform: "kalshi",
    generatedAt,
    sourceId: KALSHI_SOURCE_ID,
    fetchUrl: KALSHI_MARKETS_URL,
    exampleCount: examples.length,
    examples,
    notes: [
      "Use Kalshi API output for shape bias and category mirrors.",
      "Kalshi combo/MVE markets are intentionally filtered from the default craft sample.",
      "Do not scrape kalshi.com homepage from runtime; use the API door."
    ]
  };
}

export async function fetchPolymarketShapeSnapshot(
  generatedAt: string,
  fetchImpl: typeof fetch = fetch
): Promise<PlatformShapeSnapshot> {
  const response = await fetchImpl(POLYMARKET_MARKETS_URL, {
    headers: {
      "user-agent": "NaviSeerReference/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Polymarket reference fetch failed: ${response.status} ${response.statusText}`);
  }

  return parsePolymarketShapeSnapshot(await response.text(), generatedAt);
}

export async function fetchKalshiShapeSnapshot(
  generatedAt: string,
  fetchImpl: typeof fetch = fetch
): Promise<PlatformShapeSnapshot> {
  const [marketsResponse, eventsResponse] = await Promise.all([
    fetchImpl(KALSHI_MARKETS_URL, {
      headers: { "user-agent": "NaviSeerReference/1.0" }
    }),
    fetchImpl(KALSHI_EVENTS_URL, {
      headers: { "user-agent": "NaviSeerReference/1.0" }
    })
  ]);

  if (!marketsResponse.ok) {
    throw new Error(`Kalshi markets fetch failed: ${marketsResponse.status} ${marketsResponse.statusText}`);
  }

  if (!eventsResponse.ok) {
    throw new Error(`Kalshi events fetch failed: ${eventsResponse.status} ${eventsResponse.statusText}`);
  }

  return parseKalshiShapeSnapshot(await marketsResponse.text(), await eventsResponse.text(), generatedAt);
}

export function toPlatformReferenceSignals(snapshot: PlatformShapeSnapshot): ManualSeerSignal[] {
  return snapshot.examples.map((example) => ({
    objectType: "manual_seer_signal",
    signalId: `msig_${snapshot.platform}_${example.exampleId}_${generatedAtKey(snapshot.generatedAt)}`,
    sourceId: snapshot.sourceId,
    title: example.title,
    summary: `${capitalizePlatform(example.platform)} reference market shape: ${example.marketForm}.`,
    category: example.category?.toLowerCase() || "general",
    whyNow: `${capitalizePlatform(example.platform)} currently carries this market shape in its live public market data.`,
    observedAt: example.closeTime || snapshot.generatedAt,
    importedAt: snapshot.generatedAt,
    sourceRef: example.sourceRef,
    sourceLabel: `${capitalizePlatform(example.platform)} market reference`,
    clusterHint: `reference_${example.platform}_${example.marketForm}`,
    lineageHint: `reference_${example.platform}_${example.marketForm}`,
    keyEntities: [capitalizePlatform(example.platform), example.title],
    notes: [
      `Reference-only example. marketForm=${example.marketForm}`,
      `Reference lane: ${example.referenceLane ?? "reference-shapes"}`,
      example.contractPattern ? `Contract pattern: ${example.contractPattern}` : undefined,
      example.familyHint ? `Family hint: ${example.familyHint}` : undefined,
      ...(example.notes ?? [])
    ].filter((note): note is string => Boolean(note)),
    tags: [
      "reference-shape",
      example.platform,
      example.marketForm,
      example.contractPattern ?? "standard-contract",
      example.familyHint ?? "world/event"
    ],
    question: example.title,
    marketAngle: `${capitalizePlatform(example.platform)} live market wording reference`,
    marketForm: example.marketForm,
    marketWorthiness: "Reference-only external market shape sample.",
    resolutionFeasibility: "Do not treat this as a Navi candidate by default; use for wording and form bias only."
  }));
}

function capitalizePlatform(value: ExternalPlatform): string {
  return value === "kalshi" ? "Kalshi" : "Polymarket";
}

function generatedAtKey(value: string): string {
  return value.replace(/[:.]/g, "").replace(/-/g, "");
}
