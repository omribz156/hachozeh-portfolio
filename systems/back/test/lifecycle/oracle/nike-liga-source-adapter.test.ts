import { describe, expect, it } from "vitest";

import { NIKE_LIGA_SOURCE_ADAPTER } from "../../../../oracle/src/adapters/nike-liga-source-adapter";
import type { OracleLifecycleSourceContext } from "../../../../oracle/src/source-adapter-contracts";

const CONTEXT: OracleLifecycleSourceContext = {
  marketId: "disc-cm-nike-liga-podbrezova-slovan-bratislava-2026-05-09",
  marketTitle: "מה תהיה התוצאה הרשמית במשחק פודברזובה נגד סלובן ברטיסלבה?",
  marketStatus: "open",
  closeAt: "2026-05-09T16:00:00.000Z",
  closeOnEventCompletion: true,
  eventCompletionCloseRequiresHumanApproval: true,
  resolutionSource: "https://www.nikeliga.sk/zapas/2772-pod-slo",
  resolutionRules: "Resolve from the official Niké Liga match page.",
  oracleSourcePolicy: null,
  outcomes: [
    {
      outcomeId: "disc-cm-nike-liga-podbrezova-slovan-bratislava-2026-05-09-home",
      outcomeKey: "disc-cm-nike-liga-podbrezova-slovan-bratislava-2026-05-09-home",
      label: "פודברזובה"
    },
    {
      outcomeId: "disc-cm-nike-liga-podbrezova-slovan-bratislava-2026-05-09-draw",
      outcomeKey: "disc-cm-nike-liga-podbrezova-slovan-bratislava-2026-05-09-draw",
      label: "תיקו"
    },
    {
      outcomeId: "disc-cm-nike-liga-podbrezova-slovan-bratislava-2026-05-09-away",
      outcomeKey: "disc-cm-nike-liga-podbrezova-slovan-bratislava-2026-05-09-away",
      label: "סלובן ברטיסלבה"
    }
  ]
};

const SCHEDULED_HTML = `
  <div class="game__scoreboard">
    <div class="game__scoreboard__team game__scoreboard__team--home">
      <span class="hidden-xs">FK Železiarne Podbrezová</span>
    </div>
    <div class="game__scoreboard__score">
      <div class="game__scoreboard__date hidden-xs">sobota 09.05.2026, 18:00</div>
    </div>
    <div class="game__scoreboard__team game__scoreboard__team--away">
      <span class="hidden-xs">ŠK Slovan Bratislava</span>
    </div>
  </div>
`;

const FINAL_HTML = `
  <div class="game__scoreboard">
    <div class="game__scoreboard__team game__scoreboard__team--home">
      <span class="hidden-xs">FK Železiarne Podbrezová</span>
    </div>
    <div class="game__scoreboard__score">
      <strong>1:2</strong>
      <span>Koniec zápasu</span>
    </div>
    <div class="game__scoreboard__team game__scoreboard__team--away">
      <span class="hidden-xs">ŠK Slovan Bratislava</span>
    </div>
  </div>
`;

const FULLTIME_CLASS_HTML = `
  <div class="game__scoreboard">
    <div class="game__scoreboard__team game__scoreboard__team--home">
      <span class="hidden-xs">ŠK Slovan Bratislava</span>
    </div>
    <div class="game__scoreboard__score">
      <div class="game__scoreboard__date hidden-xs">sobota 16.05.2026, 17:11</div>
      <div class="game__scoreboard__fulltime ">0:2</div>
      <div class="game__scoreboard__halftime">(0:0)</div>
    </div>
    <div class="game__scoreboard__team game__scoreboard__team--away">
      <span class="hidden-xs">MFK Zemplín Michalovce</span>
    </div>
  </div>
`;

describe("Niké Liga source adapter", () => {
  it("reports scheduled match pages as not started and not ready for resolution", async () => {
    const result = await NIKE_LIGA_SOURCE_ADAPTER.inspectCloseCondition(CONTEXT, {
      now: new Date("2026-05-09T15:30:00.000Z"),
      fetchText: async () => SCHEDULED_HTML
    });

    expect(result).toMatchObject({
      sourceFamily: "nike_liga_match_page",
      status: "not_started",
      closeConditionSatisfied: false,
      resolutionAvailable: false,
      confidence: "high"
    });
  });

  it("maps a final away win to the away/drawn/home normalized winner kind", async () => {
    const result = await NIKE_LIGA_SOURCE_ADAPTER.inspectResolution(CONTEXT, {
      now: new Date("2026-05-09T18:10:00.000Z"),
      fetchText: async () => FINAL_HTML
    });

    expect(result).toMatchObject({
      sourceFamily: "nike_liga_match_page",
      status: "final",
      closeConditionSatisfied: true,
      resolutionAvailable: true,
      winnerKind: "away",
      winnerLabel: "ŠK Slovan Bratislava",
      score: {
        home: 1,
        away: 2
      },
      confidence: "high"
    });
    expect(result.rawHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.claimSummary).toContain("ŠK Slovan Bratislava");
  });

  it("treats the official fulltime score block as final even without text marker", async () => {
    const result = await NIKE_LIGA_SOURCE_ADAPTER.inspectResolution(CONTEXT, {
      now: new Date("2026-05-16T18:10:00.000Z"),
      fetchText: async () => FULLTIME_CLASS_HTML
    });

    expect(result).toMatchObject({
      sourceFamily: "nike_liga_match_page",
      status: "final",
      resolutionAvailable: true,
      winnerKind: "away",
      winnerLabel: "MFK Zemplín Michalovce",
      score: {
        home: 0,
        away: 2
      }
    });
  });
});
