import { afterEach, describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { access, readFile } from "node:fs/promises";
import { createServer, type AddressInfo, type Server as TcpServer } from "node:net";
import type { Server } from "node:http";
import { join } from "node:path";
import type { Pool } from "pg";

import {
  closeFastifyAppOnServerClose,
  createAppServer
} from "./app";
import {
  createLogger,
  Logger
} from "../shared/logger";
import { createMarketStreamBus } from "./market-stream-bus";
import type { AppEnv } from "../config/env";

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

let server: Server | null = null;

async function readHttpSource(fileName: string): Promise<string> {
  try {
    return await readFile(join(process.cwd(), "src", "http", fileName), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    return readFile(join(process.cwd(), "systems", "back", "src", "http", fileName), "utf8");
  }
}

async function httpSourceExists(fileName: string): Promise<boolean> {
  try {
    await access(join(process.cwd(), "src", "http", fileName));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  try {
    await access(join(process.cwd(), "systems", "back", "src", "http", fileName));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    return false;
  }
}

type CapturedLogRecord = {
  message: string;
  requestId?: unknown;
};

class CapturingLogger extends Logger {
  constructor(
    private readonly records: CapturedLogRecord[],
    private readonly testBindings: Record<string, unknown> = {}
  ) {
    super("info");
  }

  override child(bindings: Record<string, unknown>): Logger {
    return new CapturingLogger(this.records, {
      ...this.testBindings,
      ...bindings
    });
  }

  override info(message: string, context: Record<string, unknown> = {}): void {
    this.records.push({
      message,
      ...this.testBindings,
      ...context
    });
  }
}

afterEach(async () => {
  if (!server) {
    return;
  }

  await closeServer(server);
  server = null;
});

async function closeServer(serverToClose: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    serverToClose.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function createDbPool(): Pool {
  return {
    query: async () => ({ rows: [] })
  } as unknown as Pool;
}

function createMarketStreamDbPool(): Pool {
  return {
    query: async (sql: string, values?: unknown[]) => {
      if (sql.includes("from markets m")) {
        expect(values?.[0]).toBe("market_seed_next_prime_minister");

        return {
          rowCount: 2,
          rows: [
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
          ]
        };
      }

      throw new Error(`Unexpected market stream query: ${sql}`);
    }
  } as unknown as Pool;
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

async function listen(serverToListen: Server): Promise<string> {
  await new Promise<void>((resolve) => {
    serverToListen.listen(0, "127.0.0.1", () => resolve());
  });
  const address = serverToListen.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function waitForMarketStreamStats(
  bus: ReturnType<typeof createMarketStreamBus>,
  expectedConnections: number
): Promise<void> {
  const deadline = Date.now() + 1_000;

  while (Date.now() < deadline) {
    if (bus.getStats().connections === expectedConnections) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  expect(bus.getStats().connections).toBe(expectedConnections);
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

describe("createAppServer Fastify server", () => {
  it("keeps the live Fastify app decommissioned from proof-stage scaffolding", async () => {
    const [appSource, fastifyAppSource, oldProofSourceExists] = await Promise.all([
      readHttpSource("app.ts"),
      readHttpSource("fastify-app.ts"),
      httpSourceExists("fastify-proof-app.ts")
    ]);

    expect(oldProofSourceExists).toBe(false);
    expect(appSource).toContain('from "./fastify-app"');
    expect(appSource).not.toContain("createFastifyProofApp");
    expect(fastifyAppSource).not.toContain("FastifyProof");
    expect(fastifyAppSource).not.toContain("proofHeader");
    expect(fastifyAppSource).not.toContain("x-fastify-proof");
  });

  it("closes the Fastify app when the server closes", async () => {
    const fakeServer = new EventEmitter() as Pick<Server, "once"> & EventEmitter;
    const closed = new Promise<void>((resolve) => {
      closeFastifyAppOnServerClose(
        fakeServer,
        {
          close: async () => resolve()
        },
        createLogger("error")
      );
    });

    fakeServer.emit("close");

    await closed;
  });

  it("serves and closes through the native Fastify server contract", async () => {
    server = createAppServer({
      env,
      logger: createLogger("error"),
      dbPool: createDbPool()
    });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/health/live`);
    const payload = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload["status"]).toBe("ok");

    await closeServer(server);
    server = null;
  });

  it("serves /health/live through Fastify without changing the public response contract", async () => {
    server = createAppServer({
      env,
      logger: createLogger("error"),
      dbPool: createDbPool()
    });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/health/live`, {
      headers: {
        "x-request-id": "req_strangler_1"
      }
    });
    const payload = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("req_strangler_1");
    expect(response.headers.get("x-fastify-proof")).toBeNull();
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-length")).toBeTruthy();
    expect(payload).toMatchObject({
      service: "navi-backend-test",
      status: "ok",
      environment: "test"
    });
    expect(typeof payload["uptimeMs"]).toBe("number");
    expect(typeof payload["now"]).toBe("string");
  });

  it("serves simple public read routes through Fastify without exposing the proof marker", async () => {
    server = createAppServer({
      env,
      logger: createLogger("error"),
      dbPool: createDbPool()
    });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/api/search?q=${encodeURIComponent("ב")}&kind=all`, {
      headers: {
        "x-request-id": "req_strangler_search_1"
      }
    });
    const payload = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("req_strangler_search_1");
    expect(response.headers.get("x-fastify-proof")).toBeNull();
    expect(payload).toMatchObject({
      query: "ב",
      kind: "all",
      results: [],
      markets: [],
      profiles: []
    });
  });

  it("serves one-shot market streams through Fastify without buffering live SSE routes", async () => {
    server = createAppServer({
      env,
      logger: createLogger("error"),
      dbPool: createMarketStreamDbPool()
    });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/api/markets/next-prime-minister/stream?once=1`, {
      headers: {
        "x-request-id": "req_strangler_market_stream_1"
      }
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("req_strangler_market_stream_1");
    expect(response.headers.get("x-fastify-proof")).toBeNull();
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(body).toContain("event: market.snapshot");
    expect(body).toContain('"marketKey":"next-prime-minister"');
    expect(body).toContain('"eventType":"snapshot"');
  });

  it("keeps generated request ids aligned between the raw shell and Fastify streams", async () => {
    const records: CapturedLogRecord[] = [];
    server = createAppServer({
      env,
      logger: new CapturingLogger(records),
      dbPool: createMarketStreamDbPool()
    });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/api/markets/next-prime-minister/stream?once=1`);
    await response.text();
    const completed = records.find((record) => record.message === "request.completed");

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(response.headers.get("x-request-id")).toBe(completed?.requestId);
  });

  it("cleans up long-lived Fastify market streams when the client closes", async () => {
    const marketStreamBus = createMarketStreamBus();
    const abortController = new AbortController();
    server = createAppServer({
      env,
      logger: createLogger("error"),
      dbPool: createMarketStreamDbPool(),
      marketStreamBus
    });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/api/markets/next-prime-minister/stream`, {
      signal: abortController.signal
    });
    const reader = response.body?.getReader();
    expect(reader).toBeTruthy();
    const firstChunk = await reader!.read();
    const firstFrame = new TextDecoder().decode(firstChunk.value);

    expect(response.status).toBe(200);
    expect(firstFrame).toContain("event: market.snapshot");
    await waitForMarketStreamStats(marketStreamBus, 1);

    abortController.abort();
    await waitForMarketStreamStats(marketStreamBus, 0);
  });

  it("serves /health and /health/ready through Fastify without changing the response contract", async () => {
    const mockDb = await openMockDbServer();
    server = createAppServer({
      env: {
        ...env,
        db: {
          ...env.db,
          port: mockDb.port
        }
      },
      logger: createLogger("error"),
      dbPool: createDbPool()
    });
    const baseUrl = await listen(server);

    try {
      const paths = ["/health", "/health/ready"];
      for (const path of paths) {
        const response = await fetch(`${baseUrl}${path}`, {
          headers: {
            "x-request-id": "req_strangler_readiness_1"
          }
        });
        const payload = await response.json() as Record<string, unknown>;

        expect(response.status).toBe(200);
        expect(response.headers.get("x-request-id")).toBe("req_strangler_readiness_1");
        expect(response.headers.get("x-fastify-proof")).toBeNull();
        expect(response.headers.get("access-control-allow-origin")).toBe("*");
        expect(response.headers.get("access-control-allow-headers")).toBe("content-type,x-request-id");
        expect(response.headers.get("access-control-allow-methods")).toBe(
          "GET,POST,PUT,PATCH,DELETE,OPTIONS"
        );
        expect(response.headers.get("access-control-max-age")).toBe("600");
        expect(response.headers.get("content-type")).toContain("application/json");
        expect(response.headers.get("content-length")).toBeTruthy();
        expect(payload["service"]).toBe("navi-backend-test");
        expect(payload["status"]).toBe("ready");
      }
    } finally {
      await mockDb.close();
    }
  });

  it("returns 503 for /health when DB is unavailable", async () => {
    server = createAppServer({
      env: {
        ...env,
        db: {
          ...env.db,
          port: 1,
          connectTimeoutMs: 5
        }
      },
      logger: createLogger("error"),
      dbPool: createDbPool()
    });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/health/ready`, {
      headers: {
        "x-request-id": "req_strangler_not_ready_1"
      }
    });
    const payload = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(response.headers.get("x-request-id")).toBe("req_strangler_not_ready_1");
    expect(payload["status"]).toBe("not_ready");
    const dependencies = payload["dependencies"] as Record<string, { ok: boolean }>;
    expect(dependencies?.postgres?.ok).toBe(false);
  });

  it("preserves allowed-origin credential CORS headers on migrated health routes", async () => {
    const mockDb = await openMockDbServer();
    server = createAppServer({
      env: {
        ...env,
        db: {
          ...env.db,
          port: mockDb.port
        }
      },
      logger: createLogger("error"),
      dbPool: createDbPool()
    });
    const baseUrl = await listen(server);

    try {
      const response = await fetch(`${baseUrl}/health/ready`, {
        headers: {
          origin: "https://hachozeh.com",
          "x-request-id": "req_strangler_cors_1"
        }
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe("https://hachozeh.com");
      expect(response.headers.get("access-control-allow-credentials")).toBe("true");
      expect(response.headers.get("vary")).toBe(
        "Origin, Access-Control-Request-Method, Access-Control-Request-Headers"
      );
      expect(response.headers.get("access-control-allow-headers")).toBe("content-type,x-request-id");
      expect(response.headers.get("access-control-allow-methods")).toBe(
        "GET,POST,PUT,PATCH,DELETE,OPTIONS"
      );
      expect(response.headers.get("access-control-max-age")).toBe("600");
    } finally {
      await mockDb.close();
    }
  });

  it("serves /health/diagnostics through Fastify without changing the public response contract", async () => {
    server = createAppServer({
      env,
      logger: createLogger("error"),
      dbPool: createDiagnosticsDbPool()
    });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/health/diagnostics`, {
      headers: {
        cookie: "navi_session=live",
        "x-request-id": "req_strangler_diagnostics_1"
      }
    });
    const payload = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("req_strangler_diagnostics_1");
    expect(response.headers.get("x-fastify-proof")).toBeNull();
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(payload).toMatchObject({
      service: "navi-backend-test",
      status: "ok",
      runtime: {
        migration: {
          status: "ok",
          latest: "202605290001_runtime_identity.sql",
          count: 12
        }
      }
    });
  });

  it("preserves unauthorized diagnostics errors through the Fastify route", async () => {
    server = createAppServer({
      env,
      logger: createLogger("error"),
      dbPool: createDbPool()
    });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/health/diagnostics`, {
      headers: {
        "x-request-id": "req_strangler_diagnostics_unauthorized_1"
      }
    });
    const payload = await response.json() as Record<string, { code: string }>;

    expect(response.status).toBe(401);
    expect(response.headers.get("x-request-id")).toBe("req_strangler_diagnostics_unauthorized_1");
    expect(response.headers.get("x-fastify-proof")).toBeNull();
    expect(payload.error?.code).toBe("unauthorized");
  });

  it("clears stale diagnostics sessions through the Fastify route", async () => {
    server = createAppServer({
      env,
      logger: createLogger("error"),
      dbPool: createDbPool()
    });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/health/diagnostics`, {
      headers: {
        cookie: "navi_session=stale",
        "x-request-id": "req_strangler_diagnostics_stale_1"
      }
    });
    const payload = await response.json() as Record<string, { code: string }>;

    expect(response.status).toBe(401);
    expect(response.headers.get("x-request-id")).toBe("req_strangler_diagnostics_stale_1");
    expect(response.headers.get("x-fastify-proof")).toBeNull();
    expect(response.headers.get("set-cookie")).toContain("navi_session=");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(payload.error?.code).toBe("unauthorized");
  });

  it("does not capture non-GET requests for migrated health paths", async () => {
    server = createAppServer({
      env,
      logger: createLogger("error"),
      dbPool: createDbPool()
    });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/health/ready`, {
      method: "POST"
    });
    const payload = await response.json() as Record<string, { code: string }>;

    expect(response.status).toBe(404);
    expect(response.headers.get("x-fastify-proof")).toBeNull();
    expect(payload.error?.code).toBe("not_found");
  });

  it("rejects oversized strangler POST bodies with the existing JSON error envelope", async () => {
    server = createAppServer({
      env,
      logger: createLogger("error"),
      dbPool: createDbPool()
    });
    const baseUrl = await listen(server);
    const response = await fetch(`${baseUrl}/api/auth/start`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req_strangler_body_too_large_1"
      },
      body: JSON.stringify({
        identifier: `${"x".repeat(33 * 1024)}@example.com`,
        purpose: "login"
      })
    });
    const payload = await response.json() as Record<string, { code: string; message: string }>;

    expect(response.status).toBe(400);
    expect(response.headers.get("x-request-id")).toBe("req_strangler_body_too_large_1");
    expect(response.headers.get("x-fastify-proof")).toBeNull();
    expect(payload.error).toEqual({
      code: "invalid_request",
      message: "JSON body too large"
    });
  });

  it("preserves empty JSON body errors through the live Fastify strangler", async () => {
    server = createAppServer({
      env,
      logger: createLogger("error"),
      dbPool: createDbPool()
    });
    const baseUrl = await listen(server);
    const response = await fetch(`${baseUrl}/api/auth/start`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req_strangler_empty_json_1"
      },
      body: ""
    });
    const payload = await response.json() as Record<string, { code: string; message: string }>;

    expect(response.status).toBe(400);
    expect(response.headers.get("x-request-id")).toBe("req_strangler_empty_json_1");
    expect(response.headers.get("x-fastify-proof")).toBeNull();
    expect(payload.error).toEqual({
      code: "invalid_request",
      message: "JSON body is required"
    });
  });
});
