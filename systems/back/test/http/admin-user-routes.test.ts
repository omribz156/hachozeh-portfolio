import { afterEach, describe, expect, it } from "vitest";

import {
  closeAppTestServers,
  startServer
} from "./app-test-harness";

afterEach(async () => {
  await closeAppTestServers();
});

async function activeAdminQueryImpl(sql: string) {
  if (sql.includes("from sessions s")) {
    return {
      rows: [
        {
          session_id: "session_admin_1",
          user_id: "user_admin_1",
          session_status: "active",
          created_at: new Date(Date.now() - 3_600_000),
          expires_at: new Date(Date.now() + 60_000),
          user_status: "active",
          user_role: "admin"
        }
      ]
    };
  }

  if (sql.includes("update sessions")) {
    return {
      rows: [],
      rowCount: 0
    };
  }

  throw new Error(`Unexpected db query in app test: ${sql}`);
}

describe("admin user routes", () => {
  it("returns unauthorized for admin user read without a real session", async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/admin/users/user_target_1`);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({
      error: {
        code: "unauthorized",
        message: "Authentication is required."
      }
    });
  });

  it("clears stale admin user sessions through the Fastify route", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string) => {
        if (sql.includes("from sessions s")) {
          return {
            rows: []
          };
        }

        throw new Error(`Unexpected db query in app test: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/admin/users/user_target_1`, {
      headers: {
        cookie: "navi_session=stale"
      }
    });
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toContain("navi_session=");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(payload).toEqual({
      error: {
        code: "unauthorized",
        message: "Session is invalid or expired."
      }
    });
  });

  it("returns admin user truth for an authenticated admin session", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql.includes("active_session_count")) {
          expect(values).toEqual(["user_target_1"]);

          return {
            rows: [
              {
                user_id: "user_target_1",
                user_status: "locked",
                user_role: "user",
                trade_access_status: "blocked",
                lock_reason_code: "risk_review",
                locked_at: new Date("2026-04-05T12:30:00.000Z"),
                created_at: new Date("2026-04-01T12:00:00.000Z"),
                updated_at: new Date("2026-04-05T12:40:00.000Z"),
                last_login_at: new Date("2026-04-05T11:00:00.000Z"),
                identity_type: "email",
                identifier_display: "reader@example.com",
                verified_at: new Date("2026-04-05T10:12:00.000Z"),
                active_session_count: 2,
                last_seen_at: new Date("2026-04-05T12:35:00.000Z")
              }
            ]
          };
        }

        if (sql.includes("from accounts")) {
          expect(values).toEqual(["user_target_1"]);

          return {
            rows: [
              {
                balance_cached: "9750.000000"
              }
            ]
          };
        }

        if (sql.includes("count(*)::int as open_position_count")) {
          expect(values).toEqual(["user_target_1"]);

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

        if (sql.includes("from ledger_transactions g")) {
          expect(values).toEqual(["starter_bonus:user_target_1"]);

          return {
            rows: [
              {
                grant_transaction_id: "ledger_tx_grant_1",
                grant_amount: "1000.000000",
                grant_created_at: new Date("2026-04-01T12:15:00.000Z"),
                reversal_transaction_id: "ledger_tx_reversal_1",
                reversal_amount: "1000.000000",
                reversal_created_at: new Date("2026-04-05T12:50:00.000Z"),
                reversal_reason: "grant_review"
              }
            ]
          };
        }

        if (sql.includes("risk.signal.recorded")) {
          expect(values).toEqual([5, "user_target_1"]);

          return {
            rows: [
              {
                id: "audit_risk_1",
                entity_type: "user",
                entity_id: "user_target_1",
                payload: {
                  subject: "actor:user_target_1",
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
                created_at: new Date("2026-04-05T12:55:00.000Z"),
                review_status: null,
                reviewed_at: null,
                reviewed_by: null,
                review_note: null
              }
            ]
          };
        }

        if (sql.includes("from audit_events")) {
          expect(values).toEqual(["user_target_1"]);

          return {
            rows: [
              {
                action: "admin.user.reverse_starter_grant",
                created_at: new Date("2026-04-05T12:50:00.000Z"),
                actor_id: "user_admin_1"
              },
              {
                action: "admin.user.trade_block",
                created_at: new Date("2026-04-05T12:45:00.000Z"),
                actor_id: "user_admin_1"
              }
            ]
          };
        }

        if (sql.includes("from sessions s")) {
          expect(values).toEqual([expect.any(String)]);

          return {
            rows: [
              {
                session_id: "session_admin_1",
                user_id: "user_admin_1",
                session_status: "active",
                created_at: new Date(Date.now() - 3_600_000),
                expires_at: new Date(Date.now() + 60_000),
                user_status: "active",
                user_role: "admin"
              }
            ]
          };
        }

        if (sql.includes("update sessions")) {
          return {
            rows: []
          };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected db query in app test: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/admin/users/user_target_1`, {
      headers: {
        cookie: "navi_session=admin-live"
      }
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      user: {
        userId: "user_target_1",
        status: "locked",
        role: "user",
        tradeAccessStatus: "blocked",
        lockReasonCode: "risk_review",
        lockedAt: "2026-04-05T12:30:00.000Z",
        createdAt: "2026-04-01T12:00:00.000Z",
        updatedAt: "2026-04-05T12:40:00.000Z",
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
        lastSeenAt: "2026-04-05T12:35:00.000Z"
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
        grantedAt: "2026-04-01T12:15:00.000Z",
        reversalTransactionId: "ledger_tx_reversal_1",
        reversalAmount: "1000.000000",
        reversedAt: "2026-04-05T12:50:00.000Z",
        reversalReason: "grant_review"
      },
      recentAdminOps: [
        {
          action: "admin.user.reverse_starter_grant",
          createdAt: "2026-04-05T12:50:00.000Z",
          actorId: "user_admin_1"
        },
        {
          action: "admin.user.trade_block",
          createdAt: "2026-04-05T12:45:00.000Z",
          actorId: "user_admin_1"
        }
      ],
      recentRiskSignals: [
        {
          id: "audit_risk_1",
          subject: "actor:user_target_1",
          subjectType: "user",
          kind: "trade_write_rejected",
          severity: "review",
          endpointFamily: "trade_write",
          method: "POST",
          path: "/api/markets/market_1/trades",
          reasonCode: "trade_access_blocked",
          recommendedResponse: "Review actor before blocking.",
          createdAt: "2026-04-05T12:55:00.000Z",
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

  it.each([
    "/admin/users/user_target_1/lock",
    "/admin/users/user_target_1/unlock",
    "/admin/users/user_target_1/archive",
    "/admin/users/user_target_1/trade-block",
    "/admin/users/user_target_1/trade-restore",
    "/admin/users/user_target_1/sessions/revoke",
    "/admin/users/user_target_1/reverse-starter-grant",
    "/admin/users/user_target_1/profile/moderation"
  ])("returns the existing JSON body error envelope for %s", async (path) => {
    const { baseUrl } = await startServer({
      queryImpl: activeAdminQueryImpl
    });

    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        cookie: "navi_session=admin-live",
        "content-type": "application/json"
      },
      body: ""
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      error: {
        code: "invalid_request",
        message: "JSON body is required"
      }
    });
  });

  it("locks a user account through the admin user-ops route", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql.includes("from sessions s")) {
          return {
            rows: [
              {
                session_id: "session_admin_1",
                user_id: "user_admin_1",
                session_status: "active",
                created_at: new Date(Date.now() - 3_600_000),
                expires_at: new Date(Date.now() + 60_000),
                user_status: "active",
                user_role: "admin"
              }
            ]
          };
        }

        if (sql.includes("from ledger_transactions g")) {
          expect(values).toEqual(["starter_bonus:user_target_1"]);

          return {
            rows: [
              {
                grant_transaction_id: "ledger_tx_grant_1",
                grant_amount: "1000.000000",
                grant_created_at: new Date("2026-04-01T12:15:00.000Z"),
                reversal_transaction_id: "ledger_tx_reversal_1",
                reversal_amount: "1000.000000",
                reversal_created_at: new Date("2026-04-05T12:50:00.000Z"),
                reversal_reason: "grant_review"
              }
            ]
          };
        }

        if (sql.includes("from audit_events")) {
          expect(values).toEqual(["user_target_1"]);

          return {
            rows: [
              {
                action: "admin.user.reverse_starter_grant",
                created_at: new Date("2026-04-05T12:50:00.000Z"),
                actor_id: "user_admin_1"
              },
              {
                action: "admin.user.trade_block",
                created_at: new Date("2026-04-05T12:45:00.000Z"),
                actor_id: "user_admin_1"
              }
            ]
          };
        }

        if (sql.includes("update sessions")) {
          return {
            rows: [],
            rowCount: 0
          };
        }

        if (sql === "begin" || sql === "commit" || sql === "rollback") {
          return {
            rows: [],
            rowCount: 0
          };
        }

        if (sql.includes("from users") && sql.includes("for update")) {
          expect(values).toEqual(["user_target_1"]);

          return {
            rows: [
              {
                id: "user_target_1",
                status: "active",
                role: "user",
                trade_access_status: "enabled",
                lock_reason_code: null,
                locked_at: null,
                created_at: new Date("2026-04-01T12:00:00.000Z"),
                updated_at: new Date("2026-04-05T12:00:00.000Z"),
                last_login_at: new Date("2026-04-05T11:00:00.000Z")
              }
            ],
            rowCount: 1
          };
        }

        if (sql.includes("update users") && sql.includes("set status =")) {
          return {
            rows: [
              {
                id: "user_target_1",
                status: "locked",
                role: "user",
                trade_access_status: "enabled",
                lock_reason_code: "risk_review",
                locked_at: new Date("2026-04-05T13:00:00.000Z"),
                created_at: new Date("2026-04-01T12:00:00.000Z"),
                updated_at: new Date("2026-04-05T13:00:00.000Z"),
                last_login_at: new Date("2026-04-05T11:00:00.000Z")
              }
            ],
            rowCount: 1
          };
        }

        if (sql.includes("insert into audit_events")) {
          return {
            rows: [],
            rowCount: 1
          };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected db query in app test: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/admin/users/user_target_1/lock`, {
      method: "POST",
      headers: {
        cookie: "navi_session=admin-live",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        reasonCode: "risk_review"
      })
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      userId: "user_target_1",
      status: "locked",
      tradeAccessStatus: "enabled",
      lockReasonCode: "risk_review",
      auditEventId: expect.any(String)
    });
  });

  it("archives a user account through the admin user-ops route", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql.includes("from sessions s")) {
          return {
            rows: [
              {
                session_id: "session_admin_1",
                user_id: "user_admin_1",
                session_status: "active",
                created_at: new Date(Date.now() - 3_600_000),
                expires_at: new Date(Date.now() + 60_000),
                user_status: "active",
                user_role: "admin"
              }
            ]
          };
        }

        if (sql.includes("update sessions") && sql.includes("where id = $1")) {
          return {
            rows: [],
            rowCount: 0
          };
        }

        if (sql === "begin" || sql === "commit" || sql === "rollback") {
          return {
            rows: [],
            rowCount: 0
          };
        }

        if (sql.includes("from users") && sql.includes("for update")) {
          expect(values).toEqual(["user_target_1"]);

          return {
            rows: [
              {
                id: "user_target_1",
                status: "active",
                role: "user",
                trade_access_status: "enabled",
                lock_reason_code: null,
                locked_at: null,
                created_at: new Date("2026-04-01T12:00:00.000Z"),
                updated_at: new Date("2026-04-05T12:00:00.000Z"),
                last_login_at: new Date("2026-04-05T11:00:00.000Z")
              }
            ],
            rowCount: 1
          };
        }

        if (sql.includes("update users") && sql.includes("set status = 'archived'")) {
          expect(values).toEqual(["user_target_1", "support_archive"]);

          return {
            rows: [
              {
                id: "user_target_1",
                status: "archived",
                role: "user",
                trade_access_status: "blocked",
                lock_reason_code: "support_archive",
                locked_at: new Date("2026-04-05T13:00:00.000Z"),
                created_at: new Date("2026-04-01T12:00:00.000Z"),
                updated_at: new Date("2026-04-05T13:00:00.000Z"),
                last_login_at: new Date("2026-04-05T11:00:00.000Z")
              }
            ],
            rowCount: 1
          };
        }

        if (sql.includes("update sessions") && sql.includes("revoked_reason = 'admin_archive_user'")) {
          expect(values).toEqual(["user_target_1"]);

          return {
            rows: [],
            rowCount: 2
          };
        }

        if (sql.includes("insert into audit_events")) {
          return {
            rows: [],
            rowCount: 1
          };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected db query in app test: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/admin/users/user_target_1/archive`, {
      method: "POST",
      headers: {
        cookie: "navi_session=admin-live",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        reasonCode: "support_archive"
      })
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      userId: "user_target_1",
      status: "archived",
      tradeAccessStatus: "blocked",
      lockReasonCode: "support_archive",
      revokedSessionCount: 2,
      auditEventId: expect.any(String)
    });
  });

  it("reverses a starter grant through the admin correction route", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql.includes("from sessions s")) {
          return {
            rows: [
              {
                session_id: "session_admin_1",
                user_id: "user_admin_1",
                session_status: "active",
                created_at: new Date(Date.now() - 3_600_000),
                expires_at: new Date(Date.now() + 60_000),
                user_status: "active",
                user_role: "admin"
              }
            ]
          };
        }

        if (sql.includes("update sessions")) {
          return {
            rows: [],
            rowCount: 0
          };
        }

        if (sql === "begin" || sql === "commit" || sql === "rollback") {
          return {
            rows: [],
            rowCount: 0
          };
        }

        if (sql.includes("reference_type = 'grant'")) {
          expect(values).toEqual(["starter_bonus:user_target_1"]);

          return {
            rows: [
              {
                id: "ledger_tx_grant_1",
                reference_id: "starter_bonus:user_target_1",
                compensates_transaction_id: null,
                compensation_reason: null,
                transaction_hash: "grant_hash_1"
              }
            ],
            rowCount: 1
          };
        }

        if (sql.includes("from ledger_entries le")) {
          expect(values).toEqual(["ledger_tx_grant_1"]);

          return {
            rows: [
              {
                account_id: "account_user_cash_1",
                amount: "100.000000",
                entry_role: "credit_user_cash",
                account_type: "user_cash"
              },
              {
                account_id: "account_platform_treasury_1",
                amount: "-100.000000",
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
            rows: [],
            rowCount: 0
          };
        }

        if (sql.includes("from accounts") && sql.includes("for update")) {
          return {
            rows: [
              {
                id: "account_user_cash_1",
                type: "user_cash",
                balance_cached: "150.000000"
              },
              {
                id: "account_platform_treasury_1",
                type: "platform_treasury",
                balance_cached: "9000.000000"
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

        if (
          sql.includes("insert into ledger_transactions") ||
          sql.includes("insert into ledger_entries") ||
          sql.includes("update accounts") ||
          sql.includes("insert into audit_events")
        ) {
          return {
            rows: [],
            rowCount: 1
          };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected db query in app test: ${sql}`);
      }
    });

    const response = await fetch(
      `${baseUrl}/admin/users/user_target_1/reverse-starter-grant`,
      {
        method: "POST",
        headers: {
          cookie: "navi_session=admin-live",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          reasonCode: "grant_review"
        })
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      userId: "user_target_1",
      grantTransactionId: "ledger_tx_grant_1",
      reversedAmount: "100.000000",
      compensationReason: "grant_review",
      alreadyReversed: false,
      auditEventId: expect.any(String)
    });
  });

  it("resets public profile fields through the admin moderation route", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql.includes("from sessions s")) {
          return {
            rows: [
              {
                session_id: "session_admin_1",
                user_id: "user_admin_1",
                session_status: "active",
                created_at: new Date(Date.now() - 3_600_000),
                expires_at: new Date(Date.now() + 60_000),
                user_status: "active",
                user_role: "admin"
              }
            ]
          };
        }

        if (sql.includes("update sessions")) {
          return {
            rows: [],
            rowCount: 0
          };
        }

        if (sql === "begin" || sql === "commit" || sql === "rollback") {
          return {
            rows: [],
            rowCount: 0
          };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes("from users") && sql.includes("for update")) {
          expect(values).toEqual(["user_target_1"]);

          return {
            rows: [
              {
                id: "user_target_1",
                handle: "user_abcd1234",
                display_name: "bad stored name",
                bio: "bad stored bio",
                avatar_url: null,
                status: "active",
                updated_at: new Date("2026-07-05T10:00:00.000Z")
              }
            ],
            rowCount: 1
          };
        }

        if (sql.includes("update users") && sql.includes("display_name = case")) {
          expect(values).toEqual(["user_target_1", true, true, false]);

          return {
            rows: [
              {
                id: "user_target_1",
                handle: "user_abcd1234",
                display_name: null,
                bio: null,
                avatar_url: null,
                status: "active",
                updated_at: new Date("2026-07-05T10:05:00.000Z")
              }
            ],
            rowCount: 1
          };
        }

        if (sql.includes("insert into audit_events")) {
          expect(values?.[2]).toBe("admin.user.profile_moderate");
          expect(String(values?.[5] ?? "")).toContain("profile_content_review");
          expect(String(values?.[5] ?? "")).not.toContain("bad stored name");

          return {
            rows: [],
            rowCount: 1
          };
        }

        throw new Error(`Unexpected db query in app test: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/admin/users/user_target_1/profile/moderation`, {
      method: "POST",
      headers: {
        cookie: "navi_session=admin-live",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        reasonCode: "profile_content_review",
        resetDisplayName: true,
        clearBio: true
      })
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      userId: "user_target_1",
      handle: "user_abcd1234",
      status: "active",
      resetDisplayName: true,
      clearBio: true,
      clearAvatar: false,
      avatarFileDeleted: null,
      auditEventId: expect.any(String)
    });
  });

});
