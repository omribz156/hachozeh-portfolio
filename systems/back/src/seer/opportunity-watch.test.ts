import { describe, expect, it } from "vitest";

import {
  findOpportunityDuplicates,
  scanSeerOpportunities,
  type ExistingMarketLike,
  type TournamentEventLike
} from "./opportunity-watch";

function child(id: string, label: string, status = "open") {
  return {
    marketId: id,
    title: `האם ${label} יזכה?`,
    eventChildLabel: label,
    status,
    resolvedAt: null,
    winnerCount: 0,
    closeAt: "2026-07-12T18:00:00.000Z",
    contract: {
      objectType: "market_contract_v1",
      marketKindId: "sports.tournament-winner",
      resolutionSource: {
        url: "https://www.wimbledon.com/en_GB/scores/schedule/index.html",
        sourceIds: ["src_wimbledon_official"]
      },
      taxonomy: {
        aliases: [label]
      }
    }
  };
}

function winnerEvent(children = [child("m1", "Sinner"), child("m2", "Alcaraz")]): TournamentEventLike {
  return {
    id: "evt_wimbledon_winner",
    slug: "wimbledon-2026-winner",
    title: "מי יזכה בווימבלדון 2026?",
    categoryKey: "sports",
    children
  };
}

function fifaQuarterMarket(input: {
  id: string;
  title: string;
  closeAt: string;
  status?: string;
  winner?: string;
}): ExistingMarketLike {
  return {
    id: input.id,
    title: input.title,
    status: input.status ?? "open",
    closeAt: input.closeAt,
    resolvedAt: input.winner ? "2026-07-12T05:00:00.000Z" : null,
    winningOutcomeLabels: input.winner ? [input.winner] : [],
    contract: {
      marketKindId: "sports.game-winner",
      measurementKind: "final_winner",
      resultShape: "home_away_winner",
      displayHints: {
        competitionLabel: "מונדיאל 2026",
        stageLabel: "רבע הגמר"
      },
      resolutionSource: {
        sourceIds: ["src_fifa_match_centre"]
      }
    }
  };
}

describe("seer opportunity watch", () => {
  it("suggests a final match when exactly two tournament-winner children remain unresolved", () => {
    const receipt = scanSeerOpportunities({
      now: "2026-07-11T12:00:00.000Z",
      events: [winnerEvent()],
      existingMarkets: []
    });

    expect(receipt.suggestionCount).toBe(1);
    expect(receipt.duplicateCount).toBe(0);
    expect(receipt.suggestions[0]).toMatchObject({
      objectType: "seer_opportunity_suggestion",
      source: "tournament_two_left",
      status: "suggested",
      opportunityType: "match_winner",
      title: "Sinner נגד Alcaraz",
      categoryKey: "sports",
      outcomes: ["Sinner", "Alcaraz"],
      sourceUrl: "https://www.wimbledon.com/en_GB/scores/schedule/index.html"
    });
    expect(receipt.suggestions[0]?.suggestedHumanPrompt).toContain("Draft next market");
  });

  it("does not suggest while more than two tournament-winner children remain active", () => {
    const receipt = scanSeerOpportunities({
      events: [winnerEvent([child("m1", "Sinner"), child("m2", "Alcaraz"), child("m3", "Djokovic")])],
      existingMarkets: []
    });

    expect(receipt.suggestionCount).toBe(0);
    expect(receipt.suggestions).toEqual([]);
  });

  it("suggests a next match from resolved adjacent bracket feeders before the final two remain", () => {
    const receipt = scanSeerOpportunities({
      existingMarkets: [
        fifaQuarterMarket({
          id: "disc-fifa-france-morocco-2026-07-09-winner",
          title: "צרפת נגד מרוקו",
          closeAt: "2026-07-09T21:00:00.000Z"
        }),
        fifaQuarterMarket({
          id: "disc-fifa-spain-belgium-2026-07-10-winner",
          title: "ספרד נגד בלגיה",
          closeAt: "2026-07-10T21:00:00.000Z"
        }),
        fifaQuarterMarket({
          id: "disc-fifa-norway-england-2026-07-11-winner",
          title: "נורווגיה נגד אנגליה",
          closeAt: "2026-07-11T21:00:00.000Z",
          status: "resolved",
          winner: "אנגליה"
        }),
        fifaQuarterMarket({
          id: "disc-fifa-argentina-switzerland-2026-07-12-winner",
          title: "ארגנטינה נגד שוויץ",
          closeAt: "2026-07-12T01:00:00.000Z",
          status: "resolved",
          winner: "ארגנטינה"
        })
      ]
    });

    expect(receipt.suggestionCount).toBe(1);
    expect(receipt.suggestions[0]).toMatchObject({
      source: "resolved_match_pair",
      status: "suggested",
      title: "ארגנטינה נגד אנגליה",
      outcomes: ["ארגנטינה", "אנגליה"],
      sourceIds: ["src_fifa_match_centre"],
      suggestedMarketDraft: {
        objectType: "seer_opportunity_market_draft_seed",
        status: "needs_official_fixture",
        title: "ארגנטינה נגד אנגליה",
        description: "שוק על המנצחת הרשמית במשחק ארגנטינה נגד אנגליה בחצי הגמר מונדיאל 2026.",
        reviewBlockers: [
          "needs_official_fixture_url",
          "needs_close_at",
          "needs_expected_resolution_at",
          "needs_home_away_confirmation"
        ],
        marketContract: {
          marketKindId: "sports.game-winner",
          measurementKind: "final_winner",
          resultShape: "home_away_winner",
          displayHints: {
            stageLabel: "חצי הגמר",
            binaryPresentation: "named_opponents"
          },
          resolutionSource: {
            sourceIds: ["src_fifa_match_centre"]
          }
        }
      }
    });
    expect(receipt.suggestions[0]?.suggestedMarketDraft?.marketContract.resolutionRule).toContain(
      "השוק מודד את המנצחת הרשמית במשחק ארגנטינה נגד אנגליה בחצי הגמר מונדיאל 2026"
    );
  });

  it("does not compose bracket matches from non-adjacent resolved feeders", () => {
    const receipt = scanSeerOpportunities({
      existingMarkets: [
        fifaQuarterMarket({
          id: "disc-fifa-a-b",
          title: "א נגד ב",
          closeAt: "2026-07-09T21:00:00.000Z",
          status: "resolved",
          winner: "א"
        }),
        fifaQuarterMarket({
          id: "disc-fifa-c-d",
          title: "ג נגד ד",
          closeAt: "2026-07-10T21:00:00.000Z"
        }),
        fifaQuarterMarket({
          id: "disc-fifa-e-f",
          title: "ה נגד ו",
          closeAt: "2026-07-11T21:00:00.000Z",
          status: "resolved",
          winner: "ה"
        }),
        fifaQuarterMarket({
          id: "disc-fifa-g-h",
          title: "ז נגד ח",
          closeAt: "2026-07-12T01:00:00.000Z"
        })
      ]
    });

    expect(receipt.suggestionCount).toBe(0);
    expect(receipt.suggestions).toEqual([]);
  });

  it("filters an already covered match market by default", () => {
    const existingMarkets: ExistingMarketLike[] = [{
      id: "disc-wimbledon-final-sinner-alcaraz",
      title: "Sinner נגד Alcaraz",
      eventSlug: "wimbledon-final-sinner-alcaraz",
      candidateMarketId: "wimbledon-final-sinner-alcaraz",
      contract: {
        marketKindId: "sports.game-winner",
        taxonomy: {
          aliases: ["Sinner", "Alcaraz"]
        }
      },
      status: "open"
    }];

    const hiddenReceipt = scanSeerOpportunities({
      events: [winnerEvent()],
      existingMarkets
    });
    expect(hiddenReceipt.suggestionCount).toBe(0);
    expect(hiddenReceipt.duplicateCount).toBe(1);
    expect(hiddenReceipt.suggestions).toEqual([]);

    const visibleReceipt = scanSeerOpportunities({
      events: [winnerEvent()],
      existingMarkets,
      includeDuplicates: true
    });
    expect(visibleReceipt.suggestions[0]?.status).toBe("duplicate");
    expect(visibleReceipt.suggestions[0]?.duplicateOf).toEqual(["disc-wimbledon-final-sinner-alcaraz"]);
  });

  it("turns source-fed observations into suggestions and dedupes by candidate id", () => {
    const existingMarkets: ExistingMarketLike[] = [{
      id: "disc-fifa-final-france-brazil",
      title: "צרפת נגד ברזיל",
      candidateMarketId: "fifa-final-france-brazil",
      eventSlug: "fifa-final-france-brazil",
      contract: {
        marketKindId: "sports.game-winner",
        resolutionSource: {
          sourceIds: ["src_fifa_match_centre"]
        }
      },
      status: "open"
    }];

    const receipt = scanSeerOpportunities({
      existingMarkets,
      includeDuplicates: true,
      observations: [{
        sourceFamily: "fifa_match_centre",
        sourceUrl: "https://www.fifa.com/en/match-centre/match/17/288/284515/400018124",
        opportunityType: "match_winner",
        title: "צרפת נגד ברזיל",
        candidateMarketId: "fifa-final-france-brazil",
        eventSlug: "fifa-final-france-brazil",
        categoryKey: "sports",
        outcomes: ["צרפת", "ברזיל"],
        sourceIds: ["src_fifa_match_centre"],
        confidence: "high"
      }]
    });

    expect(receipt.suggestionCount).toBe(0);
    expect(receipt.duplicateCount).toBe(1);
    expect(receipt.suggestions[0]?.status).toBe("duplicate");
    expect(receipt.suggestions[0]?.duplicateOf).toEqual(["disc-fifa-final-france-brazil"]);
  });

  it("composes a next match from resolved feeder market winners", () => {
    const receipt = scanSeerOpportunities({
      existingMarkets: [{
        id: "disc-fifa-quarter-a",
        title: "צרפת נגד גרמניה",
        status: "resolved",
        resolvedAt: "2026-07-10T21:00:00.000Z",
        winningOutcomeLabels: ["צרפת"],
        contract: { marketKindId: "sports.game-winner" }
      }, {
        id: "disc-fifa-quarter-b",
        title: "ברזיל נגד יפן",
        status: "resolved",
        resolvedAt: "2026-07-10T23:00:00.000Z",
        winningOutcomeLabels: ["ברזיל"],
        contract: { marketKindId: "sports.game-winner" }
      }],
      observations: [{
        sourceFamily: "fifa_match_centre",
        sourceUrl: "https://www.fifa.com/en/match-centre/",
        opportunityType: "match_winner",
        titleTemplate: "{outcome1} נגד {outcome2}",
        candidateMarketId: "fifa-next-match-winner-slot-a-slot-b",
        categoryKey: "sports",
        outcomeSources: [{
          fromMarketId: "disc-fifa-quarter-a"
        }, {
          fromMarketId: "disc-fifa-quarter-b"
        }],
        sourceIds: ["src_fifa_match_centre"]
      }]
    });

    expect(receipt.suggestionCount).toBe(1);
    expect(receipt.suggestions[0]).toMatchObject({
      source: "composed_source_observation",
      status: "suggested",
      title: "צרפת נגד ברזיל",
      outcomes: ["צרפת", "ברזיל"],
      candidateMarketId: "fifa-next-match-winner-slot-a-slot-b"
    });
  });

  it("does not compose a next match until every feeder market has a winner", () => {
    const receipt = scanSeerOpportunities({
      existingMarkets: [{
        id: "disc-fifa-quarter-a",
        title: "צרפת נגד גרמניה",
        status: "resolved",
        resolvedAt: "2026-07-10T21:00:00.000Z",
        winningOutcomeLabels: ["צרפת"],
        contract: { marketKindId: "sports.game-winner" }
      }, {
        id: "disc-fifa-quarter-b",
        title: "ברזיל נגד יפן",
        status: "open",
        resolvedAt: null,
        winningOutcomeLabels: [],
        contract: { marketKindId: "sports.game-winner" }
      }],
      observations: [{
        sourceFamily: "fifa_match_centre",
        sourceUrl: "https://www.fifa.com/en/match-centre/",
        opportunityType: "match_winner",
        titleTemplate: "{outcome1} נגד {outcome2}",
        outcomeSources: [{
          fromMarketId: "disc-fifa-quarter-a"
        }, {
          fromMarketId: "disc-fifa-quarter-b"
        }],
        sourceIds: ["src_fifa_match_centre"]
      }]
    });

    expect(receipt.suggestionCount).toBe(0);
    expect(receipt.suggestions).toEqual([]);
  });

  it("does not compose from fallback labels when a resolved feeder has no winner label", () => {
    const receipt = scanSeerOpportunities({
      existingMarkets: [{
        id: "disc-fifa-quarter-a",
        title: "צרפת נגד גרמניה",
        status: "resolved",
        resolvedAt: "2026-07-10T21:00:00.000Z",
        winningOutcomeLabels: [],
        contract: { marketKindId: "sports.game-winner" }
      }, {
        id: "disc-fifa-quarter-b",
        title: "ברזיל נגד יפן",
        status: "resolved",
        resolvedAt: "2026-07-10T23:00:00.000Z",
        winningOutcomeLabels: ["ברזיל"],
        contract: { marketKindId: "sports.game-winner" }
      }],
      observations: [{
        sourceFamily: "fifa_match_centre",
        sourceUrl: "https://www.fifa.com/en/match-centre/",
        opportunityType: "match_winner",
        titleTemplate: "{outcome1} נגד {outcome2}",
        outcomeSources: [{
          fromMarketId: "disc-fifa-quarter-a",
          fallbackLabel: "צרפת"
        }, {
          fromMarketId: "disc-fifa-quarter-b"
        }],
        sourceIds: ["src_fifa_match_centre"]
      }]
    });

    expect(receipt.suggestionCount).toBe(0);
    expect(receipt.suggestions).toEqual([]);
  });

  it("matches likely match duplicates by both outcome aliases", () => {
    const duplicates = findOpportunityDuplicates({
      candidateMarketId: "generated-final",
      eventSlug: "generated-final",
      outcomes: ["Norway", "England"],
      sourceUrl: null
    }, [{
      id: "disc-existing",
      title: "Norway vs England",
      contract: {
        marketKindId: "sports.game-winner",
        taxonomy: {
          aliases: ["Norway", "England"]
        }
      }
    }]);

    expect(duplicates).toEqual(["disc-existing"]);
  });
});
