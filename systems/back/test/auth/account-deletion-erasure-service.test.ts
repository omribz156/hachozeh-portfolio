import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import {
  completeAccountDeletionErasure,
  listPendingAccountDeletionRequests,
  previewAccountDeletionErasure,
  sweepDueAccountDeletionErasures
} from "../../src/auth/account-deletion-erasure-service";

const dueRow = {
  id: "delete_1",
  user_id: "user_1",
  reason: "leaving",
  scheduled_at: new Date("2026-06-01T10:00:00.000Z"),
  delete_after: new Date("2026-06-15T10:00:00.000Z")
};

function createPool() {
  const calls: string[] = [];
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    calls.push(sql);

    if (sql === "begin" || sql === "commit" || sql === "rollback") {
      return { rows: [], rowCount: 0 };
    }

    if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes("from account_deletion_requests") && sql.includes("for update")) {
      expect(values).toEqual(["delete_1"]);
      return { rows: [dueRow], rowCount: 1 };
    }

    if (sql.includes("from account_deletion_requests") && sql.includes("delete_after <= $1")) {
      expect(values).toEqual(["2026-06-16T10:00:00.000Z", 10]);
      return { rows: [dueRow], rowCount: 1 };
    }

    if (sql.includes("from account_deletion_requests") && sql.includes("limit $1")) {
      expect(values).toEqual([10]);
      return { rows: [dueRow], rowCount: 1 };
    }

    if (sql.includes("from account_deletion_requests")) {
      expect(values).toEqual(["delete_1"]);
      return { rows: [dueRow], rowCount: 1 };
    }

    if (sql.includes("select avatar_url")) {
      expect(values).toEqual(["user_1"]);
      return {
        rows: [{ avatar_url: "/api/uploads/avatars/user_1-missing.webp" }],
        rowCount: 1
      };
    }

    if (sql.includes("select type, identifier_normalized")) {
      expect(values).toEqual(["user_1"]);
      return {
        rows: [
          { type: "email", identifier_normalized: "reader@example.com" },
          { type: "google", identifier_normalized: "google-sub-1" }
        ],
        rowCount: 2
      };
    }

    if (sql.includes("delete from otp_challenges")) {
      expect(values).toEqual([["reader@example.com"]]);
      return { rows: [], rowCount: 3 };
    }

    if (sql.includes("delete from sessions")) return { rows: [], rowCount: 2 };
    if (sql.includes("delete from user_identities")) return { rows: [], rowCount: 2 };
    if (sql.includes("delete from notification_preferences")) return { rows: [], rowCount: 4 };
    if (sql.includes("delete from user_social_links")) return { rows: [], rowCount: 1 };
    if (sql.includes("delete from feedback")) return { rows: [], rowCount: 2 };
    if (sql.includes("delete from market_comment_likes")) return { rows: [], rowCount: 5 };
    if (sql.includes("delete from community_likes")) return { rows: [], rowCount: 9 };
    if (sql.includes("delete from user_market_saves")) return { rows: [], rowCount: 10 };
    if (sql.includes("delete from user_follows")) return { rows: [], rowCount: 6 };
    if (sql.includes("delete from user_profile_views_daily")) return { rows: [], rowCount: 8 };
    if (sql.includes("delete from user_faucet_state")) return { rows: [], rowCount: 2 };
    if (sql.includes("delete from idempotency_records")) return { rows: [], rowCount: 7 };

    if (sql.includes("update market_comments")) {
      expect(values).toEqual(["user_1", "[removed]"]);
      return { rows: [], rowCount: 3 };
    }

    if (sql.includes("update community_discussions")) {
      expect(values).toEqual(["user_1", "[removed]"]);
      return { rows: [], rowCount: 2 };
    }

    if (sql.includes("update community_comments")) {
      expect(values).toEqual(["user_1", "[removed]"]);
      return { rows: [], rowCount: 4 };
    }

    if (sql.includes("update community_posts")) {
      expect(values).toEqual(["user_1", "[removed]"]);
      return { rows: [], rowCount: 6 };
    }

    if (sql.includes("update users")) {
      expect(values).toEqual(["user_1", "2026-06-16T10:00:00.000Z"]);
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes("update account_deletion_requests")) {
      expect(values).toEqual(["delete_1", "2026-06-16T10:00:00.000Z"]);
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes("insert into audit_events")) {
      expect(values?.[1]).toBe("system:privacy-erasure");
      expect(values?.[2]).toBe("user.account_deletion.complete");
      expect(values?.[3]).toBe("user");
      expect(values?.[4]).toBe("user_1");
      const payload = JSON.parse(String(values?.[5]));
      expect(payload).toMatchObject({
        requestId: "delete_1",
        counts: {
          sessionsDeleted: 2,
          identitiesDeleted: 2,
          otpChallengesDeleted: 3,
          followsDeleted: 6,
          profileViewsDeleted: 8,
          commentsHidden: 3,
          communityContentHidden: 12,
          communityLikesDeleted: 9,
          marketSavesDeleted: 10
        }
      });
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  return {
    calls,
    pool: {
      query,
      connect: vi.fn(async () => ({
        query,
        release: vi.fn()
      }))
    } as unknown as Pool
  };
}

describe("account deletion erasure service", () => {
  it("previews a due request without mutating data", async () => {
    const { pool } = createPool();
    const item = await previewAccountDeletionErasure(pool, {
      requestId: "delete_1",
      now: new Date("2026-06-16T10:00:00.000Z")
    });

    expect(item).toMatchObject({
      requestId: "delete_1",
      userId: "user_1",
      status: "would_complete"
    });
  });

  it("completes a due erasure request and keeps integrity rows untouched", async () => {
    const { pool, calls } = createPool();
    const item = await completeAccountDeletionErasure(pool, {
      requestId: "delete_1",
      now: new Date("2026-06-16T10:00:00.000Z")
    });

    expect(item.status).toBe("completed");
    expect(item.counts).toMatchObject({
      sessionsDeleted: 2,
      identitiesDeleted: 2,
      otpChallengesDeleted: 3,
      notificationPreferencesDeleted: 4,
      socialLinksDeleted: 1,
      feedbackDeleted: 2,
      commentLikesDeleted: 5,
      commentsHidden: 3,
      communityContentHidden: 12,
      communityLikesDeleted: 9,
      marketSavesDeleted: 10,
      userFaucetStateDeleted: 2,
      idempotencyRecordsDeleted: 7,
      avatarFileDeleted: true
    });
    expect(calls.join("\n")).not.toContain("delete from trades");
    expect(calls.join("\n")).not.toContain("delete from ledger");
    expect(calls.join("\n")).not.toContain("delete from accounts");
  });

  it("dry-runs due scheduled requests during a sweep", async () => {
    const { pool } = createPool();
    const result = await sweepDueAccountDeletionErasures(pool, {
      limit: 10,
      execute: false,
      now: new Date("2026-06-16T10:00:00.000Z")
    });

    expect(result).toMatchObject({
      objectType: "account_deletion_erasure_sweep",
      execute: false,
      scannedCount: 1,
      completedCount: 0,
      items: [
        {
          requestId: "delete_1",
          status: "would_complete"
        }
      ]
    });
  });

  it("lists pending scheduled requests without mutating data", async () => {
    const { pool, calls } = createPool();
    const result = await listPendingAccountDeletionRequests(pool, {
      limit: 10,
      now: new Date("2026-06-16T10:00:00.000Z")
    });

    expect(result).toEqual({
      objectType: "account_deletion_pending_requests",
      generatedAt: "2026-06-16T10:00:00.000Z",
      scannedCount: 1,
      dueCount: 1,
      items: [
        {
          requestId: "delete_1",
          userId: "user_1",
          reason: "leaving",
          scheduledAt: "2026-06-01T10:00:00.000Z",
          deleteAfter: "2026-06-15T10:00:00.000Z",
          isDue: true
        }
      ]
    });
    expect(calls.join("\n")).not.toContain("update account_deletion_requests");
    expect(calls.join("\n")).not.toContain("delete from");
  });
});
