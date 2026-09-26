import { describe, expect, it } from "vitest";

import {
  assessDbPrivilegeAudit,
  isDirectDbPrivilegeAuditInvocation
} from "../../src/scripts/db-privilege-audit";

describe("db privilege audit", () => {
  it("runs when invoked from the compiled JavaScript entrypoint", () => {
    expect(isDirectDbPrivilegeAuditInvocation("/app/dist/back/src/scripts/db-privilege-audit.js")).toBe(
      true
    );
    expect(isDirectDbPrivilegeAuditInvocation("/app/src/scripts/db-privilege-audit.ts")).toBe(true);
    expect(isDirectDbPrivilegeAuditInvocation("/app/dist/back/src/scripts/migrate.js")).toBe(false);
  });

  it("warns but does not fail local-style broad runtime privileges outside strict mode", () => {
    const report = assessDbPrivilegeAudit({
      user: "navi",
      database: "navi",
      strict: false,
      userIsSuperuser: false,
      canCreateDatabaseObjects: true,
      schemaPrivileges: [{ schema: "public", can_create_schema_objects: true }],
      ownedTables: [{ schemaname: "public", owned_tables: "41", total_tables: "41" }],
      tablePrivileges: [
        { table_schema: "public", privilege_type: "SELECT", count: "41" },
        { table_schema: "public", privilege_type: "TRUNCATE", count: "41" }
      ]
    });

    expect(report.verdict).toBe("warn");
    expect(report.findings).toEqual(
      expect.arrayContaining([
        "runtime DB user can create database objects",
        "runtime DB user can create objects in schema public",
        "runtime DB user owns 41 table(s)",
        "runtime DB user has TRUNCATE on 41 table(s) in public"
      ])
    );
  });

  it("fails strict mode for broad runtime privileges", () => {
    const report = assessDbPrivilegeAudit({
      user: "navi_app",
      database: "navi",
      strict: true,
      userIsSuperuser: false,
      canCreateDatabaseObjects: false,
      schemaPrivileges: [],
      ownedTables: [{ schemaname: "public", owned_tables: "0", total_tables: "41" }],
      tablePrivileges: [{ table_schema: "public", privilege_type: "TRIGGER", count: "1" }]
    });

    expect(report.verdict).toBe("bad");
    expect(report.findings).toEqual(["runtime DB user has TRIGGER on 1 table(s) in public"]);
  });

  it("passes least-privilege runtime posture", () => {
    const report = assessDbPrivilegeAudit({
      user: "navi_app",
      database: "navi",
      strict: true,
      userIsSuperuser: false,
      canCreateDatabaseObjects: false,
      schemaPrivileges: [{ schema: "public", can_create_schema_objects: false }],
      ownedTables: [{ schemaname: "public", owned_tables: "0", total_tables: "41" }],
      tablePrivileges: [
        { table_schema: "public", privilege_type: "SELECT", count: "41" },
        { table_schema: "public", privilege_type: "INSERT", count: "41" },
        { table_schema: "public", privilege_type: "UPDATE", count: "41" },
        { table_schema: "public", privilege_type: "DELETE", count: "41" }
      ]
    });

    expect(report.verdict).toBe("ok");
    expect(report.findings).toEqual([]);
  });

  it("passes provider-managed mode when the managed runtime user owns its own schema", () => {
    const report = assessDbPrivilegeAudit({
      user: "hachozeh",
      database: "hachozeh",
      dbRoleMode: "provider-managed",
      strict: true,
      userIsSuperuser: false,
      canCreateDatabaseObjects: true,
      schemaPrivileges: [{ schema: "public", can_create_schema_objects: true }],
      ownedTables: [{ schemaname: "public", owned_tables: "41", total_tables: "41" }],
      tablePrivileges: [
        { table_schema: "public", privilege_type: "SELECT", count: "41" },
        { table_schema: "public", privilege_type: "TRUNCATE", count: "41" },
        { table_schema: "public", privilege_type: "TRIGGER", count: "41" }
      ]
    });

    expect(report.verdict).toBe("ok");
    expect(report.findings).toEqual([]);
    expect(report.informationalFindings).toEqual(
      expect.arrayContaining([
        "runtime DB user can create database objects",
        "runtime DB user owns 41 table(s)",
        "runtime DB user has TRUNCATE on 41 table(s) in public"
      ])
    );
  });

  it("fails provider-managed mode when the DB user is a superuser", () => {
    const report = assessDbPrivilegeAudit({
      user: "hachozeh",
      database: "hachozeh",
      dbRoleMode: "provider-managed",
      strict: true,
      userIsSuperuser: true,
      canCreateDatabaseObjects: true,
      schemaPrivileges: [{ schema: "public", can_create_schema_objects: true }],
      ownedTables: [{ schemaname: "public", owned_tables: "41", total_tables: "41" }],
      tablePrivileges: []
    });

    expect(report.verdict).toBe("bad");
    expect(report.findings).toEqual(["runtime DB user is a database superuser"]);
  });
});
