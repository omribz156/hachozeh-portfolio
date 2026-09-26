import { describe, expect, it } from "vitest";

import { BOI_RATE_DECISION_SOURCE_ADAPTER } from "../../../../oracle/src/adapters/boi-rate-decision-source-adapter";
import type { OracleLifecycleSourceContext } from "../../../../oracle/src/source-adapter-contracts";

const BASE_CONTEXT: OracleLifecycleSourceContext = {
  marketId: "disc-cm-boi-rate-decision-may-25-2026",
  marketTitle: "ריבית בנק ישראל: 25 במאי",
  marketStatus: "closed",
  closeAt: "2026-05-25T13:00:00.000Z",
  closeOnEventCompletion: false,
  eventCompletionCloseRequiresHumanApproval: true,
  resolutionSource: "https://www.boi.org.il/en/communication-and-publications/press-releases/25-05-2026/",
  resolutionRules: "מוכרע לפי הודעת הריבית הרשמית של בנק ישראל.",
  oracleSourcePolicy: {
    resolutionSourceIds: ["src_boi_announcements"]
  },
  marketContract: {
    objectType: "market_contract_v1",
    measurementKind: "rate_direction",
    resultShape: "cut_hold_hike",
    oracleCapability: "manual_resolution_required",
    resolutionSource: {
      url: "https://www.boi.org.il/en/communication-and-publications/press-releases/25-05-2026/",
      sourceIds: ["src_boi_announcements"]
    },
    outcomeMap: [
      { outcomeLabel: "ירידה 0.25%", evidenceKey: "cut-025" },
      { outcomeLabel: "ללא שינוי", evidenceKey: "hold" },
      { outcomeLabel: "עלייה 0.25%", evidenceKey: "hike-025" }
    ]
  },
  outcomes: [
    {
      outcomeId: "disc-cm-boi-rate-decision-may-25-2026-cut",
      outcomeKey: "disc-cm-boi-rate-decision-may-25-2026-cut",
      label: "ירידה 0.25%"
    },
    {
      outcomeId: "disc-cm-boi-rate-decision-may-25-2026-hold",
      outcomeKey: "disc-cm-boi-rate-decision-may-25-2026-hold",
      label: "ללא שינוי"
    },
    {
      outcomeId: "disc-cm-boi-rate-decision-may-25-2026-hike",
      outcomeKey: "disc-cm-boi-rate-decision-may-25-2026-hike",
      label: "עלייה 0.25%"
    }
  ]
};

describe("BOI rate-decision source adapter", () => {
  it("detects official hold decisions and emits the hold evidence key", async () => {
    const inspection = await BOI_RATE_DECISION_SOURCE_ADAPTER.inspectResolution(BASE_CONTEXT, {
      now: new Date("2026-05-25T13:15:00.000Z"),
      fetchText: async () => `
        <article>
          <h1>החלטת הריבית</h1>
          <p>25/05/2026</p>
          <p>הוועדה המוניטרית החליטה להותיר את הריבית ללא שינוי ברמה של 4.50%.</p>
        </article>
      `
    });

    expect(inspection).toMatchObject({
      sourceFamily: "boi_rate_decision",
      status: "final",
      resolutionAvailable: true,
      winnerKind: "named",
      winnerLabel: "ללא שינוי",
      evidenceKey: "hold",
      confidence: "high"
    });
  });

  it("maps hold decisions to yes for binary unchanged-rate markets", async () => {
    const inspection = await BOI_RATE_DECISION_SOURCE_ADAPTER.inspectResolution(
      {
        ...BASE_CONTEXT,
        marketTitle: "האם בנק ישראל ישאיר את הריבית ללא שינוי?",
        marketContract: {
          ...BASE_CONTEXT.marketContract,
          resultShape: "yes_no",
          oracleCapability: "supported_final_only",
          measurement: "האם בנק ישראל ישאיר את הריבית ללא שינוי?",
          outcomeMap: [
            { outcomeLabel: "כן", evidenceKey: "yes" },
            { outcomeLabel: "לא", evidenceKey: "no" }
          ]
        },
        outcomes: [
          {
            outcomeId: "disc-cm-boi-binary-yes",
            outcomeKey: "disc-cm-boi-binary-yes",
            label: "כן"
          },
          {
            outcomeId: "disc-cm-boi-binary-no",
            outcomeKey: "disc-cm-boi-binary-no",
            label: "לא"
          }
        ]
      },
      {
        now: new Date("2026-08-31T13:15:00.000Z"),
        fetchText: async () => `
          <article>
            <h1>החלטת הריבית</h1>
            <p>25/05/2026</p>
            <p>הוועדה המוניטרית החליטה להותיר את הריבית ללא שינוי.</p>
          </article>
        `
      }
    );

    expect(inspection).toMatchObject({
      status: "final",
      evidenceKey: "yes",
      winnerLabel: "כן"
    });
    expect(inspection.normalizedSnapshot).toMatchObject({
      rawEvidenceKey: "hold",
      evidenceKey: "yes"
    });
  });

  it("maps non-hold decisions to no for binary unchanged-rate markets", async () => {
    const inspection = await BOI_RATE_DECISION_SOURCE_ADAPTER.inspectResolution(
      {
        ...BASE_CONTEXT,
        marketTitle: "האם בנק ישראל ישאיר את הריבית ללא שינוי?",
        marketContract: {
          ...BASE_CONTEXT.marketContract,
          resultShape: "yes_no",
          oracleCapability: "supported_final_only",
          measurement: "האם בנק ישראל ישאיר את הריבית ללא שינוי?",
          outcomeMap: [
            { outcomeLabel: "כן", evidenceKey: "yes" },
            { outcomeLabel: "לא", evidenceKey: "no" }
          ]
        }
      },
      {
        now: new Date("2026-08-31T13:15:00.000Z"),
        fetchText: async () => `
          <article>
            <h1>החלטת הריבית</h1>
            <p>25/05/2026</p>
            <p>הוועדה המוניטרית החליטה להעלות את הריבית ב-0.25 נקודות אחוז.</p>
          </article>
        `
      }
    );

    expect(inspection).toMatchObject({
      status: "final",
      evidenceKey: "no",
      winnerLabel: "לא"
    });
    expect(inspection.normalizedSnapshot).toMatchObject({
      rawEvidenceKey: "hike-025",
      evidenceKey: "no"
    });
  });

  it("returns not-started when no official rate decision language is present", async () => {
    const inspection = await BOI_RATE_DECISION_SOURCE_ADAPTER.inspectResolution(BASE_CONTEXT, {
      now: new Date("2026-05-24T13:15:00.000Z"),
      fetchText: async () => `
        <main>
          <h1>מועדי החלטות הריבית</h1>
          <p>ההחלטה הבאה תפורסם בתאריך 25 במאי 2026.</p>
        </main>
      `
    });

    expect(inspection).toMatchObject({
      sourceFamily: "boi_rate_decision",
      status: "not_started",
      resolutionAvailable: false
    });
    expect(inspection).not.toHaveProperty("evidenceKey");
  });

  it("reports BOI browser-verification pages as fetch blockers instead of not-started decisions", async () => {
    const inspection = await BOI_RATE_DECISION_SOURCE_ADAPTER.inspectResolution(BASE_CONTEXT, {
      now: new Date("2026-05-25T13:15:00.000Z"),
      fetchText: async () => `
        <html>
          <head><script src="https://validate.perfdrive.com/stormcaster.js"></script></head>
          <body>Radware Page Verifying your browser before proceeding...</body>
        </html>
      `
    });

    expect(inspection).toMatchObject({
      sourceFamily: "boi_rate_decision",
      status: "unknown",
      resolutionAvailable: false,
      blockers: ["boi_waf_challenge"],
      normalizedSnapshot: {
        fetchBlocked: true,
        blocker: "boi_waf_challenge"
      }
    });
  });

  it("discovers the target BOI press release from a generic official page and infers a 0.25 cut from the previous rate", async () => {
    const context: OracleLifecycleSourceContext = {
      ...BASE_CONTEXT,
      marketId: "disc-boi-rate-decision-2026-07-06",
      marketTitle: "החלטת הריבית של בנק ישראל ב-6 ביולי",
      closeAt: "2026-07-06T13:00:00.000Z",
      resolutionSource: "https://www.boi.org.il/en/",
      marketContract: {
        ...BASE_CONTEXT.marketContract,
        oracleCapability: "supported_final_only",
        resolutionSource: {
          url: "https://www.boi.org.il/en/",
          sourceIds: ["src_boi_announcements"]
        },
        timeline: {
          closeAt: "2026-07-06T13:00:00.000Z",
          expectedResolutionAt: "2026-07-06T13:30:00.000Z"
        },
        outcomeMap: [
          { outcomeLabel: "הורדת ריבית של 0.50 נק׳ ומעלה", evidenceKey: "cut-050-plus" },
          { outcomeLabel: "הורדת ריבית של 0.25 נק׳", evidenceKey: "cut-025" },
          { outcomeLabel: "ללא שינוי", evidenceKey: "hold" },
          { outcomeLabel: "העלאת ריבית של 0.25 נק׳", evidenceKey: "hike-025" },
          { outcomeLabel: "העלאת ריבית של 0.50 נק׳ ומעלה", evidenceKey: "hike-050-plus" }
        ]
      }
    };
    const fetchText = async (url: string) => {
      if (url === "https://www.boi.org.il/en/") {
        return `
          <a href="/en/communication-and-publications/press-releases/25-05-2026/">
            The Monetary Committee decides on May 25, 2026 to lower the interest to 3.75 percent.
          </a>
          <a href="/en/communication-and-publications/press-releases/the-monetary-committee-decides-on-july-6-2026-to-lower-the-interest-rate-to-35-percent/">
            The Monetary Committee decides on July 6, 2026 to lower the interest rate to 3.5 percent.
          </a>
        `;
      }

      if (url === "https://www.boi.org.il/en/economic-roles/monetary-policy/") {
        return "";
      }

      return `
        <article>
          <h1>The Monetary Committee decides on July 6, 2026 to lower the interest rate to 3.5 percent.</h1>
          <p>06/07/2026</p>
        </article>
      `;
    };

    const inspection = await BOI_RATE_DECISION_SOURCE_ADAPTER.inspectResolution(context, {
      now: new Date("2026-07-06T13:45:00.000Z"),
      fetchText
    });

    expect(inspection).toMatchObject({
      sourceUrl:
        "https://www.boi.org.il/en/communication-and-publications/press-releases/the-monetary-committee-decides-on-july-6-2026-to-lower-the-interest-rate-to-35-percent/",
      status: "final",
      evidenceKey: "cut-025",
      winnerLabel: "ירידה 0.25%",
      confidence: "high"
    });
    expect(inspection.normalizedSnapshot).toMatchObject({
      targetDateIso: "2026-07-06",
      sourceDateIso: "2026-07-06",
      previousRate: 3.75
    });
  });

  it("does not let an older BOI decision resolve a later target date", async () => {
    const inspection = await BOI_RATE_DECISION_SOURCE_ADAPTER.inspectResolution(
      {
        ...BASE_CONTEXT,
        closeAt: "2026-09-03T13:00:00.000Z",
        marketContract: {
          ...BASE_CONTEXT.marketContract,
          timeline: {
            closeAt: "2026-09-03T13:00:00.000Z"
          }
        }
      },
      {
        now: new Date("2026-09-03T13:15:00.000Z"),
        fetchText: async () => `
          <article>
            <h1>The Monetary Committee decides on July 6, 2026 to lower the interest rate to 3.5 percent.</h1>
            <p>06/07/2026</p>
          </article>
        `
      }
    );

    expect(inspection).toMatchObject({
      status: "not_started",
      resolutionAvailable: false
    });
    expect(inspection.normalizedSnapshot).toMatchObject({
      targetDateIso: "2026-09-03",
      sourceDateIso: "2026-07-06"
    });
  });
});
