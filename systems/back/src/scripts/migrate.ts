import { existsSync, readFileSync, statSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadAppEnv, type AppEnv } from "../config/env";
import { createDbPool } from "../db/client/pool";
import { withTransaction } from "../db/tx/with-transaction";

type MigrationFile = {
  name: string;
  sql: string;
};

type DbConfig = AppEnv["db"];

export type MigrateArgs = {
  allowProductionRecoveryGuardBypass: boolean;
  plan: boolean;
  reason: string | null;
};

export type MigrationPlan = {
  applied: string[];
  pending: string[];
  total: number;
  collisions: string[];
};

const grandfatheredPrefixCollisionGroups = new Set([
  [
    "010_market_family_keys.sql",
    "010_oracle_case_reviews.sql"
  ].join("|"),
  [
    "011_oracle_case_review_actions.sql",
    "011_oracle_runtime_snapshots.sql"
  ].join("|")
]);

function resolveMigrationsDir(): string {
  return resolve(__dirname, "../../migrations");
}

async function listMigrationFiles(): Promise<MigrationFile[]> {
  const directory = resolveMigrationsDir();
  const names = (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  return Promise.all(
    names.map(async (name) => ({
      name,
      sql: await readFile(resolve(directory, name), "utf8")
    }))
  );
}

/**
 * Parse the leading numeric prefix from a migration filename.
 * e.g. "010_market_family_keys.sql" → 10
 * Returns null when no numeric prefix is found.
 */
export function parseMigrationPrefix(filename: string): number | null {
  const match = /^(\d+)[_.]/.exec(filename);
  if (!match) return null;
  return parseInt(match[1], 10);
}

/**
 * Check for ambiguous duplicate numeric prefixes among migration files.
 *
 * The rule: if two or more files share the same numeric prefix AND at least
 * one of them has NOT been applied yet, the ordering is ambiguous and we must
 * abort. Known historical duplicate groups are grandfathered because fresh CI
 * databases must still be able to replay the repository's existing migrations.
 * Files that are all already applied are also grandfathered — they ran in
 * whatever order they ran and we cannot undo that.
 *
 * Returns a list of collision descriptions (empty = clean).
 */
export function detectPrefixCollisions(
  filenames: string[],
  applied: Set<string>
): string[] {
  const byPrefix = new Map<number, string[]>();

  for (const name of filenames) {
    const prefix = parseMigrationPrefix(name);
    if (prefix === null) continue;
    const group = byPrefix.get(prefix) ?? [];
    group.push(name);
    byPrefix.set(prefix, group);
  }

  const collisions: string[] = [];

  for (const [prefix, group] of byPrefix) {
    if (group.length < 2) continue;

    const groupKey = [...group].sort().join("|");
    if (grandfatheredPrefixCollisionGroups.has(groupKey)) continue;

    // Grandfather: if every file in the group is already applied, the ambiguity
    // is historical and harmless — skip.
    const allApplied = group.every((name) => applied.has(name));
    if (allApplied) continue;

    collisions.push(
      `prefix ${String(prefix).padStart(3, "0")} has ${group.length} files: ${group.join(", ")}`
    );
  }

  return collisions;
}

export function parseMigrateArgs(argv: string[]): MigrateArgs {
  const reasonArg = argv.find((arg) => arg.startsWith("--reason="));

  return {
    allowProductionRecoveryGuardBypass: argv.includes("--allow-production-recovery-guard-bypass"),
    plan: argv.includes("--plan") || argv.includes("--check"),
    reason: reasonArg ? reasonArg.slice("--reason=".length).trim() || null : null
  };
}

export function buildMigrationPlan(
  filenames: string[],
  applied: Set<string>
): MigrationPlan {
  const sorted = [...filenames].sort();

  return {
    applied: sorted.filter((name) => applied.has(name)),
    pending: sorted.filter((name) => !applied.has(name)),
    total: sorted.length,
    collisions: detectPrefixCollisions(sorted, applied)
  };
}

function reportPrefixCollisions(collisions: string[]): void {
  console.error("migration prefix collision detected — fix before running:");
  for (const msg of collisions) {
    console.error(`  ${msg}`);
  }
}

function printMigrationPlan(plan: MigrationPlan): void {
  console.log(
    `migrations total=${plan.total} applied=${plan.applied.length} pending=${plan.pending.length}`
  );
  console.log("applied:");
  for (const name of plan.applied) {
    console.log(`  ${name}`);
  }
  if (plan.applied.length === 0) {
    console.log("  (none)");
  }
  console.log("pending:");
  for (const name of plan.pending) {
    console.log(`  ${name}`);
  }
  if (plan.pending.length === 0) {
    console.log("  (none)");
  }
}

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required before production db:migrate`);
  }

  return value;
}

function resolveReceiptPath(path: string): string {
  const candidates = path.startsWith("/")
    ? [path]
    : [
        resolve(process.cwd(), path),
        resolve(process.cwd(), "../..", path)
      ];

  const existing = candidates.find((candidate) => existsSync(candidate));
  return existing ?? candidates[0];
}

function assertPassReceipt(envName: string, label: string, maxAgeHours: number): void {
  const receiptPath = resolveReceiptPath(readRequiredEnv(envName));

  if (!existsSync(receiptPath)) {
    throw new Error(`${envName} does not exist: ${receiptPath}`);
  }

  const contents = readFileSync(receiptPath, "utf8");
  let jsonPass = false;
  try {
    const parsed = JSON.parse(contents) as {
      status?: unknown;
      report?: { verdict?: unknown };
      verdict?: unknown;
    };
    jsonPass =
      String(parsed.status ?? "").toUpperCase() === "PASS" ||
      String(parsed.report?.verdict ?? parsed.verdict ?? "").toLowerCase() === "ok";
  } catch {
    jsonPass = false;
  }

  if (!jsonPass && !/Status:\s*PASS/i.test(contents) && !/restore_drill=pass/i.test(contents)) {
    throw new Error(`${envName} must point to a PASS ${label} receipt`);
  }

  const ageHours = (Date.now() - statSync(receiptPath).mtimeMs) / 3_600_000;
  if (ageHours > maxAgeHours) {
    throw new Error(`${envName} is ${ageHours.toFixed(1)}h old, above ${maxAgeHours}h`);
  }
}

function readMigrationReceiptMaxAgeHours(): number {
  const raw = process.env["MIGRATION_RECOVERY_RECEIPT_MAX_AGE_HOURS"]?.trim();
  if (!raw) {
    return 720;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("MIGRATION_RECOVERY_RECEIPT_MAX_AGE_HOURS must be a positive number");
  }

  return parsed;
}

export function ensureProductionMigrationRecoveryGuard(env: AppEnv, args: MigrateArgs): void {
  if (args.plan || env.nodeEnv !== "production" || env.deployEnv !== "production") {
    return;
  }

  if (args.allowProductionRecoveryGuardBypass) {
    if (!args.reason) {
      throw new Error(
        "--reason=<short-reason> is required with --allow-production-recovery-guard-bypass"
      );
    }

    console.warn(
      `migration recovery guard bypassed: ${args.reason}. Use only for fresh-launch repair or supervised incident recovery.`
    );
    return;
  }

  const maxAgeHours = readMigrationReceiptMaxAgeHours();
  assertPassReceipt("RESTORE_DRILL_RECEIPT_PATH", "logical restore drill", maxAgeHours);
  assertPassReceipt("PITR_DRILL_RECEIPT_PATH", "PITR drill", maxAgeHours);
  console.log(`migration recovery guard ok: restore and PITR receipts <= ${maxAgeHours}h`);
}

function readOptionalMigrationDbConfig(env: AppEnv): DbConfig {
  const migrationPort = process.env["MIGRATION_DB_PORT"]?.trim();
  const parsedMigrationPort = migrationPort ? Number.parseInt(migrationPort, 10) : env.db.port;
  if (!Number.isInteger(parsedMigrationPort) || parsedMigrationPort <= 0) {
    throw new Error("MIGRATION_DB_PORT must be a positive integer when set");
  }

  return {
    ...env.db,
    host: process.env["MIGRATION_DB_HOST"]?.trim() || env.db.host,
    port: parsedMigrationPort,
    name: process.env["MIGRATION_DB_NAME"]?.trim() || env.db.name,
    user: process.env["MIGRATION_DB_USER"]?.trim() || env.db.user,
    password: process.env["MIGRATION_DB_PASSWORD"]?.trim() || env.db.password
  };
}

async function ensureMigrationTable(pool: ReturnType<typeof createDbPool>): Promise<void> {
  await pool.query(`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);
}

async function readAppliedMigrations(pool: ReturnType<typeof createDbPool>): Promise<Set<string>> {
  const tableResult = await pool.query<{ exists: boolean }>(
    "select to_regclass('public.schema_migrations') is not null as exists"
  );

  if (!tableResult.rows[0]?.exists) {
    return new Set();
  }

  const appliedResult = await pool.query<{ name: string }>(
    "select name from schema_migrations order by name"
  );

  return new Set(appliedResult.rows.map((row) => row.name));
}

async function run(): Promise<void> {
  const args = parseMigrateArgs(process.argv.slice(2));
  const env = loadAppEnv();
  const migrationDb = readOptionalMigrationDbConfig(env);
  const pool = createDbPool(migrationDb);

  try {
    ensureProductionMigrationRecoveryGuard(env, args);

    if (!args.plan) {
      await ensureMigrationTable(pool);
    }

    const files = await listMigrationFiles();
    const applied = await readAppliedMigrations(pool);
    const plan = buildMigrationPlan(
      files.map((f) => f.name),
      applied
    );

    // Guard: abort if any numeric prefix is shared by files that haven't all
    // been applied yet. Already-applied duplicates (e.g. the existing 010/011
    // pairs) are grandfathered so existing deployments are unaffected.
    if (plan.collisions.length > 0) {
      reportPrefixCollisions(plan.collisions);
      process.exitCode = 1;
      return;
    }

    if (args.plan) {
      printMigrationPlan(plan);
      return;
    }

    for (const file of files) {
      if (applied.has(file.name)) {
        console.log(`skip ${file.name}`);
        continue;
      }

      await withTransaction(pool, async (client) => {
        await client.query(file.sql);
        await client.query("insert into schema_migrations (name) values ($1)", [file.name]);
      });

      console.log(`apply ${file.name}`);
    }
  } finally {
    await pool.end();
  }
}

const currentScriptPath = process.argv[1] ? resolve(process.argv[1]) : "";

if (currentScriptPath.endsWith("migrate.ts") || currentScriptPath.endsWith("migrate.js")) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
