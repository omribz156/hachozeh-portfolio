import { describe, expect, it, vi } from "vitest";

import type { Queryable } from "../../src/db/client/pool";
import { readAdminUser } from "../../src/auth/admin-user-read-service";

function createQueryable(rows?: Array<{
  user_id: string;
  user_status: "active" | "locked" | "archived";
  user_role: "user" | "admin";
  trade_access_status: "enabled" | "blocked";
  lock_reason_code: string | null;
  locked_at: Date | null;
  created_at: Date;
  updated_at: Date;
  last_login_at: Date | null;
  identity_type: "email" | null;
  identifier_display: string | null;
  verified_at: Date | null;
  active_session_count: number;
  last_seen_at: Date | null;
}>): Queryable {
  return {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("from users u")) {
        expect(values).toEqual(["user_1"]);

        return {
          rows: rows ?? []
        };
      }

      if (sql.includes("from ledger_transactions g")) {
        expect(values).toEqual(["starter_bonus:user_1"]);

        return {
          rows: [
            {
              grant_transaction_id: "ledger_tx_grant_1",
              grant_amount: "1000.000000",
              grant_created_at: new Date("2026-04-01T10:00:00.000Z"),
              reversal_transaction_id: "ledger_tx_reversal_1",
              reversal_amount: "1000.000000",
              reversal_created_at: new Date("2026-04-05T13:00:00.000Z"),
              reversal_reason: "grant_review"
            }
          ]
        };
      }

      if (sql.includes("from accounts")) {
        expect(values).toEqual(["user_1"]);

        return {
          rows: [
            {
              balance_cached: "9750.000000"
            }
          ]
        };
      }

      if (sql.includes("count(*)::int as open_position_count")) {
        expect(values).toEqual(["user_1"]);

        return {
          rows: [
            {
              open_position_count: 2,
              unresolved_position_count: 1,
              portfolio_value: "108.889585",
              unresolved_position_value: "63.801370"
            }
          ]
        };
      }

      if (sql.includes("risk.signal.recorded")) {
        expect(values).toEqual([5, "user_1"]);

        return {
          rows: [
            {
              id: "audit_risk_1",
              entity_type: "user",
              entity_id: "user_1",
              payload: {
                subject: "actor:user_1",
                kind: "trade_write_rejected",
                severity: "review",
                endpointFamily: "trade_write",
                method: "POST",
                path: "/api/markets/market_1/trades",
                reasonCode: "trade_access_blocked",
                recommendedResponse: "Review actor before blocking.",
                details: {
                  marketKey: "market_1"
                }
              },
              created_at: new Date("2026-04-05T13:15:00.000Z"),
              review_status: null,
              reviewed_at: null,
              reviewed_by: null,
              review_note: null
            }
          ]
        };
      }

      if (sql.includes("from audit_events")) {
        expect(values).toEqual(["user_1"]);

        return {
          rows: [
            {
              action: "admin.user.reverse_starter_grant",
              created_at: new Date("2026-04-05T13:00:00.000Z"),
              actor_id: "user_admin_1"
            },
            {
              action: "admin.user.trade_block",
              created_at: new Date("2026-04-05T12:30:00.000Z"),
              actor_id: "user_admin_1"
            }
          ]
        };
      }

      if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    })
  };
}

describe("admin user read service", () => {
  it("returns admin-facing user truth with masked identity and session summary", async () => {
    const payload = await readAdminUser(
      createQueryable([
        {
          user_id: "user_1",
          user_status: "locked",
          user_role: "user",
          trade_access_status: "blocked",
          lock_reason_code: "risk_review",
          locked_at: new Date("2026-04-05T10:00:00.000Z"),
          created_at: new Date("2026-04-01T10:00:00.000Z"),
          updated_at: new Date("2026-04-05T12:00:00.000Z"),
          last_login_at: new Date("2026-04-05T11:00:00.000Z"),
          identity_type: "email",
          identifier_display: "reader@example.com",
          verified_at: new Date("2026-04-05T10:12:00.000Z"),
          active_session_count: 2,
          last_seen_at: new Date("2026-04-05T12:30:00.000Z")
        }
      ]),
      "user_1"
    );

    expect(payload).toEqual({
      user: {
        userId: "user_1",
        status: "locked",
        role: "user",
        tradeAccessStatus: "blocked",
        lockReasonCode: "risk_review",
        lockedAt: "2026-04-05T10:00:00.000Z",
        createdAt: "2026-04-01T10:00:00.000Z",
        updatedAt: "2026-04-05T12:00:00.000Z",
        lastLoginAt: "2026-04-05T11:00:00.000Z"
      },
      identity: {
        primary: {
          channel: "email",
          identifierHint: "re***@e***.com",
          verifiedAt: "2026-04-05T10:12:00.000Z"
        }
      },
      sessions: {
        activeCount: 2,
        lastSeenAt: "2026-04-05T12:30:00.000Z"
      },
      account: {
        availableCash: "9750.000000",
        portfolioValue: "108.889585",
        totalAccountValue: "9858.889585",
        openPositionsCount: 2,
        unresolvedPositionsCount: 1,
        unresolvedPositionValue: "63.801370"
      },
      archiveReadiness: {
        status: "open_exposure",
        openPositionsCount: 2,
        unresolvedPositionsCount: 1,
        unresolvedPositionValue: "63.801370"
      },
      starterGrant: {
        status: "reversed",
        grantTransactionId: "ledger_tx_grant_1",
        grantAmount: "1000.000000",
        grantedAt: "2026-04-01T10:00:00.000Z",
        reversalTransactionId: "ledger_tx_reversal_1",
        reversalAmount: "1000.000000",
        reversedAt: "2026-04-05T13:00:00.000Z",
        reversalReason: "grant_review"
      },
      recentAdminOps: [
        {
          action: "admin.user.reverse_starter_grant",
          createdAt: "2026-04-05T13:00:00.000Z",
          actorId: "user_admin_1"
        },
        {
          action: "admin.user.trade_block",
          createdAt: "2026-04-05T12:30:00.000Z",
          actorId: "user_admin_1"
        }
      ],
      recentRiskSignals: [
        {
          id: "audit_risk_1",
          subject: "actor:user_1",
          subjectType: "user",
          kind: "trade_write_rejected",
          severity: "review",
          endpointFamily: "trade_write",
          method: "POST",
          path: "/api/markets/market_1/trades",
          reasonCode: "trade_access_blocked",
          recommendedResponse: "Review actor before blocking.",
          createdAt: "2026-04-05T13:15:00.000Z",
          details: {
            marketKey: "market_1"
          },
          review: {
            status: null,
            reviewedAt: null,
            reviewedBy: null,
            note: null
          }
        }
      ]
    });
  });

  it("returns null for an unknown user", async () => {
    await expect(readAdminUser(createQueryable([]), "user_1")).resolves.toBeNull();
  });
});
