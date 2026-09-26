import { describe, expect, it, vi } from "vitest";

import type { AppEnv } from "../../../src/config/env";
import type { Queryable } from "../../../src/db/client/pool";
import {
  QuoteServiceError,
  createTradeTicketQuote
} from "../../../src/engine/pricing/quote-service";

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

function createQueryable(overrides?: {
  marketId?: string;
  marketKey?: string;
  liquidityB?: string;
  marketQShares?: string[];
  outcomeIds?: string[];
  marketStatus?: string;
  marketCloseAt?: Date | string;
  positionRows?: Array<{ outcome_id?: string; shares: string; cost_basis: string }>;
  contractPositionRows?: Array<{
    requested_outcome_id?: string;
    contract_side?: "yes" | "no";
    shares: string;
    cost_basis: string;
  }>;
  cashBalance?: string;
  userStatus?: "active" | "locked" | "archived";
  tradeAccessStatus?: "enabled" | "blocked";
}): Queryable {
  const marketQShares = overrides?.marketQShares ?? [
    "0.000000",
    "0.000000",
    "0.000000",
    "0.000000"
  ];
  const outcomeIds = overrides?.outcomeIds ?? [
    "market_seed_next_prime_minister_outcome_option_a",
    "market_seed_next_prime_minister_outcome_option_b",
    "market_seed_next_prime_minister_outcome_option_c",
    "market_seed_next_prime_minister_outcome_option_d"
  ];
  const marketId = overrides?.marketId ?? "market_seed_next_prime_minister";
  const marketStatus = overrides?.marketStatus ?? "open";
  const liquidityB = overrides?.liquidityB ?? "1000.00000000";

  return {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("from users")) {
        return {
          rows: [
            {
              user_id: "seed_user_1",
              user_status: overrides?.userStatus ?? "active",
              user_role: "user",
              trade_access_status: overrides?.tradeAccessStatus ?? "enabled"
            }
          ]
        };
      }

      if (sql.includes("from markets m")) {
        return {
          rows: outcomeIds.map((outcomeId, index) => ({
            market_id: marketId,
            market_status: marketStatus,
            market_close_at: overrides?.marketCloseAt ?? "2999-01-01T00:00:00.000Z",
            market_state_version: "12",
            liquidity_b: liquidityB,
            outcome_id: outcomeId,
            q_shares: marketQShares[index] ?? "0.000000",
            sort_order: index
          }))
        };
      }

      if (sql.includes("from accounts")) {
        return {
          rows: [
            {
              account_id: "account_seed_user_1_cash",
              status: "active",
              balance_cached: overrides?.cashBalance ?? "10000.000000"
            }
          ]
        };
      }

      if (sql.includes("from contract_positions")) {
        const requestedOutcomeId =
          typeof values?.[2] === "string" ? (values[2] as string) : null;
        const requestedContractSide =
          values?.[3] === "yes" || values?.[3] === "no" ? values[3] : null;
        const sourceRows = overrides?.contractPositionRows;
        const derivedRows =
          sourceRows ??
          (() => {
            const positionRows = overrides?.positionRows ?? [];

            if (!positionRows.length) {
              return [];
            }

            const minShares = positionRows.reduce(
              (currentMin, row) =>
                Number(row.shares) < Number(currentMin) ? row.shares : currentMin,
              positionRows[0].shares
            );

            return [
              {
                requested_outcome_id: requestedOutcomeId ?? undefined,
                contract_side: requestedContractSide ?? undefined,
                shares: minShares,
                cost_basis: positionRows[0].cost_basis
              }
            ];
          })();
        const filteredRows = derivedRows.filter((row) => {
          if (
            requestedOutcomeId &&
            row.requested_outcome_id &&
            row.requested_outcome_id !== requestedOutcomeId
          ) {
            return false;
          }

          if (
            requestedContractSide &&
            row.contract_side &&
            row.contract_side !== requestedContractSide
          ) {
            return false;
          }

          return true;
        });

        return {
          rows: filteredRows
        };
      }

      if (sql.includes("from positions")) {
        const requestedOutcomeIds = Array.isArray(values?.[2])
          ? (values?.[2] as string[])
          : null;
        const requestedOutcomeId =
          typeof values?.[2] === "string" ? (values[2] as string) : null;
        const filteredRows =
          overrides?.positionRows?.filter((row) => {
            if (requestedOutcomeIds) {
              return row.outcome_id ? requestedOutcomeIds.includes(row.outcome_id) : false;
            }

            if (requestedOutcomeId) {
              return row.outcome_id ? row.outcome_id === requestedOutcomeId : true;
            }

            return true;
          }) ?? [];

        return {
          rows: filteredRows
        };
      }

      if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }) as Queryable["query"]
  };
}

describe("quote service", () => {
  it("builds a buy quote around marketKey/outcomeKey app identity", async () => {
    const response = await createTradeTicketQuote(
      createQueryable(),
      BASE_ENV,
      "next-prime-minister",
      {
        side: "buy",
        outcomeKey: "option-a",
        cashAmount: "100.000000"
      }
    );

    expect(response).toMatchObject({
      side: "buy",
      marketKey: "next-prime-minister",
      marketId: "market_seed_next_prime_minister",
      outcomeKey: "option-a",
      outcomeId: "market_seed_next_prime_minister_outcome_option_a",
      executionLegs: [
        {
          outcomeKey: "option-a",
          outcomeId: "market_seed_next_prime_minister_outcome_option_a",
          shareAmount: expect.any(String)
        }
      ],
      marketStateVersion: 12,
      cashAmount: "100.000000",
      unspentCash: expect.any(String),
      shareAmount: expect.any(String),
      averagePrice: expect.any(String),
      priceBefore: "0.25000000",
      priceImpact: {
        direction: "up",
        level: expect.any(String),
        percentPoints: expect.any(String)
      }
    });
  });

  it("rejects open markets after close_at even before Horizon closes them", async () => {
    await expect(
      createTradeTicketQuote(
        createQueryable({
          marketStatus: "open",
          marketCloseAt: "2000-01-01T00:00:00.000Z"
        }),
        BASE_ENV,
        "next-prime-minister",
        {
          side: "buy",
          outcomeKey: "option-a",
          cashAmount: "10.000000"
        }
      )
    ).rejects.toMatchObject<Partial<QuoteServiceError>>({
      statusCode: 409,
      code: "market_not_open"
    });
  });

  it("computes sell quote realized pnl estimate from weighted-average position cost", async () => {
    const response = await createTradeTicketQuote(
      createQueryable({
        marketQShares: ["50.000000", "0.000000", "0.000000", "0.000000"],
        positionRows: [
          {
            shares: "50.000000",
            cost_basis: "12.500000"
          }
        ]
      }),
      BASE_ENV,
      "next-prime-minister",
      {
        side: "sell",
        outcomeKey: "option-a",
        shareAmount: "10.000000"
      }
    );

    expect(response).toMatchObject({
      side: "sell",
      shareAmount: "10.000000",
      estimatedProceeds: expect.any(String),
      estimatedRealizedPnlDelta: expect.any(String)
    });
    expect(Number(response.estimatedRealizedPnlDelta)).toBeCloseTo(
      Number(response.estimatedProceeds) - 2.5,
      6
    );
  });

  it("rejects direct sell quotes with zero quantized proceeds as untradeable", async () => {
    await expect(
      createTradeTicketQuote(
        createQueryable({
          liquidityB: "1.00000000",
          marketQShares: ["0.000001", "100.000000", "100.000000", "100.000000"],
          positionRows: [
            {
              outcome_id: "market_seed_next_prime_minister_outcome_option_a",
              shares: "0.000001",
              cost_basis: "0.000001"
            }
          ]
        }),
        BASE_ENV,
        "next-prime-minister",
        {
          side: "sell",
          outcomeKey: "option-a",
          contractSide: "yes",
          shareAmount: "0.000001"
        }
      )
    ).rejects.toMatchObject<Partial<QuoteServiceError>>({
      code: "untradeable_amount",
      statusCode: 409
    });
  });

  it("rejects complement/no sell quotes with zero quantized proceeds as untradeable", async () => {
    await expect(
      createTradeTicketQuote(
        createQueryable({
          liquidityB: "1.00000000",
          marketQShares: ["100.000000", "0.000001", "0.000001", "0.000001"],
          positionRows: [
            {
              outcome_id: "market_seed_next_prime_minister_outcome_option_b",
              shares: "0.000001",
              cost_basis: "0.000001"
            },
            {
              outcome_id: "market_seed_next_prime_minister_outcome_option_c",
              shares: "0.000001",
              cost_basis: "0.000001"
            },
            {
              outcome_id: "market_seed_next_prime_minister_outcome_option_d",
              shares: "0.000001",
              cost_basis: "0.000001"
            }
          ]
        }),
        BASE_ENV,
        "next-prime-minister",
        {
          side: "sell",
          outcomeKey: "option-a",
          contractSide: "no",
          shareAmount: "0.000001"
        }
      )
    ).rejects.toMatchObject<Partial<QuoteServiceError>>({
      code: "untradeable_amount",
      statusCode: 409
    });
  });

  it("rejects sell quotes that exceed owned shares", async () => {
    await expect(
      createTradeTicketQuote(
        createQueryable({
          positionRows: [
            {
              shares: "5.000000",
              cost_basis: "1.250000"
            }
          ]
        }),
        BASE_ENV,
        "next-prime-minister",
        {
          side: "sell",
          outcomeKey: "option-a",
          shareAmount: "10.000000"
        }
      )
    ).rejects.toMatchObject<Partial<QuoteServiceError>>({
      code: "insufficient_shares",
      statusCode: 400
    });
  });

  it("rejects sell quotes that exceed requested contract-position shares", async () => {
    await expect(
      createTradeTicketQuote(
        createQueryable({
          positionRows: [
            {
              outcome_id: "market_seed_next_prime_minister_outcome_option_a",
              shares: "100.000000",
              cost_basis: "25.000000"
            }
          ],
          contractPositionRows: [
            {
              requested_outcome_id: "market_seed_next_prime_minister_outcome_option_a",
              contract_side: "yes",
              shares: "5.000000",
              cost_basis: "1.250000"
            }
          ]
        }),
        BASE_ENV,
        "next-prime-minister",
        {
          side: "sell",
          outcomeKey: "option-a",
          contractSide: "yes",
          shareAmount: "10.000000"
        }
      )
    ).rejects.toMatchObject<Partial<QuoteServiceError>>({
      code: "insufficient_shares",
      statusCode: 400
    });
  });

  it("rejects malformed sell quote share amounts as invalid requests", async () => {
    await expect(
      createTradeTicketQuote(
        createQueryable({
          positionRows: [
            {
              shares: "5.000000",
              cost_basis: "1.250000"
            }
          ]
        }),
        BASE_ENV,
        "next-prime-minister",
        {
          side: "sell",
          outcomeKey: "option-a",
          shareAmount: "NaN"
        }
      )
    ).rejects.toMatchObject<Partial<QuoteServiceError>>({
      code: "invalid_request",
      statusCode: 400
    });
  });

  it("rejects buy quotes that exceed currently available cash", async () => {
    await expect(
      createTradeTicketQuote(
        createQueryable({
          cashBalance: "10.000000"
        }),
        BASE_ENV,
        "next-prime-minister",
        {
          side: "buy",
          outcomeKey: "option-a",
          cashAmount: "100.000000"
        }
      )
    ).rejects.toMatchObject<Partial<QuoteServiceError>>({
      code: "insufficient_cash",
      statusCode: 409
    });
  });

  it("rejects buy quote cash amounts below cent precision", async () => {
    await expect(
      createTradeTicketQuote(createQueryable(), BASE_ENV, "next-prime-minister", {
        side: "buy",
        outcomeKey: "option-a",
        cashAmount: "1.001"
      })
    ).rejects.toMatchObject<Partial<QuoteServiceError>>({
      code: "invalid_request",
      statusCode: 400
    });
  });

  it("accepts explicit session actor override without demo dependency", async () => {
    const response = await createTradeTicketQuote(
      createQueryable(),
      {
        ...BASE_ENV,
        actorMode: {
          demoEnabled: false,
          demoActorId: "seed_user_1"
        }
      },
      "next-prime-minister",
      {
        side: "buy",
        outcomeKey: "option-a",
        cashAmount: "25.000000"
      },
      {
        actorId: "user_live_1"
      }
    );

    expect(response.side).toBe("buy");
    expect(response.marketKey).toBe("next-prime-minister");
  });

  it("normalizes binary buy-no quotes to the opposite executed outcome", async () => {
    const response = await createTradeTicketQuote(
      createQueryable({
        marketId: "binary-market",
        outcomeIds: ["yes-outcome", "no-outcome"],
        marketQShares: ["10.000000", "20.000000"]
      }),
      BASE_ENV,
      "binary-market",
      {
        side: "buy",
        outcomeKey: "yes-outcome",
        contractSide: "no",
        cashAmount: "50.000000"
      }
    );

    expect(response).toMatchObject({
      side: "buy",
      contractSide: "no",
      outcomeKey: "yes-outcome",
      outcomeId: "yes-outcome",
      executionOutcomeKey: "no-outcome",
      executionOutcomeId: "no-outcome",
      executionLegs: [
        {
          outcomeKey: "no-outcome",
          outcomeId: "no-outcome",
          shareAmount: expect.any(String)
        }
      ]
    });
  });

  it("uses opposite-outcome holdings for binary sell-no quotes", async () => {
    const response = await createTradeTicketQuote(
      createQueryable({
        marketId: "binary-market",
        outcomeIds: ["yes-outcome", "no-outcome"],
        marketQShares: ["0.000000", "25.000000"],
        positionRows: [
          {
            shares: "25.000000",
            cost_basis: "10.000000"
          }
        ]
      }),
      BASE_ENV,
      "binary-market",
      {
        side: "sell",
        outcomeKey: "yes-outcome",
        contractSide: "no",
        shareAmount: "10.000000"
      }
    );

    expect(response).toMatchObject({
      side: "sell",
      contractSide: "no",
      outcomeKey: "yes-outcome",
      outcomeId: "yes-outcome",
      executionOutcomeKey: "no-outcome",
      executionOutcomeId: "no-outcome",
      executionLegs: [
        {
          outcomeKey: "no-outcome",
          outcomeId: "no-outcome",
          shareAmount: "10.000000"
        }
      ]
    });
  });

  it("quotes multi-outcome buy-no as a complement bundle", async () => {
    const response = await createTradeTicketQuote(
      createQueryable(),
      BASE_ENV,
      "next-prime-minister",
      {
        side: "buy",
        outcomeKey: "option-a",
        contractSide: "no",
        cashAmount: "25.000000"
      }
    );

    expect(response).toMatchObject({
      side: "buy",
      contractSide: "no",
      outcomeKey: "option-a",
      outcomeId: "market_seed_next_prime_minister_outcome_option_a",
      executionOutcomeKey: null,
      executionOutcomeId: null,
      executionLegs: [
        {
          outcomeKey: "option-b",
          outcomeId: "market_seed_next_prime_minister_outcome_option_b",
          shareAmount: expect.any(String)
        },
        {
          outcomeKey: "option-c",
          outcomeId: "market_seed_next_prime_minister_outcome_option_c",
          shareAmount: expect.any(String)
        },
        {
          outcomeKey: "option-d",
          outcomeId: "market_seed_next_prime_minister_outcome_option_d",
          shareAmount: expect.any(String)
        }
      ]
    });
  });

  it("quotes multi-outcome sell-no from complement holdings", async () => {
    const response = await createTradeTicketQuote(
      createQueryable({
        outcomeIds: [
          "market_seed_next_prime_minister_outcome_option_a",
          "market_seed_next_prime_minister_outcome_option_b",
          "market_seed_next_prime_minister_outcome_option_c"
        ],
        marketQShares: ["0.000000", "8.000000", "8.000000"],
        positionRows: [
          {
            outcome_id: "market_seed_next_prime_minister_outcome_option_b",
            shares: "12.000000",
            cost_basis: "3.000000"
          },
          {
            outcome_id: "market_seed_next_prime_minister_outcome_option_c",
            shares: "12.000000",
            cost_basis: "3.000000"
          }
        ]
      }),
      BASE_ENV,
      "next-prime-minister",
      {
        side: "sell",
        outcomeKey: "option-a",
        contractSide: "no",
        shareAmount: "5.000000"
      }
    );

    expect(response).toMatchObject({
      side: "sell",
      contractSide: "no",
      outcomeKey: "option-a",
      outcomeId: "market_seed_next_prime_minister_outcome_option_a",
      executionOutcomeKey: null,
      executionOutcomeId: null,
      executionLegs: [
        {
          outcomeKey: "option-b",
          outcomeId: "market_seed_next_prime_minister_outcome_option_b",
          shareAmount: "5.000000"
        },
        {
          outcomeKey: "option-c",
          outcomeId: "market_seed_next_prime_minister_outcome_option_c",
          shareAmount: "5.000000"
        }
      ],
      estimatedProceeds: expect.any(String),
      estimatedRealizedPnlDelta: expect.any(String)
    });
  });

  it("rejects quote access when user trading is blocked", async () => {
    await expect(
      createTradeTicketQuote(
        createQueryable({
          tradeAccessStatus: "blocked"
        }),
        BASE_ENV,
        "next-prime-minister",
        {
          side: "buy",
          outcomeKey: "option-a",
          cashAmount: "25.000000"
        }
      )
    ).rejects.toMatchObject<Partial<QuoteServiceError>>({
      statusCode: 403,
      code: "trade_access_blocked"
    });
  });
});
