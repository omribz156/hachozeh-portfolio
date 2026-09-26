import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

import {
  clearCurrentUserAvatar,
  readLocalAvatarFile,
  updateCurrentUserAvatar
} from "../../src/auth/current-user-avatar-service";
import type { Queryable } from "../../src/db/client/pool";

const AVATAR_DIR = resolve(process.cwd(), "workspace", "runtime", "uploads", "avatars");
const MALFORMED_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
let PNG_DATA_URL: string;

beforeAll(async () => {
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: "#339977" } })
    .png().toBuffer();
  PNG_DATA_URL = `data:image/png;base64,${png.toString("base64")}`;
});

async function cleanupTestAvatars() {
  const files = await readdir(AVATAR_DIR).catch(() => []);
  await Promise.all(
    files
      .filter((file) => file.startsWith("user_avatar_test") || file.startsWith("avatar-"))
      .map((file) => rm(join(AVATAR_DIR, file), { force: true }))
  );
}

beforeEach(() => {
  delete process.env.AVATAR_MALWARE_SCANNER;
  delete process.env.AVATAR_MALWARE_SCANNER_ARGS;
  delete process.env.AVATAR_REQUIRE_MALWARE_SCAN;
});

afterEach(async () => {
  await cleanupTestAvatars();
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  delete process.env.AVATAR_MALWARE_SCANNER;
  delete process.env.AVATAR_MALWARE_SCANNER_ARGS;
  delete process.env.AVATAR_REQUIRE_MALWARE_SCAN;
});

describe("current user avatar service", () => {
  it("stores a validated avatar image and updates the profile URL", async () => {
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("select avatar_url")) {
        expect(values).toEqual(["user_avatar_test"]);
        return {
          rows: [{ avatar_url: null }]
        };
      }

      if (sql.includes("update users")) {
        expect(values?.[0]).toBe("user_avatar_test");
        expect(values?.[1]).toEqual(expect.stringMatching(/^\/api\/uploads\/avatars\/avatar-.+\.webp$/));

        return {
          rows: [
            {
              id: "user_avatar_test",
              handle: "avatar_test",
              display_name: "Omri",
              bio: "builder",
              avatar_url: values?.[1],
              updated_at: new Date("2026-06-14T10:00:00.000Z")
            }
          ]
        };
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    const payload = await updateCurrentUserAvatar({ query } as unknown as Queryable, "user_avatar_test", {
      imageData: PNG_DATA_URL
    });

    expect(payload).toEqual({
      user: {
        userId: "user_avatar_test",
        handle: "avatar_test",
        displayName: "Omri",
        bio: "builder",
        avatarUrl: expect.stringMatching(/^\/api\/uploads\/avatars\/avatar-.+\.webp$/),
        updatedAt: "2026-06-14T10:00:00.000Z"
      }
    });

    const fileName = payload.user.avatarUrl?.replace("/api/uploads/avatars/", "") ?? "";
    const file = await readLocalAvatarFile(fileName);
    expect(file?.contentType).toBe("image/webp");
    expect(file?.buffer.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(file?.buffer.subarray(8, 12).toString("ascii")).toBe("WEBP");
  });

  it("removes the previous local avatar when a replacement is uploaded", async () => {
    await mkdir(AVATAR_DIR, { recursive: true });
    await writeFile(join(AVATAR_DIR, "user_avatar_test-old.webp"), Buffer.from("old"));

    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("select avatar_url")) {
        expect(values).toEqual(["user_avatar_test"]);
        return {
          rows: [{ avatar_url: "/api/uploads/avatars/user_avatar_test-old.webp" }]
        };
      }

      if (sql.includes("update users")) {
        return {
          rows: [
            {
              id: "user_avatar_test",
              handle: "avatar_test",
              display_name: "Omri",
              bio: null,
              avatar_url: values?.[1],
              updated_at: new Date("2026-06-14T10:30:00.000Z")
            }
          ]
        };
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    await updateCurrentUserAvatar({ query } as unknown as Queryable, "user_avatar_test", {
      imageData: PNG_DATA_URL
    });

    const files = await readdir(AVATAR_DIR).catch(() => []);
    expect(files).not.toContain("user_avatar_test-old.webp");
  });

  it("rejects mismatched image bytes before database work", async () => {
    const query = vi.fn();

    await expect(
      updateCurrentUserAvatar({ query } as unknown as Queryable, "user_avatar_test", {
        imageData: "data:image/png;base64,ZmFrZQ=="
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "invalid_request"
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects a malformed PNG rather than weakening decoder validation", async () => {
    const query = vi.fn(async () => ({ rows: [{ avatar_url: null }] }));
    await expect(updateCurrentUserAvatar({ query } as unknown as Queryable, "user_avatar_test", {
      imageData: MALFORMED_PNG_DATA_URL
    })).rejects.toMatchObject({ statusCode: 400, code: "invalid_request" });
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining("update users"), expect.anything());
  });

  it("rejects decoded avatar images over 4MB before database work", async () => {
    const query = vi.fn();
    const oversized = Buffer.alloc((4 * 1024 * 1024) + 1).toString("base64");

    await expect(
      updateCurrentUserAvatar({ query } as unknown as Queryable, "user_avatar_test", {
        imageData: `data:image/png;base64,${oversized}`
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "invalid_request"
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("fails closed when malware scanning is required but no scanner is configured", async () => {
    process.env.AVATAR_REQUIRE_MALWARE_SCAN = "true";
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("select avatar_url")) {
        expect(values).toEqual(["user_avatar_test"]);
        return {
          rows: [{ avatar_url: null }]
        };
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    await expect(
      updateCurrentUserAvatar({ query } as unknown as Queryable, "user_avatar_test", {
        imageData: PNG_DATA_URL
      })
    ).rejects.toMatchObject({
      statusCode: 503,
      code: "avatar_scan_unavailable"
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("allows production avatar uploads when malware scanning is not explicitly required", async () => {
    process.env.NODE_ENV = "production";
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("select avatar_url")) {
        expect(values).toEqual(["user_avatar_test"]);
        return {
          rows: [{ avatar_url: null }]
        };
      }

      if (sql.includes("update users")) {
        return {
          rows: [
            {
              id: "user_avatar_test",
              handle: "avatar_test",
              display_name: "Omri",
              bio: null,
              avatar_url: values?.[1],
              updated_at: new Date("2026-06-14T10:30:00.000Z")
            }
          ]
        };
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    await expect(
      updateCurrentUserAvatar({ query } as unknown as Queryable, "user_avatar_test", {
        imageData: PNG_DATA_URL
      })
    ).resolves.toMatchObject({
      user: {
        avatarUrl: expect.stringMatching(/^\/api\/uploads\/avatars\/avatar-.+\.webp$/)
      }
    });
  });

  it("fails closed when a configured malware scanner cannot execute", async () => {
    process.env.AVATAR_MALWARE_SCANNER = "/definitely/not/a/scanner";
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("select avatar_url")) {
        expect(values).toEqual(["user_avatar_test"]);
        return {
          rows: [{ avatar_url: null }]
        };
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    await expect(
      updateCurrentUserAvatar({ query } as unknown as Queryable, "user_avatar_test", {
        imageData: PNG_DATA_URL
      })
    ).rejects.toMatchObject({
      statusCode: 503,
      code: "avatar_scan_unavailable"
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("clears avatar_url and removes an old local avatar", async () => {
    await mkdir(AVATAR_DIR, { recursive: true });
    await writeFile(join(AVATAR_DIR, "user_avatar_test-old.webp"), Buffer.from("old"));

    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      expect(values).toEqual(["user_avatar_test"]);

      if (sql.includes("select avatar_url")) {
        return {
          rows: [{ avatar_url: "/api/uploads/avatars/user_avatar_test-old.webp" }]
        };
      }

      if (sql.includes("update users")) {
        return {
          rows: [
            {
              id: "user_avatar_test",
              handle: "avatar_test",
              display_name: "Omri",
              bio: null,
              avatar_url: null,
              updated_at: new Date("2026-06-14T11:00:00.000Z")
            }
          ]
        };
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    const payload = await clearCurrentUserAvatar({ query } as unknown as Queryable, "user_avatar_test");

    expect(payload.user.avatarUrl).toBeNull();
    const files = await readdir(AVATAR_DIR).catch(() => []);
    expect(files).not.toContain("user_avatar_test-old.webp");
  });
});
