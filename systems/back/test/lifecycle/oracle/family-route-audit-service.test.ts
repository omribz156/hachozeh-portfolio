import { describe, expect, it } from "vitest";

import { runFamilyRouteAudit } from "../../../../oracle/src/family-route-audit-service";
import { KNESSET_OFFICIAL_SOURCE_ADAPTER } from "../../../../oracle/src/adapters/knesset-official-source-adapter";
import type { OracleLifecycleSourceAdapter } from "../../../../oracle/src/source-adapter-contracts";
import type { SourceRegistryEntry } from "../../../../seer/src/contracts";

function buildSource(
  sourceId: string,
  lifecycleCapabilities: SourceRegistryEntry["lifecycleCapabilities"]
): SourceRegistryEntry {
  return {
    objectType: "source_registry_entry",
    sourceId,
    label: sourceId,
    primaryClass: "authority",
    accessSurface: "html",
    status: "trusted",
    curationMode: "manual-seed",
    stageUsefulness: ["grounding", "review"],
    categoryFit: ["test"],
    createdAt: "2026-05-19T00:00:00.000Z",
    updatedAt: "2026-05-19T00:00:00.000Z",
    homepage: `https://example.com/${sourceId}`,
    lifecycleCapabilities
  };
}

function buildAdapter(input: {
  sourceId: string;
  measurementKind: string;
  resultShape: string;
  closeCondition?: boolean;
  resolution?: boolean;
}): OracleLifecycleSourceAdapter {
  return {
    sourceFamily: `${input.sourceId}_family`,
    sourceLabel: `${input.sourceId} family`,
    sourceIds: [input.sourceId],
    measurementKinds: [input.measurementKind],
    resultShapes: [input.resultShape],
    capabilities: {
      closeCondition: input.closeCondition ?? false,
      resolution: input.resolution ?? true
    },
    supportsSource: () => true,
    inspectCloseCondition: async () => ({
      sourceFamily: `${input.sourceId}_family`,
      status: "not_started",
      closeConditionSatisfied: false,
      resolutionAvailable: false,
      sourceUrl: `https://example.com/${input.sourceId}`,
      fetchedAt: "2026-05-19T00:00:00.000Z",
      rawHash: "hash",
      normalizedSnapshot: {},
      claimSummary: "not started",
      confidence: "low",
      blockers: []
    }),
    inspectResolution: async () => ({
      sourceFamily: `${input.sourceId}_family`,
      status: "not_started",
      closeConditionSatisfied: false,
      resolutionAvailable: false,
      sourceUrl: `https://example.com/${input.sourceId}`,
      fetchedAt: "2026-05-19T00:00:00.000Z",
      rawHash: "hash",
      normalizedSnapshot: {},
      claimSummary: "not started",
      confidence: "low",
      blockers: []
    })
  };
}

describe("runFamilyRouteAudit", () => {
  it("blocks when Seer marks a route supported but Oracle has no adapter", async () => {
    const result = await runFamilyRouteAudit({
      generatedAt: "2026-05-19T00:00:00.000Z",
      sources: [
        buildSource("src_test_rates", [
          {
            measurementKind: "rate_direction",
            resultShape: "cut_hold_hike",
            oracleCapability: "supported_final_only"
          }
        ])
      ],
      adapters: [],
      checkCapability: (input) => ({
        objectType: "oracle_source_capability_check",
        sourceId: input.sourceId,
        measurementKind: input.measurementKind,
        resultShape: input.resultShape,
        sourceUrl: input.sourceUrl ?? null,
        status: "adapter_not_implemented",
        adapterFamily: null,
        adapterLabel: null,
        nextAction: "build_oracle_adapter",
        reason: "missing"
      })
    });

    expect(result).toMatchObject({
      status: "blocked",
      blockerCount: 1,
      issues: [
        {
          issueCode: "seer_supported_but_oracle_missing",
          severity: "blocker",
          nextAction: "build_oracle_adapter"
        }
      ]
    });
  });

  it("warns when Oracle supports a route missing from Seer registry", async () => {
    const result = await runFamilyRouteAudit({
      generatedAt: "2026-05-19T00:00:00.000Z",
      sources: [buildSource("src_test_sports", [])],
      adapters: [
        buildAdapter({
          sourceId: "src_test_sports",
          measurementKind: "final_winner",
          resultShape: "home_away_winner",
          closeCondition: true,
          resolution: true
        })
      ],
      checkCapability: (input) => ({
        objectType: "oracle_source_capability_check",
        sourceId: input.sourceId,
        measurementKind: input.measurementKind,
        resultShape: input.resultShape,
        sourceUrl: input.sourceUrl ?? null,
        status: "full_cycle_supported",
        adapterFamily: "test_sports",
        adapterLabel: "Test sports",
        nextAction: "none",
        reason: "supported"
      })
    });

    expect(result).toMatchObject({
      status: "warnings",
      warningCount: 1,
      issues: [
        {
          issueCode: "oracle_route_missing_from_seer_registry",
          severity: "warning",
          nextAction: "update_seer_registry"
        }
      ]
    });
  });

  it("stays clean when Knesset legislation full-cycle support matches Seer", async () => {
    const result = await runFamilyRouteAudit({
      generatedAt: "2026-12-31T00:00:00.000Z",
      sources: [
        {
          objectType: "source_registry_entry",
          sourceId: "src_knesset_official",
          label: "Knesset official",
          primaryClass: "authority",
          accessSurface: "html",
          status: "seeded",
          curationMode: "manual-seed",
          stageUsefulness: ["grounding", "review"],
          categoryFit: ["politics"],
          lifecycleCapabilities: [
            {
              measurementKind: "deadline_yes_no",
              resultShape: "yes_no",
              oracleCapability: "supported_full_cycle"
            }
          ],
          homepage: "https://main.knesset.gov.il/apps/legislation/main/bills/2198907",
          seerPath: "politics-family-probe",
          createdAt: "2026-12-31T00:00:00.000Z",
          updatedAt: "2026-12-31T00:00:00.000Z"
        }
      ],
      adapters: [KNESSET_OFFICIAL_SOURCE_ADAPTER]
    });

    expect(result).toMatchObject({
      status: "clean",
      blockerCount: 0,
      warningCount: 0,
      checkedRouteCount: 1,
      issues: []
    });
  });

  it("passes cleanly when Seer and Oracle agree", async () => {
    const result = await runFamilyRouteAudit({
      generatedAt: "2026-05-19T00:00:00.000Z",
      sources: [
        buildSource("src_test_boi", [
          {
            measurementKind: "rate_direction",
            resultShape: "yes_no",
            oracleCapability: "supported_final_only"
          }
        ])
      ],
      adapters: [
        buildAdapter({
          sourceId: "src_test_boi",
          measurementKind: "rate_direction",
          resultShape: "yes_no"
        })
      ],
      checkCapability: (input) => ({
        objectType: "oracle_source_capability_check",
        sourceId: input.sourceId,
        measurementKind: input.measurementKind,
        resultShape: input.resultShape,
        sourceUrl: input.sourceUrl ?? null,
        status: "final_only_supported",
        adapterFamily: "test_boi",
        adapterLabel: "Test BOI",
        nextAction: "none",
        reason: "supported"
      })
    });

    expect(result).toMatchObject({
      status: "clean",
      blockerCount: 0,
      warningCount: 0,
      checkedRouteCount: 1,
      issues: []
    });
  });

  it("warns when Seer parks a route that Oracle can support", async () => {
    const result = await runFamilyRouteAudit({
      generatedAt: "2026-05-19T00:00:00.000Z",
      sources: [
        buildSource("src_test_weather", [
          {
            measurementKind: "threshold_crossing",
            resultShape: "yes_no",
            oracleCapability: "manual_resolution_required"
          }
        ])
      ],
      adapters: [
        buildAdapter({
          sourceId: "src_test_weather",
          measurementKind: "threshold_crossing",
          resultShape: "yes_no"
        })
      ],
      checkCapability: (input) => ({
        objectType: "oracle_source_capability_check",
        sourceId: input.sourceId,
        measurementKind: input.measurementKind,
        resultShape: input.resultShape,
        sourceUrl: input.sourceUrl ?? null,
        status: "final_only_supported",
        adapterFamily: "test_weather",
        adapterLabel: "Test weather",
        nextAction: "none",
        reason: "supported"
      })
    });

    expect(result).toMatchObject({
      status: "warnings",
      warningCount: 1,
      issues: [
        {
          issueCode: "seer_parked_but_oracle_supports",
          severity: "warning",
          nextAction: "consider_capability_upgrade"
        }
      ]
    });
  });
});
