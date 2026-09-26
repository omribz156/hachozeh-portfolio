import { afterEach, describe, expect, it } from "vitest";

import { closeAppTestServers, startServer } from "./app-test-harness";

afterEach(async () => {
  await closeAppTestServers();
});

function activeSessionRow(role: "user" | "admin" = "user") {
  return {
    session_id: "session_1",
    user_id: "user_1",
    session_status: "active",
    created_at: new Date(Date.now() - 3_600_000),
    last_seen_at: new Date(),
    expires_at: new Date(Date.now() + 60_000),
    user_status: "active",
    user_role: role
  };
}

describe("feedback routes", () => {
  it("requires a real session", async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/api/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "idea",
        message: "Please add this."
      })
    });
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toMatchObject({
      error: {
        code: "unauthorized"
      }
    });
  });

  it("stores signed-in feedback and returns 201", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql.includes("from sessions s")) {
          return { rows: [activeSessionRow()] };
        }

        if (sql.includes("count(*)::text")) {
          expect(values).toEqual(["user_1"]);
          return { rows: [{ count: "0" }] };
        }

        if (sql.includes("insert into feedback")) {
          expect(values?.[1]).toBe("user_1");
          expect(values?.[2]).toBe("bug");
          expect(values?.[4]).toBe("Graph range labels jump around.");
          expect(values?.[6]).toBeNull();
          return {
            rows: [
              {
                id: "feedback_1",
                type: "bug",
                screenshot_url: null,
                created_at: new Date("2026-06-14T10:00:00.000Z")
              }
            ]
          };
        }

        throw new Error(`Unexpected db query: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/api/feedback`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "navi_session=live"
      },
      body: JSON.stringify({
        type: "bug",
        message: "Graph range labels jump around."
      })
    });
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload).toEqual({
      ok: true,
      feedback: {
        id: "feedback_1",
        type: "bug",
        status: "new",
        screenshotUrl: null,
        createdAt: "2026-06-14T10:00:00.000Z"
      }
    });
  });

  it("requires an admin session to read feedback images", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string) => {
        if (sql.includes("from sessions s")) {
          return { rows: [activeSessionRow()] };
        }

        throw new Error(`Unexpected db query: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/api/uploads/feedback/feedback-test.webp`, {
      headers: {
        cookie: "navi_session=live"
      }
    });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toMatchObject({
      error: {
        code: "unauthorized"
      }
    });
  });

  it("rejects state-changing browser requests from an untrusted origin before DB work", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async () => {
        throw new Error("DB should not be reached for rejected origins.");
      }
    });

    const response = await fetch(`${baseUrl}/api/feedback`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "navi_session=live",
        origin: "https://evil.example.com"
      },
      body: JSON.stringify({
        type: "bug",
        message: "Cross-site write."
      })
    });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toMatchObject({
      error: {
        code: "forbidden_origin"
      }
    });
  });

  it("rejects cross-site Fetch Metadata writes without an Origin before DB work", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async () => {
        throw new Error("DB should not be reached for rejected fetch metadata.");
      }
    });

    const response = await fetch(`${baseUrl}/api/feedback`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "navi_session=live",
        "sec-fetch-site": "cross-site"
      },
      body: JSON.stringify({
        type: "bug",
        message: "Cross-site write without Origin."
      })
    });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toMatchObject({
      error: {
        code: "forbidden_origin"
      }
    });
  });

  it("allows state-changing browser requests from the configured web origin", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql.includes("from sessions s")) {
          return { rows: [activeSessionRow()] };
        }

        if (sql.includes("count(*)::text")) {
          return { rows: [{ count: "0" }] };
        }

        if (sql.includes("insert into feedback")) {
          expect(values?.[1]).toBe("user_1");
          return {
            rows: [
              {
                id: "feedback_2",
                type: "idea",
                screenshot_url: null,
                created_at: new Date("2026-06-14T10:05:00.000Z")
              }
            ]
          };
        }

        throw new Error(`Unexpected db query: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/api/feedback`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "navi_session=live",
        origin: "http://127.0.0.1:6969"
      },
      body: JSON.stringify({
        type: "idea",
        message: "Legit same app write."
      })
    });

    expect(response.status).toBe(201);
  });
});
