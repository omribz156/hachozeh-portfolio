type MarketIdentity = {
  canonicalMarketKey: string;
  marketId: string;
  acceptedMarketKeys: string[];
  outcomeKeyToOutcomeId: Record<string, string>;
};

const MARKET_IDENTITIES: MarketIdentity[] = [
  {
    canonicalMarketKey: "bank-israel-mar-18",
    marketId: "market_seed_1",
    acceptedMarketKeys: ["bank-israel-mar-18", "mar-18"],
    outcomeKeyToOutcomeId: {
      hold: "market_seed_1_outcome_hold",
      "cut-025": "market_seed_1_outcome_cut_025",
      "cut-050-plus": "market_seed_1_outcome_cut_050_plus",
      hike: "market_seed_1_outcome_hike"
    }
  },
  {
    canonicalMarketKey: "next-prime-minister",
    marketId: "market_seed_next_prime_minister",
    acceptedMarketKeys: ["next-prime-minister"],
    outcomeKeyToOutcomeId: {
      "option-a": "market_seed_next_prime_minister_outcome_option_a",
      "option-b": "market_seed_next_prime_minister_outcome_option_b",
      "option-c": "market_seed_next_prime_minister_outcome_option_c",
      "option-d": "market_seed_next_prime_minister_outcome_option_d"
    }
  }
];

const MARKET_KEY_INDEX = new Map<string, MarketIdentity>();
const MARKET_ID_TO_CANONICAL_KEY = new Map<string, string>();
const OUTCOME_ID_TO_OUTCOME_KEY = new Map<string, string>();

for (const identity of MARKET_IDENTITIES) {
  MARKET_ID_TO_CANONICAL_KEY.set(identity.marketId, identity.canonicalMarketKey);

  for (const marketKey of identity.acceptedMarketKeys) {
    MARKET_KEY_INDEX.set(marketKey, identity);
  }

  for (const [outcomeKey, outcomeId] of Object.entries(identity.outcomeKeyToOutcomeId)) {
    OUTCOME_ID_TO_OUTCOME_KEY.set(outcomeId, outcomeKey);
  }
}

export function resolveMarketIdentity(marketKey: string): MarketIdentity | null {
  const resolvedIdentity = MARKET_KEY_INDEX.get(marketKey);

  if (resolvedIdentity) {
    return resolvedIdentity;
  }

  if (!marketKey) {
    return null;
  }

  return {
    canonicalMarketKey: marketKey,
    marketId: marketKey,
    acceptedMarketKeys: [marketKey],
    outcomeKeyToOutcomeId: {}
  };
}

export function resolveCanonicalMarketKeyById(marketId: string): string | null {
  return MARKET_ID_TO_CANONICAL_KEY.get(marketId) ?? null;
}

export function resolveOutcomeId(
  marketKey: string,
  outcomeKey: string
): string | null {
  const marketIdentity = resolveMarketIdentity(marketKey);

  if (!marketIdentity) {
    return null;
  }

  return marketIdentity.outcomeKeyToOutcomeId[outcomeKey] ?? outcomeKey ?? null;
}

export function resolveOutcomeKey(outcomeId: string): string | null {
  return OUTCOME_ID_TO_OUTCOME_KEY.get(outcomeId) ?? null;
}
