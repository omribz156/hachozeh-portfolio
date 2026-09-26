import { describe, expect, it } from "vitest";

import {
  normalizeContractExecution
} from "../../src/engine/contract-side-normalization";

describe("contract-side normalization", () => {
  it("maps binary no to the opposite outcome", () => {
    const resolution = normalizeContractExecution({
      marketKey: "binary-market",
      requestedOutcomeKey: "yes-outcome",
      contractSide: "no",
      marketRows: [
        { outcome_id: "yes-outcome" },
        { outcome_id: "no-outcome" }
      ]
    });

    expect(resolution).toEqual({
      contractSide: "no",
      requestedOutcomeKey: "yes-outcome",
      requestedOutcomeId: "yes-outcome",
      executionOutcomeKey: "no-outcome",
      executionOutcomeId: "no-outcome",
      executionLegs: [
        {
          outcomeKey: "no-outcome",
          outcomeId: "no-outcome"
        }
      ]
    });
  });

  it("maps multi-outcome no to complement execution legs", () => {
    const resolution = normalizeContractExecution({
      marketKey: "next-prime-minister",
      requestedOutcomeKey: "option-a",
      contractSide: "no",
      marketRows: [
        { outcome_id: "market_seed_next_prime_minister_outcome_option_a" },
        { outcome_id: "market_seed_next_prime_minister_outcome_option_b" },
        { outcome_id: "market_seed_next_prime_minister_outcome_option_c" }
      ]
    });

    expect(resolution).toEqual({
      contractSide: "no",
      requestedOutcomeKey: "option-a",
      requestedOutcomeId: "market_seed_next_prime_minister_outcome_option_a",
      executionOutcomeKey: null,
      executionOutcomeId: null,
      executionLegs: [
        {
          outcomeKey: "option-b",
          outcomeId: "market_seed_next_prime_minister_outcome_option_b"
        },
        {
          outcomeKey: "option-c",
          outcomeId: "market_seed_next_prime_minister_outcome_option_c"
        }
      ]
    });
  });
});
