import { describe, expect, it } from "vitest";

import { NBA_SOURCE_ADAPTER } from "../../../../oracle/src/adapters/nba-source-adapter";
import type { OracleLifecycleSourceContext } from "../../../../oracle/src/source-adapter-contracts";

const CONTEXT: OracleLifecycleSourceContext = {
  marketId: "disc-cm-gauntlet-good-nba-det-cle-20260509",
  marketTitle: "מי תנצח במשחק ה-NBA הרשמי?",
  marketStatus: "open",
  closeAt: "2026-05-09T19:00:00.000Z",
  closeOnEventCompletion: true,
  eventCompletionCloseRequiresHumanApproval: true,
  resolutionSource: "https://www.nba.com/game/det-vs-cle-0042500203",
  resolutionRules: "Resolve from the NBA official game page and official boxscore.",
  oracleSourcePolicy: null,
  outcomes: [
    {
      outcomeId: "disc-cm-gauntlet-good-nba-det-cle-20260509-detroit-pistons",
      outcomeKey: "disc-cm-gauntlet-good-nba-det-cle-20260509-detroit-pistons",
      label: "Detroit Pistons / דטרויט פיסטונס"
    },
    {
      outcomeId: "disc-cm-gauntlet-good-nba-det-cle-20260509-cleveland-cavaliers",
      outcomeKey: "disc-cm-gauntlet-good-nba-det-cle-20260509-cleveland-cavaliers",
      label: "Cleveland Cavaliers / קליבלנד קאבלירס"
    }
  ]
};

describe("NBA source adapter", () => {
  it("falls back to the official scoreboard payload when boxscore JSON is blocked", async () => {
    const calls: string[] = [];
    const result = await NBA_SOURCE_ADAPTER.inspectCloseCondition(CONTEXT, {
      now: new Date("2026-05-09T16:45:00.000Z"),
      fetchJson: async (url) => {
        calls.push(url);

        if (url.includes("boxscore_0042500203")) {
          throw new Error("Fetch failed 403");
        }

        return {
          scoreboard: {
            games: [
              {
                gameId: "0042500203",
                gameStatus: 1,
                gameStatusText: "3:00 pm ET",
                gameTimeUTC: "2026-05-09T19:00:00Z",
                homeTeam: {
                  teamCity: "Cleveland",
                  teamName: "Cavaliers",
                  teamTricode: "CLE",
                  score: 0
                },
                awayTeam: {
                  teamCity: "Detroit",
                  teamName: "Pistons",
                  teamTricode: "DET",
                  score: 0
                }
              }
            ]
          }
        };
      }
    });

    expect(calls).toEqual([
      "https://nba-prod-us-east-1-mediaops-stats.s3.amazonaws.com/NBA/liveData/boxscore/boxscore_0042500203.json",
      "https://nba-prod-us-east-1-mediaops-stats.s3.amazonaws.com/NBA/liveData/scoreboard/todaysScoreboard_00.json"
    ]);
    expect(result).toMatchObject({
      sourceFamily: "nba_official_game",
      officialJsonUrl: "https://nba-prod-us-east-1-mediaops-stats.s3.amazonaws.com/NBA/liveData/scoreboard/todaysScoreboard_00.json",
      status: "not_started",
      closeConditionSatisfied: false,
      resolutionAvailable: false,
      confidence: "medium"
    });
  });

  it("maps final scoreboard payloads to the official winner", async () => {
    const result = await NBA_SOURCE_ADAPTER.inspectResolution(CONTEXT, {
      now: new Date("2026-05-09T22:00:00.000Z"),
      fetchJson: async () => ({
        scoreboard: {
          games: [
            {
              gameId: "0042500203",
              gameStatus: 3,
              gameStatusText: "Final",
              gameTimeUTC: "2026-05-09T19:00:00Z",
              homeTeam: {
                teamCity: "Cleveland",
                teamName: "Cavaliers",
                teamTricode: "CLE",
                score: 101
              },
              awayTeam: {
                teamCity: "Detroit",
                teamName: "Pistons",
                teamTricode: "DET",
                score: 109
              }
            }
          ]
        }
      })
    });

    expect(result).toMatchObject({
      sourceFamily: "nba_official_game",
      status: "final",
      closeConditionSatisfied: true,
      resolutionAvailable: true,
      winnerKind: "away",
      winnerLabel: "Detroit Pistons",
      score: {
        home: 101,
        away: 109
      },
      confidence: "high"
    });
  });
});
