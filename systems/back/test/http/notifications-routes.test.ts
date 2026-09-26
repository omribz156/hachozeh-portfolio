import { afterEach, describe, expect, it } from "vitest";

import {
  closeAppTestServers,
  startServer
} from "./app-test-harness";

afterEach(async () => {
  await closeAppTestServers();
});

function sessionRows() {
  return [
    {
      session_id: "session_1",
      user_id: "user_1",
      session_status: "active",
      created_at: new Date(Date.now() - 3_600_000),
      last_seen_at: new Date(Date.now() - 120_000),
      expires_at: new Date(Date.now() + 60_000),
      user_status: "active",
      user_role: "user"
    }
  ];
}

describe("notification routes", () => {
  it("requires a real session for the feed", async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/api/me/notifications`);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error.code).toBe("unauthorized");
  });

  it("returns the current user's notification feed", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql.includes("from sessions s")) return { rows: sessionRows() };
        if (sql.includes("update sessions")) return { rows: [] };

        if (sql.includes("from user_notifications") && sql.includes("order by nu.created_at")) {
          expect(values).toEqual(["user_1", 50]);
          return {
            rows: [
              {
                id: "notif_1",
                type: "loss",
                market_id: "market_a",
                html: '<b>הוכרע</b>: <span class="hz-notif__q">שוק א</span>',
                amount: "-V₪ 50",
                amount_tone: "neg",
                claim: null,
                claimed: false,
                thumb_glyph: "do_not_disturb_on",
                thumb_accent: "var(--hz-action-sell-strong)",
                read_at: null,
                created_at: new Date()
              }
            ]
          };
        }

        if (sql.includes("count(*)")) {
          expect(values).toEqual(["user_1"]);
          return { rows: [{ count: "1" }] };
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/api/me/notifications`, {
      headers: { cookie: "navi_session=live" }
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.unreadCount).toBe(1);
    expect(payload.items[0]).toMatchObject({
      id: "notif_1",
      type: "loss",
      unread: true,
      amount: "-V₪ 50",
      amountTone: "neg"
    });
  });

  it("marks a notification read and records the opened event", async () => {
    const eventInserts: unknown[][] = [];
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql.includes("from sessions s")) return { rows: sessionRows() };
        if (sql.includes("update sessions")) return { rows: [] };

        if (sql.includes("update user_notifications")) {
          expect(values).toEqual(["notif_1", "user_1"]);
          return { rows: [{ id: "notif_1" }] };
        }

        if (sql.includes("insert into user_notification_events")) {
          eventInserts.push(values ?? []);
          return { rows: [] };
        }

        if (sql.includes("count(*)")) {
          return { rows: [{ count: "0" }] };
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/api/me/notifications/notif_1/read`, {
      method: "POST",
      headers: { cookie: "navi_session=live" }
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      id: "notif_1",
      unread: false,
      unreadCount: 0
    });
    expect(eventInserts[0]?.[3]).toBe("result_opened");
  });

  it("dismisses an owned notification", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql.includes("from sessions s")) return { rows: sessionRows() };
        if (sql.includes("update sessions")) return { rows: [] };

        if (sql.includes("update user_notifications")) {
          expect(sql).toContain("dismissed_at = now()");
          expect(values).toEqual(["notif_1", "user_1"]);
          return { rows: [{ id: "notif_1" }] };
        }

        if (sql.includes("count(*)")) {
          expect(sql).toContain("dismissed_at is null");
          return { rows: [{ count: "0" }] };
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/api/me/notifications/notif_1/dismiss`, {
      method: "POST",
      headers: { cookie: "navi_session=live" }
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      id: "notif_1",
      dismissed: true,
      unreadCount: 0
    });
  });

  it("marks all owned notifications unread", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql.includes("from sessions s")) return { rows: sessionRows() };
        if (sql.includes("update sessions")) return { rows: [] };

        if (sql.includes("update user_notifications")) {
          expect(values).toEqual(["user_1"]);
          return { rows: [{ id: "notif_1" }, { id: "notif_2" }] };
        }

        if (sql.includes("count(*)")) {
          expect(values).toEqual(["user_1"]);
          return { rows: [{ count: "2" }] };
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/api/me/notifications/unread-all`, {
      method: "POST",
      headers: { cookie: "navi_session=live" }
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      markedUnreadCount: 2,
      unreadCount: 2
    });
  });
});
