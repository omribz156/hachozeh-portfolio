import { randomUUID } from "node:crypto";

import type { Queryable } from "../db/client/pool";
import { readMarketKey } from "../markets/market-api/identity";
import { clampLimit } from "../markets/market-api/normalizers";
import { readMarketCategoryMeta } from "../shared/market-category";
import { formatPublicVolumeLabel } from "../shared/public-volume";
import { resolvePublicDisplayName } from "../shared/public-user-identity";
import { sanitizePublicAvatarUrl } from "../shared/public-avatar-url";
import {
  parseNullableStringField,
  parseObjectBody,
  parseRequiredStringField
} from "../shared/zod-request-body";
import {
  MAX_DISCUSSION_BODY,
  MAX_DISCUSSION_TITLE,
  buildAuthorTint,
  initialOf,
  posChipFor,
  relativeTimeLabel,
  topicForCategoryLabel,
  type CommunityPosChip
} from "./community-shared";
import { readEventRefs, resolveCommunitySubject, type EventRef } from "./community-subjects";
import { readLikeStates } from "./community-likes-service";

const DEFAULT_DISCUSSION_LIMIT = 20;
const MAX_DISCUSSION_LIMIT = 50;
const DEFAULT_COMMENT_LIMIT = 40;
const MAX_COMMENT_LIMIT = 200;
const MAX_COMMENT_LIMIT_CHARS = 1200;

export class CommunityServiceError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "CommunityServiceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function invalid(message: string): CommunityServiceError {
  return new CommunityServiceError(400, "invalid_request", message);
}

function normalizeBody(value: string, max: number): string {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)) {
    throw invalid("body cannot contain control characters.");
  }
  if (normalized.length < 2) {
    throw invalid("body must be at least 2 characters.");
  }
  if (normalized.length > max) {
    throw invalid(`body must be ${max} characters or fewer.`);
  }
  return normalized;
}

function normalizeTitle(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length < 2) {
    throw invalid("title must be at least 2 characters.");
  }
  if (normalized.length > MAX_DISCUSSION_TITLE) {
    throw invalid(`title must be ${MAX_DISCUSSION_TITLE} characters or fewer.`);
  }
  return normalized;
}

// ── shared row → author shape ────────────────────────────────────────────────
type AuthorRow = {
  user_id: string;
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
  verified_tier: "gray" | "gold" | "diamond" | null;
};

// The seed shows a `seal` string ('verified' | 'workspace_premium'); map the real
// verification tier onto it so the island's badge renders unchanged.
function sealForTier(tier: AuthorRow["verified_tier"]): string | null {
  if (tier === "diamond" || tier === "gold") return "verified";
  if (tier === "gray") return "workspace_premium";
  return null;
}

function buildAuthor(row: AuthorRow) {
  const name = resolvePublicDisplayName(row.user_id, row.display_name, row.handle);
  return {
    userId: row.user_id,
    handle: row.handle,
    name,
    tint: buildAuthorTint(row.user_id),
    initial: initialOf(name),
    avatarUrl: sanitizePublicAvatarUrl(row.avatar_url),
    seal: sealForTier(row.verified_tier)
  };
}

// ── market ref (probability + category + short title) ────────────────────────
type MarketRefRow = {
  market_id: string;
  title: string;
  category_key: string | null;
  status: string;
  close_at: Date;
  total_volume: string | null;
  top_price: string | null;
  holders: string | null;
  event_slug: string | null;
};

// A CHILD market reference links to its own /markets/<key> page — never the
// parent event (markets and events are distinct subjects; don't conflate them).
// Event subjects carry their own /event/<slug> href, built separately.
function marketRefHref(marketId: string): string {
  return `/markets/${encodeURIComponent(readMarketKey(marketId))}`;
}

// The subject a discussion/post is about — a child market or a parent event —
// shaped as the `market` display object the island renders, tagged with `kind`.
function buildMarketSubject(marketId: string, ref: MarketRefRow | undefined) {
  return {
    kind: "market" as const,
    marketKey: readMarketKey(marketId),
    href: marketRefHref(marketId),
    short: ref?.title ?? "שוק",
    cat: ref ? shortMarketLabel(ref) : "שוק",
    pp: ref ? marketProbPct(ref) : 50,
    mv: { dir: "flat", val: "—" }
  };
}
function buildEventSubject(ref: EventRef | undefined, fallbackTitle: string) {
  return {
    kind: "event" as const,
    marketKey: null,
    eventSlug: ref?.slug ?? null,
    href: ref ? `/event/${encodeURIComponent(ref.slug)}` : "#",
    short: ref?.title ?? fallbackTitle,
    cat: ref?.categoryLabel ?? "אירוע",
    pp: ref?.prob ?? null,
    candidates: ref?.candidates ?? 0,
    mv: { dir: "flat", val: "—" }
  };
}

function marketProbPct(row: MarketRefRow): number {
  const p = Number(row.top_price);
  return Number.isFinite(p) ? Math.round(p * 100) : 50;
}

function shortMarketLabel(row: MarketRefRow): string {
  const meta = readMarketCategoryMeta(row.category_key);
  return meta?.label ?? row.title;
}

function formatCloseLabel(closeAt: Date): string {
  return new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "short" }).format(closeAt);
}

async function readMarketRefs(db: Queryable, marketIds: string[]): Promise<Map<string, MarketRefRow>> {
  const map = new Map<string, MarketRefRow>();
  if (marketIds.length === 0) return map;
  const result = await db.query<MarketRefRow>(
    `
      select
        m.id as market_id,
        m.title,
        m.category_key,
        m.status,
        m.close_at,
        ps.total_volume::text as total_volume,
        op.top_price,
        holders.holders::text as holders,
        ev.slug as event_slug
      from markets m
      left join events ev on ev.id = m.event_id
      left join market_pricing_state ps on ps.market_id = m.id
      left join lateral (
        select max(last_price)::text as top_price
        from market_outcome_state os
        where os.market_id = m.id
      ) op on true
      left join lateral (
        select count(distinct user_id) as holders
        from contract_positions cp
        where cp.market_id = m.id and cp.shares > 0
      ) holders on true
      where m.id = any($1::text[])
    `,
    [marketIds]
  );
  for (const row of result.rows) map.set(row.market_id, row);
  return map;
}

// Author's live position on a market → the "מחזיק · כן/לא" chip (auto-derived,
// never user-typed). Keyed by `${userId}::${marketId}`.
async function readPositionChips(
  db: Queryable,
  pairs: Array<{ userId: string; marketId: string }>
): Promise<Map<string, CommunityPosChip>> {
  const map = new Map<string, CommunityPosChip>();
  if (pairs.length === 0) return map;
  const userIds = [...new Set(pairs.map((p) => p.userId))];
  const marketIds = [...new Set(pairs.map((p) => p.marketId))];
  const result = await db.query<{ user_id: string; market_id: string; contract_side: string }>(
    `
      select distinct on (user_id, market_id) user_id, market_id, contract_side
      from contract_positions
      where user_id = any($1::text[])
        and market_id = any($2::text[])
        and shares > 0
      order by user_id, market_id, last_trade_at desc nulls last
    `,
    [userIds, marketIds]
  );
  for (const row of result.rows) {
    map.set(`${row.user_id}::${row.market_id}`, posChipFor(row.contract_side));
  }
  return map;
}


// Avatar stack per discussion: the distinct people talking in it (most recent
// first, capped). This is what makes "I commented → my pic shows on the feed"
// true on the home list.
async function readDiscussionStacks(
  db: Queryable,
  discussionIds: string[]
): Promise<Map<string, Array<{ name: string; tint: string; initial: string; avatarUrl: string | null }>>> {
  const map = new Map<string, Array<{ name: string; tint: string; initial: string; avatarUrl: string | null }>>();
  if (discussionIds.length === 0) return map;
  const r = await db.query<AuthorRow & { discussion_id: string; last_at: Date }>(
    `
      select x.discussion_id, x.user_id, max(x.created_at) as last_at,
        u.handle, u.display_name, u.avatar_url, null::text as verified_tier
      from community_comments x
      join users u on u.id = x.user_id and u.status = 'active' and u.privacy_erased_at is null
      where x.discussion_id = any($1::text[]) and x.status = 'visible'
      group by x.discussion_id, x.user_id, u.handle, u.display_name, u.avatar_url
      order by max(x.created_at) desc
    `,
    [discussionIds]
  );
  for (const row of r.rows) {
    const list = map.get(row.discussion_id) ?? [];
    if (list.length >= 4) continue; // stack caps at 4 faces
    const a = buildAuthor(row);
    list.push({ name: a.name, tint: a.tint, initial: a.initial, avatarUrl: a.avatarUrl });
    map.set(row.discussion_id, list);
  }
  return map;
}

// ── discussions list (home דיונים view) ──────────────────────────────────────
type DiscussionListRow = AuthorRow & {
  id: string;
  market_id: string | null;
  event_id: string | null;
  topic: string | null;
  title: string;
  body: string;
  created_at: Date;
  last_activity_at: Date;
  reply_count: string;
};

export async function readCommunityDiscussions(
  db: Queryable,
  options?: {
    topic?: string | null;
    sort?: string | null;
    limit?: string | null;
    cursor?: string | null;
    viewerUserId?: string | null;
  }
) {
  const topic = options?.topic?.trim() || null;
  const sort = options?.sort === "new" ? "new" : "active";
  const limit = clampLimit(options?.limit ?? null, DEFAULT_DISCUSSION_LIMIT, MAX_DISCUSSION_LIMIT);
  const cursor = options?.cursor?.trim() || null;
  const viewerUserId = options?.viewerUserId?.trim() || null;
  const orderColumn = sort === "new" ? "d.created_at" : "d.last_activity_at";

  const result = await db.query<DiscussionListRow>(
    `
      select
        d.id, d.market_id, d.event_id, d.topic, d.title, d.body, d.created_at, d.last_activity_at,
        d.user_id, u.handle, u.display_name, u.avatar_url, ver.tier as verified_tier,
        coalesce(rc.reply_count, 0)::text as reply_count
      from community_discussions d
      left join users u on u.id = d.user_id and u.status = 'active' and u.privacy_erased_at is null
      left join lateral (
        select tier from user_verification_tier_purchases v
        where v.user_id = d.user_id order by v.purchased_at desc limit 1
      ) ver on true
      left join lateral (
        select count(*) as reply_count from community_comments c
        where c.discussion_id = d.id and c.status = 'visible'
      ) rc on true
      where d.status = 'visible'
        and ($1::text is null or d.topic = $1)
        and ($2::text is null or ${orderColumn} < (select ${orderColumn.replace("d.", "")} from community_discussions where id = $2))
      order by ${orderColumn} desc, d.id desc
      limit $3
    `,
    [topic, cursor, limit]
  );

  const rows = result.rows;
  const marketIds = [...new Set(rows.map((r) => r.market_id).filter((id): id is string => Boolean(id)))];
  const eventIds = [...new Set(rows.map((r) => r.event_id).filter((id): id is string => Boolean(id)))];
  const marketPairs = rows
    .filter((r) => r.market_id)
    .map((r) => ({ userId: r.user_id, marketId: r.market_id as string }));
  const [marketRefs, eventRefs, posChips, stacks] = await Promise.all([
    readMarketRefs(db, marketIds),
    readEventRefs(db, eventIds),
    readPositionChips(db, marketPairs),
    readDiscussionStacks(db, rows.map((r) => r.id))
  ]);

  const discussions = rows.map((row) => {
    const author = buildAuthor(row);
    const subject = row.event_id
      ? buildEventSubject(eventRefs.get(row.event_id), row.title)
      : buildMarketSubject(row.market_id as string, marketRefs.get(row.market_id as string));
    return {
      id: row.id,
      topic: row.topic,
      cat: subject.cat,
      market: subject,
      title: row.title,
      take: [row.body],
      author: { name: author.name, tint: author.tint, initial: author.initial, seal: author.seal, avatarUrl: author.avatarUrl },
      // Position chip only applies to a child-market subject (a held side); events
      // have no single position.
      posChip: row.market_id ? posChips.get(`${row.user_id}::${row.market_id}`) ?? null : null,
      time: relativeTimeLabel(row.created_at),
      stack: stacks.get(row.id) ?? [],
      isMine: Boolean(viewerUserId) && row.user_id === viewerUserId,
      replies: Number.parseInt(row.reply_count, 10) || 0
    };
  });

  return {
    discussions,
    pagination: {
      limit,
      nextCursor: discussions.length === limit ? discussions.at(-1)?.id ?? null : null
    }
  };
}

// ── thread detail (/community/t/:id) ─────────────────────────────────────────
type ThreadCommentRow = AuthorRow & {
  id: string;
  parent_comment_id: string | null;
  body: string;
  created_at: Date;
  market_id: string | null;
};

export async function readCommunityDiscussion(
  db: Queryable,
  discussionId: string,
  viewerUserId: string | null = null
) {
  const headResult = await db.query<DiscussionListRow>(
    `
      select
        d.id, d.market_id, d.event_id, d.topic, d.title, d.body, d.created_at, d.last_activity_at,
        d.user_id, u.handle, u.display_name, u.avatar_url, ver.tier as verified_tier,
        '0' as reply_count
      from community_discussions d
      left join users u on u.id = d.user_id and u.status = 'active' and u.privacy_erased_at is null
      left join lateral (
        select tier from user_verification_tier_purchases v
        where v.user_id = d.user_id order by v.purchased_at desc limit 1
      ) ver on true
      where d.id = $1 and d.status = 'visible'
      limit 1
    `,
    [discussionId]
  );
  const head = headResult.rows[0];
  if (!head) return null;

  const commentsResult = await db.query<ThreadCommentRow>(
    `
      select
        c.id, c.parent_comment_id, c.body, c.created_at, d.market_id,
        c.user_id, u.handle, u.display_name, u.avatar_url, ver.tier as verified_tier
      from community_comments c
      join community_discussions d on d.id = c.discussion_id
      left join users u on u.id = c.user_id and u.status = 'active' and u.privacy_erased_at is null
      left join lateral (
        select tier from user_verification_tier_purchases v
        where v.user_id = c.user_id order by v.purchased_at desc limit 1
      ) ver on true
      where c.discussion_id = $1 and c.status = 'visible'
      order by c.created_at asc, c.id asc
    `,
    [discussionId]
  );

  // Real like counts + viewer-liked for the opening post + every comment/reply.
  const likeStates = await readLikeStates(
    db,
    [head.id, ...commentsResult.rows.map((c) => c.id)],
    viewerUserId
  );

  const isEvent = Boolean(head.event_id);
  const marketRefs = head.market_id ? await readMarketRefs(db, [head.market_id]) : new Map<string, MarketRefRow>();
  const market = head.market_id ? marketRefs.get(head.market_id) : undefined;
  const eventRefs = head.event_id ? await readEventRefs(db, [head.event_id]) : new Map<string, EventRef>();
  const event = head.event_id ? eventRefs.get(head.event_id) : undefined;

  // Position chips apply only to a child-market subject (a held side); an event
  // has no single position.
  const posChips = head.market_id
    ? await readPositionChips(db, [
        { userId: head.user_id, marketId: head.market_id },
        ...commentsResult.rows.map((c) => ({ userId: c.user_id, marketId: head.market_id as string }))
      ])
    : new Map<string, CommunityPosChip>();

  const openingAuthor = buildAuthor(head);
  const categoryLabel = isEvent ? event?.categoryLabel ?? "אירוע" : market ? shortMarketLabel(market) : (head.topic ?? "שווקים");
  const closing = market ? market.close_at.getTime() - Date.now() <= 1000 * 60 * 60 * 24 * 7 && market.status === "open" : false;

  // Build one-level comment tree from the flat, chronologically-ordered rows.
  const byId = new Map<string, ReturnType<typeof buildThreadComment>>();
  const topLevel: ReturnType<typeof buildThreadComment>[] = [];
  const participantIds = new Set<string>([head.user_id]);

  function buildThreadComment(row: ThreadCommentRow) {
    const author = buildAuthor(row);
    return {
      id: row.id,
      parentId: row.parent_comment_id,
      author: { name: author.name, tint: author.tint, initial: author.initial, seal: author.seal, avatarUrl: author.avatarUrl },
      posChip: posChips.get(`${row.user_id}::${head!.market_id}`) ?? null,
      opTag: row.user_id === head!.user_id,
      time: relativeTimeLabel(row.created_at),
      body: [row.body],
      likes: 0,
      comments: 0,
      isMine: Boolean(viewerUserId) && row.user_id === viewerUserId,
      replies: [] as Array<Record<string, unknown>>
    };
  }

  for (const row of commentsResult.rows) {
    const node = buildThreadComment(row);
    byId.set(row.id, node);
    participantIds.add(row.user_id);
  }
  for (const row of commentsResult.rows) {
    const node = byId.get(row.id);
    if (!node) continue;
    if (row.parent_comment_id && byId.has(row.parent_comment_id)) {
      const parent = byId.get(row.parent_comment_id)!;
      parent.replies.push({
        id: node.id,
        author: node.author,
        opTag: node.opTag,
        time: node.time,
        body: node.body,
        likes: likeStates.get(node.id)?.count ?? 0,
        liked: likeStates.get(node.id)?.liked ?? false,
        isMine: node.isMine
      });
      parent.comments += 1;
    } else {
      topLevel.push(node);
    }
  }

  const participants = await readParticipants(db, [...participantIds]);

  // Does the viewer already follow the opening author? (seeds the Follow button)
  const openingIsMine = Boolean(viewerUserId) && head.user_id === viewerUserId;
  let viewerFollowsOpening = false;
  if (viewerUserId && !openingIsMine) {
    const f = await db.query<{ one: number }>(
      `select 1 as one from user_follows where follower_user_id = $1 and followed_user_id = $2 limit 1`,
      [viewerUserId, head.user_id]
    );
    viewerFollowsOpening = (f.rowCount ?? 0) > 0;
  }

  return {
    id: head.id,
    topic: head.topic,
    market: {
      kind: isEvent ? "event" : "market",
      ctxCat: categoryLabel,
      heat: closing,
      short: isEvent ? event?.title ?? head.title : market?.title ?? head.title,
      pp: isEvent ? event?.prob ?? null : market ? marketProbPct(market) : 50,
      mv: { dir: "flat", val: "—" },
      title: isEvent ? event?.title ?? head.title : market?.title ?? head.title,
      prob: isEvent ? event?.prob ?? null : market ? marketProbPct(market) : 50,
      chip: isEvent ? `אירוע · ${event?.candidates ?? 0} שווקים` : null,
      volume: market ? formatPublicVolumeLabel(market.total_volume ?? 0) : null,
      holders: market?.holders ?? "0",
      close: market ? formatCloseLabel(market.close_at) : "",
      closing,
      candidates: isEvent ? event?.candidates ?? 0 : undefined,
      marketKey: head.market_id ? readMarketKey(head.market_id) : null,
      href: isEvent ? (event ? `/event/${encodeURIComponent(event.slug)}` : "#") : marketRefHref(head.market_id as string)
    },
    opening: {
      id: head.id,
      q: head.title,
      author: {
        handle: openingAuthor.handle,
        name: openingAuthor.name,
        tint: openingAuthor.tint,
        initial: openingAuthor.initial,
        avatarUrl: openingAuthor.avatarUrl,
        sub: relativeTimeLabel(head.created_at)
      },
      isMine: openingIsMine,
      viewerFollows: viewerFollowsOpening,
      posChip: head.market_id ? posChips.get(`${head.user_id}::${head.market_id}`) ?? null : null,
      body: [[head.body]],
      likes: likeStates.get(head.id)?.count ?? 0,
      liked: likeStates.get(head.id)?.liked ?? false,
      comments: topLevel.reduce((n, c) => n + 1 + c.replies.length, 0)
    },
    comments: topLevel.map((c) => ({
      id: c.id,
      author: c.author,
      posChip: c.posChip,
      time: c.time,
      body: c.body,
      comments: c.comments,
      likes: likeStates.get(c.id)?.count ?? 0,
      liked: likeStates.get(c.id)?.liked ?? false,
      isMine: c.isMine,
      replies: c.replies
    })),
    loadMore: null,
    participants,
    isMine: Boolean(viewerUserId) && head.user_id === viewerUserId
  };
}

// ── participants / suggested-voices helper (accuracy-ranked) ─────────────────
type ParticipantRow = AuthorRow & { category_key: string | null; accuracy: number | null };

async function readParticipants(db: Queryable, userIds: string[]) {
  if (userIds.length === 0) return [];
  const result = await db.query<ParticipantRow>(
    `
      select
        u.id as user_id, u.handle, u.display_name, u.avatar_url, ver.tier as verified_tier,
        null::text as category_key,
        stats.accuracy
      from users u
      left join lateral (
        select tier from user_verification_tier_purchases v
        where v.user_id = u.id order by v.purchased_at desc limit 1
      ) ver on true
      left join lateral (
        select case when count(*) > 0
          then round(count(*) filter (where type = 'resolution_win')::numeric / count(*), 4)
          else null end as accuracy
        from realization_events re
        where re.user_id = u.id and re.type in ('resolution_win', 'resolution_loss')
      ) stats on true
      where u.id = any($1::text[]) and u.status = 'active' and u.privacy_erased_at is null
    `,
    [userIds]
  );
  return result.rows.map((row) => {
    const author = buildAuthor(row);
    return {
      name: author.name,
      tint: author.tint,
      initial: author.initial,
      seal: author.seal,
      avatarUrl: author.avatarUrl,
      cat: null,
      accuracy: row.accuracy != null ? Math.round(Number(row.accuracy) * 100) : null
    };
  });
}

// ── create discussion ────────────────────────────────────────────────────────
// Read the picked subject from the request: {subjectKind:'market'|'event',
// subjectKey}. Back-compat: a bare {marketKey} is treated as a market subject.
function readSubjectInput(parsed: Record<string, unknown>): { kind: string; key: string } {
  const marketKey = parseNullableStringField(parsed, "marketKey", invalid)?.trim();
  if (marketKey) return { kind: "market", key: marketKey };
  const kind = parseRequiredStringField(parsed, "subjectKind", invalid).trim();
  const key = parseRequiredStringField(parsed, "subjectKey", invalid).trim();
  if (kind !== "market" && kind !== "event") {
    throw invalid("subjectKind must be 'market' or 'event'.");
  }
  return { kind, key };
}

export async function createCommunityDiscussion(db: Queryable, userId: string, body: unknown) {
  const parsed = parseObjectBody(body, "Request body must be a JSON object.", invalid);
  const subjectInput = readSubjectInput(parsed);
  const title = normalizeTitle(parseRequiredStringField(parsed, "title", invalid));
  const openingBody = normalizeBody(parseRequiredStringField(parsed, "body", invalid), MAX_DISCUSSION_BODY);

  const subject = await resolveCommunitySubject(db, subjectInput.kind, subjectInput.key);
  if (!subject) {
    throw new CommunityServiceError(404, "subject_not_found", "Market or event not found.");
  }

  const id = `discussion_${randomUUID()}`;
  await db.query(
    `
      insert into community_discussions
        (id, market_id, event_id, topic, title, body, user_id, status, created_at, updated_at, last_activity_at)
      values ($1, $2, $3, $4, $5, $6, $7, 'visible', now(), now(), now())
    `,
    [id, subject.marketId, subject.eventId, subject.topic, title, openingBody, userId]
  );

  const detail = await readCommunityDiscussion(db, id, userId);
  return { ok: true as const, id, discussion: detail };
}

// ── create comment (top-level or one-level reply) ────────────────────────────
export async function createCommunityComment(db: Queryable, userId: string, discussionId: string, body: unknown) {
  const parsed = parseObjectBody(body, "Request body must be a JSON object.", invalid);
  const commentBody = normalizeBody(parseRequiredStringField(parsed, "body", invalid), MAX_COMMENT_LIMIT_CHARS);
  const parentCommentId = parseNullableStringField(parsed, "parentCommentId", invalid)?.trim() || null;

  const discussion = await db.query<{ id: string }>(
    `select id from community_discussions where id = $1 and status = 'visible' limit 1`,
    [discussionId]
  );
  if (!discussion.rows[0]) {
    throw new CommunityServiceError(404, "discussion_not_found", "Discussion not found.");
  }

  // Enforce one-level replies: a parent must exist, belong to this discussion, and
  // itself be top-level (no nesting under a reply).
  if (parentCommentId) {
    const parent = await db.query<{ id: string }>(
      `
        select id from community_comments
        where id = $1 and discussion_id = $2 and parent_comment_id is null and status = 'visible'
        limit 1
      `,
      [parentCommentId, discussionId]
    );
    if (!parent.rows[0]) {
      throw new CommunityServiceError(404, "comment_not_found", "Parent comment not found.");
    }
  }

  const id = `ccomment_${randomUUID()}`;
  await db.query(
    `
      insert into community_comments
        (id, discussion_id, parent_comment_id, user_id, body, status, created_at, updated_at)
      values ($1, $2, $3, $4, $5, 'visible', now(), now())
    `,
    [id, discussionId, parentCommentId, userId, commentBody]
  );
  // Bump the discussion's activity clock so it floats up the "active" sort.
  await db.query(`update community_discussions set last_activity_at = now() where id = $1`, [discussionId]);

  return { ok: true as const, id, discussionId, parentCommentId };
}

// ── comments on ANY feed item (take/share/position/result) — flat, one level ──
// Keyed by the opaque feed id (community_posts.id / trades.id / realization id).
type PostCommentRow = AuthorRow & { id: string; body: string; created_at: Date };

// A feed id is real if it belongs to a visible authored post, a trade, or a
// resolution event. Cheap existence check that spans the projection's sources.
async function feedItemExists(db: Queryable, feedRef: string): Promise<boolean> {
  const r = await db.query<{ ok: boolean }>(
    `
      select (
        exists (select 1 from community_posts where id = $1 and status = 'visible')
        or exists (select 1 from trades where id = $1)
        or exists (select 1 from realization_events where id = $1)
      ) as ok
    `,
    [feedRef]
  );
  return r.rows[0]?.ok === true;
}

export async function readFeedComments(
  db: Queryable,
  feedRef: string,
  viewerUserId: string | null = null
) {
  if (!(await feedItemExists(db, feedRef))) return null;
  const r = await db.query<PostCommentRow>(
    `
      select c.id, c.body, c.created_at,
        c.user_id, u.handle, u.display_name, u.avatar_url, ver.tier as verified_tier
      from community_comments c
      left join users u on u.id = c.user_id and u.status = 'active' and u.privacy_erased_at is null
      left join lateral (
        select tier from user_verification_tier_purchases v
        where v.user_id = c.user_id order by v.purchased_at desc limit 1
      ) ver on true
      where c.feed_ref = $1 and c.parent_comment_id is null and c.status = 'visible'
      order by c.created_at asc, c.id asc
    `,
    [feedRef]
  );
  const comments = r.rows.map((row) => {
    const a = buildAuthor(row);
    return {
      id: row.id,
      author: { name: a.name, tint: a.tint, initial: a.initial, seal: a.seal, avatarUrl: a.avatarUrl },
      time: relativeTimeLabel(row.created_at),
      body: [row.body],
      likes: 0,
      isMine: Boolean(viewerUserId) && row.user_id === viewerUserId
    };
  });
  return { feedRef, comments };
}

export async function createFeedComment(
  db: Queryable,
  userId: string,
  feedRef: string,
  body: unknown
) {
  const parsed = parseObjectBody(body, "Request body must be a JSON object.", invalid);
  const commentBody = normalizeBody(parseRequiredStringField(parsed, "body", invalid), MAX_COMMENT_LIMIT_CHARS);
  if (!(await feedItemExists(db, feedRef))) {
    throw new CommunityServiceError(404, "feed_item_not_found", "Feed item not found.");
  }
  const id = `ccomment_${randomUUID()}`;
  await db.query(
    `
      insert into community_comments
        (id, discussion_id, feed_ref, parent_comment_id, user_id, body, status, created_at, updated_at)
      values ($1, null, $2, null, $3, $4, 'visible', now(), now())
    `,
    [id, feedRef, userId, commentBody]
  );
  return { ok: true as const, id, feedRef };
}

// Batch comment counts for any set of feed items. Keyed by feed id.
export async function readFeedCommentCounts(db: Queryable, feedRefs: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (feedRefs.length === 0) return map;
  const r = await db.query<{ feed_ref: string; n: string }>(
    `
      select feed_ref, count(*)::text as n
      from community_comments
      where feed_ref = any($1::text[]) and status = 'visible'
      group by feed_ref
    `,
    [feedRefs]
  );
  for (const row of r.rows) map.set(row.feed_ref, Number.parseInt(row.n, 10) || 0);
  return map;
}
