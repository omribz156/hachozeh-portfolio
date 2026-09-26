import { describe, expect, it } from "vitest";

import { FIBA_BASKETBALL_SOURCE_ADAPTER } from "../../../../oracle/src/adapters/fiba-basketball-source-adapter";
import type { OracleLifecycleSourceContext } from "../../../../oracle/src/source-adapter-contracts";

const CONTEXT: OracleLifecycleSourceContext = {
  marketId: "disc-cm-fiba-u20-israel-czechia-20260713",
  marketTitle: "ישראל נגד צ׳כיה",
  marketStatus: "open",
  closeAt: "2026-07-13T11:00:00.000Z",
  closeOnEventCompletion: true,
  eventCompletionCloseRequiresHumanApproval: true,
  resolutionSource: "https://www.fiba.basketball/en/events/fiba-u20-eurobasket-2026/games/131719-ISR-CZE",
  resolutionRules: "התוצאה הזוכה היא הנבחרת שניצחה בתוצאה הרשמית בסיום המשחק.",
  oracleSourcePolicy: null,
  marketContract: {
    objectType: "market_contract_v1",
    measurementKind: "final_winner",
    resultShape: "home_away_winner",
    oracleCapability: "supported_full_cycle",
    resolutionSource: {
      url: "https://www.fiba.basketball/en/events/fiba-u20-eurobasket-2026/games/131719-ISR-CZE",
      sourceIds: ["src_fiba_basketball_games"]
    }
  },
  outcomes: [
    {
      outcomeId: "disc-cm-fiba-u20-israel-czechia-20260713-israel",
      outcomeKey: "disc-cm-fiba-u20-israel-czechia-20260713-israel",
      label: "ישראל"
    },
    {
      outcomeId: "disc-cm-fiba-u20-israel-czechia-20260713-czechia",
      outcomeKey: "disc-cm-fiba-u20-israel-czechia-20260713-czechia",
      label: "צ׳כיה"
    }
  ]
};

function page(status: {
  gameId?: number;
  aScore: number;
  bScore: number;
  isLive: boolean;
  liveGameStatus: number;
  periodStatus: string | null;
}) {
  return `
    <script>
      {"game":{"gameId":${status.gameId ?? 131719},"teamA":{"code":"ISR","officialName":"Israel"},"teamB":{"code":"CZE","officialName":"Czechia"},"teamAScore":${status.aScore},"teamBScore":${status.bScore},"isLive":${status.isLive},"liveGameStatus":${status.liveGameStatus},"currentPeriodStatus":${status.periodStatus == null ? "null" : `"${status.periodStatus}"`},"gameDateTimeUTC":"2026-07-13T11:00:00","isPostponed":false}}
    </script>
  `;
}

describe("FIBA basketball source adapter", () => {
  it("keeps future official games unclosed before tipoff", async () => {
    const result = await FIBA_BASKETBALL_SOURCE_ADAPTER.inspectCloseCondition(CONTEXT, {
      now: new Date("2026-07-13T10:30:00.000Z"),
      fetchText: async () =>
        page({
          aScore: 0,
          bScore: 0,
          isLive: false,
          liveGameStatus: 1,
          periodStatus: null
        })
    });

    expect(result).toMatchObject({
      sourceFamily: "fiba_basketball_game",
      status: "not_started",
      closeConditionSatisfied: false,
      resolutionAvailable: false
    });
  });

  it("maps final FIBA scores to the home or away evidence key", async () => {
    const result = await FIBA_BASKETBALL_SOURCE_ADAPTER.inspectResolution(CONTEXT, {
      now: new Date("2026-07-13T13:30:00.000Z"),
      fetchText: async () =>
        page({
          aScore: 82,
          bScore: 74,
          isLive: false,
          liveGameStatus: 999,
          periodStatus: "E"
        })
    });

    expect(result).toMatchObject({
      sourceFamily: "fiba_basketball_game",
      status: "final",
      closeConditionSatisfied: true,
      resolutionAvailable: true,
      evidenceKey: "home",
      winnerKind: "home",
      winnerLabel: "Israel",
      score: {
        home: 82,
        away: 74
      },
      confidence: "high"
    });
    expect(result.rawHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
