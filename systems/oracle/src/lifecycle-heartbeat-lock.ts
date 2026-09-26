import type { Pool, PoolClient } from "pg";

const ORACLE_LIFECYCLE_HEARTBEAT_LOCK_KEY = "hachozeh:oracle_lifecycle_heartbeat";

export async function acquireOracleLifecycleHeartbeatLock(pool: Pool): Promise<PoolClient | null> {
  const client = await pool.connect();

  try {
    const result = await client.query<{ acquired: boolean }>(
      `
        select pg_try_advisory_lock(hashtext($1)::bigint) as acquired
      `,
      [ORACLE_LIFECYCLE_HEARTBEAT_LOCK_KEY]
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

export async function releaseOracleLifecycleHeartbeatLock(client: PoolClient | null): Promise<void> {
  if (!client) {
    return;
  }

  try {
    await client.query(
      `
        select pg_advisory_unlock(hashtext($1)::bigint)
      `,
      [ORACLE_LIFECYCLE_HEARTBEAT_LOCK_KEY]
    );
  } finally {
    client.release();
  }
}
