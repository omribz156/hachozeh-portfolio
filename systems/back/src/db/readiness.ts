import type { QueryConfig } from "pg";
import type { Queryable } from "./client/pool";

export type DbReadiness = { ok: boolean; latencyMs: number };
const probes = new WeakMap<Queryable, { until: number; result: Promise<DbReadiness> }>();

/** Coalesce public probes and test the actual authenticated/TLS pool, not just TCP. */
export function checkDatabaseReadiness(pool: Queryable): Promise<DbReadiness> {
  const cached = probes.get(pool);
  if (cached && cached.until > Date.now()) return cached.result;
  const startedAt = Date.now();
  const entry = { until: Infinity, result: Promise.resolve({ ok: false, latencyMs: 0 }) };
  entry.result = new Promise<DbReadiness>((resolve) => {
    const finish = (ok: boolean) => resolve({ ok, latencyMs: Date.now() - startedAt });
    const timer = setTimeout(() => finish(false), 5_000);
    const query: QueryConfig & { query_timeout: number } = { text: "select 1", query_timeout: 5_000 };
    Promise.resolve().then(() => pool.query(query))
      .then(() => finish(true), () => finish(false))
      .finally(() => {
        clearTimeout(timer);
        entry.until = Date.now() + 5_000;
      });
  });
  probes.set(pool, entry);
  return entry.result;
}
