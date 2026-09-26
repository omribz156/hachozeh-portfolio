import { randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Pool } from "pg";

import type { AppEnv } from "../config/env";
import type { Queryable } from "../db/client/pool";
import { withTransaction } from "../db/tx/with-transaction";
import { withSavepoint } from "../shared/transaction-savepoint";
import { buildClearedSessionCookie, buildSessionCookie, readCookie } from "./session-cookie";
import { AuthSessionError } from "./session/errors";
import { hashValue } from "./session/hashing";
import {
  readChallengeForVerification,
  readRecentChallenge,
  readRecentChallengeCount
} from "./session/otp-challenges";
import { assertAuthMailCanSend, sendAuthOtpEmail } from "./session/otp-mailer";
import { parseStartBody, parseVerifyBody } from "./session/request-parsers";
import {
  buildAnonymousSessionResponse,
  buildAuthenticatedSessionResponse,
  buildOtpCode,
  buildStartResponse
} from "./session/responses";
import {
  readClientFingerprint,
  readSessionSummaryByToken,
  shouldTouchSessionActivity,
  touchSessionActivity
} from "./session/session-records";
import { recordSignupVelocitySignals } from "./session/signup-abuse-signals";
import { grantReferralReward } from "./session/referral-grant";
import { grantStarterBonus } from "./session/starter-bonus";
import { recordActiveDay, recordRetentionMilestone } from "../analytics/retention-events-service";
import { createWelcomeNotification } from "../notifications/notification-feed-service";
import type { AuthStartResponse, SessionResponse, SessionSummaryResult } from "./session/types";
import {
  createUserWithIdentity,
  insertUserIdentity,
  readGoogleIdentitiesByDisplayEmail,
  readIdentityByIdentifier
} from "./session/user-identity-records";
import { STARTER_GRANT_AMOUNT } from "../economy/economy-config";

export { AuthSessionError } from "./session/errors";
export type { AuthStartResponse, SessionResponse, SessionSummaryResult } from "./session/types";

type AuthStartInsertResult = {
  challengeId: string;
  code: string;
  expiresAt: Date;
  identifier: string;
  purpose: "login" | "signup";
};

type VerifyChallengeResult =
  | {
      kind: "success";
      response: {
        payload: SessionResponse;
        setCookie: string;
      };
    }
  | {
      kind: "invalid_code";
    }
  | {
      kind: "rate_limited";
    };

function canUseTransaction(db: Queryable): db is Pool {
  return typeof (db as { connect?: unknown }).connect === "function";
}

async function lockAuthStartIdentifier(db: Queryable, identifier: string): Promise<void> {
  await db.query(
    `
      select pg_advisory_xact_lock(hashtext($1), hashtext($2))
    `,
    ["auth_start", identifier]
  );
}

// Acquisition source for the signup cohort event. The web middleware stamps an
// `hz_src` first-touch cookie when a tagged link (e.g. a share URL's ?ref=)
// lands; same-origin API calls carry it here. Best-effort and strictly shaped —
// never let a crafted cookie break signup or smuggle free text into analytics.
function readAcquisitionSource(request: IncomingMessage): Record<string, string> | undefined {
  const meta: Record<string, string> = {};

  // hz_src — referral/share first-touch. `source` is the ONLY key the referral
  // payout keys on (see grantReferralReward below), so nothing else may set it.
  const raw = readCookie(request, "hz_src");
  if (raw) {
    const value = raw.slice(0, 60);
    if (/^[\w:.-]+$/.test(value)) meta.source = value;
  }

  // hz_utm — marketing attribution (source|medium|campaign), analytics only.
  // Recorded into retention_events.metadata; never sets `source`, so it can't pay.
  const utm = readCookie(request, "hz_utm");
  if (utm) {
    const [utmSource, utmMedium, utmCampaign] = utm.slice(0, 124).split("|");
    if (utmSource && /^[\w.-]+$/.test(utmSource)) meta.utmSource = utmSource;
    if (utmMedium && /^[\w.-]+$/.test(utmMedium)) meta.utmMedium = utmMedium;
    if (utmCampaign && /^[\w.-]+$/.test(utmCampaign)) meta.utmCampaign = utmCampaign;
  }

  return Object.keys(meta).length > 0 ? meta : undefined;
}

export async function createAuthenticatedSessionForUser(
  db: Queryable,
  env: AppEnv,
  request: IncomingMessage,
  input: {
    userId: string;
    identityDisplay: string;
    createdUser: boolean;
    cashAccountId: string | null;
  }
): Promise<{
  payload: SessionResponse;
  setCookie: string;
}> {
  if (input.createdUser) {
    if (!input.cashAccountId) {
      throw new Error("Created user is missing a cash account for starter grant.");
    }

    await grantStarterBonus(db, input.userId, input.cashAccountId);
    const acquisition = readAcquisitionSource(request);
    await recordRetentionMilestone(db, input.userId, "signup", acquisition);
    // Share-attributed signup → credit the sharer (savepoint-guarded inside;
    // a failed reward can never fail the signup).
    if (acquisition?.source) {
      await grantReferralReward(db, { newUserId: input.userId, source: acquisition.source });
    }
    // Best-effort welcome notification → opens the "how it works" tour on click.
    // Never let it break signup.
    await withSavepoint(db, "auth_signup_welcome", () => createWelcomeNotification(db, input.userId));
  }

  // Active-day signal for D1/D7 (covers the login/signup day; subsequent days are
  // captured by resolveRequestActor). Fire-and-forget, deduped per Jerusalem day.
  recordActiveDay(db, input.userId);

  const sessionId = `session_${randomUUID()}`;
  const rawToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + env.auth.sessionTtlHours * 60 * 60 * 1000);
  const fingerprint = readClientFingerprint(request);

  await db.query(
    `
      insert into sessions (
        id,
        user_id,
        status,
        token_hash,
        expires_at,
        ip_hash,
        user_agent_hash
      )
      values ($1, $2, 'active', $3, $4, $5, $6)
    `,
    [
      sessionId,
      input.userId,
      hashValue(rawToken),
      expiresAt.toISOString(),
      fingerprint.ipHash,
      fingerprint.userAgentHash
    ]
  );

  if (input.createdUser) {
    await recordSignupVelocitySignals(db, input.userId, fingerprint);
  }

  await db.query(
    `
      update users
      set last_login_at = now(),
          updated_at = now()
      where id = $1
    `,
    [input.userId]
  );

  return {
    payload: buildAuthenticatedSessionResponse(
      input.userId,
      input.identityDisplay,
      expiresAt,
      {
        createdUser: input.createdUser,
        starterGrantAmount: input.createdUser ? STARTER_GRANT_AMOUNT : null
      }
    ),
    // Cookie lifetime = the ABSOLUTE session ceiling, not the initial sliding
    // window: the DB expires_at (extended by the activity touch, capped at
    // created_at + absolute TTL) is the auth authority, and a cookie that
    // outlives the DB row just presents a dead token and 401s. A cookie capped
    // at the sliding window would make the browser forget the token at day 7
    // and silently defeat the rolling session.
    setCookie: buildSessionCookie(
      env,
      rawToken,
      new Date(Date.now() + env.auth.sessionAbsoluteTtlHours * 60 * 60 * 1000)
    )
  };
}

export async function startAuthChallenge(
  db: Queryable,
  env: AppEnv,
  body: unknown
): Promise<AuthStartResponse> {
  const request = parseStartBody(body);

  const inserted = canUseTransaction(db)
    ? await withTransaction(db, async (client) => createPendingAuthChallenge(client, env, request, {
        lockIdentifier: true
      }))
    : await createPendingAuthChallenge(db, env, request);

  try {
    await sendAuthOtpEmail(env, {
      identifier: inserted.identifier,
      code: inserted.code,
      purpose: inserted.purpose,
      expiresAt: inserted.expiresAt
    });
  } catch (error) {
    await db.query(
      `
        update otp_challenges
        set status = 'expired',
            updated_at = now()
        where id = $1
          and status = 'pending'
      `,
      [inserted.challengeId]
    );

    throw error;
  }

  return buildStartResponse(
    env,
    inserted.identifier,
    inserted.purpose,
    inserted.challengeId,
    inserted.expiresAt
  );
}

async function createPendingAuthChallenge(
  db: Queryable,
  env: AppEnv,
  request: ReturnType<typeof parseStartBody>,
  options?: {
    lockIdentifier?: boolean;
  }
): Promise<AuthStartInsertResult> {
  if (options?.lockIdentifier) {
    await lockAuthStartIdentifier(db, request.identifier);
  }

  const [recentChallenge, recentCount] = await Promise.all([
    readRecentChallenge(db, request.identifier),
    readRecentChallengeCount(db, request.identifier)
  ]);
  const now = Date.now();

  // Rate limits hold in every environment — test escapes go through
  // AUTH_DEV_OTP_EXPOSED (which skips email delivery), never through
  // disabling the limits themselves.
  if (
    recentChallenge &&
    recentChallenge.last_sent_at.getTime() + env.auth.otpResendCooldownSeconds * 1000 > now
  ) {
    throw new AuthSessionError(
      429,
      "rate_limited",
      "Please wait a moment before requesting another code."
    );
  }

  if (recentCount >= 5) {
    throw new AuthSessionError(
      429,
      "rate_limited",
      "Too many verification attempts. Please try again later."
    );
  }

  assertAuthMailCanSend(env);

  const code = buildOtpCode(env);
  const challengeId = `otp_${randomUUID()}`;
  const expiresAt = new Date(now + env.auth.otpTtlMinutes * 60 * 1000);

  await db.query(
    `
      insert into otp_challenges (
        id,
        identifier_type,
        identifier_normalized,
        purpose,
        code_hash,
        status,
        attempt_count,
        max_attempts,
        last_sent_at,
        expires_at
      )
      values ($1, 'email', $2, $3, $4, 'pending', 0, $5, now(), $6)
    `,
    [
      challengeId,
      request.identifier,
      request.purpose,
      hashValue(code),
      env.auth.otpMaxAttempts,
      expiresAt.toISOString()
    ]
  );

  return {
    challengeId,
    code,
    expiresAt,
    identifier: request.identifier,
    purpose: request.purpose
  };
}

export async function verifyAuthChallenge(
  db: Pool,
  env: AppEnv,
  request: IncomingMessage,
  body: unknown
): Promise<{
  payload: SessionResponse;
  setCookie: string;
}> {
  const input = parseVerifyBody(body);

  const verification = await withTransaction<VerifyChallengeResult>(
    db,
    async (client): Promise<VerifyChallengeResult> => {
    const challenge = await readChallengeForVerification(client, input.challengeId);

    if (!challenge || challenge.status !== "pending" || challenge.expires_at.getTime() <= Date.now()) {
      throw new AuthSessionError(400, "invalid_code", "Verification code is invalid or expired.");
    }

    if (challenge.attempt_count >= challenge.max_attempts) {
      await client.query(
        `
          update otp_challenges
          set status = 'expired',
              updated_at = now()
          where id = $1
        `,
        [challenge.id]
      );

      return {
        kind: "rate_limited"
      };
    }

    if (challenge.code_hash !== hashValue(input.code)) {
      const nextAttempts = challenge.attempt_count + 1;
      const nextStatus = nextAttempts >= challenge.max_attempts ? "expired" : "pending";

      await client.query(
        `
          update otp_challenges
          set attempt_count = $2,
              status = $3,
              updated_at = now()
          where id = $1
        `,
        [challenge.id, nextAttempts, nextStatus]
      );

      return {
        kind: "invalid_code"
      };
    }

    const consumedChallenge = await client.query(
      `
        update otp_challenges
        set status = 'consumed',
            consumed_at = now(),
            updated_at = now()
        where id = $1
          and status = 'pending'
      `,
      [challenge.id]
    );

    if (typeof consumedChallenge.rowCount === "number" && consumedChallenge.rowCount === 0) {
      throw new AuthSessionError(400, "invalid_code", "Verification code is invalid or expired.");
    }

    let existingIdentity = await readIdentityByIdentifier(
      client,
      challenge.identifier_normalized
    );
    const googleIdentities = await readGoogleIdentitiesByDisplayEmail(
      client,
      challenge.identifier_normalized
    );
    const googleIdentityUserIds = new Set(googleIdentities.map((identity) => identity.user_id));

    if (googleIdentityUserIds.size > 1) {
      throw new AuthSessionError(
        409,
        "identity_conflict",
        "Multiple accounts use this email. Please contact support."
      );
    }

    const googleIdentity = googleIdentities[0] ?? null;

    if (
      existingIdentity &&
      googleIdentity &&
      googleIdentity.user_id !== existingIdentity.user_id
    ) {
      throw new AuthSessionError(
        409,
        "identity_conflict",
        "Multiple accounts use this email. Please contact support."
      );
    }

    if (!existingIdentity) {
      if (googleIdentity) {
        if (googleIdentity.user_status !== "active") {
          throw new AuthSessionError(403, "unauthorized", "User account is unavailable.");
        }

        await insertUserIdentity(client, {
          userId: googleIdentity.user_id,
          type: "email",
          identifierNormalized: challenge.identifier_normalized,
          identifierDisplay: challenge.identifier_normalized
        });

        existingIdentity = googleIdentity;
      }
    }

    if (existingIdentity && existingIdentity.user_status !== "active") {
      throw new AuthSessionError(403, "unauthorized", "User account is unavailable.");
    }

    const createdUser =
      existingIdentity ? null : await createUserWithIdentity(client, challenge.identifier_normalized);
    const userId = existingIdentity?.user_id ?? createdUser?.userId;

    if (!userId) {
      throw new Error("Auth verify user resolution failed.");
    }

    const response = await createAuthenticatedSessionForUser(client, env, request, {
      userId,
      identityDisplay: challenge.identifier_normalized,
      createdUser: Boolean(createdUser),
      cashAccountId: createdUser?.cashAccountId ?? null
    });

    return {
      kind: "success",
      response
    };
    }
  );

  if (verification.kind === "success") {
    return verification.response;
  }

  if (verification.kind === "invalid_code") {
    throw new AuthSessionError(400, "invalid_code", "Verification code is invalid or expired.");
  }

  if (verification.kind === "rate_limited") {
    throw new AuthSessionError(429, "rate_limited", "Too many verification attempts. Please start again.");
  }

  throw new Error("Unexpected verification outcome.");
}

export async function readSessionSummary(
  db: Queryable,
  env: AppEnv,
  request: IncomingMessage
): Promise<SessionSummaryResult> {
  const token = readCookie(request, env.auth.sessionCookieName);

  if (!token) {
    return {
      payload: buildAnonymousSessionResponse(),
      setCookie: null
    };
  }

  const summary = await readSessionSummaryByToken(db, token);

  if (
    !summary ||
    summary.session_status !== "active" ||
    summary.user_status !== "active" ||
    summary.expires_at.getTime() <= Date.now()
  ) {
    return {
      payload: buildAnonymousSessionResponse(),
      setCookie: buildClearedSessionCookie(env)
    };
  }

  if (shouldTouchSessionActivity(summary.last_seen_at)) {
    await touchSessionActivity(db, env, summary.session_id, summary.created_at);
  }

  return {
    payload: buildAuthenticatedSessionResponse(
      summary.user_id,
      summary.identifier_display ?? "",
      summary.expires_at
    ),
    setCookie: null
  };
}

export async function logoutCurrentSession(
  db: Queryable,
  env: AppEnv,
  request: IncomingMessage
): Promise<{
  payload: SessionResponse;
  setCookie: string;
}> {
  const token = readCookie(request, env.auth.sessionCookieName);

  if (token) {
    await db.query(
      `
        update sessions
        set status = 'revoked',
            revoked_at = now(),
            revoked_reason = 'user_logout'
        where token_hash = $1
          and status = 'active'
      `,
      [hashValue(token)]
    );
  }

  return {
    payload: buildAnonymousSessionResponse(),
    setCookie: buildClearedSessionCookie(env)
  };
}
