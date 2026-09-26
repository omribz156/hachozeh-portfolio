import { afterEach, describe, expect, it } from "vitest";

import {
  closeAppTestServers,
  startServer
} from "./app-test-harness";
import { resetRequestMetricsForTest } from "../../src/http/request-metrics";

const ORIGINAL_DIAGNOSTICS_BEARER_TOKEN = process.env.DIAGNOSTICS_BEARER_TOKEN;

afterEach(async () => {
  if (ORIGINAL_DIAGNOSTICS_BEARER_TOKEN === undefined) {
    delete process.env.DIAGNOSTICS_BEARER_TOKEN;
  } else {
    process.env.DIAGNOSTICS_BEARER_TOKEN = ORIGINAL_DIAGNOSTICS_BEARER_TOKEN;
  }
  resetRequestMetricsForTest();
  await closeAppTestServers();
});

async function adminSessionQuery(sql: string) {
  if (sql.includes("from sessions s")) {
    return {
      rows: [
        {
          session_id: "session_admin_1",
          user_id: "user_admin_1",
          session_status: "active",
          created_at: new Date(Date.now() - 3_600_000),
          expires_at: new Date(Date.now() + 60_000),
          user_status: "active",
          user_role: "admin"
        }
      ]
    };
  }

  if (sql.includes("update sessions")) {
    return { rows: [] };
  }

  if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
    return { rows: [], rowCount: 0 };
  }
  throw new Error(`Unexpected db query in health test: ${sql}`);
}

describe("health routes", () => {
  it("returns liveness payload without touching dependencies", async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/health/live`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(response.headers.get("content-security-policy")).toContain("object-src 'none'");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("content-security-policy")).toContain("script-src-attr 'none'");
    expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(response.headers.get("permissions-policy")).toContain("camera=()");
    expect(payload).toMatchObject({
      service: "navi-backend",
      status: "ok",
      environment: "test",
      uptimeMs: expect.any(Number),
      now: expect.any(String)
    });
  });

  it("returns backend diagnostics for memory-sensitive soaks", async () => {
    const { baseUrl } = await startServer({ queryImpl: adminSessionQuery });

    const response = await fetch(`${baseUrl}/health/diagnostics`, {
      headers: { cookie: "navi_session=live" }
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(payload).toMatchObject({
      service: "navi-backend",
      status: "ok",
      environment: "test",
      health: {
        verdict: "ok",
        warnings: [],
        thresholds: {
          rssWatchMiB: expect.any(Number),
          rssBadMiB: expect.any(Number),
          heapUsedWatchMiB: expect.any(Number),
          heapUsedBadMiB: expect.any(Number)
        }
      },
      memory: {
        rssBytes: expect.any(Number),
        heapUsedBytes: expect.any(Number),
        rssMiB: expect.any(Number),
        heapUsedMiB: expect.any(Number)
      },
      caches: {
        marketApi: {
          entries: expect.any(Number),
          maxEntries: expect.any(Number),
          ttlMs: expect.any(Number),
          inFlight: expect.any(Number),
          hitCount: expect.any(Number),
          missCount: expect.any(Number),
          hitRate: expect.any(Number)
        },
        marketDetailPassive: {
          entries: expect.any(Number),
          maxEntries: expect.any(Number),
          ttlMs: expect.any(Number),
          inFlight: expect.any(Number),
          hitCount: expect.any(Number),
          missCount: expect.any(Number),
          hitRate: expect.any(Number)
        }
      },
      requests: {
        retained: expect.any(Number),
        maxRetained: expect.any(Number),
        windows: {
          oneMinute: {
            requestCount: expect.any(Number),
            error5xxCount: expect.any(Number),
            history: {
              count: expect.any(Number)
            }
          },
          fiveMinutes: {
            requestCount: expect.any(Number),
            error5xxCount: expect.any(Number),
            history: {
              count: expect.any(Number)
            }
          }
        }
      },
      database: {
        pool: {
          totalCount: null,
          idleCount: null,
          waitingCount: null
        }
      },
      streams: {
        market: {
          markets: expect.any(Number),
          connections: expect.any(Number)
        },
        portfolio: {
          actors: expect.any(Number),
          connections: expect.any(Number)
        },
        discovery: {
          feeds: expect.any(Number),
          connections: expect.any(Number)
        },
        clients: {
          clients: expect.any(Number),
          connections: expect.any(Number)
        }
      },
      runtime: {
        identity: {
          service: "navi-backend",
          environment: "test",
          commitSha: null,
          buildTimestamp: null,
          releaseId: null
        },
        migration: {
          status: expect.any(String),
          latest: null,
          count: null
        },
        economy: {
          status: expect.any(String),
          platformTreasury: null,
          mintSource: null,
          faucetTables: null
        },
        backup: {
          status: expect.any(String),
          source: "local-dir",
          watchAgeMs: expect.any(Number)
        },
        latestLifecycleHeartbeat: null
      }
    });
    expect(payload.runtime.backup).not.toHaveProperty("directory");
    expect(payload.runtime.backup).not.toHaveProperty("latestPath");
  });

  it("includes schema migration state in diagnostics when the DB can answer", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql) => {
        if (sql.includes("from sessions s")) {
          return {
            rows: [
              {
                session_id: "session_admin_1",
                user_id: "user_admin_1",
                session_status: "active",
                created_at: new Date(Date.now() - 3_600_000),
                expires_at: new Date(Date.now() + 60_000),
                user_status: "active",
                user_role: "admin"
              }
            ]
          };
        }

        if (sql.includes("update sessions")) {
          return { rows: [] };
        }

        if (sql.includes("from schema_migrations")) {
          return {
            rows: [{ latest: "202605290001_runtime_identity.sql", count: 12 }]
          };
        }

        if (sql.includes("from accounts") && sql.includes("platform_treasury")) {
          return {
            rows: [
              {
                type: "platform_treasury",
                id: "account_platform_treasury",
                status: "active",
                balance_cached: "250000.000000"
              },
              {
                type: "mint_source",
                id: "account_mint_source",
                status: "active",
                balance_cached: "-250000.000000"
              }
            ]
          };
        }

        if (sql.includes("to_regclass('public.user_faucet_state')")) {
          return {
            rows: [{ user_faucet_state_exists: true, faucet_claims_exists: true }]
          };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected query: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/health/diagnostics`, {
      headers: { cookie: "navi_session=live" }
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.runtime.migration).toEqual({
      status: "ok",
      latest: "202605290001_runtime_identity.sql",
      count: 12
    });
    expect(payload.runtime.economy).toMatchObject({
      status: "ok",
      platformTreasury: {
        accountId: "account_platform_treasury",
        accountStatus: "active",
        balance: "250000.000000",
        verdict: "ok"
      },
      faucetTables: {
        userFaucetState: true,
        faucetClaims: true
      },
      flow: {
        status: "unavailable"
      }
    });
  });

  it("allows production doctor diagnostics through a bearer token without an admin session cookie", async () => {
    process.env.DIAGNOSTICS_BEARER_TOKEN = "diagnostics-secret-long-enough-for-prod";
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string) => {
        if (sql.includes("from sessions s")) {
          throw new Error("diagnostics bearer should not read admin session");
        }
        return { rows: [], rowCount: 0 };
      }
    });

    const response = await fetch(`${baseUrl}/health/diagnostics`, {
      headers: { authorization: "Bearer diagnostics-secret-long-enough-for-prod" }
    });

    expect(response.status).toBe(200);
  });

  it("serves admin economy telemetry", async () => {
    const activeUserQueryValues: unknown[][] = [];
    const { baseUrl } = await startServer({
      queryImpl: async (sql, values) => {
        if (sql.includes("from sessions s")) {
          return {
            rows: [
              {
                session_id: "session_admin_1",
                user_id: "user_admin_1",
                session_status: "active",
                created_at: new Date(Date.now() - 3_600_000),
                expires_at: new Date(Date.now() + 60_000),
                user_status: "active",
                user_role: "admin"
              }
            ]
          };
        }

        if (sql.includes("update sessions")) {
          return { rows: [] };
        }

        if (sql.includes("from ledger_transactions")) {
          return {
            rows: [
              {
                local_date: "2026-06-14",
                type: "grant",
                transaction_count: 2,
                entry_sum: "125.000000"
              }
            ]
          };
        }

        if (sql.includes("from faucet_claims")) {
          return {
            rows: [
              {
                local_date: "2026-06-14",
                faucet_type: "daily_login",
                claim_count: 1,
                reward_total: "100.000000"
              }
            ]
          };
        }

        if (sql.includes("where type in ('platform_treasury', 'mint_source')")) {
          return {
            rows: [
              { type: "platform_treasury", balance_cached: "250000.000000" },
              { type: "mint_source", balance_cached: "-250000.000000" }
            ]
          };
        }

        if (sql.includes("count(distinct user_id)::int as active_users")) {
          activeUserQueryValues.push(values ?? []);
          return { rows: [{ active_users: 5 }] };
        }

        if (sql.includes("group by bucket")) {
          return { rows: [{ bucket: "1000-4999", user_count: 3 }] };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/admin/economy/telemetry?days=14`, {
      headers: { cookie: "navi_session=live" }
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      timeZone: "Asia/Jerusalem",
      ledgerFlowByType: [
        {
          localDate: "2026-06-14",
          type: "grant",
          transactionCount: 2,
          entrySum: "125.000000"
        }
      ],
      faucetFlow: [
        {
          localDate: "2026-06-14",
          faucetType: "daily_login",
          claimCount: 1,
          rewardTotal: "100.000000"
        }
      ],
      treasury: {
        platformTreasury: "250000.000000",
        mintSource: "-250000.000000"
      },
      activeUsers: 5,
      netGrantFlowPerActiveUser: expect.any(String),
      balanceHistogram: [{ bucket: "1000-4999", userCount: 3 }]
    });

    await fetch(`${baseUrl}/admin/economy/telemetry?days=999`, {
      headers: { cookie: "navi_session=live" }
    });

    const [from, to] = activeUserQueryValues.at(-1) ?? [];
    expect(Date.parse(String(to)) - Date.parse(String(from))).toBe(90 * 24 * 60 * 60 * 1000);
  });

  it("marks economy diagnostics bad when platform treasury is missing", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql) => {
        if (sql.includes("from sessions s")) {
          return {
            rows: [
              {
                session_id: "session_admin_1",
                user_id: "user_admin_1",
                session_status: "active",
                created_at: new Date(Date.now() - 3_600_000),
                expires_at: new Date(Date.now() + 60_000),
                user_status: "active",
                user_role: "admin"
              }
            ]
          };
        }

        if (sql.includes("update sessions")) {
          return { rows: [] };
        }

        if (sql.includes("from schema_migrations")) {
          return { rows: [{ latest: "202605290001_runtime_identity.sql", count: 12 }] };
        }

        if (sql.includes("from accounts") && sql.includes("platform_treasury")) {
          return { rows: [] };
        }

        if (sql.includes("to_regclass('public.user_faucet_state')")) {
          return {
            rows: [{ user_faucet_state_exists: true, faucet_claims_exists: true }]
          };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/health/diagnostics`, {
      headers: { cookie: "navi_session=live" }
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.runtime.economy).toMatchObject({
      status: "bad",
      platformTreasury: {
        verdict: "missing"
      }
    });
  });
});
