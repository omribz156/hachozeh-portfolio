import { afterEach, describe, expect, it } from "vitest";

import { createInMemoryRateLimiter } from "../../src/http/rate-limit";
import { closeAppTestServers, startServer } from "./app-test-harness";

afterEach(async () => {
  await closeAppTestServers();
});

function readActiveAdminSessionQuery(sql: string) {
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

  return null;
}

describe("admin risk signal routes", () => {
  it("requires admin authentication", async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/admin/risk/signals`);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({
      error: {
        code: "unauthorized",
        message: "Authentication is required."
      }
    });
  });

  it("returns recent integrity signals to an admin", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        const sessionResult = readActiveAdminSessionQuery(sql);
        if (sessionResult) {
          return sessionResult;
        }

        if (sql.includes("from audit_events") && sql.includes("risk.signal.recorded")) {
          expect(values).toEqual([25]);
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
                  recommendedResponse: "Review before blocking.",
                  details: {
                    marketKey: "market_1"
                  }
                },
                created_at: new Date("2026-06-17T10:00:00.000Z")
              }
            ]
          };
        }

        throw new Error(`Unexpected db query: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/admin/risk/signals?limit=25`, {
      headers: {
        cookie: "navi_session=admin-live"
      }
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.signals).toEqual([
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
        recommendedResponse: "Review before blocking.",
        createdAt: "2026-06-17T10:00:00.000Z",
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
    ]);
    expect(payload.policy.trade_write.posture).toBe("review_needed");
  });

  it("returns a compact risk summary to an admin", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        const sessionResult = readActiveAdminSessionQuery(sql);
        if (sessionResult) {
          return sessionResult;
        }

        expect(values).toEqual([168]);

        if (sql.includes("open_review_count")) {
          return { rows: [{ open_review_count: 1 }] };
        }

        if (sql.includes("payload->>'severity'")) {
          return { rows: [{ key: "review", count: 2 }] };
        }

        if (sql.includes("payload->>'endpointFamily'")) {
          return { rows: [{ key: "trade_write", count: 2 }] };
        }

        if (sql.includes("payload->>'reasonCode'")) {
          return { rows: [{ key: "trade_access_blocked", count: 2 }] };
        }

        throw new Error(`Unexpected db query: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/admin/risk/signals/summary?windowHours=168`, {
      headers: {
        cookie: "navi_session=admin-live"
      }
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      windowHours: 168,
      total: 2,
      openReviewCount: 1,
      bySeverity: {
        review: 2
      },
      byFamily: {
        trade_write: 2
      },
      byReason: {
        trade_access_blocked: 2
      }
    });
  });

  it("records a manual review action for a risk signal", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        const sessionResult = readActiveAdminSessionQuery(sql);
        if (sessionResult) {
          return sessionResult;
        }

        if (sql.includes("select id") && sql.includes("risk.signal.recorded")) {
          expect(values).toEqual(["audit_signal_1"]);
          return { rows: [{ id: "audit_signal_1" }] };
        }

        if (sql.includes("insert into audit_events")) {
          expect(values?.[1]).toBe("user_admin_1");
          expect(values?.[2]).toBe("risk.signal.reviewed");
          expect(values?.[3]).toBe("risk_signal");
          expect(values?.[4]).toBe("audit_signal_1");
          return { rows: [], rowCount: 1 };
        }

        throw new Error(`Unexpected db query: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/admin/risk/signals/audit_signal_1/review`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "navi_session=admin-live"
      },
      body: JSON.stringify({
        status: "reviewed",
        note: "Checked account context."
      })
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      signalId: "audit_signal_1",
      status: "reviewed",
      note: "Checked account context.",
      reviewedBy: "user_admin_1"
    });
  });
});

describe("risk signal recording from live routes", () => {
  it("records OTP quota pressure when auth start is rate-limited", async () => {
    const capturedPayloads: Array<Record<string, unknown>> = [];
    const limiter = createInMemoryRateLimiter({
      auth_write: { limit: 500, windowMs: 60_000 },
      auth_otp_send: { limit: 1, windowMs: 3_600_000 }
    });
    const { baseUrl } = await startServer({
      rateLimiter: limiter,
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql.includes("insert into audit_events")) {
          capturedPayloads.push(JSON.parse(String(values?.[5])));
          return { rows: [], rowCount: 1 };
        }

        if (
          sql.includes("insert into otp_challenges") ||
          sql.includes("select") ||
          sql.includes("update") ||
          sql.startsWith("set local")
        ) {
          return {
            rows: [
              {
                challenge_id: "ch_1",
                expires_at: new Date(Date.now() + 600_000)
              }
            ],
            rowCount: 1
          };
        }

        throw new Error(`Unexpected db query: ${sql}`);
      }
    });

    async function startAuth(identifier: string) {
      return fetch(`${baseUrl}/api/auth/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier, purpose: "login" })
      });
    }

    const first = await startAuth("first@example.com");
    const second = await startAuth("second@example.com");

    expect(first.status).not.toBe(429);
    expect(second.status).toBe(429);
    expect(capturedPayloads).toHaveLength(1);
    expect(capturedPayloads[0]).toMatchObject({
      kind: "otp_send_cap_exceeded",
      severity: "review",
      endpointFamily: "auth_otp_send",
      reasonCode: "rate_limited"
    });
    expect(String(capturedPayloads[0].subject)).toMatch(/^ip:/);
  });

  it("records emergency faucet rejection as an account-linked risk signal", async () => {
    const capturedPayloads: Array<Record<string, unknown>> = [];
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql.includes("from sessions s")) {
          return {
            rows: [
              {
                session_id: "session_user_1",
                user_id: "user_1",
                session_status: "active",
                created_at: new Date(Date.now() - 3_600_000),
                expires_at: new Date(Date.now() + 60_000),
                user_status: "active",
                user_role: "user"
              }
            ]
          };
        }

        if (sql.includes("update sessions")) {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes("insert into audit_events")) {
          capturedPayloads.push(JSON.parse(String(values?.[5])));
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes("insert into user_faucet_state")) {
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes("from user_faucet_state")) {
          return {
            rows: [
              {
                user_id: "user_1",
                faucet_type: "emergency_bankruptcy",
                current_streak_day: 0,
                last_claimed_at: null,
                last_claimed_local_date: null
              }
            ]
          };
        }

        if (sql.includes("from accounts")) {
          return { rows: [{ account_id: "acct_user_1", balance_cached: "10.000000" }] };
        }

        if (sql.includes("select exists")) {
          return { rows: [{ has_active_position: false }] };
        }

        if (
          sql === "begin" ||
          sql === "commit" ||
          sql === "rollback" ||
          sql.startsWith("set local statement_timeout") ||
          sql.startsWith("set local lock_timeout")
        ) {
          return { rows: [], rowCount: 0 };
        }

        throw new Error(`Unexpected db query: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/api/wallet/faucets/emergency/claim`, {
      method: "POST",
      headers: {
        cookie: "navi_session=user-live"
      }
    });

    expect(response.status).toBe(409);
    expect(capturedPayloads).toHaveLength(1);
    expect(capturedPayloads[0]).toMatchObject({
      subject: "actor:user_1",
      kind: "economy_grant_rejected",
      endpointFamily: "economy_grant",
      reasonCode: "emergency_faucet_not_eligible"
    });
  });
});
