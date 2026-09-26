import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import type { AppEnv } from "../../../src/config/env";
import { executeTrade, TradeServiceError } from "../../../src/engine/trading/trade-service";

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

function createDbPool(overrides?: {
  userStatus?: "active" | "locked" | "archived";
  tradeAccessStatus?: "enabled" | "blocked";
  marketRows?: Array<{
    market_id: string;
    market_status: string;
    market_close_at?: Date | string;
    event_id?: string | null;
    market_contract?: unknown;
    market_treasury_account_id: string;
    market_state_version: string;
    liquidity_b: string;
    outcome_id: string;
    q_shares: string;
    sort_order: number;
  }>;
  positionRows?: Array<{
    user_id: string;
    market_id: string;
    outcome_id: string;
    shares: string;
    cost_basis: string;
    realized_pnl: string;
  }>;
  contractPositionRows?: Array<{
    user_id: string;
    market_id: string;
    requested_outcome_id: string;
    requested_outcome_key: string;
    contract_side: "yes" | "no";
    shares: string;
    cost_basis: string;
    realized_pnl: string;
  }>;
  /** When set, the idempotency insert returns 0 rows and the select returns this as a completed replay. */
  completedResponse?: unknown;
  /** When set, the idempotency insert returns 0 rows and the select returns a record whose hash differs from the request. */
  conflictingRequestHash?: string;
  /** When set, the idempotency insert returns 0 rows and the select returns an in_progress record with the same hash. */
  idempotencyInProgress?: boolean;
  resolvedDependencyTriggers?: Array<{
    trigger_market_id: string;
    market_contract: unknown;
    winning_outcome_id: string;
    winning_outcome_label: string;
    outcomes: Array<{ outcomeId: string; label: string }>;
  }>;
}) {
  const tradeInsertValues: unknown[][] = [];
  const tradeExecutionLegInsertValues: unknown[][] = [];
  const pricingStateUpdateValues: unknown[][] = [];
  const positionUpsertValues: unknown[][] = [];
  const contractPositionUpsertValues: unknown[][] = [];
  const positionDeleteValues: unknown[][] = [];
  const contractPositionDeleteValues: unknown[][] = [];
  // Stores the request hash captured from the insert call so the select can echo it back.
  const idempotencyState = { capturedRequestHash: null as string | null };
  const marketRows =
    overrides?.marketRows ?? [
      {
        market_id: "binary-market",
        market_status: "open",
        market_close_at: "2999-01-01T00:00:00.000Z",
        market_treasury_account_id: "market_treasury_1",
        market_state_version: "12",
        liquidity_b: "1000.00000000",
        outcome_id: "yes-outcome",
        q_shares: "0.000000",
        sort_order: 0
      },
      {
        market_id: "binary-market",
        market_status: "open",
        market_close_at: "2999-01-01T00:00:00.000Z",
        market_treasury_account_id: "market_treasury_1",
        market_state_version: "12",
        liquidity_b: "1000.00000000",
        outcome_id: "no-outcome",
        q_shares: "0.000000",
        sort_order: 1
      }
    ];
  const positionRows = overrides?.positionRows ?? [];
  const contractPositionRows = overrides?.contractPositionRows ?? [];

  const client = {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql === "begin" || sql === "commit" || sql === "rollback") {
        return { rows: [], rowCount: 0 };
      }

      if (sql.includes("pg_advisory_xact_lock")) {
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("from users")) {
        return {
          rows: [
            {
              user_id: "seed_user_1",
              user_status: overrides?.userStatus ?? "active",
              user_role: "user",
              trade_access_status: overrides?.tradeAccessStatus ?? "enabled"
            }
          ],
          rowCount: 1
        };
      }

      if (sql.includes("insert into idempotency_records")) {
        // Capture the hash so the follow-up select can echo it back for same-hash scenarios.
        // values: [$1=recordId, $2=scope, $3=actorId, $4=idempotencyKey, $5=requestHash]
        idempotencyState.capturedRequestHash = String(values?.[4] ?? "");

        if (
          overrides?.completedResponse !== undefined ||
          overrides?.conflictingRequestHash !== undefined ||
          overrides?.idempotencyInProgress
        ) {
          // Simulate conflict: insert skipped (ON CONFLICT DO NOTHING returned 0 rows).
          return { rows: [], rowCount: 0 };
        }

        return {
          rows: [{ id: "idempotency_1" }],
          rowCount: 1
        };
      }

      if (sql.includes("select id, request_hash, status, response_snapshot")) {
        if (
          overrides?.completedResponse !== undefined ||
          overrides?.conflictingRequestHash !== undefined ||
          overrides?.idempotencyInProgress
        ) {
          const resolvedHash =
            overrides?.conflictingRequestHash ??
            idempotencyState.capturedRequestHash ??
            "";
          return {
            rows: [
              {
                id: "idempotency_1",
                request_hash: resolvedHash,
                status: overrides?.completedResponse !== undefined ? "completed" : "in_progress",
                response_snapshot: overrides?.completedResponse ?? null
              }
            ],
            rowCount: 1
          };
        }

        return {
          rows: [],
          rowCount: 0
        };
      }

      if (sql.includes("from markets m")) {
        return {
          rows: marketRows,
          rowCount: marketRows.length
        };
      }

      if (sql.includes("from market_resolutions mr") && sql.includes("dependency_trade_guard")) {
        const rows = overrides?.resolvedDependencyTriggers ?? [];
        return { rows, rowCount: rows.length };
      }

      if (sql.includes("where type = 'user_cash'")) {
        return {
          rows: [
            {
              id: "account_seed_user_1_cash",
              status: "active",
              balance_cached: "1000.000000"
            }
          ],
          rowCount: 1
        };
      }

      if (sql.includes("where id = $1") && sql.includes("from accounts")) {
        return {
          rows: [
            {
              id: "market_treasury_1",
              status: "active",
              balance_cached: "1000.000000"
            }
          ],
          rowCount: 1
        };
      }

      if (sql.includes("select") && sql.includes("from contract_positions")) {
        const requestedOutcomeId =
          typeof values?.[2] === "string" ? (values[2] as string) : null;
        const contractSide =
          values?.[3] === "yes" || values?.[3] === "no" ? values[3] : null;
        const filteredRows = contractPositionRows.filter((row) => {
          if (requestedOutcomeId && row.requested_outcome_id !== requestedOutcomeId) {
            return false;
          }

          if (contractSide && row.contract_side !== contractSide) {
            return false;
          }

          return true;
        });

        return {
          rows: filteredRows,
          rowCount: filteredRows.length
        };
      }

      if (sql.includes("select") && sql.includes("from positions")) {
        const requestedOutcomeIds = Array.isArray(values?.[2])
          ? (values[2] as string[])
          : null;
        const requestedOutcomeId =
          typeof values?.[2] === "string" ? (values[2] as string) : null;
        const filteredRows = positionRows.filter((row) => {
          if (requestedOutcomeIds) {
            return requestedOutcomeIds.includes(row.outcome_id);
          }

          if (requestedOutcomeId) {
            return row.outcome_id === requestedOutcomeId;
          }

          return true;
        });

        return {
          rows: filteredRows,
          rowCount: filteredRows.length
        };
      }

      if (sql.includes("insert into positions")) {
        positionUpsertValues.push(values ?? []);
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("insert into contract_positions")) {
        contractPositionUpsertValues.push(values ?? []);
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("delete from positions")) {
        positionDeleteValues.push(values ?? []);
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("delete from contract_positions")) {
        contractPositionDeleteValues.push(values ?? []);
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("update market_pricing_state")) {
        pricingStateUpdateValues.push(values ?? []);
        return { rows: [], rowCount: 1 };
      }

      if (
        sql.includes("update accounts") ||
        sql.includes("update market_outcome_state") ||
        sql.includes("insert into realization_events") ||
        sql.includes("insert into audit_events") ||
        sql.includes("insert into ledger_entries") ||
        sql.includes("update idempotency_records")
      ) {
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("order by sequence_number desc")) {
        return {
          rows: [],
          rowCount: 0
        };
      }

      if (sql.includes("insert into ledger_transactions")) {
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("insert into trades")) {
        tradeInsertValues.push(values ?? []);
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("insert into trade_execution_legs")) {
        tradeExecutionLegInsertValues.push(values ?? []);
        return { rows: [], rowCount: 1 };
      }

      if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }),
    release: vi.fn()
  };

  return {
    pool: {
      connect: vi.fn(async () => client)
    } as unknown as Pool,
    tradeInsertValues,
    tradeExecutionLegInsertValues,
    positionUpsertValues,
    contractPositionUpsertValues,
    positionDeleteValues,
    contractPositionDeleteValues,
    pricingStateUpdateValues,
    idempotencyState
  };
}

describe("trade service", () => {
  it("rejects trade execution when user trading is blocked", async () => {
    const { pool } = createDbPool({
      tradeAccessStatus: "blocked"
    });

    await expect(
      executeTrade(pool, BASE_ENV, "next-prime-minister", {
        side: "buy",
        outcomeKey: "option-a",
        cashAmount: "25.000000",
        idempotencyKey: "trade-1",
        quoteId: null,
        quotedAt: null,
        quoteExpiresAt: null,
        expectedMarketStateVersion: null
      })
    ).rejects.toMatchObject<Partial<TradeServiceError>>({
      statusCode: 403,
      code: "trade_access_blocked"
    });
  });

  it("rejects buy trade cash amounts below cent precision", async () => {
    const { pool } = createDbPool();

    await expect(
      executeTrade(pool, BASE_ENV, "binary-market", {
        side: "buy",
        outcomeKey: "yes-outcome",
        cashAmount: "1.001",
        idempotencyKey: "trade-invalid-cash-scale",
        quoteId: null,
        quotedAt: null,
        quoteExpiresAt: null,
        expectedMarketStateVersion: null
      })
    ).rejects.toMatchObject<Partial<TradeServiceError>>({
      statusCode: 400,
      code: "invalid_request"
    });
  });

  it("rejects buy trades below the configured min stake", async () => {
    const { pool, tradeInsertValues } = createDbPool();

    await expect(
      executeTrade(pool, BASE_ENV, "binary-market", {
        side: "buy",
        outcomeKey: "yes-outcome",
        cashAmount: "10.000000",
        idempotencyKey: "trade-min-stake-too-small",
        quoteId: null,
        quotedAt: null,
        quoteExpiresAt: null,
        expectedMarketStateVersion: null
      })
    ).rejects.toMatchObject<Partial<TradeServiceError>>({
      statusCode: 400,
      code: "min_stake_not_met"
    });
    expect(tradeInsertValues).toHaveLength(0);
  });

  it("accepts buy trades at the configured min stake", async () => {
    const { pool, pricingStateUpdateValues } = createDbPool();

    const response = await executeTrade(pool, BASE_ENV, "binary-market", {
      side: "buy",
      outcomeKey: "yes-outcome",
      cashAmount: "25.000000",
      idempotencyKey: "trade-min-stake-ok",
      quoteId: null,
      quotedAt: null,
      quoteExpiresAt: null,
      expectedMarketStateVersion: null
    });

    expect(response.side).toBe("buy");
    expect(response.cashSpent).toBe("25.000000");
    // The denormalized volume increment rides the version-bump UPDATE:
    // exactly one pricing-state write, carrying the buy's cashSpent.
    expect(pricingStateUpdateValues).toHaveLength(1);
    expect(pricingStateUpdateValues[0]).toEqual(["binary-market", "25.000000"]);
  });

  it("rejects stale expected market state versions before trade mutation", async () => {
    const { pool, tradeInsertValues } = createDbPool();

    await expect(
      executeTrade(pool, BASE_ENV, "binary-market", {
        side: "buy",
        outcomeKey: "yes-outcome",
        cashAmount: "25.000000",
        idempotencyKey: "trade-stale-state",
        quoteId: "quote_stale",
        quotedAt: "2026-06-14T09:00:00.000Z",
        quoteExpiresAt: "2999-01-01T00:00:00.000Z",
        expectedMarketStateVersion: 11
      })
    ).rejects.toMatchObject<Partial<TradeServiceError>>({
      statusCode: 409,
      code: "market_state_moved",
      details: {
        currentMarketStateVersion: 12,
        expectedMarketStateVersion: 11,
        quoteId: "quote_stale",
        currentQuote: expect.objectContaining({
          priceBefore: expect.any(String),
          priceAfter: expect.any(String),
          averagePrice: expect.any(String)
        })
      }
    });
    expect(tradeInsertValues).toHaveLength(0);
  });

  it("rejects expired trade quotes before trade mutation", async () => {
    const { pool, tradeInsertValues } = createDbPool();

    await expect(
      executeTrade(pool, BASE_ENV, "binary-market", {
        side: "buy",
        outcomeKey: "yes-outcome",
        cashAmount: "25.000000",
        idempotencyKey: "trade-expired-quote",
        quoteId: "quote_expired",
        quotedAt: "2000-01-01T00:00:00.000Z",
        quoteExpiresAt: "2000-01-01T00:00:03.000Z",
        expectedMarketStateVersion: 12
      })
    ).rejects.toMatchObject<Partial<TradeServiceError>>({
      statusCode: 409,
      code: "quote_expired",
      details: {
        currentMarketStateVersion: 12,
        quoteId: "quote_expired",
        quoteExpiresAt: "2000-01-01T00:00:03.000Z",
        currentQuote: expect.objectContaining({
          priceBefore: expect.any(String),
          priceAfter: expect.any(String),
          averagePrice: expect.any(String)
        })
      }
    });
    expect(tradeInsertValues).toHaveLength(0);
  });

  it("rejects open markets after close_at even before Horizon closes them", async () => {
    const { pool } = createDbPool({
      marketRows: [
        {
          market_id: "binary-market",
          market_status: "open",
          market_close_at: "2000-01-01T00:00:00.000Z",
          market_treasury_account_id: "market_treasury_1",
          market_state_version: "12",
          liquidity_b: "1000.00000000",
          outcome_id: "yes-outcome",
          q_shares: "0.000000",
          sort_order: 0
        },
        {
          market_id: "binary-market",
          market_status: "open",
          market_close_at: "2000-01-01T00:00:00.000Z",
          market_treasury_account_id: "market_treasury_1",
          market_state_version: "12",
          liquidity_b: "1000.00000000",
          outcome_id: "no-outcome",
          q_shares: "0.000000",
          sort_order: 1
        }
      ]
    });

    await expect(
      executeTrade(pool, BASE_ENV, "binary-market", {
        side: "buy",
        outcomeKey: "yes-outcome",
        cashAmount: "25.000000",
        idempotencyKey: "trade-after-close-at",
        quoteId: null,
        quotedAt: null,
        quoteExpiresAt: null,
        expectedMarketStateVersion: null
      })
    ).rejects.toMatchObject<Partial<TradeServiceError>>({
      statusCode: 409,
      code: "market_not_open"
    });
  });

  it("rejects trades when a resolved dependency already proves the child lost", async () => {
    const dependentContract = {
      objectType: "market_contract_v1",
      dependencyResolution: {
        acceptFact: "entity_eliminated",
        entityKey: "england"
      }
    };
    const { pool, tradeInsertValues } = createDbPool({
      marketRows: [
        {
          market_id: "england-wins-world-cup",
          market_status: "open",
          market_close_at: "2999-01-01T00:00:00.000Z",
          event_id: "evt-world-cup-winner",
          market_contract: dependentContract,
          market_treasury_account_id: "market_treasury_1",
          market_state_version: "12",
          liquidity_b: "1000.00000000",
          outcome_id: "england-yes",
          q_shares: "0.000000",
          sort_order: 0
        },
        {
          market_id: "england-wins-world-cup",
          market_status: "open",
          market_close_at: "2999-01-01T00:00:00.000Z",
          event_id: "evt-world-cup-winner",
          market_contract: dependentContract,
          market_treasury_account_id: "market_treasury_1",
          market_state_version: "12",
          liquidity_b: "1000.00000000",
          outcome_id: "england-no",
          q_shares: "0.000000",
          sort_order: 1
        }
      ],
      resolvedDependencyTriggers: [
        {
          trigger_market_id: "england-argentina-semifinal",
          market_contract: {
            dependentResolution: {
              emitFact: "entity_eliminated",
              targetEventId: "evt-world-cup-winner"
            },
            outcomeMap: [
              {
                outcomeLabel: "Argentina",
                eliminatesEntityKey: "england"
              }
            ]
          },
          winning_outcome_id: "argentina",
          winning_outcome_label: "Argentina",
          outcomes: [
            { outcomeId: "england", label: "England" },
            { outcomeId: "argentina", label: "Argentina" }
          ]
        }
      ]
    });

    await expect(
      executeTrade(pool, BASE_ENV, "england-wins-world-cup", {
        side: "buy",
        outcomeKey: "england-yes",
        contractSide: "yes",
        cashAmount: "100",
        idempotencyKey: "known-dependent-result",
        quoteId: null,
        quotedAt: null,
        quoteExpiresAt: null,
        expectedMarketStateVersion: null
      })
    ).rejects.toMatchObject<Partial<TradeServiceError>>({
      statusCode: 409,
      code: "market_result_known"
    });
    expect(tradeInsertValues).toHaveLength(0);
  });

  it("rejects direct sell trades with zero quantized proceeds as untradeable", async () => {
    const { pool, tradeInsertValues } = createDbPool({
      marketRows: [
        {
          market_id: "binary-market",
          market_status: "open",
          market_close_at: "2999-01-01T00:00:00.000Z",
          market_treasury_account_id: "market_treasury_1",
          market_state_version: "12",
          liquidity_b: "1.00000000",
          outcome_id: "yes-outcome",
          q_shares: "0.000001",
          sort_order: 0
        },
        {
          market_id: "binary-market",
          market_status: "open",
          market_close_at: "2999-01-01T00:00:00.000Z",
          market_treasury_account_id: "market_treasury_1",
          market_state_version: "12",
          liquidity_b: "1.00000000",
          outcome_id: "no-outcome",
          q_shares: "100.000000",
          sort_order: 1
        }
      ],
      positionRows: [
        {
          user_id: "seed_user_1",
          market_id: "binary-market",
          outcome_id: "yes-outcome",
          shares: "0.000001",
          cost_basis: "0.000001",
          realized_pnl: "0.000000"
        }
      ],
      contractPositionRows: [
        {
          user_id: "seed_user_1",
          market_id: "binary-market",
          requested_outcome_id: "yes-outcome",
          requested_outcome_key: "yes-outcome",
          contract_side: "yes",
          shares: "0.000001",
          cost_basis: "0.000001",
          realized_pnl: "0.000000"
        }
      ]
    });

    await expect(
      executeTrade(pool, BASE_ENV, "binary-market", {
        side: "sell",
        outcomeKey: "yes-outcome",
        contractSide: "yes",
        shareAmount: "0.000001",
        idempotencyKey: "trade-direct-untradeable-sell",
        quoteId: null,
        quotedAt: null,
        quoteExpiresAt: null,
        expectedMarketStateVersion: null
      })
    ).rejects.toMatchObject<Partial<TradeServiceError>>({
      statusCode: 409,
      code: "untradeable_amount"
    });
    expect(tradeInsertValues).toHaveLength(0);
  });

  it("rejects complement/no sell trades with zero quantized proceeds as untradeable", async () => {
    const { pool, tradeInsertValues } = createDbPool({
      marketRows: [
        {
          market_id: "market_seed_next_prime_minister",
          market_status: "open",
          market_treasury_account_id: "market_treasury_1",
          market_state_version: "12",
          liquidity_b: "1.00000000",
          outcome_id: "market_seed_next_prime_minister_outcome_option_a",
          q_shares: "100.000000",
          sort_order: 0
        },
        {
          market_id: "market_seed_next_prime_minister",
          market_status: "open",
          market_treasury_account_id: "market_treasury_1",
          market_state_version: "12",
          liquidity_b: "1.00000000",
          outcome_id: "market_seed_next_prime_minister_outcome_option_b",
          q_shares: "0.000001",
          sort_order: 1
        },
        {
          market_id: "market_seed_next_prime_minister",
          market_status: "open",
          market_treasury_account_id: "market_treasury_1",
          market_state_version: "12",
          liquidity_b: "1.00000000",
          outcome_id: "market_seed_next_prime_minister_outcome_option_c",
          q_shares: "0.000001",
          sort_order: 2
        }
      ],
      positionRows: [
        {
          user_id: "seed_user_1",
          market_id: "market_seed_next_prime_minister",
          outcome_id: "market_seed_next_prime_minister_outcome_option_b",
          shares: "0.000001",
          cost_basis: "0.000001",
          realized_pnl: "0.000000"
        },
        {
          user_id: "seed_user_1",
          market_id: "market_seed_next_prime_minister",
          outcome_id: "market_seed_next_prime_minister_outcome_option_c",
          shares: "0.000001",
          cost_basis: "0.000001",
          realized_pnl: "0.000000"
        }
      ],
      contractPositionRows: [
        {
          user_id: "seed_user_1",
          market_id: "market_seed_next_prime_minister",
          requested_outcome_id: "market_seed_next_prime_minister_outcome_option_a",
          requested_outcome_key: "option-a",
          contract_side: "no",
          shares: "0.000001",
          cost_basis: "0.000001",
          realized_pnl: "0.000000"
        }
      ]
    });

    await expect(
      executeTrade(pool, BASE_ENV, "next-prime-minister", {
        side: "sell",
        outcomeKey: "option-a",
        contractSide: "no",
        shareAmount: "0.000001",
        idempotencyKey: "trade-complement-untradeable-sell",
        quoteId: null,
        quotedAt: null,
        quoteExpiresAt: null,
        expectedMarketStateVersion: null
      })
    ).rejects.toMatchObject<Partial<TradeServiceError>>({
      statusCode: 409,
      code: "untradeable_amount"
    });
    expect(tradeInsertValues).toHaveLength(0);
  });

  it("deletes binary positions when selling the exact owned share amount", async () => {
    const {
      pool,
      positionUpsertValues,
      contractPositionUpsertValues,
      positionDeleteValues,
      contractPositionDeleteValues,
      pricingStateUpdateValues
    } = createDbPool({
      marketRows: [
        {
          market_id: "binary-market",
          market_status: "open",
          market_close_at: "2999-01-01T00:00:00.000Z",
          market_treasury_account_id: "market_treasury_1",
          market_state_version: "12",
          liquidity_b: "1000.00000000",
          outcome_id: "yes-outcome",
          q_shares: "20.000000",
          sort_order: 0
        },
        {
          market_id: "binary-market",
          market_status: "open",
          market_close_at: "2999-01-01T00:00:00.000Z",
          market_treasury_account_id: "market_treasury_1",
          market_state_version: "12",
          liquidity_b: "1000.00000000",
          outcome_id: "no-outcome",
          q_shares: "0.000000",
          sort_order: 1
        }
      ],
      positionRows: [
        {
          user_id: "seed_user_1",
          market_id: "binary-market",
          outcome_id: "yes-outcome",
          shares: "10.000000",
          cost_basis: "5.000000",
          realized_pnl: "0.000000"
        }
      ],
      contractPositionRows: [
        {
          user_id: "seed_user_1",
          market_id: "binary-market",
          requested_outcome_id: "yes-outcome",
          requested_outcome_key: "yes-outcome",
          contract_side: "yes",
          shares: "10.000000",
          cost_basis: "5.000000",
          realized_pnl: "0.000000"
        }
      ]
    });

    const response = await executeTrade(pool, BASE_ENV, "binary-market", {
      side: "sell",
      outcomeKey: "yes-outcome",
      contractSide: "yes",
      shareAmount: "10.000000",
      idempotencyKey: "trade-sell-all",
      quoteId: null,
      quotedAt: null,
      quoteExpiresAt: null,
      expectedMarketStateVersion: null
    });

    expect(response.sharesSold).toBe("10.000000");
    expect(positionUpsertValues).toHaveLength(0);
    expect(contractPositionUpsertValues).toHaveLength(0);
    expect(positionDeleteValues).toContainEqual([
      "seed_user_1",
      "binary-market",
      "yes-outcome"
    ]);
    expect(contractPositionDeleteValues).toContainEqual([
      "seed_user_1",
      "binary-market",
      "yes-outcome",
      "yes"
    ]);
    // Sells add proceedsReceived to the denormalized volume — same single
    // pricing-state UPDATE as buys, matching sum(trades.cash_amount).
    expect(pricingStateUpdateValues).toHaveLength(1);
    expect(pricingStateUpdateValues[0]).toEqual([
      "binary-market",
      response.proceedsReceived
    ]);
  });

  it("executes multi-outcome buy-no trades as complement bundle legs", async () => {
    const {
      pool,
      tradeInsertValues,
      tradeExecutionLegInsertValues,
      positionUpsertValues,
      contractPositionUpsertValues
    } = createDbPool({
      marketRows: [
        {
          market_id: "market_seed_next_prime_minister",
          market_status: "open",
          market_treasury_account_id: "market_treasury_1",
          market_state_version: "12",
          liquidity_b: "1000.00000000",
          outcome_id: "market_seed_next_prime_minister_outcome_option_a",
          q_shares: "0.000000",
          sort_order: 0
        },
        {
          market_id: "market_seed_next_prime_minister",
          market_status: "open",
          market_treasury_account_id: "market_treasury_1",
          market_state_version: "12",
          liquidity_b: "1000.00000000",
          outcome_id: "market_seed_next_prime_minister_outcome_option_b",
          q_shares: "0.000000",
          sort_order: 1
        },
        {
          market_id: "market_seed_next_prime_minister",
          market_status: "open",
          market_treasury_account_id: "market_treasury_1",
          market_state_version: "12",
          liquidity_b: "1000.00000000",
          outcome_id: "market_seed_next_prime_minister_outcome_option_c",
          q_shares: "0.000000",
          sort_order: 2
        }
      ]
    });

    const response = await executeTrade(pool, BASE_ENV, "next-prime-minister", {
      side: "buy",
      outcomeKey: "option-a",
      contractSide: "no",
      cashAmount: "25.000000",
      idempotencyKey: "trade-2",
      quoteId: null,
      quotedAt: null,
      quoteExpiresAt: null,
      expectedMarketStateVersion: null
    });

    expect(response).toMatchObject({
      side: "buy",
      contractSide: "no",
      outcomeKey: "option-a",
      outcomeId: "market_seed_next_prime_minister_outcome_option_a",
      executionOutcomeKey: null,
      executionOutcomeId: null,
      priceImpact: {
        direction: "up",
        level: expect.any(String),
        percentPoints: expect.any(String)
      },
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
        }
      ],
      positionSharesAfter: null,
      positionCostBasisAfter: null
    });
    expect(tradeInsertValues).toHaveLength(1);
    expect(tradeInsertValues[0]).toEqual(
      expect.arrayContaining([
        "market_seed_next_prime_minister",
        "option-a",
        "market_seed_next_prime_minister_outcome_option_a",
        "seed_user_1",
        "buy",
        "no"
      ])
    );
    expect(tradeExecutionLegInsertValues).toHaveLength(2);
    expect(positionUpsertValues).toHaveLength(2);
    expect(positionUpsertValues[0]).toEqual(
      expect.arrayContaining([
        "seed_user_1",
        "market_seed_next_prime_minister",
        "market_seed_next_prime_minister_outcome_option_b",
        response.sharesBought,
        "12.500000",
        "0.000000"
      ])
    );
    expect(positionUpsertValues[1]).toEqual(
      expect.arrayContaining([
        "seed_user_1",
        "market_seed_next_prime_minister",
        "market_seed_next_prime_minister_outcome_option_c",
        response.sharesBought,
        "12.500000",
        "0.000000"
      ])
    );
    expect(contractPositionUpsertValues).toHaveLength(1);
    expect(contractPositionUpsertValues[0]).toEqual(
      expect.arrayContaining([
        "seed_user_1",
        "market_seed_next_prime_minister",
        "market_seed_next_prime_minister_outcome_option_a",
        "option-a",
        "no",
        response.sharesBought,
        response.cashSpent,
        "0.000000"
      ])
    );
  });

  it("splits multi-outcome buy-no cost basis across complement legs", async () => {
    const { pool, positionUpsertValues } = createDbPool({
      marketRows: [
        {
          market_id: "market_seed_next_prime_minister",
          market_status: "open",
          market_treasury_account_id: "market_treasury_1",
          market_state_version: "12",
          liquidity_b: "1000.00000000",
          outcome_id: "market_seed_next_prime_minister_outcome_option_a",
          q_shares: "0.000000",
          sort_order: 0
        },
        {
          market_id: "market_seed_next_prime_minister",
          market_status: "open",
          market_treasury_account_id: "market_treasury_1",
          market_state_version: "12",
          liquidity_b: "1000.00000000",
          outcome_id: "market_seed_next_prime_minister_outcome_option_b",
          q_shares: "0.000000",
          sort_order: 1
        },
        {
          market_id: "market_seed_next_prime_minister",
          market_status: "open",
          market_treasury_account_id: "market_treasury_1",
          market_state_version: "12",
          liquidity_b: "1000.00000000",
          outcome_id: "market_seed_next_prime_minister_outcome_option_c",
          q_shares: "0.000000",
          sort_order: 2
        },
        {
          market_id: "market_seed_next_prime_minister",
          market_status: "open",
          market_treasury_account_id: "market_treasury_1",
          market_state_version: "12",
          liquidity_b: "1000.00000000",
          outcome_id: "market_seed_next_prime_minister_outcome_option_d",
          q_shares: "0.000000",
          sort_order: 3
        }
      ]
    });

    const response = await executeTrade(pool, BASE_ENV, "next-prime-minister", {
      side: "buy",
      outcomeKey: "option-a",
      contractSide: "no",
      cashAmount: "25.000000",
      idempotencyKey: "trade-cost-split",
      quoteId: null,
      quotedAt: null,
      quoteExpiresAt: null,
      expectedMarketStateVersion: null
    });

    expect(response.cashSpent).toBe("25.000000");
    expect(positionUpsertValues.map((values) => values[4])).toEqual([
      "8.333333",
      "8.333333",
      "8.333334"
    ]);
  });

  it("persists binary buy-no trades with requested side plus normalized execution outcome", async () => {
    const {
      pool,
      tradeInsertValues,
      tradeExecutionLegInsertValues,
      contractPositionUpsertValues
    } = createDbPool();

    const response = await executeTrade(pool, BASE_ENV, "binary-market", {
      side: "buy",
      outcomeKey: "yes-outcome",
      contractSide: "no",
      cashAmount: "25.000000",
      idempotencyKey: "trade-3",
      quoteId: "quote_1",
      quotedAt: "2999-01-01T00:00:00.000Z",
      quoteExpiresAt: "2999-01-01T00:00:03.000Z",
      expectedMarketStateVersion: 12
    });

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
      ],
      quoteId: "quote_1"
    });

    expect(tradeInsertValues).toHaveLength(1);
    expect(tradeInsertValues[0]).toEqual(
      expect.arrayContaining([
        "binary-market",
        "yes-outcome",
        "no-outcome",
        "seed_user_1",
        "buy",
        "no"
      ])
    );
    expect(tradeExecutionLegInsertValues).toHaveLength(1);
    expect(tradeExecutionLegInsertValues[0]).toEqual(
      expect.arrayContaining([
        expect.any(String),
        response.tradeId,
        "no-outcome",
        response.sharesBought,
        0
      ])
    );
    expect(contractPositionUpsertValues[0]).toEqual(
      expect.arrayContaining([
        "seed_user_1",
        "binary-market",
        "yes-outcome",
        "yes-outcome",
        "no",
        response.sharesBought,
        response.cashSpent,
        "0.000000"
      ])
    );
  });

  it("replays a completed idempotent buy response without executing any trade SQL", async () => {
    const storedResponse = {
      tradeId: "trade_replay_1",
      marketKey: "binary-market",
      marketId: "binary-market",
      marketStateVersionBefore: 12,
      marketStateVersionAfter: 13,
      executedAt: "2026-01-01T00:00:00.000Z",
      contractSide: "yes",
      outcomeKey: "yes-outcome",
      outcomeId: "yes-outcome",
      executionOutcomeKey: "yes-outcome",
      executionOutcomeId: "yes-outcome",
      quoteId: null,
      side: "buy",
      executionLegs: [{ outcomeKey: "yes-outcome", outcomeId: "yes-outcome", shareAmount: "25.000000" }],
      priceBefore: "0.500000",
      priceAfter: "0.510000",
      priceImpact: { direction: "up", level: "low", percentPoints: "1.00" },
      averagePrice: "0.505000",
      availableCashAfter: "975.000000",
      positionSharesAfter: "25.000000",
      positionCostBasisAfter: "25.000000",
      cashSpent: "25.000000",
      sharesBought: "25.000000"
    };

    const {
      pool,
      tradeInsertValues,
      positionUpsertValues,
      contractPositionUpsertValues,
      idempotencyState
    } = createDbPool({ completedResponse: storedResponse });

    const response = await executeTrade(pool, BASE_ENV, "binary-market", {
      side: "buy",
      outcomeKey: "yes-outcome",
      contractSide: "yes",
      cashAmount: "25.000000",
      idempotencyKey: "trade-replay-buy",
      quoteId: null,
      quotedAt: null,
      quoteExpiresAt: null,
      expectedMarketStateVersion: null
    });

    // Returns the stored response verbatim.
    expect(response).toEqual(storedResponse);
    // The request hash was captured from the insert call.
    expect(idempotencyState.capturedRequestHash).toBeTruthy();
    // No trade mutation SQL ran: no insert into trades, no position writes.
    expect(tradeInsertValues).toHaveLength(0);
    expect(positionUpsertValues).toHaveLength(0);
    expect(contractPositionUpsertValues).toHaveLength(0);
  });

  it("throws idempotency_conflict (409) when same key was used with a different request hash", async () => {
    const { pool, tradeInsertValues } = createDbPool({
      conflictingRequestHash: "0000000000000000000000000000000000000000000000000000000000000000"
    });

    await expect(
      executeTrade(pool, BASE_ENV, "binary-market", {
        side: "buy",
        outcomeKey: "yes-outcome",
        contractSide: "yes",
        cashAmount: "25.000000",
        idempotencyKey: "trade-conflict-key",
        quoteId: null,
        quotedAt: null,
        quoteExpiresAt: null,
        expectedMarketStateVersion: null
      })
    ).rejects.toMatchObject<Partial<TradeServiceError>>({
      statusCode: 409,
      code: "idempotency_conflict"
    });
    expect(tradeInsertValues).toHaveLength(0);
  });

  it("throws idempotency_in_progress (409) when same key+hash trade is still in flight", async () => {
    const { pool, tradeInsertValues } = createDbPool({ idempotencyInProgress: true });

    await expect(
      executeTrade(pool, BASE_ENV, "binary-market", {
        side: "buy",
        outcomeKey: "yes-outcome",
        contractSide: "yes",
        cashAmount: "25.000000",
        idempotencyKey: "trade-in-progress-key",
        quoteId: null,
        quotedAt: null,
        quoteExpiresAt: null,
        expectedMarketStateVersion: null
      })
    ).rejects.toMatchObject<Partial<TradeServiceError>>({
      statusCode: 409,
      code: "idempotency_in_progress"
    });
    expect(tradeInsertValues).toHaveLength(0);
  });

  it("executes multi-outcome sell-no trades from complement holdings", async () => {
    const { pool, tradeExecutionLegInsertValues } = createDbPool({
      marketRows: [
        {
          market_id: "market_seed_next_prime_minister",
          market_status: "open",
          market_treasury_account_id: "market_treasury_1",
          market_state_version: "12",
          liquidity_b: "1000.00000000",
          outcome_id: "market_seed_next_prime_minister_outcome_option_a",
          q_shares: "0.000000",
          sort_order: 0
        },
        {
          market_id: "market_seed_next_prime_minister",
          market_status: "open",
          market_treasury_account_id: "market_treasury_1",
          market_state_version: "12",
          liquidity_b: "1000.00000000",
          outcome_id: "market_seed_next_prime_minister_outcome_option_b",
          q_shares: "8.000000",
          sort_order: 1
        },
        {
          market_id: "market_seed_next_prime_minister",
          market_status: "open",
          market_treasury_account_id: "market_treasury_1",
          market_state_version: "12",
          liquidity_b: "1000.00000000",
          outcome_id: "market_seed_next_prime_minister_outcome_option_c",
          q_shares: "8.000000",
          sort_order: 2
        }
      ],
      positionRows: [
        {
          user_id: "seed_user_1",
          market_id: "market_seed_next_prime_minister",
          outcome_id: "market_seed_next_prime_minister_outcome_option_b",
          shares: "10.000000",
          cost_basis: "2.500000",
          realized_pnl: "0.000000"
        },
        {
          user_id: "seed_user_1",
          market_id: "market_seed_next_prime_minister",
          outcome_id: "market_seed_next_prime_minister_outcome_option_c",
          shares: "10.000000",
          cost_basis: "2.500000",
          realized_pnl: "0.000000"
        }
      ],
      contractPositionRows: [
        {
          user_id: "seed_user_1",
          market_id: "market_seed_next_prime_minister",
          requested_outcome_id: "market_seed_next_prime_minister_outcome_option_a",
          requested_outcome_key: "option-a",
          contract_side: "no",
          shares: "10.000000",
          cost_basis: "5.000000",
          realized_pnl: "0.000000"
        }
      ]
    });

    const response = await executeTrade(pool, BASE_ENV, "next-prime-minister", {
      side: "sell",
      outcomeKey: "option-a",
      contractSide: "no",
      shareAmount: "5.000000",
      idempotencyKey: "trade-4",
      quoteId: null,
      quotedAt: null,
      quoteExpiresAt: null,
      expectedMarketStateVersion: null
    });

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
      positionSharesAfter: null,
      positionCostBasisAfter: null,
      sharesSold: "5.000000",
      proceedsReceived: expect.any(String),
      realizedPnlDelta: expect.any(String)
    });
    expect(tradeExecutionLegInsertValues).toHaveLength(2);
  });

  it("attributes multi-leg sell proceeds by pre-trade leg value, not equal split", async () => {
    // option_b (q=300, b=100) is worth ~20x option_c (q=8). Selling the
    // complement bundle must book a gain on the expensive leg and a loss on
    // the cheap one — equal split would book identical phantom gains.
    const { pool, positionUpsertValues } = createDbPool({
      marketRows: [
        {
          market_id: "market_seed_next_prime_minister",
          market_status: "open",
          market_treasury_account_id: "market_treasury_1",
          market_state_version: "12",
          liquidity_b: "100.00000000",
          outcome_id: "market_seed_next_prime_minister_outcome_option_a",
          q_shares: "0.000000",
          sort_order: 0
        },
        {
          market_id: "market_seed_next_prime_minister",
          market_status: "open",
          market_treasury_account_id: "market_treasury_1",
          market_state_version: "12",
          liquidity_b: "100.00000000",
          outcome_id: "market_seed_next_prime_minister_outcome_option_b",
          q_shares: "300.000000",
          sort_order: 1
        },
        {
          market_id: "market_seed_next_prime_minister",
          market_status: "open",
          market_treasury_account_id: "market_treasury_1",
          market_state_version: "12",
          liquidity_b: "100.00000000",
          outcome_id: "market_seed_next_prime_minister_outcome_option_c",
          q_shares: "8.000000",
          sort_order: 2
        }
      ],
      positionRows: [
        {
          user_id: "seed_user_1",
          market_id: "market_seed_next_prime_minister",
          outcome_id: "market_seed_next_prime_minister_outcome_option_b",
          shares: "10.000000",
          cost_basis: "2.500000",
          realized_pnl: "0.000000"
        },
        {
          user_id: "seed_user_1",
          market_id: "market_seed_next_prime_minister",
          outcome_id: "market_seed_next_prime_minister_outcome_option_c",
          shares: "10.000000",
          cost_basis: "2.500000",
          realized_pnl: "0.000000"
        }
      ],
      contractPositionRows: [
        {
          user_id: "seed_user_1",
          market_id: "market_seed_next_prime_minister",
          requested_outcome_id: "market_seed_next_prime_minister_outcome_option_a",
          requested_outcome_key: "option-a",
          contract_side: "no",
          shares: "10.000000",
          cost_basis: "5.000000",
          realized_pnl: "0.000000"
        }
      ]
    });

    const response = await executeTrade(pool, BASE_ENV, "next-prime-minister", {
      side: "sell",
      outcomeKey: "option-a",
      contractSide: "no",
      shareAmount: "5.000000",
      idempotencyKey: "trade-asymmetric-legs",
      quoteId: null,
      quotedAt: null,
      quoteExpiresAt: null,
      expectedMarketStateVersion: null
    });

    const upsertByOutcomeId = new Map(
      positionUpsertValues.map((values) => [values[2], values])
    );
    const expensiveLeg = upsertByOutcomeId.get(
      "market_seed_next_prime_minister_outcome_option_b"
    )!;
    const cheapLeg = upsertByOutcomeId.get(
      "market_seed_next_prime_minister_outcome_option_c"
    )!;

    // removedCostBasis per leg = floor((2.50 / 10) × 5) = 1.250000.
    const expensivePnl = Number(expensiveLeg[5]);
    const cheapPnl = Number(cheapLeg[5]);
    expect(expensivePnl).toBeGreaterThan(0);
    expect(cheapPnl).toBeLessThan(0);
    expect(expensivePnl).toBeGreaterThan(cheapPnl);

    // Leg proceeds (pnl + removed cost basis) must sum EXACTLY to the
    // quote's total proceeds — the old equal split could drop 0.000001.
    const proceeds = Number(response.proceedsReceived);
    expect((expensivePnl + 1.25 + cheapPnl + 1.25).toFixed(6)).toBe(
      proceeds.toFixed(6)
    );
  });
});
