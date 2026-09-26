import { describe, expect, it, vi } from "vitest";
import { createSign, generateKeyPairSync } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Pool } from "pg";

import type { AppEnv } from "../../src/config/env";
import {
  buildGoogleAuthStartRedirect,
  completeGoogleAuthCallback
} from "../../src/auth/google-oauth-service";

const BASE_ENV: AppEnv = {
  serviceName: "navi-backend",
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 3001,
  logLevel: "info",
  auth: {
    sessionCookieName: "navi_session",
    sessionTtlHours: 24 * 7,
    otpTtlMinutes: 10,
    otpResendCooldownSeconds: 30,
    otpMaxAttempts: 5,
    devOtpCode: "111111"
  },
  googleAuth: {
    clientId: "google-client-id",
    clientSecret: "google-client-secret",
    redirectUri: "http://127.0.0.1:3001/api/auth/google/callback",
    stateSecret: "test-state-secret"
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
    connectTimeoutMs: 1500
  }
};

const GOOGLE_KEY_ID = "test-google-key-1";
const GOOGLE_KEY_PAIR = generateKeyPairSync("rsa", {
  modulusLength: 2048
});
const GOOGLE_PUBLIC_JWK = {
  ...GOOGLE_KEY_PAIR.publicKey.export({ format: "jwk" }),
  alg: "RS256",
  kid: GOOGLE_KEY_ID,
  use: "sig"
};

function createRequest(): IncomingMessage {
  return {
    headers: {
      "user-agent": "vitest",
      "x-forwarded-for": "127.0.0.1"
    },
    socket: {
      remoteAddress: "127.0.0.1"
    }
  } as IncomingMessage;
}

function encodeJwtPart(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function readStatePayload(state: string): {
  codeVerifier: string;
  nonce: string;
  returnTo: string;
} {
  const [payload] = state.split(".");

  return JSON.parse(Buffer.from(payload || "", "base64url").toString("utf8"));
}

function createGoogleIdToken(input: {
  alg?: string;
  aud?: string;
  email?: string;
  emailVerified?: boolean;
  expiresAt?: number;
  issuer?: string;
  kid?: string;
  name?: string;
  nonce: string;
  omitEmail?: boolean;
  omitExp?: boolean;
  omitKid?: boolean;
  omitSub?: boolean;
  picture?: string;
  sub?: string;
}): string {
  const headerFields: Record<string, unknown> = {
    alg: input.alg ?? "RS256",
    typ: "JWT"
  };

  if (!input.omitKid) {
    headerFields.kid = input.kid ?? GOOGLE_KEY_ID;
  }

  const header = encodeJwtPart(headerFields);
  const claims: Record<string, unknown> = {
    iss: input.issuer ?? "https://accounts.google.com",
    aud: input.aud ?? BASE_ENV.googleAuth?.clientId,
    iat: Math.floor(Date.now() / 1000),
    nonce: input.nonce,
    email_verified: input.emailVerified ?? true
  };

  if (!input.omitExp) {
    claims.exp = input.expiresAt ?? Math.floor(Date.now() / 1000) + 600;
  }

  if (!input.omitSub) {
    claims.sub = input.sub ?? "google-sub-1";
  }

  if (!input.omitEmail) {
    claims.email = input.email ?? "User@example.com";
  }

  if (input.name) {
    claims.name = input.name;
  }

  if (input.picture) {
    claims.picture = input.picture;
  }

  const payload = encodeJwtPart(claims);
  const signer = createSign("RSA-SHA256");

  signer.update(`${header}.${payload}`);
  signer.end();

  return `${header}.${payload}.${signer.sign(GOOGLE_KEY_PAIR.privateKey).toString("base64url")}`;
}

function createGoogleFetch(input: {
  idToken?: string;
  state: string;
}) {
  const statePayload = readStatePayload(input.state);
  const idToken = input.idToken ?? createGoogleIdToken({ nonce: statePayload.nonce });

  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    const href = String(url);

    if (href === "https://oauth2.googleapis.com/token") {
      const body = init?.body instanceof URLSearchParams ? init.body : new URLSearchParams(String(init?.body || ""));

      expect(body.get("code_verifier")).toBe(statePayload.codeVerifier);

      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "google-access-token",
          id_token: idToken,
          token_type: "Bearer"
        })
      } as Response;
    }

    if (href === "https://www.googleapis.com/oauth2/v3/certs") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          keys: [GOOGLE_PUBLIC_JWK]
        })
      } as Response;
    }

    throw new Error(`Unexpected fetch URL: ${href}`);
  });
}

function createPoolForNewGoogleUser() {
  const insertedIdentities: unknown[][] = [];
  const client = {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql === "begin" || sql === "commit" || sql === "rollback") {
        return { rows: [] };
      }

      if (sql.includes("from user_identities ui")) {
        return { rows: [] };
      }

      if (sql.includes("insert into users")) {
        return { rows: [] };
      }

      if (sql.includes("insert into user_identities")) {
        insertedIdentities.push(values ?? []);
        return { rows: [] };
      }

      if (sql.includes("insert into user_consents")) {
        return { rows: [] };
      }

      if (sql.includes("insert into accounts")) {
        return { rows: [] };
      }

      if (sql.includes("select pg_advisory_xact_lock")) {
        return { rows: [] };
      }

      if (sql.includes("from accounts") && sql.includes("where type = $1")) {
        return {
          rows: [{
            id: "account_platform_treasury",
            type: values?.[0],
            status: "active",
            balance_cached: "790000.000000"
          }]
        };
      }

      if (sql.includes("where id = $1") && sql.includes("for update")) {
        return {
          rows: [{ id: values?.[0], type: "user_cash", status: "active", balance_cached: "0.000000" }]
        };
      }

      if (sql.includes("from ledger_transactions")) {
        return {
          rows: [{ sequence_number: "4", transaction_hash: "seed-hash-004" }]
        };
      }

      if (
        sql.includes("insert into ledger_transactions") ||
        sql.includes("insert into ledger_entries") ||
        sql.includes("insert into retention_events") ||
        sql.includes("update accounts")
      ) {
        return { rows: [] };
      }

      if (sql.includes("insert into sessions")) {
        return { rows: [] };
      }

      if (sql.includes("count(distinct user_id)::text as user_count")) {
        return { rows: [{ user_count: "1" }] };
      }

      if (sql.includes("update users")) {
        return { rows: [] };
      }

      if (sql.includes("insert into user_notifications")) {
        return { rows: [] };
      }

      if (
        sql.startsWith("savepoint") ||
        sql.startsWith("rollback to savepoint") ||
        sql.startsWith("release savepoint")
      ) {
        return { rows: [], rowCount: 0 };
      }

      if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }),
    release: vi.fn()
  };

  return {
    pool: {
      connect: vi.fn(async () => client)
    } as unknown as Pool,
    client,
    insertedIdentities
  };
}

describe("google oauth service", () => {
  it("builds a Google auth redirect that preserves a safe return target", () => {
    const redirect = buildGoogleAuthStartRedirect(
      BASE_ENV,
      "/markets/abc"
    );
    const url = new URL(redirect);

    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("client_id")).toBe("google-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://127.0.0.1:3001/api/auth/google/callback"
    );
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("nonce")).toEqual(expect.any(String));
    expect(url.searchParams.get("code_challenge")).toEqual(expect.any(String));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toEqual(expect.any(String));
  });

  it("falls back to the public base URL for unsafe return targets", async () => {
    const { pool } = createPoolForNewGoogleUser();
    const startRedirect = buildGoogleAuthStartRedirect(
      BASE_ENV,
      "https://evil.example/phish"
    );
    const state = new URL(startRedirect).searchParams.get("state") ?? "";

    const result = await completeGoogleAuthCallback(
      pool,
      BASE_ENV,
      createRequest(),
      {
        code: "google-code",
        state
      },
      {
        fetch: createGoogleFetch({ state })
      }
    );

    expect(result.returnTo).toBe("http://127.0.0.1:6969/trending");
  });

  it("rejects signed OAuth state with trailing token data", async () => {
    const { pool } = createPoolForNewGoogleUser();
    const startRedirect = buildGoogleAuthStartRedirect(BASE_ENV, "/markets/abc");
    const state = new URL(startRedirect).searchParams.get("state") ?? "";
    const fetchImpl = vi.fn();

    await expect(
      completeGoogleAuthCallback(
        pool,
        BASE_ENV,
        createRequest(),
        {
          code: "google-code",
          state: `${state}.trailing`
        },
        {
          fetch: fetchImpl
        }
      )
    ).rejects.toMatchObject({
      code: "invalid_oauth_state",
      statusCode: 400
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects oversized OAuth state before token exchange or DB work", async () => {
    const { pool } = createPoolForNewGoogleUser();
    const fetchImpl = vi.fn();

    await expect(
      completeGoogleAuthCallback(
        pool,
        BASE_ENV,
        createRequest(),
        {
          code: "google-code",
          state: `${"a".repeat(4097)}.signature`
        },
        {
          fetch: fetchImpl
        }
      )
    ).rejects.toMatchObject({
      code: "invalid_oauth_state",
      statusCode: 400
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("creates a first Google user through the existing session spine", async () => {
    const { pool, insertedIdentities } = createPoolForNewGoogleUser();
    const startRedirect = buildGoogleAuthStartRedirect(
      BASE_ENV,
      "/markets/abc"
    );
    const state = new URL(startRedirect).searchParams.get("state") ?? "";

    const result = await completeGoogleAuthCallback(
      pool,
      BASE_ENV,
      createRequest(),
      {
        code: "google-code",
        state
      },
      {
        fetch: createGoogleFetch({ state })
      }
    );

    expect(result.returnTo).toBe(
      "http://127.0.0.1:6969/markets/abc"
    );
    expect(result.payload.session.authenticated).toBe(true);
    expect(result.payload.authResult).toEqual({
      createdUser: true,
      starterGrantAmount: "1000.000000"
    });
    expect(result.setCookie).toContain("navi_session=");
    expect(insertedIdentities[0]?.[2]).toBe("google");
    expect(insertedIdentities[0]?.[3]).toBe("google-sub-1");
    expect(insertedIdentities[0]?.[4]).toBe("user@example.com");
  });

  it("does not publish Google profile name or photo while creating the public account", async () => {
    const { pool, client } = createPoolForNewGoogleUser();
    const startRedirect = buildGoogleAuthStartRedirect(BASE_ENV, "/markets/abc");
    const state = new URL(startRedirect).searchParams.get("state") ?? "";
    const { nonce } = readStatePayload(state);

    await completeGoogleAuthCallback(
      pool,
      BASE_ENV,
      createRequest(),
      {
        code: "google-code",
        state
      },
      {
        fetch: createGoogleFetch({
          state,
          idToken: createGoogleIdToken({
            nonce,
            name: "Real Google Name",
            picture: "https://lh3.googleusercontent.com/private-photo"
          })
        })
      }
    );

    const createUserCall = client.query.mock.calls.find(([sql]) =>
      String(sql).includes("insert into users")
    );

    expect(String(createUserCall?.[0])).not.toContain("display_name");
    expect(String(createUserCall?.[0])).not.toContain("avatar_url");
    expect(createUserCall?.[1]).toHaveLength(2);
    expect(JSON.stringify(client.query.mock.calls)).not.toContain("Real Google Name");
    expect(JSON.stringify(client.query.mock.calls)).not.toContain("lh3.googleusercontent.com");
  });

  it("rejects a Google ID token when the nonce does not match signed state", async () => {
    const { pool } = createPoolForNewGoogleUser();
    const startRedirect = buildGoogleAuthStartRedirect(
      BASE_ENV,
      "/markets/abc"
    );
    const state = new URL(startRedirect).searchParams.get("state") ?? "";

    await expect(
      completeGoogleAuthCallback(
        pool,
        BASE_ENV,
        createRequest(),
        {
          code: "google-code",
          state
        },
        {
          fetch: createGoogleFetch({
            state,
            idToken: createGoogleIdToken({ nonce: "wrong-nonce" })
          })
        }
      )
    ).rejects.toMatchObject({
      code: "google_email_unverified",
      statusCode: 403
    });
  });

  it.each([
    {
      name: "the audience does not match this app",
      createIdToken: (nonce: string) => createGoogleIdToken({ aud: "other-client-id", nonce }),
      expectedCode: "google_email_unverified",
      expectedStatusCode: 403
    },
    {
      name: "the issuer is not Google",
      createIdToken: (nonce: string) => createGoogleIdToken({ issuer: "https://evil.example", nonce }),
      expectedCode: "google_email_unverified",
      expectedStatusCode: 403
    },
    {
      name: "the token is expired",
      createIdToken: (nonce: string) => createGoogleIdToken({
        expiresAt: Math.floor(Date.now() / 1000) - 60,
        nonce
      }),
      expectedCode: "google_email_unverified",
      expectedStatusCode: 403
    },
    {
      name: "the token does not include a subject",
      createIdToken: (nonce: string) => createGoogleIdToken({ nonce, omitSub: true }),
      expectedCode: "google_email_unverified",
      expectedStatusCode: 403
    },
    {
      name: "Google has not verified the email",
      createIdToken: (nonce: string) => createGoogleIdToken({ emailVerified: false, nonce }),
      expectedCode: "google_email_unverified",
      expectedStatusCode: 403
    },
    {
      name: "Google returns an unknown key id",
      createIdToken: (nonce: string) => createGoogleIdToken({ kid: "missing-google-key", nonce }),
      expectedCode: "google_auth_failed",
      expectedStatusCode: 502
    },
    {
      name: "the token does not include a key id",
      createIdToken: (nonce: string) => createGoogleIdToken({ nonce, omitKid: true }),
      expectedCode: "google_auth_failed",
      expectedStatusCode: 502
    },
    {
      name: "the token uses an unsupported signing algorithm",
      createIdToken: (nonce: string) => createGoogleIdToken({ alg: "RS384", nonce }),
      expectedCode: "google_auth_failed",
      expectedStatusCode: 502
    },
    {
      name: "the token signature is malformed",
      createIdToken: (nonce: string) => {
        const [header, payload] = createGoogleIdToken({ nonce }).split(".");

        return `${header}.${payload}.bad-signature`;
      },
      expectedCode: "google_auth_failed",
      expectedStatusCode: 502
    }
  ])("rejects a Google ID token when $name", async ({
    createIdToken,
    expectedCode,
    expectedStatusCode
  }) => {
    const { pool } = createPoolForNewGoogleUser();
    const startRedirect = buildGoogleAuthStartRedirect(
      BASE_ENV,
      "/markets/abc"
    );
    const state = new URL(startRedirect).searchParams.get("state") ?? "";
    const { nonce } = readStatePayload(state);

    await expect(
      completeGoogleAuthCallback(
        pool,
        BASE_ENV,
        createRequest(),
        {
          code: "google-code",
          state
        },
        {
          fetch: createGoogleFetch({
            state,
            idToken: createIdToken(nonce)
          })
        }
      )
    ).rejects.toMatchObject({
      code: expectedCode,
      statusCode: expectedStatusCode
    });
  });
});
