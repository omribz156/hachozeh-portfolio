import type { Pool, PoolClient } from "pg";

import type { RequestActor } from "./actor-resolver";
import { withTransaction } from "../db/tx/with-transaction";
import { insertAuditEvent } from "../shared/audit-events";
import {
  parseObjectBody,
  parseRequiredStringField
} from "../shared/zod-request-body";

type UserStatus = "active" | "locked" | "archived";
type TradeAccessStatus = "enabled" | "blocked";

type UserControlRow = {
  id: string;
  status: UserStatus;
  role: "user" | "admin";
  trade_access_status: TradeAccessStatus;
  lock_reason_code: string | null;
  locked_at: Date | null;
  created_at: Date;
  updated_at: Date;
  last_login_at: Date | null;
};

type UserControlSnapshot = {
  userId: string;
  status: UserStatus;
  tradeAccessStatus: TradeAccessStatus;
  lockReasonCode: string | null;
  lockedAt: string | null;
  updatedAt: string;
};

type UserControlActionResponse = UserControlSnapshot & {
  auditEventId: string;
};

const MAX_ADMIN_REASON_CODE_LENGTH = 120;

export type ArchiveUserAccountResponse = UserControlSnapshot & {
  revokedSessionCount: number;
  revokedAt: string;
  auditEventId: string;
};

export type RevokeUserSessionsResponse = {
  userId: string;
  revokedSessionCount: number;
  revokedAt: string;
  auditEventId: string;
};

export class UserOpsServiceError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "UserOpsServiceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function createUserOpsRequestError(message: string): UserOpsServiceError {
  return new UserOpsServiceError(400, "invalid_request", message);
}

function readRequiredReasonCode(body: unknown, fieldName = "reasonCode"): string {
  const candidate = parseObjectBody(
    body,
    "Request body must be a JSON object.",
    createUserOpsRequestError
  );
  const reasonCode = parseRequiredStringField(candidate, fieldName, createUserOpsRequestError);

  if (/[\u0000-\u001f\u007f]/.test(reasonCode)) {
    throw createUserOpsRequestError(`${fieldName} cannot contain control characters.`);
  }

  if (reasonCode.length > MAX_ADMIN_REASON_CODE_LENGTH) {
    throw createUserOpsRequestError(`${fieldName} must be ${MAX_ADMIN_REASON_CODE_LENGTH} characters or fewer.`);
  }

  return reasonCode;
}

function ensureObjectBody(body: unknown): void {
  if (body == null) {
    return;
  }

  parseObjectBody(body, "Request body must be a JSON object.", createUserOpsRequestError);
}

async function readLockedUserControlRow(
  client: PoolClient,
  userId: string
): Promise<UserControlRow | null> {
  const result = await client.query<UserControlRow>(
    `
      select
        id,
        status,
        role,
        trade_access_status,
        lock_reason_code,
        locked_at,
        created_at,
        updated_at,
        last_login_at
      from users
      where id = $1
      limit 1
      for update
    `,
    [userId]
  );

  return result.rows[0] ?? null;
}

function buildSnapshot(row: UserControlRow): UserControlSnapshot {
  return {
    userId: row.id,
    status: row.status,
    tradeAccessStatus: row.trade_access_status,
    lockReasonCode: row.lock_reason_code,
    lockedAt: row.locked_at?.toISOString() ?? null,
    updatedAt: row.updated_at.toISOString()
  };
}

function assertMutableUser(row: UserControlRow): void {
  if (row.status === "archived") {
    throw new UserOpsServiceError(409, "invalid_user_state", "Archived users cannot be updated.");
  }
}

async function updateUserLockState(
  client: PoolClient,
  userId: string,
  status: "active" | "locked",
  reasonCode: string | null
): Promise<UserControlRow> {
  const result = await client.query<UserControlRow>(
    `
      update users
      set status = $2,
          lock_reason_code = $3,
          locked_at = case when $2 = 'locked' then now() else null end,
          updated_at = now()
      where id = $1
      returning
        id,
        status,
        role,
        trade_access_status,
        lock_reason_code,
        locked_at,
        created_at,
        updated_at,
        last_login_at
    `,
    [userId, status, reasonCode]
  );

  const row = result.rows[0];

  if (!row) {
    throw new Error(`Updated user row missing for ${userId}.`);
  }

  return row;
}

async function updateTradeAccessState(
  client: PoolClient,
  userId: string,
  tradeAccessStatus: TradeAccessStatus
): Promise<UserControlRow> {
  const result = await client.query<UserControlRow>(
    `
      update users
      set trade_access_status = $2,
          updated_at = now()
      where id = $1
      returning
        id,
        status,
        role,
        trade_access_status,
        lock_reason_code,
        locked_at,
        created_at,
        updated_at,
        last_login_at
    `,
    [userId, tradeAccessStatus]
  );

  const row = result.rows[0];

  if (!row) {
    throw new Error(`Updated user row missing for ${userId}.`);
  }

  return row;
}

async function archiveUserState(
  client: PoolClient,
  userId: string,
  reasonCode: string
): Promise<UserControlRow> {
  const result = await client.query<UserControlRow>(
    `
      update users
      set status = 'archived',
          trade_access_status = 'blocked',
          lock_reason_code = $2,
          locked_at = coalesce(locked_at, now()),
          updated_at = now()
      where id = $1
      returning
        id,
        status,
        role,
        trade_access_status,
        lock_reason_code,
        locked_at,
        created_at,
        updated_at,
        last_login_at
    `,
    [userId, reasonCode]
  );

  const row = result.rows[0];

  if (!row) {
    throw new Error(`Updated user row missing for ${userId}.`);
  }

  return row;
}

async function runUserStateAction(
  pool: Pool,
  targetUserId: string,
  actor: RequestActor,
  options: {
    action: string;
    requireReasonCode?: boolean;
    body: unknown;
    update: (client: PoolClient, row: UserControlRow, reasonCode: string | null) => Promise<UserControlRow>;
  }
): Promise<UserControlActionResponse> {
  const reasonCode = options.requireReasonCode ? readRequiredReasonCode(options.body) : null;

  if (!options.requireReasonCode) {
    ensureObjectBody(options.body);
  }

  return withTransaction(pool, async (client) => {
    const before = await readLockedUserControlRow(client, targetUserId);

    if (!before) {
      throw new UserOpsServiceError(404, "user_not_found", "Requested user was not found.");
    }

    assertMutableUser(before);

    const after = await options.update(client, before, reasonCode);
    const payload = {
      reasonCode,
      before: buildSnapshot(before),
      after: buildSnapshot(after)
    };
    const auditEventId = await insertAuditEvent(client, {
      actorId: actor.actorId,
      action: options.action,
      entityType: "user",
      entityId: targetUserId,
      payload
    });

    return {
      ...buildSnapshot(after),
      auditEventId
    };
  });
}

export async function lockUserAccount(
  pool: Pool,
  targetUserId: string,
  body: unknown,
  actor: RequestActor
): Promise<UserControlActionResponse> {
  return runUserStateAction(pool, targetUserId, actor, {
    action: "admin.user.lock",
    requireReasonCode: true,
    body,
    update: async (client, row, reasonCode) => {
      if (row.status === "locked" && row.lock_reason_code === reasonCode) {
        return row;
      }

      return updateUserLockState(client, targetUserId, "locked", reasonCode);
    }
  });
}

export async function unlockUserAccount(
  pool: Pool,
  targetUserId: string,
  body: unknown,
  actor: RequestActor
): Promise<UserControlActionResponse> {
  return runUserStateAction(pool, targetUserId, actor, {
    action: "admin.user.unlock",
    body,
    update: async (client, row) => {
      if (row.status === "active" && row.lock_reason_code === null && row.locked_at === null) {
        return row;
      }

      return updateUserLockState(client, targetUserId, "active", null);
    }
  });
}

export async function blockUserTrading(
  pool: Pool,
  targetUserId: string,
  body: unknown,
  actor: RequestActor
): Promise<UserControlActionResponse> {
  return runUserStateAction(pool, targetUserId, actor, {
    action: "admin.user.trade_block",
    requireReasonCode: true,
    body,
    update: async (client, row) => {
      if (row.trade_access_status === "blocked") {
        return row;
      }

      return updateTradeAccessState(client, targetUserId, "blocked");
    }
  });
}

export async function restoreUserTrading(
  pool: Pool,
  targetUserId: string,
  body: unknown,
  actor: RequestActor
): Promise<UserControlActionResponse> {
  return runUserStateAction(pool, targetUserId, actor, {
    action: "admin.user.trade_restore",
    body,
    update: async (client, row) => {
      if (row.trade_access_status === "enabled") {
        return row;
      }

      return updateTradeAccessState(client, targetUserId, "enabled");
    }
  });
}

export async function archiveUserAccount(
  pool: Pool,
  targetUserId: string,
  body: unknown,
  actor: RequestActor
): Promise<ArchiveUserAccountResponse> {
  const reasonCode = readRequiredReasonCode(body);

  return withTransaction(pool, async (client) => {
    const before = await readLockedUserControlRow(client, targetUserId);

    if (!before) {
      throw new UserOpsServiceError(404, "user_not_found", "Requested user was not found.");
    }

    const after =
      before.status === "archived"
        ? before
        : await archiveUserState(client, targetUserId, reasonCode);
    const revokeResult = await client.query(
      `
        update sessions
        set status = 'revoked',
            revoked_at = now(),
            revoked_reason = 'admin_archive_user'
        where user_id = $1
          and status = 'active'
      `,
      [targetUserId]
    );
    const revokedAt = new Date().toISOString();
    const auditEventId = await insertAuditEvent(client, {
      actorId: actor.actorId,
      action: "admin.user.archive",
      entityType: "user",
      entityId: targetUserId,
      payload: {
        reasonCode,
        revokedSessionCount: revokeResult.rowCount ?? 0,
        revokedAt,
        before: buildSnapshot(before),
        after: buildSnapshot(after)
      }
    });

    return {
      ...buildSnapshot(after),
      revokedSessionCount: revokeResult.rowCount ?? 0,
      revokedAt,
      auditEventId
    };
  });
}

export async function revokeUserSessions(
  pool: Pool,
  targetUserId: string,
  body: unknown,
  actor: RequestActor
): Promise<RevokeUserSessionsResponse> {
  ensureObjectBody(body);

  return withTransaction(pool, async (client) => {
    const user = await readLockedUserControlRow(client, targetUserId);

    if (!user) {
      throw new UserOpsServiceError(404, "user_not_found", "Requested user was not found.");
    }

    const revokeResult = await client.query(
      `
        update sessions
        set status = 'revoked',
            revoked_at = now(),
            revoked_reason = 'admin_revoke_all'
        where user_id = $1
          and status = 'active'
      `,
      [targetUserId]
    );

    const revokedAt = new Date().toISOString();
    const auditEventId = await insertAuditEvent(client, {
      actorId: actor.actorId,
      action: "admin.user.revoke_sessions",
      entityType: "user",
      entityId: targetUserId,
      payload: {
        revokedSessionCount: revokeResult.rowCount ?? 0,
        revokedAt
      }
    });

    return {
      userId: targetUserId,
      revokedSessionCount: revokeResult.rowCount ?? 0,
      revokedAt,
      auditEventId
    };
  });
}
