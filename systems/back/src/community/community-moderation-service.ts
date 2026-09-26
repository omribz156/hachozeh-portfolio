import { randomUUID } from "node:crypto";

import type { Queryable } from "../db/client/pool";
import { parseNullableStringField, parseObjectBody } from "../shared/zod-request-body";
import { CommunityServiceError } from "./community-service";

// Notice-and-action for the community surface, mirroring the market-comment
// levers: any signed-in user can REPORT content (lands in the feedback inbox for
// an operator), and an author can DELETE their own. Deletes are soft (tombstone)
// so reply structure survives while the content leaves every read.

export type CommunityEntityKind = "discussion" | "comment" | "post";

const TABLES: Record<CommunityEntityKind, string> = {
  discussion: "community_discussions",
  comment: "community_comments",
  post: "community_posts"
};

const LABELS: Record<CommunityEntityKind, string> = {
  discussion: "דיון",
  comment: "תגובה",
  post: "פוסט"
};

const DELETED_BODY = "[הוסר]";

export function normalizeEntityKind(value: string): CommunityEntityKind {
  if (value === "discussion" || value === "comment" || value === "post") return value;
  throw new CommunityServiceError(400, "invalid_request", "kind must be discussion, comment or post.");
}

function parseReportReason(body: unknown): string | null {
  if (typeof body === "undefined" || body === null) return null;
  const parsed = parseObjectBody(
    body,
    "Request body must be a JSON object.",
    (m) => new CommunityServiceError(400, "invalid_request", m)
  );
  const reason = parseNullableStringField(
    parsed,
    "reason",
    (m) => new CommunityServiceError(400, "invalid_request", m)
  );
  const trimmed = reason?.trim() || null;
  if (trimmed && trimmed.length > 280) {
    throw new CommunityServiceError(400, "invalid_request", "reason must be 280 characters or fewer.");
  }
  return trimmed;
}

// Signed-in user reports someone else's community content. Notice half of the
// notice-and-action lever; the operator acts via the feedback inbox.
export async function reportCommunityEntity(
  db: Queryable,
  reporterUserId: string,
  kind: CommunityEntityKind,
  entityId: string,
  body: unknown
) {
  const reason = parseReportReason(body);
  const table = TABLES[kind];
  const existing = await db.query<{ id: string; user_id: string; body: string }>(
    `select id, user_id, body from ${table} where id = $1 and status = 'visible' limit 1`,
    [entityId]
  );
  const row = existing.rows[0];
  if (!row) {
    throw new CommunityServiceError(404, "not_found", "Content not found.");
  }

  const snippet = row.body.length > 600 ? `${row.body.slice(0, 600)}…` : row.body;
  const message = [
    `דיווח על ${LABELS[kind]} בקהילה (${entityId}).`,
    `מזהה מחבר/ת: ${row.user_id}`,
    `תוכן: ${snippet}`,
    `סיבת הדיווח: ${reason ?? "—"}`
  ].join("\n");

  await db.query(
    `
      insert into feedback (id, user_id, type, title, message, reply_email, status, created_at, updated_at)
      values ($1, $2, 'report', $3, $4, null, 'new', now(), now())
    `,
    [`feedback_${randomUUID()}`, reporterUserId, `דיווח על ${LABELS[kind]} בקהילה`, message]
  );

  return { ok: true as const };
}

// Author deletes their own content. Soft-delete + tombstone. Returns 404 for a
// missing entity OR one the caller does not own — same response either way, so it
// can't be used to probe authorship.
export async function deleteOwnCommunityEntity(
  db: Queryable,
  userId: string,
  kind: CommunityEntityKind,
  entityId: string
) {
  const table = TABLES[kind];
  const result = await db.query<{ id: string }>(
    `
      update ${table}
      set status = 'deleted', body = $3, updated_at = now()
      where id = $1 and user_id = $2 and status <> 'deleted'
      returning id
    `,
    [entityId, userId, DELETED_BODY]
  );
  if (!result.rows[0]) {
    throw new CommunityServiceError(404, "not_found", "Content not found.");
  }
  return { ok: true as const, id: entityId, kind };
}
