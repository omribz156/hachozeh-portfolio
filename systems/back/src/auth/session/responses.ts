import { randomInt } from "node:crypto";

import type { AppEnv } from "../../config/env";
import { maskEmail } from "../email-identity";
import type { AuthPurpose, AuthResult, AuthStartResponse, SessionResponse } from "./types";

// Operator/test convenience only. Default-closed: the fixed dev code (and its
// echo in the auth response) requires an explicit AUTH_DEV_OTP_EXPOSED=true,
// and never activates in production regardless of the flag.
export function isDevOtpExposed(env: AppEnv): boolean {
  return env.auth.devOtpExposed && env.nodeEnv !== "production";
}

export function buildOtpCode(env: AppEnv): string {
  if (isDevOtpExposed(env)) {
    return env.auth.devOtpCode;
  }

  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function isNonProduction(env: AppEnv): boolean {
  return env.nodeEnv !== "production";
}

export function buildStartResponse(
  env: AppEnv,
  identifier: string,
  purpose: AuthPurpose,
  challengeId: string,
  expiresAt: Date
): AuthStartResponse {
  return {
    challengeId,
    purpose,
    channel: "email",
    identifierHint: maskEmail(identifier),
    expiresAt: expiresAt.toISOString(),
    nextStep: "otp",
    ...(isDevOtpExposed(env) ? { devCode: env.auth.devOtpCode } : {})
  };
}

export function buildAuthenticatedSessionResponse(
  userId: string,
  identifier: string,
  expiresAt: Date,
  authResult?: AuthResult
): SessionResponse {
  return {
    actor: {
      userId,
      mode: "session"
    },
    session: {
      authenticated: true,
      expiresAt: expiresAt.toISOString()
    },
    identity: {
      channel: "email",
      identifierHint: maskEmail(identifier)
    },
    ...(authResult ? { authResult } : {})
  };
}

export function buildAnonymousSessionResponse(): SessionResponse {
  return {
    actor: null,
    session: {
      authenticated: false,
      expiresAt: null
    },
    identity: null
  };
}
