import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import type { Pool } from "pg";

import type { AppEnv } from "../src/config/env";
import { hashValue } from "../src/auth/session/hashing";
import { AuthSessionError, verifyAuthChallenge } from "../src/auth/session-service";
import { createTestPool, truncateAllTables } from "./helpers";

const TEST_ENV: AppEnv = {
  serviceName: "navi-backend-inttest",
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 3001,
  logLevel: "error",
  auth: {
    sessionCookieName: "navi_session",
    sessionTtlHours: 168,
    otpTtlMinutes: 10,
    otpResendCooldownSeconds: 30,
    otpMaxAttempts: 2,
    devOtpCode: "111111",
    devOtpExposed: false
  },
  mail: { resendApiKey: "", from: "test@test.test" },
  actorMode: { demoEnabled: false, demoActorId: "" },
  trading: { requireSession: false },
  publicBaseUrl: "http://127.0.0.1",
  db: {
    host: process.env["DB_HOST"] ?? "127.0.0.1",
    port: parseInt(process.env["DB_PORT"] ?? "55432", 10),
    name: process.env["DB_NAME"] ?? "navi_test",
    user: process.env["DB_USER"] ?? "navi",
    password: process.env["DB_PASSWORD"] ?? "navi",
    connectTimeoutMs: 10_000
  }
};

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

let pool: Pool;
let challengeId: string;
let userId: string;
let userHandle: string;
let userEmail: string;
let challengeCode: string;
let userIdentityId: string;
let userCashAccountId: string;

beforeEach(async () => {
  pool = createTestPool();
  await truncateAllTables(pool);

  challengeCode = "123456";
  userId = `inttest_otp_user_${Date.now()}`;
  userHandle = "inttest_otp_user_a";
  userEmail = `${userId}@example.com`;
  challengeId = `otp_${userId}`;
  userIdentityId = `identity_${userId}`;
  userCashAccountId = `account_${userId}_cash`;

  await pool.query(
    `
      insert into users (id, handle, status, role, trade_access_status, last_login_at)
      values ($1, $2, 'active', 'user', 'enabled', now())
      on conflict (id) do nothing
    `,
    [userId, userHandle]
  );

  await pool.query(
    `
      insert into accounts (id, type, owner_id, status, balance_cached)
      values ($1, 'user_cash', $2, 'active', '0.000000')
      on conflict (id) do nothing
    `,
    [userCashAccountId, userId]
  );

  await pool.query(
    `
      insert into user_identities (
        id,
        user_id,
        type,
        identifier_normalized,
        identifier_display,
        status,
        verified_at
      )
      values ($1, $2, 'email', $3, $3, 'active', now())
      on conflict (id) do nothing
    `,
    [userIdentityId, userId, userEmail]
  );

  await pool.query(
    `
      insert into otp_challenges (
        id,
        identifier_type,
        identifier_normalized,
        purpose,
        code_hash,
        status,
        attempt_count,
        max_attempts,
        last_sent_at,
        expires_at
      )
      values ($1, 'email', $2, 'signup', $3, 'pending', 0, $4, now(), now() + interval '5 minutes')
    `,
    [challengeId, userEmail, hashValue(challengeCode), TEST_ENV.auth.otpMaxAttempts]
  );
});

afterEach(async () => {
  if (!pool) {
    return;
  }

  await pool.query("delete from sessions where user_id = $1", [userId]);
  await pool.query("delete from user_identities where user_id = $1", [userId]);
  await pool.query("delete from accounts where owner_id = $1", [userId]);
  await pool.query("delete from users where id = $1", [userId]);
  await pool.query("delete from otp_challenges where id = $1", [challengeId]);

  await pool.end();
});

describe("verifyAuthChallenge integration", () => {
  it("persists failed OTP attempts and expires at max attempts", async () => {
    await expect(
      verifyAuthChallenge(pool, TEST_ENV, buildOtpRequest(), {
        challengeId,
        code: "000000"
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "invalid_code"
    } satisfies Partial<AuthSessionError>);

    const afterFirst = await pool.query<{ attempt_count: string; status: string }>(
      "select attempt_count::text as attempt_count, status from otp_challenges where id = $1",
      [challengeId]
    );

    expect(afterFirst.rows[0]).toBeDefined();
    expect(parseInt(afterFirst.rows[0]!.attempt_count, 10)).toBe(1);
    expect(afterFirst.rows[0]!.status).toBe("pending");

    await expect(
      verifyAuthChallenge(pool, TEST_ENV, buildOtpRequest(), {
        challengeId,
        code: "000000"
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "invalid_code"
    } satisfies Partial<AuthSessionError>);

    const afterSecond = await pool.query<{ attempt_count: string; status: string }>(
      "select attempt_count::text as attempt_count, status from otp_challenges where id = $1",
      [challengeId]
    );

    expect(afterSecond.rows[0]).toBeDefined();
    expect(parseInt(afterSecond.rows[0]!.attempt_count, 10)).toBe(TEST_ENV.auth.otpMaxAttempts);
    expect(afterSecond.rows[0]!.status).toBe("expired");
  });

  it("rejects a correct OTP for an exhausted challenge and creates no session", async () => {
    await verifyAuthChallenge(pool, TEST_ENV, buildOtpRequest(), {
      challengeId,
      code: "000000"
    }).catch(() => undefined);

    await verifyAuthChallenge(pool, TEST_ENV, buildOtpRequest(), {
      challengeId,
      code: "000000"
    }).catch(() => undefined);

    await expect(
      verifyAuthChallenge(pool, TEST_ENV, buildOtpRequest(), {
        challengeId,
        code: challengeCode
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "invalid_code"
    } satisfies Partial<AuthSessionError>);

    const sessionRow = await pool.query<{ count: string }>(
      "select count(*) as count from sessions where user_id = $1",
      [userId]
    );

    expect(sessionRow.rows[0]!.count).toBe("0");
  });
});
