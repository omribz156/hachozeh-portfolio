import { describe, expect, it } from "vitest";

import type { AppEnv } from "../../config/env";
import type { Queryable } from "../../db/client/pool";
import { shouldTouchSessionActivity, touchSessionActivity } from "./session-records";

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

type CapturedQuery = {
  sql: string;
  params: unknown[];
};

function buildFakeDb(): { db: Queryable; queries: CapturedQuery[] } {
  const queries: CapturedQuery[] = [];
  const db: Queryable = {
    query: (async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return { rows: [], rowCount: 0 };
    }) as Queryable["query"]
  };

  return { db, queries };
}

describe("shouldTouchSessionActivity", () => {
  it("touches when last_seen_at is missing", () => {
    expect(shouldTouchSessionActivity(null)).toBe(true);
    expect(shouldTouchSessionActivity(undefined)).toBe(true);
  });

  it("throttles within the touch interval", () => {
    const now = Date.now();
    const lastSeenAt = new Date(now - 1_000);
    expect(shouldTouchSessionActivity(lastSeenAt, now)).toBe(false);
  });

  it("touches once the interval has elapsed", () => {
    const now = Date.now();
    const lastSeenAt = new Date(now - 61_000);
    expect(shouldTouchSessionActivity(lastSeenAt, now)).toBe(true);
  });
});

describe("touchSessionActivity (rolling session)", () => {
  it("extends expires_at by the sliding TTL on a fresh session", async () => {
    const { db, queries } = buildFakeDb();
    const env = buildEnv();
    const createdAt = new Date();

    const before = Date.now();
    await touchSessionActivity(db, env, "session_1", createdAt);
    const after = Date.now();

    expect(queries).toHaveLength(1);
    const [query] = queries;
    expect(query.sql).toContain("expires_at = $2");
    expect(query.params[0]).toBe("session_1");

    const extendedTo = new Date(query.params[1] as string).getTime();
    const expectedMin = before + env.auth.sessionTtlHours * 60 * 60 * 1000;
    const expectedMax = after + env.auth.sessionTtlHours * 60 * 60 * 1000;

    expect(extendedTo).toBeGreaterThanOrEqual(expectedMin);
    expect(extendedTo).toBeLessThanOrEqual(expectedMax);
  });

  it("never extends past created_at + the absolute lifetime", async () => {
    const { db, queries } = buildFakeDb();
    // Absolute cap is much shorter than the sliding TTL, and the session is
    // already old enough that the sliding window would blow past the cap.
    const env = buildEnv({ sessionTtlHours: 24 * 7, sessionAbsoluteTtlHours: 1 });
    const createdAt = new Date(Date.now() - 23 * 60 * 60 * 1000); // created 23h ago

    await touchSessionActivity(db, env, "session_old", createdAt);

    const [query] = queries;
    const extendedTo = new Date(query.params[1] as string).getTime();
    const absoluteCapAt = createdAt.getTime() + env.auth.sessionAbsoluteTtlHours * 60 * 60 * 1000;

    expect(extendedTo).toBe(absoluteCapAt);
  });

  it("caps exactly at the absolute lifetime, never a millisecond past it", async () => {
    const { db, queries } = buildFakeDb();
    const env = buildEnv({ sessionTtlHours: 24 * 90, sessionAbsoluteTtlHours: 24 * 90 });
    const createdAt = new Date(Date.now() - 89 * 24 * 60 * 60 * 1000); // created 89 days ago

    await touchSessionActivity(db, env, "session_near_cap", createdAt);

    const [query] = queries;
    const extendedTo = new Date(query.params[1] as string).getTime();
    const absoluteCapAt = createdAt.getTime() + env.auth.sessionAbsoluteTtlHours * 60 * 60 * 1000;

    expect(extendedTo).toBeLessThanOrEqual(absoluteCapAt);
  });
});
