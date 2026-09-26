#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const envFileArgIndex = process.argv.indexOf("--env-file");
const envPath =
  envFileArgIndex >= 0 && process.argv[envFileArgIndex + 1]
    ? resolve(process.cwd(), process.argv[envFileArgIndex + 1])
    : resolve(repoRoot, "systems/back/.env");
const profile = process.argv.includes("--local")
  ? "local"
  : process.argv.includes("--dev-host")
    ? "dev-host"
    : "production";

function parseEnvFile(path) {
  if (!existsSync(path)) {
    return {};
  }

  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separatorIndex = line.indexOf("=");
        const key = line.slice(0, separatorIndex).trim();
        const rawValue = line.slice(separatorIndex + 1).trim();
        const value = rawValue.replace(/^['"]|['"]$/g, "");

        return [key, value];
      })
  );
}

function fail(message) {
  console.error(`google-oauth-config: ${message}`);
  process.exitCode = 1;
}

function assertUrl(name, value) {
  try {
    return new URL(value);
  } catch {
    fail(`${name} must be a valid absolute URL`);
    return null;
  }
}

const env = parseEnvFile(envPath);
const requiredKeys = [
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_OAUTH_REDIRECT_URI",
  "GOOGLE_OAUTH_STATE_SECRET",
  "PUBLIC_BASE_URL",
];

for (const key of requiredKeys) {
  if (!env[key]) {
    fail(`${key} is missing from systems/back/.env`);
  }
}

const redirectUri = env.GOOGLE_OAUTH_REDIRECT_URI
  ? assertUrl("GOOGLE_OAUTH_REDIRECT_URI", env.GOOGLE_OAUTH_REDIRECT_URI)
  : null;
const publicBaseUrl = env.PUBLIC_BASE_URL
  ? assertUrl("PUBLIC_BASE_URL", env.PUBLIC_BASE_URL)
  : null;
const corsAllowedOrigins = (env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

if (redirectUri && redirectUri.pathname !== "/api/auth/google/callback") {
  fail("GOOGLE_OAUTH_REDIRECT_URI must end at /api/auth/google/callback");
}

if (profile === "production") {
  if (redirectUri && redirectUri.origin !== "https://hachozeh.com") {
    fail("production redirect origin must be https://hachozeh.com");
  }

  if (publicBaseUrl && publicBaseUrl.origin !== "https://hachozeh.com") {
    fail("production PUBLIC_BASE_URL origin must be https://hachozeh.com");
  }

  for (const origin of corsAllowedOrigins) {
    if (origin !== "https://hachozeh.com") {
      fail("production CORS_ALLOWED_ORIGINS must be only https://hachozeh.com");
      break;
    }
  }
}

if (profile === "dev-host") {
  if (redirectUri && redirectUri.origin !== "https://dev.hachozeh.com") {
    fail("dev-host redirect origin must be https://dev.hachozeh.com");
  }

  if (publicBaseUrl && publicBaseUrl.origin !== "https://dev.hachozeh.com") {
    fail("dev-host PUBLIC_BASE_URL origin must be https://dev.hachozeh.com");
  }
}

if (profile === "local") {
  const localHosts = new Set(["127.0.0.1", "localhost"]);

  if (redirectUri && !localHosts.has(redirectUri.hostname)) {
    fail("local redirect host must be localhost or 127.0.0.1");
  }

  if (publicBaseUrl && !localHosts.has(publicBaseUrl.hostname)) {
    fail("local PUBLIC_BASE_URL host must be localhost or 127.0.0.1");
  }
}

if (!process.exitCode) {
  console.log(`google-oauth-config: ok (${profile})`);
  console.log(`redirect_uri=${redirectUri?.origin}${redirectUri?.pathname}`);
  console.log(`public_base_origin=${publicBaseUrl?.origin}`);
}
