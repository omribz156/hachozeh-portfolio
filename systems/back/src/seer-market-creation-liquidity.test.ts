import { describe, expect, it } from "vitest";

import {
  buildCreateMarketDraftRequestFromSeerDraft,
  resolveSeerDraftLiquidityB,
  type SeerMarketCreationDraft
} from "./lifecycle/management/seer-market-creation-service";

function draft(overrides: Partial<SeerMarketCreationDraft> = {}): SeerMarketCreationDraft {
  return {
    objectType: "market_creation_draft",
    creationDraftId: "mcd_boi_test",
    reviewItemId: "rh_boi_test",
    candidateMarketId: "boi-rate-decision-test",
    familyKey: "boi-rate-decision-v1",
    eventId: "event-boi-rate-decision-test",
    eventSlug: "boi-rate-decision-test",
    category: "economy",
    categoryKey: "economy",
    title: "החלטת הריבית של בנק ישראל",
    description: null,
    openAt: "2026-07-01T09:00:00.000Z",
    closeAt: "2026-07-06T13:00:00.000Z",
    resolutionSource: "בנק ישראל, הודעת הריבית הרשמית",
    resolutionRules: "השוק מוכרע לפי הודעת הריבית הרשמית של בנק ישראל.",
    contract: {
      objectType: "market_contract_v1",
      version: "seer-contract-v1",
      measurementKind: "rate_direction",
      resultShape: "cut_hold_hike",
      oracleCapability: "supported_final_only",
      sourceIds: ["src_boi_announcements"],
      rules: []
    },
    oracleSourcePolicy: null,
    liquidityB: "5000.00000000",
    closeOnEventCompletion: false,
    eventCompletionCloseRequiresHumanApproval: false,
    outcomes: [
      { outcomeId: null, label: "הורדת ריבית של 0.50 נק׳ ומעלה", shortLabel: null, description: null, colorKey: null },
      { outcomeId: null, label: "הורדת ריבית של 0.25 נק׳", shortLabel: null, description: null, colorKey: null },
      { outcomeId: null, label: "ללא שינוי", shortLabel: null, description: null, colorKey: null },
      { outcomeId: null, label: "העלאת ריבית של 0.25 נק׳", shortLabel: null, description: null, colorKey: null },
      { outcomeId: null, label: "העלאת ריבית של 0.50 נק׳ ומעלה", shortLabel: null, description: null, colorKey: null }
    ],
    idempotencyKey: "seer-create:boi-rate-decision-test",
    whyNow: "Regression test",
    createdAt: "2026-07-01T09:00:00.000Z",
    ...overrides
  };
}

describe("Seer market creation liquidity", () => {
  it("keeps Seer planning effective while create-market owns the write-time scaling", () => {
    const candidate = draft();

    expect(resolveSeerDraftLiquidityB(candidate)).toBe("12500.00000000");
    expect(buildCreateMarketDraftRequestFromSeerDraft(candidate).liquidityB).toBe("5000.00000000");
  });
});
