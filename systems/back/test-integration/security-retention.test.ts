import { afterEach, beforeEach, expect, it } from "vitest";
import type { Pool } from "pg";
import { cleanupPrivacyRetention } from "../src/auth/privacy-retention-cleanup-service";
import { createSecurityIncidentRecorder } from "../src/observability/security-incident-recorder";
import { createTestPool, truncateAllTables } from "./helpers";

let pool: Pool;
beforeEach(async () => { pool = createTestPool(); await truncateAllTables(pool); });
afterEach(async () => { await pool.end(); });

it("persists bounded security signals and expires only the intended history", async () => {
  const now = new Date("2026-10-11T12:00:00Z");
  const record = createSecurityIncidentRecorder(pool, async () => true, () => now.getTime());
  const signal = { source: "web", kind: "burst", category: "requests", requests: 101, rejected: 100, windowSeconds: 60 } as const;
  await record(signal);
  await record(signal);
  expect((await pool.query("select count(*)::int as n from audit_events")).rows[0].n).toBe(1);
  await pool.query("update audit_events set created_at = $1", [new Date(now.getTime() - 29 * 86400000)]);
  for (const [id, action, days] of [["old-signal", "security.traffic.signal", 31], ["recent-audit", "auth.login", 31], ["old-audit", "auth.login", 731]] as const) {
    await pool.query("insert into audit_events(id,actor_id,action,entity_type,entity_id,payload,created_at) values($1,'system:test',$2,'test','test','{}',$3)", [id, action, new Date(now.getTime() - days * 86400000)]);
  }
  const input = { now, avatarUploadDir: "/nonexistent/synthetic-avatar-dir" };
  expect((await cleanupPrivacyRetention(pool, input)).counts.auditEventsDeleted).toBe(2);
  expect((await cleanupPrivacyRetention(pool, { ...input, execute: true })).counts.auditEventsDeleted).toBe(2);
  const rows = (await pool.query("select id from audit_events")).rows;
  expect(rows).toHaveLength(2);
  expect(rows.some(row => row.id === "recent-audit")).toBe(true);
});
