import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import { inspectOpenMarketCloseConditions } from "../../../../oracle/src/lifecycle-run-close-conditions";
import type { OracleLifecycleSourceContext } from "../../../../oracle/src/source-adapter-contracts";

const DAYS_PAYLOAD = {
  data: {
    scheduleDays: [{ year: 2026, tournDay: 19, released: true }]
  }
};

function schedulePayload(matches: unknown[]) {
  return {
    data: {
      schedule: {
        year: 2026,
        tournDay: 19,
        courts: [
          {
            courtName: "Centre Court",
            matches
          }
        ]
      }
    }
  };
}

function wimbledonMatch(overrides: Record<string, unknown>) {
  return {
    matchId: "1602",
    eventName: "Gentlemen's Singles",
    eventCode: "MS",
    roundName: "Semi-Finals",
    status: "Completed",
    statusCode: "D",
    team1: [
      {
        firstNameA: "Arthur",
        lastNameA: "Fery",
        displayNameA: "A. Fery",
        idA: "atpf0dm",
        won: false
      }
    ],
    team2: [
      {
        firstNameA: "Alexander",
        lastNameA: "Zverev",
        displayNameA: "A. Zverev",
        idA: "atpz355",
        won: true
      }
    ],
    ...overrides
  };
}

function fetchSequence(payloads: unknown[]) {
  let index = 0;
  return async () => payloads[index++] ?? payloads[payloads.length - 1];
}

function tournamentChildContext(
  overrides?: Partial<OracleLifecycleSourceContext>
): OracleLifecycleSourceContext {
  return {
    marketId: "disc-wimbledon-2026-men-winner-arthur-fery",
    marketTitle: "האם ארתור פרי יזכה בווימבלדון 2026?",
    marketStatus: "open",
    closeAt: "2026-07-12T18:00:00.000Z",
    closeOnEventCompletion: true,
    eventCompletionCloseRequiresHumanApproval: false,
    resolutionSource: "https://www.wimbledon.com/en_GB/draws/gentlemens-singles",
    resolutionRules: "Resolve from the official Wimbledon result.",
    oracleSourcePolicy: null,
    marketContract: {
      objectType: "market_contract_v1",
      marketKindId: "sports.tournament-winner",
      measurementKind: "final_winner",
      resultShape: "yes_no",
      oracleCapability: "supported_full_cycle",
      resolutionSource: {
        url: "https://www.wimbledon.com/en_GB/draws/gentlemens-singles",
        sourceIds: ["src_wimbledon_official"]
      },
      outcomeMap: [
        {
          outcomeLabel: "כן",
          evidenceKey: "yes",
          resolutionPath: "Arthur Fery wins the Wimbledon 2026 gentlemen's singles title."
        },
        {
          outcomeLabel: "לא",
          evidenceKey: "no",
          resolutionPath: "Arthur Fery is eliminated or another player wins Wimbledon 2026."
        }
      ],
      operational: {
        eventPack: "wimbledon-2026-men",
        earlyEliminationClose: true,
        sourceAdapter: "wimbledon_official",
        wimbledonPlayerName: "Arthur Fery"
      }
    } as OracleLifecycleSourceContext["marketContract"],
    outcomes: [
      { outcomeId: "yes", outcomeKey: "yes", label: "כן" },
      { outcomeId: "no", outcomeKey: "no", label: "לא" }
    ],
    ...overrides
  };
}

function knessetLawContext(): OracleLifecycleSourceContext {
  return {
    marketId: "disc-torah-study-basic-law-passes-2026",
    marketTitle: "האם חוק-יסוד: לימוד תורה יעבור עד סוף 2026?",
    marketStatus: "open",
    closeAt: "2026-12-31T21:59:00.000Z",
    closeOnEventCompletion: true,
    eventCompletionCloseRequiresHumanApproval: false,
    resolutionSource: "https://main.knesset.gov.il/apps/legislation/main/bills/2198907",
    resolutionRules: "אישור סופי בקריאה השנייה והשלישית.",
    oracleSourcePolicy: {
      preferredSourceIds: ["src_knesset_official"],
      resolutionSourceIds: ["src_knesset_official"]
    },
    marketContract: {
      objectType: "market_contract_v1",
      marketKindId: "legislation.bill-deadline",
      measurementKind: "deadline_yes_no",
      resultShape: "yes_no",
      oracleCapability: "supported_full_cycle",
      resolutionSource: {
        url: "https://main.knesset.gov.il/apps/legislation/main/bills/2198907",
        sourceIds: ["src_knesset_official"]
      },
      outcomeMap: [
        { outcomeLabel: "כן", evidenceKey: "yes" },
        { outcomeLabel: "לא", evidenceKey: "no" }
      ],
      operational: {
        officialBillId: "2198907",
        terminalEvidenceAutoClose: true
      }
    } as OracleLifecycleSourceContext["marketContract"],
    outcomes: [
      { outcomeId: "yes", outcomeKey: "yes", label: "כן" },
      { outcomeId: "no", outcomeKey: "no", label: "לא" }
    ]
  };
}

describe("lifecycle open-market close conditions", () => {
  it("closes an open legislation market when the official bill status becomes final", async () => {
    const closeMarket = vi.fn(async () => ({
      marketId: "disc-torah-study-basic-law-passes-2026",
      status: "closed" as const,
      closedAt: "2026-07-14T08:00:00.000Z",
      triggerType: "oracle_confirmed_event_completion" as const,
      auditEventId: "audit_knesset_terminal_close"
    }));

    const result = await inspectOpenMarketCloseConditions({} as Pool, {
      contexts: [knessetLawContext()],
      dryRun: false,
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
      }),
      closeMarket
    });

    expect(closeMarket).toHaveBeenCalledWith(
      expect.anything(),
      "disc-torah-study-basic-law-passes-2026",
      expect.objectContaining({
        triggerType: "oracle_confirmed_event_completion",
        approvedByHumanId: null
      }),
      expect.anything()
    );
    expect(result).toMatchObject([
      {
        action: "closed_market",
        status: "final",
        closeConditionSatisfied: true
      }
    ]);
  });

  it("closes an eliminated tournament-winner child from terminal official evidence without resolving payout", async () => {
    const closeMarket = vi.fn(async () => ({
      marketId: "disc-wimbledon-2026-men-winner-arthur-fery",
      status: "closed" as const,
      closedAt: "2026-07-10T18:00:00.000Z",
      triggerType: "oracle_confirmed_event_completion" as const,
      auditEventId: "audit_terminal_close"
    }));

    const result = await inspectOpenMarketCloseConditions({} as Pool, {
      contexts: [tournamentChildContext()],
      dryRun: false,
      now: new Date("2026-07-10T18:00:00.000Z"),
      fetchJson: fetchSequence([DAYS_PAYLOAD, schedulePayload([wimbledonMatch({})])]),
      closeMarket
    });

    expect(closeMarket).toHaveBeenCalledWith(
      expect.anything(),
      "disc-wimbledon-2026-men-winner-arthur-fery",
      expect.objectContaining({
        triggerType: "oracle_confirmed_event_completion",
        approvedByHumanId: null,
        oracleCaseId: null,
        sourceUrl: "https://www.wimbledon.com/graphql"
      }),
      expect.objectContaining({
        actorId: "system:horizon-scheduler"
      })
    );
    expect(result).toMatchObject([
      {
        marketId: "disc-wimbledon-2026-men-winner-arthur-fery",
        action: "closed_market",
        status: "final",
        closeConditionSatisfied: true,
        close: {
          auditEventId: "audit_terminal_close"
        }
      }
    ]);
  });

  it("keeps terminal official evidence human-gated when the market contract requires close approval", async () => {
    const closeMarket = vi.fn();

    const result = await inspectOpenMarketCloseConditions({} as Pool, {
      contexts: [
        tournamentChildContext({
          eventCompletionCloseRequiresHumanApproval: true
        })
      ],
      dryRun: true,
      now: new Date("2026-07-10T18:00:00.000Z"),
      fetchJson: fetchSequence([DAYS_PAYLOAD, schedulePayload([wimbledonMatch({})])]),
      closeMarket
    });

    expect(closeMarket).not.toHaveBeenCalled();
    expect(result).toMatchObject([
      {
        action: "would_create_case",
        status: "final",
        closeConditionSatisfied: true
      }
    ]);
  });

  it("does not close tournament-winner children on completed non-final wins", async () => {
    const closeMarket = vi.fn();

    const result = await inspectOpenMarketCloseConditions({} as Pool, {
      contexts: [
        tournamentChildContext({
          marketId: "disc-wimbledon-2026-men-winner-novak-djokovic",
          marketTitle: "האם נובאק ג׳וקוביץ׳ יזכה בווימבלדון 2026?",
          marketContract: {
            ...tournamentChildContext().marketContract!,
            outcomeMap: [
              {
                outcomeLabel: "כן",
                evidenceKey: "yes",
                resolutionPath: "Novak Djokovic wins the Wimbledon 2026 gentlemen's singles title."
              },
              {
                outcomeLabel: "לא",
                evidenceKey: "no",
                resolutionPath: "Novak Djokovic is eliminated or another player wins Wimbledon 2026."
              }
            ],
            operational: {
              eventPack: "wimbledon-2026-men",
              earlyEliminationClose: true,
              sourceAdapter: "wimbledon_official",
              wimbledonPlayerName: "Novak Djokovic"
            }
          } as OracleLifecycleSourceContext["marketContract"]
        })
      ],
      dryRun: false,
      now: new Date("2026-07-09T18:00:00.000Z"),
      fetchJson: fetchSequence([
        DAYS_PAYLOAD,
        schedulePayload([
          wimbledonMatch({
            matchId: "1502",
            roundName: "Quarter-Finals",
            roundNameShort: "QF",
            team1: [{ firstNameA: "Felix", lastNameA: "Auger-Aliassime", won: false }],
            team2: [{ firstNameA: "Novak", lastNameA: "Djokovic", won: true }]
          })
        ])
      ]),
      closeMarket
    });

    expect(closeMarket).not.toHaveBeenCalled();
    expect(result).toMatchObject([
      {
        marketId: "disc-wimbledon-2026-men-winner-novak-djokovic",
        action: "skipped_not_satisfied",
        status: "not_started",
        closeConditionSatisfied: false
      }
    ]);
  });
});
