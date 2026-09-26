import type { Pool, PoolClient } from "pg";

import { withTransaction } from "../db/tx/with-transaction";
import { insertAuditEvent } from "../shared/audit-events";
import { parseObjectBody } from "../shared/zod-request-body";

type CurrentSessionRow = {
  id: string;
};

export type RevokeOtherSessionsResponse = {
  userId: string;
  revokedSessionCount: number;
  revokedAt: string;
  auditEventId: string;
};

export type RevokeCurrentUserSessionResponse = {
  userId: string;
  sessionId: string;
  revokedAt: string;
  auditEventId: string;
};

export class CurrentUserSessionMutationError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "CurrentUserSessionMutationError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function createCurrentUserSessionMutationRequestError(message: string): CurrentUserSessionMutationError {
  return new CurrentUserSessionMutationError(400, "invalid_request", message);
}

function ensureObjectBody(body: unknown): void {
  if (body == null) {
    return;
  }

  parseObjectBody(
    body,
    "Request body must be a JSON object.",
    createCurrentUserSessionMutationRequestError
  );
}

async function readCurrentSession(
  client: PoolClient,
  userId: string,
  sessionId: string
): Promise<CurrentSessionRow | null> {
  const result = await client.query<CurrentSessionRow>(
    `
      select id
      from sessions
      where id = $1
        and user_id = $2
        and status = 'active'
      limit 1
      for update
    `,
    [sessionId, userId]
  );

  return result.rows[0] ?? null;
}

export async function revokeOtherCurrentUserSessions(
  pool: Pool,
  userId: string,
  sessionId: string,
  body: unknown
): Promise<RevokeOtherSessionsResponse> {
  ensureObjectBody(body);

  return withTransaction(pool, async (client) => {
    const currentSession = await readCurrentSession(client, userId, sessionId);

    if (!currentSession) {
      throw new CurrentUserSessionMutationError(
        401,
        "unauthorized",
        "Current session is unavailable."
      );
    }

    const revokeResult = await client.query(
      `
        update sessions
        set status = 'revoked',
            revoked_at = now(),
            revoked_reason = 'self_revoke_other_sessions'
        where user_id = $1
          and status = 'active'
          and id <> $2
      `,
      [userId, sessionId]
    );

    const revokedAt = new Date().toISOString();
    const auditEventId = await insertAuditEvent(client, {
      actorId: userId,
      action: "user.session.revoke_other_sessions",
      entityType: "user",
      entityId: userId,
      payload: {
        currentSessionId: sessionId,
        revokedSessionCount: revokeResult.rowCount ?? 0,
        revokedAt
      }
    });

    return {
      userId,
      revokedSessionCount: revokeResult.rowCount ?? 0,
      revokedAt,
      auditEventId
    };
  });
}

export async function revokeCurrentUserSessionById(
  pool: Pool,
  userId: string,
  currentSessionId: string,
  targetSessionId: string,
  body: unknown
): Promise<RevokeCurrentUserSessionResponse> {
  ensureObjectBody(body);

  if (!targetSessionId || targetSessionId === currentSessionId) {
    throw new CurrentUserSessionMutationError(
      400,
      "invalid_session",
      "Use the logout endpoint for the current session."
    );
  }

  return withTransaction(pool, async (client) => {
    const currentSession = await readCurrentSession(client, userId, currentSessionId);

    if (!currentSession) {
      throw new CurrentUserSessionMutationError(
        401,
        "unauthorized",
        "Current session is unavailable."
      );
    }

    const revokeResult = await client.query(
      `
        update sessions
        set status = 'revoked',
            revoked_at = now(),
            revoked_reason = 'self_revoke_single_session'
        where id = $1
          and user_id = $2
          and status = 'active'
      `,
      [targetSessionId, userId]
    );

    if ((revokeResult.rowCount ?? 0) < 1) {
      throw new CurrentUserSessionMutationError(
        404,
        "session_not_found",
        "Session was not found for this user."
      );
    }

    const revokedAt = new Date().toISOString();
    const auditEventId = await insertAuditEvent(client, {
      actorId: userId,
      action: "user.session.revoke_session",
      entityType: "user",
      entityId: userId,
      payload: {
        currentSessionId,
        targetSessionId,
        revokedAt
      }
    });

    return {
      userId,
      sessionId: targetSessionId,
      revokedAt,
      auditEventId
    };
  });
}
