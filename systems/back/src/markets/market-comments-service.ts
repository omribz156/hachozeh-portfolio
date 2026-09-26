import { randomUUID } from "node:crypto";

import type { Queryable } from "../db/client/pool";
import { createReplyNotification } from "../notifications/notification-feed-service";
import { resolvePublicDisplayName } from "../shared/public-user-identity";
import { sanitizePublicAvatarUrl } from "../shared/public-avatar-url";
import {
  parseNullableStringField,
  parseObjectBody,
  parseRequiredStringField
} from "../shared/zod-request-body";
import { resolveMarketId, readMarketKey } from "./market-api/identity";
import { clampLimit } from "./market-api/normalizers";
import { buildAvatarLabel } from "./market-api/presenters";

const DEFAULT_COMMENT_LIMIT = 30;
const MAX_COMMENT_LIMIT = 100;

type MarketCommentTarget = {
  market_id: string;
  event_id: string | null;
  title: string | null;
};

type MarketCommentRow = {
  id: string;
  market_id: string;
  event_id: string | null;
  parent_comment_id: string | null;
  user_id: string;
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
  body: string;
  created_at: Date;
  like_count: string;
  viewer_liked: boolean;
};

type MarketCommentInsertRow = {
  id: string;
  market_id: string;
  event_id: string | null;
  parent_comment_id: string | null;
  body: string;
  created_at: Date;
};

type MarketCommentLikeRow = {
  like_count: string;
  viewer_liked: boolean;
};

type PublicComment = {
  id: string;
  marketId: string;
  eventId: string | null;
  parentCommentId: string | null;
  authorHandle: string | null;
  author: string;
  avatarLabel: string;
  avatarUrl: string | null;
  body: string;
  createdAt: string;
  postedAt: string;
  likes: number;
  likedByViewer: boolean;
  // True only when the request carries a signed-in viewer who authored this comment. The client
  // uses it to decide whether to offer "delete" (own comment) vs "report" (someone else's).
  isMine: boolean;
  replies: PublicComment[];
};

export class MarketCommentsServiceError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "MarketCommentsServiceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function createMarketCommentRequestError(message: string): MarketCommentsServiceError {
  return new MarketCommentsServiceError(400, "invalid_request", message);
}

function normalizeBody(value: string): string {
  const normalized = value.replace(/\r\n/g, "\n").trim();

  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)) {
    throw createMarketCommentRequestError("body cannot contain control characters.");
  }

  if (normalized.length < 2) {
    throw createMarketCommentRequestError("body must be at least 2 characters.");
  }

  if (normalized.length > 1200) {
    throw createMarketCommentRequestError("body must be 1200 characters or fewer.");
  }

  return normalized;
}

function normalizeEventId(value: string | null): string | null {
  const eventId = value?.trim() || null;

  if (!eventId) {
    return null;
  }

  if (!/^[a-zA-Z0-9_-]{2,160}$/.test(eventId)) {
    throw createMarketCommentRequestError("eventId is invalid.");
  }

  return eventId;
}

async function readCommentTarget(db: Queryable, marketKey: string): Promise<MarketCommentTarget | null> {
  const marketId = resolveMarketId(marketKey);
  const result = await db.query<MarketCommentTarget>(
    `
      select market_id, event_id, title
      from (
        select id as market_id, event_id, title, 0 as rank, close_at, published_at
        from markets
        where id = $1
        union all
        select id as market_id, event_id, title, 1 as rank, close_at, published_at
        from markets
        where event_id = $1
          and published_at is not null
      ) candidates
      order by rank asc, close_at asc, published_at asc nulls last, market_id asc
      limit 1
    `,
    [marketId]
  );

  return result.rows[0] ?? null;
}

function validateThreadEvent(target: MarketCommentTarget, eventId: string | null): string | null {
  if (!eventId) {
    return null;
  }

  if (target.event_id !== eventId) {
    throw createMarketCommentRequestError("eventId does not belong to this market.");
  }

  return eventId;
}

function formatPostedAt(createdAt: Date): string {
  return new Intl.DateTimeFormat("he-IL", {
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(createdAt);
}

function mapComment(row: MarketCommentRow, viewerUserId: string | null = null): PublicComment {
  const author = resolvePublicDisplayName(row.user_id, row.display_name, row.handle);

  return {
    id: row.id,
    marketId: row.market_id,
    eventId: row.event_id,
    parentCommentId: row.parent_comment_id,
    authorHandle: row.handle,
    author,
    avatarLabel: buildAvatarLabel(author),
    avatarUrl: sanitizePublicAvatarUrl(row.avatar_url),
    body: row.body,
    createdAt: row.created_at.toISOString(),
    postedAt: formatPostedAt(row.created_at),
    likes: Number.parseInt(row.like_count, 10) || 0,
    likedByViewer: row.viewer_liked,
    isMine: Boolean(viewerUserId) && row.user_id === viewerUserId,
    replies: []
  };
}

async function readVisibleCommentById(
  db: Queryable,
  commentId: string,
  viewerUserId: string | null
): Promise<PublicComment | null> {
  const result = await db.query<MarketCommentRow>(
    `
      select
        c.id,
        c.market_id,
        c.event_id,
        c.parent_comment_id,
        c.user_id,
        u.handle,
        u.display_name,
        u.avatar_url,
        c.body,
        c.created_at,
        coalesce(likes.like_count, 0)::text as like_count,
        exists (
          select 1
          from market_comment_likes viewer_like
          where viewer_like.comment_id = c.id
            and viewer_like.user_id = $2
        ) as viewer_liked
      from market_comments c
      left join users u
        on u.id = c.user_id
       and u.status = 'active'
       and u.privacy_erased_at is null
      left join lateral (
        select count(*)::int as like_count
        from market_comment_likes mcl
        where mcl.comment_id = c.id
      ) likes on true
      where c.id = $1
        and c.status = 'visible'
      limit 1
    `,
    [commentId, viewerUserId]
  );
  const row = result.rows[0];

  return row ? mapComment(row, viewerUserId) : null;
}

function buildThread(rows: MarketCommentRow[], viewerUserId: string | null = null): {
  comments: PublicComment[];
  counts: { total: number; replies: number };
} {
  const commentsById = new Map<string, PublicComment>();
  const topLevel: PublicComment[] = [];

  for (const row of rows) {
    const comment = mapComment(row, viewerUserId);
    commentsById.set(row.id, comment);
  }

  for (const row of rows) {
    const comment = commentsById.get(row.id);
    if (!comment) continue;

    if (row.parent_comment_id) {
      const parent = commentsById.get(row.parent_comment_id);
      if (parent) {
        parent.replies.push(comment);
      }
      continue;
    }

    topLevel.push(comment);
  }

  return {
    comments: topLevel,
    counts: {
      total: topLevel.length,
      replies: topLevel.reduce((count, comment) => count + comment.replies.length, 0)
    }
  };
}

export async function readMarketComments(
  db: Queryable,
  marketKey: string,
  options?: {
    limit?: string | null;
    cursor?: string | null;
    eventId?: string | null;
    viewerUserId?: string | null;
  }
) {
  const target = await readCommentTarget(db, marketKey);
  if (!target) {
    return null;
  }

  const eventId = validateThreadEvent(target, normalizeEventId(options?.eventId ?? null));
  const limit = clampLimit(options?.limit ?? null, DEFAULT_COMMENT_LIMIT, MAX_COMMENT_LIMIT);
  const cursor = options?.cursor?.trim() || null;
  const viewerUserId = options?.viewerUserId?.trim() || null;
  const result = await db.query<MarketCommentRow>(
    `
      with target as (
        select $1::text as market_id, $2::text as event_id
      ),
      top_level as (
        select c.*
        from market_comments c
        join target on true
        where c.status = 'visible'
          and c.parent_comment_id is null
          and ($4::text is null or c.id < $4)
          and (
            (target.event_id is not null and c.event_id = target.event_id)
            or (target.event_id is null and c.market_id = target.market_id and c.event_id is null)
          )
        order by c.created_at desc, c.id desc
        limit $3
      ),
      thread as (
        select * from top_level
        union all
        select child.*
        from market_comments child
        join top_level parent
          on parent.id = child.parent_comment_id
        where child.status = 'visible'
      )
      select
        thread.id,
        thread.market_id,
        thread.event_id,
        thread.parent_comment_id,
        thread.user_id,
        u.handle,
        u.display_name,
        u.avatar_url,
        thread.body,
        thread.created_at,
        coalesce(likes.like_count, 0)::text as like_count,
        exists (
          select 1
          from market_comment_likes viewer_like
          where viewer_like.comment_id = thread.id
            and viewer_like.user_id = $5
        ) as viewer_liked
      from thread
      left join users u
        on u.id = thread.user_id
       and u.status = 'active'
       and u.privacy_erased_at is null
      left join lateral (
        select count(*)::int as like_count
        from market_comment_likes mcl
        where mcl.comment_id = thread.id
      ) likes on true
      order by
        case when thread.parent_comment_id is null then thread.created_at end desc nulls last,
        coalesce(thread.parent_comment_id, thread.id) desc,
        thread.parent_comment_id nulls first,
        thread.created_at asc,
        thread.id asc
    `,
    [target.market_id, eventId, limit, cursor, viewerUserId]
  );

  const thread = buildThread(result.rows, viewerUserId);

  return {
    marketKey: readMarketKey(target.market_id),
    marketId: target.market_id,
    eventId,
    comments: thread.comments,
    counts: thread.counts,
    pagination: {
      limit,
      nextCursor: thread.comments.length === limit ? thread.comments.at(-1)?.id ?? null : null
    }
  };
}

function parseCommentBody(body: unknown): {
  body: string;
  eventId: string | null;
} {
  const parsed = parseObjectBody(
    body,
    "Request body must be a JSON object.",
    createMarketCommentRequestError
  );

  return {
    body: normalizeBody(parseRequiredStringField(parsed, "body", createMarketCommentRequestError)),
    eventId: normalizeEventId(parseNullableStringField(parsed, "eventId", createMarketCommentRequestError))
  };
}

async function assertParentCommentInThread(
  db: Queryable,
  parentCommentId: string,
  target: MarketCommentTarget,
  eventId: string | null
): Promise<{ parentAuthorId: string }> {
  const result = await db.query<{ id: string; user_id: string }>(
    `
      select id, user_id
      from market_comments
      where id = $1
        and parent_comment_id is null
        and status = 'visible'
        and (
          ($3::text is not null and event_id = $3)
          or ($3::text is null and market_id = $2 and event_id is null)
        )
      limit 1
    `,
    [parentCommentId, target.market_id, eventId]
  );

  const row = result.rows[0];
  if (!row) {
    throw new MarketCommentsServiceError(404, "comment_not_found", "Comment not found.");
  }
  return { parentAuthorId: row.user_id };
}

export async function createMarketComment(
  db: Queryable,
  marketKey: string,
  userId: string,
  body: unknown,
  options?: {
    parentCommentId?: string | null;
  }
) {
  const target = await readCommentTarget(db, marketKey);
  if (!target) {
    return null;
  }

  const parsed = parseCommentBody(body);
  const eventId = validateThreadEvent(target, parsed.eventId);
  const parentCommentId = options?.parentCommentId?.trim() || null;

  let parentAuthorId: string | null = null;
  if (parentCommentId) {
    ({ parentAuthorId } = await assertParentCommentInThread(db, parentCommentId, target, eventId));
  }

  const commentId = `comment_${randomUUID()}`;
  const result = await db.query<MarketCommentInsertRow>(
    `
      insert into market_comments (
        id,
        market_id,
        event_id,
        parent_comment_id,
        user_id,
        body,
        status,
        created_at,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, 'visible', now(), now())
      returning id, market_id, event_id, parent_comment_id, body, created_at
    `,
    [commentId, target.market_id, eventId, parentCommentId, userId, parsed.body]
  );
  const row = result.rows[0];

  // Notify the parent author of a reply (best-effort; never blocks/fails the
  // comment write). Self-replies and 'comments'-opted-out users are skipped
  // inside createReplyNotification.
  if (parentCommentId && parentAuthorId) {
    void createReplyNotification(db, {
      replyCommentId: row?.id ?? commentId,
      recipientUserId: parentAuthorId,
      actorUserId: userId,
      marketId: target.market_id,
      marketTitle: target.title ?? null
    }).catch(() => {});
  }

  const comment = await readVisibleCommentById(db, row?.id ?? commentId, userId);

  return {
    ok: true,
    comment: comment ?? {
      id: row?.id ?? commentId,
      marketId: row?.market_id ?? target.market_id,
      eventId: row?.event_id ?? eventId,
      parentCommentId: row?.parent_comment_id ?? parentCommentId,
      authorHandle: null,
      author: resolvePublicDisplayName(userId, null),
      avatarLabel: buildAvatarLabel(resolvePublicDisplayName(userId, null)),
      avatarUrl: null,
      body: row?.body ?? parsed.body,
      createdAt: (row?.created_at ?? new Date()).toISOString(),
      postedAt: formatPostedAt(row?.created_at ?? new Date()),
      likes: 0,
      likedByViewer: false,
      isMine: true,
      replies: []
    }
  };
}

export async function likeMarketComment(
  db: Queryable,
  marketKey: string,
  userId: string,
  commentId: string,
  options?: {
    eventId?: string | null;
  }
) {
  const target = await readCommentTarget(db, marketKey);
  if (!target) {
    return null;
  }

  const eventId = validateThreadEvent(target, normalizeEventId(options?.eventId ?? null));
  const existing = await db.query<{ id: string }>(
    `
      select id
      from market_comments
      where id = $1
        and status = 'visible'
        and (
          ($3::text is not null and event_id = $3)
          or ($3::text is null and market_id = $2 and event_id is null)
        )
      limit 1
    `,
    [commentId, target.market_id, eventId]
  );

  if (!existing.rows[0]) {
    throw new MarketCommentsServiceError(404, "comment_not_found", "Comment not found.");
  }

  // Toggle: a second tap removes the like (this is the unlike path the endpoint
  // was missing — it used to be insert-only, so liking was permanent).
  const removed = await db.query<{ comment_id: string }>(
    `
      delete from market_comment_likes
      where comment_id = $1 and user_id = $2
      returning comment_id
    `,
    [commentId, userId]
  );
  if (removed.rowCount === 0) {
    await db.query(
      `
        insert into market_comment_likes (comment_id, user_id, created_at)
        values ($1, $2, now())
        on conflict (comment_id, user_id) do nothing
      `,
      [commentId, userId]
    );
  }

  const result = await db.query<MarketCommentLikeRow>(
    `
      select
        count(*)::text as like_count,
        exists (
          select 1
          from market_comment_likes
          where comment_id = $1
            and user_id = $2
        ) as viewer_liked
      from market_comment_likes
      where comment_id = $1
    `,
    [commentId, userId]
  );
  const row = result.rows[0];

  return {
    ok: true,
    commentId,
    likes: Number.parseInt(row?.like_count ?? "0", 10) || 0,
    likedByViewer: row?.viewer_liked ?? false
  };
}

const MODERATION_STATUSES = ["visible", "hidden", "deleted"] as const;
type CommentModerationStatus = (typeof MODERATION_STATUSES)[number];

function parseReportReason(body: unknown): string | null {
  // Reason is optional; an empty/absent body is a valid "report with no note".
  if (typeof body === "undefined" || body === null) {
    return null;
  }
  const parsed = parseObjectBody(body, "Request body must be a JSON object.", createMarketCommentRequestError);
  const reason = parseNullableStringField(parsed, "reason", createMarketCommentRequestError);
  const trimmed = reason?.trim() || null;
  if (trimmed && trimmed.length > 280) {
    throw createMarketCommentRequestError("reason must be 280 characters or fewer.");
  }
  return trimmed;
}

// Signed-in user reports another user's comment. Lands in the feedback inbox as type 'report' so
// the operator can review and (via setMarketCommentModerationStatus) hide/delete. Notice half of
// the notice-and-action takedown lever.
export async function reportMarketComment(
  db: Queryable,
  marketKey: string,
  reporterUserId: string,
  commentId: string,
  body: unknown
) {
  const reason = parseReportReason(body);

  const existing = await db.query<{ id: string; user_id: string; body: string }>(
    `select id, user_id, body from market_comments where id = $1 and status = 'visible' limit 1`,
    [commentId]
  );
  const comment = existing.rows[0];
  if (!comment) {
    throw new MarketCommentsServiceError(404, "comment_not_found", "Comment not found.");
  }

  const snippet = comment.body.length > 600 ? `${comment.body.slice(0, 600)}…` : comment.body;
  const message = [
    `דיווח על תגובה (${commentId}) בשוק ${marketKey}.`,
    `מזהה מחבר/ת: ${comment.user_id}`,
    `תוכן התגובה: ${snippet}`,
    `סיבת הדיווח: ${reason ?? "—"}`
  ].join("\n");

  await db.query(
    `
      insert into feedback (id, user_id, type, title, message, reply_email, status, created_at, updated_at)
      values ($1, $2, 'report', $3, $4, null, 'new', now(), now())
    `,
    [`feedback_${randomUUID()}`, reporterUserId, "דיווח על תגובה", message]
  );

  return { ok: true as const };
}

// Author deletes their own comment. Soft-delete (status='deleted' + tombstone body) so any reply
// thread structure stays intact while the content disappears from every read (reads filter to
// status='visible'). Returns 404 for a missing comment OR one the caller does not own — the same
// response either way so it cannot be used to probe authorship of other users' comments.
export async function deleteOwnMarketComment(
  db: Queryable,
  userId: string,
  commentId: string
) {
  const result = await db.query<{ id: string }>(
    `
      update market_comments
      set status = 'deleted', body = '[הוסר]', updated_at = now()
      where id = $1 and user_id = $2 and status <> 'deleted'
      returning id
    `,
    [commentId, userId]
  );

  if (!result.rows[0]) {
    throw new MarketCommentsServiceError(404, "comment_not_found", "Comment not found.");
  }

  return { ok: true as const, commentId };
}

// Operator moderation: hide, delete, or restore (visible) any comment. The action half of the
// notice-and-action takedown lever. Authorization is enforced at the route (admin actor).
export async function setMarketCommentModerationStatus(
  db: Queryable,
  commentId: string,
  status: string
) {
  if (!(MODERATION_STATUSES as readonly string[]).includes(status)) {
    throw createMarketCommentRequestError("status must be visible, hidden, or deleted.");
  }

  const result = await db.query<{ id: string }>(
    `update market_comments set status = $2, updated_at = now() where id = $1 returning id`,
    [commentId, status]
  );

  if (!result.rows[0]) {
    throw new MarketCommentsServiceError(404, "comment_not_found", "Comment not found.");
  }

  return { ok: true as const, commentId, status: status as CommentModerationStatus };
}
