import type { IncomingMessage } from "node:http";

import type { AppEnv } from "../config/env";

function splitCookies(headerValue: string): Record<string, string> {
  const cookies: Record<string, string> = {};

  for (const rawEntry of headerValue.split(";")) {
    const entry = rawEntry.trim();

    if (!entry) {
      continue;
    }

    const separatorIndex = entry.indexOf("=");
    const name = (separatorIndex < 0 ? entry : entry.slice(0, separatorIndex)).trim();

    if (!name || Object.prototype.hasOwnProperty.call(cookies, name)) {
      continue;
    }

    cookies[name] = separatorIndex < 0
      ? ""
      : decodeCookieValue(entry.slice(separatorIndex + 1).trim());
  }

  return cookies;
}

function decodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function readCookie(
  request: IncomingMessage,
  cookieName: string
): string | null {
  const headerValue = request.headers.cookie;

  if (!headerValue) {
    return null;
  }

  const cookies = splitCookies(headerValue);
  return cookies[cookieName] ?? null;
}

function buildCookieParts(
  env: AppEnv,
  value: string,
  expiresAt: Date,
  options?: {
    maxAgeSeconds?: number;
    cleared?: boolean;
  }
): string[] {
  const parts = [
    `${env.auth.sessionCookieName}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expiresAt.toUTCString()}`
  ];

  if (typeof options?.maxAgeSeconds === "number") {
    parts.push(`Max-Age=${options.maxAgeSeconds}`);
  }

  if (env.nodeEnv === "production") {
    parts.push("Secure");
  }

  return parts;
}

export function buildSessionCookie(
  env: AppEnv,
  token: string,
  expiresAt: Date
): string {
  const maxAgeSeconds = Math.max(
    0,
    Math.floor((expiresAt.getTime() - Date.now()) / 1000)
  );

  return buildCookieParts(env, token, expiresAt, {
    maxAgeSeconds
  }).join("; ");
}

export function buildClearedSessionCookie(env: AppEnv): string {
  return buildCookieParts(env, "", new Date(0), {
    maxAgeSeconds: 0,
    cleared: true
  }).join("; ");
}
