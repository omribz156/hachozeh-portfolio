import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Pool, PoolClient } from "pg";

import { withTransaction } from "../../src/db/tx/with-transaction";

function createClient() {
  return {
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
    release: vi.fn()
  } as unknown as PoolClient & {
    query: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
  };
}

describe("withTransaction", () => {
  it("retries deadlock failures with a fresh transaction", async () => {
    const firstClient = createClient();
    const secondClient = createClient();
    const pool = {
      connect: vi.fn()
        .mockResolvedValueOnce(firstClient)
        .mockResolvedValueOnce(secondClient)
    } as unknown as Pool & {
      connect: ReturnType<typeof vi.fn>;
    };
    const deadlock = Object.assign(new Error("deadlock detected"), {
      code: "40P01"
    });
    const fn = vi.fn()
      .mockRejectedValueOnce(deadlock)
      .mockResolvedValueOnce("ok");

    await expect(withTransaction(pool, fn)).resolves.toBe("ok");

    expect(pool.connect).toHaveBeenCalledTimes(2);
    expect(firstClient.query).toHaveBeenCalledWith("begin");
    expect(firstClient.query).toHaveBeenCalledWith("rollback");
    expect(firstClient.release).toHaveBeenCalledTimes(1);
    expect(secondClient.query).toHaveBeenCalledWith("begin");
    expect(secondClient.query).toHaveBeenCalledWith("commit");
    expect(secondClient.release).toHaveBeenCalledTimes(1);
  });

  it("does not retry non-transaction errors", async () => {
    const client = createClient();
    const pool = {
      connect: vi.fn().mockResolvedValue(client)
    } as unknown as Pool;
    const fn = vi.fn().mockRejectedValue(new Error("boom"));

    await expect(withTransaction(pool, fn)).rejects.toThrow("boom");

    expect(fn).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledWith("rollback");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  describe("SET LOCAL timeouts", () => {
    it("issues statement_timeout and lock_timeout SET LOCAL immediately after BEGIN", async () => {
      const client = createClient();
      const pool = {
        connect: vi.fn().mockResolvedValue(client)
      } as unknown as Pool;
      const fn = vi.fn().mockResolvedValue("done");

      await withTransaction(pool, fn);

      const calls: string[] = (client.query as ReturnType<typeof vi.fn>).mock.calls.map(
        (c: unknown[]) => String(c[0])
      );
      const beginIdx = calls.indexOf("begin");
      const stmtIdx = calls.findIndex((q) => q.startsWith("set local statement_timeout"));
      const lockIdx = calls.findIndex((q) => q.startsWith("set local lock_timeout"));
      const commitIdx = calls.indexOf("commit");

      expect(beginIdx).toBeGreaterThanOrEqual(0);
      expect(stmtIdx).toBeGreaterThan(beginIdx);
      expect(lockIdx).toBeGreaterThan(beginIdx);
      expect(commitIdx).toBeGreaterThan(stmtIdx);
      expect(commitIdx).toBeGreaterThan(lockIdx);
    });

    it("uses env overrides DB_TX_STATEMENT_TIMEOUT_MS and DB_TX_LOCK_TIMEOUT_MS when set", async () => {
      const origStmt = process.env["DB_TX_STATEMENT_TIMEOUT_MS"];
      const origLock = process.env["DB_TX_LOCK_TIMEOUT_MS"];
      process.env["DB_TX_STATEMENT_TIMEOUT_MS"] = "5000";
      process.env["DB_TX_LOCK_TIMEOUT_MS"] = "2000";

      try {
        const client = createClient();
        const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
        await withTransaction(pool, vi.fn().mockResolvedValue(null));

        const calls: string[] = (client.query as ReturnType<typeof vi.fn>).mock.calls.map(
          (c: unknown[]) => String(c[0])
        );
        expect(calls.some((q) => q.includes("5000"))).toBe(true);
        expect(calls.some((q) => q.includes("2000"))).toBe(true);
      } finally {
        if (origStmt === undefined) {
          delete process.env["DB_TX_STATEMENT_TIMEOUT_MS"];
        } else {
          process.env["DB_TX_STATEMENT_TIMEOUT_MS"] = origStmt;
        }
        if (origLock === undefined) {
          delete process.env["DB_TX_LOCK_TIMEOUT_MS"];
        } else {
          process.env["DB_TX_LOCK_TIMEOUT_MS"] = origLock;
        }
      }
    });
  });

  describe("55P03 lock_timeout retry", () => {
    it("retries on lock_timeout (55P03) just like a deadlock", async () => {
      const firstClient = createClient();
      const secondClient = createClient();
      const pool = {
        connect: vi.fn()
          .mockResolvedValueOnce(firstClient)
          .mockResolvedValueOnce(secondClient)
      } as unknown as Pool & { connect: ReturnType<typeof vi.fn> };

      const lockTimeout = Object.assign(new Error("lock timeout"), { code: "55P03" });
      const fn = vi.fn()
        .mockRejectedValueOnce(lockTimeout)
        .mockResolvedValueOnce("retried");

      await expect(withTransaction(pool, fn)).resolves.toBe("retried");

      expect(pool.connect).toHaveBeenCalledTimes(2);
      expect(firstClient.query).toHaveBeenCalledWith("rollback");
      expect(secondClient.query).toHaveBeenCalledWith("commit");
    });

    it("throws after maxAttempts lock_timeout errors are exhausted", async () => {
      const client = createClient();
      const pool = {
        connect: vi.fn().mockResolvedValue(client)
      } as unknown as Pool;

      const lockTimeout = Object.assign(new Error("lock timeout"), { code: "55P03" });
      const fn = vi.fn().mockRejectedValue(lockTimeout);

      await expect(
        withTransaction(pool, fn, { maxAttempts: 2 })
      ).rejects.toMatchObject({ code: "55P03" });

      expect(fn).toHaveBeenCalledTimes(2);
    });
  });
});
