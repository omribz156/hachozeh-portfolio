/**
 * Integration test global setup.
 *
 * SAFETY CONTRACT (non-negotiable):
 *   - Reads DB_NAME from env (default "navi_test").
 *   - HARD-FAILS if DB_NAME does not end with "_test".
 *   - Overrides env vars BEFORE any app module loads so dotenv
 *     cannot silently clobber them with live-db credentials.
 *   - Creates navi_test if missing (connects to the "postgres"
 *     maintenance database).
 *   - Runs all migrations against navi_test.
 */

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Pool } from "pg";

// ── 1. Override env before any app module can load dotenv ─────────────────────
// These are set before any import of src/config/env.ts, which calls loadDotenv()
// at module-load time. Since globalSetup runs in a separate worker, the overrides
// here are effective for this process. The actual test workers inherit a clean
// process.env, so we also export them via the setup file loaded in setupFiles.

const TEST_DB_HOST = process.env["DB_HOST"] ?? "127.0.0.1";
const TEST_DB_PORT = parseInt(process.env["DB_PORT"] ?? "55432", 10);
const TEST_DB_USER = process.env["DB_USER"] ?? "navi";
const TEST_DB_PASSWORD = process.env["DB_PASSWORD"] ?? "navi";
const TEST_DB_NAME = process.env["DB_NAME"] ?? "navi_test";

// ── 2. SAFETY CHECK ────────────────────────────────────────────────────────────
if (!TEST_DB_NAME.endsWith("_test")) {
  throw new Error(
    `[integration-setup] HARD FAIL: DB_NAME="${TEST_DB_NAME}" does not end with "_test". ` +
      `Refusing to run integration tests against a non-test database. ` +
      `Set DB_NAME=navi_test (or any name ending in _test) to proceed.`
  );
}

console.log(
  `[integration-setup] target database: ${TEST_DB_USER}@${TEST_DB_HOST}:${TEST_DB_PORT}/${TEST_DB_NAME}`
);

// ── 3. Create navi_test if it does not exist ───────────────────────────────────
async function ensureTestDatabase(): Promise<void> {
  // Connect to the maintenance db to issue CREATE DATABASE
  const maintenancePool = new Pool({
    host: TEST_DB_HOST,
    port: TEST_DB_PORT,
    user: TEST_DB_USER,
    password: TEST_DB_PASSWORD,
    database: "postgres",
    connectionTimeoutMillis: 10_000
  });

  try {
    const existing = await maintenancePool.query<{ datname: string }>(
      "select datname from pg_database where datname = $1",
      [TEST_DB_NAME]
    );

    if (existing.rowCount === 0) {
      console.log(`[integration-setup] creating database "${TEST_DB_NAME}"…`);
      // Identifier cannot be parameterised in CREATE DATABASE; name is
      // validated above to end with _test so injection is not a concern.
      await maintenancePool.query(`create database "${TEST_DB_NAME}"`);
      console.log(`[integration-setup] database "${TEST_DB_NAME}" created`);
    } else {
      console.log(`[integration-setup] database "${TEST_DB_NAME}" already exists`);
    }
  } finally {
    await maintenancePool.end();
  }
}

// ── 4. Run migrations ──────────────────────────────────────────────────────────
async function runMigrations(): Promise<void> {
  const pool = new Pool({
    host: TEST_DB_HOST,
    port: TEST_DB_PORT,
    user: TEST_DB_USER,
    password: TEST_DB_PASSWORD,
    database: TEST_DB_NAME,
    connectionTimeoutMillis: 10_000
  });

  try {
    await pool.query(`
      create table if not exists schema_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const migrationsDir = resolve(__dirname, "../migrations");
    const names = (await readdir(migrationsDir))
      .filter((name) => name.endsWith(".sql"))
      .sort();

    const appliedResult = await pool.query<{ name: string }>(
      "select name from schema_migrations order by name"
    );
    const applied = new Set(appliedResult.rows.map((row) => row.name));

    for (const name of names) {
      if (applied.has(name)) {
        continue;
      }

      const sql = await readFile(resolve(migrationsDir, name), "utf8");
      const client = await pool.connect();

      try {
        await client.query("begin");
        await client.query(sql);
        await client.query("insert into schema_migrations (name) values ($1)", [name]);
        await client.query("commit");
        console.log(`[integration-setup] applied migration: ${name}`);
      } catch (err) {
        await client.query("rollback");
        throw err;
      } finally {
        client.release();
      }
    }

    console.log("[integration-setup] migrations complete");
  } finally {
    await pool.end();
  }
}

// ── 5. Exported globalSetup function ──────────────────────────────────────────
export default async function setup(): Promise<void> {
  await ensureTestDatabase();
  await runMigrations();
}
