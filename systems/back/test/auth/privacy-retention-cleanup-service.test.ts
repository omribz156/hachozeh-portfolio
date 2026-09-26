import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it, vi } from "vitest";

import {
  cleanupPrivacyRetention,
  normalizePrivacyRetentionCleanupPolicy
} from "../../src/auth/privacy-retention-cleanup-service";
import type { Queryable } from "../../src/db/client/pool";

function createQueryable() {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    calls.push({ sql, values });

    if (sql.includes("from users")) {
      return {
        rows: [
          { avatar_url: "/api/uploads/avatars/used.webp" }
        ],
        rowCount: 1
      };
    }

    if (sql.trim().startsWith("select count")) {
      return { rows: [{ count: "2" }], rowCount: 1 };
    }

    if (sql.trim().startsWith("delete")) {
      return { rows: [], rowCount: 3 };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  return {
    calls,
    db: { query } as Queryable
  };
}

describe("privacy retention cleanup service", () => {
  it("normalizes TTL policy days", () => {
    expect(normalizePrivacyRetentionCleanupPolicy({
      otpExpiredDays: undefined
    }).otpExpiredDays).toBe(30);
    expect(normalizePrivacyRetentionCleanupPolicy({
      otpExpiredDays: 0,
      auditEventDays: 12.9
    })).toMatchObject({
      otpExpiredDays: 1,
      auditEventDays: 12
    });
  });

  it("dry-runs database and avatar retention cleanup without deleting", async () => {
    const dir = await mkdtemp(join(tmpdir(), "navi-retention-"));
    const oldDate = new Date("2026-05-01T10:00:00.000Z");
    const orphan = join(dir, "orphan.webp");
    const used = join(dir, "used.webp");
    await writeFile(orphan, "orphan");
    await writeFile(used, "used");
    await utimes(orphan, oldDate, oldDate);
    await utimes(used, oldDate, oldDate);

    try {
      const { db, calls } = createQueryable();
      const result = await cleanupPrivacyRetention(db, {
        execute: false,
        now: new Date("2026-06-18T10:00:00.000Z"),
        avatarUploadDir: dir,
        policy: {
          avatarOrphanDays: 7
        }
      });

      expect(result.execute).toBe(false);
      expect(result.counts).toMatchObject({
        otpExpiredDeleted: 2,
        otpFinalizedDeleted: 2,
        sessionsDeleted: 2,
        accountDeletionRequestsDeleted: 2,
        auditEventsDeleted: 2,
        riskSignalsDeleted: 4,
        feedbackDeleted: 2,
        avatarOrphanFilesEligible: 1,
        avatarOrphanFilesDeleted: 0
      });
      expect(await readFile(orphan, "utf8")).toBe("orphan");
      expect(calls.some((call) => call.sql.trim().startsWith("delete"))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("executes database cleanup but only reports avatar orphan candidates", async () => {
    const dir = await mkdtemp(join(tmpdir(), "navi-retention-"));
    const oldDate = new Date("2026-05-01T10:00:00.000Z");
    const orphan = join(dir, "orphan.webp");
    await writeFile(orphan, "orphan");
    await utimes(orphan, oldDate, oldDate);

    try {
      const { db, calls } = createQueryable();
      const result = await cleanupPrivacyRetention(db, {
        execute: true,
        now: new Date("2026-06-18T10:00:00.000Z"),
        avatarUploadDir: dir
      });

      expect(result.execute).toBe(true);
      expect(result.counts.otpExpiredDeleted).toBe(3);
      expect(result.counts.avatarOrphanFilesEligible).toBe(1);
      expect(result.counts.avatarOrphanFilesDeleted).toBe(0);
      expect(calls.some((call) => call.sql.includes("delete from sessions"))).toBe(true);
      expect(await readFile(orphan, "utf8")).toBe("orphan");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
