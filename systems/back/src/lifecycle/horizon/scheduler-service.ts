import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { Queryable } from "../../db/client/pool";

const HORIZON_SCHEDULER_LOCK_KEY = "hachozeh:horizon_scheduler";

export type HorizonSchedulerClockSnapshot = {
  dbNow: string;
  nextCloseAt: string | null;
  overdueOpenMarketCount: number;
};

export type PersistHorizonSchedulerSnapshotInput = {
  generatedAt: string;
  summarySnapshot: Record<string, unknown>;
  payloadSnapshot: Record<string, unknown>;
};

export type HorizonSchedulerSleepInput = {
  now: Date;
  nextCloseAt: string | null;
  minSleepMs: number;
  maxSleepMs: number;
  hadDueWork: boolean;
};

export function normalizeSchedulerInteger(
  value: string | number | undefined,
  fallback: number,
  options: {
    min: number;
    max: number;
    fieldName: string;
  }
): number {
  if (value === undefined || value === "") {
    return fallback;
  }

  const numeric = typeof value === "number"
    ? value
    : /^\d+$/.test(value)
      ? Number(value)
      : Number.NaN;

  if (!Number.isInteger(numeric) || numeric < options.min || numeric > options.max) {
    throw new Error(`${options.fieldName} must be an integer between ${options.min} and ${options.max}.`);
  }

  return numeric;
}

export function calculateHorizonSchedulerSleepMs(input: HorizonSchedulerSleepInput): number {
  if (input.maxSleepMs < input.minSleepMs) {
    throw new Error("maxSleepMs must be greater than or equal to minSleepMs.");
  }

  if (input.hadDueWork) {
    return input.minSleepMs;
  }

  if (!input.nextCloseAt) {
    return input.maxSleepMs;
  }

  const nextCloseMs = Date.parse(input.nextCloseAt);

  if (!Number.isFinite(nextCloseMs)) {
    return input.maxSleepMs;
  }

  const deltaMs = nextCloseMs - input.now.getTime();

  if (deltaMs <= input.minSleepMs) {
    return input.minSleepMs;
  }

  return Math.min(deltaMs, input.maxSleepMs);
}

function readCount(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number(value);
  }

  return 0;
}

export async function readHorizonSchedulerClockSnapshot(
  db: Queryable
): Promise<HorizonSchedulerClockSnapshot> {
  const result = await db.query<{
    db_now: Date;
    next_close_at: Date | null;
    overdue_open_market_count: string | number;
  }>(
    `
      select
        now() as db_now,
        (
          select min(close_at)
          from markets
          where status = 'open'
        ) as next_close_at,
        (
          select count(*)
          from markets
          where status = 'open'
            and close_at <= now()
        ) as overdue_open_market_count
    `
  );
  const row = result.rows[0];

  return {
    dbNow: row?.db_now?.toISOString() ?? new Date().toISOString(),
    nextCloseAt: row?.next_close_at?.toISOString() ?? null,
    overdueOpenMarketCount: readCount(row?.overdue_open_market_count)
  };
}

export async function acquireHorizonSchedulerLock(pool: Pool): Promise<PoolClient | null> {
  const client = await pool.connect();

  try {
    const result = await client.query<{ acquired: boolean }>(
      `
        select pg_try_advisory_lock(hashtext($1)::bigint) as acquired
      `,
      [HORIZON_SCHEDULER_LOCK_KEY]
    );

    if (result.rows[0]?.acquired === true) {
      return client;
    }
  } catch (error) {
    client.release();
    throw error;
  }

  client.release();
  return null;
}

export async function releaseHorizonSchedulerLock(client: PoolClient | null): Promise<void> {
  if (!client) {
    return;
  }

  try {
    await client.query(
      `
        select pg_advisory_unlock(hashtext($1)::bigint)
      `,
      [HORIZON_SCHEDULER_LOCK_KEY]
    );
  } finally {
    client.release();
  }
}

export async function persistHorizonSchedulerSnapshot(
  db: Queryable,
  input: PersistHorizonSchedulerSnapshotInput
): Promise<string> {
  const snapshotId = `hrsnap_${randomUUID()}`;

  await db.query(
    `
      insert into oracle_runtime_snapshots (
        id,
        runtime_type,
        market_status_filter,
        generated_at,
        summary_snapshot,
        payload_snapshot
      )
      values ($1, 'horizon-scheduler', 'open', $2, $3::jsonb, $4::jsonb)
    `,
    [
      snapshotId,
      input.generatedAt,
      JSON.stringify(input.summarySnapshot),
      JSON.stringify(input.payloadSnapshot)
    ]
  );

  return snapshotId;
}
