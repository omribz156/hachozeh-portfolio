import { describe, expect, it } from "vitest";

import { WIMBLEDON_OFFICIAL_SOURCE_ADAPTER } from "../../../../oracle/src/adapters/wimbledon-official-source-adapter";
import type { OracleLifecycleSourceContext } from "../../../../oracle/src/source-adapter-contracts";

const BASE_CONTEXT: OracleLifecycleSourceContext = {
  marketId: "disc-wimbledon-proof",
  marketTitle: "פרי נגד זברב",
  marketStatus: "open",
  closeAt: "2026-07-10T12:30:00.000Z",
  closeOnEventCompletion: true,
  eventCompletionCloseRequiresHumanApproval: true,
  resolutionSource: "https://www.wimbledon.com/en_GB/scores/schedule/8",
  resolutionRules: "Resolve from the official Wimbledon result.",
  oracleSourcePolicy: null,
  marketContract: {
    objectType: "market_contract_v1",
    measurementKind: "final_winner",
    resultShape: "home_away_winner",
    oracleCapability: "supported_full_cycle",
    resolutionSource: {
      url: "https://www.wimbledon.com/en_GB/scores/schedule/8",
      sourceIds: ["src_wimbledon_official"]
    },
    operational: {
      wimbledonMatchId: "1602"
    } as never,
    outcomeMap: [
      {
        outcomeLabel: "ארתור פרי",
        evidenceKey: "home",
        resolutionPath: "Arthur Fery is the official Wimbledon match winner."
      },
      {
        outcomeLabel: "אלכסנדר זברב",
        evidenceKey: "away",
        resolutionPath: "Alexander Zverev is the official Wimbledon match winner."
      }
    ]
  },
  outcomes: [
    {
      outcomeId: "home",
      outcomeKey: "home",
      label: "ארתור פרי"
    },
    {
      outcomeId: "away",
      outcomeKey: "away",
      label: "אלכסנדר זברב"
    }
  ]
};

const DAYS_PAYLOAD = {
  data: {
    scheduleDays: [{ year: 2026, tournDay: 19, released: true, message: "Day 12 Friday 10 July" }]
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

function match(overrides: Record<string, unknown>) {
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

describe("Wimbledon official source adapter", () => {
  it("maps a completed official semifinal to the winning side", async () => {
    const result = await WIMBLEDON_OFFICIAL_SOURCE_ADAPTER.inspectResolution(BASE_CONTEXT, {
      now: new Date("2026-07-10T18:00:00.000Z"),
      fetchJson: fetchSequence([DAYS_PAYLOAD, schedulePayload([match({})])])
    });

    expect(result).toMatchObject({
      sourceFamily: "wimbledon_official",
      status: "final",
      closeConditionSatisfied: true,
      resolutionAvailable: true,
      evidenceKey: "away",
      winnerKind: "away",
      winnerLabel: "Alexander Zverev",
      confidence: "high"
    });
    expect(result.rawHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps a scheduled semifinal unresolved", async () => {
    const result = await WIMBLEDON_OFFICIAL_SOURCE_ADAPTER.inspectCloseCondition(BASE_CONTEXT, {
      now: new Date("2026-07-10T09:00:00.000Z"),
      fetchJson: fetchSequence([
        DAYS_PAYLOAD,
        schedulePayload([
          match({
            status: null,
            statusCode: "B",
            team1: [{ firstNameA: "Arthur", lastNameA: "Fery", won: false }],
            team2: [{ firstNameA: "Alexander", lastNameA: "Zverev", won: false }]
          })
        ])
      ])
    });

    expect(result).toMatchObject({
      status: "not_started",
      closeConditionSatisfied: false,
      resolutionAvailable: false
    });
  });

  it("resolves tournament child markets to no after official elimination", async () => {
    const result = await WIMBLEDON_OFFICIAL_SOURCE_ADAPTER.inspectResolution(
      {
        ...BASE_CONTEXT,
        marketTitle: "האם ארתור פרי יזכה בווימבלדון 2026?",
        marketContract: {
          ...BASE_CONTEXT.marketContract!,
          resultShape: "yes_no",
          outcomeMap: [
            {
              outcomeLabel: "כן",
              evidenceKey: "yes",
              resolutionPath: "Arthur Fery wins the Wimbledon 2026 gentlemen's singles title."
            },
            {
              outcomeLabel: "לא",
              evidenceKey: "no",
              resolutionPath:
                "Arthur Fery is eliminated, withdraws before winning, or another player wins Wimbledon 2026."
            }
          ]
        }
      },
      {
        now: new Date("2026-07-10T18:00:00.000Z"),
        fetchJson: fetchSequence([DAYS_PAYLOAD, schedulePayload([match({})])])
      }
    );

    expect(result).toMatchObject({
      status: "final",
      closeConditionSatisfied: true,
      resolutionAvailable: true,
      evidenceKey: "no",
      winnerKind: "named"
    });
  });

  it("resolves tournament child markets to yes after the official final win", async () => {
    const result = await WIMBLEDON_OFFICIAL_SOURCE_ADAPTER.inspectResolution(
      {
        ...BASE_CONTEXT,
        marketTitle: "האם יאניק סינר יזכה בווימבלדון 2026?",
        marketContract: {
          ...BASE_CONTEXT.marketContract!,
          resultShape: "yes_no",
          outcomeMap: [
            {
              outcomeLabel: "כן",
              evidenceKey: "yes",
              resolutionPath: "Jannik Sinner wins the Wimbledon 2026 gentlemen's singles title."
            },
            {
              outcomeLabel: "לא",
              evidenceKey: "no",
              resolutionPath:
                "Jannik Sinner is eliminated, withdraws before winning, or another player wins Wimbledon 2026."
            }
          ]
        }
      },
      {
        now: new Date("2026-07-12T19:00:00.000Z"),
        fetchJson: fetchSequence([
          DAYS_PAYLOAD,
          schedulePayload([
            match({
              matchId: "1701",
              roundName: "Final",
              team1: [{ firstNameA: "Jannik", lastNameA: "Sinner", won: true }],
              team2: [{ firstNameA: "Alexander", lastNameA: "Zverev", won: false }]
            })
          ])
        ])
      }
    );

    expect(result).toMatchObject({
      status: "final",
      closeConditionSatisfied: true,
      resolutionAvailable: true,
      evidenceKey: "yes",
      winnerKind: "named"
    });
  });

  it("does not treat a completed quarterfinal as the tournament final", async () => {
    const result = await WIMBLEDON_OFFICIAL_SOURCE_ADAPTER.inspectResolution(
      {
        ...BASE_CONTEXT,
        marketTitle: "האם נובאק ג׳וקוביץ׳ יזכה בווימבלדון 2026?",
        marketContract: {
          ...BASE_CONTEXT.marketContract!,
          resultShape: "yes_no",
          operational: {
            wimbledonPlayerName: "Novak Djokovic"
          } as never,
          outcomeMap: [
            {
              outcomeLabel: "כן",
              evidenceKey: "yes",
              resolutionPath: "Novak Djokovic wins the Wimbledon 2026 gentlemen's singles title."
            },
            {
              outcomeLabel: "לא",
              evidenceKey: "no",
              resolutionPath:
                "Novak Djokovic is eliminated, withdraws before winning, or another player wins Wimbledon 2026."
            }
          ]
        }
      },
      {
        now: new Date("2026-07-09T18:00:00.000Z"),
        fetchJson: fetchSequence([
          DAYS_PAYLOAD,
          schedulePayload([
            match({
              matchId: "1502",
              roundName: "Quarter-Finals",
              roundNameShort: "QF",
              team1: [{ firstNameA: "Felix", lastNameA: "Auger-Aliassime", won: false }],
              team2: [{ firstNameA: "Novak", lastNameA: "Djokovic", won: true }]
            })
          ])
        ])
      }
    );

    expect(result).toMatchObject({
      status: "not_started",
      closeConditionSatisfied: false,
      resolutionAvailable: false
    });
    expect(result.normalizedSnapshot).toMatchObject({
      finalMatch: null
    });
  });

  it("does not let an earlier finals-named round override a later official elimination", async () => {
    const result = await WIMBLEDON_OFFICIAL_SOURCE_ADAPTER.inspectResolution(
      {
        ...BASE_CONTEXT,
        marketTitle: "האם נובאק ג׳וקוביץ׳ יזכה בווימבלדון 2026?",
        marketContract: {
          ...BASE_CONTEXT.marketContract!,
          resultShape: "yes_no",
          operational: {
            wimbledonPlayerName: "Novak Djokovic"
          } as never,
          outcomeMap: [
            {
              outcomeLabel: "כן",
              evidenceKey: "yes",
              resolutionPath: "Novak Djokovic wins the Wimbledon 2026 gentlemen's singles title."
            },
            {
              outcomeLabel: "לא",
              evidenceKey: "no",
              resolutionPath:
                "Novak Djokovic is eliminated, withdraws before winning, or another player wins Wimbledon 2026."
            }
          ]
        }
      },
      {
        now: new Date("2026-07-10T21:00:00.000Z"),
        fetchJson: fetchSequence([
          DAYS_PAYLOAD,
          schedulePayload([
            match({
              matchId: "1502",
              roundName: "Quarter-Finals",
              roundNameShort: "QF",
              team1: [{ firstNameA: "Felix", lastNameA: "Auger-Aliassime", won: false }],
              team2: [{ firstNameA: "Novak", lastNameA: "Djokovic", won: true }]
            }),
            match({
              matchId: "1601",
              roundName: "Semi-Finals",
              roundNameShort: "SF",
              team1: [{ firstNameA: "Jannik", lastNameA: "Sinner", won: true }],
              team2: [{ firstNameA: "Novak", lastNameA: "Djokovic", won: false }]
            })
          ])
        ])
      }
    );

    expect(result).toMatchObject({
      status: "final",
      closeConditionSatisfied: true,
      resolutionAvailable: true,
      evidenceKey: "no",
      winnerKind: "named"
    });
    expect(result.normalizedSnapshot).toMatchObject({
      finalMatch: null,
      resolutionMatch: {
        matchId: "1601",
        roundName: "Semi-Finals"
      }
    });
  });
});
