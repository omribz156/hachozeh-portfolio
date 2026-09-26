export const MARKET_KEY_TO_MARKET_ID: Record<string, string> = {
  "bank-israel-mar-18": "market_seed_1",
  "mar-18": "market_seed_1",
  "next-prime-minister": "market_seed_next_prime_minister"
};

export const MARKET_KEY_TO_FIXTURE_KEY: Record<string, string> = {
  "bank-israel-mar-18": "mar-18",
  "bank-israel-apr-29": "apr-29",
  "bank-israel-jun-17": "jun-17",
  "mar-18": "mar-18",
  "apr-29": "apr-29",
  "jun-17": "jun-17"
};

const OUTCOME_ID_TO_PAGE_KEY: Record<string, string> = {
  market_seed_1_outcome_hold: "hold",
  market_seed_1_outcome_cut_025: "cut-025",
  market_seed_1_outcome_cut_050_plus: "cut-050-plus",
  market_seed_1_outcome_hike: "hike",
  market_seed_next_prime_minister_outcome_option_a: "option-a",
  market_seed_next_prime_minister_outcome_option_b: "option-b",
  market_seed_next_prime_minister_outcome_option_c: "option-c",
  market_seed_next_prime_minister_outcome_option_d: "option-d"
};

export function resolvePassiveOutcomeKey(outcomeId: string): string {
  return OUTCOME_ID_TO_PAGE_KEY[outcomeId] ?? outcomeId;
}
