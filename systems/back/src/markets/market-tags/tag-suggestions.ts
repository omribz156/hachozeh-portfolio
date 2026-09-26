export type MarketTagKind = "topic" | "person" | "org" | "event";

export type MarketTagDefinition = {
  slug: string;
  label: string;
  kind?: MarketTagKind;
};

export type SuggestedMarketTag = {
  def: MarketTagDefinition;
  weight: number;
};

export type MarketTagSuggestionInput = {
  id: string;
  title: string;
  categoryKey?: string | null;
  category_key?: string | null;
  marketFamilyKey?: string | null;
  market_family_key?: string | null;
};

const CATEGORY_TAGS: Record<string, MarketTagDefinition> = {
  crypto: { slug: "crypto", label: "קריפטו", kind: "topic" },
  culture: { slug: "entertainment", label: "בידור", kind: "topic" },
  economics: { slug: "economy", label: "כלכלה", kind: "topic" },
  economy: { slug: "economy", label: "כלכלה", kind: "topic" },
  education: { slug: "education", label: "חינוך", kind: "topic" },
  energy: { slug: "energy", label: "אנרגיה", kind: "topic" },
  entertainment: { slug: "entertainment", label: "בידור", kind: "topic" },
  fx: { slug: "fx", label: "מטבע חוץ", kind: "topic" },
  legislation: { slug: "legislation", label: "חקיקה", kind: "topic" },
  politics: { slug: "politics", label: "פוליטיקה", kind: "topic" },
  security: { slug: "security", label: "ביטחון", kind: "topic" },
  sports: { slug: "sports", label: "ספורט", kind: "topic" },
  technology: { slug: "technology", label: "טכנולוגיה", kind: "topic" },
  tech: { slug: "technology", label: "טכנולוגיה", kind: "topic" },
  transport: { slug: "transport", label: "תחבורה", kind: "topic" },
  travel: { slug: "travel", label: "תעופה", kind: "topic" },
  weather: { slug: "weather", label: "מזג אוויר", kind: "topic" },
  world: { slug: "world", label: "עולם", kind: "topic" }
};

const FAMILY_TAGS: Record<string, MarketTagDefinition[]> = {
  "boi-rate-decision-v1": [
    { slug: "bank-of-israel", label: "בנק ישראל", kind: "org" },
    { slug: "interest-rate", label: "ריבית", kind: "topic" }
  ],
  "lin-boi-rate-decisions": [
    { slug: "bank-of-israel", label: "בנק ישראל", kind: "org" },
    { slug: "interest-rate", label: "ריבית", kind: "topic" }
  ],
  "boi-exchange-rates": [
    { slug: "usd-ils", label: "שקל-דולר", kind: "topic" },
    { slug: "bank-of-israel", label: "בנק ישראל", kind: "org" }
  ],
  "economy-fx-threshold": [{ slug: "usd-ils", label: "שקל-דולר", kind: "topic" }],
  "live-fx-threshold-usd-ils-v1": [{ slug: "usd-ils", label: "שקל-דולר", kind: "topic" }],
  "economy.live-fx-price": [{ slug: "usd-ils", label: "שקל-דולר", kind: "topic" }],
  "israel-cpi-monthly-change-v1": [
    { slug: "cpi", label: "מדד המחירים", kind: "topic" },
    { slug: "inflation", label: "אינפלציה", kind: "topic" }
  ],
  "energy-israel-fuel-95-official-price": [
    { slug: "fuel-prices", label: "מחירי דלק", kind: "topic" }
  ],
  "energy-official-energy-value": [
    { slug: "energy-market", label: "שוק האנרגיה", kind: "topic" }
  ],
  "education-official-deadline-or-stat": [
    { slug: "education-deadlines", label: "מועדי חינוך", kind: "topic" }
  ],
  "eurovision-participation-v1": [{ slug: "eurovision", label: "אירוויזיון", kind: "event" }],
  "lin-eurovision-2026": [{ slug: "eurovision", label: "אירוויזיון", kind: "event" }],
  "entertainment-reality-show-result": [{ slug: "reality-tv", label: "ריאליטי", kind: "topic" }],
  "politics-israeli-election-result": [
    { slug: "elections", label: "בחירות", kind: "topic" },
    { slug: "knesset", label: "כנסת", kind: "org" }
  ],
  "politics-knesset-election-occurrence": [
    { slug: "elections", label: "בחירות", kind: "topic" },
    { slug: "knesset", label: "כנסת", kind: "org" }
  ],
  "israel-election-timing": [
    { slug: "elections", label: "בחירות", kind: "topic" },
    { slug: "knesset", label: "כנסת", kind: "org" }
  ],
  "lin-knesset-dissolution-2026": [
    { slug: "elections", label: "בחירות", kind: "topic" },
    { slug: "knesset", label: "כנסת", kind: "org" }
  ],
  "politics-official-vote-or-appointment": [{ slug: "knesset", label: "כנסת", kind: "org" }],
  "legislation-bill-deadline": [{ slug: "knesset", label: "כנסת", kind: "org" }],
  "security-direct-state-conflict": [
    { slug: "foreign-policy", label: "מדיניות חוץ", kind: "topic" }
  ],
  "sports-tournament-winner": [
    { slug: "world-cup-2026", label: "מונדיאל 2026", kind: "event" },
    { slug: "football", label: "כדורגל", kind: "topic" }
  ],
  "sports-goal-range": [{ slug: "football", label: "כדורגל", kind: "topic" }],
  "sports-regulation-3way": [{ slug: "football", label: "כדורגל", kind: "topic" }],
  "health-who-pandemic-declaration": [{ slug: "health", label: "בריאות", kind: "topic" }],
  "technology-startup-valuation": [
    { slug: "startups", label: "סטארטאפים", kind: "topic" },
    { slug: "unicorns", label: "יוניקורנים", kind: "topic" }
  ]
};

const KEYWORD_TAGS: { test: RegExp; tag: MarketTagDefinition }[] = [
  { test: /מונדיאל|גביע העולם/, tag: { slug: "world-cup-2026", label: "מונדיאל 2026", kind: "event" } },
  { test: /ביטקוין|BTC/i, tag: { slug: "bitcoin", label: "ביטקוין", kind: "topic" } },
  { test: /את'?ריום|אתריום|ETH/i, tag: { slug: "ethereum", label: "את׳ריום", kind: "topic" } },
  { test: /ריבית/, tag: { slug: "interest-rate", label: "ריבית", kind: "topic" } },
  { test: /בנק ישראל/, tag: { slug: "bank-of-israel", label: "בנק ישראל", kind: "org" } },
  { test: /אירוויזיון/, tag: { slug: "eurovision", label: "אירוויזיון", kind: "event" } },
  { test: /בחירות/, tag: { slug: "elections", label: "בחירות", kind: "topic" } },
  { test: /כנסת/, tag: { slug: "knesset", label: "כנסת", kind: "org" } },
  { test: /נתניהו/, tag: { slug: "netanyahu", label: "נתניהו", kind: "person" } },
  { test: /דלק/, tag: { slug: "fuel-prices", label: "מחירי דלק", kind: "topic" } },
  { test: /סטארטאפ|יוניקורן|unicorn|startup/i, tag: { slug: "startups", label: "סטארטאפים", kind: "topic" } }
];

const FIFA_MATCH_TAGS: MarketTagDefinition[] = [
  { slug: "world-cup-2026", label: "מונדיאל 2026", kind: "event" },
  { slug: "football", label: "כדורגל", kind: "topic" }
];

const EXCLUDED_CATEGORIES = new Set(["stress", "systems", "oracle-eol"]);
const JUNK_FAMILY = /^(gauntlet-sim|lin-|seer-2026|dedicated-graph-check|claim-path-test|credible-reporting|family-[0-9a-f]{6,})|graph-test|image-bucket|polykalshi/;
const WEIGHT = { category: 0, keyword: 5, family: 10 };

export function tagIdForSlug(slug: string): string {
  return `tag-${slug}`;
}

function normalizeInput(market: MarketTagSuggestionInput): {
  id: string;
  title: string;
  categoryKey: string | null;
  marketFamilyKey: string | null;
} {
  return {
    id: market.id,
    title: market.title,
    categoryKey: market.categoryKey ?? market.category_key ?? null,
    marketFamilyKey: market.marketFamilyKey ?? market.market_family_key ?? null
  };
}

export function isMarketTagEligible(market: MarketTagSuggestionInput): boolean {
  const normalized = normalizeInput(market);

  if (!normalized.categoryKey || EXCLUDED_CATEGORIES.has(normalized.categoryKey)) {
    return false;
  }

  if (normalized.marketFamilyKey && FAMILY_TAGS[normalized.marketFamilyKey]) {
    return true;
  }

  if (normalized.marketFamilyKey && JUNK_FAMILY.test(normalized.marketFamilyKey)) {
    return false;
  }

  return true;
}

export function suggestMarketTags(market: MarketTagSuggestionInput): SuggestedMarketTag[] {
  if (!isMarketTagEligible(market)) {
    return [];
  }

  const normalized = normalizeInput(market);
  const out = new Map<string, SuggestedMarketTag>();
  const add = (def: MarketTagDefinition, weight: number) => {
    const current = out.get(def.slug);

    if (!current || weight > current.weight) {
      out.set(def.slug, { def, weight });
    }
  };

  const categoryTag = normalized.categoryKey ? CATEGORY_TAGS[normalized.categoryKey] : undefined;
  if (categoryTag) {
    add(categoryTag, WEIGHT.category);
  }

  const familyTags = normalized.marketFamilyKey
    ? FAMILY_TAGS[normalized.marketFamilyKey]
    : undefined;
  if (familyTags) {
    for (const tag of familyTags) {
      add(tag, WEIGHT.family);
    }
  }

  if (normalized.marketFamilyKey === "sports-match-winner-v1" && /fifa/i.test(normalized.id)) {
    for (const tag of FIFA_MATCH_TAGS) {
      add(tag, WEIGHT.family);
    }
  }

  for (const { test, tag } of KEYWORD_TAGS) {
    if (test.test(normalized.title)) {
      add(tag, WEIGHT.keyword);
    }
  }

  return [...out.values()].sort((a, b) => b.weight - a.weight || a.def.slug.localeCompare(b.def.slug));
}
