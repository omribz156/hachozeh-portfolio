import { describe, expect, it, vi } from "vitest";

import type { AppEnv } from "../../../src/config/env";
import type { Queryable } from "../../../src/db/client/pool";
import {
  PortfolioSnapshotServiceError,
  readPortfolioSnapshot
} from "../../../src/engine/portfolio/portfolio-snapshot-service";

const BASE_ENV: AppEnv = {
  serviceName: "navi-backend",
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 3001,
  logLevel: "info",
  auth: {
    sessionCookieName: "navi_session",
    sessionTtlHours: 24 * 7,
    otpTtlMinutes: 10,
    otpResendCooldownSeconds: 30,
    otpMaxAttempts: 5,
    devOtpCode: "111111"
  },
  actorMode: {
    demoEnabled: true,
    demoActorId: "seed_user_1"
  },
  db: {
    host: "127.0.0.1",
    port: 5432,
    name: "navi",
    user: "navi",
    password: "navi",
    connectTimeoutMs: 1500
  }
};

function createQueryable(options?: {
  includeCashAccount?: boolean;
  realizedPnlTotal?: string;
  positions?: Array<{
    market_id: string;
    market_title: string;
    category_key?: string | null;
    market_contract?: unknown;
    market_status: string;
    persisted_status?: string | null;
    outcome_id: string;
    outcome_label: string;
    outcome_count?: number;
    complement_outcome_id?: string | null;
    complement_outcome_label?: string | null;
    shares: string;
    cost_basis: string;
    realized_pnl: string;
    current_price: string;
    outcome_image_url?: string | null;
  }>;
  contractPositions?: Array<{
    market_id: string;
    market_title: string;
    category_key?: string | null;
    market_contract?: unknown;
    market_status: string;
    persisted_status?: string | null;
    requested_outcome_id: string;
    requested_outcome_label: string;
    complement_outcome_id?: string | null;
    complement_outcome_label?: string | null;
    contract_side: "yes" | "no";
    outcome_count?: number;
    shares: string;
    cost_basis: string;
    realized_pnl: string;
    current_price: string;
    outcome_image_url?: string | null;
  }>;
}): Queryable {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("from accounts")) {
        return {
          rows: options?.includeCashAccount === false ? [] : [{ balance_cached: "9900.000000" }]
        };
      }

      if (sql.includes("from realization_events")) {
        return {
          rows: [{ realized_pnl_total: options?.realizedPnlTotal ?? "0.354946" }]
        };
      }

      if (sql.includes("from positions p")) {
        return {
          rows:
            options?.positions ??
            [
              {
                market_id: "market_seed_next_prime_minister",
                market_title: "מי יהיה ראש הממשלה הבא?",
                market_status: "open",
                outcome_id: "market_seed_next_prime_minister_outcome_option_a",
                outcome_label: "מועמד א'",
                outcome_count: 4,
                complement_outcome_id: null,
                complement_outcome_label: null,
                shares: "341.138215",
                cost_basis: "97.152119",
                realized_pnl: "0.354946",
                current_price: "0.31919492"
              }
            ]
        };
      }

      if (sql.includes("from contract_positions cp")) {
        return {
          rows:
            options?.contractPositions ??
            [
              {
                market_id: "market_seed_next_prime_minister",
                market_title: "מי יהיה ראש הממשלה הבא?",
                market_status: "open",
                persisted_status: "open",
                requested_outcome_id: "market_seed_next_prime_minister_outcome_option_a",
                requested_outcome_label: "מועמד א'",
                contract_side: "yes",
                outcome_count: 4,
                shares: "341.138215",
                cost_basis: "97.152119",
                realized_pnl: "0.354946",
                current_price: "0.31919492"
              }
            ]
        };
      }

      if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }) as Queryable["query"]
  };
}

describe("portfolio snapshot service", () => {
  it("builds summary + positions from active trade state", async () => {
    const response = await readPortfolioSnapshot(createQueryable(), BASE_ENV);

    expect(response.actorMode).toBe("demo");
    expect(response.summary).toMatchObject({
      availableCash: "9900.000000",
      realizedPnl: "0.354946",
      openPositionsCount: 1
    });
    expect(response.positions[0]).toMatchObject({
      marketKey: "next-prime-minister",
      outcomeKey: "option-a",
      outcomeLabel: "מועמד א'",
      shares: "341.138215",
      costBasis: "97.152119",
      currentPrice: "0.31919492",
      positionValue: "108.889585",
      unrealizedPnl: "11.737466",
      totalPnl: "12.092412",
      dayPnl: "0.000000"
    });
    expect(response.summary.portfolioValue).toBe("108.889585");
    expect(response.summary.totalAccountValue).toBe("10008.889585");
    expect(response.summary.unrealizedPnl).toBe("11.737466");
  });

  it("rejects when demo actor cash account is missing", async () => {
    await expect(
      readPortfolioSnapshot(
        createQueryable({
          includeCashAccount: false,
          positions: []
        }),
        BASE_ENV
      )
    ).rejects.toMatchObject<Partial<PortfolioSnapshotServiceError>>({
      code: "unauthorized",
      statusCode: 401
    });
  });

  it("marks snapshot as session-bound when explicit actor is provided", async () => {
    const response = await readPortfolioSnapshot(
      createQueryable(),
      {
        ...BASE_ENV,
        actorMode: {
          demoEnabled: false,
          demoActorId: "seed_user_1"
        }
      },
      {
        actorId: "user_live_1",
        mode: "session",
        sessionId: "session_live_1",
        role: "user"
      }
    );

    expect(response.actorMode).toBe("session");
  });

  it("exposes persisted and effective market status for portfolio positions", async () => {
    const response = await readPortfolioSnapshot(
      createQueryable({
        positions: [
          {
            market_id: "market_seed_next_prime_minister",
            market_title: "מי יהיה ראש הממשלה הבא?",
            market_status: "closed",
            persisted_status: "open",
            outcome_id: "market_seed_next_prime_minister_outcome_option_a",
            outcome_label: "מועמד א'",
            outcome_count: 4,
            complement_outcome_id: null,
            complement_outcome_label: null,
            shares: "10.000000",
            cost_basis: "5.000000",
            realized_pnl: "0.000000",
            current_price: "0.40000000"
          }
        ],
        contractPositions: []
      }),
      BASE_ENV
    );

    expect(response.positions[0]).toMatchObject({
      marketStatus: "closed",
      persistedMarketStatus: "open",
      effectiveMarketStatus: "closed"
    });
  });

  it("uses requested contract positions for user-facing holdings", async () => {
    const response = await readPortfolioSnapshot(
      createQueryable({
        positions: [
          {
            market_id: "market_seed_next_prime_minister",
            market_title: "מי יהיה ראש הממשלה הבא?",
            market_status: "open",
            outcome_id: "market_seed_next_prime_minister_outcome_option_a",
            outcome_label: "מועמד א'",
            outcome_count: 4,
            complement_outcome_id: null,
            complement_outcome_label: null,
            shares: "1000.000000",
            cost_basis: "400.000000",
            realized_pnl: "0.000000",
            current_price: "0.60000000"
          }
        ],
        contractPositions: [
          {
            market_id: "market_seed_next_prime_minister",
            market_title: "מי יהיה ראש הממשלה הבא?",
            market_status: "open",
            requested_outcome_id: "market_seed_next_prime_minister_outcome_option_a",
            requested_outcome_label: "מועמד א'",
            contract_side: "no",
            outcome_count: 4,
            shares: "25.000000",
            cost_basis: "10.000000",
            realized_pnl: "0.000000",
            current_price: "0.40000000"
          }
        ]
      }),
      BASE_ENV
    );

    expect(response.positions[0]).toMatchObject({
      outcomeKey: "option-a",
      contractSide: "no",
      shares: "25.000000",
      costBasis: "10.000000",
      currentPrice: "0.40000000",
      positionValue: "10.000000"
    });
    expect(response.contractPositions[0]).toMatchObject({
      outcomeKey: "option-a",
      contractSide: "no",
      shares: "25.000000",
      costBasis: "10.000000",
      currentPrice: "0.40000000",
      positionValue: "10.000000"
    });
  });

  it("exposes resolved market images for portfolio rows", async () => {
    const response = await readPortfolioSnapshot(
      createQueryable({
        positions: [
          {
            market_id: "market-with-image",
            market_title: "שוק עם תמונה",
            market_status: "open",
            category_key: null,
            market_contract: {},
            outcome_id: "market-with-image-outcome-a",
            outcome_label: "כן",
            outcome_count: 2,
            complement_outcome_id: "market-with-image-outcome-b",
            complement_outcome_label: "לא",
            shares: "10.000000",
            cost_basis: "5.000000",
            realized_pnl: "0.000000",
            current_price: "0.60000000",
            outcome_image_url: "/assets/images/custom-market.svg"
          }
        ],
        contractPositions: []
      }),
      BASE_ENV
    );

    expect(response.positions[0]?.image).toEqual({
      src: "/assets/images/custom-market.svg",
      alt: "שוק עם תמונה"
    });
  });

  it("ignores stale generic outcome buckets when category fallback is clearer", async () => {
    const response = await readPortfolioSnapshot(
      createQueryable({
        positions: [
          {
            market_id: "politics-market-with-stale-sports-outcome",
            market_title: "מי יהיה ראש ממשלת ישראל הבא?",
            market_status: "open",
            category_key: "politics",
            market_contract: {},
            outcome_id: "politics-market-with-stale-sports-outcome-a",
            outcome_label: "מועמד א",
            outcome_count: 2,
            complement_outcome_id: "politics-market-with-stale-sports-outcome-b",
            complement_outcome_label: "מועמד ב",
            shares: "10.000000",
            cost_basis: "5.000000",
            realized_pnl: "0.000000",
            current_price: "0.60000000",
            outcome_image_url: "/assets/images/market-buckets/sports.svg"
          }
        ],
        contractPositions: []
      }),
      BASE_ENV
    );

    expect(response.positions[0]?.image).toMatchObject({
      src: "/assets/images/market-buckets/politics.svg",
      alt: "פוליטיקה"
    });
  });

  it("exposes contract market images on requested-position rows", async () => {
    const response = await readPortfolioSnapshot(
      createQueryable({
        positions: [],
        contractPositions: [
          {
            market_id: "contract-market-with-image",
            market_title: "שוק חוזי עם תמונה",
            market_status: "open",
            market_contract: {
              objectType: "market_contract_v1",
              image: {
                src: "/assets/images/contract-market.svg",
                alt: "תמונת חוזה",
                rights: {
                  publicUse: "allowed",
                  status: "hachozeh-owned"
                }
              }
            },
            requested_outcome_id: "contract-market-with-image-outcome-a",
            requested_outcome_label: "כן",
            contract_side: "yes",
            outcome_count: 2,
            shares: "10.000000",
            cost_basis: "5.000000",
            realized_pnl: "0.000000",
            current_price: "0.60000000"
          }
        ]
      }),
      BASE_ENV
    );

    expect(response.positions[0]?.image).toEqual({
      src: "/assets/images/contract-market.svg",
      alt: "תמונת חוזה"
    });
    expect(response.contractPositions[0]?.image).toEqual(response.positions[0]?.image);
  });

  it("hides polluted multi-no complement legs when a requested no contract exists", async () => {
    const response = await readPortfolioSnapshot(
      createQueryable({
        positions: [],
        contractPositions: [
          {
            market_id: "market_seed_next_prime_minister",
            market_title: "מי יהיה ראש הממשלה הבא?",
            market_status: "open",
            requested_outcome_id: "market_seed_next_prime_minister_outcome_option_a",
            requested_outcome_label: "נתניהו",
            contract_side: "no",
            outcome_count: 4,
            shares: "25.000000",
            cost_basis: "30.000000",
            realized_pnl: "0.000000",
            current_price: "0.60000000"
          },
          {
            market_id: "market_seed_next_prime_minister",
            market_title: "מי יהיה ראש הממשלה הבא?",
            market_status: "open",
            requested_outcome_id: "market_seed_next_prime_minister_outcome_option_b",
            requested_outcome_label: "בנט",
            contract_side: "yes",
            outcome_count: 4,
            shares: "25.000000",
            cost_basis: "10.000000",
            realized_pnl: "0.000000",
            current_price: "0.15000000"
          },
          {
            market_id: "market_seed_next_prime_minister",
            market_title: "מי יהיה ראש הממשלה הבא?",
            market_status: "open",
            requested_outcome_id: "market_seed_next_prime_minister_outcome_option_c",
            requested_outcome_label: "ליברמן",
            contract_side: "yes",
            outcome_count: 4,
            shares: "25.000000",
            cost_basis: "10.000000",
            realized_pnl: "0.000000",
            current_price: "0.15000000"
          },
          {
            market_id: "market_seed_next_prime_minister",
            market_title: "מי יהיה ראש הממשלה הבא?",
            market_status: "open",
            requested_outcome_id: "market_seed_next_prime_minister_outcome_option_d",
            requested_outcome_label: "איזנקוט",
            contract_side: "yes",
            outcome_count: 4,
            shares: "25.000000",
            cost_basis: "10.000000",
            realized_pnl: "0.000000",
            current_price: "0.10000000"
          }
        ]
      }),
      BASE_ENV
    );

    expect(response.positions).toHaveLength(1);
    expect(response.positions[0]).toMatchObject({
      outcomeKey: "option-a",
      outcomeLabel: "נתניהו",
      contractSide: "no",
      shares: "25.000000"
    });
    expect(response.contractPositions).toHaveLength(1);
  });

  it("suppresses sub-material dust positions from portfolio reads", async () => {
    const response = await readPortfolioSnapshot(
      createQueryable({
        positions: [
          {
            market_id: "market_seed_next_prime_minister",
            market_title: "מי יהיה ראש הממשלה הבא?",
            market_status: "open",
            outcome_id: "market_seed_next_prime_minister_outcome_option_a",
            outcome_label: "מועמד א'",
            outcome_count: 4,
            complement_outcome_id: null,
            complement_outcome_label: null,
            shares: "0.001568",
            cost_basis: "0.000302",
            realized_pnl: "0.000000",
            current_price: "0.16000000"
          }
        ],
        contractPositions: [
          {
            market_id: "market_seed_next_prime_minister",
            market_title: "מי יהיה ראש הממשלה הבא?",
            market_status: "open",
            requested_outcome_id: "market_seed_next_prime_minister_outcome_option_a",
            requested_outcome_label: "מועמד א'",
            contract_side: "yes",
            outcome_count: 4,
            shares: "0.001568",
            cost_basis: "0.000302",
            realized_pnl: "0.000000",
            current_price: "0.16000000"
          }
        ]
      }),
      BASE_ENV
    );

    expect(response.positions).toHaveLength(0);
    expect(response.contractPositions).toHaveLength(0);
    expect(response.summary.openPositionsCount).toBe(0);
  });

  it("only reads unsettled positions from non-terminal markets", async () => {
    const db = createQueryable();

    await readPortfolioSnapshot(db, BASE_ENV);

    const query = vi.mocked(db.query);
    const sqlCalls = query.mock.calls.map(([sql]) => String(sql));
    const positionSql = sqlCalls.find((sql) => sql.includes("from positions p"));
    const contractPositionSql = sqlCalls.find((sql) => sql.includes("from contract_positions cp"));

    expect(positionSql).toContain("p.settled_at is null");
    expect(positionSql).toContain("m.status not in ('resolved', 'voided')");
    expect(contractPositionSql).toContain("cp.settled_at is null");
    expect(contractPositionSql).toContain("m.status not in ('resolved', 'voided')");
  });

  it("merges binary mirror contract positions into canonical displayed outcomes", async () => {
    const response = await readPortfolioSnapshot(
      createQueryable({
        positions: [],
        contractPositions: [
          {
            market_id: "binary-market",
            market_title: "האם שער הדולר יהיה מעל 3.70?",
            market_status: "open",
            requested_outcome_id: "binary-market-yes",
            requested_outcome_label: "כן",
            complement_outcome_id: "binary-market-no",
            complement_outcome_label: "לא",
            contract_side: "no",
            outcome_count: 2,
            shares: "25.000000",
            cost_basis: "10.000000",
            realized_pnl: "1.000000",
            current_price: "0.84000000"
          },
          {
            market_id: "binary-market",
            market_title: "האם שער הדולר יהיה מעל 3.70?",
            market_status: "open",
            requested_outcome_id: "binary-market-no",
            requested_outcome_label: "לא",
            complement_outcome_id: "binary-market-yes",
            complement_outcome_label: "כן",
            contract_side: "yes",
            outcome_count: 2,
            shares: "75.000000",
            cost_basis: "30.000000",
            realized_pnl: "2.000000",
            current_price: "0.84000000"
          },
          {
            market_id: "binary-market",
            market_title: "האם שער הדולר יהיה מעל 3.70?",
            market_status: "open",
            requested_outcome_id: "binary-market-yes",
            requested_outcome_label: "כן",
            complement_outcome_id: "binary-market-no",
            complement_outcome_label: "לא",
            contract_side: "yes",
            outcome_count: 2,
            shares: "12.000000",
            cost_basis: "8.000000",
            realized_pnl: "0.000000",
            current_price: "0.16000000"
          }
        ]
      }),
      BASE_ENV
    );

    expect(response.contractPositions).toHaveLength(2);
    expect(response.contractPositions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          outcomeKey: "binary-market-no",
          outcomeLabel: "לא",
          contractSide: "yes",
          shares: "100.000000",
          costBasis: "40.000000",
          currentPrice: "0.84000000",
          positionValue: "84.000000",
          realizedPnl: "3.000000",
          totalPnl: "47.000000"
        }),
        expect.objectContaining({
          outcomeKey: "binary-market-yes",
          outcomeLabel: "כן",
          contractSide: "yes",
          shares: "12.000000"
        })
      ])
    );
  });
});
