import { describe, expect, it } from "vitest";

import { FIFA_MATCH_CENTRE_SOURCE_ADAPTER } from "../../../../oracle/src/adapters/fifa-match-centre-source-adapter";
import type { OracleLifecycleSourceContext } from "../../../../oracle/src/source-adapter-contracts";

const SOURCE_URL = "https://www.fifa.com/en/match-centre/match/10005/289175/289176/400019164";

const CONTEXT: OracleLifecycleSourceContext = {
  marketId: "disc-cm-fifa-auckland-boca-2025-06-24",
  marketTitle: "מה תהיה תוצאת אוקלנד סיטי נגד בוקה ג'וניורס?",
  marketStatus: "open",
  closeAt: "2025-06-24T21:00:00.000Z",
  closeOnEventCompletion: true,
  eventCompletionCloseRequiresHumanApproval: true,
  resolutionSource: SOURCE_URL,
  resolutionRules: "Resolve from the official FIFA Match Centre page.",
  oracleSourcePolicy: null,
  marketContract: {
    objectType: "market_contract_v1",
    measurementKind: "final_winner",
    resultShape: "three_way_result",
    oracleCapability: "supported_full_cycle",
    resolutionSource: {
      url: SOURCE_URL,
      sourceIds: ["src_fifa_match_centre"]
    }
  },
  outcomes: [
    {
      outcomeId: "home",
      outcomeKey: "home",
      label: "אוקלנד סיטי"
    },
    {
      outcomeId: "draw",
      outcomeKey: "draw",
      label: "תיקו"
    },
    {
      outcomeId: "away",
      outcomeKey: "away",
      label: "בוקה ג'וניורס"
    }
  ]
};

const FINAL_DRAW_PAYLOAD = {
  Results: [
    {
      IdCompetition: "10005",
      IdSeason: "289175",
      IdStage: "289176",
      IdMatch: "400019164",
      Date: "2025-06-24T19:00:00Z",
      CompetitionName: [{ Locale: "en-GB", Description: "FIFA Club World Cup™" }],
      SeasonName: [{ Locale: "en-GB", Description: "FIFA Club World Cup 2025™" }],
      StageName: [{ Locale: "en-GB", Description: "First stage" }],
      Home: {
        IdTeam: "1903515",
        TeamName: [{ Locale: "en-GB", Description: "Auckland City FC" }],
        ShortClubName: "Auckland City FC",
        Abbreviation: "AKL"
      },
      Away: {
        IdTeam: "1884422",
        TeamName: [{ Locale: "en-GB", Description: "CA Boca Juniors" }],
        ShortClubName: "CA Boca Juniors",
        Abbreviation: "BOC"
      },
      HomeTeamScore: 1,
      AwayTeamScore: 1,
      Winner: null,
      MatchStatus: 0,
      ResultType: 1,
      MatchTime: "97'"
    }
  ]
};

const NOT_STARTED_PAYLOAD = {
  Results: [
    {
      IdCompetition: "17",
      IdSeason: "285023",
      IdStage: "289273",
      IdMatch: "400021483",
      Date: "2026-06-21T16:00:00Z",
      Home: {
        IdTeam: "43969",
        TeamName: [{ Locale: "en-GB", Description: "Spain" }],
        Abbreviation: "ESP"
      },
      Away: {
        IdTeam: "43835",
        TeamName: [{ Locale: "en-GB", Description: "Saudi Arabia" }],
        Abbreviation: "KSA"
      },
      HomeTeamScore: null,
      AwayTeamScore: null,
      MatchStatus: 1,
      ResultType: null,
      MatchTime: null
    }
  ]
};

describe("FIFA Match Centre source adapter", () => {
  it("maps a final FIFA draw to the draw winner kind", async () => {
    const result = await FIFA_MATCH_CENTRE_SOURCE_ADAPTER.inspectResolution(CONTEXT, {
      now: new Date("2025-06-24T22:30:00.000Z"),
      fetchJson: async (url) => {
        expect(url).toContain("idCompetition=10005");
        expect(url).toContain("idSeason=289175");
        expect(url).toContain("idStage=289176");
        expect(url).toContain("idMatch=400019164");
        return FINAL_DRAW_PAYLOAD;
      }
    });

    expect(result).toMatchObject({
      sourceFamily: "fifa_match_centre",
      sourceUrl: SOURCE_URL,
      status: "final",
      closeConditionSatisfied: true,
      resolutionAvailable: true,
      winnerKind: "draw",
      evidenceKey: "draw",
      score: {
        home: 1,
        away: 1
      },
      confidence: "high"
    });
    expect(result.officialJsonUrl).toContain("api.fifa.com/api/v3/calendar/matches");
    expect(result.rawHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("reports future FIFA fixtures as not started", async () => {
    const result = await FIFA_MATCH_CENTRE_SOURCE_ADAPTER.inspectCloseCondition(
      {
        ...CONTEXT,
        resolutionSource: "https://www.fifa.com/en/match-centre/match/17/285023/289273/400021483",
        closeAt: "2026-06-21T18:00:00.000Z"
      },
      {
        now: new Date("2026-06-20T18:00:00.000Z"),
        fetchJson: async () => NOT_STARTED_PAYLOAD
      }
    );

    expect(result).toMatchObject({
      sourceFamily: "fifa_match_centre",
      status: "not_started",
      closeConditionSatisfied: false,
      resolutionAvailable: false,
      blockers: []
    });
  });

  it("does not resolve a drawn result for binary home-away markets", async () => {
    const result = await FIFA_MATCH_CENTRE_SOURCE_ADAPTER.inspectResolution(
      {
        ...CONTEXT,
        marketContract: {
          ...CONTEXT.marketContract!,
          resultShape: "home_away_winner"
        }
      },
      {
        now: new Date("2025-06-24T22:30:00.000Z"),
        fetchJson: async () => FINAL_DRAW_PAYLOAD
      }
    );

    expect(result).toMatchObject({
      status: "final",
      winnerKind: "draw",
      resolutionAvailable: false,
      blockers: ["fifa_home_away_market_finished_drawn"]
    });
  });
});
