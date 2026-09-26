import { describe, expect, it } from "vitest";

import { IFA_SOURCE_ADAPTER } from "../../../../oracle/src/adapters/ifa-source-adapter";
import type { OracleLifecycleSourceContext } from "../../../../oracle/src/source-adapter-contracts";

const SOURCE_URL = "https://www.football.org.il/national-cup/?national_cup_id=618&season_id=27";

const BASE_CONTEXT: OracleLifecycleSourceContext = {
  marketId: "disc-cm-20260526-ifa-state-cup-final-90min-result",
  marketTitle: "מה תהיה תוצאת 90 הדקות בגמר גביע המדינה?",
  marketStatus: "open",
  closeAt: "2026-05-26T17:25:00.000Z",
  closeOnEventCompletion: false,
  eventCompletionCloseRequiresHumanApproval: true,
  resolutionSource: SOURCE_URL,
  resolutionRules: "הכרעה לפי תוצאת 90 הדקות הרשמית באתר ההתאחדות לכדורגל.",
  oracleSourcePolicy: {
    preferredSourceIds: ["src_ifa_fixtures_results"],
    resolutionSourceIds: ["src_ifa_fixtures_results"]
  },
  marketContract: {
    objectType: "market_contract_v1",
    measurementKind: "final_winner",
    resultShape: "three_way_result",
    oracleCapability: "supported_final_only",
    resolutionSource: {
      url: SOURCE_URL,
      sourceIds: ["src_ifa_fixtures_results"]
    },
    outcomeMap: [
      { outcomeLabel: "הפועל באר שבע", evidenceKey: "home" },
      { outcomeLabel: "תיקו", evidenceKey: "draw" },
      { outcomeLabel: "מכבי תל אביב", evidenceKey: "away" }
    ]
  },
  outcomes: [
    {
      outcomeId: "disc-cm-20260526-ifa-state-cup-final-90min-result-hapoel-bs",
      outcomeKey: "disc-cm-20260526-ifa-state-cup-final-90min-result-hapoel-bs",
      label: "הפועל באר שבע"
    },
    {
      outcomeId: "disc-cm-20260526-ifa-state-cup-final-90min-result-draw",
      outcomeKey: "disc-cm-20260526-ifa-state-cup-final-90min-result-draw",
      label: "תיקו"
    },
    {
      outcomeId: "disc-cm-20260526-ifa-state-cup-final-90min-result-maccabi",
      outcomeKey: "disc-cm-20260526-ifa-state-cup-final-90min-result-maccabi",
      label: "מכבי תל אביב"
    }
  ]
};

const SCHEDULED_HTML = `
  <main>
    <h1>2025/2026 גביע המדינה ווינר</h1>
    <section>
      <h2>גמר</h2>
      <div>תאריך 26/05/2026</div>
      <div>משחק הפועל ב"ש - מכבי ת"א</div>
      <div>מגרש ירושלים אצטדיון טדי</div>
      <div>שעה 20:30</div>
      <div>תוצאה</div>
    </section>
  </main>
`;

const DRAW_FINAL_HTML = `
  <main>
    <h1>2025/2026 גביע המדינה ווינר</h1>
    <section>
      <h2>גמר</h2>
      <div>תאריך 26/05/2026</div>
      <div>משחק הפועל ב"ש - מכבי ת"א</div>
      <div>תוצאה 1 : 1</div>
      <div>תוצאת סיום</div>
    </section>
  </main>
`;

const FIVE_GOAL_FINAL_HTML = `
  <main>
    <h1>2025/2026 גביע המדינה ווינר</h1>
    <section>
      <h2>גמר</h2>
      <div>תאריך 26/05/2026</div>
      <div>משחק הפועל ב"ש - מכבי ת"א</div>
      <div>תוצאה 3 : 2</div>
      <div>הסתיים</div>
    </section>
  </main>
`;

describe("IFA source adapter", () => {
  it("reports scheduled official cup pages as not started and not ready for resolution", async () => {
    const result = await IFA_SOURCE_ADAPTER.inspectResolution(BASE_CONTEXT, {
      now: new Date("2026-05-26T16:00:00.000Z"),
      fetchText: async () => SCHEDULED_HTML
    });

    expect(result).toMatchObject({
      sourceFamily: "ifa_fixtures_results",
      status: "not_started",
      closeConditionSatisfied: false,
      resolutionAvailable: false,
      confidence: "high"
    });
    expect(result.claimSummary).toContain("הפועל באר שבע");
  });

  it("maps a final 90-minute draw to evidenceKey=draw", async () => {
    const result = await IFA_SOURCE_ADAPTER.inspectResolution(BASE_CONTEXT, {
      now: new Date("2026-05-26T19:30:00.000Z"),
      fetchText: async () => DRAW_FINAL_HTML
    });

    expect(result).toMatchObject({
      sourceFamily: "ifa_fixtures_results",
      status: "final",
      resolutionAvailable: true,
      winnerKind: "draw",
      winnerLabel: "תיקו",
      evidenceKey: "draw",
      score: {
        home: 1,
        away: 1
      },
      confidence: "high"
    });
    expect(result.rawHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("maps final total goals into the contract range bucket", async () => {
    const result = await IFA_SOURCE_ADAPTER.inspectResolution(
      {
        ...BASE_CONTEXT,
        marketId: "disc-cm-20260526-ifa-state-cup-final-goal-range",
        marketTitle: "כמה שערים יהיו בגמר גביע המדינה?",
        marketContract: {
          ...BASE_CONTEXT.marketContract!,
          measurementKind: "official_value",
          resultShape: "multi_outcome",
          outcomeMap: [
            { outcomeLabel: "0-1 שערים", evidenceKey: "goals_0_1" },
            { outcomeLabel: "2-3 שערים", evidenceKey: "goals_2_3" },
            { outcomeLabel: "4+ שערים", evidenceKey: "goals_4_plus" }
          ]
        }
      },
      {
        now: new Date("2026-05-26T19:30:00.000Z"),
        fetchText: async () => FIVE_GOAL_FINAL_HTML
      }
    );

    expect(result).toMatchObject({
      sourceFamily: "ifa_fixtures_results",
      status: "final",
      resolutionAvailable: true,
      winnerKind: "named",
      winnerLabel: "4+ שערים",
      evidenceKey: "goals_4_plus",
      score: {
        home: 3,
        away: 2
      }
    });
    expect(result.normalizedSnapshot).toMatchObject({
      totalGoals: 5
    });
  });
});
