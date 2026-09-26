import type { IncomingMessage } from "node:http";

import type { AppEnv } from "../../config/env";
import type { Queryable } from "../../db/client/pool";
import { resolveClientIp } from "../../http/client-ip";
import { hashValue } from "./hashing";
import type { SessionSummaryRow } from "./types";

const SESSION_TOUCH_INTERVAL_MS = 60_000;

export function readClientFingerprint(request: IncomingMessage): {
  ipHash: string | null;
  userAgentHash: string | null;
} {
  const ip = resolveClientIp(request);
  const userAgent = request.headers["user-agent"]?.toString() || null;

  return {
    ipHash: ip ? hashValue(ip) : null,
    userAgentHash: userAgent ? hashValue(userAgent) : null
  };
}

export function shouldTouchSessionActivity(lastSeenAt: Date | null | undefined, now = Date.now()): boolean {
  if (!(lastSeenAt instanceof Date)) {
    return true;
  }

  return lastSeenAt.getTime() + SESSION_TOUCH_INTERVAL_MS <= now;
}

// Rolling session: every throttled activity touch (see shouldTouchSessionActivity,
// once per SESSION_TOUCH_INTERVAL_MS) also slides expires_at forward by the
// configured TTL — but never past created_at + the absolute lifetime. That cap
// means a session touched forever still dies eventually; a genuinely idle
// session keeps expiring on schedule since nothing extends it after the last
// touch. Riding the existing throttled write rather than adding a new one —
// see the stress-baseline note on sessions.last_seen_at write pressure.
export async function touchSessionActivity(
  db: Queryable,
  env: AppEnv,
  sessionId: string,
  createdAt: Date
): Promise<void> {
  const now = Date.now();
  const slidingExpiresAt = new Date(now + env.auth.sessionTtlHours * 60 * 60 * 1000);
  const absoluteCapAt = new Date(
    createdAt.getTime() + env.auth.sessionAbsoluteTtlHours * 60 * 60 * 1000
  );
  const nextExpiresAt = slidingExpiresAt.getTime() < absoluteCapAt.getTime()
    ? slidingExpiresAt
    : absoluteCapAt;

  await db.query(
    `
      update sessions
      set last_seen_at = now(),
          expires_at = $2
      where id = $1
    `,
    [sessionId, nextExpiresAt.toISOString()]
  );
}

export async function readSessionSummaryByToken(
  db: Queryable,
  token: string
): Promise<SessionSummaryRow | null> {
  const result = await db.query<SessionSummaryRow>(
    `
      select
        s.id as session_id,
        s.user_id,
        s.created_at,
        s.last_seen_at,
        s.expires_at,
        s.status as session_status,
        u.status as user_status,
        ui.identifier_display
      from sessions s
      join users u
        on u.id = s.user_id
      left join user_identities ui
        on ui.user_id = u.id
       and ui.type = 'email'
       and ui.status = 'active'
      where s.token_hash = $1
      limit 1
    `,
    [hashValue(token)]
  );

  return result.rows[0] ?? null;
}
