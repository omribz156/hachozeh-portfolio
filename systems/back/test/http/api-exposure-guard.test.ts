import { afterEach, describe, expect, it } from "vitest";

import {
  closeAppTestServers,
  startServer
} from "./app-test-harness";
import { hashValue } from "../../src/auth/session/hashing";

const BANNED_PUBLIC_KEYS = [
  "admin",
  "audit",
  "code_hash",
  "email",
  "identifier_display",
  "identifier_normalized",
  "ip_hash",
  "password",
  "raw",
  "risk",
  "secret",
  "token",
  "token_hash",
  "user_agent_hash",
  "user_id"
];

afterEach(async () => {
  await closeAppTestServers();
});

function collectBannedKeys(value: unknown, path = "$"): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectBannedKeys(entry, `${path}[${index}]`));
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => {
    const normalizedKey = key.toLowerCase();
    const currentPath = `${path}.${key}`;
    const hits = BANNED_PUBLIC_KEYS.some((bannedKey) => normalizedKey.includes(bannedKey))
      ? [currentPath]
      : [];

    return [...hits, ...collectBannedKeys(nested, currentPath)];
  });
}

function expectNoBannedPublicKeys(payload: unknown): void {
  expect(collectBannedKeys(payload)).toEqual([]);
}

function createSessionQueryImpl(role: "user" | "admin" = "user") {
  return async (sql: string, values?: unknown[]) => {
    if (sql.includes("from sessions s")) {
      expect(values).toEqual([hashValue("live")]);

      return {
        rows: [
          {
            session_id: "session_1",
            user_id: "user_1",
            session_status: "active",
            created_at: new Date(Date.now() - 3_600_000),
            last_seen_at: new Date(),
            expires_at: new Date(Date.now() + 60_000),
            user_status: "active",
            user_role: role
          }
        ]
      };
    }

    if (sql.includes("update sessions")) {
      return { rows: [] };
    }

    throw new Error(`Unexpected db query in API exposure guard: ${sql}`);
  };
}

describe("API exposure guard", () => {
  it("keeps public market catalog responses on an allowlisted DTO shape", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql.includes("from markets m")) {
          expect(values).toEqual(["open", null, 1, null]);

          return {
            rows: [
              {
                market_id: "market_public_1",
                market_status: "open",
                title: "שוק ציבורי",
                description: "מותר לציבור",
                category_key: "politics",
                open_at: new Date("2026-06-01T08:00:00.000Z"),
                close_at: new Date("2026-07-01T18:00:00.000Z"),
                published_at: new Date("2026-06-01T09:00:00.000Z"),
                updated_at: new Date("2026-06-01T10:00:00.000Z"),
                market_state_version: "3",
                outcome_count: 2,
                total_volume: "300.000000",
                outcome_id: "outcome_a",
                outcome_label: "כן",
                outcome_short_label: "כן",
                sort_order: 0,
                last_price: "0.61000000",
                // Deliberate raw/internal-looking fields. Public mappers must not
                // spread DB rows into JSON.
                user_id: "user_private_1",
                identifier_normalized: "private@example.com",
                token_hash: "token_hash_private",
                ip_hash: "ip_hash_private",
                risk_score: 99,
                admin_notes: "private"
              }
            ]
          };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }

        throw new Error(`Unexpected db query in API exposure guard: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/api/markets?limit=1`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.markets).toHaveLength(1);
    expectNoBannedPublicKeys(payload);
  });

  it("keeps session-owned routes private without a cookie", async () => {
    const { baseUrl } = await startServer({
      env: {
        actorMode: { demoEnabled: false },
        trading: { requireSession: true }
      }
    });

    for (const path of ["/api/me", "/api/me/data-export", "/api/portfolio/snapshot"]) {
      const response = await fetch(`${baseUrl}${path}`);
      const payload = await response.json();

      expect(response.status, path).toBe(401);
      expect(response.headers.get("cache-control"), path).toBe("no-store");
      expect(payload.error.code, path).toBe("unauthorized");
    }
  });

  it("blocks unauthenticated trade writes when production-style session gating is enabled", async () => {
    const { baseUrl } = await startServer({
      env: {
        actorMode: { demoEnabled: false },
        trading: { requireSession: true }
      }
    });

    const response = await fetch(`${baseUrl}/api/markets/market_public_1/trades`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://127.0.0.1:6969"
      },
      body: JSON.stringify({
        outcomeId: "outcome_a",
        side: "buy",
        cashAmount: "10"
      })
    });
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error.code).toBe("unauthorized");
  });

  it("rejects normal users from admin routes", async () => {
    const { baseUrl } = await startServer({
      queryImpl: createSessionQueryImpl("user")
    });

    const response = await fetch(`${baseUrl}/admin/users/user_target_1`, {
      headers: {
        cookie: "navi_session=live"
      }
    });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error.code).toBe("unauthorized");
    expect(payload.error.message).toBe("Admin access is required.");
  });
});
