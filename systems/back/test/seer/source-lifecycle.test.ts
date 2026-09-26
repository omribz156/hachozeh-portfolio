import { describe, expect, it } from "vitest";

import { resolveContractLifecycleFromRegistry } from "../../../seer/src/source-lifecycle";
import { seededSeerSourceRegistry } from "../../../seer/src/source-registry";
import type { SourceRegistryEntry } from "../../../seer/src/contracts";

function sourceEntry(overrides: Partial<SourceRegistryEntry>): SourceRegistryEntry {
  return {
    objectType: "source_registry_entry",
    sourceId: "src_custom",
    label: "Custom source",
    primaryClass: "authority",
    accessSurface: "html",
    status: "trusted",
    curationMode: "manual-seed",
    stageUsefulness: ["grounding", "review"],
    categoryFit: ["economy"],
    createdAt: "2026-05-10T00:00:00.000Z",
    updatedAt: "2026-05-10T00:00:00.000Z",
    ...overrides
  };
}

describe("source lifecycle resolution", () => {
  it("uses registry lifecycle capabilities as the Oracle capability source of truth", () => {
    const lifecycle = resolveContractLifecycleFromRegistry(
      {
        recurringTemplateId: "boi-rate-decision-v1",
        marketForm: "multi-outcome",
        sourceIds: ["src_custom_rates"]
      },
      [
        sourceEntry({
          sourceId: "src_custom_rates",
          lifecycleCapabilities: [
            {
              measurementKind: "rate_direction",
              resultShape: "cut_hold_hike",
              oracleCapability: "blocked",
              notes: ["adapter not ready"]
            }
          ]
        })
      ]
    );

    expect(lifecycle).toMatchObject({
      measurementKind: "rate_direction",
      resultShape: "cut_hold_hike",
      oracleCapability: "blocked"
    });
  });

  it("falls back to explicit manual handling for unregistered date-bucket contracts", () => {
    expect(
      resolveContractLifecycleFromRegistry(
        {
          marketForm: "date-bucket",
          sourceIds: ["src_unregistered_dataset"]
        },
        []
      )
    ).toMatchObject({
      measurementKind: "date_bucket",
      resultShape: "date_bucket",
      oracleCapability: "manual_resolution_required"
    });
  });

  it("does not silently manualize unregistered threshold contracts", () => {
    expect(
      resolveContractLifecycleFromRegistry(
        {
          marketForm: "threshold",
          sourceIds: ["src_ims_daily_observations"]
        },
        []
      )
    ).toMatchObject({
      measurementKind: "threshold_crossing",
      resultShape: "yes_no",
      oracleCapability: undefined
    });
  });

  it("marks Coinbase daily-close threshold markets as final-only supported", () => {
    expect(
      resolveContractLifecycleFromRegistry(
        {
          marketForm: "threshold",
          sourceIds: ["src_coinbase_exchange_candles"]
        },
        seededSeerSourceRegistry
      )
    ).toMatchObject({
      measurementKind: "threshold_crossing",
      resultShape: "yes_no",
      oracleCapability: "supported_final_only"
    });
  });

  it("marks Coinbase daily-close range markets as final-only supported", () => {
    expect(
      resolveContractLifecycleFromRegistry(
        {
          marketForm: "range",
          sourceIds: ["src_coinbase_exchange_candles"]
        },
        seededSeerSourceRegistry
      )
    ).toMatchObject({
      measurementKind: "official_value",
      resultShape: "multi_outcome",
      oracleCapability: "supported_final_only"
    });
  });

  it("marks Eurovision official binary scoreboard markets as final-only supported", () => {
    expect(
      resolveContractLifecycleFromRegistry(
        {
          marketForm: "binary",
          sourceIds: ["src_eurovision_official"]
        },
        seededSeerSourceRegistry
      )
    ).toMatchObject({
      measurementKind: "final_winner",
      resultShape: "yes_no",
      oracleCapability: "supported_final_only"
    });
  });

  it("marks Eurovision official multi-outcome scoreboard markets as final-only supported", () => {
    expect(
      resolveContractLifecycleFromRegistry(
        {
          marketForm: "multi-outcome",
          sourceIds: ["src_eurovision_official"]
        },
        seededSeerSourceRegistry
      )
    ).toMatchObject({
      measurementKind: "official_value",
      resultShape: "multi_outcome",
      oracleCapability: "supported_final_only"
    });
  });

  it("marks IFA regulation-time football markets as final-only supported", () => {
    expect(
      resolveContractLifecycleFromRegistry(
        {
          recurringTemplateId: "sports-regulation-3way-v1",
          marketForm: "multi-outcome",
          sourceIds: ["src_ifa_fixtures_results"]
        },
        seededSeerSourceRegistry
      )
    ).toMatchObject({
      measurementKind: "final_winner",
      resultShape: "three_way_result",
      oracleCapability: "supported_final_only"
    });
  });

  it("marks FIFA regulation-time football markets as full-cycle supported", () => {
    expect(
      resolveContractLifecycleFromRegistry(
        {
          recurringTemplateId: "sports-regulation-3way-v1",
          marketForm: "multi-outcome",
          sourceIds: ["src_fifa_match_centre"]
        },
        seededSeerSourceRegistry
      )
    ).toMatchObject({
      measurementKind: "final_winner",
      resultShape: "three_way_result",
      oracleCapability: "supported_full_cycle"
    });
  });

  it("marks IFA goal-range football markets as final-only supported", () => {
    expect(
      resolveContractLifecycleFromRegistry(
        {
          marketForm: "range",
          sourceIds: ["src_ifa_fixtures_results"]
        },
        seededSeerSourceRegistry
      )
    ).toMatchObject({
      measurementKind: "official_value",
      resultShape: "multi_outcome",
      oracleCapability: "supported_final_only"
    });
  });

  it("marks TradingView live FX threshold markets as final-only supported", () => {
    expect(
      resolveContractLifecycleFromRegistry(
        {
          marketForm: "threshold",
          sourceIds: ["src_tradingview_fx"]
        },
        seededSeerSourceRegistry
      )
    ).toMatchObject({
      measurementKind: "threshold_crossing",
      resultShape: "yes_no",
      oracleCapability: "supported_final_only"
    });
  });

  it("marks TradingView live FX range markets as final-only supported", () => {
    expect(
      resolveContractLifecycleFromRegistry(
        {
          marketForm: "range",
          sourceIds: ["src_tradingview_fx"]
        },
        seededSeerSourceRegistry
      )
    ).toMatchObject({
      measurementKind: "official_value",
      resultShape: "multi_outcome",
      oracleCapability: "supported_final_only"
    });
  });

  it("selects yes/no source capability for older binary review items without a template", () => {
    const lifecycle = resolveContractLifecycleFromRegistry(
      {
        marketForm: "binary",
        sourceIds: ["src_custom_rates"]
      },
      [
        sourceEntry({
          sourceId: "src_custom_rates",
          lifecycleCapabilities: [
            {
              measurementKind: "rate_direction",
              resultShape: "cut_hold_hike",
              oracleCapability: "manual_resolution_required"
            },
            {
              measurementKind: "rate_direction",
              resultShape: "yes_no",
              oracleCapability: "manual_resolution_required"
            }
          ]
        })
      ]
    );

    expect(lifecycle).toMatchObject({
      measurementKind: "rate_direction",
      resultShape: "yes_no",
      oracleCapability: "manual_resolution_required"
    });
  });
});
