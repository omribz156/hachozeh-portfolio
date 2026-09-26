import { createServer, type AddressInfo, type Server as TcpServer } from "node:net";
import { describe, expect, it } from "vitest";
import type { Pool } from "pg";

import { createFastifyApp, sanitizeRequestLogPath } from "./fastify-app";
import { createLogger } from "../shared/logger";
import type { AppEnv } from "../config/env";
import { createInMemoryRateLimiter } from "./rate-limit";
import { createMarketStreamBus } from "./market-stream-bus";
import { createPortfolioStreamBus } from "./portfolio-stream-bus";
import { createDiscoveryStreamLimiter } from "./discovery-stream-limiter";
import { createStreamConnectionLimiter } from "./stream-connection-limiter";

const env: AppEnv = {
  serviceName: "navi-backend-test",
  nodeEnv: "test",
  deployEnv: "development",
  host: "127.0.0.1",
  port: 3001,
  logLevel: "error",
  auth: {
    sessionCookieName: "navi_session",
    sessionTtlHours: 24,
    sessionAbsoluteTtlHours: 24 * 90,
    otpTtlMinutes: 10,
    otpResendCooldownSeconds: 30,
    otpMaxAttempts: 5,
    devOtpCode: "111111",
    devOtpExposed: true
  },
  mail: {
    resendApiKey: "",
    from: "Hachozeh <noreply@email.hachozeh.com>"
  },
  googleAuth: {
    clientId: "",
    clientSecret: "",
    redirectUri: "http://127.0.0.1:3001/api/auth/google/callback",
    stateSecret: ""
  },
  actorMode: {
    demoEnabled: false,
    demoActorId: "seed_user_1"
  },
  trading: {
    requireSession: false
  },
  publicBaseUrl: "http://127.0.0.1:6969/trending",
  db: {
    host: "127.0.0.1",
    port: 55432,
    name: "navi_test",
    user: "navi",
    password: "navi",
    connectTimeoutMs: 10000,
    statementTimeoutMs: 30000,
    queryTimeoutMs: 35000,
    lockTimeoutMs: 10000,
    idleInTransactionSessionTimeoutMs: 60000,
    poolMax: 30
  }
};

function createDbPool(rows: unknown[]): Pool {
  return {
    query: async () => ({ rows })
  } as unknown as Pool;
}

function createSessionDbPool(): Pool {
  return {
    query: async (sql: string) => {
      if (sql.includes("from sessions s")) {
        return {
          rows: [
            {
              session_id: "session_stream_1",
              user_id: "user_stream_1",
              session_status: "active",
              created_at: new Date(Date.now() - 3_600_000),
              last_seen_at: new Date(),
              expires_at: new Date(Date.now() + 60_000),
              user_status: "active",
              user_role: "user"
            }
          ]
        };
      }

      return { rows: [], rowCount: 0 };
    }
  } as unknown as Pool;
}

function createMarketPriceRows() {
  return [
    {
      market_id: "market_seed_next_prime_minister",
      market_status: "open",
      title: "מי יהיה ראש הממשלה הבא?",
      description: "שוק backend",
      category_key: "politics",
      open_at: new Date("2026-03-01T08:00:00.000Z"),
      close_at: new Date("2026-06-22T18:00:00.000Z"),
      published_at: new Date("2026-03-01T09:00:00.000Z"),
      updated_at: new Date("2026-03-29T09:00:00.000Z"),
      market_state_version: "12",
      liquidity_b: "100.00000000",
      outcome_count: 2,
      total_volume: "38.000000",
      outcome_id: "market_seed_next_prime_minister_outcome_option_a",
      outcome_label: "מועמד א'",
      outcome_short_label: "מועמד א'",
      q_shares: "10.000000",
      sort_order: 0,
      last_price: "0.61000000"
    },
    {
      market_id: "market_seed_next_prime_minister",
      market_status: "open",
      title: "מי יהיה ראש הממשלה הבא?",
      description: "שוק backend",
      category_key: "politics",
      open_at: new Date("2026-03-01T08:00:00.000Z"),
      close_at: new Date("2026-06-22T18:00:00.000Z"),
      published_at: new Date("2026-03-01T09:00:00.000Z"),
      updated_at: new Date("2026-03-29T09:00:00.000Z"),
      market_state_version: "12",
      liquidity_b: "100.00000000",
      outcome_count: 2,
      total_volume: "38.000000",
      outcome_id: "market_seed_next_prime_minister_outcome_option_b",
      outcome_label: "מועמד ב'",
      outcome_short_label: "מועמד ב'",
      q_shares: "0.000000",
      sort_order: 1,
      last_price: "0.39000000"
    }
  ];
}

function createDiagnosticsDbPool(): Pool {
  return {
    query: async (sql: string) => {
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

      if (sql.includes("from oracle_runtime_snapshots")) {
        return { rows: [] };
      }

      if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
        return { rows: [], rowCount: 0 };
      }

      throw new Error(`Unexpected diagnostics query: ${sql}`);
    }
  } as unknown as Pool;
}

async function openMockDbServer(): Promise<{
  close: () => Promise<void>;
  port: number;
}> {
  return new Promise((resolve, reject) => {
    const mockDbServer: TcpServer = createServer();
    mockDbServer.once("error", reject);
    mockDbServer.listen(0, "127.0.0.1", () => {
      const address = mockDbServer.address();
      if (!address || typeof address === "string") {
        reject(new Error("Mock DB server did not return a socket address"));
        return;
      }

      resolve({
        port: (address as AddressInfo).port,
        close: () => new Promise((resolveClose, rejectClose) => {
          mockDbServer.close((error) => {
            if (error) {
              rejectClose(error);
              return;
            }

            resolveClose();
          });
        })
      });
    });
  });
}

function createReadinessEnv(port: number, connectTimeoutMs = 10000): AppEnv {
  return {
    ...env,
    db: {
      ...env.db,
      port,
      connectTimeoutMs
    }
  };
}

describe("createFastifyApp", () => {
  it("redacts uploaded object names from request log paths", () => {
    expect(
      sanitizeRequestLogPath("/api/uploads/avatars/avatar-a4eafb73-050f-4472-b236-77667ebc01be.webp")
    ).toBe("/api/uploads/avatars/:fileName");
    expect(sanitizeRequestLogPath("/api/uploads/feedback/feedback-2026-06-29.png")).toBe(
      "/api/uploads/feedback/:fileName"
    );
    expect(sanitizeRequestLogPath("/api/markets/next-prime-minister/history")).toBe(
      "/api/markets/next-prime-minister/history"
    );
  });

  it("serves liveness through Fastify", async () => {
    const app = createFastifyApp({
      env,
      logger: createLogger("error"),
      dbPool: createDbPool([]),
    });

    const response = await app.inject({
      method: "GET",
      url: "/health/live",
      headers: {
        "x-request-id": "req_test_1"
      }
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-request-id"]).toBe("req_test_1");
    expect(response.headers["x-fastify-proof"]).toBeUndefined();
    expect(response.json()).toMatchObject({
      service: "navi-backend-test",
      status: "ok",
      environment: "test"
    });
  });

  it("does not reflect control characters from client request ids", async () => {
    const app = createFastifyApp({
      env,
      logger: createLogger("error"),
      dbPool: createDbPool([]),
    });

    const response = await app.inject({
      method: "GET",
      url: "/health/live",
      headers: {
        "x-request-id": "req_ok\nx-forged: 1"
      }
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-request-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it("ports readiness on /health and /health/ready with status-aware compatibility", async () => {
    const mockDb = await openMockDbServer();
    const app = createFastifyApp({
      env: createReadinessEnv(mockDb.port),
      logger: createLogger("error"),
      dbPool: createDbPool([]),
    });

    try {
      const paths = ["/health", "/health/ready"];
      for (const path of paths) {
        const response = await app.inject({
          method: "GET",
          url: path,
          headers: {
            "x-request-id": "req_ready_1"
          }
        });

        expect(response.statusCode).toBe(200);
        expect(response.headers["x-request-id"]).toBe("req_ready_1");
        expect(response.headers["access-control-allow-origin"]).toBe("*");
        expect(response.headers["access-control-allow-headers"]).toBe("content-type,x-request-id");
        expect(response.headers["access-control-allow-methods"]).toBe(
          "GET,POST,PUT,PATCH,DELETE,OPTIONS"
        );
        expect(response.headers["access-control-max-age"]).toBe("600");
        expect(response.json()).toMatchObject({
          service: "navi-backend-test",
          status: "ready",
          dependencies: {
            postgres: {
              ok: true
            }
          }
        });
      }
    } finally {
      await app.close();
      await mockDb.close();
    }
  });

  it("returns 503 for /health when DB is not ready", async () => {
    const app = createFastifyApp({
      env: createReadinessEnv(1, 5),
      logger: createLogger("error"),
      dbPool: createDbPool([])
    });

    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: {
        "x-request-id": "req_not_ready_1"
      }
    });

    await app.close();

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      service: "navi-backend-test",
      status: "not_ready",
      dependencies: {
        postgres: {
          ok: false
        }
      }
    });
  });

  it("ports authenticated diagnostics through Fastify", async () => {
    const discoveryStreamLimiter = createDiscoveryStreamLimiter();

    discoveryStreamLimiter.addConnection("breaking:all");

    const app = createFastifyApp({
      env,
      logger: createLogger("error"),
      dbPool: createDiagnosticsDbPool(),
      discoveryStreamLimiter
    });

    const response = await app.inject({
      method: "GET",
      url: "/health/diagnostics",
      headers: {
        cookie: "navi_session=live",
        "x-request-id": "req_diagnostics_1"
      }
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-request-id"]).toBe("req_diagnostics_1");
    expect(response.headers["x-fastify-proof"]).toBeUndefined();
    expect(response.json()).toMatchObject({
      service: "navi-backend-test",
      status: "ok",
      streams: {
        discovery: {
          feeds: 1,
          connections: 1
        },
        clients: {
          clients: 0,
          connections: 0
        }
      },
      runtime: {
        migration: {
          status: "ok",
          latest: "202605290001_runtime_identity.sql",
          count: 12
        }
      }
    });
  });

  it("ports the live-count read route", async () => {
    const app = createFastifyApp({
      env,
      logger: createLogger("error"),
      dbPool: createDbPool([{ count: "7" }]),
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/markets/live-count"
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-fastify-proof"]).toBeUndefined();
    expect(response.json()).toMatchObject({
      count: 7
    });
  });

  it("ports search reads through Fastify", async () => {
    const app = createFastifyApp({
      env,
      logger: createLogger("error"),
      dbPool: createDbPool([]),
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/search?q=${encodeURIComponent("ב")}&kind=all`
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-fastify-proof"]).toBeUndefined();
    expect(response.json()).toMatchObject({
      query: "ב",
      kind: "all",
      results: [],
      markets: [],
      profiles: [],
      pagination: {
        limit: 8,
        hasMore: false
      }
    });
  });

  it("ports public profile catalog reads through Fastify", async () => {
    const app = createFastifyApp({
      env,
      logger: createLogger("error"),
      dbPool: createDbPool([
        {
          handle: "alice",
          display_name: "אליס",
          updated_at: new Date("2026-06-23T10:00:00.000Z"),
          created_at: new Date("2026-06-01T10:00:00.000Z")
        }
      ]),
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/social/profiles?limit=1"
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-fastify-proof"]).toBeUndefined();
    expect(response.json()).toMatchObject({
      profiles: [
        {
          handle: "alice",
          displayName: "אליס",
          updatedAt: "2026-06-23T10:00:00.000Z"
        }
      ],
      pagination: {
        limit: 1,
        nextCursor: null
      }
    });
  });

  it("applies route-family rate limits inside Fastify", async () => {
    const app = createFastifyApp({
      env,
      logger: createLogger("error"),
      dbPool: createDbPool([]),
      rateLimiter: createInMemoryRateLimiter({
        market_read: {
          limit: 1,
          windowMs: 60_000
        }
      })
    });

    const firstResponse = await app.inject({
      method: "GET",
      url: "/api/markets?limit=1"
    });
    const secondResponse = await app.inject({
      method: "GET",
      url: "/api/markets?limit=1"
    });

    await app.close();

    expect(firstResponse.statusCode).toBe(200);
    expect(secondResponse.statusCode).toBe(429);
    expect(secondResponse.headers["x-fastify-proof"]).toBeUndefined();
    expect(secondResponse.headers["x-rate-limit-family"]).toBe("market_read");
    expect(secondResponse.headers["x-rate-limit-limit"]).toBe("1");
    expect(secondResponse.headers["x-rate-limit-remaining"]).toBe("0");
    expect(secondResponse.headers["retry-after"]).toBeTruthy();
    expect(secondResponse.json()).toMatchObject({
      error: {
        code: "rate_limited",
        message: "Too many requests for this route family."
      },
      family: "market_read"
    });
  });

  it("maps unknown routes to the existing not_found envelope", async () => {
    const app = createFastifyApp({
      env,
      logger: createLogger("error"),
      dbPool: createDbPool([]),
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/nope",
      headers: {
        "x-request-id": "req_fastify_not_found_1"
      }
    });

    await app.close();

    expect(response.statusCode).toBe(404);
    expect(response.headers["x-request-id"]).toBe("req_fastify_not_found_1");
    expect(response.headers["x-fastify-proof"]).toBeUndefined();
    expect(response.json()).toEqual({
      error: {
        code: "not_found",
        message: "Route not found"
      },
      requestId: "req_fastify_not_found_1"
    });
  });

  it("ports one-shot market streams through Fastify as server-sent events", async () => {
    const app = createFastifyApp({
      env,
      logger: createLogger("error"),
      dbPool: createDbPool(createMarketPriceRows()),
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/markets/next-prime-minister/stream?once=1",
      headers: {
        "x-request-id": "req_fastify_market_stream_1"
      }
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-request-id"]).toBe("req_fastify_market_stream_1");
    expect(response.headers["x-fastify-proof"]).toBeUndefined();
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.headers["cache-control"]).toBe("no-cache, no-transform");
    expect(response.payload).toContain("event: market.snapshot");
    expect(response.payload).toContain('"marketKey":"next-prime-minister"');
    expect(response.payload).toContain('"eventType":"snapshot"');
  });

  it("rejects market streams when the stream bus is saturated", async () => {
    const app = createFastifyApp({
      env,
      logger: createLogger("error"),
      dbPool: createDbPool(createMarketPriceRows()),
      marketStreamBus: createMarketStreamBus({
        maxTotalConnections: 0
      })
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/markets/next-prime-minister/stream",
      headers: {
        "x-request-id": "req_fastify_market_stream_limit_1"
      }
    });

    await app.close();

    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({
      error: {
        code: "stream_limit_exceeded"
      }
    });
  });

  it("rejects long-lived market streams when the shared client stream cap is saturated", async () => {
    const app = createFastifyApp({
      env,
      logger: createLogger("error"),
      dbPool: {
        query: async () => {
          throw new Error("market stream client cap should reject before DB work");
        }
      } as unknown as Pool,
      streamConnectionLimiter: createStreamConnectionLimiter({
        maxTotalConnections: 0
      })
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/markets/next-prime-minister/stream",
      headers: {
        "x-request-id": "req_fastify_market_client_stream_limit_1"
      }
    });

    await app.close();

    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({
      error: {
        code: "stream_limit_exceeded"
      }
    });
  });

  it("serves one-shot private portfolio streams for real sessions only", async () => {
    const app = createFastifyApp({
      env,
      logger: createLogger("error"),
      dbPool: createSessionDbPool(),
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/portfolio/stream?once=1",
      headers: {
        "x-request-id": "req_fastify_portfolio_stream_1",
        cookie: "navi_session=session_stream_token"
      }
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-request-id"]).toBe("req_fastify_portfolio_stream_1");
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.headers["cache-control"]).toBe("no-cache, no-transform");
    expect(response.payload).toContain("event: portfolio.ready");
    expect(response.payload).toContain('"eventType":"portfolio.ready"');
  });

  it("rejects private portfolio streams when the stream bus is saturated", async () => {
    const app = createFastifyApp({
      env,
      logger: createLogger("error"),
      dbPool: createSessionDbPool(),
      portfolioStreamBus: createPortfolioStreamBus({
        maxTotalConnections: 0
      })
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/portfolio/stream",
      headers: {
        "x-request-id": "req_fastify_portfolio_stream_limit_1",
        cookie: "navi_session=session_stream_token"
      }
    });

    await app.close();

    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({
      error: {
        code: "stream_limit_exceeded"
      }
    });
  });

  it("rejects private portfolio streams when the shared client stream cap is saturated", async () => {
    const app = createFastifyApp({
      env,
      logger: createLogger("error"),
      dbPool: createSessionDbPool(),
      streamConnectionLimiter: createStreamConnectionLimiter({
        maxTotalConnections: 0
      })
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/portfolio/stream",
      headers: {
        "x-request-id": "req_fastify_portfolio_client_stream_limit_1",
        cookie: "navi_session=session_stream_token"
      }
    });

    await app.close();

    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({
      error: {
        code: "stream_limit_exceeded"
      }
    });
  });

  it("rejects anonymous portfolio streams instead of falling back to demo", async () => {
    const app = createFastifyApp({
      env: {
        ...env,
        actorMode: {
          demoEnabled: true,
          demoActorId: "seed_user_1"
        }
      },
      logger: createLogger("error"),
      dbPool: createDbPool([]),
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/portfolio/stream?once=1",
      headers: {
        "x-request-id": "req_fastify_portfolio_stream_anon_1"
      }
    });

    await app.close();

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: {
        code: "unauthorized"
      }
    });
  });

  it("marks private portfolio reads as no-store even when unauthorized", async () => {
    const app = createFastifyApp({
      env: {
        ...env,
        trading: {
          requireSession: true
        }
      },
      logger: createLogger("error"),
      dbPool: createDbPool([]),
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/portfolio/snapshot",
      headers: {
        "x-request-id": "req_fastify_portfolio_cache_1"
      }
    });

    await app.close();

    expect(response.statusCode).toBe(401);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      error: {
        code: "unauthorized"
      }
    });
  });

  it("ports discovery feed reads through Fastify", async () => {
    const app = createFastifyApp({
      env,
      logger: createLogger("error"),
      dbPool: createDbPool([]),
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/discovery/feed?feed=trending",
      headers: {
        "x-request-id": "req_discovery_1"
      }
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-request-id"]).toBe("req_discovery_1");
    expect(response.headers["x-fastify-proof"]).toBeUndefined();
    expect(response.json()).toMatchObject({
      feed: "trending",
      category: null,
      featured: null,
      items: []
    });
  });

  it("paginates empty discovery feed reads when requested", async () => {
    const app = createFastifyApp({
      env,
      logger: createLogger("error"),
      dbPool: createDbPool([]),
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/discovery/feed?feed=trending&limit=16",
      headers: {
        "x-request-id": "req_discovery_page_1"
      }
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      feed: "trending",
      category: null,
      featured: null,
      items: [],
      pagination: {
        limit: 16,
        nextCursor: null,
        hasMore: false,
        totalAvailable: 0
      }
    });
  });

  it("serves one-shot discovery feed streams through Fastify", async () => {
    const app = createFastifyApp({
      env,
      logger: createLogger("error"),
      dbPool: createDbPool([]),
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/discovery/feed/stream?feed=breaking&once=1",
      headers: {
        "x-request-id": "req_discovery_stream_1"
      }
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-request-id"]).toBe("req_discovery_stream_1");
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.headers["cache-control"]).toBe("no-cache, no-transform");
    expect(response.payload).toContain("event: discovery.feed_snapshot");
    expect(response.payload).toContain('"eventType":"feed_snapshot"');
    expect(response.payload).toContain('"feed":"breaking"');
  });

  it("rejects discovery feed streams when the stream limiter is saturated", async () => {
    const app = createFastifyApp({
      env,
      logger: createLogger("error"),
      dbPool: createDbPool([]),
      discoveryStreamLimiter: createDiscoveryStreamLimiter({
        maxTotalConnections: 0
      })
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/discovery/feed/stream?feed=breaking",
      headers: {
        "x-request-id": "req_discovery_stream_limit_1"
      }
    });

    await app.close();

    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({
      error: {
        code: "stream_limit_exceeded"
      }
    });
  });

  it("rejects discovery feed streams when the shared client stream cap is saturated", async () => {
    const app = createFastifyApp({
      env,
      logger: createLogger("error"),
      dbPool: createDbPool([]),
      streamConnectionLimiter: createStreamConnectionLimiter({
        maxTotalConnections: 0
      })
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/discovery/feed/stream?feed=breaking",
      headers: {
        "x-request-id": "req_discovery_client_stream_limit_1"
      }
    });

    await app.close();

    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({
      error: {
        code: "stream_limit_exceeded"
      }
    });
  });

  it("uses bounded canonical keys for discovery stream limiting", async () => {
    const seenKeys: string[] = [];
    const app = createFastifyApp({
      env,
      logger: createLogger("error"),
      dbPool: createDbPool([]),
      discoveryStreamLimiter: {
        canAcceptConnection(feedKey) {
          seenKeys.push(feedKey);
          return false;
        },
        addConnection() {
          throw new Error("Unexpected stream connection in rejected test.");
        },
        getStats() {
          return {
            feeds: 0,
            connections: 0
          };
        }
      }
    });

    const unknownResponse = await app.inject({
      method: "GET",
      url: "/api/discovery/feed/stream?feed=attacker-feed&category=attacker-category"
    });
    const knownAliasResponse = await app.inject({
      method: "GET",
      url: "/api/discovery/feed/stream?feed=breaking&category=economics"
    });

    await app.close();

    expect(unknownResponse.statusCode).toBe(429);
    expect(knownAliasResponse.statusCode).toBe(429);
    expect(seenKeys).toEqual(["trending:unknown", "breaking:economy"]);
  });

  it("ports market-detail reads through Fastify with the existing error envelope", async () => {
    const app = createFastifyApp({
      env,
      logger: createLogger("error"),
      dbPool: createDbPool([]),
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/market-detail/markets/nope-nope",
      headers: {
        "x-request-id": "req_market_detail_1"
      }
    });

    await app.close();

    expect(response.statusCode).toBe(404);
    expect(response.headers["x-request-id"]).toBe("req_market_detail_1");
    expect(response.headers["x-fastify-proof"]).toBeUndefined();
    expect(response.json()).toMatchObject({
      error: {
        code: "market_detail_not_found",
        message: "Market detail market not found."
      },
      marketKey: "nope-nope",
      requestId: "req_market_detail_1"
    });
  });

  it("ports event-slug market-detail targets through Fastify with the existing error envelope", async () => {
    const app = createFastifyApp({
      env,
      logger: createLogger("error"),
      dbPool: createDbPool([]),
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/market-detail/events/missing-event",
      headers: {
        "x-request-id": "req_market_detail_event_1"
      }
    });

    await app.close();

    expect(response.statusCode).toBe(404);
    expect(response.headers["x-request-id"]).toBe("req_market_detail_event_1");
    expect(response.headers["x-fastify-proof"]).toBeUndefined();
    expect(response.json()).toMatchObject({
      error: {
        code: "market_detail_event_not_found",
        message: "Market detail event not found."
      },
      eventSlug: "missing-event",
      requestId: "req_market_detail_event_1"
    });
  });

  it("ports portfolio reads through Fastify with auth parity", async () => {
    const app = createFastifyApp({
      env: {
        ...env,
        trading: {
          requireSession: true
        }
      },
      logger: createLogger("error"),
      dbPool: createDbPool([]),
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/portfolio/snapshot",
      headers: {
        "x-request-id": "req_portfolio_1"
      }
    });

    await app.close();

    expect(response.statusCode).toBe(401);
    expect(response.headers["x-request-id"]).toBe("req_portfolio_1");
    expect(response.headers["x-fastify-proof"]).toBeUndefined();
    expect(response.json()).toEqual({
      error: {
        code: "unauthorized",
        message: "Authentication is required."
      }
    });
  });

  it("ports portfolio claim preflight through Fastify", async () => {
    const app = createFastifyApp({
      env,
      logger: createLogger("error"),
      dbPool: createDbPool([]),
    });

    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/portfolio/claims/claim_1/claim",
      headers: {
        origin: "http://127.0.0.1:6969",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
        "x-request-id": "req_portfolio_preflight_1"
      }
    });

    await app.close();

    expect(response.statusCode).toBe(204);
    expect(response.headers["x-request-id"]).toBe("req_portfolio_preflight_1");
    expect(response.headers["x-fastify-proof"]).toBeUndefined();
    expect(response.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:6969");
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    expect(response.headers["access-control-allow-methods"]).toContain("POST");
  });

  it("allows the prod-faithful local SSR origin to start auth", async () => {
    const app = createFastifyApp({
      env,
      logger: createLogger("error"),
      dbPool: createDbPool([]),
    });

    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/auth/start",
      headers: {
        origin: "http://127.0.0.1:4321",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
        "x-request-id": "req_auth_start_preflight_4321"
      }
    });

    await app.close();

    expect(response.statusCode).toBe(204);
    expect(response.headers["x-request-id"]).toBe("req_auth_start_preflight_4321");
    expect(response.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:4321");
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    expect(response.headers["access-control-allow-methods"]).toContain("POST");
  });

  it("ports trade quote auth errors through Fastify", async () => {
    const app = createFastifyApp({
      env: {
        ...env,
        trading: {
          requireSession: true
        }
      },
      logger: createLogger("error"),
      dbPool: createDbPool([]),
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/markets/test-market/quote",
      payload: {
        side: "buy",
        contractSide: "yes",
        outcomeKey: "option-a",
        cashAmount: "1.00"
      },
      headers: {
        "x-request-id": "req_quote_1"
      }
    });

    await app.close();

    expect(response.statusCode).toBe(401);
    expect(response.headers["x-request-id"]).toBe("req_quote_1");
    expect(response.headers["x-fastify-proof"]).toBeUndefined();
    expect(response.json()).toEqual({
      error: {
        code: "unauthorized",
        message: "Authentication is required."
      }
    });
  });

  it("ports trade write preflight through Fastify", async () => {
    const app = createFastifyApp({
      env,
      logger: createLogger("error"),
      dbPool: createDbPool([]),
    });

    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/markets/test-market/trades",
      headers: {
        origin: "http://127.0.0.1:6969",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
        "x-request-id": "req_trade_preflight_1"
      }
    });

    await app.close();

    expect(response.statusCode).toBe(204);
    expect(response.headers["x-request-id"]).toBe("req_trade_preflight_1");
    expect(response.headers["x-fastify-proof"]).toBeUndefined();
    expect(response.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:6969");
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    expect(response.headers["access-control-allow-methods"]).toContain("POST");
  });

  it("ports auth start as a write route using the Zod parser proof", async () => {
    const app = createFastifyApp({
      env,
      logger: createLogger("error"),
      dbPool: createDbPool([]),
      startAuthChallenge: async (_db, _env, body) => ({
        challengeId: "otp_test",
        purpose: (body as { purpose: "login" }).purpose,
        channel: "email",
        identifierHint: "us***@e***.com",
        expiresAt: "2026-06-11T00:00:00.000Z",
        nextStep: "otp",
        devCode: "111111"
      })
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/start",
      payload: {
        identifier: " USER@example.com ",
        purpose: "login"
      }
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-fastify-proof"]).toBeUndefined();
    expect(response.json()).toMatchObject({
      challengeId: "otp_test",
      purpose: "login",
      nextStep: "otp"
    });
  });

  it("maps Zod parser errors into the existing API error envelope", async () => {
    const app = createFastifyApp({
      env,
      logger: createLogger("error"),
      dbPool: createDbPool([]),
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/start",
      payload: {
        identifier: "user@example.com",
        purpose: "reset"
      }
    });

    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: {
        code: "invalid_request",
        message: "purpose must be login or signup."
      }
    });
  });

  it("maps empty JSON parser errors into the existing API error envelope", async () => {
    const app = createFastifyApp({
      env,
      logger: createLogger("error"),
      dbPool: createDbPool([]),
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/start",
      headers: {
        "content-type": "application/json"
      },
      payload: ""
    });

    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: {
        code: "invalid_request",
        message: "JSON body is required"
      }
    });
  });

  it("ports admin user read auth errors through Fastify", async () => {
    const app = createFastifyApp({
      env,
      logger: createLogger("error"),
      dbPool: createDbPool([]),
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/users/user_target_1",
      headers: {
        "x-request-id": "req_fastify_admin_user_read_1"
      }
    });

    await app.close();

    expect(response.statusCode).toBe(401);
    expect(response.headers["x-fastify-proof"]).toBeUndefined();
    expect(response.headers["x-request-id"]).toBe("req_fastify_admin_user_read_1");
    expect(response.json()).toEqual({
      error: {
        code: "unauthorized",
        message: "Authentication is required."
      }
    });
  });

  it("ports admin user mutation preflight through Fastify", async () => {
    const app = createFastifyApp({
      env,
      logger: createLogger("error"),
      dbPool: createDbPool([]),
    });

    const response = await app.inject({
      method: "OPTIONS",
      url: "/admin/users/user_target_1/reverse-starter-grant",
      headers: {
        origin: "https://hachozeh.com",
        "access-control-request-headers": "content-type,x-request-id"
      }
    });

    await app.close();

    expect(response.statusCode).toBe(204);
    expect(response.headers["x-fastify-proof"]).toBeUndefined();
    expect(response.headers["access-control-allow-origin"]).toBe("https://hachozeh.com");
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("ports admin market create auth errors through Fastify", async () => {
    const app = createFastifyApp({
      env,
      logger: createLogger("error"),
      dbPool: createDbPool([]),
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/markets",
      headers: {
        "x-request-id": "req_fastify_admin_market_create_1"
      },
      payload: {
        title: "Admin-created market"
      }
    });

    await app.close();

    expect(response.statusCode).toBe(401);
    expect(response.headers["x-fastify-proof"]).toBeUndefined();
    expect(response.headers["x-request-id"]).toBe("req_fastify_admin_market_create_1");
    expect(response.json()).toEqual({
      error: {
        code: "unauthorized",
        message: "Authentication is required."
      }
    });
  });

  it("clears stale admin market lifecycle sessions through Fastify", async () => {
    const app = createFastifyApp({
      env,
      logger: createLogger("error"),
      dbPool: createDbPool([]),
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/markets",
      headers: {
        cookie: "navi_session=stale",
        "x-request-id": "req_fastify_admin_market_stale_1"
      },
      payload: {
        title: "Admin-created market"
      }
    });

    await app.close();

    expect(response.statusCode).toBe(401);
    expect(response.headers["x-fastify-proof"]).toBeUndefined();
    expect(response.headers["x-request-id"]).toBe("req_fastify_admin_market_stale_1");
    expect(response.headers["set-cookie"]).toContain("navi_session=");
    expect(response.headers["set-cookie"]).toContain("Max-Age=0");
    expect(response.json()).toEqual({
      error: {
        code: "unauthorized",
        message: "Session is invalid or expired."
      }
    });
  });

  it("ports admin market lifecycle preflight through Fastify", async () => {
    const app = createFastifyApp({
      env,
      logger: createLogger("error"),
      dbPool: createDbPool([]),
    });

    const response = await app.inject({
      method: "OPTIONS",
      url: "/admin/markets/market_route_1/resolve",
      headers: {
        origin: "https://hachozeh.com",
        "access-control-request-headers": "content-type,x-request-id"
      }
    });

    await app.close();

    expect(response.statusCode).toBe(204);
    expect(response.headers["x-fastify-proof"]).toBeUndefined();
    expect(response.headers["access-control-allow-origin"]).toBe("https://hachozeh.com");
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("ports admin Oracle review queue auth errors through Fastify", async () => {
    const app = createFastifyApp({
      env,
      logger: createLogger("error"),
      dbPool: createDbPool([]),
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/oracle/review-queue",
      headers: {
        "x-request-id": "req_fastify_admin_oracle_review_queue_1"
      }
    });

    await app.close();

    expect(response.statusCode).toBe(401);
    expect(response.headers["x-fastify-proof"]).toBeUndefined();
    expect(response.headers["x-request-id"]).toBe("req_fastify_admin_oracle_review_queue_1");
    expect(response.json()).toEqual({
      error: {
        code: "unauthorized",
        message: "Authentication is required."
      }
    });
  });

  it("ports admin Oracle mutation preflight through Fastify", async () => {
    const app = createFastifyApp({
      env,
      logger: createLogger("error"),
      dbPool: createDbPool([]),
    });

    const response = await app.inject({
      method: "OPTIONS",
      url: "/admin/oracle/review-action",
      headers: {
        origin: "https://hachozeh.com",
        "access-control-request-headers": "content-type,x-request-id"
      }
    });

    await app.close();

    expect(response.statusCode).toBe(204);
    expect(response.headers["x-fastify-proof"]).toBeUndefined();
    expect(response.headers["access-control-allow-origin"]).toBe("https://hachozeh.com");
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("clears stale admin Oracle mutation sessions through Fastify", async () => {
    const app = createFastifyApp({
      env,
      logger: createLogger("error"),
      dbPool: createDbPool([]),
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/oracle/review-action",
      headers: {
        cookie: "navi_session=stale",
        "x-request-id": "req_fastify_admin_oracle_stale_1"
      },
      payload: {}
    });

    await app.close();

    expect(response.statusCode).toBe(401);
    expect(response.headers["x-fastify-proof"]).toBeUndefined();
    expect(response.headers["x-request-id"]).toBe("req_fastify_admin_oracle_stale_1");
    expect(response.headers["set-cookie"]).toContain("navi_session=");
    expect(response.headers["set-cookie"]).toContain("Max-Age=0");
    expect(response.json()).toEqual({
      error: {
        code: "unauthorized",
        message: "Session is invalid or expired."
      }
    });
  });
});
