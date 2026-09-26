import { describe, expect, it, vi } from "vitest";
import type { IncomingMessage } from "node:http";

import type { AppEnv } from "../../src/config/env";
import type { Queryable } from "../../src/db/client/pool";
import {
  ActorResolutionError,
  resolveRequestActor
} from "../../src/auth/actor-resolver";
import { hashValue } from "../../src/auth/session/hashing";

const BASE_ENV: AppEnv = {
  serviceName: "navi-backend",
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 3001,
  logLevel: "info",
  auth: {
    sessionCookieName: "navi_session",
    sessionTtlHours: 24 * 7,
    sessionAbsoluteTtlHours: 24 * 90,
    otpTtlMinutes: 10,
    otpResendCooldownSeconds: 30,
    otpMaxAttempts: 5,
    devOtpCode: "111111"
  },
  actorMode: {
    demoEnabled: true,
    demoActorId: "seed_user_1"
  },
  trading: {
    requireSession: false
  },
  publicBaseUrl: "http://127.0.0.1:6969/trending",
  db: {
    host: "127.0.0.1",
    port: 5432,
    name: "navi",
    user: "navi",
    password: "navi",
    connectTimeoutMs: 1500,
    poolMax: 30
  }
};

function createQueryable(rows?: Array<{
  session_id: string;
  user_id: string;
  session_status: string;
  created_at?: Date;
  last_seen_at?: Date;
  expires_at: Date;
  user_status: string;
  user_role: "user" | "admin";
}>): Queryable {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("from sessions s")) {
        return {
          rows:
            rows?.map((row) => ({
              created_at: new Date(Date.now() - 3_600_000),
              last_seen_at: new Date(Date.now() - 120_000),
              ...row
            })) ?? []
        };
      }

      if (sql.includes("update sessions")) {
        return {
          rows: []
        };
      }

      if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    })
  };
}

describe("actor resolver", () => {
  it("resolves valid session actor and touches last_seen_at", async () => {
    const db = createQueryable([
      {
        session_id: "session_1",
        user_id: "user_1",
        session_status: "active",
        last_seen_at: new Date(Date.now() - 120_000),
        expires_at: new Date(Date.now() + 60_000),
        user_status: "active",
        user_role: "user"
      }
    ]);

    const actor = await resolveRequestActor(
      db,
      BASE_ENV,
      {
        headers: {
          cookie: "navi_session=live"
        }
      } as IncomingMessage
    );

    expect(actor).toMatchObject({
      actorId: "user_1",
      mode: "session",
      sessionId: "session_1",
      role: "user"
    });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("update sessions"),
      ["session_1", expect.any(String)]
    );
  });

  it("skips last_seen_at touch for recently active sessions", async () => {
    const db = createQueryable([
      {
        session_id: "session_1",
        user_id: "user_1",
        session_status: "active",
        last_seen_at: new Date(),
        expires_at: new Date(Date.now() + 60_000),
        user_status: "active",
        user_role: "user"
      }
    ]);

    await resolveRequestActor(
      db,
      BASE_ENV,
      {
        headers: {
          cookie: "navi_session=live"
        }
      } as IncomingMessage
    );

    expect(db.query).not.toHaveBeenCalledWith(
      expect.stringContaining("update sessions"),
      expect.anything()
    );
  });

  it("returns cookie-clearing unauthorized error for stale session token", async () => {
    await expect(
      resolveRequestActor(
        createQueryable([]),
        BASE_ENV,
        {
          headers: {
            cookie: "navi_session=stale"
          }
        } as IncomingMessage
      )
    ).rejects.toMatchObject<Partial<ActorResolutionError>>({
      statusCode: 401,
      code: "unauthorized",
      setCookie: expect.stringContaining("Max-Age=0")
    });
  });

  it("handles malformed cookie encoding as an invalid session instead of throwing", async () => {
    await expect(
      resolveRequestActor(
        createQueryable([]),
        BASE_ENV,
        {
          headers: {
            cookie: "navi_session=%E0%A4%A"
          }
        } as IncomingMessage,
        {
          allowDemo: false
        }
      )
    ).rejects.toMatchObject<Partial<ActorResolutionError>>({
      statusCode: 401,
      code: "unauthorized",
      setCookie: expect.stringContaining("Max-Age=0")
    });
  });

  it("rejects admin-only resolution for non-admin session", async () => {
    await expect(
      resolveRequestActor(
        createQueryable([
          {
            session_id: "session_1",
            user_id: "user_1",
            session_status: "active",
            expires_at: new Date(Date.now() + 60_000),
            user_status: "active",
            user_role: "user"
          }
        ]),
        BASE_ENV,
        {
          headers: {
            cookie: "navi_session=live"
          }
        } as IncomingMessage,
        {
          allowDemo: false,
          requiredRole: "admin"
        }
      )
    ).rejects.toMatchObject<Partial<ActorResolutionError>>({
      statusCode: 403,
      code: "unauthorized"
    });
  });

  it("rejects no-cookie actor resolution when demo is explicitly disabled", async () => {
    await expect(
      resolveRequestActor(createQueryable([]), BASE_ENV, { headers: {} } as IncomingMessage, {
        allowDemo: false
      })
    ).rejects.toMatchObject<Partial<ActorResolutionError>>({
      statusCode: 401,
      code: "unauthorized"
    });
  });

  it("uses the shared session token hash when resolving a cookie", async () => {
    const db = createQueryable([
      {
        session_id: "session_1",
        user_id: "user_1",
        session_status: "active",
        last_seen_at: new Date(),
        expires_at: new Date(Date.now() + 60_000),
        user_status: "active",
        user_role: "user"
      }
    ]);

    await resolveRequestActor(
      db,
      BASE_ENV,
      {
        headers: {
          cookie: "navi_session=live"
        }
      } as IncomingMessage
    );

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("where s.token_hash = $1"),
      [hashValue("live")]
    );
  });
});
