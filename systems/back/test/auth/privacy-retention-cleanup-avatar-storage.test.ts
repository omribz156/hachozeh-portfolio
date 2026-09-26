import { describe, expect, it, vi } from "vitest";

// Simulate an R2-backed deployment. The unattended retention sweep may inventory object storage,
// but it must not delete avatar objects.
const { listAvatars } = vi.hoisted(() => ({ listAvatars: vi.fn() }));
vi.mock("../../src/auth/avatar-storage", () => ({ listAvatars }));

import { cleanupPrivacyRetention } from "../../src/auth/privacy-retention-cleanup-service";
import type { Queryable } from "../../src/db/client/pool";

function createQueryable() {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("from users")) {
      return { rows: [{ avatar_url: "/api/uploads/avatars/used.webp" }], rowCount: 1 };
    }
    if (sql.trim().startsWith("select count")) return { rows: [{ count: "0" }], rowCount: 1 };
    if (sql.trim().startsWith("delete")) return { rows: [], rowCount: 0 };
    throw new Error(`Unexpected query: ${sql}`);
  });
  return { query } as Queryable;
}

describe("privacy retention avatar sweep over the storage seam", () => {
  it("reports the storage orphan without deleting it", async () => {
    listAvatars.mockResolvedValueOnce([
      { fileName: "orphan.webp", lastModified: new Date("2026-05-01T10:00:00.000Z") },
      { fileName: "used.webp", lastModified: new Date("2026-05-01T10:00:00.000Z") },
      { fileName: "recent.webp", lastModified: new Date("2026-06-17T10:00:00.000Z") }
    ]);

    const result = await cleanupPrivacyRetention(createQueryable(), {
      execute: true,
      now: new Date("2026-06-18T10:00:00.000Z"),
      policy: { avatarOrphanDays: 7 }
    });

    expect(result.counts.avatarOrphanFilesEligible).toBe(1);
    expect(result.counts.avatarOrphanFilesDeleted).toBe(0);
  });

  it("counts but does not delete on a dry run", async () => {
    listAvatars.mockResolvedValueOnce([
      { fileName: "orphan.webp", lastModified: new Date("2026-05-01T10:00:00.000Z") }
    ]);

    const result = await cleanupPrivacyRetention(createQueryable(), {
      execute: false,
      now: new Date("2026-06-18T10:00:00.000Z"),
      policy: { avatarOrphanDays: 7 }
    });

    expect(result.counts.avatarOrphanFilesEligible).toBe(1);
    expect(result.counts.avatarOrphanFilesDeleted).toBe(0);
  });
});
