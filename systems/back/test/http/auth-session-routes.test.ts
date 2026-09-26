import { afterEach, describe, expect, it } from "vitest";

import {
  closeAppTestServers,
  startServer
} from "./app-test-harness";
import { hashValue } from "../../src/auth/session/hashing";

afterEach(async () => {
  await closeAppTestServers();
});

describe("auth session routes", () => {
  it("redirects Google auth start to Google with a signed state", async () => {
    const { baseUrl } = await startServer({
      env: {
        googleAuth: {
          clientId: "google-client-id",
          clientSecret: "google-client-secret",
          redirectUri: "http://127.0.0.1:3001/api/auth/google/callback",
          stateSecret: "test-state-secret"
        },
        publicBaseUrl: "http://127.0.0.1:6969/trending"
      }
    });

    const response = await fetch(
      `${baseUrl}/api/auth/google/start?returnTo=${encodeURIComponent(
        "http://127.0.0.1:6969/markets/abc"
      )}`,
      {
        redirect: "manual"
      }
    );
    const location = response.headers.get("location") || "";
    const redirectUrl = new URL(location);

    expect(response.status).toBe(302);
    expect(redirectUrl.origin).toBe("https://accounts.google.com");
    expect(redirectUrl.searchParams.get("client_id")).toBe("google-client-id");
    expect(redirectUrl.searchParams.get("state")).toEqual(expect.any(String));
    expect(redirectUrl.searchParams.get("nonce")).toEqual(expect.any(String));
    expect(redirectUrl.searchParams.get("code_challenge")).toEqual(expect.any(String));
    expect(redirectUrl.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("redirects back to the original page when Google returns an OAuth error", async () => {
    const googleAuth = {
      clientId: "google-client-id",
      clientSecret: "google-client-secret",
      redirectUri: "http://127.0.0.1:3001/api/auth/google/callback",
      stateSecret: "test-state-secret"
    };
    const { baseUrl } = await startServer({
      env: {
        googleAuth,
        publicBaseUrl: "https://hachozeh.com/trending"
      }
    });
    const startResponse = await fetch(
      `${baseUrl}/api/auth/google/start?returnTo=${encodeURIComponent(
        "https://hachozeh.com/markets/abc"
      )}`,
      {
        redirect: "manual"
      }
    );
    const state = new URL(startResponse.headers.get("location") || "").searchParams.get("state");
    const callbackResponse = await fetch(
      `${baseUrl}/api/auth/google/callback?error=access_denied&state=${encodeURIComponent(
        state || ""
      )}`,
      {
        redirect: "manual"
      }
    );
    const location = new URL(callbackResponse.headers.get("location") || "");

    expect(callbackResponse.status).toBe(302);
    expect(location.origin).toBe("https://hachozeh.com");
    expect(location.pathname).toBe("/markets/abc");
    expect(location.searchParams.get("auth_error")).toBe("google");
    expect(location.searchParams.get("auth_error_code")).toBe("access_denied");
  });

  it("returns unauthorized for current-user read without a real session", async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/api/me`);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(payload).toEqual({
      error: {
        code: "unauthorized",
        message: "Authentication is required."
      }
    });
  });

  it("returns current-user payload for an authenticated session", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql.includes("from sessions s")) {
          expect(values).toEqual([expect.any(String)]);

          return {
            rows: [
              {
                session_id: "session_1",
                user_id: "user_1",
                session_status: "active",
                created_at: new Date(Date.now() - 3_600_000),
                expires_at: new Date(Date.now() + 60_000),
                user_status: "active",
                user_role: "user"
              }
            ]
          };
        }

        if (sql.includes("update sessions")) {
          return {
            rows: []
          };
        }

        if (sql.includes("from users u")) {
          expect(values).toEqual(["user_1"]);

          return {
            rows: [
              {
                user_id: "user_1",
                user_status: "active",
                user_role: "user",
                trade_access_status: "enabled",
                lock_reason_code: null,
                locked_at: null,
                created_at: new Date("2026-04-05T10:00:00.000Z"),
                last_login_at: new Date("2026-04-05T10:15:00.000Z"),
                handle: "reader",
                display_name: "Reader",
                bio: null,
                avatar_url: null,
                showcase_categories: [],
                identity_type: "email",
                identifier_display: "reader@example.com",
                verified_at: new Date("2026-04-05T10:12:00.000Z")
              }
            ]
          };
        }

        if (sql.includes("from realization_events")) {
          expect(values).toEqual(["user_1"]);

          return {
            rows: [{ successful_return_count: "0" }]
          };
        }

        if (sql.includes("from user_verification_tier_purchases")) {
          expect(values).toEqual(["user_1"]);

          return {
            rows: []
          };
        }

        if (sql.includes("from user_follows")) {
          expect(values).toEqual(["user_1"]);

          return {
            rows: [{ follower_count: 0, following_count: 0 }]
          };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected db query in app test: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/api/me`, {
      headers: {
        cookie: "navi_session=live"
      }
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      user: {
        userId: "user_1",
        status: "active",
        role: "user",
        tradeAccessStatus: "enabled",
        lockReasonCode: null,
        lockedAt: null,
        createdAt: "2026-04-05T10:00:00.000Z",
        lastLoginAt: "2026-04-05T10:15:00.000Z",
        handle: "reader",
        displayName: "Reader",
        bio: null,
        avatarUrl: null,
        showcaseCategories: []
      },
      identity: {
        primary: {
          channel: "email",
          identifierHint: "re***@e***.com",
          email: "reader@example.com",
          verifiedAt: "2026-04-05T10:12:00.000Z"
        }
      },
      capabilities: {
        canTrade: true,
        canAccessAdmin: false
      },
      social: {
        followerCount: 0,
        followingCount: 0
      },
      reputation: {
        verification: {
          successfulReturns: 0,
          currentTier: null,
          purchasedTiers: [],
          tiers: [
            {
              tier: "gray",
              minSuccessfulReturns: 10,
              price: "5000.000000",
              label: "תג אפור",
              badgeLabel: "אפור"
            },
            {
              tier: "gold",
              minSuccessfulReturns: 20,
              price: "5000.000000",
              label: "תג זהב",
              badgeLabel: "זהב"
            },
            {
              tier: "diamond",
              minSuccessfulReturns: 50,
              price: "10000.000000",
              label: "תג יהלום",
              badgeLabel: "יהלום"
            }
          ],
          nextPurchase: {
            tier: "gray",
            label: "תג אפור",
            price: "5000.000000",
            minSuccessfulReturns: 10,
            progressSuccessfulReturns: 0,
            requiredSuccessfulReturns: 10,
            eligible: false,
            missingSuccessfulReturns: 10
          }
        }
      }
    });
  });

  it("serves data export as a non-cacheable attachment with a sanitized filename", async () => {
    const userId = "user_bad\"\r\nx-evil: 1";
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql.includes("from sessions s")) {
          expect(values).toEqual([expect.any(String)]);

          return {
            rows: [
              {
                session_id: "session_1",
                user_id: userId,
                session_status: "active",
                created_at: new Date(Date.now() - 3_600_000),
                expires_at: new Date(Date.now() + 60_000),
                user_status: "active",
                user_role: "user"
              }
            ]
          };
        }

        if (sql.includes("update sessions")) {
          return { rows: [] };
        }

        expect(values).toEqual([userId]);

        if (sql.includes("from users") && sql.includes("last_login_at")) {
          return {
            rows: [
              {
                id: userId,
                status: "active",
                role: "user",
                trade_access_status: "enabled",
                display_name: "Reader",
                bio: null,
                avatar_url: null,
                created_at: new Date("2026-04-05T10:00:00.000Z"),
                updated_at: new Date("2026-04-05T10:00:00.000Z"),
                last_login_at: null
              }
            ]
          };
        }

        if (
          sql.includes("from user_identities") ||
          sql.includes("from community_discussions") ||
          sql.includes("from community_comments") ||
          sql.includes("from community_posts") ||
          sql.includes("from user_social_links") ||
          sql.includes("from user_consents") ||
          sql.includes("from notification_preferences") ||
          sql.includes("from market_comments") ||
          sql.includes("from feedback") ||
          sql.includes("from user_follows") ||
          sql.includes("from user_profile_views_daily") ||
          sql.includes("from accounts") ||
          sql.includes("from positions") ||
          sql.includes("from contract_positions") ||
          sql.includes("from trades")
        ) {
          return { rows: [] };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }

        throw new Error(`Unexpected db query in data export route test: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/api/me/data-export`, {
      headers: {
        cookie: "navi_session=live"
      }
    });
    const payload = await response.json();
    const contentDisposition = response.headers.get("content-disposition") || "";

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("expires")).toBe("0");
    expect(contentDisposition).toBe(
      'attachment; filename="hachozeh-data-export-user_bad_x-evil_1.json"'
    );
    expect(contentDisposition).not.toContain("\r");
    expect(contentDisposition).not.toContain("\n");
    expect(response.headers.get("x-evil")).toBeNull();
    expect(payload.schema).toBe("hachozeh_user_data_export_v1");
  });

  it("checks handle availability for an authenticated session", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql.includes("from sessions s")) {
          expect(values).toEqual([expect.any(String)]);

          return {
            rows: [
              {
                session_id: "session_1",
                user_id: "user_1",
                session_status: "active",
                created_at: new Date(Date.now() - 3_600_000),
                expires_at: new Date(Date.now() + 60_000),
                user_status: "active",
                user_role: "user"
              }
            ]
          };
        }

        if (sql.includes("update sessions")) {
          return { rows: [] };
        }

        if (sql.includes("from users") && sql.includes("where handle = $1")) {
          expect(values).toEqual(["mrbz"]);
          return { rows: [{ id: "user_other" }] };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected db query in app test: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/api/me/profile/handle-availability?handle=@MrBz`, {
      headers: {
        cookie: "navi_session=live"
      }
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      handle: "mrbz",
      available: false,
      reason: "taken"
    });
  });

  it("returns current-user session summary for an authenticated session", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql.includes("from sessions current_session")) {
          expect(values).toEqual(["session_1", "user_1", "30 minutes"]);

          return {
            rows: [
              {
                current_expires_at: new Date("2026-04-12T09:00:00.000Z"),
                current_last_seen_at: new Date("2026-04-07T10:00:00.000Z"),
                active_session_count: 2,
                summary_last_seen_at: new Date("2026-04-07T10:05:00.000Z")
              }
            ]
          };
        }

        if (sql.includes("from sessions") && sql.includes("order by (id = $2) desc")) {
          expect(values).toEqual(["user_1", "session_1", "30 minutes"]);

          return {
            rows: [
              {
                id: "session_1",
                created_at: new Date("2026-04-07T09:00:00.000Z"),
                last_seen_at: new Date("2026-04-07T10:00:00.000Z"),
                expires_at: new Date("2026-04-12T09:00:00.000Z")
              },
              {
                id: "session_2",
                created_at: new Date("2026-04-07T09:30:00.000Z"),
                last_seen_at: new Date("2026-04-07T10:05:00.000Z"),
                expires_at: new Date("2026-04-12T09:30:00.000Z")
              }
            ]
          };
        }

        if (sql.includes("from audit_events")) {
          expect(values).toEqual(["user_1"]);

          return {
            rows: [
              {
                action: "user.session.revoke_other_sessions",
                created_at: new Date("2026-04-07T10:10:00.000Z"),
                actor_id: "user_1"
              }
            ]
          };
        }

        if (sql.includes("from sessions s")) {
          expect(values).toEqual([expect.any(String)]);

          return {
            rows: [
              {
                session_id: "session_1",
                user_id: "user_1",
                session_status: "active",
                created_at: new Date(Date.now() - 3_600_000),
                expires_at: new Date(Date.now() + 60_000),
                user_status: "active",
                user_role: "user"
              }
            ]
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
        throw new Error(`Unexpected db query in app test: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/api/me/sessions`, {
      headers: {
        cookie: "navi_session=live"
      }
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      summary: {
        activeCount: 2,
        hasOtherActiveSessions: true,
        lastSeenAt: "2026-04-07T10:05:00.000Z"
      },
      currentSession: {
        id: "session_1",
        expiresAt: "2026-04-12T09:00:00.000Z",
        lastSeenAt: "2026-04-07T10:00:00.000Z"
      },
      sessions: [
        {
          id: "session_1",
          label: "המכשיר הזה",
          current: true,
          createdAt: "2026-04-07T09:00:00.000Z",
          lastSeenAt: "2026-04-07T10:00:00.000Z",
          expiresAt: "2026-04-12T09:00:00.000Z"
        },
        {
          id: "session_2",
          label: "מכשיר 2",
          current: false,
          createdAt: "2026-04-07T09:30:00.000Z",
          lastSeenAt: "2026-04-07T10:05:00.000Z",
          expiresAt: "2026-04-12T09:30:00.000Z"
        }
      ],
      recentSecurityActions: [
        {
          action: "user.session.revoke_other_sessions",
          createdAt: "2026-04-07T10:10:00.000Z",
          actorId: "user_1"
        }
      ]
    });
  });

  it("maps verification tier purchase service errors for authenticated users", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql.includes("from sessions s")) {
          expect(values).toEqual([expect.any(String)]);

          return {
            rows: [
              {
                session_id: "session_1",
                user_id: "user_1",
                session_status: "active",
                created_at: new Date(Date.now() - 3_600_000),
                expires_at: new Date(Date.now() + 60_000),
                user_status: "active",
                user_role: "user"
              }
            ]
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

        throw new Error(`Unexpected db query in verification purchase route test: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/api/me/verification-tier/purchase`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "navi_session=live"
      },
      body: JSON.stringify({ tier: "platinum" })
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      error: {
        code: "invalid_tier",
        message: "A valid verification tier is required."
      }
    });
  });

  it("revokes other current-user sessions while keeping the current one alive", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql === "begin" || sql === "commit" || sql === "rollback") {
          return {
            rows: []
          };
        }

        if (sql.includes("from sessions s")) {
          expect(values).toEqual([expect.any(String)]);

          return {
            rows: [
              {
                session_id: "session_1",
                user_id: "user_1",
                session_status: "active",
                created_at: new Date(Date.now() - 3_600_000),
                expires_at: new Date(Date.now() + 60_000),
                user_status: "active",
                user_role: "user"
              }
            ]
          };
        }

        if (sql.includes("set last_seen_at = now()")) {
          expect(values).toEqual(["session_1", expect.any(String)]);

          return {
            rows: []
          };
        }

        if (sql.includes("where id = $1") && sql.includes("for update")) {
          expect(values).toEqual(["session_1", "user_1"]);

          return {
            rows: [{ id: "session_1" }]
          };
        }

        if (sql.includes("revoked_reason = 'self_revoke_other_sessions'")) {
          expect(values).toEqual(["user_1", "session_1"]);

          return {
            rows: [],
            rowCount: 2
          };
        }

        if (sql.includes("insert into audit_events")) {
          expect(values?.[1]).toBe("user_1");
          expect(values?.[2]).toBe("user.session.revoke_other_sessions");

          return {
            rows: []
          };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected db query in app test: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/api/me/sessions/revoke-others`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "navi_session=live"
      },
      body: JSON.stringify({})
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      userId: "user_1",
      revokedSessionCount: 2,
      revokedAt: expect.any(String),
      auditEventId: expect.stringMatching(/^audit_/)
    });
  });

  it("verifies an OTP challenge and sets a session cookie", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql === "begin" || sql === "commit" || sql === "rollback") {
          return { rows: [] };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes("from otp_challenges")) {
          expect(values).toEqual(["otp_live_1"]);
          return {
            rows: [
              {
                id: "otp_live_1",
                identifier_type: "email",
                identifier_normalized: "reader@example.com",
                purpose: "login",
                code_hash: hashValue("111111"),
                status: "pending",
                attempt_count: 0,
                max_attempts: 5,
                last_sent_at: new Date(),
                expires_at: new Date(Date.now() + 60_000)
              }
            ]
          };
        }

        if (sql.includes("set status = 'consumed'")) {
          expect(values).toEqual(["otp_live_1"]);
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes("from user_identities ui") && sql.includes("ui.type = $1")) {
          expect(values).toEqual(["email", "reader@example.com"]);
          return {
            rows: [
              {
                identity_id: "identity_1",
                user_id: "user_1",
                user_status: "active"
              }
            ]
          };
        }

        if (
          sql.includes("from user_identities ui") &&
          sql.includes("ui.type = 'google'") &&
          sql.includes("lower(ui.identifier_display)")
        ) {
          expect(values).toEqual(["reader@example.com"]);
          return {
            rows: []
          };
        }

        if (sql.includes("insert into sessions")) {
          expect(values?.[1]).toBe("user_1");
          return { rows: [] };
        }

        if (sql.includes("set last_login_at = now()")) {
          expect(values).toEqual(["user_1"]);
          return { rows: [] };
        }

        throw new Error(`Unexpected db query in verify test: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/api/auth/verify`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://127.0.0.1:6969"
      },
      body: JSON.stringify({
        challengeId: "otp_live_1",
        code: "111111"
      })
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:6969");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(response.headers.get("set-cookie")).toContain("navi_session=");
    expect(payload).toMatchObject({
      actor: {
        userId: "user_1"
      },
      session: {
        authenticated: true
      },
      identity: {
        channel: "email",
        identifierHint: "re***@e***.com"
      }
    });
  });

  it("logs out and clears the session cookie", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string) => {
        if (sql.includes("update sessions") && sql.includes("revoked_reason = 'user_logout'")) {
          return { rows: [] };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }

        throw new Error(`Unexpected db query in logout test: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: {
        cookie: "navi_session=live"
      }
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("navi_session=");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(payload).toEqual({
      actor: null,
      session: {
        authenticated: false,
        expiresAt: null
      },
      identity: null
    });
  });

  it("clears stale current-user sessions", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string) => {
        if (sql.includes("from sessions s")) {
          return { rows: [] };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }

        throw new Error(`Unexpected db query in stale current-user test: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/api/me`, {
      headers: {
        cookie: "navi_session=stale"
      }
    });
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toContain("navi_session=");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(payload).toEqual({
      error: {
        code: "unauthorized",
        message: "Session is invalid or expired."
      }
    });
  });

  it("returns anonymous session summary without cookie", async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/api/session`, {
      headers: {
        origin: "http://127.0.0.1:6969"
      }
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:6969");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(payload).toEqual({
      actor: null,
      session: {
        authenticated: false,
        expiresAt: null
      },
      identity: null
    });
  });

  it("clears stale session cookie on anonymous session summary", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string) => {
        if (sql.includes("from sessions s")) {
          return {
            rows: []
          };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected db query in app test: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/api/session`, {
      headers: {
        cookie: "navi_session=stale"
      }
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.session.authenticated).toBe(false);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
