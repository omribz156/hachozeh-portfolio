#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2);

function readArg(name) {
  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1]) {
    return args[index + 1];
  }

  const prefix = `${name}=`;
  const match = args.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : "";
}

const envFile = readArg("--env-file");
const profile = readArg("--profile") || "production";
const allowDirty = args.includes("--allow-dirty");
const skipGit = args.includes("--skip-git");
const skipBackup = args.includes("--skip-backup");
const requireGoogle = args.includes("--require-google");
const requireVpsOps = args.includes("--require-vps-ops");
const live = args.includes("--live");

const allowedProfiles = new Set(["production", "staging", "dev-host", "local"]);

if (!allowedProfiles.has(profile)) {
  console.error(`deploy-preflight: invalid --profile=${profile}`);
  process.exit(2);
}

const failures = [];
const warnings = [];
const checks = [];

function pass(message) {
  checks.push(message);
}

function warn(message) {
  warnings.push(message);
}

function fail(message) {
  failures.push(message);
}

function parseEnvFile(path) {
  if (!path) {
    return {};
  }

  const resolved = resolve(process.cwd(), path);
  if (!existsSync(resolved)) {
    fail(`env file not found: ${resolved}`);
    return {};
  }

  const entries = {};
  const lines = readFileSync(resolved, "utf8").split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) {
      continue;
    }

    const separator = line.indexOf("=");
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    entries[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }

  return entries;
}

const env = {
  ...parseEnvFile(envFile),
  ...process.env
};

function value(name) {
  const current = env[name];
  return typeof current === "string" ? current.trim() : "";
}

function requireKey(name) {
  if (!value(name)) {
    fail(`${name} is required`);
    return "";
  }

  pass(`${name} present`);
  return value(name);
}

function requireExact(name, expected) {
  const current = requireKey(name);
  if (current && current !== expected) {
    fail(`${name} must be ${expected}`);
  }
}

function requireBoolean(name, expected) {
  const current = requireKey(name);
  if (current && current !== String(expected)) {
    fail(`${name} must be ${String(expected)}`);
  }
}

function requireOneOf(name, allowed) {
  const current = requireKey(name);
  if (current && !allowed.includes(current)) {
    fail(`${name} must be one of: ${allowed.join(", ")}`);
  }

  return current;
}

function requirePositiveInteger(name, minimum) {
  const current = requireKey(name);
  const parsed = Number(current);
  if (current && (!Number.isInteger(parsed) || parsed < minimum)) {
    fail(`${name} must be an integer >= ${minimum}`);
  }

  return parsed;
}

function requireIntegerRange(name, minimum, maximum) {
  const current = requireKey(name);
  const parsed = Number(current);
  if (current && (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum)) {
    fail(`${name} must be an integer between ${minimum} and ${maximum}`);
  }

  return parsed;
}

function requireAnyKey(names, label) {
  const found = names.find((name) => value(name));
  if (!found) {
    fail(`${label} is required (${names.join(" or ")})`);
    return "";
  }

  pass(`${label} present via ${found}`);
  return value(found);
}

function checkReceiptFile(name, label, maxAgeName = "") {
  const current = requireKey(name);
  if (!current) {
    return;
  }

  const resolved = resolve(process.cwd(), current);
  if (!existsSync(resolved)) {
    fail(`${name} does not exist: ${resolved}`);
    return;
  }

  const contents = readFileSync(resolved, "utf8");
  let jsonPass = false;
  try {
    const parsed = JSON.parse(contents);
    const status = String(parsed?.status ?? "").toUpperCase();
    const verdict = String(parsed?.report?.verdict ?? parsed?.verdict ?? "").toLowerCase();
    jsonPass = status === "PASS" || verdict === "ok";
  } catch {
    jsonPass = false;
  }

  if (!jsonPass && !/Status:\s*PASS/i.test(contents) && !/restore_drill=pass/i.test(contents)) {
    fail(`${name} must point to a PASS ${label} receipt`);
    return;
  }

  const maxAgeHours = maxAgeName ? value(maxAgeName) : "";
  if (maxAgeHours) {
    const parsed = Number(maxAgeHours);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      fail(`${maxAgeName} must be a positive number`);
    } else {
      const ageHours = (Date.now() - statSync(resolved).mtimeMs) / 3_600_000;
      if (ageHours > parsed) {
        fail(`${name} is ${ageHours.toFixed(1)}h old, above ${parsed}h`);
      }
    }
  }

  pass(`${label} receipt PASS`);
}

function checkJsonPassReceipt(name, label, maxAgeName = "") {
  const current = requireKey(name);
  if (!current) {
    return;
  }

  const resolved = resolve(process.cwd(), current);
  if (!existsSync(resolved)) {
    fail(`${name} does not exist: ${resolved}`);
    return;
  }

  const contents = readFileSync(resolved, "utf8");
  let parsed = null;
  try {
    parsed = JSON.parse(contents);
  } catch {
    fail(`${name} must be a JSON ${label} receipt`);
    return;
  }

  const status = String(parsed?.status ?? "").toUpperCase();
  const verdict = String(parsed?.report?.verdict ?? parsed?.verdict ?? "").toLowerCase();
  if (status !== "PASS" && verdict !== "ok") {
    fail(`${name} must point to a PASS ${label} receipt`);
    return;
  }

  const maxAgeHours = maxAgeName ? value(maxAgeName) : "";
  if (maxAgeHours) {
    const parsedMaxAge = Number(maxAgeHours);
    if (!Number.isFinite(parsedMaxAge) || parsedMaxAge <= 0) {
      fail(`${maxAgeName} must be a positive number`);
    } else {
      const ageHours = (Date.now() - statSync(resolved).mtimeMs) / 3_600_000;
      if (ageHours > parsedMaxAge) {
        fail(`${name} is ${ageHours.toFixed(1)}h old, above ${parsedMaxAge}h`);
      }
    }
  }

  pass(`${label} receipt PASS`);
}

function parseUrl(name) {
  const current = value(name);
  if (!current) {
    fail(`${name} is required`);
    return null;
  }

  try {
    return new URL(current);
  } catch {
    fail(`${name} must be an absolute URL`);
    return null;
  }
}

function runGit(argsForGit) {
  return spawnSync("git", argsForGit, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function checkGitState() {
  if (skipGit) {
    warn("git checks skipped by --skip-git");
    return;
  }

  const inside = runGit(["rev-parse", "--is-inside-work-tree"]);
  if (inside.status !== 0 || inside.stdout.trim() !== "true") {
    fail("not inside a git worktree");
    return;
  }

  const status = runGit(["status", "--porcelain"]);
  if (status.status !== 0) {
    fail("git status failed");
    return;
  }

  if (status.stdout.trim() && !allowDirty) {
    fail("git tree is dirty; commit or use --allow-dirty for local rehearsal only");
  } else if (status.stdout.trim()) {
    warn("git tree is dirty but --allow-dirty was set");
  } else {
    pass("git tree clean");
  }

  const upstream = runGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  if (upstream.status !== 0) {
    warn("no upstream branch configured; cannot verify pushed release artifact");
    return;
  }

  const divergence = runGit(["rev-list", "--left-right", "--count", "HEAD...@{u}"]);
  if (divergence.status !== 0) {
    warn("could not calculate upstream divergence");
    return;
  }

  const [aheadRaw, behindRaw] = divergence.stdout.trim().split(/\s+/);
  const ahead = Number(aheadRaw || 0);
  const behind = Number(behindRaw || 0);

  if (behind > 0) {
    fail(`branch is behind upstream by ${behind} commit(s)`);
  }

  if (ahead > 0) {
    fail(`branch is ahead of upstream by ${ahead} commit(s); push or tag the deploy artifact first`);
  }

  if (ahead === 0 && behind === 0) {
    pass("git branch matches upstream");
  }
}

function checkProductionEnv() {
  requireExact("NODE_ENV", "production");
  requireExact("DEPLOY_ENV", "production");
  const deployProvider = requireOneOf("DEPLOY_PROVIDER", ["render", "vps", "docker"]);
  requireExact("PUBLIC_BASE_URL", "https://hachozeh.com/trending");
  requireExact("CORS_ALLOWED_ORIGINS", "https://hachozeh.com");
  requireExact("MAIL_FROM", "Hachozeh <noreply@email.hachozeh.com>");
  requireBoolean("REQUIRE_SESSION_FOR_TRADES", true);
  requireBoolean("DEMO_ACTOR_MODE_ENABLED", false);
  requireBoolean("AUTH_DEV_OTP_EXPOSED", false);

  const publicBaseUrl = parseUrl("PUBLIC_BASE_URL");
  if (publicBaseUrl && publicBaseUrl.origin !== "https://hachozeh.com") {
    fail("PUBLIC_BASE_URL must stay on https://hachozeh.com");
  }

  requireKey("RESEND_API_KEY");

  for (const name of ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD"]) {
    requireKey(name);
  }

  if (value("DB_PASSWORD") === "navi") {
    fail("DB_PASSWORD must not be the local default");
  }

  checkDbTimeoutEnv();
  checkDbRoleEnv();

  const commitSha = requireAnyKey(["NAVI_COMMIT_SHA", "RENDER_GIT_COMMIT"], "runtime commit SHA");
  for (const name of ["NAVI_BUILD_TIMESTAMP", "NAVI_RELEASE_ID"]) {
    requireKey(name);
  }

  if (commitSha && !/^[0-9a-f]{7,40}$/i.test(commitSha)) {
    fail("runtime commit SHA must look like a git SHA");
  }

  if (value("NAVI_BUILD_TIMESTAMP") && Number.isNaN(Date.parse(value("NAVI_BUILD_TIMESTAMP")))) {
    fail("NAVI_BUILD_TIMESTAMP must parse as a date");
  }

  const diagnosticsBearerToken = requireKey("DIAGNOSTICS_BEARER_TOKEN");
  if (diagnosticsBearerToken && diagnosticsBearerToken.length < 32) {
    fail("DIAGNOSTICS_BEARER_TOKEN must be at least 32 characters");
  }

  for (const name of ["PLATFORM_ALERT_TELEGRAM_BOT_TOKEN", "PLATFORM_ALERT_TELEGRAM_CHAT_ID"]) {
    requireKey(name);
  }
  requireKey("PRODUCTION_INTEGRITY_RECEIPT_PATH");

  if (deployProvider === "render") {
    checkRenderEnv();
  }

  if (!skipBackup) {
    if (deployProvider === "render") {
      warn("Render provider selected; self-managed backup upload env is not required");
    } else {
      requireExact("BACKUP_REMOTE_ENABLED", "true");
      requireKey("BACKUP_AGE_RECIPIENT");
      requireKey("BACKUP_REMOTE_UPLOAD_CMD");
    }
    checkReceiptFile("RESTORE_DRILL_RECEIPT_PATH", "restore drill", "RESTORE_DRILL_MAX_AGE_HOURS");

    if (deployProvider !== "render" && value("BACKUP_AGE_RECIPIENT") && !value("BACKUP_AGE_RECIPIENT").startsWith("age1")) {
      fail("BACKUP_AGE_RECIPIENT must be an age public recipient");
    }

    const upload = value("BACKUP_REMOTE_UPLOAD_CMD");
    if (deployProvider !== "render" && upload && (!upload.includes("{file}") || !upload.includes("{name}"))) {
      fail("BACKUP_REMOTE_UPLOAD_CMD must include {file} and {name} placeholders");
    }

    const pitrMode = requireOneOf("PITR_MODE", ["managed-provider", "self-hosted-wal"]);
    requirePositiveInteger("PITR_RETENTION_DAYS", 3);
    checkReceiptFile("PITR_DRILL_RECEIPT_PATH", "PITR drill", "PITR_DRILL_MAX_AGE_HOURS");

    if (pitrMode === "self-hosted-wal") {
      requireOneOf("PITR_WAL_TOOL", ["pgbackrest", "wal-g"]);
    }
  } else {
    warn("remote backup, restore drill, and PITR checks skipped by --skip-backup");
  }

  if (requireVpsOps) {
    requireKey("WATCHDOG_BACK_SYSTEMD_UNIT");
    requireKey("WATCHDOG_FRONT_SYSTEMD_UNIT");
    requireKey("WATCHDOG_RECEIPT_PATH");
    requireKey("DOCTOR_REPORT_PATH");
    requireKey("NAVI_BACKUP_DIR");
  } else if (deployProvider === "render") {
    warn("Render provider selected; VPS systemd/watchdog ops keys not required");
  } else {
    warn("VPS doctor/watchdog ops keys not required; pass --require-vps-ops for host launch");
  }

  checkGoogleEnv("https://hachozeh.com");
}

function checkStagingEnv() {
  requireExact("NODE_ENV", "production");
  requireExact("DEPLOY_ENV", "staging");
  requireOneOf("DEPLOY_PROVIDER", ["render", "vps", "docker"]);
  requireExact("PUBLIC_BASE_URL", "https://staging.hachozeh.com/trending");
  requireExact("CORS_ALLOWED_ORIGINS", "https://staging.hachozeh.com");
  requireExact("MAIL_FROM", "Hachozeh <noreply@email.hachozeh.com>");
  requireBoolean("REQUIRE_SESSION_FOR_TRADES", true);
  requireBoolean("DEMO_ACTOR_MODE_ENABLED", false);
  requireBoolean("AUTH_DEV_OTP_EXPOSED", false);

  for (const name of ["RESEND_API_KEY", "DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD"]) {
    requireKey(name);
  }

  if (value("DB_PASSWORD") === "navi") {
    fail("DB_PASSWORD must not be the local default");
  }

  checkDbTimeoutEnv();

  const commitSha = requireAnyKey(["NAVI_COMMIT_SHA", "RENDER_GIT_COMMIT"], "runtime commit SHA");
  for (const name of ["NAVI_BUILD_TIMESTAMP", "NAVI_RELEASE_ID"]) {
    requireKey(name);
  }

  if (commitSha && !/^[0-9a-f]{7,40}$/i.test(commitSha)) {
    fail("runtime commit SHA must look like a git SHA");
  }

  if (value("NAVI_BUILD_TIMESTAMP") && Number.isNaN(Date.parse(value("NAVI_BUILD_TIMESTAMP")))) {
    fail("NAVI_BUILD_TIMESTAMP must parse as a date");
  }

  if (value("BACKUP_REMOTE_ENABLED") !== "true") {
    warn("staging remote backup is not required, but production still requires it");
  }

  checkGoogleEnv("https://staging.hachozeh.com");
}

function checkDbTimeoutEnv() {
  requireIntegerRange("DB_CONNECT_TIMEOUT_MS", 1, 10000);
  requireIntegerRange("DB_STATEMENT_TIMEOUT_MS", 1, 60000);
  requireIntegerRange("DB_QUERY_TIMEOUT_MS", 1, 65000);
  requireIntegerRange("DB_LOCK_TIMEOUT_MS", 1, 15000);
  requireIntegerRange("DB_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS", 1, 120000);
  requireIntegerRange("DB_TX_STATEMENT_TIMEOUT_MS", 1, 60000);
  requireIntegerRange("DB_TX_LOCK_TIMEOUT_MS", 1, 15000);
  requireIntegerRange("DB_POOL_MAX", 1, 30);
}

function checkDbRoleEnv() {
  const roleMode = requireOneOf("DB_ROLE_MODE", ["split", "provider-managed"]);
  checkJsonPassReceipt(
    "DB_PRIVILEGE_AUDIT_RECEIPT_PATH",
    "DB privilege audit",
    "DB_PRIVILEGE_AUDIT_MAX_AGE_HOURS"
  );

  if (roleMode !== "split") {
    return;
  }

  for (const name of ["MIGRATION_DB_USER", "MIGRATION_DB_PASSWORD", "BACKUP_DB_USER", "BACKUP_DB_PASSWORD"]) {
    requireKey(name);
  }

  if (value("MIGRATION_DB_USER") && value("MIGRATION_DB_USER") === value("DB_USER")) {
    fail("MIGRATION_DB_USER must differ from DB_USER when DB_ROLE_MODE=split");
  }

  if (value("BACKUP_DB_USER") && value("BACKUP_DB_USER") === value("DB_USER")) {
    fail("BACKUP_DB_USER must differ from DB_USER when DB_ROLE_MODE=split");
  }
}

function checkRenderEnv() {
  for (const name of [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_AVATAR_BUCKET",
    "R2_FEEDBACK_BUCKET"
  ]) {
    requireKey(name);
  }

  if (value("DB_ROLE_MODE") !== "provider-managed") {
    fail("Render production must use DB_ROLE_MODE=provider-managed");
  }

  if (value("PITR_MODE") && value("PITR_MODE") !== "managed-provider") {
    fail("Render production must use PITR_MODE=managed-provider");
  }

  const poolMax = Number(value("DB_POOL_MAX"));
  if (Number.isFinite(poolMax) && poolMax > 10) {
    fail("Render production DB_POOL_MAX must be <= 10 per service");
  }
}

function checkDevHostEnv() {
  requireExact("PUBLIC_BASE_URL", "https://dev.hachozeh.com/trending");
  checkGoogleEnv("https://dev.hachozeh.com");
}

function checkLocalEnv() {
  const publicBaseUrl = parseUrl("PUBLIC_BASE_URL");
  if (publicBaseUrl && !new Set(["127.0.0.1", "localhost"]).has(publicBaseUrl.hostname)) {
    fail("local PUBLIC_BASE_URL must use localhost or 127.0.0.1");
  }

  checkGoogleEnv("");
}

function checkGoogleEnv(expectedOrigin) {
  const names = [
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "GOOGLE_OAUTH_REDIRECT_URI",
    "GOOGLE_OAUTH_STATE_SECRET"
  ];
  const configured = [
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "GOOGLE_OAUTH_STATE_SECRET"
  ].some((name) => value(name));

  if (!configured && !requireGoogle) {
    warn("Google OAuth not configured; pass --require-google when enabling production Google login");
    return;
  }

  for (const name of names) {
    requireKey(name);
  }

  const redirectUri = parseUrl("GOOGLE_OAUTH_REDIRECT_URI");
  if (redirectUri && redirectUri.pathname !== "/api/auth/google/callback") {
    fail("GOOGLE_OAUTH_REDIRECT_URI must end at /api/auth/google/callback");
  }

  if (expectedOrigin && redirectUri && redirectUri.origin !== expectedOrigin) {
    fail(`GOOGLE_OAUTH_REDIRECT_URI origin must be ${expectedOrigin}`);
  }

  if (value("GOOGLE_OAUTH_STATE_SECRET") && value("GOOGLE_OAUTH_STATE_SECRET").length < 32) {
    fail("GOOGLE_OAUTH_STATE_SECRET must be at least 32 characters");
  }
}

async function checkLiveOrigin() {
  if (!live) {
    return;
  }

  const base = value("PUBLIC_BASE_URL");
  if (!base) {
    fail("--live requires PUBLIC_BASE_URL");
    return;
  }

  const targets = [
    base,
    new URL("/health/live", base).toString(),
    new URL("/health/ready", base).toString()
  ];

  for (const target of targets) {
    try {
      const startedAt = Date.now();
      const response = await fetch(target, { redirect: "manual" });
      const elapsed = Date.now() - startedAt;

      if (response.status < 200 || response.status >= 400) {
        fail(`live check failed: ${target} returned ${response.status}`);
      } else {
        pass(`live ${target} ${response.status} (${elapsed}ms)`);
      }
    } catch (error) {
      fail(`live check failed: ${target} (${error?.message || "request error"})`);
    }
  }
}

checkGitState();

if (profile === "production") {
  checkProductionEnv();
} else if (profile === "staging") {
  checkStagingEnv();
} else if (profile === "dev-host") {
  checkDevHostEnv();
} else {
  checkLocalEnv();
}

await checkLiveOrigin();

for (const message of checks) {
  console.log(`deploy-preflight: ok: ${message}`);
}

for (const message of warnings) {
  console.warn(`deploy-preflight: warn: ${message}`);
}

if (failures.length > 0) {
  for (const message of failures) {
    console.error(`deploy-preflight: fail: ${message}`);
  }

  process.exit(1);
}

console.log(`deploy-preflight: ok (${profile})`);
