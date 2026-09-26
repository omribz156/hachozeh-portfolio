import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import {
  revokeCurrentUserSessionById,
  revokeOtherCurrentUserSessions
} from "../../src/auth/current-user-session-revoke-service";

function createPool(overrides?: {
  currentSessionRows?: Array<{ id: string }>;
  revokedSessionCount?: number;
}) {
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql === "begin" || sql === "commit" || sql === "rollback") {
      return { rows: [] };
    }

    if (sql.includes("from sessions")) {
      expect(values).toEqual(["session_current", "user_1"]);

      return {
        rows: overrides?.currentSessionRows ?? [{ id: "session_current" }]
      };
    }

    if (sql.includes("revoked_reason = 'self_revoke_other_sessions'")) {
      expect(values).toEqual(["user_1", "session_current"]);

      return {
        rows: [],
        rowCount: overrides?.revokedSessionCount ?? 2
      };
    }

    if (sql.includes("revoked_reason = 'self_revoke_single_session'")) {
      expect(values).toEqual(["session_other", "user_1"]);

      return {
        rows: [],
        rowCount: overrides?.revokedSessionCount ?? 1
      };
    }

    if (sql.includes("insert into audit_events")) {
      expect(values?.[1]).toBe("user_1");
      expect(["user.session.revoke_other_sessions", "user.session.revoke_session"]).toContain(
        values?.[2]
      );
      expect(values?.[4]).toBe("user_1");
      return {
        rows: []
      };
    }

    if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });

  return {
    connect: vi.fn(async () => ({
      query,
      release: vi.fn()
    }))
  } as unknown as Pool;
}

describe("current user session revoke service", () => {
  it("revokes every other active session while keeping the current session alive", async () => {
    const payload = await revokeOtherCurrentUserSessions(
      createPool({
        revokedSessionCount: 2
      }),
      "user_1",
      "session_current",
      {}
    );

    expect(payload.userId).toBe("user_1");
    expect(payload.revokedSessionCount).toBe(2);
    expect(payload.revokedAt).toEqual(expect.any(String));
    expect(payload.auditEventId).toEqual(expect.stringMatching(/^audit_/));
  });

  it("revokes one owned non-current session", async () => {
    const payload = await revokeCurrentUserSessionById(
      createPool({
        revokedSessionCount: 1
      }),
      "user_1",
      "session_current",
      "session_other",
      {}
    );

    expect(payload.userId).toBe("user_1");
    expect(payload.sessionId).toBe("session_other");
    expect(payload.revokedAt).toEqual(expect.any(String));
    expect(payload.auditEventId).toEqual(expect.stringMatching(/^audit_/));
  });

  it("refuses to revoke the current session through the row endpoint", async () => {
    await expect(
      revokeCurrentUserSessionById(
        createPool(),
        "user_1",
        "session_current",
        "session_current",
        {}
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "invalid_session"
    });
  });

  it("fails closed when the current session is unavailable", async () => {
    await expect(
      revokeOtherCurrentUserSessions(
        createPool({
          currentSessionRows: []
        }),
        "user_1",
        "session_current",
        {}
      )
    ).rejects.toMatchObject({
      statusCode: 401,
      code: "unauthorized"
    });
  });
});
