import { describe, expect, it } from "vitest";

import { buildFamilyReadinessSnapshot } from "../../../seer/src/family-readiness";
import { seededMarketFamilyRegistry } from "../../../seer/src/market-family-registry";
import { seededSeerSourceRegistry } from "../../../seer/src/source-registry";
import type {
  MarketFamilyRegistryEntry,
  SourceRegistryEntry
} from "../../../seer/src/contracts";

const family: MarketFamilyRegistryEntry = {
  objectType: "market_family_registry_entry",
  familyKey: "sports.game-winner",
  category: "sports",
  labelHe: "מנצחת משחק",
  labelEn: "Game winner",
  marketForms: ["binary"],
  measurementKind: "final_winner",
  resultShape: "home_away_winner",
  namingPatternHe: "מי תנצח?",
  closePolicy: "סגירה לפני פתיחת המשחק.",
  resolutionPolicy: "הכרעה לפי התוצאה הרשמית הסופית.",
  sensitivityLevel: "normal",
  operatorDecisionRequired: true,
  sourceCandidates: [
    {
      sourceId: "src_winner_league_basketball",
      label: "מנהלת ליגת העל בכדורסל",
      route: {
        measurementKind: "final_winner",
        resultShape: "home_away_winner"
      },
      adapterReadiness: "built"
    },
    {
      sourceId: "src_ifa_fixtures_results",
      label: "ההתאחדות לכדורגל",
      route: {
        measurementKind: "final_winner",
        resultShape: "three_way_result"
      },
      adapterReadiness: "adapter_needed"
    }
  ]
};

function sourceRegistryEntry(): SourceRegistryEntry {
  return {
    objectType: "source_registry_entry",
    sourceId: "src_winner_league_basketball",
    label: "Winner League basketball fixtures and results",
    primaryClass: "authority",
    accessSurface: "api",
    status: "trusted",
    curationMode: "manual-seed",
    stageUsefulness: ["grounding", "review"],
    categoryFit: ["sports"],
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-20T00:00:00.000Z",
    lifecycleCapabilities: [
      {
        measurementKind: "final_winner",
        resultShape: "home_away_winner",
        oracleCapability: "supported_full_cycle"
      }
    ]
  };
}

describe("family readiness", () => {
  it("groups family, source, adapter, and lifecycle readiness into one operator view", () => {
    const snapshot = buildFamilyReadinessSnapshot(
      [family],
      [sourceRegistryEntry()],
      "2026-05-20T12:00:00.000Z"
    );

    expect(snapshot).toMatchObject({
      objectType: "family_readiness_snapshot",
      familyCount: 1,
      routeCount: 2,
      statusCounts: expect.objectContaining({
        supported_full_cycle: 1,
        source_registry_missing: 1
      })
    });
    expect(snapshot.items[0]).toMatchObject({
      familyKey: "sports.game-winner",
      bestReadinessStatus: "supported_full_cycle",
      operatorNextAction: "ready_to_create"
    });
    expect(snapshot.items[0]?.sourceRoutes).toEqual([
      expect.objectContaining({
        sourceId: "src_winner_league_basketball",
        readinessStatus: "supported_full_cycle",
        operatorNextAction: "ready_to_create"
      }),
      expect.objectContaining({
        sourceId: "src_ifa_fixtures_results",
        readinessStatus: "source_registry_missing",
        operatorNextAction: "survey_source"
      })
    ]);
  });

  it("keeps every seeded market-family source candidate represented in the source registry", () => {
    const snapshot = buildFamilyReadinessSnapshot(
      seededMarketFamilyRegistry,
      seededSeerSourceRegistry,
      "2026-05-20T12:00:00.000Z"
    );

    expect(snapshot.statusCounts.source_registry_missing ?? 0).toBe(0);
  });
});
