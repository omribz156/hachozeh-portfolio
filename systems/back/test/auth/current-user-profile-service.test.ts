import { describe, expect, it, vi } from "vitest";

import type { Queryable } from "../../src/db/client/pool";
import {
  readCurrentUserHandleAvailability,
  updateCurrentUserProfile
} from "../../src/auth/current-user-profile-service";

function createQueryable() {
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.includes("update users")) {
      expect(values).toEqual(["user_1", "Omri", "builder", null, [], true, true, false, false]);

      return {
        rows: [
          {
            id: "user_1",
            handle: "omri",
            display_name: "Omri",
            bio: "builder",
            avatar_url: null,
            showcase_categories: [],
            updated_at: new Date("2026-06-13T10:00:00.000Z")
          }
        ]
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  return { query } as Queryable;
}

describe("current user profile service", () => {
  it("updates profile fields with normalized text", async () => {
    const payload = await updateCurrentUserProfile(createQueryable(), "user_1", {
      displayName: "  Omri  ",
      bio: " builder "
    });

    expect(payload).toEqual({
      user: {
        userId: "user_1",
        handle: "omri",
        displayName: "Omri",
        bio: "builder",
        avatarUrl: null,
        showcaseCategories: [],
        updatedAt: "2026-06-13T10:00:00.000Z"
      }
    });
  });

  it("stores only resolved-record showcase categories in requested order", async () => {
    const db = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes("select distinct coalesce")) {
          expect(values).toEqual(["user_1"]);
          return {
            rows: [{ category_key: "sports" }, { category_key: "politics" }]
          };
        }

        if (sql.includes("update users")) {
          expect(values).toEqual([
            "user_1",
            null,
            null,
            null,
            ["sports", "politics"],
            false,
            false,
            false,
            true
          ]);

          return {
            rows: [
              {
                id: "user_1",
                handle: "omri",
                display_name: "Omri",
                bio: "builder",
                avatar_url: null,
                showcase_categories: ["sports", "politics"],
                updated_at: new Date("2026-06-13T10:00:00.000Z")
              }
            ]
          };
        }

        throw new Error(`Unexpected query: ${sql}`);
      })
    } as Queryable;

    const payload = await updateCurrentUserProfile(db, "user_1", {
      showcaseCategories: ["sports", "invalid", "sports", "politics"]
    });

    expect(payload.user.showcaseCategories).toEqual(["sports", "politics"]);
  });

  it("updates a normalized public handle", async () => {
    const db = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes("select id, handle, display_name")) {
          expect(values).toEqual(["user_1"]);
          return {
            rows: [
              {
                id: "user_1",
                handle: "user_a1b2c3d4",
                display_name: null,
                handle_updated_at: null
              }
            ]
          };
        }

        if (sql.includes("update users")) {
          expect(values).toEqual(["user_1", "mrbz", null, "mrbz", [], true, false, true, false]);
          return {
            rows: [
              {
                id: "user_1",
                handle: "mrbz",
                display_name: "mrbz",
                bio: null,
                avatar_url: null,
                showcase_categories: [],
                updated_at: new Date("2026-06-13T10:00:00.000Z")
              }
            ]
          };
        }

        throw new Error(`Unexpected query: ${sql}`);
      })
    } as Queryable;

    const payload = await updateCurrentUserProfile(db, "user_1", {
      handle: "@MrBz"
    });

    expect(payload.user.handle).toBe("mrbz");
    expect(payload.user.displayName).toBe("mrbz");
  });

  it("keeps a manually set display name when the handle changes", async () => {
    const db = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes("select id, handle, display_name")) {
          expect(values).toEqual(["user_1"]);
          return {
            rows: [
              {
                id: "user_1",
                handle: "omri",
                display_name: "עומרי",
                handle_updated_at: null
              }
            ]
          };
        }

        if (sql.includes("update users")) {
          expect(values).toEqual(["user_1", null, null, "mrbz", [], false, false, true, false]);
          return {
            rows: [
              {
                id: "user_1",
                handle: "mrbz",
                display_name: "עומרי",
                bio: null,
                avatar_url: null,
                showcase_categories: [],
                updated_at: new Date("2026-06-13T10:00:00.000Z")
              }
            ]
          };
        }

        throw new Error(`Unexpected query: ${sql}`);
      })
    } as Queryable;

    const payload = await updateCurrentUserProfile(db, "user_1", {
      handle: "@MrBz"
    });

    expect(payload.user.handle).toBe("mrbz");
    expect(payload.user.displayName).toBe("עומרי");
  });

  it("rejects handle changes inside the 30 day cooldown", async () => {
    const db = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes("select id, handle, display_name")) {
          expect(values).toEqual(["user_1"]);
          return {
            rows: [
              {
                id: "user_1",
                handle: "omri",
                display_name: "עומרי",
                handle_updated_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
              }
            ]
          };
        }

        throw new Error(`Unexpected query: ${sql}`);
      })
    } as Queryable;

    await expect(
      updateCurrentUserProfile(db, "user_1", {
        handle: "mrbz"
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "handle_change_cooldown"
    });
  });

  it("allows saving the same handle during cooldown without resetting display name", async () => {
    const db = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes("select id, handle, display_name")) {
          expect(values).toEqual(["user_1"]);
          return {
            rows: [
              {
                id: "user_1",
                handle: "omri",
                display_name: "עומרי",
                handle_updated_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
              }
            ]
          };
        }

        if (sql.includes("update users")) {
          expect(values).toEqual(["user_1", null, null, "omri", [], false, false, true, false]);
          return {
            rows: [
              {
                id: "user_1",
                handle: "omri",
                display_name: "עומרי",
                bio: null,
                avatar_url: null,
                showcase_categories: [],
                updated_at: new Date("2026-06-13T10:00:00.000Z")
              }
            ]
          };
        }

        throw new Error(`Unexpected query: ${sql}`);
      })
    } as Queryable;

    const payload = await updateCurrentUserProfile(db, "user_1", {
      handle: "@omri"
    });

    expect(payload.user.handle).toBe("omri");
    expect(payload.user.displayName).toBe("עומרי");
  });

  it("returns the canonical default display name when the stored display is empty", async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("update users")) {
          return {
            rows: [
              {
                id: "user_profile_fallback",
                handle: "user_abcd1234",
                display_name: null,
                bio: null,
                avatar_url: null,
                showcase_categories: [],
                updated_at: new Date("2026-06-13T10:00:00.000Z")
              }
            ]
          };
        }

        throw new Error(`Unexpected query: ${sql}`);
      })
    } as Queryable;

    const payload = await updateCurrentUserProfile(db, "user_profile_fallback", {
      bio: "builder"
    });

    expect(payload.user.displayName).toBe("חזאי ABCD1234");
  });

  it("rejects platform/operator display names", async () => {
    await expect(
      updateCurrentUserProfile(createQueryable(), "user_1", {
        displayName: "החוזה"
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "invalid_request"
    });
  });

  it("rejects a blocklisted display name with name_not_allowed", async () => {
    await expect(
      updateCurrentUserProfile(createQueryable(), "user_1", {
        displayName: "לאונן"
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "name_not_allowed"
    });
  });

  it("rejects a spacing-trick blocklisted display name", async () => {
    await expect(
      updateCurrentUserProfile(createQueryable(), "user_1", {
        displayName: "ל א ו נ ן"
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "name_not_allowed"
    });
  });

  it("allows innocent words that contain the חזה root", async () => {
    const db = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes("update users")) {
          expect(values).toEqual(["user_1", "מחזה", null, null, [], true, false, false, false]);
          return {
            rows: [
              {
                id: "user_1",
                handle: "omri",
                display_name: "מחזה",
                bio: null,
                avatar_url: null,
                showcase_categories: [],
                updated_at: new Date("2026-06-13T10:00:00.000Z")
              }
            ]
          };
        }

        throw new Error(`Unexpected query: ${sql}`);
      })
    } as Queryable;

    const payload = await updateCurrentUserProfile(db, "user_1", {
      displayName: "מחזה"
    });

    expect(payload.user.displayName).toBe("מחזה");
  });

  it("rejects invalid public handles", async () => {
    await expect(
      updateCurrentUserProfile(createQueryable(), "user_1", {
        handle: "om"
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "invalid_request"
    });
  });

  it("rejects platform/operator handles", async () => {
    await expect(
      updateCurrentUserProfile(createQueryable(), "user_1", {
        handle: "hachozeh"
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "invalid_request"
    });
  });

  it("checks public handle availability without exposing the owner", async () => {
    const db = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        expect(sql).toContain("from users");
        expect(values).toEqual(["mrbz"]);
        return { rows: [] };
      })
    } as unknown as Queryable;

    await expect(
      readCurrentUserHandleAvailability(db, "user_1", "@MrBz")
    ).resolves.toEqual({
      handle: "mrbz",
      available: true,
      reason: "available"
    });
  });

  it("treats the current user's handle as available", async () => {
    const db = {
      query: vi.fn(async () => ({
        rows: [{ id: "user_1" }]
      }))
    } as unknown as Queryable;

    await expect(
      readCurrentUserHandleAvailability(db, "user_1", "mrbz")
    ).resolves.toMatchObject({
      handle: "mrbz",
      available: true,
      reason: "current"
    });
  });

  it("reports taken handles without returning private account data", async () => {
    const db = {
      query: vi.fn(async () => ({
        rows: [{ id: "user_other" }]
      }))
    } as unknown as Queryable;

    await expect(
      readCurrentUserHandleAvailability(db, "user_1", "mrbz")
    ).resolves.toEqual({
      handle: "mrbz",
      available: false,
      reason: "taken"
    });
  });

  it("rejects too-long bio before database work", async () => {
    await expect(
      updateCurrentUserProfile(createQueryable(), "user_1", {
        bio: "x".repeat(101)
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "invalid_request"
    });
  });
});
