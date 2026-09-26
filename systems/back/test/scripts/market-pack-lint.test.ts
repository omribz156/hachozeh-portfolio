import { describe, expect, it } from "vitest";

import { lintMarketPackBatch, lintMarketPackItem, lintMarketPackSnapshot } from "../../src/scripts/market-pack-lint";

function tournamentContract(extra: Record<string, unknown> = {}) {
  return {
    objectType: "market_contract_v1",
    marketKindId: "sports.tournament-winner",
    measurementKind: "final_winner",
    resultShape: "yes_no",
    resolutionSource: { label: "Official", sourceIds: ["src_official"] },
    timeline: { expectedResolutionAt: "2026-07-19T22:30:00.000Z" },
    image: { assetId: "flag.fr" },
    operational: { eventPack: "world-cup", earlyEliminationClose: true },
    ...extra
  };
}

describe("market pack dependency lint", () => {
  it("blocks tournament early-close prose without a route", () => {
    const issues = lintMarketPackItem({
      creationDraftId: "draft-1", candidateMarketId: "france", eventResolutionPolicy: "exclusive_first_hit",
      contract: tournamentContract()
    });
    expect(issues.map((issue) => issue.code)).toContain("nonfunctional_early_elimination");
  });

  it("accepts an explicit elimination fact receiver", () => {
    const issues = lintMarketPackItem({
      creationDraftId: "draft-1", candidateMarketId: "france", eventResolutionPolicy: "exclusive_first_hit",
      contract: tournamentContract({ dependencyResolution: { acceptFact: "entity_eliminated", entityKey: "france" } })
    });
    expect(issues.map((issue) => issue.code)).not.toContain("nonfunctional_early_elimination");
  });

  it("blocks an elimination source without a target event", () => {
    const issues = lintMarketPackItem({
      creationDraftId: "draft-1", candidateMarketId: "episode-5",
      contract: tournamentContract({ dependentResolution: { emitFact: "entity_eliminated" } })
    });
    expect(issues.map((issue) => issue.code)).toContain("missing_dependent_target_event");
  });

  it("blocks an elimination source without explicit eliminated entity mapping", () => {
    const issues = lintMarketPackItem({
      creationDraftId: "draft-1", candidateMarketId: "england-argentina",
      contract: tournamentContract({
        dependentResolution: {
          emitFact: "entity_eliminated",
          targetEventId: "evt-fifa-world-cup-2026-winner"
        }
      })
    });
    expect(issues.map((issue) => issue.code)).toContain("missing_dependent_elimination_outcome_map");
  });

  it("accepts an elimination source with explicit eliminated entity mapping", () => {
    const issues = lintMarketPackItem({
      creationDraftId: "draft-1", candidateMarketId: "england-argentina",
      contract: tournamentContract({
        dependentResolution: {
          emitFact: "entity_eliminated",
          targetEventId: "evt-fifa-world-cup-2026-winner"
        },
        outcomeMap: [
          {
            outcomeLabel: "ארגנטינה",
            eliminatesEntityKey: "england",
            eliminatesEntityLabel: "אנגליה"
          }
        ]
      })
    });
    expect(issues.map((issue) => issue.code)).not.toContain("missing_dependent_elimination_outcome_map");
  });

  it("blocks an elimination receiver without a stable entity key", () => {
    const issues = lintMarketPackItem({
      creationDraftId: "draft-1", candidateMarketId: "france", eventResolutionPolicy: "exclusive_first_hit",
      contract: tournamentContract({ dependencyResolution: { acceptFact: "entity_eliminated" } })
    });
    expect(issues.map((issue) => issue.code)).toContain("missing_dependent_entity_key");
  });

  it("blocks exact duplicate market ids across canonical prod snapshots", () => {
    const first = {
      ...lintMarketPackSnapshot("workspace/market-packs/a/03-prod/a.json", {
        items: [{
          creationDraftId: "draft-a",
          candidateMarketId: "same-market",
          contract: tournamentContract({
            dependencyResolution: { acceptFact: "entity_eliminated", entityKey: "england" }
          })
        }]
      }),
      marketIds: [{ id: "same-market", draftId: "draft-a" }]
    };
    const second = {
      ...lintMarketPackSnapshot("workspace/market-packs/b/03-prod/b.json", {
        items: [{
          creationDraftId: "draft-b",
          candidateMarketId: "same-market",
          contract: tournamentContract({
            dependencyResolution: { acceptFact: "entity_eliminated", entityKey: "england" }
          })
        }]
      }),
      marketIds: [{ id: "same-market", draftId: "draft-b" }]
    };

    const receipt = lintMarketPackBatch("workspace/market-packs", [first, second]);

    expect(receipt.issues.map((issue) => issue.code)).toContain("duplicate_candidate_market_id_across_prod_snapshots");
    expect(receipt.blockerCount).toBeGreaterThan(0);
  });

  it("does not treat internal operator metadata as leaked user-facing copy", () => {
    const issues = lintMarketPackItem({
      creationDraftId: "draft-operator-metadata",
      candidateMarketId: "operator-metadata",
      title: "שוק נקי למשתמש",
      resolutionRules: "השוק יוכרע לפי התוצאה הרשמית.",
      contract: tournamentContract({
        dependencyResolution: { acceptFact: "entity_eliminated", entityKey: "france" },
        operational: {
          eventPack: "world-cup",
          earlyEliminationClose: true,
          operatorNote: "operator reviews the alert"
        }
      })
    });

    expect(issues.map((issue) => issue.code)).not.toContain("robotic_or_backend_copy");
  });

  it("still catches operator language in public rules", () => {
    const issues = lintMarketPackItem({
      creationDraftId: "draft-public-leak",
      candidateMarketId: "public-leak",
      resolutionRules: "The operator will decide the result.",
      contract: tournamentContract({
        dependencyResolution: { acceptFact: "entity_eliminated", entityKey: "france" }
      })
    });

    expect(issues.map((issue) => issue.code)).toContain("robotic_or_backend_copy");
  });

  it("warns when a watch-required draft does not name its expected plan", () => {
    const issues = lintMarketPackItem({
      creationDraftId: "draft-watch",
      candidateMarketId: "watch-market",
      oracleSourcePolicy: { notes: ["market-watch-pings-only-no-mutation"] },
      contract: tournamentContract({
        dependencyResolution: { acceptFact: "entity_eliminated", entityKey: "france" }
      })
    });

    expect(issues.map((issue) => issue.code)).toContain("missing_market_watch_plan_id");
  });

  it("accepts a complete embedded watch plan as the publish bundle", () => {
    const issues = lintMarketPackItem({
      creationDraftId: "draft-watch-bundle",
      candidateMarketId: "watch-bundle-market",
      oracleSourcePolicy: { notes: ["market-watch-pings-only-no-mutation"] },
      watchPlan: {
        id: "show_watch",
        sourceUrls: ["https://example.com/show"],
        entities: ["זוג א"],
        keywords: ["הודח"],
        runAt: ["2026-07-20T20:45:00.000Z"]
      },
      contract: tournamentContract({
        dependencyResolution: { acceptFact: "entity_eliminated", entityKey: "france" }
      })
    });

    expect(issues.map((issue) => issue.code)).not.toContain("missing_market_watch_plan_id");
    expect(issues.map((issue) => issue.code)).not.toContain("invalid_embedded_market_watch_plan");
  });
});
