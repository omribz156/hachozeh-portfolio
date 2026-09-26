import { randomUUID } from "node:crypto";

import type { Queryable } from "../db/client/pool";
import { readMarketKey } from "../markets/market-api/identity";
import { clampLimit } from "../markets/market-api/normalizers";
import { readMarketCategoryMeta } from "../shared/market-category";
import { resolvePublicDisplayName } from "../shared/public-user-identity";
import { sanitizePublicAvatarUrl } from "../shared/public-avatar-url";
import { parseObjectBody, parseNullableStringField, parseRequiredStringField } from "../shared/zod-request-body";
import {
  MAX_POST_BODY,
  buildAuthorTint,
  initialOf,
  relativeTimeLabel,
  topicForCategoryLabel
} from "./community-shared";
import { readFeedCommentCounts } from "./community-service";
import { readEventRefs, resolveCommunitySubject, type EventRef } from "./community-subjects";
import { readLikeStates, type LikeState } from "./community-likes-service";
import {
  deriveMilestone,
  derivePosition,
  deriveResult,
  type MilestoneMeta,
  type PositionMeta,
  type ResultMeta
} from "./community-authored-derive";

const DEFAULT_FEED_LIMIT = 24;
const MAX_FEED_LIMIT = 50;

export class CommunityFeedError extends Error {
  readonly statusCode: number;
  readonly code: string;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "CommunityFeedError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function invalid(message: string): CommunityFeedError {
  return new CommunityFeedError(400, "invalid_request", message);
}

// ── keyset cursor: base64("<ISO ts>|<feed_id>") over the merged UNION ────────
function encodeCursor(ts: string, id: string): string {
  return Buffer.from(`${ts}|${id}`, "utf8").toString("base64url");
}
function decodeCursor(cursor: string | null): { ts: string; id: string } | null {
  if (!cursor) return null;
  try {
    const [ts, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    if (!ts || !id || Number.isNaN(Date.parse(ts))) return null;
    return { ts, id };
  } catch {
    return null;
  }
}

type FeedRow = {
  kind: "take" | "share" | "position" | "result" | "milestone";
  feed_id: string;
  feed_ts: Date;
  user_id: string;
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
  verified_tier: "gray" | "gold" | "diamond" | null;
  market_id: string | null;
  event_id: string | null;
  body: string | null;
  side: string | null; // trade side buy/sell (position)
  amount: string | null; // cash_amount (position)
  pnl: string | null; // realized_pnl (result)
  result_kind: string | null; // 'win' | 'loss'
  outcome_label: string | null;
  badge: string | null; // milestone
  icon: string | null; // milestone
};

type MarketMeta = { title: string; category_key: string | null; top_price: string | null; event_slug: string | null };

// Canonical href: the /event/<slug> grouping page when the market belongs to an
// event, else the individual /markets/<key> page.
function marketRefHref(marketId: string): string {
  return `/markets/${encodeURIComponent(readMarketKey(marketId))}`;
}

function sealForTier(tier: FeedRow["verified_tier"]): string | null {
  if (tier === "diamond" || tier === "gold") return "verified";
  if (tier === "gray") return "workspace_premium";
  return null;
}

function fmtAmount(value: string | null): string {
  const n = Math.round(Number(value ?? 0));
  return `${new Intl.NumberFormat("en-US").format(n)} V₪`;
}
function fmtPnl(value: string | null): string {
  const n = Math.round(Number(value ?? 0));
  return n >= 0 ? `+${new Intl.NumberFormat("en-US").format(n)}` : new Intl.NumberFormat("en-US").format(n);
}
function probPct(meta: MarketMeta | undefined): number {
  const p = Number(meta?.top_price);
  return Number.isFinite(p) ? Math.round(p * 100) : 50;
}
function catLabel(meta: MarketMeta | undefined): string {
  return readMarketCategoryMeta(meta?.category_key ?? null)?.label ?? "שווקים";
}

async function readMarketMeta(db: Queryable, ids: string[]): Promise<Map<string, MarketMeta>> {
  const map = new Map<string, MarketMeta>();
  if (ids.length === 0) return map;
  const r = await db.query<{ market_id: string; title: string; category_key: string | null; top_price: string | null; event_slug: string | null }>(
    `
      select m.id as market_id, m.title, m.category_key, ev.slug as event_slug,
        (select max(last_price)::text from market_outcome_state os where os.market_id = m.id) as top_price
      from markets m
      left join events ev on ev.id = m.event_id
      where m.id = any($1::text[])
    `,
    [ids]
  );
  for (const row of r.rows) map.set(row.market_id, row);
  return map;
}

// Map one projected row → the display item the island's feed renderer expects.
// Every feed item is repliable (comments key off the opaque feed id), so all
// carry a real comment count + `commentable` flag.
function buildFeedItem(
  row: FeedRow,
  markets: Map<string, MarketMeta>,
  eventRefs: Map<string, EventRef>,
  commentCounts: Map<string, number>,
  likeStates: Map<string, LikeState>,
  viewerUserId: string | null
) {
  const author = resolvePublicDisplayName(row.user_id, row.display_name, row.handle);
  const meta = row.market_id ? markets.get(row.market_id) : undefined;
  const eventRef = row.event_id ? eventRefs.get(row.event_id) : undefined;
  const marketKey = row.market_id ? readMarketKey(row.market_id) : null;
  const href = row.market_id ? marketRefHref(row.market_id) : null;
  const topic = eventRef
    ? topicForCategoryLabel(eventRef.categoryLabel)
    : topicForCategoryLabel(meta ? catLabel(meta) : null);
  // Subject ref for authored posts (take/share): a child market OR a parent event.
  const subjectMarket = eventRef
    ? {
        kind: "event" as const,
        marketKey: null,
        href: `/event/${encodeURIComponent(eventRef.slug)}`,
        cat: eventRef.categoryLabel,
        title: eventRef.title,
        prob: eventRef.prob,
        chip: `אירוע · ${eventRef.candidates} שווקים`,
        mv: { dir: "flat", val: "—" }
      }
    : meta
      ? { kind: "market" as const, marketKey, href, cat: catLabel(meta), title: meta.title, prob: probPct(meta), mv: { dir: "flat", val: "—" } }
      : null;
  const base = {
    id: row.feed_id,
    kind: row.kind,
    topic,
    author: {
      name: author,
      tint: buildAuthorTint(row.user_id),
      initial: initialOf(author),
      avatarUrl: sanitizePublicAvatarUrl(row.avatar_url),
      seal: sealForTier(row.verified_tier)
    },
    time: relativeTimeLabel(row.feed_ts),
    likes: likeStates.get(row.feed_id)?.count ?? 0,
    liked: likeStates.get(row.feed_id)?.liked ?? false,
    comments: commentCounts.get(row.feed_id) ?? 0,
    commentable: true,
    // Only authored posts can be deleted by their author; position/result are
    // derived from real trades and are not user-owned content.
    isMine: Boolean(viewerUserId) && row.user_id === viewerUserId && (row.kind === "take" || row.kind === "share"),
    follow: false
  };

  if (row.kind === "position") {
    const buy = row.side === "buy";
    return {
      ...base,
      glyph: buy ? "buy" : "sell",
      glyphIcon: buy ? "trending_up" : "trending_down",
      verb: [
        "פוזיציה חדשה · ",
        { s: buy ? "buy" : "sell", t: `${buy ? "קנייה" : "מכירה"} · ${row.outcome_label ?? ""}`.trim() },
        " ב־",
        { b: fmtAmount(row.amount) }
      ],
      body: row.body && row.body !== "·" ? [row.body] : undefined,
      market: meta
        ? { kind: "market" as const, marketKey, href, cat: catLabel(meta), title: meta.title, prob: probPct(meta), mv: { dir: "flat", val: "—" }, spark: true }
        : null
    };
  }

  if (row.kind === "result") {
    const win = row.result_kind === "win";
    return {
      ...base,
      glyph: win ? "win" : "loss",
      glyphIcon: win ? "check" : "close",
      verb: [win ? "הכרעה נכונה — שוק נסגר" : "הכרעה — שוק נסגר"],
      market: meta
        ? {
            kind: "market" as const,
            marketKey,
            href,
            cat: catLabel(meta),
            title: meta.title,
            verdict: { kind: win ? "win" : "loss", label: `הכרעה: ${row.outcome_label ?? ""}`.trim() },
            pnl: fmtPnl(row.pnl)
          }
        : null,
      body: row.body && row.body !== "·" ? [row.body] : undefined
    };
  }

  if (row.kind === "milestone") {
    return {
      ...base,
      // The island renders `mile` (segment array) for milestone items.
      mile: [row.body && row.body !== "·" ? `${row.body} · ` : "", { b: row.badge ?? "הישג" }].filter(Boolean),
      milestoneIcon: row.icon || "workspace_premium"
    };
  }

  if (row.kind === "share") {
    return {
      ...base,
      glyph: "share",
      glyphIcon: "bookmark",
      verb: ["שוק חדש למעקב — ", { b: "שווה קריאה" }],
      market: subjectMarket
    };
  }

  // take
  return {
    ...base,
    glyph: "take",
    glyphIcon: "format_quote",
    verb: ["קריאת שוק"],
    body: [row.body ?? ""],
    market: subjectMarket
  };
}

export async function readCommunityFeed(
  db: Queryable,
  options?: { limit?: string | null; cursor?: string | null; viewerUserId?: string | null }
) {
  const limit = clampLimit(options?.limit ?? null, DEFAULT_FEED_LIMIT, MAX_FEED_LIMIT);
  const cursor = decodeCursor(options?.cursor?.trim() || null);

  // KILL-SWITCH: auto-derived position/result items (projected from every trade /
  // resolution) coexist with authored posts for now — this is what gives the feed
  // day-one movement. Set COMMUNITY_FEED_AUTODERIVE=off to drop them later and
  // leave the feed to only what people choose to post. Authored posts always show.
  const autoDerive = process.env.COMMUNITY_FEED_AUTODERIVE !== "off";

  // Read-time projection: authored posts (take/share/position/result/milestone —
  // their frozen `meta` mapped into the shared columns) plus, while autoDerive is
  // on, real trades (position) + resolutions (result). Keyset-paginated; inactive/
  // erased authors filtered pre-limit. Global · everything — no per-item filter.
  const autoBranches = `
        union all
        select 'position' as kind, t.id, t.created_at, t.user_id,
               t.market_id, null::text as event_id, null, t.side, t.cash_amount::text,
               null, null, o.short_label, null::text as badge, null::text as icon
        from trades t
        join market_outcomes o on o.market_id = t.market_id and o.id = t.outcome_id
        union all
        select 'result' as kind, re.id, re.created_at, re.user_id,
               re.market_id, null::text as event_id, null, null, null,
               re.realized_pnl::text,
               case re.type when 'resolution_win' then 'win' else 'loss' end,
               o.short_label, null::text as badge, null::text as icon
        from realization_events re
        join market_outcomes o on o.market_id = re.market_id and o.id = re.outcome_id
        where re.type in ('resolution_win', 'resolution_loss')`;

  const result = await db.query<FeedRow>(
    `
      with merged as (
        select cp.kind::text as kind, cp.id as feed_id, cp.created_at as feed_ts, cp.user_id,
               cp.market_id, cp.event_id, cp.body,
               cp.meta->>'side' as side,
               cp.meta->>'amount' as amount,
               cp.meta->>'pnl' as pnl,
               cp.meta->>'resultKind' as result_kind,
               cp.meta->>'outcomeLabel' as outcome_label,
               cp.meta->>'badge' as badge,
               cp.meta->>'icon' as icon
        from community_posts cp
        where cp.status = 'visible'
        ${autoDerive ? autoBranches : ""}
      )
      select
        merged.kind, merged.feed_id, merged.feed_ts, merged.user_id,
        u.handle, u.display_name, u.avatar_url, ver.tier as verified_tier,
        merged.market_id, merged.event_id, merged.body, merged.side, merged.amount,
        merged.pnl, merged.result_kind, merged.outcome_label, merged.badge, merged.icon
      from merged
      join users u on u.id = merged.user_id and u.status = 'active' and u.privacy_erased_at is null
      left join lateral (
        select tier from user_verification_tier_purchases v
        where v.user_id = merged.user_id order by v.purchased_at desc limit 1
      ) ver on true
      where ($1::timestamptz is null or (merged.feed_ts, merged.feed_id) < ($1::timestamptz, $2::text))
      order by merged.feed_ts desc, merged.feed_id desc
      limit $3
    `,
    [cursor?.ts ?? null, cursor?.id ?? null, limit]
  );

  const rows = result.rows;
  const marketIds = [...new Set(rows.map((r) => r.market_id).filter((id): id is string => Boolean(id)))];
  const eventIds = [...new Set(rows.map((r) => r.event_id).filter((id): id is string => Boolean(id)))];
  const feedIds = rows.map((r) => r.feed_id);
  const viewerUserId = options?.viewerUserId?.trim() || null;
  const [markets, eventRefs, commentCounts, likeStates] = await Promise.all([
    readMarketMeta(db, marketIds),
    readEventRefs(db, eventIds),
    readFeedCommentCounts(db, feedIds),
    readLikeStates(db, feedIds, viewerUserId)
  ]);
  const feed = rows.map((row) => buildFeedItem(row, markets, eventRefs, commentCounts, likeStates, viewerUserId));
  const last = rows.at(-1);

  return {
    feed,
    pagination: {
      limit,
      nextCursor: rows.length === limit && last ? encodeCursor(last.feed_ts.toISOString(), last.feed_id) : null
    }
  };
}

// ── create authored post (take / share) ──────────────────────────────────────
// position/result/milestone are AUTO-DERIVED into the feed from real events —
// never created here. Only take/share are user-authored.
export async function createCommunityPost(db: Queryable, userId: string, body: unknown) {
  const parsed = parseObjectBody(body, "Request body must be a JSON object.", invalid);
  const kind = parseRequiredStringField(parsed, "kind", invalid).trim();
  const AUTHORED = ["take", "share", "position", "result", "milestone"];
  if (!AUTHORED.includes(kind)) {
    throw invalid("kind must be take/share/position/result/milestone.");
  }
  const rawBody = parseNullableStringField(parsed, "body", invalid);
  const postBody = (rawBody ?? "").replace(/\r\n/g, "\n").trim();
  if (postBody.length > MAX_POST_BODY) {
    throw invalid(`body must be ${MAX_POST_BODY} characters or fewer.`);
  }

  const marketKeyRaw = parseNullableStringField(parsed, "marketKey", invalid)?.trim() || null;
  const subjectKind = parseNullableStringField(parsed, "subjectKind", invalid)?.trim() || null;
  const subjectKey = parseNullableStringField(parsed, "subjectKey", invalid)?.trim() || null;
  const subjectInput = marketKeyRaw
    ? { kind: "market", key: marketKeyRaw }
    : subjectKind && subjectKey
      ? { kind: subjectKind, key: subjectKey }
      : null;

  let marketId: string | null = null;
  let eventId: string | null = null;
  let meta: PositionMeta | ResultMeta | MilestoneMeta | null = null;

  // position / result / milestone: numbers are SERVER-DERIVED from the author's
  // real activity and frozen into `meta` — never trusted from the client. If the
  // author has no matching position/resolution/milestone, the write is rejected.
  if (kind === "position" || kind === "result") {
    if (subjectInput?.kind !== "market") throw invalid("a position/result post requires a market you hold.");
    const resolved = await resolveCommunitySubject(db, "market", subjectInput.key);
    if (!resolved?.marketId) throw new CommunityFeedError(404, "market_not_found", "Market not found.");
    marketId = resolved.marketId;
    meta = kind === "position"
      ? await derivePosition(db, userId, subjectInput.key)
      : await deriveResult(db, userId, subjectInput.key);
    if (!meta) throw new CommunityFeedError(422, "no_position", kind === "position" ? "אין לך פוזיציה בשוק הזה." : "לא הכרעת בשוק הזה.");
  } else if (kind === "milestone") {
    const milestoneId = parseRequiredStringField(parsed, "milestoneId", invalid).trim();
    meta = await deriveMilestone(db, userId, milestoneId);
    if (!meta) throw new CommunityFeedError(422, "no_milestone", "ההישג הזה לא זמין לשיתוף.");
  } else {
    // take / share
    if (kind === "share" && !subjectInput) throw invalid("share requires a market or event.");
    if (kind === "take" && postBody.length < 2) throw invalid("body must be at least 2 characters.");
    if (subjectInput) {
      const resolved = await resolveCommunitySubject(db, subjectInput.kind, subjectInput.key);
      if (!resolved) throw new CommunityFeedError(404, "subject_not_found", "Market or event not found.");
      marketId = resolved.marketId;
      eventId = resolved.eventId;
    }
  }

  // A post with no note carries a single space so the 2-char DB CHECK passes.
  const storedBody = postBody.length >= 2 ? postBody : "·";

  const id = `post_${randomUUID()}`;
  await db.query(
    `
      insert into community_posts (id, kind, user_id, market_id, event_id, body, meta, status, created_at, updated_at)
      values ($1, $2, $3, $4, $5, $6, $7::jsonb, 'visible', now(), now())
    `,
    [id, kind, userId, marketId, eventId, storedBody, meta ? JSON.stringify(meta) : null]
  );

  return { ok: true as const, id, kind };
}
