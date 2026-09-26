import type { Pool, PoolClient } from "pg";

type TransactionOptions = {
  maxAttempts?: number;
};

// Timeout defaults — generous enough to let legitimate long writes finish while
// still preventing pool exhaustion when FOR UPDATE locks queue up.
// Override per-deploy via env if your workload needs a different ceiling.
const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;
const DEFAULT_LOCK_TIMEOUT_MS = 10_000;

function getTxStatementTimeoutMs(): number {
  const v = parseInt(process.env["DB_TX_STATEMENT_TIMEOUT_MS"] ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_STATEMENT_TIMEOUT_MS;
}

function getTxLockTimeoutMs(): number {
  const v = parseInt(process.env["DB_TX_LOCK_TIMEOUT_MS"] ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_LOCK_TIMEOUT_MS;
}

function isRetryableTransactionError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;

  // 40P01 — deadlock detected
  // 40001 — serialization failure
  // 55P03 — lock_timeout: another session holds the lock; transient contention,
  //          safe to retry just like a deadlock.
  return code === "40P01" || code === "40001" || code === "55P03";
}

export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
  options: TransactionOptions = {}
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const client = await pool.connect();

    try {
      await client.query("begin");
      // SET LOCAL scopes to this transaction only — no pool-state leakage.
      await client.query(`set local statement_timeout = ${getTxStatementTimeoutMs()}`);
      await client.query(`set local lock_timeout = ${getTxLockTimeoutMs()}`);
      const result = await fn(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");

      if (attempt < maxAttempts && isRetryableTransactionError(error)) {
        continue;
      }

      throw error;
    } finally {
      client.release();
    }
  }

  throw new Error("Transaction retry exhausted unexpectedly.");
}
