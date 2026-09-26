import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";

import {
  acquireOracleLifecycleHeartbeatLock,
  releaseOracleLifecycleHeartbeatLock
} from "../../../../oracle/src/lifecycle-heartbeat-lock";

function createPool(acquired: boolean) {
  const client = {
    query: vi.fn(async () => ({ rows: [{ acquired }] })),
    release: vi.fn()
  } as unknown as PoolClient & { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
  const pool = {
    connect: vi.fn(async () => client)
  } as unknown as Pool;

  return { pool, client };
}

describe("oracle lifecycle heartbeat lock", () => {
  it("returns the held client when the singleton lock is acquired", async () => {
    const { pool, client } = createPool(true);

    const lockClient = await acquireOracleLifecycleHeartbeatLock(pool);

    expect(lockClient).toBe(client);
    expect(client.release).not.toHaveBeenCalled();
  });

  it("releases and returns null when another heartbeat worker owns the lock", async () => {
    const { pool, client } = createPool(false);

    const lockClient = await acquireOracleLifecycleHeartbeatLock(pool);

    expect(lockClient).toBeNull();
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("unlocks before releasing the held client", async () => {
    const { client } = createPool(true);

    await releaseOracleLifecycleHeartbeatLock(client);

    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("pg_advisory_unlock"), [
      "hachozeh:oracle_lifecycle_heartbeat"
    ]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
