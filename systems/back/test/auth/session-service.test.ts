import { afterEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage } from "node:http";
import type { Pool } from "pg";

import type { AppEnv } from "../../src/config/env";
import type { Queryable } from "../../src/db/client/pool";
import {
  logoutCurrentSession,
  readSessionSummary,
  startAuthChallenge,
  verifyAuthChallenge
} from "../../src/auth/session-service";

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
    devOtpCode: "111111",
    devOtpExposed: true
  },
  mail: {
    resendApiKey: "",
    from: "Hachozeh <noreply@email.hachozeh.com>"
  },
  actorMode: {
    demoEnabled: true,
    demoActorId: "seed_user_1"
  },
  trading: {
    requireSession: false
  },
  publicBaseUrl: "http://beta.local",
  db: {
    host: "127.0.0.1",
    port: 5432,
    name: "navi",
    user: "navi",
    password: "navi",
    connectTimeoutMs: 1500
  }
};

function createQueryable(overrides?: {
  challengeRows?: Array<{
    id: string;
    identifier_type: string;
    identifier_normalized: string;
    purpose: "login" | "signup";
    code_hash: string;
    status: string;
    attempt_count: number;
    max_attempts: number;
    last_sent_at: Date;
    expires_at: Date;
  }>;
  recentChallengeCount?: string;
	  sessionSummaryRows?: Array<{
	    session_id: string;
	    user_id: string;
	    created_at?: Date;
	    last_seen_at?: Date | null;
	    expires_at: Date;
	    session_status: string;
	    user_status: string;
    identifier_display: string | null;
  }>;
}): Queryable {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("from otp_challenges")) {
        if (sql.includes("count(*)::text")) {
          return {
            rows: [{ recent_count: overrides?.recentChallengeCount ?? "0" }]
          };
        }

        return {
          rows: overrides?.challengeRows ?? []
        };
      }

      if (sql.includes("insert into otp_challenges")) {
        return {
          rows: []
        };
      }

      if (sql.includes("update otp_challenges")) {
        return {
          rows: [],
          rowCount: 1
        };
      }

      if (sql.includes("from sessions s")) {
        return {
          rows:
            overrides?.sessionSummaryRows?.map((row) => ({
              created_at: new Date(Date.now() - 3_600_000),
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

function createPoolForAuthStart(overrides?: {
  recentChallengeCount?: string;
}) {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const client = {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      queries.push({ sql, values });

      if (
        sql === "begin" ||
        sql === "commit" ||
        sql === "rollback" ||
        sql.startsWith("set local statement_timeout") ||
        sql.startsWith("set local lock_timeout") ||
        sql.includes("pg_advisory_xact_lock")
      ) {
        return { rows: [], rowCount: 0 };
      }

      if (sql.includes("from otp_challenges")) {
        if (sql.includes("count(*)::text")) {
          return {
            rows: [{ recent_count: overrides?.recentChallengeCount ?? "0" }]
          };
        }

        return { rows: [] };
      }

      if (sql.includes("insert into otp_challenges")) {
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Unexpected query: ${sql}`);
    }),
    release: vi.fn()
  };

  return {
    pool: {
      connect: vi.fn(async () => client),
      query: vi.fn()
    } as unknown as Pool,
    client,
    queries
  };
}

function createPoolForVerify(overrides: {
  challengeRows: Array<{
    id: string;
    identifier_type: string;
    identifier_normalized: string;
    purpose: "login" | "signup";
    code_hash: string;
    status: string;
    attempt_count: number;
    max_attempts: number;
    last_sent_at: Date;
    expires_at: Date;
  }>;
  existingIdentityRows: Array<{
    identity_id: string;
    user_id: string;
    user_status: string;
  }>;
  consumedChallengeRowCount?: number;
  failWelcomeNotificationInsert?: boolean;
}) {
  const client = {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql === "begin" || sql === "commit" || sql === "rollback") {
        return { rows: [] };
      }

      if (sql.includes("from otp_challenges")) {
        return { rows: overrides.challengeRows };
      }

      if (sql.includes("update otp_challenges")) {
        return { rows: [], rowCount: overrides.consumedChallengeRowCount ?? 1 };
      }

      if (sql.includes("from user_identities ui")) {
        return { rows: overrides.existingIdentityRows };
      }

      if (sql.includes("from accounts") && sql.includes("where type = $1")) {
        return {
          rows: [
            {
              id: "account_platform_treasury",
              status: "active",
              type: values?.[0] as string,
              balance_cached: "790000.000000"
            }
          ]
        };
      }

      if (
        overrides.failWelcomeNotificationInsert &&
        sql.includes("insert into user_notifications")
      ) {
        throw new Error("welcome notification write failed");
      }

      if (sql.includes("where type = 'platform_treasury'")) {
        return {
          rows: [
            {
              id: "account_platform_treasury",
              status: "active",
              balance_cached: "790000.000000"
            }
          ]
        };
      }

      if (sql.includes("where id = $1") && sql.includes("for update")) {
        return {
          rows: [
            {
              id: values?.[0],
              type: "user_cash",
              status: "active",
              balance_cached: "0.000000"
            }
          ]
        };
      }

      if (sql.includes("from ledger_transactions")) {
        return {
          rows: [
            {
              sequence_number: "4",
              transaction_hash: "seed-hash-004"
            }
          ]
        };
      }

      return { rows: [] };
    }),
    release: vi.fn()
  };

  return {
    pool: {
      connect: vi.fn(async () => client)
    } as unknown as import("pg").Pool,
    client
  };
}

describe("auth session service", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects malformed OTP challenge ids before DB verification work", async () => {
    const { pool, client } = createPoolForVerify({
      challengeRows: [],
      existingIdentityRows: []
    });

    await expect(
      verifyAuthChallenge(
        pool,
        BASE_ENV,
        {
          headers: {},
          socket: {
            remoteAddress: "127.0.0.1"
          }
        } as IncomingMessage,
        {
          challengeId: "x".repeat(5000),
          code: "111111"
        }
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "invalid_request"
    });

    expect(client.query).not.toHaveBeenCalled();
  });

  it("starts an email OTP challenge with masked identity + dev code", async () => {
    const response = await startAuthChallenge(createQueryable(), BASE_ENV, {
      identifier: "User@example.com",
      purpose: "login"
    });

    expect(response).toMatchObject({
      purpose: "login",
      channel: "email",
      nextStep: "otp",
      identifierHint: "us***@e***.com",
      devCode: "111111"
    });
    expect(response.challengeId).toMatch(/^otp_/);
    expect(response.expiresAt).toEqual(expect.any(String));
  });

  it("serializes auth-start checks per identifier when a transaction-capable pool is used", async () => {
    const db = createPoolForAuthStart();

    const response = await startAuthChallenge(db.pool, BASE_ENV, {
      identifier: "User@example.com",
      purpose: "login"
    });

    expect(response.challengeId).toMatch(/^otp_/);
    expect(db.pool.connect).toHaveBeenCalledTimes(1);
    expect(db.client.release).toHaveBeenCalledTimes(1);

    const lockIndex = db.queries.findIndex((query) => query.sql.includes("pg_advisory_xact_lock"));
    const recentReadIndex = db.queries.findIndex((query) => query.sql.includes("from otp_challenges"));
    const insertIndex = db.queries.findIndex((query) => query.sql.includes("insert into otp_challenges"));

    expect(lockIndex).toBeGreaterThan(-1);
    expect(recentReadIndex).toBeGreaterThan(lockIndex);
    expect(insertIndex).toBeGreaterThan(lockIndex);
    expect(db.queries[lockIndex]?.values).toEqual(["auth_start", "user@example.com"]);
    expect(db.queries.map((query) => query.sql)).toEqual(
      expect.arrayContaining(["begin", "commit"])
    );
  });

  it("rate-limits auth-start outside production too — limits are unconditional", async () => {
    const db = createQueryable({
      challengeRows: [
        {
          id: "otp_existing",
          identifier_type: "email",
          identifier_normalized: "user@example.com",
          purpose: "login",
          code_hash: "hash",
          status: "pending",
          attempt_count: 0,
          max_attempts: 5,
          last_sent_at: new Date(),
          expires_at: new Date(Date.now() + 60_000)
        }
      ],
      recentChallengeCount: "6"
    });

    await expect(
      startAuthChallenge(db, BASE_ENV, {
        identifier: "user@example.com",
        purpose: "login"
      })
    ).rejects.toMatchObject({
      statusCode: 429,
      code: "rate_limited"
    });
    expect(db.query).not.toHaveBeenCalledWith(
      expect.stringContaining("insert into otp_challenges"),
      expect.any(Array)
    );
  });

  it("rate-limits on hourly challenge count alone, without a recent cooldown hit", async () => {
    const db = createQueryable({
      recentChallengeCount: "6"
    });

    await expect(
      startAuthChallenge(db, BASE_ENV, {
        identifier: "user@example.com",
        purpose: "login"
      })
    ).rejects.toMatchObject({
      statusCode: 429,
      code: "rate_limited"
    });
  });

  // --- Status-scoped rate-limit cases (F-1 / F-2 hardening) ---

  it("consumed challenge within cooldown window does NOT block a new auth/start", async () => {
    // A successful login 5 seconds ago must not prevent re-auth from a second device.
    // readRecentChallenge now filters to status='pending' — the consumed row is
    // invisible to the query, so the mock returns empty rows (as the real DB would).
    const db = createQueryable({
      challengeRows: [], // status='pending' filter makes the consumed row invisible
      recentChallengeCount: "0" // consumed rows excluded from count too
    });

    const response = await startAuthChallenge(db, BASE_ENV, {
      identifier: "user@example.com",
      purpose: "login"
    });

    expect(response.challengeId).toMatch(/^otp_/);
  });

  it("pending challenge within cooldown window DOES block a new auth/start (429)", async () => {
    const db = createQueryable({
      challengeRows: [
        {
          id: "otp_pending",
          identifier_type: "email",
          identifier_normalized: "user@example.com",
          purpose: "login",
          code_hash: "hash",
          status: "pending",
          attempt_count: 0,
          max_attempts: 5,
          last_sent_at: new Date(Date.now() - 5_000), // within 30s cooldown
          expires_at: new Date(Date.now() + 60_000)
        }
      ],
      recentChallengeCount: "1"
    });

    await expect(
      startAuthChallenge(db, BASE_ENV, {
        identifier: "user@example.com",
        purpose: "login"
      })
    ).rejects.toMatchObject({ statusCode: 429, code: "rate_limited" });
  });

  it("5 consumed challenges in the hour do NOT trigger the hourly cap", async () => {
    // Successful logins do not count toward the 5/hr OTP send cap.
    const db = createQueryable({
      challengeRows: [],
      recentChallengeCount: "0" // mock returns 0 because consumed rows are excluded
    });

    const response = await startAuthChallenge(db, BASE_ENV, {
      identifier: "user@example.com",
      purpose: "login"
    });

    expect(response.challengeId).toMatch(/^otp_/);
  });

  it("5 pending challenges in the hour DO trigger the hourly cap", async () => {
    const db = createQueryable({
      challengeRows: [],
      recentChallengeCount: "5"
    });

    await expect(
      startAuthChallenge(db, BASE_ENV, {
        identifier: "user@example.com",
        purpose: "login"
      })
    ).rejects.toMatchObject({ statusCode: 429, code: "rate_limited" });
  });

  it("keeps hourly auth-start rate limits in production", async () => {
    await expect(
      startAuthChallenge(
        createQueryable({
          recentChallengeCount: "6"
        }),
        {
          ...BASE_ENV,
          nodeEnv: "production",
          auth: {
            ...BASE_ENV.auth,
            devOtpCode: "111111"
          }
        },
        {
          identifier: "user@example.com",
          purpose: "login"
        }
      )
    ).rejects.toMatchObject({
      statusCode: 429,
      code: "rate_limited"
    });
  });

  it("sends production OTP challenges through Resend without returning a dev code", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "email_123" }), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        })
      );
    const response = await startAuthChallenge(
      createQueryable(),
      {
        ...BASE_ENV,
        nodeEnv: "production",
        auth: {
          ...BASE_ENV.auth,
          devOtpExposed: false
        },
        mail: {
          resendApiKey: "resend_test_key",
          from: "Hachozeh <noreply@email.hachozeh.com>"
        }
      },
      {
        identifier: "user@example.com",
        purpose: "login"
      }
    );
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));

    expect(response).toMatchObject({
      channel: "email",
      nextStep: "otp",
      identifierHint: "us***@e***.com"
    });
    expect(response).not.toHaveProperty("devCode");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer resend_test_key"
        })
      })
    );
    expect(requestBody).toMatchObject({
      from: "Hachozeh <noreply@email.hachozeh.com>",
      to: ["user@example.com"],
      subject: "קוד הכניסה שלך להחוזה"
    });
    expect(requestBody.text).toContain("החוזה");
    expect(requestBody.text).toContain("אין לשתף את הקוד הזה עם אף אחד.");
    expect(requestBody.text).toContain("- צוות החוזה");
    expect(requestBody.html).toContain("<strong>אין לשתף את הקוד הזה עם אף אחד.</strong>");
    expect(requestBody.html).toContain("font-size:48px");

    fetchMock.mockRestore();
  });

  it("uses a random OTP for suppressed non-production mail instead of the dev code", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "email_123" }), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        })
      );

    const response = await startAuthChallenge(
      createQueryable(),
      {
        ...BASE_ENV,
        nodeEnv: "development",
        auth: {
          ...BASE_ENV.auth,
          devOtpCode: "DEVONLY",
          devOtpExposed: false
        },
        mail: {
          resendApiKey: "resend_test_key",
          from: "Hachozeh <noreply@email.hachozeh.com>"
        }
      },
      {
        identifier: "user@example.com",
        purpose: "signup"
      }
    );
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));

    expect(response).not.toHaveProperty("devCode");
    expect(requestBody.text).not.toContain("DEVONLY");
    expect(requestBody.html).not.toContain("DEVONLY");
    expect(requestBody.text).toMatch(/\b\d{6}\b/);

    fetchMock.mockRestore();
  });

  it("does not fake-send production OTP challenges when mail is not configured", async () => {
    await expect(
      startAuthChallenge(
        createQueryable(),
        {
          ...BASE_ENV,
          nodeEnv: "production",
          auth: {
            ...BASE_ENV.auth,
            devOtpExposed: false
          }
        },
        {
          identifier: "user@example.com",
          purpose: "login"
        }
      )
    ).rejects.toMatchObject({
      statusCode: 503,
      code: "mail_unavailable"
    });
  });

  it("does not fake-send non-production OTP challenges when dev code output is suppressed", async () => {
    await expect(
      startAuthChallenge(
        createQueryable(),
        {
          ...BASE_ENV,
          auth: {
            ...BASE_ENV.auth,
            devOtpExposed: false
          }
        },
        {
          identifier: "user@example.com",
          purpose: "login"
        }
      )
    ).rejects.toMatchObject({
      statusCode: 503,
      code: "mail_unavailable"
    });
  });

  it("expires the pending OTP challenge when Resend delivery fails", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "bad sender" }), {
          status: 400,
          headers: {
            "content-type": "application/json"
          }
        })
      );
    const db = createQueryable();

    await expect(
      startAuthChallenge(
        db,
        {
          ...BASE_ENV,
          nodeEnv: "production",
          auth: {
            ...BASE_ENV.auth,
            devOtpExposed: false
          },
          mail: {
            resendApiKey: "resend_test_key",
            from: "Hachozeh <noreply@email.hachozeh.com>"
          }
        },
        {
          identifier: "user@example.com",
          purpose: "login"
        }
      )
    ).rejects.toMatchObject({
      statusCode: 502,
      code: "mail_delivery_failed"
    });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("set status = 'expired'"),
      expect.arrayContaining([expect.stringMatching(/^otp_/)])
    );

    fetchMock.mockRestore();
  });

  it("returns anonymous summary without session cookie", async () => {
    const response = await readSessionSummary(
      createQueryable(),
      BASE_ENV,
      {
        headers: {}
      } as IncomingMessage
    );

    expect(response).toEqual({
      payload: {
        actor: null,
        session: {
          authenticated: false,
          expiresAt: null
        },
        identity: null
      },
      setCookie: null
    });
  });

  it("clears stale session cookie on invalid session summary", async () => {
    const response = await readSessionSummary(
      createQueryable(),
      BASE_ENV,
      {
        headers: {
          cookie: "navi_session=stale"
        }
      } as IncomingMessage
    );

    expect(response.payload.session.authenticated).toBe(false);
    expect(response.setCookie).toContain("navi_session=");
    expect(response.setCookie).toContain("Max-Age=0");
  });

	  it("touches last_seen_at for valid session summary", async () => {
	    const db = createQueryable({
	      sessionSummaryRows: [
	        {
	          session_id: "session_1",
	          user_id: "user_1",
	          last_seen_at: new Date(Date.now() - 120_000),
	          expires_at: new Date(Date.now() + 60_000),
	          session_status: "active",
	          user_status: "active",
          identifier_display: "user@example.com"
        }
      ]
    });

    const response = await readSessionSummary(
      db,
      BASE_ENV,
      {
        headers: {
          cookie: "navi_session=live"
        }
      } as IncomingMessage
    );

    expect(response.payload.session.authenticated).toBe(true);
	    expect(response.setCookie).toBeNull();
	    expect(db.query).toHaveBeenCalledWith(
	      expect.stringContaining("update sessions"),
	      ["session_1", expect.any(String)]
	    );
	  });

	  it("skips last_seen_at touch for recently active session summary", async () => {
	    const db = createQueryable({
	      sessionSummaryRows: [
	        {
	          session_id: "session_1",
	          user_id: "user_1",
	          last_seen_at: new Date(),
	          expires_at: new Date(Date.now() + 60_000),
	          session_status: "active",
	          user_status: "active",
	          identifier_display: "user@example.com"
	        }
	      ]
	    });

	    const response = await readSessionSummary(
	      db,
	      BASE_ENV,
	      {
	        headers: {
	          cookie: "navi_session=live"
	        }
	      } as IncomingMessage
	    );

	    expect(response.payload.session.authenticated).toBe(true);
	    expect(db.query).not.toHaveBeenCalledWith(
	      expect.stringContaining("update sessions"),
	      expect.anything()
	    );
	  });

  it("clears session cookie on logout even when no cookie is present", async () => {
    const response = await logoutCurrentSession(
      createQueryable(),
      BASE_ENV,
      {
        headers: {}
      } as IncomingMessage
    );

    expect(response.payload.session.authenticated).toBe(false);
    expect(response.setCookie).toContain("navi_session=");
    expect(response.setCookie).toContain("Max-Age=0");
  });

  it("grants starter balance to first-time verified users", async () => {
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql === "begin" || sql === "commit" || sql === "rollback") {
          return { rows: [] };
        }

        if (sql.includes("from otp_challenges")) {
          return {
            rows: [
              {
                id: "otp_1",
                identifier_type: "email",
                identifier_normalized: "new-user@example.com",
                purpose: "signup",
                code_hash: "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92",
                status: "pending",
                attempt_count: 0,
                max_attempts: 5,
                last_sent_at: new Date(),
                expires_at: new Date(Date.now() + 60_000)
              }
            ]
          };
        }

        if (sql.includes("from user_identities ui")) {
          return {
            rows: []
          };
        }

        if (sql.includes("from accounts") && sql.includes("where type = $1")) {
          return {
            rows: [
              {
                id: "account_platform_treasury",
                type: values?.[0],
                status: "active",
                balance_cached: "790000.000000"
              }
            ]
          };
        }

        if (sql.includes("where id = $1") && sql.includes("for update")) {
          return {
            rows: [
              {
                id: values?.[0],
                type: "user_cash",
                status: "active",
                balance_cached: "0.000000"
              }
            ]
          };
        }

        if (sql.includes("from ledger_transactions")) {
          return {
            rows: [
              {
                sequence_number: "4",
                transaction_hash: "seed-hash-004"
              }
            ]
          };
        }

        return {
          rows: []
        };
      }),
      release: vi.fn()
    };

    const pool = {
      connect: vi.fn(async () => client)
    } as unknown as import("pg").Pool;

    const response = await verifyAuthChallenge(
      pool,
      BASE_ENV,
      {
        headers: {
          "user-agent": "vitest"
        },
        socket: {
          remoteAddress: "127.0.0.1"
        }
      } as IncomingMessage,
      {
        challengeId: "otp_1",
        code: "123456"
      }
    );

    expect(response.payload.session.authenticated).toBe(true);
    expect(response.setCookie).toContain("navi_session=");
    const userInsertCall = client.query.mock.calls.find(([sql]) =>
      String(sql).includes("insert into users")
    );
    expect(String(userInsertCall?.[0])).toContain("handle");
    expect(userInsertCall?.[1]?.[1]).toMatch(/^user_[a-f0-9]{8}$/);
    expect(userInsertCall?.[1]?.[1]).not.toContain("new_user");
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("update accounts"),
      expect.arrayContaining(["account_platform_treasury", "789000.000000"])
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("update accounts"),
      expect.arrayContaining(["1000.000000"])
    );
  });

  it("rejects verify when consuming the OTP challenge affects no rows", async () => {
    const { pool, client } = createPoolForVerify({
      challengeRows: [
        {
          id: "otp_1",
          identifier_type: "email",
          identifier_normalized: "returning@example.com",
          purpose: "login",
          code_hash: "bcb15f821479b4d5772bd0ca866c00ad5f926e3580720659cc80d39c9d09802a",
          status: "pending",
          attempt_count: 0,
          max_attempts: 5,
          last_sent_at: new Date(),
          expires_at: new Date(Date.now() + 60_000)
        }
      ],
      existingIdentityRows: [
        {
          identity_id: "identity_1",
          user_id: "user_1",
          user_status: "active"
        }
      ],
      consumedChallengeRowCount: 0
    });

    await expect(
      verifyAuthChallenge(
        pool,
        BASE_ENV,
        {
          headers: {},
          socket: {
            remoteAddress: "127.0.0.1"
          }
        } as IncomingMessage,
        {
          challengeId: "otp_1",
          code: "111111"
        }
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "invalid_code"
    });

    expect(client.query).not.toHaveBeenCalledWith(
      expect.stringContaining("insert into sessions"),
      expect.any(Array)
    );
  });

  it("keeps signup transaction usable when welcome notification write fails", async () => {
    const { pool, client } = createPoolForVerify({
      challengeRows: [
        {
          id: "otp_1",
          identifier_type: "email",
          identifier_normalized: "new-user@example.com",
          purpose: "signup",
          code_hash:
            "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92",
          status: "pending",
          attempt_count: 0,
          max_attempts: 5,
          last_sent_at: new Date(),
          expires_at: new Date(Date.now() + 60_000)
        }
      ],
      existingIdentityRows: [],
      failWelcomeNotificationInsert: true
    });

    const response = await verifyAuthChallenge(
      pool,
      BASE_ENV,
      {
        headers: {
          "user-agent": "vitest"
        },
        socket: {
          remoteAddress: "127.0.0.1"
        }
      } as IncomingMessage,
      {
        challengeId: "otp_1",
        code: "123456"
      }
    );

    expect(response.payload.session.authenticated).toBe(true);
    expect(response.setCookie).toContain("navi_session=");
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("insert into sessions"),
      expect.any(Array)
    );
    expect(client.query).toHaveBeenCalledWith("commit");
    expect(client.query).not.toHaveBeenCalledWith("rollback");
  });

});
