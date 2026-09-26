import { afterEach, describe, expect, it, vi } from "vitest";

import type { RateLimiter } from "../../src/http/rate-limit";
import { closeAppTestServers, startServer } from "./app-test-harness";

afterEach(async () => {
  await closeAppTestServers();
});

const sessionRequiredEnv = {
  trading: {
    requireSession: true
  }
};

// ---------------------------------------------------------------------------
// Shared query-impl factory for trade write tests.
//
// The startServer harness wires pool.query AND client.query to the same vi.fn,
// so a single queryImpl covers both the session/user lookups (non-tx) and the
// transactional trade writes that go through withTransaction → pool.connect().
//
// Binary market fixture: "binary-market" (falls through resolveMarketIdentity
// as a pass-through identity where marketId === marketKey).  We use
// "next-prime-minister" / "market_seed_next_prime_minister" when we need a
// canonical multi-outcome identity.
// ---------------------------------------------------------------------------

type TradeQueryImplOptions = {
  /** Pre-existing contract position for sell tests. */
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
  /** Pre-existing position rows for sell tests. */
  positionRows?: Array<{
    user_id: string;
    market_id: string;
    outcome_id: string;
    shares: string;
    cost_basis: string;
    realized_pnl: string;
  }>;
  /** Simulates idempotency insert returning 0 rows (collision) + completed snapshot. */
  completedResponse?: unknown;
  /** Tracks every insert into trades so tests can assert write counts. */
  tradeInsertValues?: unknown[][];
};

function createTradeQueryImpl(opts: TradeQueryImplOptions = {}) {
  const tradeInsertValues = opts.tradeInsertValues ?? [];

  return async (sql: string, values?: unknown[]) => {
    // ------------------------------------------------------------------ tx
    if (sql === "begin" || sql === "commit" || sql === "rollback") {
      return { rows: [], rowCount: 0 };
    }

    if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
      return { rows: [], rowCount: 0 };
    }

    // --------------------------------------------------------- advisory lock
    if (sql.includes("pg_advisory_xact_lock")) {
      return { rows: [], rowCount: 1 };
    }

    // ------------------------------------------------------------ user check
    if (sql.includes("from users")) {
      return {
        rows: [
          {
            user_id: "seed_user_1",
            user_status: "active",
            user_role: "user",
            trade_access_status: "enabled"
          }
        ],
        rowCount: 1
      };
    }

    // ------------------------------------------------------- idempotency insert
    if (sql.includes("insert into idempotency_records")) {
      if (opts.completedResponse !== undefined) {
        return { rows: [], rowCount: 0 };
      }

      return { rows: [{ id: "idempotency_1" }], rowCount: 1 };
    }

    // ------------------------------------------------------- idempotency select
    if (sql.includes("select id, request_hash, status, response_snapshot")) {
      if (opts.completedResponse !== undefined) {
        return {
          rows: [
            {
              id: "idempotency_1",
              request_hash: "any-hash",
              status: "completed",
              response_snapshot: opts.completedResponse
            }
          ],
          rowCount: 1
        };
      }

      return { rows: [], rowCount: 0 };
    }

    // ---------------------------------------------------------- market rows
    if (sql.includes("from markets m")) {
      return {
        rows: [
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
        ],
        rowCount: 2
      };
    }

    // ---------------------------------------------------------- user cash account
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

    // ---------------------------------------------------------- treasury account
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

    // ---------------------------------------------------------- contract positions
    if (sql.includes("select") && sql.includes("from contract_positions")) {
      const requestedOutcomeId =
        typeof values?.[2] === "string" ? (values[2] as string) : null;
      const contractSide =
        values?.[3] === "yes" || values?.[3] === "no" ? values[3] : null;

      const source = opts.contractPositionRows ?? [];
      const filteredRows = source.filter((row) => {
        if (requestedOutcomeId && row.requested_outcome_id !== requestedOutcomeId) {
          return false;
        }

        if (contractSide && row.contract_side !== contractSide) {
          return false;
        }

        return true;
      });

      return { rows: filteredRows, rowCount: filteredRows.length };
    }

    // ---------------------------------------------------------- positions
    if (sql.includes("select") && sql.includes("from positions")) {
      const requestedOutcomeIds = Array.isArray(values?.[2])
        ? (values[2] as string[])
        : null;
      const requestedOutcomeId =
        typeof values?.[2] === "string" ? (values[2] as string) : null;

      const source = opts.positionRows ?? [];
      const filteredRows = source.filter((row) => {
        if (requestedOutcomeIds) {
          return requestedOutcomeIds.includes(row.outcome_id);
        }

        if (requestedOutcomeId) {
          return row.outcome_id === requestedOutcomeId;
        }

        return true;
      });

      return { rows: filteredRows, rowCount: filteredRows.length };
    }

    // ---------------------------------------------------------- write ops
    if (sql.includes("insert into trades")) {
      tradeInsertValues.push(values ?? []);
      return { rows: [], rowCount: 1 };
    }

    if (
      sql.includes("update accounts") ||
      sql.includes("update market_outcome_state") ||
      sql.includes("update market_pricing_state") ||
      sql.includes("insert into trade_execution_legs") ||
      sql.includes("insert into positions") ||
      sql.includes("insert into contract_positions") ||
      sql.includes("delete from positions") ||
      sql.includes("delete from contract_positions") ||
      sql.includes("insert into realization_events") ||
      sql.includes("insert into audit_events") ||
      sql.includes("insert into ledger_entries") ||
      sql.includes("insert into ledger_transactions") ||
      sql.includes("update idempotency_records")
    ) {
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes("order by sequence_number desc")) {
      return { rows: [], rowCount: 0 };
    }

    throw new Error(`Unexpected db query in trade-write-routes test: ${sql}`);
  };
}

// ---------------------------------------------------------------------------
// Helper: craft a minimal session row so the actor resolves as authenticated.
// Used when requireSession=true is set and we need the route to pass auth.
// ---------------------------------------------------------------------------
function createSessionQueryImpl(
  baseImpl: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number }>
) {
  return async (sql: string, values?: unknown[]) => {
    if (sql.includes("from sessions s")) {
      return {
        rows: [
          {
            session_id: "session_1",
            user_id: "seed_user_1",
            session_status: "active",
            created_at: new Date(Date.now() - 3_600_000),
            expires_at: new Date(Date.now() + 60_000),
            user_status: "active",
            user_role: "user",
            last_seen_at: new Date(Date.now() - 120_000)
          }
        ],
        rowCount: 1
      };
    }

    if (sql.includes("update sessions")) {
      return { rows: [], rowCount: 0 };
    }

    return baseImpl(sql, values);
  };
}

describe("trade write routes", () => {
  it("applies trade-write rate limits with resolved actor context before executing", async () => {
    const tradeInsertValues: unknown[][] = [];
    const rateLimiter: RateLimiter = {
      check: vi.fn(() => ({
        allowed: false,
        family: "trade_write",
        limit: 1,
        remaining: 0,
        resetAt: Date.now() + 60_000,
        retryAfterSeconds: 60
      }))
    };
    const { baseUrl } = await startServer({
      queryImpl: createTradeQueryImpl({ tradeInsertValues }),
      rateLimiter
    });

    const response = await fetch(`${baseUrl}/api/markets/binary-market/trades`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        side: "buy",
        contractSide: "yes",
        outcomeKey: "yes-outcome",
        cashAmount: "25.00",
        idempotencyKey: "http-rate-limit-actor-context",
        quoteId: null,
        quotedAt: null,
        quoteExpiresAt: null,
        expectedMarketStateVersion: null
      })
    });
    const payload = await response.json();

    expect(response.status).toBe(429);
    expect(payload.error.code).toBe("rate_limited");
    expect(tradeInsertValues).toHaveLength(0);
    expect(rateLimiter.check).toHaveBeenCalledTimes(1);
    expect(vi.mocked(rateLimiter.check).mock.calls[0]?.[1]).toBe("trade_write");
    expect(vi.mocked(rateLimiter.check).mock.calls[0]?.[2]).toMatchObject({
      actorId: "seed_user_1"
    });
  });

  it("rejects no-cookie quotes when beta session-only is enabled", async () => {
    const rateLimiter: RateLimiter = {
      check: vi.fn(() => ({
        allowed: true,
        family: "trade_write",
        limit: 60,
        remaining: 59,
        resetAt: Date.now() + 60_000,
        retryAfterSeconds: 0
      }))
    };
    const { baseUrl } = await startServer({
      env: sessionRequiredEnv,
      rateLimiter
    });

    const response = await fetch(`${baseUrl}/api/markets/test-market/quote`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        side: "buy",
        contractSide: "yes",
        outcomeKey: "option-a",
        cashAmount: "1.00"
      })
    });
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error.code).toBe("unauthorized");
    expect(rateLimiter.check).toHaveBeenCalledTimes(1);
    expect(vi.mocked(rateLimiter.check).mock.calls[0]?.[1]).toBe("trade_write");
    expect(vi.mocked(rateLimiter.check).mock.calls[0]?.[2]).toBeUndefined();
  });

  it("rate-limits no-cookie trades when beta session-only is enabled and the IP fallback bucket is exhausted", async () => {
    const rateLimiter: RateLimiter = {
      check: vi.fn(() => ({
        allowed: false,
        family: "trade_write",
        limit: 1,
        remaining: 0,
        resetAt: Date.now() + 60_000,
        retryAfterSeconds: 60
      }))
    };
    const { baseUrl } = await startServer({
      env: sessionRequiredEnv,
      rateLimiter
    });

    const response = await fetch(`${baseUrl}/api/markets/test-market/trades`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        side: "buy",
        contractSide: "yes",
        outcomeKey: "option-a",
        cashAmount: "1.00",
        idempotencyKey: "beta-session-only-test"
      })
    });
    const payload = await response.json();

    expect(response.status).toBe(429);
    expect(payload.error.code).toBe("rate_limited");
    expect(rateLimiter.check).toHaveBeenCalledTimes(1);
    expect(vi.mocked(rateLimiter.check).mock.calls[0]?.[1]).toBe("trade_write");
    expect(vi.mocked(rateLimiter.check).mock.calls[0]?.[2]).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // 1. Successful buy — demo actor, valid body → 200, response shape + DB write
  // -----------------------------------------------------------------------
  it("executes a successful buy and returns the trade response shape", async () => {
    const tradeInsertValues: unknown[][] = [];
    const { baseUrl } = await startServer({
      queryImpl: createTradeQueryImpl({ tradeInsertValues })
    });

    const response = await fetch(`${baseUrl}/api/markets/binary-market/trades`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        side: "buy",
        contractSide: "yes",
        outcomeKey: "yes-outcome",
        cashAmount: "25.00",
        idempotencyKey: "http-buy-1",
        quoteId: null,
        quotedAt: null,
        quoteExpiresAt: null,
        expectedMarketStateVersion: null
      })
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    // Response shape: common fields
    expect(payload).toMatchObject({
      side: "buy",
      contractSide: "yes",
      outcomeKey: "yes-outcome",
      marketKey: "binary-market",
      marketId: "binary-market",
      marketStateVersionBefore: 12,
      marketStateVersionAfter: 13
    });
    // Buy-specific fields
    expect(typeof payload.cashSpent).toBe("string");
    expect(typeof payload.sharesBought).toBe("string");
    expect(typeof payload.availableCashAfter).toBe("string");
    expect(typeof payload.priceBefore).toBe("string");
    expect(typeof payload.priceAfter).toBe("string");
    expect(payload.executionLegs).toHaveLength(1);
    expect(payload.executionLegs[0]).toMatchObject({
      outcomeKey: "yes-outcome",
      outcomeId: "yes-outcome"
    });
    expect(payload.priceImpact).toMatchObject({
      direction: expect.any(String),
      level: expect.any(String),
      percentPoints: expect.any(String)
    });
    // DB: one insert into trades
    expect(tradeInsertValues).toHaveLength(1);
    expect(tradeInsertValues[0]).toEqual(
      expect.arrayContaining(["binary-market", "yes-outcome", "seed_user_1", "buy", "yes"])
    );
  });

  // -----------------------------------------------------------------------
  // 2. Successful sell of an existing position → 200, response shape asserted
  //
  // The binary market fixture used here has yes-outcome q_shares=20 so the
  // LMSR sell quote produces non-zero proceeds (q=0 would make proceeds
  // vanishingly small and trip the untradeable_amount guard).
  // -----------------------------------------------------------------------
  it("executes a successful sell of an existing position and returns the trade response shape", async () => {
    const tradeInsertValues: unknown[][] = [];

    // Custom queryImpl so we can control q_shares on yes-outcome.
    const queryImpl = async (sql: string, values?: unknown[]) => {
      if (sql === "begin" || sql === "commit" || sql === "rollback") {
        return { rows: [], rowCount: 0 };
      }

      if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
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
              user_status: "active",
              user_role: "user",
              trade_access_status: "enabled"
            }
          ],
          rowCount: 1
        };
      }

      if (sql.includes("insert into idempotency_records")) {
        return { rows: [{ id: "idempotency_1" }], rowCount: 1 };
      }

      if (sql.includes("select id, request_hash, status, response_snapshot")) {
        return { rows: [], rowCount: 0 };
      }

      if (sql.includes("from markets m")) {
        return {
          rows: [
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
          rowCount: 2
        };
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
        const source = [
          {
            user_id: "seed_user_1",
            market_id: "binary-market",
            requested_outcome_id: "yes-outcome",
            requested_outcome_key: "yes-outcome",
            contract_side: "yes" as const,
            shares: "5.000000",
            cost_basis: "2.500000",
            realized_pnl: "0.000000"
          }
        ];

        const filtered = source.filter((row) => {
          if (requestedOutcomeId && row.requested_outcome_id !== requestedOutcomeId) return false;
          if (contractSide && row.contract_side !== contractSide) return false;
          return true;
        });

        return { rows: filtered, rowCount: filtered.length };
      }

      if (sql.includes("select") && sql.includes("from positions")) {
        const requestedOutcomeIds = Array.isArray(values?.[2]) ? (values[2] as string[]) : null;
        const requestedOutcomeId = typeof values?.[2] === "string" ? (values[2] as string) : null;
        const source = [
          {
            user_id: "seed_user_1",
            market_id: "binary-market",
            outcome_id: "yes-outcome",
            shares: "10.000000",
            cost_basis: "5.000000",
            realized_pnl: "0.000000"
          }
        ];

        const filtered = source.filter((row) => {
          if (requestedOutcomeIds) return requestedOutcomeIds.includes(row.outcome_id);
          if (requestedOutcomeId) return row.outcome_id === requestedOutcomeId;
          return true;
        });

        return { rows: filtered, rowCount: filtered.length };
      }

      if (sql.includes("insert into trades")) {
        tradeInsertValues.push(values ?? []);
        return { rows: [], rowCount: 1 };
      }

      if (
        sql.includes("update accounts") ||
        sql.includes("update market_outcome_state") ||
        sql.includes("update market_pricing_state") ||
        sql.includes("insert into trade_execution_legs") ||
        sql.includes("insert into positions") ||
        sql.includes("insert into contract_positions") ||
        sql.includes("delete from positions") ||
        sql.includes("delete from contract_positions") ||
        sql.includes("insert into realization_events") ||
        sql.includes("insert into audit_events") ||
        sql.includes("insert into ledger_entries") ||
        sql.includes("insert into ledger_transactions") ||
        sql.includes("update idempotency_records")
      ) {
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("order by sequence_number desc")) {
        return { rows: [], rowCount: 0 };
      }

      throw new Error(`Unexpected db query in sell test: ${sql}`);
    };

    const { baseUrl } = await startServer({ queryImpl });

    const response = await fetch(`${baseUrl}/api/markets/binary-market/trades`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        side: "sell",
        contractSide: "yes",
        outcomeKey: "yes-outcome",
        shareAmount: "5.000000",
        idempotencyKey: "http-sell-1",
        quoteId: null,
        quotedAt: null,
        quoteExpiresAt: null,
        expectedMarketStateVersion: null
      })
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      side: "sell",
      contractSide: "yes",
      outcomeKey: "yes-outcome",
      marketKey: "binary-market",
      marketId: "binary-market",
      marketStateVersionBefore: 12,
      marketStateVersionAfter: 13
    });
    // Sell-specific fields
    expect(payload.sharesSold).toBe("5.000000");
    expect(typeof payload.proceedsReceived).toBe("string");
    expect(typeof payload.realizedPnlDelta).toBe("string");
    expect(typeof payload.availableCashAfter).toBe("string");
    expect(payload.executionLegs).toHaveLength(1);
    expect(tradeInsertValues).toHaveLength(1);
    expect(tradeInsertValues[0]).toEqual(
      expect.arrayContaining(["binary-market", "yes-outcome", "seed_user_1", "sell", "yes"])
    );
  });

  // -----------------------------------------------------------------------
  // 3. Invalid body shape → 400 with error envelope
  // -----------------------------------------------------------------------
  it("returns 400 with error envelope when required body fields are missing", async () => {
    const { baseUrl } = await startServer({
      queryImpl: createTradeQueryImpl()
    });

    // Missing outcomeKey and cashAmount — parser throws TradeServiceError(400)
    const response = await fetch(`${baseUrl}/api/markets/binary-market/trades`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        side: "buy",
        contractSide: "yes",
        idempotencyKey: "bad-body-1"
        // outcomeKey and cashAmount intentionally omitted
      })
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toMatchObject({
      error: {
        code: expect.any(String),
        message: expect.any(String)
      }
    });
    expect(payload.error.code).toBe("invalid_request");
  });

  it("returns 400 with error envelope when body has wrong types", async () => {
    const { baseUrl } = await startServer({
      queryImpl: createTradeQueryImpl()
    });

    // cashAmount is a number, not a string — normalizeUserCashAmountInput will reject
    const response = await fetch(`${baseUrl}/api/markets/binary-market/trades`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        side: "buy",
        contractSide: "yes",
        outcomeKey: "yes-outcome",
        cashAmount: 25,
        idempotencyKey: "bad-body-2"
      })
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toMatchObject({
      error: {
        code: "invalid_request",
        message: expect.any(String)
      }
    });
  });

  // -----------------------------------------------------------------------
  // 4. Unknown market → 404 with proper error code
  //
  // The market key resolves through resolveMarketIdentity which falls through
  // for unknown keys (returns a pass-through identity). The 404 is raised when
  // the DB query for market rows returns zero rows.
  // -----------------------------------------------------------------------
  it("returns 404 when the market is not found in the database", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string) => {
        if (sql === "begin" || sql === "commit" || sql === "rollback") {
          return { rows: [], rowCount: 0 };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
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
                user_status: "active",
                user_role: "user",
                trade_access_status: "enabled"
              }
            ],
            rowCount: 1
          };
        }

        if (sql.includes("insert into idempotency_records")) {
          return { rows: [{ id: "idempotency_1" }], rowCount: 1 };
        }

        if (sql.includes("select id, request_hash, status, response_snapshot")) {
          return { rows: [], rowCount: 0 };
        }

        // Market rows query returns empty — triggers market_not_found
        if (sql.includes("from markets m")) {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes("update idempotency_records")) {
          return { rows: [], rowCount: 1 };
        }

        throw new Error(`Unexpected db query in 404 test: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/api/markets/totally-unknown-market-xyz/trades`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        side: "buy",
        contractSide: "yes",
        outcomeKey: "some-outcome",
        cashAmount: "10.00",
        idempotencyKey: "unknown-market-1",
        quoteId: null,
        quotedAt: null,
        quoteExpiresAt: null,
        expectedMarketStateVersion: null
      })
    });
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toMatchObject({
      error: {
        code: "market_not_found",
        message: expect.any(String)
      }
    });
  });

  // -----------------------------------------------------------------------
  // 5. Quote/state conflict (market_not_open) → 409
  //
  // market_close_at in the past makes isMarketOpenForTrading return false,
  // which throws TradeServiceError(409, "market_not_open").
  // -----------------------------------------------------------------------
  it("returns 409 market_not_open when the market close_at is in the past", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string) => {
        if (sql === "begin" || sql === "commit" || sql === "rollback") {
          return { rows: [], rowCount: 0 };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
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
                user_status: "active",
                user_role: "user",
                trade_access_status: "enabled"
              }
            ],
            rowCount: 1
          };
        }

        if (sql.includes("insert into idempotency_records")) {
          return { rows: [{ id: "idempotency_1" }], rowCount: 1 };
        }

        if (sql.includes("select id, request_hash, status, response_snapshot")) {
          return { rows: [], rowCount: 0 };
        }

        // Market with close_at in the past — triggers market_not_open (409)
        if (sql.includes("from markets m")) {
          return {
            rows: [
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
            ],
            rowCount: 2
          };
        }

        if (sql.includes("update idempotency_records")) {
          return { rows: [], rowCount: 1 };
        }

        throw new Error(`Unexpected db query in 409 test: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/api/markets/binary-market/trades`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        side: "buy",
        contractSide: "yes",
        outcomeKey: "yes-outcome",
        cashAmount: "25.00",
        idempotencyKey: "market-not-open-1",
        quoteId: null,
        quotedAt: null,
        quoteExpiresAt: null,
        expectedMarketStateVersion: null
      })
    });
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload).toMatchObject({
      error: {
        code: "market_not_open",
        message: expect.any(String)
      }
    });
  });

  // -----------------------------------------------------------------------
  // 6. Idempotency replay: same key twice → second call returns stored result,
  //    no duplicate execution (DB write count stays at 1 after both calls).
  // -----------------------------------------------------------------------
  it("replays the stored response on the second call with the same idempotency key", async () => {
    const tradeInsertValues: unknown[][] = [];
    let idempotencyInsertCount = 0;
    let idempotencyState: { capturedHash: string | null } = { capturedHash: null };

    const queryImpl = async (sql: string, values?: unknown[]) => {
      if (sql === "begin" || sql === "commit" || sql === "rollback") {
        return { rows: [], rowCount: 0 };
      }

      if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
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
              user_status: "active",
              user_role: "user",
              trade_access_status: "enabled"
            }
          ],
          rowCount: 1
        };
      }

      if (sql.includes("insert into idempotency_records")) {
        idempotencyInsertCount += 1;
        // Capture hash from $5 param on first call
        if (idempotencyState.capturedHash === null) {
          idempotencyState.capturedHash = String(values?.[4] ?? "");
        }

        // First call: insert succeeds
        if (idempotencyInsertCount === 1) {
          return { rows: [{ id: "idempotency_1" }], rowCount: 1 };
        }

        // Second call: ON CONFLICT DO NOTHING → 0 rows (signals collision)
        return { rows: [], rowCount: 0 };
      }

      if (sql.includes("select id, request_hash, status, response_snapshot")) {
        // First call: no prior record
        if (idempotencyInsertCount <= 1) {
          return { rows: [], rowCount: 0 };
        }

        // Second call: return the stored completed record with the captured hash
        return {
          rows: [
            {
              id: "idempotency_1",
              request_hash: idempotencyState.capturedHash ?? "",
              status: "completed",
              response_snapshot: {
                tradeId: "trade_idempotent_1",
                side: "buy",
                contractSide: "yes",
                outcomeKey: "yes-outcome",
                outcomeId: "yes-outcome",
                marketKey: "binary-market",
                marketId: "binary-market",
                cashSpent: "25.000000",
                sharesBought: "24.690420",
                availableCashAfter: "975.000000"
              }
            }
          ],
          rowCount: 1
        };
      }

      if (sql.includes("from markets m")) {
        return {
          rows: [
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
          ],
          rowCount: 2
        };
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
        return { rows: [], rowCount: 0 };
      }

      if (sql.includes("select") && sql.includes("from positions")) {
        return { rows: [], rowCount: 0 };
      }

      if (sql.includes("insert into trades")) {
        tradeInsertValues.push(values ?? []);
        return { rows: [], rowCount: 1 };
      }

      if (
        sql.includes("update accounts") ||
        sql.includes("update market_outcome_state") ||
        sql.includes("update market_pricing_state") ||
        sql.includes("insert into trade_execution_legs") ||
        sql.includes("insert into positions") ||
        sql.includes("insert into contract_positions") ||
        sql.includes("delete from positions") ||
        sql.includes("delete from contract_positions") ||
        sql.includes("insert into realization_events") ||
        sql.includes("insert into audit_events") ||
        sql.includes("insert into ledger_entries") ||
        sql.includes("insert into ledger_transactions") ||
        sql.includes("update idempotency_records")
      ) {
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("order by sequence_number desc")) {
        return { rows: [], rowCount: 0 };
      }

      throw new Error(`Unexpected db query in idempotency test: ${sql}`);
    };

    const { baseUrl } = await startServer({ queryImpl });

    const tradeBody = JSON.stringify({
      side: "buy",
      contractSide: "yes",
      outcomeKey: "yes-outcome",
      cashAmount: "25.00",
      idempotencyKey: "replay-key-1",
      quoteId: null,
      quotedAt: null,
      quoteExpiresAt: null,
      expectedMarketStateVersion: null
    });
    const headers = { "content-type": "application/json" };

    // First call — trade executes
    const firstResponse = await fetch(`${baseUrl}/api/markets/binary-market/trades`, {
      method: "POST",
      headers,
      body: tradeBody
    });
    expect(firstResponse.status).toBe(200);
    const firstPayload = await firstResponse.json();
    expect(firstPayload.side).toBe("buy");

    // Second call — idempotency replay, stored snapshot is returned verbatim
    const secondResponse = await fetch(`${baseUrl}/api/markets/binary-market/trades`, {
      method: "POST",
      headers,
      body: tradeBody
    });
    expect(secondResponse.status).toBe(200);
    const secondPayload = await secondResponse.json();

    // Second response returns the stored snapshot
    expect(secondPayload.tradeId).toBe("trade_idempotent_1");
    expect(secondPayload.cashSpent).toBe("25.000000");

    // The insert into trades must have fired exactly once (first call only)
    expect(tradeInsertValues).toHaveLength(1);
  });

  // -----------------------------------------------------------------------
  // 7. GET /api/markets/:marketKey/trades/status — network-drop trust probe.
  // -----------------------------------------------------------------------
  describe("GET /api/markets/:marketKey/trades/status", () => {
    function createStatusQueryImpl(
      row: { status: string; response_snapshot: unknown } | null
    ) {
      return async (sql: string, values?: unknown[]) => {
        if (sql.includes("from idempotency_records")) {
          expect(sql).toContain("scope = 'trade'");
          expect(values).toEqual(["seed_user_1", expect.any(String)]);
          return row ? { rows: [row], rowCount: 1 } : { rows: [], rowCount: 0 };
        }

        throw new Error(`Unexpected db query in trade-status test: ${sql}`);
      };
    }

    it("returns the executed receipt when a completed trade exists for this actor", async () => {
      const { baseUrl } = await startServer({
        queryImpl: createStatusQueryImpl({
          status: "completed",
          response_snapshot: {
            side: "buy",
            contractSide: "yes",
            outcomeKey: "yes-outcome",
            outcomeId: "yes-outcome",
            cashSpent: "25.000000",
            sharesBought: "24.690420",
            executedAt: "2026-07-04T12:00:00.000Z"
          }
        })
      });

      const response = await fetch(
        `${baseUrl}/api/markets/binary-market/trades/status?idempotencyKey=exists-mine-1`
      );
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload).toEqual({
        status: "executed",
        receipt: {
          side: "buy",
          outcomeKey: "yes-outcome",
          cashAmount: "25.000000",
          createdAt: "2026-07-04T12:00:00.000Z"
        }
      });
    });

    it("returns not_found when no record exists for this idempotency key", async () => {
      const { baseUrl } = await startServer({
        queryImpl: createStatusQueryImpl(null)
      });

      const response = await fetch(
        `${baseUrl}/api/markets/binary-market/trades/status?idempotencyKey=absent-key-1`
      );
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload).toEqual({ status: "not_found" });
    });

    it("returns not_found (never another actor's trade) even though the row-scoping happens in SQL", async () => {
      // The query always binds actor_id = the resolved session/demo actor (asserted
      // above as "seed_user_1"). Simulating "belongs to someone else" means the SQL
      // filter itself returns zero rows — there is no code path that can return a
      // receipt without the actor_id predicate matching. This test pins that the
      // route never trusts a client-supplied actor and always reads from the
      // resolved session actor.
      const { baseUrl } = await startServer({
        queryImpl: createStatusQueryImpl(null)
      });

      const response = await fetch(
        `${baseUrl}/api/markets/binary-market/trades/status?idempotencyKey=belongs-to-another-user`
      );
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload).toEqual({ status: "not_found" });
    });

    it("returns 400 when idempotencyKey is missing", async () => {
      const { baseUrl } = await startServer({
        queryImpl: createStatusQueryImpl(null)
      });

      const response = await fetch(`${baseUrl}/api/markets/binary-market/trades/status`);
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(payload.error.code).toBe("invalid_request");
    });

    it("applies market_read rate limiting (not a fallback global limiter)", async () => {
      const rateLimiter: RateLimiter = {
        check: vi.fn(() => ({
          allowed: true,
          family: "market_read",
          limit: 600,
          remaining: 599,
          resetAt: Date.now() + 60_000,
          retryAfterSeconds: 0
        }))
      };
      const { baseUrl } = await startServer({
        queryImpl: createStatusQueryImpl(null),
        rateLimiter
      });

      const response = await fetch(
        `${baseUrl}/api/markets/binary-market/trades/status?idempotencyKey=rate-limit-check-1`
      );

      expect(response.status).toBe(200);
      expect(rateLimiter.check).toHaveBeenCalledTimes(1);
      expect(vi.mocked(rateLimiter.check).mock.calls[0]?.[1]).toBe("market_read");
    });
  });
});
