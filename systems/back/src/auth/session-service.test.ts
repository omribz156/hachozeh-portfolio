import type { IncomingMessage } from "node:http";
import type { Pool, PoolClient } from "pg";

import { describe, expect, it } from "vitest";

import type { AppEnv } from "../config/env";
import type { Queryable } from "../db/client/pool";
import { hashValue } from "./session/hashing";
import { readSessionSummary, verifyAuthChallenge } from "./session-service";
import type { AuthChallengeRow, SessionSummaryRow, UserIdentityRow } from "./session/types";

const RAW_TOKEN = "test-raw-session-token";

function buildEnv(overrides?: Partial<AppEnv["auth"]>): AppEnv {
  return {
    auth: {
      sessionCookieName: "navi_session",
      sessionTtlHours: 24 * 7,
      sessionAbsoluteTtlHours: 24 * 90,
      otpTtlMinutes: 10,
      otpResendCooldownSeconds: 30,
      otpMaxAttempts: 5,
      devOtpCode: "111111",
      devOtpExposed: false,
      ...overrides
    }
  } as AppEnv;
}

function buildRequest(): IncomingMessage {
  return {
    headers: {
      cookie: `navi_session=${encodeURIComponent(RAW_TOKEN)}`
    }
  } as unknown as IncomingMessage;
}

function buildOtpRequest(): IncomingMessage {
  return {
    headers: {
      "user-agent": "vitest",
      "x-forwarded-for": "127.0.0.1"
    },
    socket: {
      remoteAddress: "127.0.0.1"
    }
  } as unknown as IncomingMessage;
}

type CapturedQuery = {
  sql: string;
  params: unknown[];
};

function buildFakeDb(summaryRow: SessionSummaryRow | null): {
  db: Queryable;
  queries: CapturedQuery[];
} {
  const queries: CapturedQuery[] = [];

  const db: Queryable = {
    query: (async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });

      if (sql.includes("from sessions s") && sql.includes("token_hash = $1")) {
        return { rows: summaryRow ? [summaryRow] : [], rowCount: summaryRow ? 1 : 0 };
      }

      // The touch update.
      return { rows: [], rowCount: 1 };
    }) as Queryable["query"]
  };

  return { db, queries };
}

function buildSummaryRow(overrides: Partial<SessionSummaryRow>): SessionSummaryRow {
  return {
    session_id: "session_1",
    user_id: "user_1",
    created_at: new Date(),
    last_seen_at: null,
    expires_at: new Date(Date.now() + 60 * 60 * 1000),
    session_status: "active",
    user_status: "active",
    identifier_display: "user@example.com",
    ...overrides
  };
}

describe("readSessionSummary (rolling session)", () => {
  it("extends expires_at when the throttled activity touch fires", async () => {
    const env = buildEnv();
    const createdAt = new Date(Date.now() - 60 * 60 * 1000);
    const summaryRow = buildSummaryRow({
      created_at: createdAt,
      last_seen_at: null, // never touched -> always due for a touch
      expires_at: new Date(Date.now() + 60 * 60 * 1000)
    });
    const { db, queries } = buildFakeDb(summaryRow);

    const result = await readSessionSummary(db, env, buildRequest());

    expect(result.payload.session.authenticated).toBe(true);

    const touchQuery = queries.find((q) => q.sql.includes("expires_at = $2"));
    expect(touchQuery).toBeDefined();

    const extendedTo = new Date(touchQuery!.params[1] as string).getTime();
    const expectedSlide = Date.now() + env.auth.sessionTtlHours * 60 * 60 * 1000;

    // Extended forward, roughly to now + sessionTtlHours (well past the
    // original expires_at that was only 1h out).
    expect(extendedTo).toBeGreaterThan(summaryRow.expires_at.getTime());
    expect(Math.abs(extendedTo - expectedSlide)).toBeLessThan(5_000);
  });

  it("never extends the touch past created_at + absolute TTL", async () => {
    const env = buildEnv({ sessionTtlHours: 24 * 7, sessionAbsoluteTtlHours: 1 });
    const createdAt = new Date(Date.now() - 23 * 60 * 60 * 1000); // 23h old session
    const summaryRow = buildSummaryRow({
      created_at: createdAt,
      last_seen_at: null,
      expires_at: new Date(Date.now() + 30 * 60 * 1000)
    });
    const { db, queries } = buildFakeDb(summaryRow);

    await readSessionSummary(db, env, buildRequest());

    const touchQuery = queries.find((q) => q.sql.includes("expires_at = $2"));
    expect(touchQuery).toBeDefined();

    const extendedTo = new Date(touchQuery!.params[1] as string).getTime();
    const absoluteCapAt = createdAt.getTime() + env.auth.sessionAbsoluteTtlHours * 60 * 60 * 1000;

    expect(extendedTo).toBe(absoluteCapAt);
  });

  it("does not resurrect an already-expired session", async () => {
    const env = buildEnv();
    const summaryRow = buildSummaryRow({
      last_seen_at: null,
      expires_at: new Date(Date.now() - 60 * 1000) // expired a minute ago
    });
    const { db, queries } = buildFakeDb(summaryRow);

    const result = await readSessionSummary(db, env, buildRequest());

    expect(result.payload.session.authenticated).toBe(false);
    expect(result.setCookie).not.toBeNull();

    const touchQuery = queries.find((q) => q.sql.includes("expires_at = $2"));
    expect(touchQuery).toBeUndefined();
  });

  it("does not touch when the throttle interval has not elapsed", async () => {
    const env = buildEnv();
    const summaryRow = buildSummaryRow({
      last_seen_at: new Date(Date.now() - 1_000), // seen 1s ago, well within throttle
      expires_at: new Date(Date.now() + 60 * 60 * 1000)
    });
    const { db, queries } = buildFakeDb(summaryRow);

    await readSessionSummary(db, env, buildRequest());

    const touchQuery = queries.find((q) => q.sql.includes("expires_at = $2"));
    expect(touchQuery).toBeUndefined();
  });
});

function buildPendingChallenge(identifier = "link-target@example.com"): AuthChallengeRow {
  return {
    id: "otp_link_google",
    identifier_type: "email",
    identifier_normalized: identifier,
    purpose: "signup",
    code_hash: hashValue("111111"),
    status: "pending",
    attempt_count: 0,
    max_attempts: 5,
    last_sent_at: new Date(),
    expires_at: new Date(Date.now() + 60 * 1000)
  };
}

function buildIdentityRow(userId: string): UserIdentityRow {
  return {
    identity_id: `identity_${userId}`,
    user_id: userId,
    user_status: "active"
  };
}

function buildVerifyPool(options: {
  challenge: AuthChallengeRow;
  emailIdentities?: UserIdentityRow[];
  googleIdentities?: UserIdentityRow[];
  onQuery?: (sql: string, params?: unknown[]) => {
    rows?: unknown[];
    rowCount?: number;
  } | Error | void;
}): {
  pool: Pool;
  queries: CapturedQuery[];
} {
  const queries: CapturedQuery[] = [];

  const client = {
    query: async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });

      const override = options.onQuery?.(sql, params);

      if (override instanceof Error) {
        throw override;
      }

      if (override) {
        return override;
      }

      if (sql.includes("from otp_challenges") && sql.includes("for update")) {
        return { rows: [options.challenge], rowCount: 1 };
      }

      if (sql.includes("update otp_challenges") && sql.includes("status = 'consumed'")) {
        return { rows: [], rowCount: 1 };
      }

      if (
        sql.includes("from user_identities ui") &&
        sql.includes("ui.type = $1") &&
        params?.[0] === "email"
      ) {
        return { rows: options.emailIdentities ?? [], rowCount: options.emailIdentities?.length ?? 0 };
      }

      if (
        sql.includes("from user_identities ui") &&
        sql.includes("ui.type = 'google'")
      ) {
        return { rows: options.googleIdentities ?? [], rowCount: options.googleIdentities?.length ?? 0 };
      }

      return { rows: [], rowCount: 1 };
    },
    release: () => {}
  } as unknown as PoolClient;

  return {
    queries,
    pool: {
      connect: async () => client
    } as unknown as Pool
  };
}

describe("verifyAuthChallenge (identity linking)", () => {
  it("stores wrong-code attempt_count and commits before invalid_code is returned", async () => {
    const env = buildEnv({ devOtpCode: "111111", devOtpExposed: true });
    const challenge = buildPendingChallenge();
    const { pool, queries } = buildVerifyPool({ challenge });

    await expect(
      verifyAuthChallenge(pool, env, buildOtpRequest(), {
        challengeId: challenge.id,
        code: "999999"
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "invalid_code"
    });

    const attemptUpdate = queries.find((query) =>
      query.sql.includes("update otp_challenges") && query.sql.includes("attempt_count")
    );
    expect(attemptUpdate).toBeDefined();
    expect(attemptUpdate?.params[1]).toBe(1);
    expect(attemptUpdate?.params[2]).toBe("pending");
    expect(queries.some((query) => query.sql.trim() === "begin")).toBe(true);
    expect(queries.some((query) => query.sql.trim() === "commit")).toBe(true);
    expect(queries.some((query) => query.sql.trim() === "rollback")).toBe(false);
  });

  it("stores the final-attempt expiry update and commits before rate_limit is returned", async () => {
    const env = buildEnv({ devOtpCode: "111111", devOtpExposed: true });
    const challenge = buildPendingChallenge();
    challenge.attempt_count = challenge.max_attempts - 1;
    const { pool, queries } = buildVerifyPool({ challenge });

    await expect(
      verifyAuthChallenge(pool, env, buildOtpRequest(), {
        challengeId: challenge.id,
        code: "999999"
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "invalid_code"
    });

    const attemptUpdate = queries.find((query) =>
      query.sql.includes("update otp_challenges") && query.sql.includes("attempt_count")
    );
    expect(attemptUpdate).toBeDefined();
    expect(attemptUpdate?.params[1]).toBe(challenge.max_attempts);
    expect(attemptUpdate?.params[2]).toBe("expired");
    expect(queries.some((query) => query.sql.trim() === "begin")).toBe(true);
    expect(queries.some((query) => query.sql.trim() === "commit")).toBe(true);
    expect(queries.some((query) => query.sql.trim() === "rollback")).toBe(false);
  });

  it("rolls back when an unexpected DB error occurs after a correct OTP match", async () => {
    const env = buildEnv({ devOtpCode: "111111", devOtpExposed: true });
    const challenge = buildPendingChallenge();
    const dbError = new Error("integration-db-glitch");
    const { pool, queries } = buildVerifyPool({
      challenge,
      onQuery: (sql) => {
        if (sql.includes("from user_identities ui") && sql.includes("ui.type = $1")) {
          return dbError;
        }
      }
    });

    await expect(
      verifyAuthChallenge(pool, env, buildOtpRequest(), {
        challengeId: challenge.id,
        code: "111111"
      })
    ).rejects.toThrow("integration-db-glitch");

    expect(queries.some((query) => query.sql.trim() === "begin")).toBe(true);
    expect(queries.some((query) => query.sql.trim() === "commit")).toBe(false);
    expect(queries.some((query) => query.sql.trim() === "rollback")).toBe(true);
  });

  it("consumes a correct code and creates a session in one committed transaction", async () => {
    const env = buildEnv({ devOtpCode: "111111", devOtpExposed: true });
    const challenge = buildPendingChallenge();
    const { pool, queries } = buildVerifyPool({
      challenge,
      emailIdentities: [buildIdentityRow("user_existing")]
    });

    const result = await verifyAuthChallenge(pool, env, buildOtpRequest(), {
      challengeId: challenge.id,
      code: "111111"
    });

    expect(result.payload.actor?.userId).toBe("user_existing");

    const consumedUpdate = queries.find((query) =>
      query.sql.includes("update otp_challenges") && query.sql.includes("status = 'consumed'")
    );
    expect(consumedUpdate).toBeDefined();

    const sessionInsert = queries.find((query) => query.sql.includes("insert into sessions"));
    expect(sessionInsert).toBeDefined();

    expect(queries.some((query) => query.sql.trim() === "begin")).toBe(true);
    expect(queries.some((query) => query.sql.trim() === "commit")).toBe(true);
    expect(queries.some((query) => query.sql.trim() === "rollback")).toBe(false);
  });

  it("links email OTP into an existing Google account with the same verified display email", async () => {
    const env = buildEnv({ devOtpCode: "111111", devOtpExposed: true });
    const challenge = buildPendingChallenge();
    const { pool, queries } = buildVerifyPool({
      challenge,
      googleIdentities: [buildIdentityRow("user_google_existing")]
    });

    const result = await verifyAuthChallenge(pool, env, buildOtpRequest(), {
      challengeId: challenge.id,
      code: "111111"
    });

    expect(result.payload.actor?.userId).toBe("user_google_existing");
    expect(result.payload.authResult?.createdUser).toBe(false);
    expect(result.payload.authResult?.starterGrantAmount).toBeNull();

    const emailLink = queries.find(
      (query) => query.sql.includes("insert into user_identities") &&
        query.params[1] === "user_google_existing" &&
        query.params[2] === "email"
    );
    expect(emailLink).toBeDefined();
    expect(emailLink?.params[3]).toBe("link-target@example.com");

    const createUser = queries.find((query) => query.sql.includes("insert into users"));
    expect(createUser).toBeUndefined();
  });

  it("does not guess when multiple Google accounts expose the same display email", async () => {
    const env = buildEnv({ devOtpCode: "111111", devOtpExposed: true });
    const challenge = buildPendingChallenge();
    const { pool, queries } = buildVerifyPool({
      challenge,
      googleIdentities: [
        buildIdentityRow("user_google_one"),
        buildIdentityRow("user_google_two")
      ]
    });

    await expect(
      verifyAuthChallenge(pool, env, buildOtpRequest(), {
        challengeId: challenge.id,
        code: "111111"
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "identity_conflict"
    });

    const emailLink = queries.find((query) => query.sql.includes("insert into user_identities"));
    expect(emailLink).toBeUndefined();

    const sessionInsert = queries.find((query) => query.sql.includes("insert into sessions"));
    expect(sessionInsert).toBeUndefined();
  });

  it("blocks OTP login when the email identity and Google display email belong to different users", async () => {
    const env = buildEnv({ devOtpCode: "111111", devOtpExposed: true });
    const challenge = buildPendingChallenge();
    const { pool, queries } = buildVerifyPool({
      challenge,
      emailIdentities: [buildIdentityRow("user_email_fork")],
      googleIdentities: [buildIdentityRow("user_google_existing")]
    });

    await expect(
      verifyAuthChallenge(pool, env, buildOtpRequest(), {
        challengeId: challenge.id,
        code: "111111"
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "identity_conflict"
    });

    const sessionInsert = queries.find((query) => query.sql.includes("insert into sessions"));
    expect(sessionInsert).toBeUndefined();
  });
});
