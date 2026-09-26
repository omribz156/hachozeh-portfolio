import { describe, expect, it, vi } from "vitest";

import type { Queryable } from "../../src/db/client/pool";
import {
  classifyRateLimitSignal,
  readIntegritySignals,
  readIntegritySignalSummary,
  recordEconomyGrantRejectionSignal,
  recordIntegritySignal,
  recordTradeWriteRejectionSignal,
  reviewIntegritySignal
} from "../../src/risk/market-integrity-service";

describe("market integrity service", () => {
  it("records integrity signals as audit events without storing raw IPs", async () => {
    const query = vi.fn(async (_sql: string, values?: unknown[]) => {
      expect(values?.[1]).toBe("system:risk-monitor");
      expect(values?.[2]).toBe("risk.signal.recorded");
      expect(values?.[3]).toBe("risk_subject");
      expect(String(values?.[4])).toMatch(/^ip:/);

      const payload = JSON.parse(String(values?.[5]));
      expect(JSON.stringify(payload)).not.toContain("203.0.113.44");
      expect(payload).toMatchObject({
        kind: "rate_limit_exceeded",
        severity: "observe",
        endpointFamily: "market_read",
        reasonCode: "rate_limited"
      });
      expect(payload.ipHash).toMatch(/^[a-f0-9]{24}$/);

      return { rows: [] };
    });

    await recordIntegritySignal(
      { query } as unknown as Queryable,
      {
        kind: "rate_limit_exceeded",
        severity: "observe",
        endpointFamily: "market_read",
        method: "GET",
        path: "/api/discovery/feed",
        ip: "203.0.113.44",
        reasonCode: "rate_limited"
      }
    );

    expect(query).toHaveBeenCalledTimes(1);
  });

  it("classifies sensitive write-limit crossings for review", () => {
    expect(classifyRateLimitSignal({ family: "trade_write" })).toMatchObject({
      kind: "rate_limit_exceeded",
      severity: "review"
    });
    expect(classifyRateLimitSignal({ family: "auth_otp_send" })).toMatchObject({
      kind: "otp_send_cap_exceeded",
      severity: "review"
    });
    expect(classifyRateLimitSignal({ family: "auth_verify" })).toMatchObject({
      kind: "rate_limit_exceeded",
      severity: "review"
    });
    expect(classifyRateLimitSignal({ family: "market_read" })).toMatchObject({
      kind: "rate_limit_exceeded",
      severity: "observe"
    });
    expect(classifyRateLimitSignal({ family: "session_read" })).toMatchObject({
      kind: "rate_limit_exceeded",
      severity: "observe"
    });
    expect(classifyRateLimitSignal({ family: "general_request" })).toMatchObject({
      kind: "rate_limit_exceeded",
      severity: "observe"
    });
  });

  it("ignores non-integrity trade errors and records selected trade rejection signals", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const request = {
      method: "POST",
      url: "/api/markets/market_1/trades",
      socket: {
        remoteAddress: "198.51.100.7"
      },
      headers: {
        "user-agent": "test-agent"
      }
    };

    await expect(
      recordTradeWriteRejectionSignal(
        { query } as unknown as Queryable,
        request as never,
        {
          actorId: "user_1",
          sessionId: "session_1",
          marketKey: "market_1",
          operation: "trade",
          reasonCode: "insufficient_cash",
          statusCode: 409
        }
      )
    ).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();

    await recordTradeWriteRejectionSignal(
      { query } as unknown as Queryable,
      request as never,
      {
        actorId: "user_1",
        sessionId: "session_1",
        marketKey: "market_1",
        operation: "trade",
        reasonCode: "market_state_version_mismatch",
        statusCode: 409
      }
    );

    expect(query).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(query.mock.calls[0]?.[1]?.[5]));
    expect(payload).toMatchObject({
      subject: "actor:user_1",
      kind: "trade_write_rejected",
      severity: "observe",
      endpointFamily: "trade_write",
      reasonCode: "market_state_version_mismatch",
      details: {
        marketKey: "market_1",
        operation: "trade",
        statusCode: 409
      }
    });
  });

  it("reads the operator-facing integrity signal inbox", async () => {
    const payload = {
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
    };
    const query = vi.fn(async (_sql: string, values?: unknown[]) => {
      expect(values).toEqual([10, "user_1"]);
      return {
        rows: [
          {
            id: "audit_1",
            entity_type: "user",
            entity_id: "user_1",
            payload,
            created_at: new Date("2026-06-17T10:00:00.000Z")
          }
        ]
      };
    });

    const response = await readIntegritySignals(
      { query } as unknown as Queryable,
      { limit: 10, subject: "user_1" }
    );

    expect(response.signals).toEqual([
      {
        id: "audit_1",
        subject: "actor:user_1",
        subjectType: "user",
        kind: "trade_write_rejected",
        severity: "review",
        endpointFamily: "trade_write",
        method: "POST",
        path: "/api/markets/market_1/trades",
        reasonCode: "trade_access_blocked",
        recommendedResponse: "Review actor before blocking.",
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
    expect(response.policy.trade_write.posture).toBe("review_needed");
  });

  it("summarizes risk signals for an operator window", async () => {
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      expect(values).toEqual([24]);

      if (sql.includes("open_review_count")) {
        return { rows: [{ open_review_count: 3 }] };
      }

      if (sql.includes("payload->>'severity'")) {
        return { rows: [{ key: "review", count: 3 }, { key: "observe", count: 2 }] };
      }

      if (sql.includes("payload->>'endpointFamily'")) {
        return { rows: [{ key: "trade_write", count: 4 }, { key: "auth_otp_send", count: 1 }] };
      }

      if (sql.includes("payload->>'reasonCode'")) {
        return { rows: [{ key: "rate_limited", count: 2 }] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    const summary = await readIntegritySignalSummary(
      { query } as unknown as Queryable,
      { windowHours: 24 }
    );

    expect(summary).toMatchObject({
      windowHours: 24,
      total: 5,
      openReviewCount: 3,
      bySeverity: {
        review: 3,
        observe: 2
      },
      byFamily: {
        trade_write: 4,
        auth_otp_send: 1
      },
      byReason: {
        rate_limited: 2
      }
    });
  });

  it("records manual review actions against a risk signal", async () => {
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("select id") && sql.includes("risk.signal.recorded")) {
        expect(values).toEqual(["audit_signal_1"]);
        return { rows: [{ id: "audit_signal_1" }] };
      }

      if (sql.includes("insert into audit_events")) {
        expect(values?.[1]).toBe("user_admin_1");
        expect(values?.[2]).toBe("risk.signal.reviewed");
        expect(values?.[3]).toBe("risk_signal");
        expect(values?.[4]).toBe("audit_signal_1");
        expect(JSON.parse(String(values?.[5]))).toEqual({
          status: "escalated",
          note: "Repeated suspicious trade rejects."
        });
        return { rows: [] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    const response = await reviewIntegritySignal(
      { query } as unknown as Queryable,
      {
        signalId: "audit_signal_1",
        actorId: "user_admin_1",
        body: {
          status: "escalated",
          note: "Repeated suspicious trade rejects."
        }
      }
    );

    expect(response).toMatchObject({
      signalId: "audit_signal_1",
      status: "escalated",
      note: "Repeated suspicious trade rejects.",
      reviewedBy: "user_admin_1"
    });
  });

  it("records a trade hammering pattern after repeated rejected writes", async () => {
    const payloads: Array<Record<string, unknown>> = [];
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("insert into audit_events")) {
        payloads.push(JSON.parse(String(values?.[5])));
        return { rows: [] };
      }

      if (sql.includes("recent_count")) {
        expect(values).toEqual(["user_1"]);
        return { rows: [{ recent_count: 5, existing_pattern_count: 0 }] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    });
    const request = {
      method: "POST",
      url: "/api/markets/market_1/trades",
      socket: {
        remoteAddress: "198.51.100.7"
      },
      headers: {}
    };

    await recordTradeWriteRejectionSignal(
      { query } as unknown as Queryable,
      request as never,
      {
        actorId: "user_1",
        sessionId: "session_1",
        marketKey: "market_1",
        operation: "trade",
        reasonCode: "trade_access_blocked",
        statusCode: 403
      }
    );

    expect(payloads.map((payload) => payload.kind)).toEqual([
      "trade_write_rejected",
      "trade_hammering_pattern"
    ]);
    expect(payloads[1]).toMatchObject({
      severity: "review",
      endpointFamily: "trade_write",
      reasonCode: "repeated_trade_rejections",
      details: {
        recentCount: 5,
        windowMinutes: 10
      }
    });
  });

  it("records emergency faucet abuse signals but ignores ordinary non-risk grant failures", async () => {
    const query = vi.fn(async (_sql: string, values?: unknown[]) => {
      expect(JSON.parse(String(values?.[5]))).toMatchObject({
        kind: "economy_grant_rejected",
        endpointFamily: "economy_grant",
        reasonCode: "emergency_faucet_not_eligible"
      });
      return { rows: [] };
    });

    await expect(
      recordEconomyGrantRejectionSignal(
        { query } as unknown as Queryable,
        {
          actorId: "user_1",
          faucetType: "emergency_bankruptcy",
          reasonCode: "emergency_faucet_not_eligible",
          statusCode: 409,
          path: "/api/wallet/faucets/emergency/claim"
        }
      )
    ).resolves.not.toBeNull();
    query.mockClear();

    await expect(
      recordEconomyGrantRejectionSignal(
        { query } as unknown as Queryable,
        {
          actorId: "user_1",
          faucetType: "daily_login",
          reasonCode: "source_insufficient_funds",
          statusCode: 409,
          path: "/api/wallet/faucets/daily-login/claim"
        }
      )
    ).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});
