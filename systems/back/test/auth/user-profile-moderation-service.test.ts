import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import type { RequestActor } from "../../src/auth/actor-resolver";

vi.mock("../../src/auth/current-user-avatar-service", () => ({
  deleteLocalAvatarFileForUrl: vi.fn(async () => true)
}));

import { deleteLocalAvatarFileForUrl } from "../../src/auth/current-user-avatar-service";
import {
  moderateUserProfile,
  UserProfileModerationServiceError
} from "../../src/auth/user-profile-moderation-service";

const ADMIN_ACTOR: RequestActor = {
  actorId: "user_admin_1",
  mode: "session",
  sessionId: "session_admin_1",
  role: "admin"
};

function createDbPool(options?: { missingUser?: boolean }) {
  const state = {
    user: {
      id: "user_target_1",
      handle: "user_abcd1234",
      display_name: "bad stored name",
      bio: "bad stored bio",
      avatar_url: "/api/uploads/avatars/avatar-old.webp",
      status: "active" as const,
      updated_at: new Date("2026-07-05T10:00:00.000Z")
    },
    auditPayload: null as string | null
  };

  const pool = {
    connect: vi.fn(async () => ({
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql === "begin" || sql === "commit" || sql === "rollback") {
          return { rows: [], rowCount: 0 };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes("from users") && sql.includes("for update")) {
          return {
            rows: options?.missingUser ? [] : [state.user],
            rowCount: options?.missingUser ? 0 : 1
          };
        }

        if (sql.includes("update users") && sql.includes("display_name = case")) {
          state.user = {
            ...state.user,
            display_name: values?.[1] ? null : state.user.display_name,
            bio: values?.[2] ? null : state.user.bio,
            avatar_url: values?.[3] ? null : state.user.avatar_url,
            updated_at: new Date("2026-07-05T10:05:00.000Z")
          };

          return {
            rows: [state.user],
            rowCount: 1
          };
        }

        if (sql.includes("insert into audit_events")) {
          state.auditPayload = String(values?.[5] ?? "");
          return {
            rows: [],
            rowCount: 1
          };
        }

        throw new Error(`Unexpected query: ${sql}`);
      }),
      release: vi.fn()
    }))
  } as unknown as Pool;

  return { pool, state };
}

describe("user profile moderation service", () => {
  it("resets public profile fields, deletes the old avatar object, and writes a redacted audit event", async () => {
    vi.mocked(deleteLocalAvatarFileForUrl).mockResolvedValueOnce(true);
    const { pool, state } = createDbPool();

    const response = await moderateUserProfile(
      pool,
      "user_target_1",
      {
        reasonCode: "profile_content_review",
        resetDisplayName: true,
        clearBio: true,
        clearAvatar: true
      },
      ADMIN_ACTOR
    );

    expect(response).toMatchObject({
      userId: "user_target_1",
      handle: "user_abcd1234",
      status: "active",
      resetDisplayName: true,
      clearBio: true,
      clearAvatar: true,
      avatarFileDeleted: true,
      auditEventId: expect.any(String)
    });
    expect(state.user.display_name).toBeNull();
    expect(state.user.bio).toBeNull();
    expect(state.user.avatar_url).toBeNull();
    expect(deleteLocalAvatarFileForUrl).toHaveBeenCalledWith("/api/uploads/avatars/avatar-old.webp");
    expect(state.auditPayload).toContain("profile_content_review");
    expect(state.auditPayload).toContain("displayNamePresent");
    expect(state.auditPayload).not.toContain("bad stored name");
    expect(state.auditPayload).not.toContain("bad stored bio");
  });

  it("rejects empty action payloads before touching the database", async () => {
    const { pool } = createDbPool();

    await expect(
      moderateUserProfile(
        pool,
        "user_target_1",
        {
          reasonCode: "profile_content_review"
        },
        ADMIN_ACTOR
      )
    ).rejects.toMatchObject<Partial<UserProfileModerationServiceError>>({
      statusCode: 400,
      code: "invalid_request"
    });

    expect((pool.connect as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("returns user_not_found when the target user does not exist", async () => {
    const { pool } = createDbPool({ missingUser: true });

    await expect(
      moderateUserProfile(
        pool,
        "user_missing",
        {
          reasonCode: "profile_content_review",
          resetDisplayName: true
        },
        ADMIN_ACTOR
      )
    ).rejects.toMatchObject<Partial<UserProfileModerationServiceError>>({
      statusCode: 404,
      code: "user_not_found"
    });
  });
});
