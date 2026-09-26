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

describe("market save routes", () => {
  it("rejects guests cleanly", async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/api/markets/next-prime-minister/save`, {
      method: "POST"
    });
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error.code).toBe("unauthorized");
  });

  it("saves a market idempotently for the current user", async () => {
    const savedInserts: unknown[][] = [];
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql.includes("from sessions s")) return { rows: sessionRows() };
        if (sql.includes("update sessions")) return { rows: [] };

        if (sql.includes("select id from markets")) {
          expect(values).toEqual(["market_seed_next_prime_minister"]);
          return { rows: [{ id: "market_seed_next_prime_minister" }] };
        }

        if (sql.includes("insert into user_market_saves")) {
          savedInserts.push(values ?? []);
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes("from markets m") && sql.includes("left join user_market_saves")) {
          expect(values).toEqual(["market_seed_next_prime_minister", "user_1"]);
          return {
            rows: [
              {
                market_id: "market_seed_next_prime_minister",
                title: "מי יהיה ראש הממשלה הבא?",
                saved: true,
                saved_at: new Date("2026-06-26T10:00:00.000Z")
              }
            ]
          };
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/api/markets/next-prime-minister/save`, {
      method: "POST",
      headers: { cookie: "navi_session=live" }
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      marketKey: "next-prime-minister",
      marketId: "market_seed_next_prime_minister",
      saved: true
    });
    expect(savedInserts).toEqual([["user_1", "market_seed_next_prime_minister"]]);
  });

  it("unsaves a market idempotently for the current user", async () => {
    const deletes: unknown[][] = [];
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql.includes("from sessions s")) return { rows: sessionRows() };
        if (sql.includes("update sessions")) return { rows: [] };

        if (sql.includes("select id from markets")) {
          return { rows: [{ id: "market_seed_next_prime_minister" }] };
        }

        if (sql.includes("delete from user_market_saves")) {
          deletes.push(values ?? []);
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes("from markets m") && sql.includes("left join user_market_saves")) {
          return {
            rows: [
              {
                market_id: "market_seed_next_prime_minister",
                title: "מי יהיה ראש הממשלה הבא?",
                saved: false,
                saved_at: null
              }
            ]
          };
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/api/markets/next-prime-minister/save`, {
      method: "DELETE",
      headers: { cookie: "navi_session=live" }
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.saved).toBe(false);
    expect(deletes).toEqual([["user_1", "market_seed_next_prime_minister"]]);
  });
});
