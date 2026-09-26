import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import type { RequestActor } from "../../src/auth/actor-resolver";
import {
  archiveUserAccount,
  blockUserTrading,
  lockUserAccount,
  revokeUserSessions,
  unlockUserAccount,
  UserOpsServiceError
} from "../../src/auth/user-ops-service";

const ADMIN_ACTOR: RequestActor = {
  actorId: "user_admin_1",
  mode: "session",
  sessionId: "session_admin_1",
  role: "admin"
};

function createDbPool(options?: {
  userStatus?: "active" | "locked" | "archived";
  tradeAccessStatus?: "enabled" | "blocked";
  lockReasonCode?: string | null;
  activeSessionCount?: number;
}) {
  const state = {
    user: {
      id: "user_target_1",
      status: options?.userStatus ?? "active",
      role: "user",
      trade_access_status: options?.tradeAccessStatus ?? "enabled",
      lock_reason_code: options?.lockReasonCode ?? null,
      locked_at: options?.userStatus === "locked" ? new Date("2026-04-05T12:00:00.000Z") : null,
      created_at: new Date("2026-04-01T12:00:00.000Z"),
      updated_at: new Date("2026-04-05T12:00:00.000Z"),
      last_login_at: new Date("2026-04-05T11:00:00.000Z")
    },
    auditWritten: false
  };

  const pool = {
    connect: vi.fn(async () => ({
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql === "begin" || sql === "commit" || sql === "rollback") {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes("from users") && sql.includes("for update")) {
          return {
            rows: [state.user],
            rowCount: 1
          };
        }

        if (sql.includes("update users") && sql.includes("set status =")) {
          if (sql.includes("trade_access_status = 'blocked'")) {
            state.user = {
              ...state.user,
              status: "archived",
              trade_access_status: "blocked",
              lock_reason_code: values?.[1] as string,
              locked_at: state.user.locked_at ?? new Date("2026-04-05T13:00:00.000Z"),
              updated_at: new Date("2026-04-05T13:00:00.000Z")
            };

            return {
              rows: [state.user],
              rowCount: 1
            };
          }

          state.user = {
            ...state.user,
            status: values?.[1] as "active" | "locked",
            lock_reason_code: (values?.[2] as string | null) ?? null,
            locked_at:
              values?.[1] === "locked" ? new Date("2026-04-05T13:00:00.000Z") : null,
            updated_at: new Date("2026-04-05T13:00:00.000Z")
          };

          return {
            rows: [state.user],
            rowCount: 1
          };
        }

        if (sql.includes("update users") && sql.includes("set trade_access_status =")) {
          state.user = {
            ...state.user,
            trade_access_status: values?.[1] as "enabled" | "blocked",
            updated_at: new Date("2026-04-05T13:00:00.000Z")
          };

          return {
            rows: [state.user],
            rowCount: 1
          };
        }

        if (sql.includes("update sessions")) {
          return {
            rows: [],
            rowCount: options?.activeSessionCount ?? 2
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

describe("user ops service", () => {
  it("locks a user account with a required reason code", async () => {
    const { pool, state } = createDbPool();

    const response = await lockUserAccount(
      pool,
      "user_target_1",
      {
        reasonCode: "risk_review"
      },
      ADMIN_ACTOR
    );

    expect(response).toMatchObject({
      userId: "user_target_1",
      status: "locked",
      tradeAccessStatus: "enabled",
      lockReasonCode: "risk_review"
    });
    expect(state.auditWritten).toBe(true);
  });

  it("unlocks a locked user account", async () => {
    const { pool } = createDbPool({
      userStatus: "locked",
      lockReasonCode: "risk_review"
    });

    const response = await unlockUserAccount(pool, "user_target_1", {}, ADMIN_ACTOR);

    expect(response).toMatchObject({
      userId: "user_target_1",
      status: "active",
      lockReasonCode: null,
      lockedAt: null
    });
  });

  it("blocks user trading without changing account status", async () => {
    const { pool } = createDbPool();

    const response = await blockUserTrading(
      pool,
      "user_target_1",
      {
        reasonCode: "support_hold"
      },
      ADMIN_ACTOR
    );

    expect(response).toMatchObject({
      userId: "user_target_1",
      status: "active",
      tradeAccessStatus: "blocked"
    });
  });

  it("archives a user account, blocks trading, and revokes sessions", async () => {
    const { pool, state } = createDbPool({
      activeSessionCount: 4
    });

    const response = await archiveUserAccount(
      pool,
      "user_target_1",
      {
        reasonCode: "support_archive"
      },
      ADMIN_ACTOR
    );

    expect(response).toMatchObject({
      userId: "user_target_1",
      status: "archived",
      tradeAccessStatus: "blocked",
      lockReasonCode: "support_archive",
      revokedSessionCount: 4,
      auditEventId: expect.any(String)
    });
    expect(state.auditWritten).toBe(true);
  });

  it("revokes all active sessions for a user", async () => {
    const { pool } = createDbPool({
      activeSessionCount: 3
    });

    const response = await revokeUserSessions(pool, "user_target_1", {}, ADMIN_ACTOR);

    expect(response).toMatchObject({
      userId: "user_target_1",
      revokedSessionCount: 3,
      auditEventId: expect.any(String)
    });
  });

  it("rejects archived users for mutable actions", async () => {
    const { pool } = createDbPool({
      userStatus: "archived"
    });

    await expect(
      lockUserAccount(
        pool,
        "user_target_1",
        {
          reasonCode: "risk_review"
        },
        ADMIN_ACTOR
      )
    ).rejects.toMatchObject<Partial<UserOpsServiceError>>({
      statusCode: 409,
      code: "invalid_user_state"
    });
  });

  it("rejects unsafe admin reason codes before mutating user state", async () => {
    const { pool, state } = createDbPool();

    await expect(
      lockUserAccount(
        pool,
        "user_target_1",
        {
          reasonCode: "risk_review\noperator_note"
        },
        ADMIN_ACTOR
      )
    ).rejects.toMatchObject<Partial<UserOpsServiceError>>({
      statusCode: 400,
      code: "invalid_request"
    });
    await expect(
      archiveUserAccount(
        pool,
        "user_target_1",
        {
          reasonCode: "x".repeat(121)
        },
        ADMIN_ACTOR
      )
    ).rejects.toMatchObject<Partial<UserOpsServiceError>>({
      statusCode: 400,
      code: "invalid_request"
    });
    expect(state.auditWritten).toBe(false);
  });
});
