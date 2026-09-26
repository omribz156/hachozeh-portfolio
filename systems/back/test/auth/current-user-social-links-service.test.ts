import { describe, expect, it, vi } from "vitest";

import type { Queryable } from "../../src/db/client/pool";
import {
  deleteCurrentUserSocialLink,
  readCurrentUserSocialLinks,
  updateCurrentUserSocialLinks
} from "../../src/auth/current-user-social-links-service";

function createQueryable() {
  const rows = [
    {
      platform: "x",
      handle: "omrib",
      url: "https://x.com/omrib",
      verified_at: null,
      updated_at: new Date("2026-06-14T10:00:00.000Z")
    }
  ];

  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.includes("insert into user_social_links")) {
      expect(values).toEqual(["user_1", "x", "omrib", "https://x.com/omrib"]);
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes("delete from user_social_links")) {
      expect(values).toEqual(["user_1", "telegram"]);
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes("from user_social_links")) {
      expect(values).toEqual(["user_1"]);
      return { rows };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  return { query } as Queryable;
}

describe("current user social links service", () => {
  it("reads social links as keyed and ordered items", async () => {
    const payload = await readCurrentUserSocialLinks(createQueryable(), "user_1");

    expect(payload.links.x).toMatchObject({
      platform: "x",
      handle: "omrib",
      url: "https://x.com/omrib"
    });
    expect(payload.links.telegram).toBeNull();
    expect(payload.items).toHaveLength(1);
  });

  it("normalizes handle links", async () => {
    const payload = await updateCurrentUserSocialLinks(createQueryable(), "user_1", {
      x: " @omrib "
    });

    expect(payload.links.x?.url).toBe("https://x.com/omrib");
  });

  it("deletes one platform link", async () => {
    const payload = await deleteCurrentUserSocialLink(createQueryable(), "user_1", "telegram");

    expect(payload.items).toHaveLength(1);
  });

  it("rejects invalid website protocols", async () => {
    await expect(
      updateCurrentUserSocialLinks(createQueryable(), "user_1", {
        website: "javascript:alert(1)"
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "invalid_request"
    });
  });

  it("rejects cleartext website links", async () => {
    await expect(
      updateCurrentUserSocialLinks(createQueryable(), "user_1", {
        website: "http://example.com/"
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "invalid_request"
    });
  });
});
