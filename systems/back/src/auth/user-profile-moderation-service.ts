import type { Pool, PoolClient } from "pg";

import type { RequestActor } from "./actor-resolver";
import { deleteLocalAvatarFileForUrl } from "./current-user-avatar-service";
import { withTransaction } from "../db/tx/with-transaction";
import { insertAuditEvent } from "../shared/audit-events";
import {
  parseObjectBody,
  parseRequiredStringField
} from "../shared/zod-request-body";

type ModeratedUserProfileRow = {
  id: string;
  handle: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  status: "active" | "locked" | "archived";
  updated_at: Date;
};

export type ModerateUserProfileResponse = {
  userId: string;
  handle: string;
  status: "active" | "locked" | "archived";
  resetDisplayName: boolean;
  clearBio: boolean;
  clearAvatar: boolean;
  avatarFileDeleted: boolean | null;
  updatedAt: string;
  auditEventId: string;
};

type ParsedModerationRequest = {
  reasonCode: string;
  resetDisplayName: boolean;
  clearBio: boolean;
  clearAvatar: boolean;
};

const MAX_ADMIN_REASON_CODE_LENGTH = 120;

export class UserProfileModerationServiceError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "UserProfileModerationServiceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function createModerationRequestError(message: string): UserProfileModerationServiceError {
  return new UserProfileModerationServiceError(400, "invalid_request", message);
}

function parseOptionalBooleanField(parsed: Record<string, unknown>, fieldName: string): boolean {
  const value = parsed[fieldName];
  if (typeof value === "undefined") return false;
  if (typeof value !== "boolean") {
    throw createModerationRequestError(`${fieldName} must be a boolean.`);
  }
  return value;
}

function parseModerationRequest(body: unknown): ParsedModerationRequest {
  const parsed = parseObjectBody(
    body,
    "Request body must be a JSON object.",
    createModerationRequestError
  );
  const reasonCode = parseRequiredStringField(parsed, "reasonCode", createModerationRequestError);
  const resetDisplayName = parseOptionalBooleanField(parsed, "resetDisplayName");
  const clearBio = parseOptionalBooleanField(parsed, "clearBio");
  const clearAvatar = parseOptionalBooleanField(parsed, "clearAvatar");

  if (/[\u0000-\u001f\u007f]/.test(reasonCode)) {
    throw createModerationRequestError("reasonCode cannot contain control characters.");
  }

  if (reasonCode.length > MAX_ADMIN_REASON_CODE_LENGTH) {
    throw createModerationRequestError(`reasonCode must be ${MAX_ADMIN_REASON_CODE_LENGTH} characters or fewer.`);
  }

  if (!resetDisplayName && !clearBio && !clearAvatar) {
    throw createModerationRequestError("At least one profile moderation action is required.");
  }

  return {
    reasonCode,
    resetDisplayName,
    clearBio,
    clearAvatar
  };
}

async function readLockedUserProfileRow(
  client: PoolClient,
  userId: string
): Promise<ModeratedUserProfileRow | null> {
  const result = await client.query<ModeratedUserProfileRow>(
    `
      select
        id,
        handle,
        display_name,
        bio,
        avatar_url,
        status,
        updated_at
      from users
      where id = $1
      limit 1
      for update
    `,
    [userId]
  );

  return result.rows[0] ?? null;
}

function buildContentPresenceSnapshot(row: ModeratedUserProfileRow) {
  return {
    displayNamePresent: Boolean(row.display_name?.trim()),
    bioPresent: Boolean(row.bio?.trim()),
    avatarPresent: Boolean(row.avatar_url?.trim())
  };
}

async function updateProfileFields(
  client: PoolClient,
  targetUserId: string,
  request: ParsedModerationRequest
): Promise<ModeratedUserProfileRow> {
  const result = await client.query<ModeratedUserProfileRow>(
    `
      update users
      set
        display_name = case when $2 then null else display_name end,
        bio = case when $3 then null else bio end,
        avatar_url = case when $4 then null else avatar_url end,
        updated_at = now()
      where id = $1
      returning id, handle, display_name, bio, avatar_url, status, updated_at
    `,
    [targetUserId, request.resetDisplayName, request.clearBio, request.clearAvatar]
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error(`Updated user row missing for ${targetUserId}.`);
  }

  return row;
}

export async function moderateUserProfile(
  pool: Pool,
  targetUserId: string,
  body: unknown,
  actor: RequestActor
): Promise<ModerateUserProfileResponse> {
  const request = parseModerationRequest(body);
  let oldAvatarUrl: string | null = null;

  const result = await withTransaction(pool, async (client) => {
    const before = await readLockedUserProfileRow(client, targetUserId);

    if (!before) {
      throw new UserProfileModerationServiceError(404, "user_not_found", "Requested user was not found.");
    }

    oldAvatarUrl = request.clearAvatar ? before.avatar_url : null;
    const after = await updateProfileFields(client, targetUserId, request);
    const auditEventId = await insertAuditEvent(client, {
      actorId: actor.actorId,
      action: "admin.user.profile_moderate",
      entityType: "user",
      entityId: targetUserId,
      payload: {
        reasonCode: request.reasonCode,
        actions: {
          resetDisplayName: request.resetDisplayName,
          clearBio: request.clearBio,
          clearAvatar: request.clearAvatar
        },
        before: buildContentPresenceSnapshot(before),
        after: buildContentPresenceSnapshot(after)
      }
    });

    return {
      userId: after.id,
      handle: after.handle,
      status: after.status,
      resetDisplayName: request.resetDisplayName,
      clearBio: request.clearBio,
      clearAvatar: request.clearAvatar,
      avatarFileDeleted: request.clearAvatar ? false : null,
      updatedAt: after.updated_at.toISOString(),
      auditEventId
    };
  });

  if (request.clearAvatar && oldAvatarUrl) {
    result.avatarFileDeleted = await deleteLocalAvatarFileForUrl(oldAvatarUrl);
  }

  return result;
}
