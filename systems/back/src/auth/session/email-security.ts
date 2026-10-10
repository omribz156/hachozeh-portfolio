import { createHmac, timingSafeEqual } from "node:crypto";
import type { AppEnv } from "../../config/env";
import { AuthSessionError } from "./errors";
import { hashValue } from "./hashing";

export function assertEmailAuthEnabled(env: AppEnv): void {
  const enabled = process.env.AUTH_EMAIL_ENABLED;
  if (enabled === "false" || (env.nodeEnv === "production" && enabled !== "true")) {
    throw new AuthSessionError(503, "email_auth_paused", "Email sign-in is temporarily unavailable. Please use Google sign-in.");
  }
}

export function hashOtp(code: string, challengeId: string): string {
  const secret = process.env.AUTH_OTP_HASH_SECRET || process.env.HACHOZEH_PROXY_SECRET;
  return secret ? `hmac:${createHmac("sha256", secret).update(`${challengeId}:${code}`).digest("hex")}` : hashValue(code);
}

export function matchesOtp(stored: string, code: string, challengeId: string): boolean {
  const candidate = stored.startsWith("hmac:") ? hashOtp(code, challengeId) : hashValue(code);
  const left = Buffer.from(stored);
  const right = Buffer.from(candidate);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function validateEmailChallengeToken(body: unknown, env: AppEnv): Promise<void> {
  assertEmailAuthEnabled(env);
  if (env.nodeEnv !== "production" && !process.env.TURNSTILE_SECRET_KEY) return;
  const secret = process.env.TURNSTILE_SECRET_KEY;
  const token = (body as { turnstileToken?: unknown } | null)?.turnstileToken;
  if (!secret || typeof token !== "string" || !token || token.length > 2048) {
    throw new AuthSessionError(403, "challenge_required", "Please complete verification before requesting a code.");
  }
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret, response: token }), signal: AbortSignal.timeout(5_000)
    });
    const result = await response.json() as { success?: boolean; hostname?: string; action?: string };
    const hostname = new URL(env.publicBaseUrl).hostname;
    if (response.ok && result.success === true && result.hostname === hostname && result.action === "email_auth") return;
  } catch { /* Fail closed for mail, without exposing provider response data. */ }
  throw new AuthSessionError(403, "challenge_failed", "Verification failed. Please try again.");
}
