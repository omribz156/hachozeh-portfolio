import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import type { RequestActor } from "../../src/auth/actor-resolver";
import {
  reverseStarterGrant,
  StarterGrantReversalServiceError
} from "../../src/auth/starter-grant-reversal-service";

const ADMIN_ACTOR: RequestActor = {
  actorId: "user_admin_1",
  mode: "session",
  sessionId: "session_admin_1",
  role: "admin"
};

function createDbPool(options?: {
  existingReversalId?: string | null;
  userCashBalance?: string;
  platformTreasuryBalance?: string;
  grantAmount?: string;
  missingGrant?: boolean;
}) {
  const state = {
    userCashBalance: options?.userCashBalance ?? "150.000000",
    platformTreasuryBalance: options?.platformTreasuryBalance ?? "9000.000000",
    grantAmount: options?.grantAmount ?? "100.000000",
    existingReversalId: options?.existingReversalId ?? null,
    insertedTransactionCount: 0,
    insertedEntryCount: 0,
    auditWritten: false
  };

  const pool = {
    connect: vi.fn(async () => ({
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql === "begin" || sql === "commit" || sql === "rollback") {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes("from ledger_transactions") && sql.includes("reference_type = 'grant'")) {
          expect(values).toEqual(["starter_bonus:user_target_1"]);

          return {
            rows: options?.missingGrant
              ? []
              : [
                  {
                    id: "ledger_tx_grant_1",
                    reference_id: "starter_bonus:user_target_1",
                    compensates_transaction_id: null,
                    compensation_reason: null,
                    transaction_hash: "grant_hash_1"
                  }
                ],
            rowCount: options?.missingGrant ? 0 : 1
          };
        }

        if (sql.includes("from ledger_entries le")) {
          expect(values).toEqual(["ledger_tx_grant_1"]);

          return {
            rows: [
              {
                account_id: "account_user_cash_1",
                amount: state.grantAmount,
                entry_role: "credit_user_cash",
                account_type: "user_cash"
              },
              {
                account_id: "account_platform_treasury_1",
                amount: `-${state.grantAmount}`,
                entry_role: "debit_platform_treasury",
                account_type: "platform_treasury"
              }
            ],
            rowCount: 2
          };
        }

        if (sql.includes("where compensates_transaction_id = $1")) {
          expect(values).toEqual(["ledger_tx_grant_1"]);

          return {
            rows: state.existingReversalId ? [{ id: state.existingReversalId }] : [],
            rowCount: state.existingReversalId ? 1 : 0
          };
        }

        if (sql.includes("from accounts") && sql.includes("for update")) {
          expect(values).toEqual([["account_user_cash_1", "account_platform_treasury_1"]]);

          return {
            rows: [
              {
                id: "account_user_cash_1",
                type: "user_cash",
                balance_cached: state.userCashBalance
              },
              {
                id: "account_platform_treasury_1",
                type: "platform_treasury",
                balance_cached: state.platformTreasuryBalance
              }
            ],
            rowCount: 2
          };
        }

        if (sql.includes("pg_advisory_xact_lock")) {
          return {
            rows: [],
            rowCount: 1
          };
        }

        if (sql.includes("select sequence_number, transaction_hash")) {
          return {
            rows: [
              {
                sequence_number: "22",
                transaction_hash: "prev_hash_22"
              }
            ],
            rowCount: 1
          };
        }

        if (sql.includes("insert into ledger_transactions")) {
          state.insertedTransactionCount += 1;
          return {
            rows: [],
            rowCount: 1
          };
        }

        if (sql.includes("insert into ledger_entries")) {
          state.insertedEntryCount += 1;
          return {
            rows: [],
            rowCount: 1
          };
        }

        if (sql.includes("update accounts")) {
          const accountId = values?.[0];
          const balance = values?.[1];

          if (accountId === "account_user_cash_1" && typeof balance === "string") {
            state.userCashBalance = balance;
          }

          if (accountId === "account_platform_treasury_1" && typeof balance === "string") {
            state.platformTreasuryBalance = balance;
          }

          return {
            rows: [],
            rowCount: 1
          };
        }

        if (sql.includes("insert into audit_events")) {
          state.auditWritten = true;
          return {
            rows: [],
            rowCount: 1
          };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected query: ${sql}`);
      }),
      release: vi.fn()
    }))
  } as unknown as Pool;

  return { pool, state };
}

describe("starter grant reversal service", () => {
  it("writes a compensating ledger transaction for the starter grant", async () => {
    const { pool, state } = createDbPool();

    const response = await reverseStarterGrant(
      pool,
      "user_target_1",
      {
        reasonCode: "grant_review"
      },
      ADMIN_ACTOR
    );

    expect(response).toMatchObject({
      userId: "user_target_1",
      grantTransactionId: "ledger_tx_grant_1",
      reversedAmount: "100.000000",
      compensationReason: "grant_review",
      userCashBefore: "150.000000",
      userCashAfter: "50.000000",
      platformTreasuryBefore: "9000.000000",
      platformTreasuryAfter: "9100.000000",
      alreadyReversed: false,
      auditEventId: expect.any(String)
    });
    expect(state.insertedTransactionCount).toBe(1);
    expect(state.insertedEntryCount).toBe(2);
    expect(state.auditWritten).toBe(true);
  });

  it("returns the existing compensating transaction when the grant was already reversed", async () => {
    const { pool, state } = createDbPool({
      existingReversalId: "ledger_tx_reversal_existing"
    });

    const response = await reverseStarterGrant(
      pool,
      "user_target_1",
      {
        reasonCode: "grant_review"
      },
      ADMIN_ACTOR
    );

    expect(response).toMatchObject({
      userId: "user_target_1",
      grantTransactionId: "ledger_tx_grant_1",
      reversalTransactionId: "ledger_tx_reversal_existing",
      reversedAmount: "100.000000",
      compensationReason: "grant_review",
      alreadyReversed: true,
      auditEventId: null
    });
    expect(state.insertedTransactionCount).toBe(0);
    expect(state.insertedEntryCount).toBe(0);
    expect(state.auditWritten).toBe(false);
  });

  it("rejects reversals when user cash is already below the starter grant", async () => {
    const { pool, state } = createDbPool({
      userCashBalance: "80.000000"
    });

    await expect(
      reverseStarterGrant(
        pool,
        "user_target_1",
        {
          reasonCode: "grant_review"
        },
        ADMIN_ACTOR
      )
    ).rejects.toMatchObject<Partial<StarterGrantReversalServiceError>>({
      statusCode: 409,
      code: "insufficient_cash_for_reversal"
    });

    expect(state.insertedTransactionCount).toBe(0);
    expect(state.auditWritten).toBe(false);
  });

  it("rejects unsafe reversal reason codes before ledger writes", async () => {
    const { pool, state } = createDbPool();

    await expect(
      reverseStarterGrant(
        pool,
        "user_target_1",
        {
          reasonCode: "grant_review\u0000operator_note"
        },
        ADMIN_ACTOR
      )
    ).rejects.toMatchObject<Partial<StarterGrantReversalServiceError>>({
      statusCode: 400,
      code: "invalid_request"
    });
    await expect(
      reverseStarterGrant(
        pool,
        "user_target_1",
        {
          reasonCode: "x".repeat(121)
        },
        ADMIN_ACTOR
      )
    ).rejects.toMatchObject<Partial<StarterGrantReversalServiceError>>({
      statusCode: 400,
      code: "invalid_request"
    });
    expect(state.insertedTransactionCount).toBe(0);
    expect(state.auditWritten).toBe(false);
  });
});
