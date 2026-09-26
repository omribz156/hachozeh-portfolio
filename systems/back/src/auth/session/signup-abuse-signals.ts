import { randomUUID } from "node:crypto";

import type { Queryable } from "../../db/client/pool";

const SIGNUP_VELOCITY_USER_THRESHOLD = 3;

type FingerprintInput = {
  ipHash: string | null;
  userAgentHash: string | null;
};

async function readRecentDistinctUserCount(
  db: Queryable,
  columnName: "ip_hash" | "user_agent_hash",
  hashValue: string
): Promise<number> {
  const result = await db.query<{ user_count: string }>(
    `
      select count(distinct user_id)::text as user_count
      from sessions
      where ${columnName} = $1
        and created_at >= now() - interval '24 hours'
    `,
    [hashValue]
  );

  return Number(result.rows[0]?.user_count ?? "0");
}

async function hasRecentOpenFlag(
  db: Queryable,
  userId: string,
  signalType: string
): Promise<boolean> {
  const result = await db.query<{ exists: boolean }>(
    `
      select exists (
        select 1
        from user_abuse_flags
        where user_id = $1
          and flag_type = 'signup_velocity'
          and status = 'open'
          and evidence->>'signalType' = $2
          and created_at >= now() - interval '24 hours'
      ) as exists
    `,
    [userId, signalType]
  );

  return Boolean(result.rows[0]?.exists);
}

async function insertSignupVelocityFlag(
  db: Queryable,
  input: {
    userId: string;
    signalType: "ip_hash" | "user_agent_hash";
    distinctUserCount: number;
  }
): Promise<void> {
  await db.query(
    `
      insert into user_abuse_flags (id, user_id, flag_type, severity, status, evidence)
      values ($1, $2, 'signup_velocity', 'watch', 'open', $3::jsonb)
    `,
    [
      `abuse_flag_${randomUUID()}`,
      input.userId,
      JSON.stringify({
        signalType: input.signalType,
        distinctUserCount: input.distinctUserCount,
        threshold: SIGNUP_VELOCITY_USER_THRESHOLD,
        windowHours: 24
      })
    ]
  );
}

export async function recordSignupVelocitySignals(
  db: Queryable,
  userId: string,
  fingerprint: FingerprintInput
): Promise<void> {
  const signals: Array<["ip_hash" | "user_agent_hash", string | null]> = [
    ["ip_hash", fingerprint.ipHash],
    ["user_agent_hash", fingerprint.userAgentHash]
  ];

  for (const [signalType, hashValue] of signals) {
    if (!hashValue) {
      continue;
    }

    const distinctUserCount = await readRecentDistinctUserCount(db, signalType, hashValue);
    if (distinctUserCount < SIGNUP_VELOCITY_USER_THRESHOLD) {
      continue;
    }

    if (await hasRecentOpenFlag(db, userId, signalType)) {
      continue;
    }

    await insertSignupVelocityFlag(db, {
      userId,
      signalType,
      distinctUserCount
    });
  }
}
