import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual
} from "node:crypto";
import type { IncomingMessage } from "node:http";
import { createLocalJWKSet, decodeProtectedHeader, errors as joseErrors, jwtVerify } from "jose";
import type { JSONWebKeySet, JWTPayload } from "jose";
import type { Pool } from "pg";

import type { AppEnv } from "../config/env";
import { withTransaction } from "../db/tx/with-transaction";
import { normalizeEmail } from "./email-identity";
import {
  AuthSessionError,
  createAuthenticatedSessionForUser
} from "./session-service";
import {
  createUserWithIdentity,
  insertUserIdentity,
  readIdentityByTypeIdentifier
} from "./session/user-identity-records";
import type { SessionResponse } from "./session/types";

const GOOGLE_AUTH_BASE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const STATE_TTL_MS = 10 * 60 * 1000;
const MAX_STATE_LENGTH = 4096;

type GoogleAuthConfig = NonNullable<AppEnv["googleAuth"]>;

type GoogleIdTokenClaims = JWTPayload & {
  nonce?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
  picture?: unknown;
};

type FetchLike = typeof fetch;

type CompleteGoogleAuthCallbackOptions = {
  fetch?: FetchLike;
};

function base64urlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64urlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function base64urlDecodeJson<T>(value: string): T {
  return JSON.parse(base64urlDecode(value)) as T;
}

function buildCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

function buildCodeChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

function requireGoogleAuthConfig(env: AppEnv): GoogleAuthConfig {
  const config = env.googleAuth;

  if (!config?.clientId || !config.clientSecret || !config.redirectUri || !config.stateSecret) {
    throw new AuthSessionError(
      503,
      "google_auth_unavailable",
      "Google sign-in is not configured."
    );
  }

  return config;
}

function getPublicBaseUrl(env: AppEnv): URL {
  return new URL(env.publicBaseUrl);
}

function normalizeReturnTo(env: AppEnv, returnTo: string | null | undefined): string {
  const baseUrl = getPublicBaseUrl(env);

  if (!returnTo?.trim()) {
    return baseUrl.toString();
  }

  try {
    const parsed = new URL(returnTo, baseUrl);

    if (parsed.origin !== baseUrl.origin) {
      return baseUrl.toString();
    }

    return `${parsed.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return baseUrl.toString();
  }
}

function signStatePayload(config: GoogleAuthConfig, payload: string): string {
  return createHmac("sha256", config.stateSecret).update(payload).digest("base64url");
}

function buildState(env: AppEnv, input: {
  codeVerifier: string;
  nonce: string;
  returnTo: string;
}): string {
  const config = requireGoogleAuthConfig(env);
  const payload = base64urlEncode(
    JSON.stringify({
      codeVerifier: input.codeVerifier,
      createdAt: Date.now(),
      nonce: input.nonce,
      returnTo: input.returnTo
    })
  );
  const signature = signStatePayload(config, payload);

  return `${payload}.${signature}`;
}

function verifyState(env: AppEnv, state: string): {
  codeVerifier: string;
  nonce: string;
  returnTo: string;
} {
  const config = requireGoogleAuthConfig(env);

  if (state.length > MAX_STATE_LENGTH) {
    throw new AuthSessionError(400, "invalid_oauth_state", "Google sign-in state is invalid.");
  }

  const stateParts = state.split(".");
  const [payload, signature] = stateParts;

  if (stateParts.length !== 2 || !payload || !signature) {
    throw new AuthSessionError(400, "invalid_oauth_state", "Google sign-in state is invalid.");
  }

  const expectedSignature = signStatePayload(config, payload);
  const expectedBuffer = Buffer.from(expectedSignature);
  const actualBuffer = Buffer.from(signature);

  if (
    expectedBuffer.length !== actualBuffer.length ||
    !timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    throw new AuthSessionError(400, "invalid_oauth_state", "Google sign-in state is invalid.");
  }

  let parsed: {
    codeVerifier?: unknown;
    createdAt?: unknown;
    nonce?: unknown;
    returnTo?: unknown;
  };

  try {
    parsed = JSON.parse(base64urlDecode(payload)) as { createdAt?: unknown; returnTo?: unknown };
  } catch {
    throw new AuthSessionError(400, "invalid_oauth_state", "Google sign-in state is invalid.");
  }

  if (
    typeof parsed.createdAt !== "number" ||
    Date.now() - parsed.createdAt > STATE_TTL_MS ||
    typeof parsed.codeVerifier !== "string" ||
    !/^[A-Za-z0-9_-]{43,128}$/.test(parsed.codeVerifier) ||
    typeof parsed.nonce !== "string" ||
    !parsed.nonce ||
    typeof parsed.returnTo !== "string"
  ) {
    throw new AuthSessionError(400, "invalid_oauth_state", "Google sign-in state is expired.");
  }

  return {
    codeVerifier: parsed.codeVerifier,
    nonce: parsed.nonce,
    returnTo: normalizeReturnTo(env, parsed.returnTo)
  };
}

export function readGoogleAuthStateReturnTo(env: AppEnv, state: string): string {
  return verifyState(env, state).returnTo;
}

export function buildGoogleAuthStartRedirect(env: AppEnv, returnTo: string | null): string {
  const config = requireGoogleAuthConfig(env);
  const safeReturnTo = normalizeReturnTo(env, returnTo);
  const codeVerifier = buildCodeVerifier();
  const nonce = randomUUID();
  const url = new URL(GOOGLE_AUTH_BASE_URL);

  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", buildState(env, {
    codeVerifier,
    nonce,
    returnTo: safeReturnTo
  }));
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", buildCodeChallenge(codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");

  return url.toString();
}

async function readJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json().catch(() => null);

  if (!response.ok || typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new AuthSessionError(502, "google_auth_failed", "Google sign-in failed.");
  }

  return payload as Record<string, unknown>;
}

async function exchangeCodeForIdToken(
  env: AppEnv,
  code: string,
  codeVerifier: string,
  fetchImpl: FetchLike
): Promise<string> {
  const config = requireGoogleAuthConfig(env);
  const response = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
      code_verifier: codeVerifier
    })
  });
  const payload = await readJsonResponse(response);
  const idToken = payload.id_token;

  if (typeof idToken !== "string" || !idToken) {
    throw new AuthSessionError(502, "google_auth_failed", "Google sign-in failed.");
  }

  return idToken;
}

async function readGoogleJwks(fetchImpl: FetchLike): Promise<JSONWebKeySet> {
  const response = await fetchImpl(GOOGLE_JWKS_URL);
  const payload = await readJsonResponse(response);
  const keys = payload.keys;

  if (!Array.isArray(keys)) {
    throw new AuthSessionError(502, "google_auth_failed", "Google sign-in failed.");
  }

  return {
    keys: keys as JSONWebKeySet["keys"]
  };
}

function isGoogleClaimValidationError(error: unknown): boolean {
  return (
    error instanceof joseErrors.JWTClaimValidationFailed ||
    error instanceof joseErrors.JWTExpired
  );
}

async function verifyGoogleIdToken(
  env: AppEnv,
  idToken: string,
  expectedNonce: string,
  fetchImpl: FetchLike
): Promise<{
  subject: string;
  email: string;
}> {
  const config = requireGoogleAuthConfig(env);
  let claims: GoogleIdTokenClaims;

  try {
    const header = decodeProtectedHeader(idToken);

    if (header.alg !== "RS256" || typeof header.kid !== "string") {
      throw new AuthSessionError(502, "google_auth_failed", "Google sign-in failed.");
    }

    const jwks = createLocalJWKSet(await readGoogleJwks(fetchImpl));
    const result = await jwtVerify(idToken, jwks, {
      algorithms: ["RS256"],
      audience: config.clientId,
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      requiredClaims: ["iss", "aud", "exp", "sub", "nonce", "email", "email_verified"]
    });
    claims = result.payload;
  } catch (error) {
    if (error instanceof AuthSessionError) {
      throw error;
    }

    if (isGoogleClaimValidationError(error)) {
      throw new AuthSessionError(403, "google_email_unverified", "Google email is not verified.");
    }
    throw new AuthSessionError(502, "google_auth_failed", "Google sign-in failed.");
  }

  if (
    claims.nonce !== expectedNonce ||
    typeof claims.sub !== "string" ||
    typeof claims.email !== "string" ||
    claims.email_verified !== true
  ) {
    throw new AuthSessionError(403, "google_email_unverified", "Google email is not verified.");
  }

  return {
    subject: claims.sub,
    email: normalizeEmail(claims.email)
  };
}

export async function completeGoogleAuthCallback(
  db: Pool,
  env: AppEnv,
  request: IncomingMessage,
  input: {
    code: string;
    state: string;
  },
  options?: CompleteGoogleAuthCallbackOptions
): Promise<{
  payload: SessionResponse;
  setCookie: string;
  returnTo: string;
}> {
  if (!input.code?.trim()) {
    throw new AuthSessionError(400, "invalid_request", "Google auth code is required.");
  }

  if (!input.state?.trim()) {
    throw new AuthSessionError(400, "invalid_oauth_state", "Google sign-in state is invalid.");
  }

  const { codeVerifier, nonce, returnTo } = verifyState(env, input.state);
  const fetchImpl = options?.fetch ?? fetch;
  const idToken = await exchangeCodeForIdToken(env, input.code, codeVerifier, fetchImpl);
  const profile = await verifyGoogleIdToken(env, idToken, nonce, fetchImpl);

  const sessionResult = await withTransaction(db, async (client) => {
    const existingGoogleIdentity = await readIdentityByTypeIdentifier(
      client,
      "google",
      profile.subject
    );

    if (existingGoogleIdentity && existingGoogleIdentity.user_status !== "active") {
      throw new AuthSessionError(403, "unauthorized", "User account is unavailable.");
    }

    if (existingGoogleIdentity) {
      return createAuthenticatedSessionForUser(client, env, request, {
        userId: existingGoogleIdentity.user_id,
        identityDisplay: profile.email,
        createdUser: false,
        cashAccountId: null
      });
    }

    const existingEmailIdentity = await readIdentityByTypeIdentifier(client, "email", profile.email);

    if (existingEmailIdentity && existingEmailIdentity.user_status !== "active") {
      throw new AuthSessionError(403, "unauthorized", "User account is unavailable.");
    }

    if (existingEmailIdentity) {
      await insertUserIdentity(client, {
        userId: existingEmailIdentity.user_id,
        type: "google",
        identifierNormalized: profile.subject,
        identifierDisplay: profile.email
      });

      return createAuthenticatedSessionForUser(client, env, request, {
        userId: existingEmailIdentity.user_id,
        identityDisplay: profile.email,
        createdUser: false,
        cashAccountId: null
      });
    }

    const createdUser = await createUserWithIdentity(client, {
      type: "google",
      identifierNormalized: profile.subject,
      identifierDisplay: profile.email
    });

    return createAuthenticatedSessionForUser(client, env, request, {
      userId: createdUser.userId,
      identityDisplay: profile.email,
      createdUser: true,
      cashAccountId: createdUser.cashAccountId
    });
  });

  return {
    ...sessionResult,
    returnTo
  };
}
