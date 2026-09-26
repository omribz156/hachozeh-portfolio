import { describe, expect, it } from "vitest";

import { classifyMarketFamily } from "../../../seer/src/market-family-classifier";
import {
  resolveMarketKindIdForRecurringTemplate,
  validateSeededMarketFamilyRegistry
} from "../../../seer/src/market-family-registry";
import type { SourceRegistryEntry } from "../../../seer/src/contracts";

function sourceRegistryEntry(input: {
  sourceId: string;
  measurementKind: "final_winner" | "rate_direction" | "threshold_crossing";
  resultShape: "home_away_winner" | "cut_hold_hike" | "yes_no";
  oracleCapability:
    | "supported_full_cycle"
    | "supported_final_only"
    | "credible_reporting"
    | "manual_resolution_required";
}): SourceRegistryEntry {
  return {
    objectType: "source_registry_entry",
    sourceId: input.sourceId,
    label: input.sourceId,
    primaryClass: "authority",
    accessSurface: "html",
    status: "trusted",
    curationMode: "manual-seed",
    stageUsefulness: ["grounding", "review"],
    categoryFit: ["test"],
    createdAt: "2026-05-19T00:00:00.000Z",
    updatedAt: "2026-05-19T00:00:00.000Z",
    lifecycleCapabilities: [
      {
        measurementKind: input.measurementKind,
        resultShape: input.resultShape,
        oracleCapability: input.oracleCapability
      }
    ]
  };
}

describe("market family registry", () => {
  it("keeps recurring templates mapped to exactly one curated market kind", () => {
    expect(validateSeededMarketFamilyRegistry()).toEqual([]);
    expect(resolveMarketKindIdForRecurringTemplate("sports-match-winner-v1")).toBe("sports.game-winner");
    expect(resolveMarketKindIdForRecurringTemplate("boi-rate-decision-v1")).toBe("economy.central-bank-rate-decision");
  });

  it("classifies a supported sports game winner before draft creation", () => {
    const classification = classifyMarketFamily(
      {
        category: "sports",
        question: "מי תנצח: מכבי רעננה או נס ציונה?",
        marketForm: "binary",
        recurringTemplateId: "sports-match-winner-v1",
        sourceIds: ["src_winner_league_basketball"]
      },
      [
        sourceRegistryEntry({
          sourceId: "src_winner_league_basketball",
          measurementKind: "final_winner",
          resultShape: "home_away_winner",
          oracleCapability: "supported_full_cycle"
        })
      ]
    );

    expect(classification).toMatchObject({
      status: "classified",
      familyKey: "sports.game-winner",
      measurementKind: "final_winner",
      resultShape: "home_away_winner",
      oracleCapability: "supported_full_cycle",
      operatorNextAction: "operator_decide"
    });
  });

  it("turns unknown lead shapes into family proposals instead of weak drafts", () => {
    const classification = classifyMarketFamily(
      {
        category: "general",
        question: "האם משהו מעניין יקרה השבוע?",
        marketForm: "binary",
        sourceIds: []
      },
      []
    );

    expect(classification).toMatchObject({
      status: "family_proposal",
      familyKey: null,
      operatorNextAction: "create_family_proposal",
      blockers: ["market-family-not-classified"]
    });
  });

  it("routes known but unsupported source families to adapter work", () => {
    const classification = classifyMarketFamily(
      {
        category: "economy",
        question: "האם השער היציג של הדולר יחצה את 3.70?",
        marketForm: "threshold",
        sourceIds: ["src_boi_exchange_rates"]
      },
      []
    );

    expect(classification).toMatchObject({
      status: "adapter_needed",
      familyKey: "economy.fx-threshold",
      operatorNextAction: "build_oracle_adapter",
      blockers: ["adapter-capability-missing"]
    });
  });

  it("classifies TradingView live FX as a built market family", () => {
    const classification = classifyMarketFamily(
      {
        category: "economy",
        question: "האם EUR/USD יהיה מעל 1.16 בזמן הסגירה לפי TradingView?",
        marketForm: "threshold",
        sourceIds: ["src_tradingview_fx"]
      },
      [
        sourceRegistryEntry({
          sourceId: "src_tradingview_fx",
          measurementKind: "threshold_crossing",
          resultShape: "yes_no",
          oracleCapability: "supported_final_only"
        })
      ]
    );

    expect(classification).toMatchObject({
      status: "classified",
      familyKey: "economy.live-fx-price",
      operatorNextAction: "operator_decide"
    });
  });

  it("keeps central-bank rate decisions source-neutral instead of labeling Fed/ECB as BOI", () => {
    const classification = classifyMarketFamily(
      {
        category: "economy",
        question: "מה תהיה החלטת הריבית של הפדרל ריזרב ביוני?",
        marketForm: "multi-outcome",
        sourceIds: ["src_federal_reserve_rss"],
        measurementKind: "rate_direction",
        resultShape: "cut_hold_hike"
      },
      []
    );

    expect(classification).toMatchObject({
      status: "adapter_needed",
      familyKey: "economy.central-bank-rate-decision",
      familyLabelHe: "החלטת ריבית של בנק מרכזי",
      operatorNextAction: "build_oracle_adapter",
      blockers: ["adapter-capability-missing"]
    });
  });

  it("policy-gates high-sensitivity security families even when the source is recognized", () => {
    const classification = classifyMarketFamily(
      {
        category: "security",
        question: "האם פיקוד העורף יפרסם התראת חירום רשמית?",
        marketForm: "binary",
        sourceIds: ["src_home_front_command"]
      },
      []
    );

    expect(classification).toMatchObject({
      status: "policy_review",
      familyKey: "security.official-alert-or-disruption",
      operatorNextAction: "policy_review",
      blockers: ["policy-review-required"]
    });
  });
});
