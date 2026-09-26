import type { Queryable } from "../../db/client/pool";
import type { AuthChallengeRow, RecentStartRow } from "./types";

// Anti-bombing invariant: an attacker spamming auth/start for one identifier
// creates pending rows → still capped at 5/hr by readRecentChallengeCount and
// still cooldown-limited here. Only pending challenges gate a resend; consumed
// ones (successful logins) must never block re-auth from a second context.
export async function readRecentChallenge(
  db: Queryable,
  identifier: string
): Promise<AuthChallengeRow | null> {
  const result = await db.query<AuthChallengeRow>(
    `
      select
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
      from otp_challenges
      where identifier_type = 'email'
        and identifier_normalized = $1
        and status = 'pending'
      order by created_at desc
      limit 1
    `,
    [identifier]
  );

  return result.rows[0] ?? null;
}

// Count only challenges that represent attack pressure: pending (active) and
// expired (sent but never consumed, including mail-failure and max-attempts).
// Consumed rows are successful logins — counting them would lock out a user
// who logged in 5 times in an hour. status != 'consumed' also captures any
// future 'cancelled' rows on the safe (blocking) side.
export async function readRecentChallengeCount(
  db: Queryable,
  identifier: string
): Promise<number> {
  const result = await db.query<RecentStartRow>(
    `
      select count(*)::text as recent_count
      from otp_challenges
      where identifier_type = 'email'
        and identifier_normalized = $1
        and created_at >= now() - interval '1 hour'
        and status != 'consumed'
    `,
    [identifier]
  );

  return Number(result.rows[0]?.recent_count ?? "0");
}

export async function readChallengeForVerification(
  db: Queryable,
  challengeId: string
): Promise<AuthChallengeRow | null> {
  const result = await db.query<AuthChallengeRow>(
    `
      select
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
      from otp_challenges
      where id = $1
      limit 1
      for update
    `,
    [challengeId]
  );

  return result.rows[0] ?? null;
}
