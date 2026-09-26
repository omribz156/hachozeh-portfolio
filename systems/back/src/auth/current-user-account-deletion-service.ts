import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import type { Queryable } from "../db/client/pool";
import { withTransaction } from "../db/tx/with-transaction";
import { insertAuditEvent } from "../shared/audit-events";
import {
  parseNullableStringField,
  parseObjectBody
} from "../shared/zod-request-body";

const ACCOUNT_DELETION_GRACE_DAYS = 14;

type TradeAccessStatus = "enabled" | "blocked";
type DeletionStatus = "scheduled" | "cancelled" | "completed";

type AccountDeletionRow = {
  id: string;
  user_id: string;
  status: DeletionStatus;
  reason: string | null;
  previous_trade_access_status: TradeAccessStatus;
  created_session_id: string | null;
  scheduled_at: Date;
  delete_after: Date;
  cancelled_at: Date | null;
  completed_at: Date | null;
  updated_at: Date;
};

type CurrentUserDeletionStateRow = {
  id: string;
  status: "active" | "locked" | "archived";
  trade_access_status: TradeAccessStatus;
};

export type CurrentUserAccountDeletionResponse = {
  deletion: {
    status: "none" | DeletionStatus;
    requestId: string | null;
    reason: string | null;
    scheduledAt: string | null;
    deleteAfter: string | null;
    cancelledAt: string | null;
    completedAt: string | null;
  };
  user: {
    userId: string;
    tradeAccessStatus: TradeAccessStatus | null;
  };
};

export class CurrentUserAccountDeletionServiceError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "CurrentUserAccountDeletionServiceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function createAccountDeletionRequestError(message: string): CurrentUserAccountDeletionServiceError {
  return new CurrentUserAccountDeletionServiceError(400, "invalid_request", message);
}

function rejectControlChars(value: string, fieldName: string): void {
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw createAccountDeletionRequestError(`${fieldName} cannot contain control characters.`);
  }
}

function parseOptionalBody(body: unknown): Record<string, unknown> {
  if (body == null) return {};
  return parseObjectBody(
    body,
    "Request body must be a JSON object.",
    createAccountDeletionRequestError
  );
}

function normalizeReason(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  rejectControlChars(normalized, "reason");

  if (normalized.length > 240) {
    throw createAccountDeletionRequestError("reason must be 240 characters or fewer.");
  }

  return normalized;
}

function mapDeletionRow(
  row: AccountDeletionRow | null,
  userId: string,
  tradeAccessStatus: TradeAccessStatus | null
): CurrentUserAccountDeletionResponse {
  if (!row) {
    return {
      deletion: {
        status: "none",
        requestId: null,
        reason: null,
        scheduledAt: null,
        deleteAfter: null,
        cancelledAt: null,
        completedAt: null
      },
      user: {
        userId,
        tradeAccessStatus
      }
    };
  }

  return {
    deletion: {
      status: row.status,
      requestId: row.id,
      reason: row.reason,
      scheduledAt: row.scheduled_at.toISOString(),
      deleteAfter: row.delete_after.toISOString(),
      cancelledAt: row.cancelled_at?.toISOString() ?? null,
      completedAt: row.completed_at?.toISOString() ?? null
    },
    user: {
      userId,
      tradeAccessStatus
    }
  };
}

async function readScheduledDeletionRow(
  db: Queryable,
  userId: string
): Promise<AccountDeletionRow | null> {
  const result = await db.query<AccountDeletionRow>(
    `
      select
        id,
        user_id,
        status,
        reason,
        previous_trade_access_status,
        created_session_id,
        scheduled_at,
        delete_after,
        cancelled_at,
        completed_at,
        updated_at
      from account_deletion_requests
      where user_id = $1
        and status = 'scheduled'
      order by scheduled_at desc
      limit 1
    `,
    [userId]
  );

  return result.rows[0] ?? null;
}

async function readLockedDeletionUser(
  client: PoolClient,
  userId: string
): Promise<CurrentUserDeletionStateRow> {
  const result = await client.query<CurrentUserDeletionStateRow>(
    `
      select id, status, trade_access_status
      from users
      where id = $1
      limit 1
      for update
    `,
    [userId]
  );

  const row = result.rows[0];
  if (!row) {
    throw new CurrentUserAccountDeletionServiceError(
      404,
      "user_not_found",
      "Current user was not found."
    );
  }

  if (row.status !== "active") {
    throw new CurrentUserAccountDeletionServiceError(
      409,
      "invalid_user_state",
      "Account deletion is only available for active accounts."
    );
  }

  return row;
}

export async function readCurrentUserAccountDeletion(
  db: Queryable,
  userId: string
): Promise<CurrentUserAccountDeletionResponse> {
  const [userResult, deletion] = await Promise.all([
    db.query<CurrentUserDeletionStateRow>(
      `
        select id, status, trade_access_status
        from users
        where id = $1
        limit 1
      `,
      [userId]
    ),
    readScheduledDeletionRow(db, userId)
  ]);

  const user = userResult.rows[0] ?? null;

  return mapDeletionRow(deletion, userId, user?.trade_access_status ?? null);
}

export async function scheduleCurrentUserAccountDeletion(
  pool: Pool,
  userId: string,
  sessionId: string,
  body: unknown
): Promise<CurrentUserAccountDeletionResponse> {
  const parsed = parseOptionalBody(body);
  const reason = normalizeReason(
    parseNullableStringField(parsed, "reason", createAccountDeletionRequestError)
  );

  return withTransaction(pool, async (client) => {
    const user = await readLockedDeletionUser(client, userId);
    const existing = await readScheduledDeletionRow(client, userId);
    if (existing) {
      return mapDeletionRow(existing, userId, user.trade_access_status);
    }

    const requestId = `delete_${randomUUID()}`;
    const insertResult = await client.query<AccountDeletionRow>(
      `
        insert into account_deletion_requests (
          id,
          user_id,
          status,
          reason,
          previous_trade_access_status,
          created_session_id,
          scheduled_at,
          delete_after,
          updated_at
        )
        values (
          $1,
          $2,
          'scheduled',
          $3,
          $4,
          $5,
          now(),
          now() + ($6::text || ' days')::interval,
          now()
        )
        returning
          id,
          user_id,
          status,
          reason,
          previous_trade_access_status,
          created_session_id,
          scheduled_at,
          delete_after,
          cancelled_at,
          completed_at,
          updated_at
      `,
      [
        requestId,
        userId,
        reason,
        user.trade_access_status,
        sessionId || null,
        ACCOUNT_DELETION_GRACE_DAYS
      ]
    );

    await client.query(
      `
        update users
        set trade_access_status = 'blocked',
            updated_at = now()
        where id = $1
      `,
      [userId]
    );

    await client.query(
      `
        update sessions
        set status = 'revoked',
            revoked_at = now(),
            revoked_reason = 'self_account_deletion_scheduled'
        where user_id = $1
          and status = 'active'
          and id <> $2
      `,
      [userId, sessionId || ""]
    );

    const row = insertResult.rows[0];
    await insertAuditEvent(client, {
      actorId: userId,
      action: "user.account_deletion.schedule",
      entityType: "user",
      entityId: userId,
      payload: {
        requestId,
        sessionId: sessionId || null,
        deleteAfter: row?.delete_after?.toISOString() ?? null
      }
    });

    return mapDeletionRow(row ?? null, userId, "blocked");
  });
}

export async function cancelCurrentUserAccountDeletion(
  pool: Pool,
  userId: string,
  sessionId: string,
  body: unknown
): Promise<CurrentUserAccountDeletionResponse> {
  parseOptionalBody(body);

  return withTransaction(pool, async (client) => {
    await readLockedDeletionUser(client, userId);
    const existing = await readScheduledDeletionRow(client, userId);
    if (!existing) {
      return mapDeletionRow(null, userId, null);
    }

    const cancelResult = await client.query<AccountDeletionRow>(
      `
        update account_deletion_requests
        set status = 'cancelled',
            cancelled_at = now(),
            updated_at = now()
        where id = $1
          and user_id = $2
          and status = 'scheduled'
        returning
          id,
          user_id,
          status,
          reason,
          previous_trade_access_status,
          created_session_id,
          scheduled_at,
          delete_after,
          cancelled_at,
          completed_at,
          updated_at
      `,
      [existing.id, userId]
    );

    await client.query(
      `
        update users
        set trade_access_status = $2,
            updated_at = now()
        where id = $1
      `,
      [userId, existing.previous_trade_access_status]
    );

    await insertAuditEvent(client, {
      actorId: userId,
      action: "user.account_deletion.cancel",
      entityType: "user",
      entityId: userId,
      payload: {
        requestId: existing.id,
        sessionId: sessionId || null
      }
    });

    return mapDeletionRow(cancelResult.rows[0] ?? null, userId, existing.previous_trade_access_status);
  });
}
