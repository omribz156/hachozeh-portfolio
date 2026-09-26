import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { assertProductionInvariants, loadAppEnv } from "../../src/config/env";
import type { AppEnv } from "../../src/config/env";

const ORIGINAL_DB_PORT = process.env.DB_PORT;
const ORIGINAL_DB_CONNECT_TIMEOUT_MS = process.env.DB_CONNECT_TIMEOUT_MS;
const ORIGINAL_DB_STATEMENT_TIMEOUT_MS = process.env.DB_STATEMENT_TIMEOUT_MS;
const ORIGINAL_DB_QUERY_TIMEOUT_MS = process.env.DB_QUERY_TIMEOUT_MS;
const ORIGINAL_DB_LOCK_TIMEOUT_MS = process.env.DB_LOCK_TIMEOUT_MS;
const ORIGINAL_DB_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS =
  process.env.DB_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS;
const ORIGINAL_DB_POOL_MAX = process.env.DB_POOL_MAX;
const ORIGINAL_AUTH_SESSION_COOKIE_NAME = process.env.AUTH_SESSION_COOKIE_NAME;
const ORIGINAL_CORS_ALLOWED_ORIGINS = process.env.CORS_ALLOWED_ORIGINS;

afterEach(() => {
  if (ORIGINAL_DB_PORT === undefined) {
    delete process.env.DB_PORT;
  } else {
    process.env.DB_PORT = ORIGINAL_DB_PORT;
  }

  if (ORIGINAL_DB_CONNECT_TIMEOUT_MS === undefined) {
    delete process.env.DB_CONNECT_TIMEOUT_MS;
  } else {
    process.env.DB_CONNECT_TIMEOUT_MS = ORIGINAL_DB_CONNECT_TIMEOUT_MS;
  }

  if (ORIGINAL_DB_STATEMENT_TIMEOUT_MS === undefined) {
    delete process.env.DB_STATEMENT_TIMEOUT_MS;
  } else {
    process.env.DB_STATEMENT_TIMEOUT_MS = ORIGINAL_DB_STATEMENT_TIMEOUT_MS;
  }

  if (ORIGINAL_DB_QUERY_TIMEOUT_MS === undefined) {
    delete process.env.DB_QUERY_TIMEOUT_MS;
  } else {
    process.env.DB_QUERY_TIMEOUT_MS = ORIGINAL_DB_QUERY_TIMEOUT_MS;
  }

  if (ORIGINAL_DB_LOCK_TIMEOUT_MS === undefined) {
    delete process.env.DB_LOCK_TIMEOUT_MS;
  } else {
    process.env.DB_LOCK_TIMEOUT_MS = ORIGINAL_DB_LOCK_TIMEOUT_MS;
  }

  if (ORIGINAL_DB_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS === undefined) {
    delete process.env.DB_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS;
  } else {
    process.env.DB_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS =
      ORIGINAL_DB_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS;
  }

  if (ORIGINAL_DB_POOL_MAX === undefined) {
    delete process.env.DB_POOL_MAX;
  } else {
    process.env.DB_POOL_MAX = ORIGINAL_DB_POOL_MAX;
  }

  if (ORIGINAL_AUTH_SESSION_COOKIE_NAME === undefined) {
    delete process.env.AUTH_SESSION_COOKIE_NAME;
  } else {
    process.env.AUTH_SESSION_COOKIE_NAME = ORIGINAL_AUTH_SESSION_COOKIE_NAME;
  }

  if (ORIGINAL_CORS_ALLOWED_ORIGINS === undefined) {
    delete process.env.CORS_ALLOWED_ORIGINS;
  } else {
    process.env.CORS_ALLOWED_ORIGINS = ORIGINAL_CORS_ALLOWED_ORIGINS;
  }
});

describe("loadAppEnv", () => {
  it("defaults DB_PORT to the repo compose postgres host port", () => {
    delete process.env.DB_PORT;

    const env = loadAppEnv();

    expect(env.db.port).toBe(55432);
  });

  it("defaults DB pool settings for local stress without fast acquire timeouts", () => {
    delete process.env.DB_CONNECT_TIMEOUT_MS;
    delete process.env.DB_POOL_MAX;

    const env = loadAppEnv();

    expect(env.db.connectTimeoutMs).toBe(10000);
    expect(env.db.statementTimeoutMs).toBe(30000);
    expect(env.db.queryTimeoutMs).toBe(35000);
    expect(env.db.lockTimeoutMs).toBe(10000);
    expect(env.db.idleInTransactionSessionTimeoutMs).toBe(60000);
    expect(env.db.poolMax).toBe(30);
  });

  it("accepts safe custom session cookie names", () => {
    process.env.AUTH_SESSION_COOKIE_NAME = "__Host-navi_session";

    const env = loadAppEnv();

    expect(env.auth.sessionCookieName).toBe("__Host-navi_session");
  });

  it.each(["bad;name", "bad=name", "bad name", "bad\nname"])(
    "rejects unsafe session cookie name %s",
    (cookieName) => {
      process.env.AUTH_SESSION_COOKIE_NAME = cookieName;

      expect(() => loadAppEnv()).toThrow("Invalid cookie name env: AUTH_SESSION_COOKIE_NAME");
    }
  );
});

// ---------------------------------------------------------------------------
// assertProductionInvariants
// ---------------------------------------------------------------------------

/** Minimal valid production AppEnv — all invariants satisfied. */
function makeProductionEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    serviceName: "navi-backend",
    nodeEnv: "production",
    deployEnv: "production",
    host: "0.0.0.0",
    port: 3001,
    logLevel: "info",
    auth: {
      sessionCookieName: "navi_session",
      sessionTtlHours: 168,
      otpTtlMinutes: 10,
      otpResendCooldownSeconds: 30,
      otpMaxAttempts: 5,
      devOtpCode: "111111",
      devOtpExposed: false
    },
    mail: {
      resendApiKey: "re_live_abc123",
      from: "Hachozeh <noreply@email.hachozeh.com>"
    },
    actorMode: {
      demoEnabled: false,
      demoActorId: "seed_user_1"
    },
    trading: {
      requireSession: true
    },
    publicBaseUrl: "https://hachozeh.com/trending",
    db: {
      host: "127.0.0.1",
      port: 55432,
      name: "navi",
      user: "navi",
      password: "s3cr3t-prod-pass",
      connectTimeoutMs: 10000,
      statementTimeoutMs: 30000,
      queryTimeoutMs: 35000,
      lockTimeoutMs: 10000,
      idleInTransactionSessionTimeoutMs: 60000,
      poolMax: 30
    },
    ...overrides
  };
}

describe("assertProductionInvariants", () => {
  beforeEach(() => {
    delete process.env.CORS_ALLOWED_ORIGINS;
  });

  it("does not throw for a fully valid production env", () => {
    expect(() => assertProductionInvariants(makeProductionEnv())).not.toThrow();
  });

  it("is a no-op outside production", () => {
    const devEnv = makeProductionEnv({ nodeEnv: "development" });
    // demo enabled + trivial password — none of it matters outside production
    devEnv.actorMode.demoEnabled = true;
    devEnv.db.password = "navi";
    expect(() => assertProductionInvariants(devEnv)).not.toThrow();
  });

  it("refuses production when demo actor is enabled", () => {
    const env = makeProductionEnv();
    env.actorMode.demoEnabled = true;
    expect(() => assertProductionInvariants(env)).toThrow(
      "DEMO_ACTOR_MODE_ENABLED must be false in production"
    );
  });

  it("refuses production when dev OTP is exposed", () => {
    const env = makeProductionEnv();
    env.auth.devOtpExposed = true;
    expect(() => assertProductionInvariants(env)).toThrow(
      "AUTH_DEV_OTP_EXPOSED must be false in production"
    );
  });

  it("refuses production when resend API key is missing", () => {
    const env = makeProductionEnv();
    env.mail.resendApiKey = "";
    expect(() => assertProductionInvariants(env)).toThrow(
      "RESEND_API_KEY must be set in production"
    );
  });

  it("refuses production when PUBLIC_BASE_URL is not the real domain", () => {
    const env = makeProductionEnv({
      publicBaseUrl: "https://dev.hachozeh.com/trending"
    });

    expect(() => assertProductionInvariants(env)).toThrow(
      "PUBLIC_BASE_URL must use https://hachozeh.com in production"
    );
  });

  it("accepts staging deploy env on the staging origin", () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://staging.hachozeh.com";
    const env = makeProductionEnv({
      deployEnv: "staging",
      publicBaseUrl: "https://staging.hachozeh.com/trending",
      googleAuth: {
        clientId: "google-client-id",
        clientSecret: "google-client-secret",
        redirectUri: "https://staging.hachozeh.com/api/auth/google/callback",
        stateSecret: "state-secret"
      }
    });

    expect(() => assertProductionInvariants(env)).not.toThrow();
  });

  it("refuses staging deploy env on the production origin", () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://hachozeh.com";
    const env = makeProductionEnv({
      deployEnv: "staging",
      publicBaseUrl: "https://hachozeh.com/trending"
    });

    expect(() => assertProductionInvariants(env)).toThrow(
      "PUBLIC_BASE_URL must use https://staging.hachozeh.com in production"
    );
  });

  it("refuses NODE_ENV production with DEPLOY_ENV development", () => {
    const env = makeProductionEnv({ deployEnv: "development" });

    expect(() => assertProductionInvariants(env)).toThrow(
      "DEPLOY_ENV must be production or staging when NODE_ENV=production"
    );
  });

  it("refuses partial Google OAuth production config", () => {
    const env = makeProductionEnv({
      googleAuth: {
        clientId: "google-client-id",
        clientSecret: "",
        redirectUri: "https://hachozeh.com/api/auth/google/callback",
        stateSecret: "state-secret"
      }
    });

    expect(() => assertProductionInvariants(env)).toThrow(
      "Google OAuth production config must include client id, client secret, and state secret"
    );
  });

  it("refuses production Google OAuth redirect outside the real callback", () => {
    const env = makeProductionEnv({
      googleAuth: {
        clientId: "google-client-id",
        clientSecret: "google-client-secret",
        redirectUri: "https://dev.hachozeh.com/api/auth/google/callback",
        stateSecret: "state-secret"
      }
    });

    expect(() => assertProductionInvariants(env)).toThrow(
      "GOOGLE_OAUTH_REDIRECT_URI must be https://hachozeh.com/api/auth/google/callback in production"
    );
  });

  it("accepts production Google OAuth config on the real callback", () => {
    const env = makeProductionEnv({
      googleAuth: {
        clientId: "google-client-id",
        clientSecret: "google-client-secret",
        redirectUri: "https://hachozeh.com/api/auth/google/callback",
        stateSecret: "state-secret"
      }
    });

    expect(() => assertProductionInvariants(env)).not.toThrow();
  });

  it("refuses broad production CORS origins", () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://hachozeh.com,https://dev.hachozeh.com";

    expect(() => assertProductionInvariants(makeProductionEnv())).toThrow(
      "CORS_ALLOWED_ORIGINS must be only https://hachozeh.com in production"
    );
  });

  // -------------------------------------------------------------------------
  // New invariant: REQUIRE_SESSION_FOR_TRADES
  // -------------------------------------------------------------------------

  it("refuses production when requireSession is false", () => {
    const env = makeProductionEnv();
    env.trading.requireSession = false;
    expect(() => assertProductionInvariants(env)).toThrow(
      "REQUIRE_SESSION_FOR_TRADES must be true in production"
    );
  });

  // -------------------------------------------------------------------------
  // New invariant: DB_PASSWORD must not be the dev default
  // -------------------------------------------------------------------------

  it("refuses production when DB password is the dev default 'navi'", () => {
    const env = makeProductionEnv();
    env.db.password = "navi";
    expect(() => assertProductionInvariants(env)).toThrow(
      "DB_PASSWORD must be set to a non-default value in production"
    );
  });

  it("refuses production when DB password is empty", () => {
    const env = makeProductionEnv();
    env.db.password = "";
    expect(() => assertProductionInvariants(env)).toThrow(
      "DB_PASSWORD must be set to a non-default value in production"
    );
  });

  it("refuses production when DB timeout ceilings are unsafe", () => {
    const env = makeProductionEnv();
    env.db.statementTimeoutMs = 120000;

    expect(() => assertProductionInvariants(env)).toThrow(
      "DB_STATEMENT_TIMEOUT_MS must be between 1 and 60000 in production"
    );
  });

  it("refuses production when DB pool max is unsafe", () => {
    const env = makeProductionEnv();
    env.db.poolMax = 60;

    expect(() => assertProductionInvariants(env)).toThrow(
      "DB_POOL_MAX must be between 1 and 30 in production"
    );
  });

  // -------------------------------------------------------------------------
  // Happy path: requireSession=true + strong password → no throw
  // -------------------------------------------------------------------------

  it("passes production when requireSession is true and DB password is non-default", () => {
    const env = makeProductionEnv({
      trading: { requireSession: true },
      db: {
        host: "127.0.0.1",
        port: 55432,
        name: "navi",
        user: "navi",
        password: "correct-horse-battery-staple",
        connectTimeoutMs: 10000,
        statementTimeoutMs: 30000,
        queryTimeoutMs: 35000,
        lockTimeoutMs: 10000,
        idleInTransactionSessionTimeoutMs: 60000,
        poolMax: 30
      }
    });
    expect(() => assertProductionInvariants(env)).not.toThrow();
  });
});
