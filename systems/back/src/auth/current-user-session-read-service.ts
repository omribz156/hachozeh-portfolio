import type { Queryable } from "../db/client/pool";

type CurrentUserSessionReadRow = {
  current_expires_at: Date;
  current_last_seen_at: Date | null;
  active_session_count: number;
  summary_last_seen_at: Date | null;
};

type CurrentUserSessionRow = {
  id: string;
  created_at: Date;
  last_seen_at: Date | null;
  expires_at: Date;
};

type SecurityAuditRow = {
  action: string;
  created_at: Date;
  actor_id: string;
};

const RECENT_SESSION_WINDOW_SQL = "30 minutes";

export type CurrentUserSessionReadResponse = {
  summary: {
    activeCount: number;
    hasOtherActiveSessions: boolean;
    lastSeenAt: string | null;
  };
  currentSession: {
    id: string;
    expiresAt: string;
    lastSeenAt: string | null;
  };
  sessions: Array<{
    id: string;
    label: string;
    current: boolean;
    createdAt: string;
    lastSeenAt: string | null;
    expiresAt: string;
  }>;
  recentSecurityActions: Array<{
    action: string;
    createdAt: string;
    actorId: string;
  }>;
};

export async function readCurrentUserSessionSummary(
  db: Queryable,
  userId: string,
  sessionId: string
): Promise<CurrentUserSessionReadResponse> {
  const [result, sessionsResult, auditResult] = await Promise.all([
    db.query<CurrentUserSessionReadRow>(
      `
        select
          current_session.expires_at as current_expires_at,
          current_session.last_seen_at as current_last_seen_at,
          summary.active_session_count,
          summary.last_seen_at as summary_last_seen_at
        from sessions current_session
        join lateral (
          select
            count(*)::int as active_session_count,
            max(s.last_seen_at) as last_seen_at
          from sessions s
          where s.user_id = current_session.user_id
            and s.status = 'active'
            and s.expires_at > now()
            and (
              s.id = current_session.id
              or s.last_seen_at >= now() - $3::interval
            )
        ) summary
          on true
        where current_session.id = $1
          and current_session.user_id = $2
          and current_session.status = 'active'
          and current_session.expires_at > now()
        limit 1
      `,
      [sessionId, userId, RECENT_SESSION_WINDOW_SQL]
    ),
    db.query<CurrentUserSessionRow>(
      `
        select
          id,
          created_at,
          last_seen_at,
          expires_at
        from sessions
        where user_id = $1
          and status = 'active'
          and expires_at > now()
          and (
            id = $2
            or last_seen_at >= now() - $3::interval
          )
        order by (id = $2) desc, last_seen_at desc nulls last, created_at desc
        limit 20
      `,
      [userId, sessionId, RECENT_SESSION_WINDOW_SQL]
    ),
    db.query<SecurityAuditRow>(
      `
        select
          action,
          created_at,
          actor_id
        from audit_events
        where entity_type = 'user'
          and entity_id = $1
          and action in (
            'user.session.revoke_other_sessions',
            'admin.user.revoke_sessions'
          )
        order by created_at desc
        limit 3
      `,
      [userId]
    )
  ]);

  const row = result.rows[0];

  if (!row) {
    throw new Error(`Current session summary not found for actor ${userId}.`);
  }

  return {
    summary: {
      activeCount: row.active_session_count,
      hasOtherActiveSessions: row.active_session_count > 1,
      lastSeenAt: row.summary_last_seen_at?.toISOString() ?? null
    },
    currentSession: {
      id: sessionId,
      expiresAt: row.current_expires_at.toISOString(),
      lastSeenAt: row.current_last_seen_at?.toISOString() ?? null
    },
    sessions: sessionsResult.rows.map((session, index) => {
      const current = session.id === sessionId;
      return {
        id: session.id,
        label: current ? "המכשיר הזה" : `מכשיר ${index + 1}`,
        current,
        createdAt: session.created_at.toISOString(),
        lastSeenAt: session.last_seen_at?.toISOString() ?? null,
        expiresAt: session.expires_at.toISOString()
      };
    }),
    recentSecurityActions: auditResult.rows.map((auditRow) => ({
      action: auditRow.action,
      createdAt: auditRow.created_at.toISOString(),
      actorId: auditRow.actor_id
    }))
  };
}
