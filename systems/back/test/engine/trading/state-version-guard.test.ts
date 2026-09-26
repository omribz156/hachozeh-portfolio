/**
 * state-version-guard.test.ts
 *
 * Tests the behaviour of executeTrade with respect to expectedMarketStateVersion.
 *
 * FINDING: as of this writing, expectedMarketStateVersion is parsed from the
 * request body (trade-request.ts) and included in the idempotency hash
 * (trade-hash.ts), but it is NEVER compared against the live
 * market_state_version read from the database inside trade-service.ts.
 *
 * The tests below pin that observable behaviour precisely so any future
 * enforcement will cause a test failure that forces intentional updating.
 */

import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import type { AppEnv } from "../../../src/config/env";
import { executeTrade, TradeServiceError } from "../../../src/engine/trading/trade-service";

// ---------------------------------------------------------------------------
// Constants shared with the wider trade-service test suite
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Minimal mock-pool factory
// Returns a pool whose client responds correctly to all SQL the trade service
// will issue for a standard binary-market buy, using the provided
// market_state_version value in the market row.
// ---------------------------------------------------------------------------

function createVersionedPool(opts: {
  /** The market_state_version stored in the DB row */
  dbStateVersion: string;
}) {
  const { dbStateVersion } = opts;

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
        const row = {
          market_id: "binary-market",
          market_status: "open",
          market_close_at: "2999-01-01T00:00:00.000Z",
          market_treasury_account_id: "market_treasury_1",
          market_state_version: dbStateVersion,
          liquidity_b: "1000.00000000",
          outcome_id: "yes-outcome",
          q_shares: "0.000000",
          sort_order: 0
        };
        const row2 = { ...row, outcome_id: "no-outcome", sort_order: 1 };
        return { rows: [row, row2], rowCount: 2 };
      }

      if (sql.includes("where type = 'user_cash'")) {
        return {
          rows: [{ id: "account_seed_user_1_cash", status: "active", balance_cached: "1000.000000" }],
          rowCount: 1
        };
      }

      if (sql.includes("where id = $1") && sql.includes("from accounts")) {
        return {
          rows: [{ id: "market_treasury_1", status: "active", balance_cached: "1000.000000" }],
          rowCount: 1
        };
      }

      if (sql.includes("select") && sql.includes("from contract_positions")) {
        return { rows: [], rowCount: 0 };
      }

      if (sql.includes("select") && sql.includes("from positions")) {
        return { rows: [], rowCount: 0 };
      }

      if (sql.includes("insert into positions") ||
          sql.includes("insert into contract_positions") ||
          sql.includes("delete from positions") ||
          sql.includes("delete from contract_positions") ||
          sql.includes("update accounts") ||
          sql.includes("update market_outcome_state") ||
          sql.includes("update market_pricing_state") ||
          sql.includes("insert into realization_events") ||
          sql.includes("insert into audit_events") ||
          sql.includes("insert into ledger_entries") ||
          sql.includes("update idempotency_records") ||
          sql.includes("insert into ledger_transactions") ||
          sql.includes("insert into trades") ||
          sql.includes("insert into trade_execution_legs")) {
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("order by sequence_number desc")) {
        return { rows: [], rowCount: 0 };
      }

      if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }),
    release: vi.fn()
  };

  const pool = {
    connect: vi.fn(async () => client)
  } as unknown as Pool;

  return { pool, client };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("executeTrade — expectedMarketStateVersion", () => {
  it("succeeds when expectedMarketStateVersion matches the DB version", async () => {
    const { pool } = createVersionedPool({ dbStateVersion: "12" });

    const response = await executeTrade(pool, BASE_ENV, "binary-market", {
      side: "buy",
      outcomeKey: "yes-outcome",
      contractSide: "yes",
      cashAmount: "25.000000",
      idempotencyKey: "version-match-test",
      quoteId: null,
      quotedAt: null,
      quoteExpiresAt: null,
      expectedMarketStateVersion: 12
    });

    // Trade completed; the response must include the version before and after.
    expect(response.marketStateVersionBefore).toBe(12);
    expect(response.marketStateVersionAfter).toBe(13);
  });

  it("rejects when expectedMarketStateVersion differs from the DB version", () => {
    const { pool } = createVersionedPool({ dbStateVersion: "12" });

    return expect(
      executeTrade(pool, BASE_ENV, "binary-market", {
        side: "buy",
        outcomeKey: "yes-outcome",
        contractSide: "yes",
        cashAmount: "25.000000",
        idempotencyKey: "version-mismatch-test",
        quoteId: null,
        quotedAt: null,
        quoteExpiresAt: null,
        expectedMarketStateVersion: 99
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "market_state_moved",
      details: {
        currentMarketStateVersion: 12,
        expectedMarketStateVersion: 99
      }
    });
  });

  it("succeeds when expectedMarketStateVersion is null (version guard opt-out)", async () => {
    const { pool } = createVersionedPool({ dbStateVersion: "12" });

    const response = await executeTrade(pool, BASE_ENV, "binary-market", {
      side: "buy",
      outcomeKey: "yes-outcome",
      contractSide: "yes",
      cashAmount: "25.000000",
      idempotencyKey: "version-null-test",
      quoteId: null,
      quotedAt: null,
      quoteExpiresAt: null,
      expectedMarketStateVersion: null
    });

    expect(response.marketStateVersionBefore).toBe(12);
  });

  it("rejects expectedMarketStateVersion=0 when DB version is 12", () => {
    const { pool } = createVersionedPool({ dbStateVersion: "12" });

    return expect(
      executeTrade(pool, BASE_ENV, "binary-market", {
        side: "buy",
        outcomeKey: "yes-outcome",
        contractSide: "yes",
        cashAmount: "25.000000",
        idempotencyKey: "version-zero-test",
        quoteId: null,
        quotedAt: null,
        quoteExpiresAt: null,
        expectedMarketStateVersion: 0
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "market_state_moved"
    });
  });

  it("matching expectedMarketStateVersion requests still reach idempotency independently", async () => {
    /**
     * Matching version requests still complete independently with distinct
     * idempotency keys. Mismatched versions are now rejected before mutation.
     */
    let idempotencyInsertCount = 0;

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
            rows: [{
              user_id: "seed_user_1",
              user_status: "active",
              user_role: "user",
              trade_access_status: "enabled"
            }],
            rowCount: 1
          };
        }
        if (sql.includes("insert into idempotency_records")) {
          idempotencyInsertCount++;
          return { rows: [{ id: `idempotency_${idempotencyInsertCount}` }], rowCount: 1 };
        }
        if (sql.includes("select id, request_hash, status, response_snapshot")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes("from markets m")) {
          const base = {
            market_id: "binary-market",
            market_status: "open",
            market_close_at: "2999-01-01T00:00:00.000Z",
            market_treasury_account_id: "market_treasury_1",
            market_state_version: "5",
            liquidity_b: "1000.00000000",
            q_shares: "0.000000",
            sort_order: 0
          };
          return {
            rows: [
              { ...base, outcome_id: "yes-outcome" },
              { ...base, outcome_id: "no-outcome", sort_order: 1 }
            ],
            rowCount: 2
          };
        }
        if (sql.includes("where type = 'user_cash'")) {
          return {
            rows: [{ id: "account_user_cash", status: "active", balance_cached: "1000.000000" }],
            rowCount: 1
          };
        }
        if (sql.includes("where id = $1") && sql.includes("from accounts")) {
          return {
            rows: [{ id: "market_treasury_1", status: "active", balance_cached: "1000.000000" }],
            rowCount: 1
          };
        }
        if (sql.includes("select") && sql.includes("from contract_positions")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes("select") && sql.includes("from positions")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes("order by sequence_number desc")) {
          return { rows: [], rowCount: 0 };
        }
        // All writes
        return { rows: [], rowCount: 1 };
      }),
      release: vi.fn()
    };

    const pool = { connect: vi.fn(async () => client) } as unknown as Pool;

    await executeTrade(pool, BASE_ENV, "binary-market", {
      side: "buy",
      outcomeKey: "yes-outcome",
      contractSide: "yes",
      cashAmount: "25.000000",
      idempotencyKey: "hash-version-test-a",
      quoteId: null,
      quotedAt: null,
      quoteExpiresAt: null,
      expectedMarketStateVersion: 5
    });

    await executeTrade(pool, BASE_ENV, "binary-market", {
      side: "buy",
      outcomeKey: "yes-outcome",
      contractSide: "yes",
      cashAmount: "25.000000",
      idempotencyKey: "hash-version-test-b",
      quoteId: null,
      quotedAt: null,
      quoteExpiresAt: null,
      expectedMarketStateVersion: 5
    });

    expect(idempotencyInsertCount).toBe(2);
  });
});
