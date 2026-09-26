import { randomUUID } from "node:crypto";

import type { Queryable } from "../db/client/pool";

// Milestone 0 — product-wide retention instrumentation.
// Best-effort analytics: writes are idempotent and must never fail a request or
// add latency to a hot path. Read side (D1/D7, activation funnel) is plain SQL.

const ZONE = "Asia/Jerusalem";

// YYYY-MM-DD in Asia/Jerusalem (en-CA renders ISO-style), so a UTC midnight
// never splits a local calendar day. Matches the faucet/profile-view convention.
function jerusalemDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

// One-time cohort milestone (signup, first_loop_complete). Idempotent per user
// via the unique (user_id, event) constraint, so callers can fire it
// unconditionally (e.g. on every trade — only the first sticks).
export async function recordRetentionMilestone(
  db: Queryable,
  userId: string,
  event: "signup" | "first_loop_complete",
  metadata?: Record<string, string>
): Promise<void> {
  await db.query(
    `insert into retention_events (id, user_id, event, metadata)
     values ($1, $2, $3, $4::jsonb)
     on conflict (user_id, event) do nothing`,
    [`ret_${randomUUID()}`, userId, event, JSON.stringify(metadata ?? {})]
  );
}

// Daily-active signal for return-day (D1/D7). Deduped per user per Jerusalem day
// by the table PK; an in-process Set skips redundant DB hits so the hot-path
// caller (resolveRequestActor) writes at most once per user/day/process. The
// upsert is fire-and-forget — it never adds request latency or throws upward.
const seenToday = new Set<string>();

export function recordActiveDay(db: Queryable, userId: string): void {
  const day = jerusalemDay(new Date());
  const key = `${userId}:${day}`;
  if (seenToday.has(key)) return;
  seenToday.add(key);
  // crude unbounded-growth guard across day rollovers
  if (seenToday.size > 50000) seenToday.clear();

  void db
    .query(
      `insert into retention_active_days (user_id, day_date)
       values ($1, $2)
       on conflict (user_id, day_date) do nothing`,
      [userId, day]
    )
    .catch(() => {
      // best-effort; drop the cache key so a later request retries the write
      seenToday.delete(key);
    });
}
