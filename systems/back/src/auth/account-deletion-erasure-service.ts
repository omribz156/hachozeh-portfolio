import type { Pool, PoolClient } from "pg";

import type { Queryable } from "../db/client/pool";
import { withTransaction } from "../db/tx/with-transaction";
import { insertAuditEvent } from "../shared/audit-events";
import { deleteLocalAvatarFileForUrl } from "./current-user-avatar-service";

const PRIVACY_ERASURE_ACTOR_ID = "system:privacy-erasure";
const DELETED_COMMENT_BODY = "[removed]";

type DueDeletionRow = {
  id: string;
  user_id: string;
  reason: string | null;
  scheduled_at: Date;
  delete_after: Date;
};

type IdentityRow = {
  type: string;
  identifier_normalized: string;
};

type UserAvatarRow = {
  avatar_url: string | null;
};

type RowCountResult = {
  rowCount: number | null;
};

export type AccountDeletionErasureCounts = {
  sessionsDeleted: number;
  identitiesDeleted: number;
  otpChallengesDeleted: number;
  notificationPreferencesDeleted: number;
  socialLinksDeleted: number;
  feedbackDeleted: number;
  commentLikesDeleted: number;
  commentsHidden: number;
  communityContentHidden: number;
  communityLikesDeleted: number;
  marketSavesDeleted: number;
  followsDeleted: number;
  profileViewsDeleted: number;
  userFaucetStateDeleted: number;
  idempotencyRecordsDeleted: number;
  avatarFileDeleted: boolean;
};

export type AccountDeletionErasureItem = {
  requestId: string;
  userId: string;
  status: "would_complete" | "completed" | "skipped_not_found" | "skipped_not_due";
  scheduledAt: string | null;
  deleteAfter: string | null;
  completedAt: string | null;
  auditEventId: string | null;
  counts: AccountDeletionErasureCounts | null;
};

export type AccountDeletionErasureSweepResult = {
  objectType: "account_deletion_erasure_sweep";
  generatedAt: string;
  execute: boolean;
  scannedCount: number;
  completedCount: number;
  skippedCount: number;
  items: AccountDeletionErasureItem[];
};

export type PendingAccountDeletionItem = {
  requestId: string;
  userId: string;
  reason: string | null;
  scheduledAt: string | null;
  deleteAfter: string | null;
  isDue: boolean;
};

export type PendingAccountDeletionListResult = {
  objectType: "account_deletion_pending_requests";
  generatedAt: string;
  scannedCount: number;
  dueCount: number;
  items: PendingAccountDeletionItem[];
};

function toIso(value: Date | null | undefined): string | null {
  return value?.toISOString() ?? null;
}

function rowCount(result: RowCountResult): number {
  return Number(result.rowCount ?? 0);
}

function emptyCounts(): AccountDeletionErasureCounts {
  return {
    sessionsDeleted: 0,
    identitiesDeleted: 0,
    otpChallengesDeleted: 0,
    notificationPreferencesDeleted: 0,
    socialLinksDeleted: 0,
    feedbackDeleted: 0,
    commentLikesDeleted: 0,
    commentsHidden: 0,
    communityContentHidden: 0,
    communityLikesDeleted: 0,
    marketSavesDeleted: 0,
    followsDeleted: 0,
    profileViewsDeleted: 0,
    userFaucetStateDeleted: 0,
    idempotencyRecordsDeleted: 0,
    avatarFileDeleted: false
  };
}

async function readDueDeletionRows(
  db: Queryable,
  input: {
    nowIso: string;
    limit: number;
  }
): Promise<DueDeletionRow[]> {
  const result = await db.query<DueDeletionRow>(
    `
      select id, user_id, reason, scheduled_at, delete_after
      from account_deletion_requests
      where status = 'scheduled'
        and delete_after <= $1::timestamptz
      order by delete_after asc, scheduled_at asc
      limit $2
    `,
    [input.nowIso, input.limit]
  );

  return result.rows;
}

async function readScheduledDeletionRows(
  db: Queryable,
  input: {
    limit: number;
  }
): Promise<DueDeletionRow[]> {
  const result = await db.query<DueDeletionRow>(
    `
      select id, user_id, reason, scheduled_at, delete_after
      from account_deletion_requests
      where status = 'scheduled'
      order by delete_after asc, scheduled_at asc
      limit $1
    `,
    [input.limit]
  );

  return result.rows;
}

async function readDeletionRowForPreview(
  db: Queryable,
  input: {
    requestId: string;
  }
): Promise<DueDeletionRow | null> {
  const result = await db.query<DueDeletionRow>(
    `
      select id, user_id, reason, scheduled_at, delete_after
      from account_deletion_requests
      where id = $1
        and status = 'scheduled'
      limit 1
    `,
    [input.requestId]
  );

  return result.rows[0] ?? null;
}

async function readLockedDeletionRow(
  client: PoolClient,
  requestId: string
): Promise<DueDeletionRow | null> {
  const result = await client.query<DueDeletionRow>(
    `
      select id, user_id, reason, scheduled_at, delete_after
      from account_deletion_requests
      where id = $1
        and status = 'scheduled'
      limit 1
      for update
    `,
    [requestId]
  );

  return result.rows[0] ?? null;
}

async function readUserAvatarUrl(client: PoolClient, userId: string): Promise<string | null> {
  const result = await client.query<UserAvatarRow>(
    `
      select avatar_url
      from users
      where id = $1
      limit 1
      for update
    `,
    [userId]
  );

  return result.rows[0]?.avatar_url ?? null;
}

async function readIdentityRows(client: PoolClient, userId: string): Promise<IdentityRow[]> {
  const result = await client.query<IdentityRow>(
    `
      select type, identifier_normalized
      from user_identities
      where user_id = $1
    `,
    [userId]
  );

  return result.rows;
}

async function deleteOtpChallengesForIdentities(
  client: PoolClient,
  identities: IdentityRow[]
): Promise<number> {
  const emailIdentifiers = Array.from(new Set(
    identities
      .filter((identity) => identity.type === "email")
      .map((identity) => identity.identifier_normalized)
      .filter(Boolean)
  ));

  if (emailIdentifiers.length === 0) {
    return 0;
  }

  return rowCount(await client.query(
    `
      delete from otp_challenges
      where identifier_type = 'email'
        and identifier_normalized = any($1::text[])
    `,
    [emailIdentifiers]
  ));
}

async function deleteByUserId(
  client: PoolClient,
  tableName: string,
  userId: string
): Promise<number> {
  return rowCount(await client.query(
    `delete from ${tableName} where user_id = $1`,
    [userId]
  ));
}

// The follow graph and profile-view log are keyed by two user columns each (not a single user_id),
// so they need their own deletes. Removing both directions when a user is erased takes the person
// out of everyone else's follower/following counts and view history — the behavioural data tied to
// the erased account that would otherwise survive (the counts are computed live, so nothing else
// needs touching). Security records (user_abuse_flags), consent records, and economy/ledger rows
// are deliberately RETAINED — they now point only to the anonymised archived users row, and are
// kept for fraud-prevention, legal-claim, and record-integrity bases (see privacy policy §8.2).
async function deleteUserFollows(client: PoolClient, userId: string): Promise<number> {
  return rowCount(await client.query(
    `delete from user_follows where follower_user_id = $1 or followed_user_id = $1`,
    [userId]
  ));
}

async function deleteUserProfileViews(client: PoolClient, userId: string): Promise<number> {
  return rowCount(await client.query(
    `delete from user_profile_views_daily where profile_user_id = $1 or viewer_user_id = $1`,
    [userId]
  ));
}

async function hideUserComments(client: PoolClient, userId: string): Promise<number> {
  return rowCount(await client.query(
    `
      update market_comments
      set status = 'deleted',
          body = $2,
          updated_at = now()
      where user_id = $1
        and status <> 'deleted'
    `,
    [userId, DELETED_COMMENT_BODY]
  ));
}

// Tombstone the user's community content (discussions, comments, authored feed
// posts) the same way market comments are handled — soft-delete so thread
// structure survives while the content disappears from every read.
async function hideUserCommunityContent(client: PoolClient, userId: string): Promise<number> {
  let hidden = 0;
  for (const table of ["community_discussions", "community_comments", "community_posts"]) {
    hidden += rowCount(
      await client.query(
        `update ${table} set status = 'deleted', body = $2, updated_at = now()
         where user_id = $1 and status <> 'deleted'`,
        [userId, DELETED_COMMENT_BODY]
      )
    );
  }
  return hidden;
}

async function markUserErased(
  client: PoolClient,
  input: {
    userId: string;
    completedAtIso: string;
  }
): Promise<void> {
  await client.query(
    `
      update users
      set status = 'archived',
          trade_access_status = 'blocked',
          lock_reason_code = 'self_account_deletion_completed',
          locked_at = coalesce(locked_at, $2::timestamptz),
          display_name = null,
          bio = null,
          avatar_url = null,
          last_login_at = null,
          privacy_erased_at = $2::timestamptz,
          privacy_erasure_reason = 'self_account_deletion',
          updated_at = $2::timestamptz
      where id = $1
    `,
    [input.userId, input.completedAtIso]
  );
}

function mapPreviewItem(
  row: DueDeletionRow,
  status: AccountDeletionErasureItem["status"],
  nowIso?: string
): AccountDeletionErasureItem {
  return {
    requestId: row.id,
    userId: row.user_id,
    status,
    scheduledAt: toIso(row.scheduled_at),
    deleteAfter: toIso(row.delete_after),
    completedAt: status === "would_complete" ? null : nowIso ?? null,
    auditEventId: null,
    counts: null
  };
}

export async function listPendingAccountDeletionRequests(
  db: Queryable,
  input?: {
    limit?: number;
    now?: Date;
  }
): Promise<PendingAccountDeletionListResult> {
  const now = input?.now ?? new Date();
  const limit = Math.min(Math.max(input?.limit ?? 50, 1), 500);
  const rows = await readScheduledDeletionRows(db, { limit });
  const items = rows.map((row) => ({
    requestId: row.id,
    userId: row.user_id,
    reason: row.reason,
    scheduledAt: toIso(row.scheduled_at),
    deleteAfter: toIso(row.delete_after),
    isDue: row.delete_after.getTime() <= now.getTime()
  }));

  return {
    objectType: "account_deletion_pending_requests",
    generatedAt: now.toISOString(),
    scannedCount: items.length,
    dueCount: items.filter((item) => item.isDue).length,
    items
  };
}

export async function previewAccountDeletionErasure(
  db: Queryable,
  input: {
    requestId: string;
    now?: Date;
  }
): Promise<AccountDeletionErasureItem> {
  const now = input.now ?? new Date();
  const row = await readDeletionRowForPreview(db, {
    requestId: input.requestId
  });

  if (!row) {
    return {
      requestId: input.requestId,
      userId: "",
      status: "skipped_not_found",
      scheduledAt: null,
      deleteAfter: null,
      completedAt: null,
      auditEventId: null,
      counts: null
    };
  }

  if (row.delete_after.getTime() > now.getTime()) {
    return mapPreviewItem(row, "skipped_not_due");
  }

  return mapPreviewItem(row, "would_complete");
}

export async function completeAccountDeletionErasure(
  pool: Pool,
  input: {
    requestId: string;
    now?: Date;
    actorId?: string;
  }
): Promise<AccountDeletionErasureItem> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const actorId = input.actorId?.trim() || PRIVACY_ERASURE_ACTOR_ID;
  let avatarUrl: string | null = null;

  const result = await withTransaction(pool, async (client) => {
    const row = await readLockedDeletionRow(client, input.requestId);
    if (!row) {
      return {
        requestId: input.requestId,
        userId: "",
        status: "skipped_not_found" as const,
        scheduledAt: null,
        deleteAfter: null,
        completedAt: null,
        auditEventId: null,
        counts: null
      };
    }

    if (row.delete_after.getTime() > now.getTime()) {
      return mapPreviewItem(row, "skipped_not_due");
    }

    const counts = emptyCounts();
    avatarUrl = await readUserAvatarUrl(client, row.user_id);
    const identities = await readIdentityRows(client, row.user_id);

    counts.otpChallengesDeleted = await deleteOtpChallengesForIdentities(client, identities);
    counts.sessionsDeleted = await deleteByUserId(client, "sessions", row.user_id);
    counts.identitiesDeleted = await deleteByUserId(client, "user_identities", row.user_id);
    counts.notificationPreferencesDeleted = await deleteByUserId(client, "notification_preferences", row.user_id);
    counts.socialLinksDeleted = await deleteByUserId(client, "user_social_links", row.user_id);
    counts.feedbackDeleted = await deleteByUserId(client, "feedback", row.user_id);
    counts.commentLikesDeleted = await deleteByUserId(client, "market_comment_likes", row.user_id);
    counts.userFaucetStateDeleted = await deleteByUserId(client, "user_faucet_state", row.user_id);
    counts.followsDeleted = await deleteUserFollows(client, row.user_id);
    counts.profileViewsDeleted = await deleteUserProfileViews(client, row.user_id);
    counts.idempotencyRecordsDeleted = rowCount(await client.query(
      "delete from idempotency_records where actor_id = $1",
      [row.user_id]
    ));
    counts.commentsHidden = await hideUserComments(client, row.user_id);
    counts.communityContentHidden = await hideUserCommunityContent(client, row.user_id);
    counts.communityLikesDeleted = await deleteByUserId(client, "community_likes", row.user_id);
    counts.marketSavesDeleted = await deleteByUserId(client, "user_market_saves", row.user_id);

    await markUserErased(client, {
      userId: row.user_id,
      completedAtIso: nowIso
    });

    await client.query(
      `
        update account_deletion_requests
        set status = 'completed',
            completed_at = $2::timestamptz,
            updated_at = $2::timestamptz
        where id = $1
      `,
      [row.id, nowIso]
    );

    const auditEventId = await insertAuditEvent(client, {
      actorId,
      action: "user.account_deletion.complete",
      entityType: "user",
      entityId: row.user_id,
      payload: {
        requestId: row.id,
        completedAt: nowIso,
        counts
      }
    });

    return {
      requestId: row.id,
      userId: row.user_id,
      status: "completed" as const,
      scheduledAt: toIso(row.scheduled_at),
      deleteAfter: toIso(row.delete_after),
      completedAt: nowIso,
      auditEventId,
      counts
    };
  });

  if (result.status === "completed" && avatarUrl) {
    result.counts!.avatarFileDeleted = await deleteLocalAvatarFileForUrl(avatarUrl);
  }

  return result;
}

export async function sweepDueAccountDeletionErasures(
  pool: Pool,
  input?: {
    limit?: number;
    execute?: boolean;
    now?: Date;
    actorId?: string;
  }
): Promise<AccountDeletionErasureSweepResult> {
  const now = input?.now ?? new Date();
  const nowIso = now.toISOString();
  const limit = Math.min(Math.max(input?.limit ?? 50, 1), 500);
  const execute = input?.execute ?? false;
  const rows = await readDueDeletionRows(pool, {
    nowIso,
    limit
  });

  const items: AccountDeletionErasureItem[] = [];

  if (!execute) {
    for (const row of rows) {
      items.push(mapPreviewItem(row, "would_complete"));
    }
  } else {
    for (const row of rows) {
      items.push(await completeAccountDeletionErasure(pool, {
        requestId: row.id,
        now,
        actorId: input?.actorId
      }));
    }
  }

  return {
    objectType: "account_deletion_erasure_sweep",
    generatedAt: nowIso,
    execute,
    scannedCount: rows.length,
    completedCount: items.filter((item) => item.status === "completed").length,
    skippedCount: items.filter((item) => item.status.startsWith("skipped")).length,
    items
  };
}
