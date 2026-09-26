import { describe, expect, it } from "vitest";

import {
  EUROVISION_SCOREBOARD_SOURCE_ADAPTER,
  parseEurovisionScoreboard
} from "../../../../oracle/src/adapters/eurovision-scoreboard-source-adapter";
import type { OracleLifecycleSourceContext } from "../../../../oracle/src/source-adapter-contracts";

const OFFICIAL_URL = "https://www.eurovision.com/eurovision-song-contest/vienna-2026/vienna-2026-grand-final/";

function entry(country: string, total: string, jury: string, audience: string, runningOrder: string) {
  return `
    <div class="data-row-entry scoreboard-entry" aria-label="Scoreboard entry for ${country}">
      <p>${total} points</p>
      <div><span class="data-row-entry-result-label">Jury</span><span>${jury}</span></div>
      <div><span class="data-row-entry-result-label">Audience</span><span>${audience}</span></div>
      <div><span class="data-row-entry-result-label">Running Order</span><span>${runningOrder}</span></div>
      <p data-country-name>${country}</p>
    </div>`;
}

const FINAL_HTML = `
  <section id="scoreboard">
    ${entry("Finland", "300", "100", "200", "17")}
    ${entry("Israel", "250", "150", "100", "3")}
    ${entry("Australia", "220", "120", "100", "8")}
    ${entry("United Kingdom", "20", "5", "15", "14")}
  </section>`;

const TBC_HTML = `
  <section id="scoreboard">
    ${entry("Finland", "-", "TBC", "TBC", "17")}
    ${entry("Israel", "-", "TBC", "TBC", "3")}
  </section>`;

function context(overrides: Partial<OracleLifecycleSourceContext> = {}): OracleLifecycleSourceContext {
  return {
    marketId: "disc-cm-eurovision-israel-top5-2026",
    marketTitle: "האם ישראל תסיים בטופ 5 בגמר אירוויזיון 2026?",
    marketStatus: "closed",
    closeAt: "2026-05-16T19:00:00.000Z",
    closeOnEventCompletion: false,
    eventCompletionCloseRequiresHumanApproval: true,
    resolutionSource: `טבלת התוצאות הרשמית של Eurovision: ${OFFICIAL_URL}`,
    resolutionRules:
      "השוק מוכרע לפי טבלת התוצאות הרשמית של גמר אירוויזיון 2026. אם ישראל מופיעה במקום 1 עד 5 בדירוג הסופי הרשמי, התוצאה היא כן; אחרת התוצאה היא לא.",
    oracleSourcePolicy: {
      preferredSourceIds: ["src_eurovision_official"],
      resolutionSourceIds: ["src_eurovision_official"]
    },
    marketContract: {
      objectType: "market_contract_v1",
      measurementKind: "final_winner",
      resultShape: "yes_no",
      oracleCapability: "supported_final_only",
      resolutionSource: {
        url: OFFICIAL_URL,
        sourceIds: ["src_eurovision_official"]
      },
      outcomeMap: [
        { outcomeLabel: "כן", evidenceKey: "yes" },
        { outcomeLabel: "לא", evidenceKey: "no" }
      ],
      timeline: {
        closeAt: "2026-05-16T19:00:00.000Z",
        expectedResolutionAt: "2026-05-16T23:00:00.000Z"
      }
    },
    outcomes: [
      { outcomeId: "yes", outcomeKey: "yes", label: "כן" },
      { outcomeId: "no", outcomeKey: "no", label: "לא" }
    ],
    ...overrides
  };
}

describe("Eurovision scoreboard source adapter", () => {
  it("parses official scoreboard entries from Eurovision HTML", () => {
    expect(parseEurovisionScoreboard(FINAL_HTML)).toEqual([
      {
        country: "Finland",
        orderIndex: 0,
        totalPoints: 300,
        juryPoints: 100,
        audiencePoints: 200,
        runningOrder: 17
      },
      {
        country: "Israel",
        orderIndex: 1,
        totalPoints: 250,
        juryPoints: 150,
        audiencePoints: 100,
        runningOrder: 3
      },
      {
        country: "Australia",
        orderIndex: 2,
        totalPoints: 220,
        juryPoints: 120,
        audiencePoints: 100,
        runningOrder: 8
      },
      {
        country: "United Kingdom",
        orderIndex: 3,
        totalPoints: 20,
        juryPoints: 5,
        audiencePoints: 15,
        runningOrder: 14
      }
    ]);
  });

  it("resolves Israel top-N markets from the official final rank", async () => {
    const inspection = await EUROVISION_SCOREBOARD_SOURCE_ADAPTER.inspectResolution(context(), {
      now: new Date("2026-05-17T00:30:00.000Z"),
      fetchText: async () => FINAL_HTML
    });

    expect(inspection).toMatchObject({
      sourceFamily: "eurovision_official_scoreboard",
      status: "final",
      resolutionAvailable: true,
      evidenceKey: "yes",
      winnerLabel: "כן",
      confidence: "high",
      blockers: []
    });
    expect(inspection.claimSummary).toContain("rank 2");
  });

  it("resolves jury and televote winner markets separately", async () => {
    const jury = await EUROVISION_SCOREBOARD_SOURCE_ADAPTER.inspectResolution(
      context({
        marketTitle: "האם ישראל תזכה בהצבעת השופטים באירוויזיון 2026?",
        resolutionRules: "אם ישראל מדורגת ראשונה בניקוד השופטים הרשמי, התוצאה היא כן."
      }),
      {
        fetchText: async () => FINAL_HTML
      }
    );
    const televote = await EUROVISION_SCOREBOARD_SOURCE_ADAPTER.inspectResolution(
      context({
        marketTitle: "האם ישראל תזכה בהצבעת הקהל באירוויזיון 2026?",
        resolutionRules: "אם ישראל מדורגת ראשונה בניקוד הקהל הרשמי, התוצאה היא כן."
      }),
      {
        fetchText: async () => FINAL_HTML
      }
    );

    expect(jury).toMatchObject({ evidenceKey: "yes", winnerLabel: "כן" });
    expect(televote).toMatchObject({ evidenceKey: "no", winnerLabel: "לא" });
  });

  it("resolves last-place markets from the official final rank", async () => {
    const inspection = await EUROVISION_SCOREBOARD_SOURCE_ADAPTER.inspectResolution(
      context({
        marketTitle: "האם ישראל תסיים במקום האחרון בגמר אירוויזיון 2026?",
        resolutionRules: "אם ישראל מדורגת אחרונה בדירוג הסופי הרשמי, התוצאה היא כן."
      }),
      {
        fetchText: async () => FINAL_HTML
      }
    );

    expect(inspection).toMatchObject({
      evidenceKey: "no",
      winnerLabel: "לא",
      blockers: []
    });
  });

  it("resolves all-country winner markets to the winning country evidence key", async () => {
    const inspection = await EUROVISION_SCOREBOARD_SOURCE_ADAPTER.inspectResolution(
      context({
        marketTitle: "מי תזכה באירוויזיון 2026?",
        resolutionRules: "התוצאה הזוכה היא המדינה שמדורגת במקום הראשון בדירוג הסופי הרשמי.",
        marketContract: {
          objectType: "market_contract_v1",
          measurementKind: "official_value",
          resultShape: "multi_outcome",
          oracleCapability: "supported_final_only",
          resolutionSource: {
            url: OFFICIAL_URL,
            sourceIds: ["src_eurovision_official"]
          },
          outcomeMap: [
            { outcomeLabel: "פינלנד", evidenceKey: "country:finland" },
            { outcomeLabel: "ישראל", evidenceKey: "country:israel" }
          ]
        },
        outcomes: [
          { outcomeId: "finland", outcomeKey: "finland", label: "פינלנד" },
          { outcomeId: "israel", outcomeKey: "israel", label: "ישראל" }
        ]
      }),
      {
        fetchText: async () => FINAL_HTML
      }
    );

    expect(inspection).toMatchObject({
      evidenceKey: "country:finland",
      winnerLabel: "Finland",
      blockers: []
    });
  });

  it("resolves all-country last-place markets to the last-ranked country evidence key", async () => {
    const inspection = await EUROVISION_SCOREBOARD_SOURCE_ADAPTER.inspectResolution(
      context({
        marketTitle: "מי תסיים במקום האחרון בגמר אירוויזיון 2026?",
        resolutionRules: "התוצאה הזוכה היא המדינה שמדורגת במקום האחרון בדירוג הסופי הרשמי.",
        marketContract: {
          objectType: "market_contract_v1",
          measurementKind: "official_value",
          resultShape: "multi_outcome",
          oracleCapability: "supported_final_only",
          resolutionSource: {
            url: OFFICIAL_URL,
            sourceIds: ["src_eurovision_official"]
          },
          outcomeMap: [
            { outcomeLabel: "בריטניה", evidenceKey: "country:united-kingdom" },
            { outcomeLabel: "ישראל", evidenceKey: "country:israel" }
          ]
        },
        outcomes: [
          { outcomeId: "uk", outcomeKey: "uk", label: "בריטניה" },
          { outcomeId: "israel", outcomeKey: "israel", label: "ישראל" }
        ]
      }),
      {
        fetchText: async () => FINAL_HTML
      }
    );

    expect(inspection).toMatchObject({
      evidenceKey: "country:united-kingdom",
      winnerLabel: "United Kingdom",
      blockers: []
    });
  });

  it("blocks safely before official points are published", async () => {
    const inspection = await EUROVISION_SCOREBOARD_SOURCE_ADAPTER.inspectResolution(context(), {
      fetchText: async () => TBC_HTML
    });

    expect(inspection).toMatchObject({
      status: "not_started",
      resolutionAvailable: false,
      blockers: ["eurovision_scoreboard_not_final"]
    });
  });
});
