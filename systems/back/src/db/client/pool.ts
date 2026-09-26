import { Pool, type PoolClient, type PoolConfig } from "pg";

import type { AppEnv } from "../../config/env";

export type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

function buildPoolConfig(env: AppEnv["db"]): PoolConfig {
  return {
    host: env.host,
    port: env.port,
    database: env.name,
    user: env.user,
    password: env.password,
    connectionTimeoutMillis: env.connectTimeoutMs,
    statement_timeout: env.statementTimeoutMs,
    query_timeout: env.queryTimeoutMs,
    lock_timeout: env.lockTimeoutMs,
    idle_in_transaction_session_timeout: env.idleInTransactionSessionTimeoutMs,
    application_name: process.env["SERVICE_NAME"] || "hachozeh-backend",
    max: env.poolMax ?? 30
  };
}

export function createDbPool(env: AppEnv["db"]): Pool {
  const pool = new Pool(buildPoolConfig(env));
  pool.on("error", (error) => {
    console.error("db.pool.idle_client_error", error);
  });
  return pool;
}
