import { describe, expect, it, vi } from "vitest";

import type { Queryable } from "../../src/db/client/pool";
import { readCurrentUserSessionSummary } from "../../src/auth/current-user-session-read-service";

function createQueryable(rows?: Array<{
  current_expires_at: Date;
  current_last_seen_at: Date | null;
  active_session_count: number;
  summary_last_seen_at: Date | null;
}>, sessionRows?: Array<{
  id: string;
  created_at: Date;
  last_seen_at: Date | null;
  expires_at: Date;
}>, auditRows?: Array<{
  action: string;
  created_at: Date;
  actor_id: string;
}>): Queryable {
  return {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("from sessions current_session")) {
        expect(values).toEqual(["session_1", "user_1", "30 minutes"]);
        expect(sql).toContain("and s.expires_at > now()");
        expect(sql).toContain("and current_session.expires_at > now()");
        expect(sql).toContain("or s.last_seen_at >= now() - $3::interval");

        return {
          rows: rows ?? []
        };
      }

      if (sql.includes("from sessions") && sql.includes("order by (id = $2) desc")) {
        expect(values).toEqual(["user_1", "session_1", "30 minutes"]);
        expect(sql).toContain("and expires_at > now()");
        expect(sql).toContain("or last_seen_at >= now() - $3::interval");

        return {
          rows: sessionRows ?? [
            {
              id: "session_1",
              created_at: new Date("2026-04-07T09:00:00.000Z"),
              last_seen_at: new Date("2026-04-07T10:00:00.000Z"),
              expires_at: new Date("2026-04-12T09:00:00.000Z")
            }
          ]
        };
      }

      if (sql.includes("from audit_events")) {
        expect(values).toEqual(["user_1"]);

        return {
          rows: auditRows ?? []
        };
      }

      if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    })
  };
}

describe("current user session read service", () => {
  it("returns a compact current-session summary for the authenticated user", async () => {
    const payload = await readCurrentUserSessionSummary(
      createQueryable([
        {
          current_expires_at: new Date("2026-04-12T09:00:00.000Z"),
          current_last_seen_at: new Date("2026-04-07T10:00:00.000Z"),
          active_session_count: 3,
          summary_last_seen_at: new Date("2026-04-07T10:05:00.000Z")
        }
      ], [
        {
          id: "session_1",
          created_at: new Date("2026-04-07T09:00:00.000Z"),
          last_seen_at: new Date("2026-04-07T10:00:00.000Z"),
          expires_at: new Date("2026-04-12T09:00:00.000Z")
        },
        {
          id: "session_2",
          created_at: new Date("2026-04-07T09:30:00.000Z"),
          last_seen_at: new Date("2026-04-07T10:05:00.000Z"),
          expires_at: new Date("2026-04-12T09:30:00.000Z")
        }
      ], [
        {
          action: "user.session.revoke_other_sessions",
          created_at: new Date("2026-04-07T10:10:00.000Z"),
          actor_id: "user_1"
        }
      ]),
      "user_1",
      "session_1"
    );

    expect(payload).toEqual({
      summary: {
        activeCount: 3,
        hasOtherActiveSessions: true,
        lastSeenAt: "2026-04-07T10:05:00.000Z"
      },
      currentSession: {
        id: "session_1",
        expiresAt: "2026-04-12T09:00:00.000Z",
        lastSeenAt: "2026-04-07T10:00:00.000Z"
      },
      sessions: [
        {
          id: "session_1",
          label: "המכשיר הזה",
          current: true,
          createdAt: "2026-04-07T09:00:00.000Z",
          lastSeenAt: "2026-04-07T10:00:00.000Z",
          expiresAt: "2026-04-12T09:00:00.000Z"
        },
        {
          id: "session_2",
          label: "מכשיר 2",
          current: false,
          createdAt: "2026-04-07T09:30:00.000Z",
          lastSeenAt: "2026-04-07T10:05:00.000Z",
          expiresAt: "2026-04-12T09:30:00.000Z"
        }
      ],
      recentSecurityActions: [
        {
          action: "user.session.revoke_other_sessions",
          createdAt: "2026-04-07T10:10:00.000Z",
          actorId: "user_1"
        }
      ]
    });
  });

  it("marks the session as solitary when only one active session exists", async () => {
    const payload = await readCurrentUserSessionSummary(
      createQueryable([
        {
          current_expires_at: new Date("2026-04-12T09:00:00.000Z"),
          current_last_seen_at: null,
          active_session_count: 1,
          summary_last_seen_at: null
        }
      ]),
      "user_1",
      "session_1"
    );

    expect(payload.summary).toEqual({
      activeCount: 1,
      hasOtherActiveSessions: false,
      lastSeenAt: null
    });
    expect(payload.currentSession).toEqual({
      id: "session_1",
      expiresAt: "2026-04-12T09:00:00.000Z",
      lastSeenAt: null
    });
    expect(payload.sessions).toEqual([
      {
        id: "session_1",
        label: "המכשיר הזה",
        current: true,
        createdAt: "2026-04-07T09:00:00.000Z",
        lastSeenAt: "2026-04-07T10:00:00.000Z",
        expiresAt: "2026-04-12T09:00:00.000Z"
      }
    ]);
    expect(payload.recentSecurityActions).toEqual([]);
  });

  it("describes only the current session plus recently seen sessions", async () => {
    const payload = await readCurrentUserSessionSummary(
      createQueryable([
        {
          current_expires_at: new Date("2026-04-12T09:00:00.000Z"),
          current_last_seen_at: new Date("2026-04-07T10:00:00.000Z"),
          active_session_count: 2,
          summary_last_seen_at: new Date("2026-04-07T10:05:00.000Z")
        }
      ], [
        {
          id: "session_1",
          created_at: new Date("2026-04-07T09:00:00.000Z"),
          last_seen_at: new Date("2026-04-07T10:00:00.000Z"),
          expires_at: new Date("2026-04-12T09:00:00.000Z")
        },
        {
          id: "session_recent",
          created_at: new Date("2026-04-07T09:30:00.000Z"),
          last_seen_at: new Date("2026-04-07T10:05:00.000Z"),
          expires_at: new Date("2026-04-12T09:30:00.000Z")
        }
      ]),
      "user_1",
      "session_1"
    );

    expect(payload.summary.activeCount).toBe(2);
    expect(payload.summary.hasOtherActiveSessions).toBe(true);
    expect(payload.sessions.map((session) => session.id)).toEqual(["session_1", "session_recent"]);
  });
});
