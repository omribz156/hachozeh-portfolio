import { createDbPool } from "../db/client/pool";
import { loadAppEnv } from "../config/env";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";

type SchemaPrivilegeRow = {
  schema: string;
  can_create_schema_objects: boolean;
};

type OwnedTableRow = {
  schemaname: string;
  owned_tables: string;
  total_tables: string;
};

type TablePrivilegeRow = {
  table_schema: string;
  privilege_type: string;
  count: string;
};

type DbRoleMode = "split" | "provider-managed";

export type DbPrivilegeAuditReport = {
  user: string;
  database: string;
  dbRoleMode: DbRoleMode;
  strict: boolean;
  userIsSuperuser: boolean;
  canCreateDatabaseObjects: boolean;
  schemasWithCreate: string[];
  ownedTableCount: number;
  riskyPrivileges: Array<{
    schema: string;
    privilege: string;
    count: number;
  }>;
  verdict: "ok" | "warn" | "bad";
  findings: string[];
  informationalFindings: string[];
};

const RISKY_RUNTIME_PRIVILEGES = new Set(["TRUNCATE", "TRIGGER"]);

function parseCount(value: string | number | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? "0"), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function assessDbPrivilegeAudit(input: {
  user: string;
  database: string;
  dbRoleMode?: DbRoleMode;
  strict: boolean;
  userIsSuperuser?: boolean;
  canCreateDatabaseObjects: boolean;
  schemaPrivileges: SchemaPrivilegeRow[];
  ownedTables: OwnedTableRow[];
  tablePrivileges: TablePrivilegeRow[];
}): DbPrivilegeAuditReport {
  const dbRoleMode = input.dbRoleMode ?? "split";
  const providerManaged = dbRoleMode === "provider-managed";
  const schemasWithCreate = input.schemaPrivileges
    .filter((row) => row.can_create_schema_objects)
    .map((row) => row.schema);
  const ownedTableCount = input.ownedTables.reduce(
    (total, row) => total + parseCount(row.owned_tables),
    0
  );
  const riskyPrivileges = input.tablePrivileges
    .filter((row) => RISKY_RUNTIME_PRIVILEGES.has(row.privilege_type))
    .map((row) => ({
      schema: row.table_schema,
      privilege: row.privilege_type,
      count: parseCount(row.count)
    }))
    .filter((row) => row.count > 0);
  const findings: string[] = [];
  const informationalFindings: string[] = [];

  if (input.userIsSuperuser) {
    findings.push("runtime DB user is a database superuser");
  }

  if (input.canCreateDatabaseObjects) {
    const message = "runtime DB user can create database objects";
    (providerManaged ? informationalFindings : findings).push(message);
  }

  for (const schema of schemasWithCreate) {
    const message = `runtime DB user can create objects in schema ${schema}`;
    (providerManaged ? informationalFindings : findings).push(message);
  }

  if (ownedTableCount > 0) {
    const message = `runtime DB user owns ${ownedTableCount} table(s)`;
    (providerManaged ? informationalFindings : findings).push(message);
  }

  for (const row of riskyPrivileges) {
    const message = `runtime DB user has ${row.privilege} on ${row.count} table(s) in ${row.schema}`;
    (providerManaged ? informationalFindings : findings).push(message);
  }

  return {
    user: input.user,
    database: input.database,
    dbRoleMode,
    strict: input.strict,
    userIsSuperuser: input.userIsSuperuser === true,
    canCreateDatabaseObjects: input.canCreateDatabaseObjects,
    schemasWithCreate,
    ownedTableCount,
    riskyPrivileges,
    verdict: findings.length === 0 ? "ok" : input.strict ? "bad" : "warn",
    findings,
    informationalFindings
  };
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(name);
}

function readArg(name: string): string {
  const prefix = `${name}=`;
  return process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? "";
}

async function main(): Promise<void> {
  const env = loadAppEnv();
  const strict = hasFlag("--strict") || env.nodeEnv === "production";
  const dbRoleMode = process.env["DB_ROLE_MODE"] === "provider-managed" ? "provider-managed" : "split";
  const reportPath = readArg("--report-path");
  const pool = createDbPool(env.db);

  try {
    const identity = await pool.query<{ current_user: string; current_database: string }>(
      "select current_user, current_database()"
    );
    const role = await pool.query<{ user_is_superuser: boolean }>(
      "select rolsuper as user_is_superuser from pg_roles where rolname = current_user"
    );
    const createDb = await pool.query<{ can_create_database_objects: boolean }>(
      "select has_database_privilege(current_user, current_database(), 'CREATE') as can_create_database_objects"
    );
    const schemaPrivileges = await pool.query<SchemaPrivilegeRow>(
      `
        select nspname as schema, has_schema_privilege(current_user, nspname, 'CREATE') as can_create_schema_objects
        from pg_namespace
        where nspname not like 'pg_%'
          and nspname <> 'information_schema'
        order by schema
      `
    );
    const ownedTables = await pool.query<OwnedTableRow>(
      `
        select schemaname, count(*) filter (where tableowner = current_user)::text as owned_tables, count(*)::text as total_tables
        from pg_tables
        where schemaname not like 'pg_%'
          and schemaname <> 'information_schema'
        group by schemaname
        order by schemaname
      `
    );
    const tablePrivileges = await pool.query<TablePrivilegeRow>(
      `
        select table_schema, privilege_type, count(*)::text
        from information_schema.role_table_grants
        where grantee = current_user
          and table_schema not in ('pg_catalog', 'information_schema')
        group by table_schema, privilege_type
        order by table_schema, privilege_type
      `
    );
    const report = assessDbPrivilegeAudit({
      user: identity.rows[0]?.current_user ?? env.db.user,
      database: identity.rows[0]?.current_database ?? env.db.name,
      dbRoleMode,
      strict,
      userIsSuperuser: role.rows[0]?.user_is_superuser === true,
      canCreateDatabaseObjects: createDb.rows[0]?.can_create_database_objects === true,
      schemaPrivileges: schemaPrivileges.rows,
      ownedTables: ownedTables.rows,
      tablePrivileges: tablePrivileges.rows
    });

    const output = {
      generatedAt: new Date().toISOString(),
      status: report.verdict === "ok" ? "PASS" : "FAIL",
      report
    };

    console.log(JSON.stringify(output, null, 2));

    if (reportPath) {
      const resolved = resolvePath(process.cwd(), reportPath);
      mkdirSync(dirname(resolved), { recursive: true });
      writeFileSync(resolved, `${JSON.stringify(output, null, 2)}\n`);
      console.error(`db-privilege-audit: wrote report ${resolved}`);
    }

    if (report.verdict === "bad") {
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

export function isDirectDbPrivilegeAuditInvocation(scriptPath: string): boolean {
  const resolved = resolvePath(scriptPath);
  return resolved.endsWith("db-privilege-audit.ts") || resolved.endsWith("db-privilege-audit.js");
}

if (process.argv[1] && isDirectDbPrivilegeAuditInvocation(process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
