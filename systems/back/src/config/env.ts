import { existsSync } from "node:fs";

import { config as loadDotenv } from "dotenv";

// Portfolio copy loads only explicitly selected or package-local configuration;
// CI and production set real env vars, so a missing file is a silent no-op.
const ENV_FILE_CANDIDATES = [
  process.env.NAVI_ENV_FILE,
  ".env"
].filter((candidate): candidate is string => Boolean(candidate));

const envFile = ENV_FILE_CANDIDATES.find((candidate) => existsSync(candidate));
if (envFile) {
  loadDotenv({ path: envFile });
}

export type NodeEnv = "development" | "test" | "production";
export type DeployEnv = "development" | "staging" | "production";
export type LogLevel = "debug" | "info" | "warn" | "error";

export type AppEnv = {
  serviceName: string;
  nodeEnv: NodeEnv;
  deployEnv: DeployEnv;
  host: string;
  port: number;
  logLevel: LogLevel;
  auth: {
    sessionCookieName: string;
    sessionTtlHours: number;
    sessionAbsoluteTtlHours: number;
    otpTtlMinutes: number;
    otpResendCooldownSeconds: number;
    otpMaxAttempts: number;
    devOtpCode: string;
    devOtpExposed: boolean;
  };
  mail: {
    resendApiKey: string;
    from: string;
  };
  googleAuth?: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    stateSecret: string;
  };
  actorMode: {
    demoEnabled: boolean;
    demoActorId: string;
  };
  trading: {
    requireSession: boolean;
  };
  publicBaseUrl: string;
  db: {
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
    connectTimeoutMs: number;
    statementTimeoutMs: number;
    queryTimeoutMs: number;
    lockTimeoutMs: number;
    idleInTransactionSessionTimeoutMs: number;
    poolMax?: number;
  };
};

const NODE_ENVS = new Set<NodeEnv>(["development", "test", "production"]);
const DEPLOY_ENVS = new Set<DeployEnv>(["development", "staging", "production"]);
const LOG_LEVELS = new Set<LogLevel>(["debug", "info", "warn", "error"]);
const COOKIE_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const PRODUCTION_PUBLIC_ORIGIN = "https://hachozeh.com";
const STAGING_PUBLIC_ORIGIN = "https://staging.hachozeh.com";
const GOOGLE_CALLBACK_PATH = "/api/auth/google/callback";

function readString(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

function readInteger(name: string, fallback: number): number {
  const value = process.env[name];

  if (!value || !value.trim()) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid integer env: ${name}`);
  }

  return parsed;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];

  if (!value || !value.trim()) {
    return fallback;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error(`Invalid boolean env: ${name}`);
}

function readCookieName(name: string, fallback: string): string {
  const value = readString(name, fallback);

  if (!COOKIE_NAME_RE.test(value)) {
    throw new Error(`Invalid cookie name env: ${name}`);
  }

  return value;
}

function readUrlOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function readUrlPathname(value: string): string | null {
  try {
    return new URL(value).pathname;
  } catch {
    return null;
  }
}

function readProductionCorsAllowedOrigins(): string[] {
  const raw = process.env["CORS_ALLOWED_ORIGINS"];

  if (!raw?.trim()) {
    return [PRODUCTION_PUBLIC_ORIGIN];
  }

  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function expectedProductionPublicOrigin(env: AppEnv): string {
  return env.deployEnv === "staging" ? STAGING_PUBLIC_ORIGIN : PRODUCTION_PUBLIC_ORIGIN;
}

// Refuses to boot a production process whose env would silently weaken auth.
// An env-var typo must degrade to "locked", never to "open".
export function assertProductionInvariants(env: AppEnv): void {
  if (env.nodeEnv !== "production") {
    return;
  }

  const violations: string[] = [];
  const expectedPublicOrigin = expectedProductionPublicOrigin(env);

  if (env.deployEnv === "development") {
    violations.push("DEPLOY_ENV must be production or staging when NODE_ENV=production");
  }

  if (env.actorMode.demoEnabled) {
    violations.push("DEMO_ACTOR_MODE_ENABLED must be false in production");
  }

  if (env.auth.devOtpExposed) {
    violations.push("AUTH_DEV_OTP_EXPOSED must be false in production");
  }

  if (env.googleAuth && env.googleAuth.clientId && !env.googleAuth.stateSecret) {
    violations.push("GOOGLE_OAUTH_STATE_SECRET must be set when Google OAuth is configured");
  }

  if (readUrlOrigin(env.publicBaseUrl) !== expectedPublicOrigin) {
    violations.push(`PUBLIC_BASE_URL must use ${expectedPublicOrigin} in production`);
  }

  const googleAuthConfigured = Boolean(
    env.googleAuth?.clientId ||
      env.googleAuth?.clientSecret ||
      env.googleAuth?.stateSecret
  );

  if (googleAuthConfigured) {
    if (!env.googleAuth?.clientId || !env.googleAuth.clientSecret || !env.googleAuth.stateSecret) {
      violations.push("Google OAuth production config must include client id, client secret, and state secret");
    }

    if (
      readUrlOrigin(env.googleAuth?.redirectUri ?? "") !== expectedPublicOrigin ||
      readUrlPathname(env.googleAuth?.redirectUri ?? "") !== GOOGLE_CALLBACK_PATH
    ) {
      violations.push(
        `GOOGLE_OAUTH_REDIRECT_URI must be ${expectedPublicOrigin}${GOOGLE_CALLBACK_PATH} in production`
      );
    }
  }

  const unsafeCorsOrigins = readProductionCorsAllowedOrigins().filter(
    (origin) => origin !== expectedPublicOrigin
  );

  if (unsafeCorsOrigins.length > 0) {
    violations.push(
      `CORS_ALLOWED_ORIGINS must be only ${expectedPublicOrigin} in production`
    );
  }

  if (!env.mail.resendApiKey) {
    violations.push("RESEND_API_KEY must be set in production (OTP delivery has no fallback)");
  }

  // Anonymous-trading defense must be two layers deep (demo-actor flag alone
  // is not defense-in-depth on the money path).
  if (!env.trading.requireSession) {
    violations.push("REQUIRE_SESSION_FOR_TRADES must be true in production");
  }

  if (!env.db.password || env.db.password === "navi") {
    violations.push("DB_PASSWORD must be set to a non-default value in production");
  }

  if (env.db.connectTimeoutMs <= 0 || env.db.connectTimeoutMs > 10_000) {
    violations.push("DB_CONNECT_TIMEOUT_MS must be between 1 and 10000 in production");
  }

  if (env.db.statementTimeoutMs <= 0 || env.db.statementTimeoutMs > 60_000) {
    violations.push("DB_STATEMENT_TIMEOUT_MS must be between 1 and 60000 in production");
  }

  if (env.db.queryTimeoutMs <= 0 || env.db.queryTimeoutMs > 65_000) {
    violations.push("DB_QUERY_TIMEOUT_MS must be between 1 and 65000 in production");
  }

  if (env.db.lockTimeoutMs <= 0 || env.db.lockTimeoutMs > 15_000) {
    violations.push("DB_LOCK_TIMEOUT_MS must be between 1 and 15000 in production");
  }

  if (
    env.db.idleInTransactionSessionTimeoutMs <= 0 ||
    env.db.idleInTransactionSessionTimeoutMs > 120_000
  ) {
    violations.push(
      "DB_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS must be between 1 and 120000 in production"
    );
  }

  if (!env.db.poolMax || env.db.poolMax <= 0 || env.db.poolMax > 30) {
    violations.push("DB_POOL_MAX must be between 1 and 30 in production");
  }

  if (violations.length > 0) {
    throw new Error(`Production env invariants violated:\n- ${violations.join("\n- ")}`);
  }
}

export function loadAppEnv(): AppEnv {
  const nodeEnv = readString("NODE_ENV", "development");
  const deployEnv = readString(
    "DEPLOY_ENV",
    nodeEnv === "production" ? "production" : "development"
  );
  const logLevel = readString("LOG_LEVEL", "info");

  if (!NODE_ENVS.has(nodeEnv as NodeEnv)) {
    throw new Error(`Invalid NODE_ENV: ${nodeEnv}`);
  }

  if (!DEPLOY_ENVS.has(deployEnv as DeployEnv)) {
    throw new Error(`Invalid DEPLOY_ENV: ${deployEnv}`);
  }

  if (!LOG_LEVELS.has(logLevel as LogLevel)) {
    throw new Error(`Invalid LOG_LEVEL: ${logLevel}`);
  }

  // Dev OTP must mirror the PROD code shape — 6 numeric digits (see buildOtpCode:
  // randomInt(0, 1_000_000).padStart(6)). The dev/e2e OTP UI then exercises the SAME
  // 6-box flow real users get; a non-6-digit code would silently diverge the widget.
  const devOtpCode = readString("AUTH_DEV_OTP_CODE", "111111");
  const devOtpExposed = readBoolean("AUTH_DEV_OTP_EXPOSED", false);
  if (devOtpExposed && !/^\d{6}$/.test(devOtpCode)) {
    throw new Error(
      "AUTH_DEV_OTP_CODE must be exactly 6 digits (prod issues a 6-digit numeric OTP). " +
        "Fix it in the dev .env so dev mirrors prod."
    );
  }

  return {
    serviceName: readString("SERVICE_NAME", "navi-backend"),
    nodeEnv: nodeEnv as NodeEnv,
    deployEnv: deployEnv as DeployEnv,
    host: readString("HOST", "0.0.0.0"),
    port: readInteger("PORT", 3001),
    logLevel: logLevel as LogLevel,
    auth: {
      sessionCookieName: readCookieName("AUTH_SESSION_COOKIE_NAME", "navi_session"),
      sessionTtlHours: readInteger("AUTH_SESSION_TTL_HOURS", 24 * 7),
      // Sliding-window cap: activity keeps renewing expires_at (see
      // touchSessionActivity), but never past created_at + this absolute
      // lifetime. Bounds a session that's touched forever from living forever.
      sessionAbsoluteTtlHours: readInteger("AUTH_SESSION_ABSOLUTE_TTL_HOURS", 24 * 90),
      otpTtlMinutes: readInteger("AUTH_OTP_TTL_MINUTES", 10),
      otpResendCooldownSeconds: readInteger("AUTH_OTP_RESEND_COOLDOWN_SECONDS", 30),
      otpMaxAttempts: readInteger("AUTH_OTP_MAX_ATTEMPTS", 5),
      devOtpCode,
      // Operator/test convenience: fixed OTP returned in the auth response.
      // Default-closed; flip on only while running local smokes/gauntlets.
      devOtpExposed
    },
    mail: {
      resendApiKey: readString("RESEND_API_KEY", ""),
      from: readString("MAIL_FROM", "Hachozeh <noreply@email.hachozeh.com>")
    },
    googleAuth: {
      clientId: readString("GOOGLE_OAUTH_CLIENT_ID", ""),
      clientSecret: readString("GOOGLE_OAUTH_CLIENT_SECRET", ""),
      redirectUri: readString("GOOGLE_OAUTH_REDIRECT_URI", "http://127.0.0.1:3001/api/auth/google/callback"),
      stateSecret: readString("GOOGLE_OAUTH_STATE_SECRET", "")
    },
    actorMode: {
      // Default-closed: unauthenticated requests must not resolve to an actor
      // unless an operator explicitly enables demo mode for a local showcase.
      demoEnabled: readBoolean("DEMO_ACTOR_MODE_ENABLED", false),
      demoActorId: readString("DEMO_ACTOR_ID", "seed_user_1")
    },
    trading: {
      requireSession: readBoolean("REQUIRE_SESSION_FOR_TRADES", false)
    },
    publicBaseUrl: readString("PUBLIC_BASE_URL", "http://127.0.0.1:6969/trending"),
    db: {
      host: readString("DB_HOST", "127.0.0.1"),
      port: readInteger("DB_PORT", 55432),
      name: readString("DB_NAME", "navi"),
      user: readString("DB_USER", "navi"),
      password: readString("DB_PASSWORD", "navi"),
      connectTimeoutMs: readInteger("DB_CONNECT_TIMEOUT_MS", 10000),
      statementTimeoutMs: readInteger("DB_STATEMENT_TIMEOUT_MS", 30000),
      queryTimeoutMs: readInteger("DB_QUERY_TIMEOUT_MS", 35000),
      lockTimeoutMs: readInteger("DB_LOCK_TIMEOUT_MS", 10000),
      idleInTransactionSessionTimeoutMs: readInteger(
        "DB_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS",
        60000
      ),
      poolMax: readInteger("DB_POOL_MAX", 30)
    }
  };
}
