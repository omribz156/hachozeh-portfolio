import { describe, expect, it } from "vitest";

import { IBBA_SOURCE_ADAPTER } from "../../../../oracle/src/adapters/ibba-source-adapter";
import type { OracleLifecycleSourceContext } from "../../../../oracle/src/source-adapter-contracts";

function context(overrides: Partial<OracleLifecycleSourceContext> = {}): OracleLifecycleSourceContext {
  return {
    marketId: "disc-cm-ibba-proof",
    marketTitle: "מי תנצח: מ.כ עוטף דרום או מכבי רוטשטיין אשדוד?",
    marketStatus: "closed",
    closeAt: "2026-05-19T18:00:00.000Z",
    closeOnEventCompletion: true,
    eventCompletionCloseRequiresHumanApproval: true,
    resolutionSource: "https://ibasketball.co.il/match/778780/",
    resolutionRules: "מוכרע לפי תוצאת המשחק הרשמית באתר איגוד הכדורסל.",
    oracleSourcePolicy: {
      preferredSourceIds: ["src_ibba_schedules"],
      resolutionSourceIds: ["src_ibba_schedules"]
    },
    marketContract: {
      objectType: "market_contract_v1",
      measurementKind: "final_winner",
      resultShape: "home_away_winner",
      oracleCapability: "supported_full_cycle",
      resolutionSource: {
        url: "https://ibasketball.co.il/match/778780/",
        sourceIds: ["src_ibba_schedules"]
      },
      outcomeMap: [
        { outcomeLabel: "מ.כ עוטף דרום", evidenceKey: "home" },
        { outcomeLabel: "מכבי רוטשטיין אשדוד", evidenceKey: "away" }
      ]
    },
    outcomes: [
      { outcomeId: "home", outcomeKey: "home", label: "מ.כ עוטף דרום" },
      { outcomeId: "away", outcomeKey: "away", label: "מכבי רוטשטיין אשדוד" }
    ],
    ...overrides
  };
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: 1410010,
    slug: "778780",
    date: "2026-05-19T21:05:00",
    link: "https://ibasketball.co.il/match/778780/",
    title: { rendered: "מ.כ עוטף דרום — מכבי רוטשטיין אשדוד" },
    home: { team: "מ.כ עוטף דרום", points: 71 },
    away: { team: "מכבי רוטשטיין אשדוד", points: 67 },
    main_results: [71, 67],
    state: "finished",
    ...overrides
  };
}

describe("IBBA source adapter", () => {
  it("resolves final winners from the official Sportspress event feed", async () => {
    const inspection = await IBBA_SOURCE_ADAPTER.inspectResolution(context(), {
      now: new Date("2026-05-19T20:00:00.000Z"),
      fetchJson: async (url) => {
        expect(url).toBe("https://ibasketball.co.il/wp-json/sportspress/v2/events?slug=778780");
        return [event()];
      }
    });

    expect(inspection).toMatchObject({
      sourceFamily: "ibba_schedules",
      status: "final",
      closeConditionSatisfied: true,
      resolutionAvailable: true,
      winnerKind: "home",
      winnerLabel: "מ.כ עוטף דרום",
      score: {
        home: 71,
        away: 67
      },
      confidence: "high",
      blockers: []
    });
  });

  it("marks future events as not started when no score exists", async () => {
    const inspection = await IBBA_SOURCE_ADAPTER.inspectCloseCondition(context(), {
      now: new Date("2026-05-19T12:00:00.000Z"),
      fetchJson: async () => [
        event({
          home: { team: "מ.כ עוטף דרום", points: null },
          away: { team: "מכבי רוטשטיין אשדוד", points: null },
          main_results: null,
          state: ""
        })
      ]
    });

    expect(inspection).toMatchObject({
      status: "not_started",
      closeConditionSatisfied: false,
      resolutionAvailable: false
    });
  });

  it("blocks safely when the event cannot be found", async () => {
    const inspection = await IBBA_SOURCE_ADAPTER.inspectResolution(context(), {
      now: new Date("2026-05-19T20:00:00.000Z"),
      fetchJson: async () => []
    });

    expect(inspection).toMatchObject({
      status: "unknown",
      resolutionAvailable: false,
      blockers: ["missing_ibba_event"]
    });
  });
});
