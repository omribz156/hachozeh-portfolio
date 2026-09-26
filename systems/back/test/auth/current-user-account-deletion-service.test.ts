import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import {
  cancelCurrentUserAccountDeletion,
  readCurrentUserAccountDeletion,
  scheduleCurrentUserAccountDeletion
} from "../../src/auth/current-user-account-deletion-service";

function createPool(options?: {
  existingDeletion?: boolean;
  userStatus?: "active" | "locked" | "archived";
  tradeAccessStatus?: "enabled" | "blocked";
}) {
  const deletionRow = {
    id: "delete_1",
    user_id: "user_1",
    status: "scheduled",
    reason: "leaving",
    previous_trade_access_status: options?.tradeAccessStatus ?? "enabled",
    created_session_id: "session_1",
    scheduled_at: new Date("2026-06-14T10:00:00.000Z"),
    delete_after: new Date("2026-06-28T10:00:00.000Z"),
    cancelled_at: null,
    completed_at: null,
    updated_at: new Date("2026-06-14T10:00:00.000Z")
  };

  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql === "begin" || sql === "commit" || sql === "rollback") {
      return { rows: [], rowCount: 0 };
    }

    if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes("from users")) {
      expect(values).toEqual(["user_1"]);
      return {
        rows: [
          {
            id: "user_1",
            status: options?.userStatus ?? "active",
            trade_access_status: options?.tradeAccessStatus ?? "enabled"
          }
        ],
        rowCount: 1
      };
    }

    if (sql.includes("from account_deletion_requests")) {
      expect(values).toEqual(["user_1"]);
      return {
        rows: options?.existingDeletion ? [deletionRow] : [],
        rowCount: options?.existingDeletion ? 1 : 0
      };
    }

    if (sql.includes("insert into account_deletion_requests")) {
      expect(values?.[1]).toBe("user_1");
      expect(values?.[2]).toBe("leaving");
      expect(values?.[3]).toBe(options?.tradeAccessStatus ?? "enabled");
      expect(values?.[4]).toBe("session_1");
      return { rows: [deletionRow], rowCount: 1 };
    }

    if (sql.includes("update account_deletion_requests")) {
      expect(values).toEqual(["delete_1", "user_1"]);
      return {
        rows: [
          {
            ...deletionRow,
            status: "cancelled",
            cancelled_at: new Date("2026-06-15T10:00:00.000Z")
          }
        ],
        rowCount: 1
      };
    }

    if (sql.includes("update users")) {
      expect(values?.[0]).toBe("user_1");
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes("update sessions")) {
      expect(values).toEqual(["user_1", "session_1"]);
      return { rows: [], rowCount: 2 };
    }

    if (sql.includes("insert into audit_events")) {
      expect(values?.[1]).toBe("user_1");
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  return {
    query,
    connect: vi.fn(async () => ({
      query,
      release: vi.fn()
    }))
  } as unknown as Pool;
}

describe("current user account deletion service", () => {
  it("reads no scheduled deletion as none", async () => {
    const payload = await readCurrentUserAccountDeletion(createPool(), "user_1");

    expect(payload).toMatchObject({
      deletion: {
        status: "none"
      },
      user: {
        userId: "user_1",
        tradeAccessStatus: "enabled"
      }
    });
  });

  it("schedules deletion with a grace window and blocks trading", async () => {
    const payload = await scheduleCurrentUserAccountDeletion(createPool(), "user_1", "session_1", {
      reason: " leaving "
    });

    expect(payload.deletion).toMatchObject({
      status: "scheduled",
      reason: "leaving",
      deleteAfter: "2026-06-28T10:00:00.000Z"
    });
    expect(payload.user.tradeAccessStatus).toBe("blocked");
  });

  it("cancels a scheduled deletion and restores previous trade access", async () => {
    const payload = await cancelCurrentUserAccountDeletion(
      createPool({
        existingDeletion: true
      }),
      "user_1",
      "session_1",
      {}
    );

    expect(payload.deletion.status).toBe("cancelled");
    expect(payload.user.tradeAccessStatus).toBe("enabled");
  });

  it("rejects account deletion for locked accounts", async () => {
    await expect(
      scheduleCurrentUserAccountDeletion(
        createPool({
          userStatus: "locked"
        }),
        "user_1",
        "session_1",
        {}
      )
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "invalid_user_state"
    });
  });
});
