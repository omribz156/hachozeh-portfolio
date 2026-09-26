import { describe, expect, it, vi } from "vitest";

import type { Queryable } from "../../src/db/client/pool";
import { auditAvatarStorageIntegrity } from "../../src/auth/avatar-storage-integrity";

function createDb(avatarUrls: Array<string | null>): Queryable {
  return {
    query: vi.fn(async () => ({
      rows: avatarUrls.map((avatar_url) => ({ avatar_url }))
    }))
  };
}

describe("avatar storage integrity", () => {
  it("reports matching database references and stored objects as healthy", async () => {
    const report = await auditAvatarStorageIntegrity(
      createDb(["/api/uploads/avatars/avatar-a.webp"]),
      {
        listStoredAvatars: async () => [
          { fileName: "avatar-a.webp", lastModified: new Date("2026-07-14T10:00:00.000Z") }
        ]
      }
    );

    expect(report).toMatchObject({
      verdict: "ok",
      referencedObjectCount: 1,
      storedObjectCount: 1,
      danglingReferenceCount: 0,
      invalidReferenceCount: 0,
      unreferencedObjectCount: 0
    });
  });

  it("fails when a database avatar reference has no stored object", async () => {
    const report = await auditAvatarStorageIntegrity(
      createDb(["/api/uploads/avatars/avatar-missing.webp"]),
      { listStoredAvatars: async () => [] }
    );

    expect(report).toMatchObject({
      verdict: "bad",
      referencedObjectCount: 1,
      storedObjectCount: 0,
      danglingReferenceCount: 1,
      invalidReferenceCount: 0
    });
  });

  it("fails closed on malformed references without exposing their values", async () => {
    const report = await auditAvatarStorageIntegrity(
      createDb(["https://example.com/avatar.webp", "/api/uploads/avatars/../avatar.webp"]),
      { listStoredAvatars: async () => [] }
    );

    expect(report).toMatchObject({
      verdict: "bad",
      referencedObjectCount: 0,
      danglingReferenceCount: 0,
      invalidReferenceCount: 2
    });
    expect(JSON.stringify(report)).not.toContain("example.com");
  });

  it("counts unreferenced objects without treating the upload race window as data loss", async () => {
    const report = await auditAvatarStorageIntegrity(createDb([]), {
      listStoredAvatars: async () => [
        { fileName: "avatar-uploading.webp", lastModified: new Date("2026-07-14T10:00:00.000Z") }
      ]
    });

    expect(report).toMatchObject({
      verdict: "ok",
      unreferencedObjectCount: 1
    });
  });
});
