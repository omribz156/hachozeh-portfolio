import { describe, expect, it } from "vitest";

import { WINNER_LEAGUE_SOURCE_ADAPTER } from "../../../../oracle/src/adapters/winner-league-source-adapter";
import type { OracleLifecycleSourceContext } from "../../../../oracle/src/source-adapter-contracts";

const CONTEXT: OracleLifecycleSourceContext = {
  marketId: "disc-cm-front-sixpack-winner-league-raanana-ness-ziona-2026-05-18",
  marketTitle: "מי תנצח: מכבי רעננה או נס ציונה?",
  marketStatus: "closed",
  closeAt: "2026-05-18T15:00:00.000Z",
  closeOnEventCompletion: true,
  eventCompletionCloseRequiresHumanApproval: true,
  resolutionSource:
    "תוצאת המשחק הרשמית של מנהלת ליגת Winner סל: https://basket.co.il/pbp/json/games_all.json#game-26515",
  resolutionRules: "Resolve from the official Winner League games feed.",
  oracleSourcePolicy: null,
  marketContract: {
    objectType: "market_contract_v1",
    measurementKind: "final_winner",
    resultShape: "home_away_winner",
    oracleCapability: "supported_full_cycle",
    resolutionSource: {
      url: "https://basket.co.il/pbp/json/games_all.json#game-26515",
      sourceIds: ["src_winner_league_basketball"]
    }
  },
  outcomes: [
    {
      outcomeId: "disc-cm-front-sixpack-winner-league-raanana-ness-ziona-2026-05-18-home",
      outcomeKey: "disc-cm-front-sixpack-winner-league-raanana-ness-ziona-2026-05-18-home",
      label: "מכבי רעננה"
    },
    {
      outcomeId: "disc-cm-front-sixpack-winner-league-raanana-ness-ziona-2026-05-18-away",
      outcomeKey: "disc-cm-front-sixpack-winner-league-raanana-ness-ziona-2026-05-18-away",
      label: "נס ציונה"
    }
  ]
};

const GAMES_FEED = [
  {
    games: [
      {
        id: 26515,
        ExternalID: "172",
        team_name_1: "מכבי רעננה",
        team_name_2: "נס ציונה",
        team_name_eng_1: "M. Ra;ananna",
        team_name_eng_2: "Ness Ziona",
        game_date_txt: "18/05/2026",
        game_year: 2026,
        score_team1: 92,
        score_team2: 70,
        game_time: "21:00",
        isLive: 1
      }
    ]
  }
];

describe("Winner League source adapter", () => {
  it("maps an official final home win from the games feed", async () => {
    const result = await WINNER_LEAGUE_SOURCE_ADAPTER.inspectResolution(CONTEXT, {
      now: new Date("2026-05-18T21:30:00.000Z"),
      fetchJson: async () => GAMES_FEED
    });

    expect(result).toMatchObject({
      sourceFamily: "winner_league_basketball",
      sourceUrl: "https://basket.co.il/pbp/json/games_all.json#game-26515",
      status: "final",
      closeConditionSatisfied: true,
      resolutionAvailable: true,
      winnerKind: "home",
      winnerLabel: "מכבי רעננה",
      score: {
        home: 92,
        away: 70
      },
      officialJsonUrl: "https://basket.co.il/pbp/json/games_all.json",
      confidence: "high"
    });
    expect(result.rawHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("does not resolve before the scheduled game has produced a final score", async () => {
    const result = await WINNER_LEAGUE_SOURCE_ADAPTER.inspectCloseCondition(
      {
        ...CONTEXT,
        resolutionSource: "https://basket.co.il/pbp/json/games_all.json#game-999"
      },
      {
        now: new Date("2026-05-18T17:00:00.000Z"),
        fetchJson: async () => [
          {
            games: [
              {
                id: 999,
                team_name_1: "מכבי רעננה",
                team_name_2: "נס ציונה",
                game_date_txt: "18/05/2026",
                game_time: "21:00"
              }
            ]
          }
        ]
      }
    );

    expect(result).toMatchObject({
      status: "not_started",
      closeConditionSatisfied: false,
      resolutionAvailable: false
    });
  });

  it("does not treat a future 0-0 placeholder as live", async () => {
    const result = await WINNER_LEAGUE_SOURCE_ADAPTER.inspectCloseCondition(
      {
        ...CONTEXT,
        resolutionSource: "https://basket.co.il/game-zone.asp?GameId=26632&lang=he#!stats",
        marketContract: {
          ...CONTEXT.marketContract,
          resolutionSource: {
            url: "https://basket.co.il/game-zone.asp?GameId=26632&lang=he#!stats",
            sourceIds: ["src_winner_league_basketball"]
          }
        }
      },
      {
        now: new Date("2026-06-22T10:42:00.000Z"),
        fetchJson: async () => [
          {
            games: [
              {
                id: 26632,
                team_name_1: "הפועל ת&quot;א",
                team_name_2: "מכבי ת&quot;א",
                game_date_txt: "23/06/2026",
                game_time: "20:50",
                score_team1: 0,
                score_team2: 0
              }
            ]
          }
        ]
      }
    );

    expect(result).toMatchObject({
      status: "not_started",
      closeConditionSatisfied: false,
      resolutionAvailable: false,
      winnerKind: "unknown"
    });
  });
});
