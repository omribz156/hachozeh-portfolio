import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import {
  protectDependentMarketsFromOfficialFinal,
  runOracleOfficialFinalIntake
} from "../../../../oracle/src/official-final-intake-service";

afterEach(() => vi.unstubAllEnvs());

function createPool() {
  const query = vi.fn(async (sql: string) => {
    if (sql === "begin" || sql === "commit" || sql === "rollback") {
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes("from markets m")) {
      return {
        rows: [
          {
            market_id: "disc-cm-nba-proof",
            market_title: "מי תנצח במשחק 7: Toronto Raptors או Cleveland Cavaliers?",
            close_at: new Date("2026-05-03T23:30:00.000Z"),
            closed_at: new Date("2026-05-03T23:30:01.318Z"),
            resolution_source:
              "NBA official final game result: https://www.nba.com/game/tor-vs-cle-0042500137",
            resolution_rules:
              "Resolve to the winner listed on https://www.nba.com/game/tor-vs-cle-0042500137.",
            oracle_source_policy: {
              resolutionSourceIds: ["src_nba_official_games"],
              notes: [
                "resolve-role=NBA official final game result: https://www.nba.com/game/tor-vs-cle-0042500137"
              ]
            }
          }
        ],
        rowCount: 1
      };
    }

    if (sql.includes("from markets") && sql.includes("where id = $1")) {
      return {
        rows: [
          {
            id: "disc-cm-nba-proof",
            status: "closed",
            title: "מי תנצח במשחק 7: Toronto Raptors או Cleveland Cavaliers?",
            close_at: new Date("2026-05-03T23:30:00.000Z"),
            resolution_source:
              "NBA official final game result: https://www.nba.com/game/tor-vs-cle-0042500137",
            resolution_rules:
              "Resolve to the winner listed on https://www.nba.com/game/tor-vs-cle-0042500137.",
            oracle_source_policy: {
              resolutionSourceIds: ["src_nba_official_games"]
            }
          }
        ],
        rowCount: 1
      };
    }

    if (sql.includes("from market_outcomes")) {
      return {
        rows: [
          {
            id: "disc-cm-nba-proof-toronto-raptors",
            label: "Toronto Raptors",
            is_winner: null
          },
          {
            id: "disc-cm-nba-proof-option-2",
            label: "Cleveland Cavaliers",
            is_winner: null
          }
        ],
        rowCount: 2
      };
    }

    if (sql.includes("from oracle_cases oc") && sql.includes("oracle_evidence_packets")) {
      return {
        rows: [],
        rowCount: 0
      };
    }

    if (
      sql.includes("insert into oracle_cases") ||
      sql.includes("insert into oracle_evidence_packets") ||
      sql.includes("insert into oracle_case_outputs") ||
      sql.includes("insert into lifecycle_events")
    ) {
      return {
        rows: [],
        rowCount: 1
      };
    }

    if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });

  return {
    query,
    connect: vi.fn(async () => ({
      query,
      release: vi.fn()
    }))
  } as unknown as Pool & { query: typeof query };
}

describe("official-final dependent protection", () => {
  it("closes an eliminated open child before human resolution approval", async () => {
    const close = vi.fn(async () => ({
      marketId: "winner-france", status: "closed" as const,
      closedAt: "2026-07-14T21:00:00.000Z",
      triggerType: "oracle_confirmed_event_completion" as const,
      auditEventId: "audit-1"
    }));
    const plan = vi.fn(async () => ({
      objectType: "dependent_resolution_cascade_plan" as const,
      triggerMarketId: "france-spain", triggerWinningOutcomeId: "spain",
      action: "resolve_dependents_no" as const,
      facts: [{ factType: "entity_eliminated" as const, entityLabel: "France", entityKeys: ["france"] }],
      dependentActions: [{
        marketId: "winner-france", action: "resolve_no" as const, noOutcomeId: "winner-france-no",
        currentStatus: "open" as const, reason: "dependent_entity_eliminated" as const,
        entityLabel: "France", entityKeys: ["france"]
      }],
      skippedMarkets: [], blockers: [],
      context: { oracleCaseId: null, reviewId: null, candidateCount: 1 }
    }));

    const closed = await protectDependentMarketsFromOfficialFinal({
      dbPool: {} as Pool,
      triggerMarketId: "france-spain",
      winningOutcomeId: "spain",
      evidenceKey: "official-hash",
      sourceUrl: "https://www.fifa.com/match",
      claimSummary: "Official final: France 0, Spain 2.",
      generatedAt: "2026-07-14T21:00:00.000Z"
    }, { plan, close });

    expect(closed).toEqual(["winner-france"]);
    expect(close).toHaveBeenCalledWith(
      expect.anything(),
      "winner-france",
      expect.objectContaining({
        approvedByHumanId: null,
        idempotencyKey: "official-final-protective-close:france-spain:official-hash:winner-france"
      }),
      expect.objectContaining({ actorId: expect.any(String) })
    );
  });
});

function createKnicksPool() {
  const query = vi.fn(async (sql: string) => {
    if (sql === "begin" || sql === "commit" || sql === "rollback") {
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes("from markets m")) {
      return {
        rows: [
          {
            market_id: "disc-cm-nba-2026-05-04-76ers-knicks-game1",
            market_title: "מי תנצח במשחק 1: פילדלפיה סיקסרס או ניו יורק ניקס?",
            close_at: new Date("2026-05-05T00:00:00.000Z"),
            closed_at: new Date("2026-05-05T18:27:49.292Z"),
            resolution_source:
              "תוצאת המשחק הרשמית ב-NBA.com: https://www.nba.com/game/phi-vs-nyk-0042500211",
            resolution_rules:
              "השוק מוכרע לפי המנצחת הרשמית בתוצאה הסופית. התוצאה הזוכה חייבת להיות אחת מהתוצאות הרשומות: פילדלפיה סיקסרס / ניו יורק ניקס.",
            oracle_source_policy: {
              resolutionSourceIds: ["src_nba_official_games"]
            }
          }
        ],
        rowCount: 1
      };
    }

    if (sql.includes("from markets") && sql.includes("where id = $1")) {
      return {
        rows: [
          {
            id: "disc-cm-nba-2026-05-04-76ers-knicks-game1",
            status: "closed",
            title: "מי תנצח במשחק 1: פילדלפיה סיקסרס או ניו יורק ניקס?",
            close_at: new Date("2026-05-05T00:00:00.000Z"),
            resolution_source:
              "תוצאת המשחק הרשמית ב-NBA.com: https://www.nba.com/game/phi-vs-nyk-0042500211",
            resolution_rules:
              "השוק מוכרע לפי המנצחת הרשמית בתוצאה הסופית. התוצאה הזוכה חייבת להיות אחת מהתוצאות הרשומות: פילדלפיה סיקסרס / ניו יורק ניקס.",
            oracle_source_policy: {
              resolutionSourceIds: ["src_nba_official_games"]
            }
          }
        ],
        rowCount: 1
      };
    }

    if (sql.includes("from market_outcomes")) {
      return {
        rows: [
          {
            id: "disc-cm-nba-2026-05-04-76ers-knicks-game1-76ers",
            label: "פילדלפיה סיקסרס",
            is_winner: null
          },
          {
            id: "disc-cm-nba-2026-05-04-76ers-knicks-game1-option-2",
            label: "ניו יורק ניקס",
            is_winner: null
          }
        ],
        rowCount: 2
      };
    }

    if (sql.includes("from oracle_cases oc") && sql.includes("oracle_evidence_packets")) {
      return {
        rows: [],
        rowCount: 0
      };
    }

    if (
      sql.includes("insert into oracle_cases") ||
      sql.includes("insert into oracle_evidence_packets") ||
      sql.includes("insert into oracle_case_outputs") ||
      sql.includes("insert into lifecycle_events")
    ) {
      return {
        rows: [],
        rowCount: 1
      };
    }

    if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });

  return {
    query,
    connect: vi.fn(async () => ({
      query,
      release: vi.fn()
    }))
  } as unknown as Pool & { query: typeof query };
}

function createDeadlineNoPool() {
  const contract = {
    objectType: "market_contract_v1",
    measurementKind: "deadline_yes_no",
    resultShape: "yes_no",
    resolutionSource: {
      label: "ועדת הבחירות המרכזית",
      url: "https://www.bechirot.gov.il/home/",
      sourceIds: ["src_knesset_elections"]
    },
    outcomeMap: [
      { outcomeLabel: "כן", evidenceKey: "yes" },
      { outcomeLabel: "לא", evidenceKey: "no" }
    ]
  };
  const query = vi.fn(async (sql: string) => {
    if (sql === "begin" || sql === "commit" || sql === "rollback") {
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes("from markets m")) {
      return {
        rows: [
          {
            market_id: "event-election-ladder-2026-06",
            market_title: "האם הבחירות בישראל יתקיימו במהלך יוני 2026?",
            close_at: new Date("2026-06-30T20:59:00.000Z"),
            closed_at: new Date("2026-06-30T21:00:05.000Z"),
            resolution_source: "ועדת הבחירות המרכזית: https://www.bechirot.gov.il/home/",
            resolution_rules: "כן אם הבחירות לכנסת בישראל יתקיימו במהלך יוני 2026. אחרת לא.",
            oracle_source_policy: {
              resolutionSourceIds: ["src_knesset_elections"]
            },
            market_contract: contract
          }
        ],
        rowCount: 1
      };
    }

    if (sql.includes("from markets") && sql.includes("where id = $1")) {
      return {
        rows: [
          {
            id: "event-election-ladder-2026-06",
            status: "closed",
            title: "האם הבחירות בישראל יתקיימו במהלך יוני 2026?",
            close_at: new Date("2026-06-30T20:59:00.000Z"),
            resolution_source: "ועדת הבחירות המרכזית: https://www.bechirot.gov.il/home/",
            resolution_rules: "כן אם הבחירות לכנסת בישראל יתקיימו במהלך יוני 2026. אחרת לא.",
            oracle_source_policy: {
              resolutionSourceIds: ["src_knesset_elections"]
            },
            market_contract: contract
          }
        ],
        rowCount: 1
      };
    }

    if (sql.includes("from market_outcomes")) {
      return {
        rows: [
          {
            id: "event-election-ladder-2026-06-yes",
            label: "כן",
            is_winner: null
          },
          {
            id: "event-election-ladder-2026-06-no",
            label: "לא",
            is_winner: null
          }
        ],
        rowCount: 2
      };
    }

    if (sql.includes("from oracle_cases oc") && sql.includes("oracle_evidence_packets")) {
      return {
        rows: [],
        rowCount: 0
      };
    }

    if (
      sql.includes("insert into oracle_cases") ||
      sql.includes("insert into oracle_evidence_packets") ||
      sql.includes("insert into oracle_case_outputs") ||
      sql.includes("insert into lifecycle_events")
    ) {
      return {
        rows: [],
        rowCount: 1
      };
    }

    if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });

  return {
    query,
    connect: vi.fn(async () => ({
      query,
      release: vi.fn()
    }))
  } as unknown as Pool & { query: typeof query };
}

function createThunderLakersPool() {
  const query = vi.fn(async (sql: string) => {
    if (sql === "begin" || sql === "commit" || sql === "rollback") {
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes("from markets m")) {
      return {
        rows: [
          {
            market_id: "disc-cm-nba-2026-05-11-thunder-lakers-game4",
            market_title: "מי תנצח במשחק 4: אוקלהומה סיטי ת'אנדר או לוס אנג'לס לייקרס?",
            close_at: new Date("2026-05-12T02:30:00.000Z"),
            closed_at: new Date("2026-05-12T02:34:17.940Z"),
            resolution_source:
              "תוצאת המשחק הרשמית ב-NBA.com: https://www.nba.com/game/okc-vs-lal-0042500224",
            resolution_rules:
              "השוק מוכרע לפי המנצחת הרשמית בתוצאה הסופית. התוצאה הזוכה חייבת להיות אחת מהתוצאות הרשומות: אוקלהומה סיטי ת'אנדר / לוס אנג'לס לייקרס.",
            oracle_source_policy: {
              resolutionSourceIds: ["src_nba_official_games"]
            }
          }
        ],
        rowCount: 1
      };
    }

    if (sql.includes("from markets") && sql.includes("where id = $1")) {
      return {
        rows: [
          {
            id: "disc-cm-nba-2026-05-11-thunder-lakers-game4",
            status: "closed",
            title: "מי תנצח במשחק 4: אוקלהומה סיטי ת'אנדר או לוס אנג'לס לייקרס?",
            close_at: new Date("2026-05-12T02:30:00.000Z"),
            resolution_source:
              "תוצאת המשחק הרשמית ב-NBA.com: https://www.nba.com/game/okc-vs-lal-0042500224",
            resolution_rules:
              "השוק מוכרע לפי המנצחת הרשמית בתוצאה הסופית. התוצאה הזוכה חייבת להיות אחת מהתוצאות הרשומות: אוקלהומה סיטי ת'אנדר / לוס אנג'לס לייקרס.",
            oracle_source_policy: {
              resolutionSourceIds: ["src_nba_official_games"]
            }
          }
        ],
        rowCount: 1
      };
    }

    if (sql.includes("from market_outcomes")) {
      return {
        rows: [
          {
            id: "disc-cm-nba-2026-05-11-thunder-lakers-game4-option-1",
            label: "אוקלהומה סיטי ת'אנדר",
            is_winner: null
          },
          {
            id: "disc-cm-nba-2026-05-11-thunder-lakers-game4-option-2",
            label: "לוס אנג'לס לייקרס",
            is_winner: null
          }
        ],
        rowCount: 2
      };
    }

    if (sql.includes("from oracle_cases oc") && sql.includes("oracle_evidence_packets")) {
      return {
        rows: [],
        rowCount: 0
      };
    }

    if (
      sql.includes("insert into oracle_cases") ||
      sql.includes("insert into oracle_evidence_packets") ||
      sql.includes("insert into oracle_case_outputs") ||
      sql.includes("insert into lifecycle_events")
    ) {
      return {
        rows: [],
        rowCount: 1
      };
    }

    if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });

  return {
    query,
    connect: vi.fn(async () => ({
      query,
      release: vi.fn()
    }))
  } as unknown as Pool & { query: typeof query };
}

function createNikeLigaPool() {
  const query = vi.fn(async (sql: string) => {
    if (sql === "begin" || sql === "commit" || sql === "rollback") {
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes("from markets m")) {
      return {
        rows: [
          {
            market_id: "disc-cm-nike-liga-podbrezova-slovan-bratislava-2026-05-09",
            market_title:
              "מה תהיה התוצאה הרשמית במשחק פודברזובה נגד סלובן ברטיסלבה?",
            close_at: new Date("2026-05-09T16:00:00.000Z"),
            closed_at: new Date("2026-05-09T16:00:01.000Z"),
            resolution_source: "https://www.nikeliga.sk/zapas/2772-pod-slo",
            resolution_rules: "Resolve from the official Niké Liga match page.",
            oracle_source_policy: {
              resolutionSourceIds: ["src_nike_liga_official"]
            }
          }
        ],
        rowCount: 1
      };
    }

    if (sql.includes("from markets") && sql.includes("where id = $1")) {
      return {
        rows: [
          {
            id: "disc-cm-nike-liga-podbrezova-slovan-bratislava-2026-05-09",
            status: "closed",
            title: "מה תהיה התוצאה הרשמית במשחק פודברזובה נגד סלובן ברטיסלבה?",
            close_at: new Date("2026-05-09T16:00:00.000Z"),
            resolution_source: "https://www.nikeliga.sk/zapas/2772-pod-slo",
            resolution_rules: "Resolve from the official Niké Liga match page.",
            oracle_source_policy: {
              resolutionSourceIds: ["src_nike_liga_official"]
            }
          }
        ],
        rowCount: 1
      };
    }

    if (sql.includes("from market_outcomes")) {
      return {
        rows: [
          {
            id: "disc-cm-nike-liga-podbrezova-slovan-bratislava-2026-05-09-home",
            label: "פודברזובה",
            is_winner: null
          },
          {
            id: "disc-cm-nike-liga-podbrezova-slovan-bratislava-2026-05-09-draw",
            label: "תיקו",
            is_winner: null
          },
          {
            id: "disc-cm-nike-liga-podbrezova-slovan-bratislava-2026-05-09-away",
            label: "סלובן ברטיסלבה",
            is_winner: null
          }
        ],
        rowCount: 3
      };
    }

    if (sql.includes("from oracle_cases oc") && sql.includes("oracle_evidence_packets")) {
      return {
        rows: [],
        rowCount: 0
      };
    }

    if (
      sql.includes("insert into oracle_cases") ||
      sql.includes("insert into oracle_evidence_packets") ||
      sql.includes("insert into oracle_case_outputs") ||
      sql.includes("insert into lifecycle_events")
    ) {
      return {
        rows: [],
        rowCount: 1
      };
    }

    if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });

  return {
    query,
    connect: vi.fn(async () => ({
      query,
      release: vi.fn()
    }))
  } as unknown as Pool & { query: typeof query };
}

function createBlockedContractPool() {
  const query = vi.fn(async (sql: string) => {
    if (sql === "begin" || sql === "commit" || sql === "rollback") {
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes("from markets m")) {
      return {
        rows: [
          {
            market_id: "disc-cm-ecb-rate-proof",
            market_title: "מה תעשה ה-ECB?",
            close_at: new Date("2026-06-04T12:00:00.000Z"),
            closed_at: new Date("2026-06-04T12:00:01.000Z"),
            resolution_source: null,
            resolution_rules: null,
            oracle_source_policy: null,
            market_contract: {
              objectType: "market_contract_v1",
              measurementKind: "rate_direction",
              resultShape: "cut_hold_hike",
              oracleCapability: "blocked",
              resolutionSource: {
                url: "https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html",
                sourceIds: ["src_ecb_rss"]
              },
              resolutionRule: "Resolve from ECB official source."
            }
          }
        ],
        rowCount: 1
      };
    }

    if (sql.includes("from market_outcomes")) {
      return {
        rows: [
          {
            id: "disc-cm-ecb-rate-proof-hold",
            label: "ללא שינוי",
            is_winner: null
          }
        ],
        rowCount: 1
      };
    }

    if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });

  return {
    query,
    connect: vi.fn(async () => ({
      query,
      release: vi.fn()
    }))
  } as unknown as Pool & { query: typeof query };
}

function createBoiManualContractPool() {
  const query = vi.fn(async (sql: string) => {
    if (sql === "begin" || sql === "commit" || sql === "rollback") {
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes("from markets m")) {
      return {
        rows: [
          {
            market_id: "disc-cm-boi-rate-decision-may-25-2026",
            market_title: "ריבית בנק ישראל: 25 במאי",
            close_at: new Date("2026-05-25T13:00:00.000Z"),
            closed_at: new Date("2026-05-25T13:00:01.000Z"),
            resolution_source: null,
            resolution_rules: null,
            oracle_source_policy: null,
            market_contract: {
              objectType: "market_contract_v1",
              measurementKind: "rate_direction",
              resultShape: "cut_hold_hike",
              oracleCapability: "manual_resolution_required",
              resolutionSource: {
                url: "https://www.boi.org.il/en/communication-and-publications/press-releases/25-05-2026/",
                sourceIds: ["src_boi_announcements"]
              },
              resolutionRule: "מוכרע לפי הודעת הריבית הרשמית של בנק ישראל.",
              outcomeMap: [
                { outcomeLabel: "ירידה 0.25%", evidenceKey: "cut-025" },
                { outcomeLabel: "ללא שינוי", evidenceKey: "hold" },
                { outcomeLabel: "עלייה 0.25%", evidenceKey: "hike-025" }
              ]
            }
          }
        ],
        rowCount: 1
      };
    }

    if (sql.includes("from markets") && sql.includes("where id = $1")) {
      return {
        rows: [
          {
            id: "disc-cm-boi-rate-decision-may-25-2026",
            status: "closed",
            title: "ריבית בנק ישראל: 25 במאי",
            close_at: new Date("2026-05-25T13:00:00.000Z"),
            resolution_source: "https://www.boi.org.il/en/communication-and-publications/press-releases/25-05-2026/",
            resolution_rules: "מוכרע לפי הודעת הריבית הרשמית של בנק ישראל.",
            oracle_source_policy: null,
            market_contract: {
              objectType: "market_contract_v1",
              measurementKind: "rate_direction",
              resultShape: "cut_hold_hike",
              oracleCapability: "manual_resolution_required",
              resolutionSource: {
                url: "https://www.boi.org.il/en/communication-and-publications/press-releases/25-05-2026/",
                sourceIds: ["src_boi_announcements"]
              },
              resolutionRule: "מוכרע לפי הודעת הריבית הרשמית של בנק ישראל.",
              outcomeMap: [
                { outcomeLabel: "ירידה 0.25%", evidenceKey: "cut-025" },
                { outcomeLabel: "ללא שינוי", evidenceKey: "hold" },
                { outcomeLabel: "עלייה 0.25%", evidenceKey: "hike-025" }
              ]
            }
          }
        ],
        rowCount: 1
      };
    }

    if (sql.includes("from market_outcomes")) {
      return {
        rows: [
          {
            id: "disc-cm-boi-rate-decision-may-25-2026-cut",
            label: "ירידה 0.25%",
            is_winner: null
          },
          {
            id: "disc-cm-boi-rate-decision-may-25-2026-hold",
            label: "ללא שינוי",
            is_winner: null
          },
          {
            id: "disc-cm-boi-rate-decision-may-25-2026-hike",
            label: "עלייה 0.25%",
            is_winner: null
          }
        ],
        rowCount: 3
      };
    }

    if (sql.includes("from oracle_cases oc") && sql.includes("oracle_evidence_packets")) {
      return {
        rows: [],
        rowCount: 0
      };
    }

    if (
      sql.includes("insert into oracle_cases") ||
      sql.includes("insert into oracle_evidence_packets") ||
      sql.includes("insert into oracle_case_outputs") ||
      sql.includes("insert into lifecycle_events")
    ) {
      return {
        rows: [],
        rowCount: 1
      };
    }

    if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });

  return {
    query,
    connect: vi.fn(async () => ({
      query,
      release: vi.fn()
    }))
  } as unknown as Pool & { query: typeof query };
}

function createImsPool() {
  const marketContract = {
    objectType: "market_contract_v1",
    measurementKind: "threshold_crossing",
    resultShape: "yes_no",
    oracleCapability: "supported_final_only",
    resolutionSource: {
      url: "https://ims.gov.il/en/data_gov",
      sourceIds: ["src_ims_daily_observations"]
    },
    resolutionRule:
      "השוק מוכרע לפי ערך TDmax הרשמי של השירות המטאורולוגי בתחנת תל-אביב, חוף עבור 12 במאי 2026: 30.0°C ומעלה = כן; פחות מ-30.0°C = לא.",
    outcomeMap: [
      { outcomeLabel: "כן", evidenceKey: "yes" },
      { outcomeLabel: "לא", evidenceKey: "no" }
    ]
  };
  const query = vi.fn(async (sql: string) => {
    if (sql === "begin" || sql === "commit" || sql === "rollback") {
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes("from markets m")) {
      return {
        rows: [
          {
            market_id: "disc-cm-ims-tel-aviv-30c-2026-05-12",
            market_title: "האם הטמפרטורה המקסימלית בתל אביב תגיע ב-12 במאי ל-30 מעלות?",
            close_at: new Date("2026-05-11T21:00:00.000Z"),
            closed_at: new Date("2026-05-11T21:00:01.000Z"),
            resolution_source: "https://ims.gov.il/en/data_gov",
            resolution_rules: marketContract.resolutionRule,
            oracle_source_policy: {
              resolutionSourceIds: ["src_ims_daily_observations"]
            },
            market_contract: marketContract
          }
        ],
        rowCount: 1
      };
    }

    if (sql.includes("from markets") && sql.includes("where id = $1")) {
      return {
        rows: [
          {
            id: "disc-cm-ims-tel-aviv-30c-2026-05-12",
            status: "closed",
            title: "האם הטמפרטורה המקסימלית בתל אביב תגיע ב-12 במאי ל-30 מעלות?",
            close_at: new Date("2026-05-11T21:00:00.000Z"),
            resolution_source: "https://ims.gov.il/en/data_gov",
            resolution_rules: marketContract.resolutionRule,
            oracle_source_policy: {
              resolutionSourceIds: ["src_ims_daily_observations"]
            },
            market_contract: marketContract
          }
        ],
        rowCount: 1
      };
    }

    if (sql.includes("from market_outcomes")) {
      return {
        rows: [
          {
            id: "disc-cm-ims-tel-aviv-30c-2026-05-12-yes",
            label: "כן",
            is_winner: null
          },
          {
            id: "disc-cm-ims-tel-aviv-30c-2026-05-12-no",
            label: "לא",
            is_winner: null
          }
        ],
        rowCount: 2
      };
    }

    if (sql.includes("from oracle_cases oc") && sql.includes("oracle_evidence_packets")) {
      return {
        rows: [],
        rowCount: 0
      };
    }

    if (
      sql.includes("insert into oracle_cases") ||
      sql.includes("insert into oracle_evidence_packets") ||
      sql.includes("insert into oracle_case_outputs") ||
      sql.includes("insert into lifecycle_events")
    ) {
      return {
        rows: [],
        rowCount: 1
      };
    }

    if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });

  return {
    query,
    connect: vi.fn(async () => ({
      query,
      release: vi.fn()
    }))
  } as unknown as Pool & { query: typeof query };
}

function createCoinbasePool() {
  const marketContract = {
    objectType: "market_contract_v1",
    measurementKind: "threshold_crossing",
    resultShape: "yes_no",
    oracleCapability: "supported_final_only",
    resolutionSource: {
      url: "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400",
      sourceIds: ["src_coinbase_exchange_candles"]
    },
    resolutionRule:
      "מוכרע לפי נר BTC-USD יומי של Coinbase Exchange עבור 12 במאי 2026 לפי UTC. כן אם הסגירה מעל 80,000 דולר.",
    outcomeMap: [
      { outcomeLabel: "כן", evidenceKey: "yes" },
      { outcomeLabel: "לא", evidenceKey: "no" }
    ]
  };
  const query = vi.fn(async (sql: string) => {
    if (sql === "begin" || sql === "commit" || sql === "rollback") {
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes("from markets m")) {
      return {
        rows: [
          {
            market_id: "disc-cm-front-sixpack-coinbase-btc-usd-close-above-80000-2026-05-12",
            market_title: "האם ביטקוין יסגור מעל 80,000 דולר ב-12 במאי לפי Coinbase?",
            close_at: new Date("2026-05-13T00:00:00.000Z"),
            closed_at: new Date("2026-05-13T00:00:01.000Z"),
            resolution_source: "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400",
            resolution_rules: marketContract.resolutionRule,
            oracle_source_policy: {
              resolutionSourceIds: ["src_coinbase_exchange_candles"]
            },
            market_contract: marketContract
          }
        ],
        rowCount: 1
      };
    }

    if (sql.includes("from markets") && sql.includes("where id = $1")) {
      return {
        rows: [
          {
            id: "disc-cm-front-sixpack-coinbase-btc-usd-close-above-80000-2026-05-12",
            status: "closed",
            title: "האם ביטקוין יסגור מעל 80,000 דולר ב-12 במאי לפי Coinbase?",
            close_at: new Date("2026-05-13T00:00:00.000Z"),
            resolution_source: "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400",
            resolution_rules: marketContract.resolutionRule,
            oracle_source_policy: {
              resolutionSourceIds: ["src_coinbase_exchange_candles"]
            },
            market_contract: marketContract
          }
        ],
        rowCount: 1
      };
    }

    if (sql.includes("from market_outcomes")) {
      return {
        rows: [
          {
            id: "disc-cm-front-sixpack-coinbase-btc-usd-close-above-80000-2026-05-12-option-1",
            label: "כן",
            is_winner: null
          },
          {
            id: "disc-cm-front-sixpack-coinbase-btc-usd-close-above-80000-2026-05-12-option-2",
            label: "לא",
            is_winner: null
          }
        ],
        rowCount: 2
      };
    }

    if (sql.includes("from oracle_cases oc") && sql.includes("oracle_evidence_packets")) {
      return {
        rows: [],
        rowCount: 0
      };
    }

    if (
      sql.includes("insert into oracle_cases") ||
      sql.includes("insert into oracle_evidence_packets") ||
      sql.includes("insert into oracle_case_outputs") ||
      sql.includes("insert into lifecycle_events")
    ) {
      return {
        rows: [],
        rowCount: 1
      };
    }

    if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });

  return {
    query,
    connect: vi.fn(async () => ({
      query,
      release: vi.fn()
    }))
  } as unknown as Pool & { query: typeof query };
}

function createIfaOutcomeMapPrimaryPool() {
  const marketContract = {
    objectType: "market_contract_v1",
    measurementKind: "final_winner",
    resultShape: "three_way_result",
    resolutionSource: {
      url: "https://www.football.org.il/games/?game_id=123456",
      sourceIds: ["src_ifa_fixtures_results"]
    },
    resolutionRule: "Resolve from the official IFA fixture result.",
    outcomeMap: [
      { outcomeLabel: "מכבי תל אביב", evidenceKey: "home" },
      { outcomeLabel: "תיקו", evidenceKey: "draw" },
      { outcomeLabel: "הפועל באר שבע", evidenceKey: "away" }
    ]
  };
  const query = vi.fn(async (sql: string) => {
    if (sql === "begin" || sql === "commit" || sql === "rollback") {
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes("from markets m")) {
      return {
        rows: [
          {
            market_id: "disc-cm-ifa-outcome-map-primary",
            market_title: "מי תנצח במשחק?",
            close_at: new Date("2026-05-27T19:00:00.000Z"),
            closed_at: new Date("2026-05-27T21:00:00.000Z"),
            resolution_source: null,
            resolution_rules: null,
            oracle_source_policy: null,
            market_contract: marketContract
          }
        ],
        rowCount: 1
      };
    }

    if (sql.includes("from markets") && sql.includes("where id = $1")) {
      return {
        rows: [
          {
            id: "disc-cm-ifa-outcome-map-primary",
            status: "closed",
            title: "מי תנצח במשחק?",
            close_at: new Date("2026-05-27T19:00:00.000Z"),
            resolution_source: null,
            resolution_rules: null,
            oracle_source_policy: null,
            market_contract: marketContract
          }
        ],
        rowCount: 1
      };
    }

    if (sql.includes("from market_outcomes")) {
      return {
        rows: [
          {
            id: "disc-cm-ifa-outcome-map-primary-home",
            label: "הפועל באר שבע",
            is_winner: null
          },
          {
            id: "disc-cm-ifa-outcome-map-primary-draw",
            label: "תיקו",
            is_winner: null
          },
          {
            id: "disc-cm-ifa-outcome-map-primary-away",
            label: "מכבי תל אביב",
            is_winner: null
          }
        ],
        rowCount: 3
      };
    }

    if (sql.includes("from oracle_cases oc") && sql.includes("oracle_evidence_packets")) {
      return {
        rows: [],
        rowCount: 0
      };
    }

    if (
      sql.includes("insert into oracle_cases") ||
      sql.includes("insert into oracle_evidence_packets") ||
      sql.includes("insert into oracle_case_outputs") ||
      sql.includes("insert into lifecycle_events")
    ) {
      return {
        rows: [],
        rowCount: 1
      };
    }

    if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });

  return {
    query,
    connect: vi.fn(async () => ({
      query,
      release: vi.fn()
    }))
  } as unknown as Pool & { query: typeof query };
}

describe("runOracleOfficialFinalIntake", () => {
  it("does not hide closed markets behind expected-resolution time", async () => {
    const seenSql: string[] = [];
    const query = vi.fn(async (sql: string) => {
      seenSql.push(sql);

      if (sql.includes("from markets m")) {
        return { rows: [], rowCount: 0 };
      }

      if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
        return { rows: [], rowCount: 0 };
      }

      throw new Error(`Unexpected query: ${sql}`);
    });
    const pool = { query } as unknown as Pool;

    const result = await runOracleOfficialFinalIntake(pool);

    const candidateSql = seenSql.find((sql) => sql.includes("from markets m"));
    expect(result.checkedMarketCount).toBe(0);
    expect(candidateSql).not.toContain("expectedResolutionAt");
    expect(candidateSql).not.toContain("expected_resolution_at::timestamptz <= now()");
  });

  it("does not treat a passed deadline as evidence for No on unsupported yes/no markets", async () => {
    const pool = createDeadlineNoPool();

    const result = await runOracleOfficialFinalIntake(pool, {
      limit: 5,
      now: new Date("2026-07-01T08:00:00.000Z")
    });

    expect(result).toMatchObject({
      createdCaseCount: 0,
      skippedCount: 1,
      items: [
        {
          marketId: "event-election-ladder-2026-06",
          action: "skipped_unsupported_source",
          winningOutcomeKey: null,
          winningOutcomeLabel: null,
          approvalRequired: true,
          reason: "No Oracle lifecycle source adapter supports this market's official source family."
        }
      ]
    });
  });

  it("creates a human-gated resolution case from an official final NBA result", async () => {
    const pool = createPool();

    const result = await runOracleOfficialFinalIntake(pool, {
      limit: 5,
      fetchJson: async () => ({
        game: {
          gameStatus: 3,
          gameStatusText: "Final",
          gameTimeUTC: "2026-05-03T23:30:00Z",
          homeTeam: {
            teamCity: "Cleveland",
            teamName: "Cavaliers",
            teamTricode: "CLE",
            score: 114
          },
          awayTeam: {
            teamCity: "Toronto",
            teamName: "Raptors",
            teamTricode: "TOR",
            score: 102
          }
        }
      }),
      now: new Date("2026-05-04T18:00:00.000Z")
    });

    expect(result).toMatchObject({
      objectType: "oracle_official_final_intake_result",
      createdCaseCount: 1,
      skippedCount: 0,
      items: [
        {
          marketId: "disc-cm-nba-proof",
          action: "created_case",
          sourceUrl: "https://www.nba.com/game/tor-vs-cle-0042500137",
          officialStatus: "Final",
          winningOutcomeLabel: "Cleveland Cavaliers"
        }
      ]
    });
    expect(result.items[0]?.oracleCaseId).toMatch(/^orc_/);
    expect(result.items[0]?.approvalRequired).toBe(true);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("insert into oracle_cases"),
      expect.arrayContaining(["disc-cm-nba-proof", "resolution_check"])
    );
  });

  it("does not create a case when the official result is not final", async () => {
    const pool = createPool();

    const result = await runOracleOfficialFinalIntake(pool, {
      fetchJson: async () => ({
        game: {
          gameStatus: 2,
          gameStatusText: "Q4",
          homeTeam: {
            teamCity: "Cleveland",
            teamName: "Cavaliers",
            teamTricode: "CLE",
            score: 100
          },
          awayTeam: {
            teamCity: "Toronto",
            teamName: "Raptors",
            teamTricode: "TOR",
            score: 100
          }
        }
      }),
      now: new Date("2026-05-04T18:00:00.000Z")
    });

    expect(result).toMatchObject({
      createdCaseCount: 0,
      skippedCount: 1,
      items: [
        {
          action: "skipped_not_final",
          officialStatus: "Q4"
        }
      ]
    });
    expect(pool.query).not.toHaveBeenCalledWith(
      expect.stringContaining("insert into oracle_cases"),
      expect.anything()
    );
  });

  it("maps Hebrew NBA labels without matching the wrong outcome from the full market slug", async () => {
    const pool = createKnicksPool();

    const result = await runOracleOfficialFinalIntake(pool, {
      fetchJson: async () => ({
        game: {
          gameStatus: 3,
          gameStatusText: "Final",
          homeTeam: {
            teamCity: "New York",
            teamName: "Knicks",
            teamTricode: "NYK",
            score: 137
          },
          awayTeam: {
            teamCity: "Philadelphia",
            teamName: "76ers",
            teamTricode: "PHI",
            score: 98
          }
        }
      }),
      now: new Date("2026-05-05T18:00:00.000Z")
    });

    expect(result.items[0]).toMatchObject({
      action: "created_case",
      winningOutcomeKey: "disc-cm-nba-2026-05-04-76ers-knicks-game1-option-2",
      winningOutcomeLabel: "ניו יורק ניקס"
    });
  });

  it("maps English NBA official winners to Hebrew-only Thunder/Lakers outcomes", async () => {
    const pool = createThunderLakersPool();

    const result = await runOracleOfficialFinalIntake(pool, {
      fetchJson: async () => ({
        game: {
          gameStatus: 3,
          gameStatusText: "Final",
          homeTeam: {
            teamCity: "Oklahoma City",
            teamName: "Thunder",
            teamTricode: "OKC",
            score: 118
          },
          awayTeam: {
            teamCity: "Los Angeles",
            teamName: "Lakers",
            teamTricode: "LAL",
            score: 106
          }
        }
      }),
      now: new Date("2026-05-12T10:15:00.000Z")
    });

    expect(result).toMatchObject({
      createdCaseCount: 1,
      skippedCount: 0,
      items: [
        {
          action: "created_case",
          winningOutcomeKey: "disc-cm-nba-2026-05-11-thunder-lakers-game4-option-1",
          winningOutcomeLabel: "אוקלהומה סיטי ת'אנדר"
        }
      ]
    });
  });

  it("creates a human-gated resolution case from a supported non-NBA official match page", async () => {
    const pool = createNikeLigaPool();

    const result = await runOracleOfficialFinalIntake(pool, {
      fetchText: async () => `
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
      `,
      now: new Date("2026-05-09T18:10:00.000Z")
    });

    expect(result).toMatchObject({
      createdCaseCount: 1,
      skippedCount: 0,
      items: [
        {
          action: "created_case",
          marketId: "disc-cm-nike-liga-podbrezova-slovan-bratislava-2026-05-09",
          sourceUrl: "https://www.nikeliga.sk/zapas/2772-pod-slo",
          officialStatus: "final",
          winningOutcomeLabel: "סלובן ברטיסלבה"
        }
      ]
    });
  });

  it("uses contract evidenceKey outcomeMap before source-family positional fallback", async () => {
    const pool = createIfaOutcomeMapPrimaryPool();

    const result = await runOracleOfficialFinalIntake(pool, {
      fetchText: async () => `
        <main>
          משחק הפועל באר שבע - מכבי תל אביב
          תוצאה 1:2
          הסתיים
        </main>
      `,
      now: new Date("2026-05-27T21:15:00.000Z")
    });

    expect(result).toMatchObject({
      createdCaseCount: 1,
      skippedCount: 0,
      items: [
        {
          action: "created_case",
          marketId: "disc-cm-ifa-outcome-map-primary",
          winningOutcomeId: "disc-cm-ifa-outcome-map-primary-home",
          winningOutcomeKey: "away",
          winningOutcomeLabel: "הפועל באר שבע"
        }
      ]
    });
  });

  it("does not create a resolution case when Seer contract marks Oracle capability blocked", async () => {
    const pool = createBlockedContractPool();

    const result = await runOracleOfficialFinalIntake(pool, {
      now: new Date("2026-06-04T15:00:00.000Z")
    });

    expect(result).toMatchObject({
      createdCaseCount: 0,
      skippedCount: 1,
      items: [
        {
          marketId: "disc-cm-ecb-rate-proof",
          action: "skipped_unsupported_source",
          sourceUrl: "https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html",
          reason: expect.stringContaining("blocked")
        }
      ]
    });
    expect(pool.query).not.toHaveBeenCalledWith(
      expect.stringContaining("insert into oracle_cases"),
      expect.anything()
    );
  });

  it("creates a human-gated BOI resolution case through contract evidenceKey mapping", async () => {
    const pool = createBoiManualContractPool();

    const result = await runOracleOfficialFinalIntake(pool, {
      fetchText: async () => `
        <article>
          <h1>החלטת הריבית</h1>
          <p>25/05/2026</p>
          <p>הוועדה המוניטרית החליטה להותיר את הריבית ללא שינוי ברמה של 4.50%.</p>
        </article>
      `,
      now: new Date("2026-05-25T13:15:00.000Z")
    });

    expect(result).toMatchObject({
      createdCaseCount: 1,
      skippedCount: 0,
      items: [
        {
          marketId: "disc-cm-boi-rate-decision-may-25-2026",
          action: "created_case",
          sourceUrl: "https://www.boi.org.il/en/communication-and-publications/press-releases/25-05-2026/",
          officialStatus: "final",
          winningOutcomeId: "disc-cm-boi-rate-decision-may-25-2026-hold",
          winningOutcomeKey: "hold",
          winningOutcomeLabel: "ללא שינוי",
          approvalRequired: true
        }
      ]
    });
  });

  it("creates a human-gated IMS weather resolution case through threshold evidenceKey mapping", async () => {
    // Capability checks require configuration even though this test injects the response.
    vi.stubEnv("IMS_API_TOKEN", "fixture-ims-token");
    const pool = createImsPool();

    const result = await runOracleOfficialFinalIntake(pool, {
      fetchJson: async () => ({
        data: [
          {
            date: "2026-05-12",
            channels: [
              {
                name: "TDmax",
                value: "30.4"
              }
            ]
          }
        ]
      }),
      now: new Date("2026-05-13T07:00:00.000Z")
    });

    expect(result).toMatchObject({
      createdCaseCount: 1,
      skippedCount: 0,
      items: [
        {
          marketId: "disc-cm-ims-tel-aviv-30c-2026-05-12",
          action: "created_case",
          sourceUrl: "https://ims.gov.il/en/data_gov",
          officialJsonUrl: "https://api.ims.gov.il/v1/envista/stations/178/data/daily/2026/05/12",
          officialStatus: "final",
          winningOutcomeId: "disc-cm-ims-tel-aviv-30c-2026-05-12-yes",
          winningOutcomeKey: "yes",
          winningOutcomeLabel: "כן",
          approvalRequired: true
        }
      ]
    });
  });

  it("creates a human-gated Coinbase resolution case through official candle evidence", async () => {
    const pool = createCoinbasePool();

    const result = await runOracleOfficialFinalIntake(pool, {
      fetchJson: async () => [[1778544000, 79000, 81200, 79500, 80500, 100]],
      now: new Date("2026-05-13T07:00:00.000Z")
    });

    expect(result).toMatchObject({
      createdCaseCount: 1,
      skippedCount: 0,
      items: [
        {
          marketId: "disc-cm-front-sixpack-coinbase-btc-usd-close-above-80000-2026-05-12",
          action: "created_case",
          officialStatus: "final",
          winningOutcomeId: "disc-cm-front-sixpack-coinbase-btc-usd-close-above-80000-2026-05-12-option-1",
          winningOutcomeKey: "yes",
          winningOutcomeLabel: "כן",
          approvalRequired: true
        }
      ]
    });
  });

  it("uses the DB outcome id for Coinbase inspection while reporting the contract evidence key", async () => {
    const pool = createCoinbasePool();

    const result = await runOracleOfficialFinalIntake(pool, {
      fetchJson: async () => [[1778544000, 76000, 79900, 79500, 79000, 100]],
      now: new Date("2026-05-13T07:00:00.000Z")
    });

    expect(result).toMatchObject({
      createdCaseCount: 1,
      skippedCount: 0,
      items: [
        {
          marketId: "disc-cm-front-sixpack-coinbase-btc-usd-close-above-80000-2026-05-12",
          action: "created_case",
          winningOutcomeId: "disc-cm-front-sixpack-coinbase-btc-usd-close-above-80000-2026-05-12-option-2",
          winningOutcomeKey: "no",
          winningOutcomeLabel: "לא"
        }
      ]
    });
  });
});
