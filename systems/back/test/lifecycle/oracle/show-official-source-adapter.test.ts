import { describe, expect, it } from "vitest";

import { SHOW_OFFICIAL_SOURCE_ADAPTER } from "../../../../oracle/src/adapters/show-official-source-adapter";
import type { OracleLifecycleSourceContext } from "../../../../oracle/src/source-adapter-contracts";

const BASE_CONTEXT: OracleLifecycleSourceContext = {
  marketId: "disc-cm-dancing-shiri-rafael",
  marketTitle: "האם שירי מימון ורפאל פליישמן יזכו בעונה 5 של רוקדים עם כוכבים?",
  marketStatus: "closed",
  closeAt: "2026-07-31T18:00:00.000Z",
  closeOnEventCompletion: false,
  eventCompletionCloseRequiresHumanApproval: true,
  resolutionSource: "https://www.mako.co.il/tv-dancing_with_the_stars",
  resolutionRules: "מוכרע לפי הפרסום הרשמי של רוקדים עם כוכבים.",
  oracleSourcePolicy: {
    resolutionSourceIds: ["src_show_official"]
  },
  marketContract: {
    objectType: "market_contract_v1",
    measurementKind: "final_winner",
    resultShape: "yes_no",
    oracleCapability: "supported_final_only",
    measurement: "האם שירי מימון ורפאל פליישמן יזכו בעונה 5 של רוקדים עם כוכבים?",
    resolutionSource: {
      url: "https://www.mako.co.il/tv-dancing_with_the_stars",
      sourceIds: ["src_show_official"]
    },
    timeline: {
      eventCandidates: [
        "שירי מימון ורפאל פליישמן",
        "אבישג סמברג ואיוון דניסוב",
        "אמיר בנאי ורומי נוף"
      ]
    },
    outcomeMap: [
      { outcomeLabel: "כן", evidenceKey: "yes" },
      { outcomeLabel: "לא", evidenceKey: "no" }
    ]
  },
  outcomes: [
    {
      outcomeId: "disc-cm-dancing-shiri-rafael-yes",
      outcomeKey: "disc-cm-dancing-shiri-rafael-yes",
      label: "כן"
    },
    {
      outcomeId: "disc-cm-dancing-shiri-rafael-no",
      outcomeKey: "disc-cm-dancing-shiri-rafael-no",
      label: "לא"
    }
  ]
};

describe("official show source adapter", () => {
  it("maps target-couple winner language to yes", async () => {
    const inspection = await SHOW_OFFICIAL_SOURCE_ADAPTER.inspectResolution(BASE_CONTEXT, {
      now: new Date("2026-08-01T20:15:00.000Z"),
      fetchText: async () => `
        <article>
          <h1>גמר רוקדים עם כוכבים</h1>
          <p>אחרי ערב הגמר, שירי מימון ורפאל פליישמן זכו בגמר העונה.</p>
        </article>
      `
    });

    expect(inspection).toMatchObject({
      sourceFamily: "show_official",
      status: "final",
      resolutionAvailable: true,
      evidenceKey: "yes",
      winnerLabel: "כן",
      winnerKind: "named"
    });
    expect(inspection.normalizedSnapshot).toMatchObject({
      reason: "target_won"
    });
  });

  it("maps target-couple elimination language to no", async () => {
    const inspection = await SHOW_OFFICIAL_SOURCE_ADAPTER.inspectResolution(BASE_CONTEXT, {
      now: new Date("2026-07-10T20:15:00.000Z"),
      fetchText: async () => `
        <article>
          <h1>ההדחה הדרמטית</h1>
          <p>שירי ורפאל הם הזוג המודח של הערב וסיימו את דרכם בתחרות.</p>
        </article>
      `
    });

    expect(inspection).toMatchObject({
      status: "final",
      resolutionAvailable: true,
      evidenceKey: "no",
      winnerLabel: "לא",
      confidence: "high"
    });
    expect(inspection.normalizedSnapshot).toMatchObject({
      reason: "target_eliminated"
    });
  });

  it("does not resolve from a generic show page without result language", async () => {
    const inspection = await SHOW_OFFICIAL_SOURCE_ADAPTER.inspectResolution(BASE_CONTEXT, {
      now: new Date("2026-07-04T20:15:00.000Z"),
      fetchText: async () => `
        <main>
          <h1>רוקדים עם כוכבים</h1>
          <p>שירי מימון ורפאל פליישמן חוזרים לרחבה בפרק הבא.</p>
          <p>מי הזוכה שלכם?</p>
        </main>
      `
    });

    expect(inspection).toMatchObject({
      status: "not_started",
      resolutionAvailable: false
    });
    expect(inspection).not.toHaveProperty("evidenceKey");
  });

  it("does not resolve target market from unrelated elimination language", async () => {
    const inspection = await SHOW_OFFICIAL_SOURCE_ADAPTER.inspectResolution(BASE_CONTEXT, {
      now: new Date("2026-07-04T20:15:00.000Z"),
      fetchText: async () => `
        <article>
          <h1>הדחה נוספת</h1>
          <p>אמיר בנאי ורומי נוף הודחו מרוקדים עם כוכבים.</p>
          <p>שירי מימון ורפאל פליישמן ממשיכים לשבוע הבא.</p>
        </article>
      `
    });

    expect(inspection).toMatchObject({
      status: "not_started",
      resolutionAvailable: false
    });
    expect(inspection).not.toHaveProperty("evidenceKey");
  });

  it("maps another known winner to no for the target binary child", async () => {
    const inspection = await SHOW_OFFICIAL_SOURCE_ADAPTER.inspectResolution(BASE_CONTEXT, {
      now: new Date("2026-08-01T20:15:00.000Z"),
      fetchText: async () => `
        <article>
          <h1>גמר רוקדים עם כוכבים</h1>
          <p>אבישג סמברג ואיוון דניסוב זכו בגמר העונה.</p>
        </article>
      `
    });

    expect(inspection).toMatchObject({
      status: "final",
      resolutionAvailable: true,
      evidenceKey: "no",
      winnerLabel: "לא"
    });
    expect(inspection.normalizedSnapshot).toMatchObject({
      reason: "other_known_candidate_won"
    });
  });
});
