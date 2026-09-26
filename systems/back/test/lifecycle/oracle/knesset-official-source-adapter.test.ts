import { describe, expect, it } from "vitest";

import { KNESSET_OFFICIAL_SOURCE_ADAPTER } from "../../../../oracle/src/adapters/knesset-official-source-adapter";
import type { OracleLifecycleSourceContext } from "../../../../oracle/src/source-adapter-contracts";

const BASE_CONTEXT: OracleLifecycleSourceContext = {
  marketId: "disc-cm-legislation-basic-law-2026",
  marketTitle: "האם חוק-יסוד: לימוד תורה יעבור עד סוף 2026?",
  marketStatus: "closed",
  closeAt: "2026-12-31T21:00:00.000Z",
  closeOnEventCompletion: false,
  eventCompletionCloseRequiresHumanApproval: true,
  resolutionSource: "https://main.knesset.gov.il/apps/legislation/main/bills/2198907",
  resolutionRules: "מוכרע לפי סטטוס רשמי במאגר החקיקה הלאומי של הכנסת.",
  oracleSourcePolicy: {
    preferredSourceIds: ["src_knesset_official"],
    resolutionSourceIds: ["src_knesset_official"]
  },
  marketContract: {
    objectType: "market_contract_v1",
    measurementKind: "deadline_yes_no",
    resultShape: "yes_no",
    oracleCapability: "supported_final_only",
    resolutionSource: {
      url: "https://main.knesset.gov.il/apps/legislation/main/bills/2198907",
      sourceIds: ["src_knesset_official"]
    },
    outcomeMap: [
      {
        outcomeLabel: "כן",
        evidenceKey: "yes"
      },
      {
        outcomeLabel: "לא",
        evidenceKey: "no"
      }
    ]
  },
  outcomes: [
    {
      outcomeId: "disc-cm-legislation-basic-law-2026-yes",
      outcomeKey: "disc-cm-legislation-basic-law-2026-yes",
      label: "כן"
    },
    {
      outcomeId: "disc-cm-legislation-basic-law-2026-no",
      outcomeKey: "disc-cm-legislation-basic-law-2026-no",
      label: "לא"
    }
  ]
};

function context(overrides: Partial<OracleLifecycleSourceContext> = {}): OracleLifecycleSourceContext {
  return {
    ...BASE_CONTEXT,
    ...overrides
  };
}

describe("Knesset official legislation source adapter", () => {
  it("supports event-completion close from the same official final status", async () => {
    const inspection = await KNESSET_OFFICIAL_SOURCE_ADAPTER.inspectCloseCondition(
      context({
        marketStatus: "open",
        closeOnEventCompletion: true,
        eventCompletionCloseRequiresHumanApproval: false
      }),
      {
        now: new Date("2026-07-14T08:00:00.000Z"),
        fetchJson: async () => ({
          value: [
            {
              BillID: 2198907,
              Name: "הצעת חוק-יסוד: לימוד תורה",
              StatusID: 118,
              LastUpdatedDate: "2026-07-14T07:55:00"
            }
          ]
        })
      }
    );

    expect(KNESSET_OFFICIAL_SOURCE_ADAPTER.capabilities.closeCondition).toBe(true);
    expect(inspection).toMatchObject({
      status: "final",
      closeConditionSatisfied: true,
      resolutionAvailable: true,
      evidenceKey: "yes",
      winnerLabel: "כן"
    });
  });

  it("returns in-progress state for official non-final bill status", async () => {
    const inspection = await KNESSET_OFFICIAL_SOURCE_ADAPTER.inspectResolution(context(), {
      now: new Date("2026-11-01T10:00:00.000Z"),
      fetchJson: async () => ({
        value: [
          {
            BillID: 2198907,
            Name: "הצעת חוק-יסוד: לימוד תורה",
            StatusID: 113,
            LastUpdatedDate: "2026-07-01T22:22:55.553"
          }
        ]
      })
    });

    expect(inspection).toMatchObject({
      sourceFamily: "knesset_official_legislation",
      status: "live",
      closeConditionSatisfied: false,
      resolutionAvailable: false
    });
    expect(inspection).not.toHaveProperty("evidenceKey");
    expect(inspection.blockers).toEqual([]);
  });

  it("maps official third-reading acceptance status to yes", async () => {
    const inspection = await KNESSET_OFFICIAL_SOURCE_ADAPTER.inspectResolution(context(), {
      now: new Date("2026-12-31T20:00:00.000Z"),
      fetchJson: async () => ({
        value: [
          {
            BillID: 2198907,
            Name: "הצעת חוק-יסוד: לימוד תורה",
            StatusID: 118,
            LastUpdatedDate: "2026-12-20T18:00:00"
          }
        ]
      })
    });

    expect(inspection).toMatchObject({
      sourceFamily: "knesset_official_legislation",
      status: "final",
      resolutionAvailable: true,
      evidenceKey: "yes",
      winnerLabel: "כן",
      blockers: []
    });
  });

  it("maps explicit terminal non-passage status to no", async () => {
    const inspection = await KNESSET_OFFICIAL_SOURCE_ADAPTER.inspectResolution(context(), {
      now: new Date("2026-12-31T20:00:00.000Z"),
      fetchJson: async () => ({
        value: [
          {
            BillID: 2198907,
            Name: "הצעת חוק-יסוד: לימוד תורה",
            StatusID: 177,
            LastUpdatedDate: "2026-12-20T18:00:00"
          }
        ]
      })
    });

    expect(inspection).toMatchObject({
      sourceFamily: "knesset_official_legislation",
      status: "final",
      resolutionAvailable: true,
      evidenceKey: "no",
      winnerLabel: "לא",
      blockers: []
    });
  });

  it("requires manual review for merged bill status", async () => {
    const inspection = await KNESSET_OFFICIAL_SOURCE_ADAPTER.inspectResolution(context(), {
      now: new Date("2026-12-31T20:00:00.000Z"),
      fetchJson: async () => ({
        value: [
          {
            BillID: 2198907,
            Name: "הצעת חוק-יסוד: לימוד תורה",
            StatusID: 122,
            LastUpdatedDate: "2026-12-20T18:00:00"
          }
        ]
      })
    });

    expect(inspection).toMatchObject({
      sourceFamily: "knesset_official_legislation",
      status: "unknown",
      resolutionAvailable: false
    });
    expect(inspection.blockers).toEqual(["knesset_bill_status_requires_manual_review"]);
  });

  it("returns a blocker when the official bill status is missing", async () => {
    const inspection = await KNESSET_OFFICIAL_SOURCE_ADAPTER.inspectResolution(context(), {
      now: new Date("2026-12-31T20:00:00.000Z"),
      fetchJson: async () => ({ value: [] })
    });

    expect(inspection).toMatchObject({
      sourceFamily: "knesset_official_legislation",
      status: "unknown",
      resolutionAvailable: false
    });
    expect(inspection.blockers).toEqual(["knesset_bill_status_unrecognized"]);
  });
});
