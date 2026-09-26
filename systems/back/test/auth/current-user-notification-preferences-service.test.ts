import { describe, expect, it, vi } from "vitest";

import type { Queryable } from "../../src/db/client/pool";
import {
  readCurrentUserNotificationPreferences,
  updateCurrentUserNotificationPreferences
} from "../../src/auth/current-user-notification-preferences-service";

function createQueryable() {
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.includes("insert into notification_preferences")) {
      expect(values).toEqual(["user_1", "moves", false, false, false, null]);
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes("from notification_preferences")) {
      expect(values).toEqual(["user_1"]);
      return {
        rows: [
          {
            notification_type: "moves",
            channel_app: false,
            channel_external: false,
            updated_at: new Date("2026-06-13T10:00:00.000Z")
          }
        ]
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  return { query } as Queryable;
}

describe("current user notification preferences service", () => {
  it("reads stored preferences with defaults for missing rows", async () => {
    const payload = await readCurrentUserNotificationPreferences(createQueryable(), "user_1");

    expect(payload.preferences).toEqual({
      moves_app: false,
      moves_ext: false,
      resolve_app: true,
      resolve_ext: false,
      comments_app: true,
      comments_ext: false
    });
  });

  it("updates a single preference key without requiring the whole matrix", async () => {
    const payload = await updateCurrentUserNotificationPreferences(createQueryable(), "user_1", {
      moves_app: false
    });

    expect(payload.preferences.moves_app).toBe(false);
    expect(payload.preferences.resolve_ext).toBe(false);
  });

  it("rejects non-boolean preference values", async () => {
    await expect(
      updateCurrentUserNotificationPreferences(createQueryable(), "user_1", {
        moves_app: "yes"
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "invalid_request"
    });
  });
});
