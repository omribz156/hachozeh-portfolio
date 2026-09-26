import type { Queryable } from "../db/client/pool";
import { readMarketKey } from "../markets/market-api/identity";
import { readMarketCategoryMeta } from "../shared/market-category";
import { resolvePublicDisplayName } from "../shared/public-user-identity";
import { sanitizePublicAvatarUrl } from "../shared/public-avatar-url";
import { formatPublicVolumeLabel } from "../shared/public-volume";
import {
  EFFECTIVE_REALIZATION_TYPE_SQL,
  INCIDENT_COMPENSATION_LATERAL_JOIN
} from "../shared/incident-compensation";

const DEFAULT_SEARCH_LIMIT = 8;
const MAX_SEARCH_LIMIT = 50;
const MAX_SEARCH_QUERY_LENGTH = 120;
// When the full results page asks to sort by anything other than relevance, we
// re-order in JS over a candidate pool fetched by relevance. The pool is capped
// so a broad keyword can't turn a sort into an unbounded scan; results past the
// cap are simply not reachable by non-relevance sort (documented, not silent —
// the page's "load more" raises the limit within the pool).
const ENRICH_CANDIDATE_POOL = 60;

type SearchKind = "all" | "markets" | "profiles";

// A parent EVENT (e.g. "מי תזכה במונדיאל 2026?") is its own searchable subject,
// distinct from its child markets ("האם ארגנטינה תנצח"). Surfaced alongside
// markets so the search bar can reach the grouping page, not only the children.
type SearchEventRow = {
  event_id: string;
  slug: string;
  title: string;
  category_key: string | null;
  candidates: number;
  rank_score: number;
};
type MarketSort = "relevance" | "volume" | "newest" | "closing" | "competitive";
type ProfileSort = "accuracy" | "followers" | "newest";
type MarketStatusFilter = "open" | "resolved" | "all";
type ProfileFilter = "all" | "verified";

type SearchMarketRow = {
  market_id: string;
  title: string;
  description: string | null;
  category_key: string | null;
  market_status: string;
  close_at: Date;
  updated_at: Date;
  published_at: Date | null;
  outcome_count: number;
  total_volume: string;
  top_price: string | null;
  rank_score: number;
};

type SearchProfileRow = {
  user_id: string;
  handle: string;
  display_name: string | null;
  avatar_url: string | null;
  verified_tier: "gray" | "gold" | "diamond" | null;
  created_at: Date;
  rank_score: number;
};

type MarketEnrichment = {
  commentCount: number;
  leadingOutcomeLabel: string | null;
};

type ProfileEnrichment = {
  accuracy: number | null;
  resolvedCount: number;
  followerCount: number;
  isFollowing: boolean | null;
  isSelf: boolean;
};

type PublicSearchResult = {
  kind: "market" | "profile" | "event";
  id: string;
  title: string;
  sub: string;
  href: string;
  thumbText: string;
  thumbUrl: string | null;
  chanceLabel: string | null;
  volumeLabel: string | null;
  marketStatus?: string;
  rank?: number;
  verifiedTier?: "gray" | "gold" | "diamond" | null;
  // ── enriched (full results page only) ──
  categoryLabel?: string;
  closeLabel?: string;
  commentCount?: number;
  leadingOutcomeLabel?: string | null;
  signal?: "new" | "closing" | null;
  userId?: string;
  handle?: string;
  accuracy?: number | null;
  resolvedCount?: number;
  followerCount?: number;
  isFollowing?: boolean | null;
  isSelf?: boolean;
};

export type PublicSearchResponse = {
  query: string;
  kind: SearchKind;
  generatedAt: string;
  results: PublicSearchResult[];
  events: PublicSearchResult[];
  markets: PublicSearchResult[];
  profiles: PublicSearchResult[];
  pagination: {
    limit: number;
    hasMore: boolean;
  };
};

function normalizeKind(value: string | null): SearchKind {
  if (value === "markets" || value === "profiles") {
    return value;
  }

  return "all";
}

function normalizeMarketSort(value: string | null | undefined): MarketSort {
  if (value === "volume" || value === "newest" || value === "closing" || value === "competitive") {
    return value;
  }

  return "relevance";
}

function normalizeProfileSort(value: string | null | undefined): ProfileSort {
  if (value === "followers" || value === "newest") {
    return value;
  }

  return "accuracy";
}

function normalizeMarketStatus(value: string | null | undefined): MarketStatusFilter {
  if (value === "resolved" || value === "all") {
    return value;
  }

  return "open";
}

function normalizeProfileFilter(value: string | null | undefined): ProfileFilter {
  return value === "verified" ? "verified" : "all";
}

function clampLimit(value: string | null): number {
  if (!value?.trim()) {
    return DEFAULT_SEARCH_LIMIT;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_SEARCH_LIMIT;
  }

  return Math.max(1, Math.min(MAX_SEARCH_LIMIT, Math.floor(parsed)));
}

function normalizeSearchQuery(value: string | null | undefined): string {
  return (value?.trim() ?? "").slice(0, MAX_SEARCH_QUERY_LENGTH);
}

// Neutralize LIKE/ILIKE wildcards in user input so a query like "50%" or "a_b"
// matches literally instead of acting as a pattern. Postgres ILIKE treats
// backslash as the default escape char, so no explicit ESCAPE clause is needed.
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function formatPercentLabel(value: string | null): string | null {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return null;
  }

  return `${Math.round(numeric * 100)}%`;
}

function formatDateLabel(value: Date): string {
  return new Intl.DateTimeFormat("he-IL", {
    day: "numeric",
    month: "numeric"
  }).format(value);
}

const NEW_SIGNAL_WINDOW_MS = 1000 * 60 * 60 * 24 * 3; // published within 3 days
const CLOSING_SIGNAL_WINDOW_MS = 1000 * 60 * 60 * 24 * 7; // closes within 7 days

function deriveMarketSignal(row: SearchMarketRow): "new" | "closing" | null {
  const now = Date.now();
  if (
    row.market_status === "open" &&
    row.close_at instanceof Date &&
    row.close_at.getTime() - now <= CLOSING_SIGNAL_WINDOW_MS &&
    row.close_at.getTime() - now > 0
  ) {
    return "closing";
  }
  if (
    row.published_at instanceof Date &&
    now - row.published_at.getTime() <= NEW_SIGNAL_WINDOW_MS
  ) {
    return "new";
  }
  return null;
}

function buildMarketSearchResult(
  row: SearchMarketRow,
  enrichment?: MarketEnrichment
): PublicSearchResult {
  const marketKey = readMarketKey(row.market_id);
  const categoryMeta = readMarketCategoryMeta(row.category_key);
  const categoryLabel = categoryMeta?.label ?? "שווקים";
  const closeLabel =
    row.market_status === "resolved"
      ? "נפתר"
      : row.market_status === "closed"
        ? `סגור מ-${formatDateLabel(row.close_at)}`
        : `פתוח עד ${formatDateLabel(row.close_at)}`;
  const volumeLabel = formatPublicVolumeLabel(row.total_volume);
  const subParts = [
    categoryLabel,
    closeLabel,
    volumeLabel ? `נפח ${volumeLabel}` : null
  ].filter((part): part is string => Boolean(part));

  const result: PublicSearchResult = {
    kind: "market",
    id: marketKey,
    title: row.title,
    sub: subParts.join(" · "),
    href: `/markets/${encodeURIComponent(marketKey)}`,
    thumbText: categoryLabel.slice(0, 1),
    thumbUrl: categoryMeta?.brandImageUrl ?? null,
    chanceLabel: row.outcome_count > 0 ? formatPercentLabel(row.top_price) : null,
    volumeLabel,
    marketStatus: row.market_status,
    rank: row.rank_score
  };

  if (enrichment) {
    result.categoryLabel = categoryLabel;
    result.closeLabel = closeLabel;
    result.commentCount = enrichment.commentCount;
    result.leadingOutcomeLabel = enrichment.leadingOutcomeLabel;
    result.signal = deriveMarketSignal(row);
  }

  return result;
}

function buildProfileSearchResult(
  row: SearchProfileRow,
  enrichment?: ProfileEnrichment
): PublicSearchResult {
  const title = resolvePublicDisplayName(row.user_id, row.display_name, row.handle);
  const result: PublicSearchResult = {
    kind: "profile",
    id: row.handle,
    title,
    sub: "",
    href: `/@${encodeURIComponent(row.handle)}`,
    thumbText: title.trim().slice(0, 1) || "ח",
    thumbUrl: sanitizePublicAvatarUrl(row.avatar_url),
    chanceLabel: null,
    volumeLabel: null,
    rank: row.rank_score,
    verifiedTier: row.verified_tier
  };

  if (enrichment) {
    result.userId = row.user_id;
    result.handle = row.handle;
    result.accuracy = enrichment.accuracy;
    result.resolvedCount = enrichment.resolvedCount;
    result.followerCount = enrichment.followerCount;
    result.isFollowing = enrichment.isFollowing;
    result.isSelf = enrichment.isSelf;
  }

  return result;
}

async function readMarketResults(
  db: Queryable,
  query: string,
  limit: number,
  status: MarketStatusFilter,
  // liveFirst orders open markets ahead of closed/resolved *before* the LIMIT, so
  // a short list (the header dropdown) leads with live, high-volume markets rather
  // than whatever happened to rank highest. The results page leaves this off: its
  // candidate pool must stay relevance-ranked so explicit sorts (volume/newest/
  // competitive) can reorder the full pool without an open-bias skewing it.
  liveFirst = false
): Promise<SearchMarketRow[]> {
  const likeQuery = `%${escapeLike(query)}%`;
  const prefixQuery = `${escapeLike(query)}%`;
  // status filter is applied on the derived market_status (open/closed/resolved).
  const statusClause =
    status === "open"
      ? "and (case when m.status = 'open' and m.close_at <= now() then 'closed' else m.status end) = 'open'"
      : status === "resolved"
        ? "and m.status = 'resolved'"
        : "";
  const result = await db.query<SearchMarketRow>(
    `
      with outcome_prices as (
        select
          market_id,
          max(last_price)::text as top_price
        from market_outcome_state
        group by market_id
      ),
      market_search_terms as (
        select
          m.id as market_id,
          term.value as term
        from markets m
        cross join lateral jsonb_array_elements_text(
          coalesce(m.market_contract #> '{taxonomy,visibleTags}', '[]'::jsonb)
          || coalesce(m.market_contract #> '{taxonomy,entities}', '[]'::jsonb)
          || coalesce(m.market_contract #> '{taxonomy,aliases}', '[]'::jsonb)
          || coalesce(m.market_contract #> '{taxonomy,sourceIds}', '[]'::jsonb)
          || coalesce(m.market_contract #> '{resolutionSource,sourceIds}', '[]'::jsonb)
        ) as term(value)
      )
      select
        m.id as market_id,
        m.title,
        m.description,
        m.category_key,
        case
          when m.status = 'open' and m.close_at <= now() then 'closed'
          else m.status
        end as market_status,
        m.close_at,
        coalesce(m.updated_at, m.created_at) as updated_at,
        m.published_at,
        count(o.id)::int as outcome_count,
        coalesce(ps.total_volume, 0)::text as total_volume,
        op.top_price,
        case
          when m.title ilike $2 then 0
          when m.title ilike $1 then 1
          when exists (
            select 1
            from market_outcomes so
            where so.market_id = m.id
              and (so.label ilike $1 or coalesce(so.short_label, '') ilike $1)
          ) then 2
          when exists (
            select 1
            from market_search_terms mst
            where mst.market_id = m.id
              and mst.term ilike $2
          ) then 3
          when coalesce(m.category_key, '') ilike $1 or coalesce(m.market_family_key, '') ilike $1 then 4
          when exists (
            select 1
            from market_search_terms mst
            where mst.market_id = m.id
              and mst.term ilike $1
          ) then 5
          when coalesce(m.description, '') ilike $1 then 6
          else 7
        end as rank_score
      from markets m
      join market_outcomes o
        on o.market_id = m.id
      left join market_pricing_state ps
        on ps.market_id = m.id
      left join outcome_prices op
        on op.market_id = m.id
      where m.published_at is not null
        ${statusClause}
        and (
          m.title ilike $1
          or coalesce(m.description, '') ilike $1
          or coalesce(m.category_key, '') ilike $1
          or coalesce(m.market_family_key, '') ilike $1
          or exists (
            select 1
            from market_outcomes so
            where so.market_id = m.id
              and (so.label ilike $1 or coalesce(so.short_label, '') ilike $1)
          )
          or exists (
            select 1
            from market_search_terms mst
            where mst.market_id = m.id
              and mst.term ilike $1
          )
        )
      group by
        m.id,
        m.title,
        m.description,
        m.category_key,
        m.market_family_key,
        m.status,
        m.close_at,
        m.updated_at,
        m.created_at,
        m.published_at,
        ps.total_volume,
        op.top_price
      order by
        ${liveFirst
          ? `case when (case when m.status = 'open' and m.close_at <= now() then 'closed' else m.status end) = 'open' then 0 else 1 end asc,`
          : ""}
        rank_score asc,
        coalesce(ps.total_volume, 0) desc,
        coalesce(m.updated_at, m.created_at) desc,
        m.id asc
      limit $3
    `,
    [likeQuery, prefixQuery, limit]
  );

  return result.rows;
}

// Parent events matching the query — title-first ranking, active only.
async function readEventResults(db: Queryable, query: string, limit: number): Promise<SearchEventRow[]> {
  const likeQuery = `%${escapeLike(query)}%`;
  const prefixQuery = `${escapeLike(query)}%`;
  const result = await db.query<SearchEventRow>(
    `
      select
        e.id as event_id,
        e.slug,
        e.title,
        e.category_key,
        (
          select count(*) from markets m
          where m.event_id = e.id and m.published_at is not null
        )::int as candidates,
        case
          when e.title ilike $2 then 0
          when e.title ilike $1 then 1
          else 2
        end as rank_score
      from events e
      where e.status = 'active'
        and e.title ilike $1
      order by rank_score asc, e.updated_at desc
      limit $3
    `,
    [likeQuery, prefixQuery, limit]
  );
  return result.rows;
}

function buildEventSearchResult(row: SearchEventRow): PublicSearchResult {
  const meta = readMarketCategoryMeta(row.category_key);
  const categoryLabel = meta?.label ?? "אירוע";
  return {
    kind: "event",
    id: row.slug,
    title: row.title,
    sub: `${categoryLabel} · ${row.candidates} שווקים`,
    href: `/event/${encodeURIComponent(row.slug)}`,
    thumbText: categoryLabel.slice(0, 1),
    thumbUrl: meta?.brandImageUrl ?? null,
    chanceLabel: null,
    volumeLabel: null,
    categoryLabel,
    rank: row.rank_score
  };
}

async function readProfileResults(
  db: Queryable,
  query: string,
  limit: number,
  filter: ProfileFilter
): Promise<SearchProfileRow[]> {
  const likeQuery = `%${escapeLike(query)}%`;
  const prefixQuery = `${escapeLike(query)}%`;
  const verifiedClause = filter === "verified" ? "and verification.tier is not null" : "";
  const result = await db.query<SearchProfileRow>(
    `
      select
        u.id as user_id,
        u.handle,
        u.display_name,
        u.avatar_url,
        verification.tier as verified_tier,
        u.created_at,
        case
          when u.display_name ilike $2 then 0
          when u.handle ilike $2 then 1
          when u.display_name ilike $1 then 2
          when u.handle ilike $1 then 3
          else 4
        end as rank_score
      from users u
      left join lateral (
        select uvp.tier
        from user_verification_tier_purchases uvp
        where uvp.user_id = u.id
        order by uvp.purchased_at desc
        limit 1
      ) verification
        on true
      where u.status = 'active'
        and u.privacy_erased_at is null
        ${verifiedClause}
        and (
          u.display_name ilike $1
          or u.handle ilike $1
        )
      order by
        rank_score asc,
        u.created_at desc,
        u.id asc
      limit $3
    `,
    [likeQuery, prefixQuery, limit]
  );

  return result.rows;
}

// ── batched enrichment (full results page only) ─────────────────────────────

async function readMarketCommentCounts(
  db: Queryable,
  marketIds: string[]
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (marketIds.length === 0) {
    return map;
  }
  const result = await db.query<{ market_id: string; comment_count: number }>(
    `
      select market_id, count(*)::int as comment_count
      from market_comments
      where market_id = any($1::text[])
        and event_id is null
        and status = 'visible'
      group by market_id
    `,
    [marketIds]
  );
  for (const row of result.rows) {
    map.set(row.market_id, row.comment_count);
  }
  return map;
}

async function readMarketLeadingOutcomes(
  db: Queryable,
  marketIds: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (marketIds.length === 0) {
    return map;
  }
  const result = await db.query<{ market_id: string; label: string }>(
    `
      select distinct on (o.market_id) o.market_id, o.label
      from market_outcomes o
      join market_outcome_state os
        on os.market_id = o.market_id and os.outcome_id = o.id
      where o.market_id = any($1::text[])
      order by o.market_id, os.last_price desc nulls last
    `,
    [marketIds]
  );
  for (const row of result.rows) {
    map.set(row.market_id, row.label);
  }
  return map;
}

async function readProfileStats(
  db: Queryable,
  userIds: string[]
): Promise<Map<string, { resolvedCount: number; accuracy: number | null }>> {
  const map = new Map<string, { resolvedCount: number; accuracy: number | null }>();
  if (userIds.length === 0) {
    return map;
  }
  const result = await db.query<{ user_id: string; resolved_count: number; win_count: number }>(
    `
      select
        re.user_id,
        count(*)::int as resolved_count,
        count(*) filter (where (${EFFECTIVE_REALIZATION_TYPE_SQL}) = 'resolution_win')::int as win_count
      from realization_events re
      join markets m on m.id = re.market_id and m.status = 'resolved'
      left join market_resolutions mr on mr.id = re.resolution_id
      ${INCIDENT_COMPENSATION_LATERAL_JOIN}
      where re.user_id = any($1::text[])
        and re.type in ('resolution_win', 'resolution_loss')
      group by re.user_id
    `,
    [userIds]
  );
  for (const row of result.rows) {
    const accuracy =
      row.resolved_count > 0
        ? Math.round((row.win_count / row.resolved_count) * 10000) / 10000
        : null;
    map.set(row.user_id, { resolvedCount: row.resolved_count, accuracy });
  }
  return map;
}

async function readFollowerCounts(
  db: Queryable,
  userIds: string[]
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (userIds.length === 0) {
    return map;
  }
  const result = await db.query<{ user_id: string; follower_count: number }>(
    `
      select uf.followed_user_id as user_id, count(*)::int as follower_count
      from user_follows uf
      join users follower
        on follower.id = uf.follower_user_id
       and follower.status = 'active'
       and follower.privacy_erased_at is null
      where uf.followed_user_id = any($1::text[])
      group by uf.followed_user_id
    `,
    [userIds]
  );
  for (const row of result.rows) {
    map.set(row.user_id, row.follower_count);
  }
  return map;
}

async function readViewerFollowing(
  db: Queryable,
  viewerUserId: string,
  userIds: string[]
): Promise<Set<string>> {
  const set = new Set<string>();
  if (userIds.length === 0) {
    return set;
  }
  const result = await db.query<{ followed_user_id: string }>(
    `
      select followed_user_id
      from user_follows
      where follower_user_id = $1
        and followed_user_id = any($2::text[])
    `,
    [viewerUserId, userIds]
  );
  for (const row of result.rows) {
    set.add(row.followed_user_id);
  }
  return set;
}

// ── JS sort comparators over the enriched candidate pool ────────────────────

function sortMarketRows(rows: SearchMarketRow[], sort: MarketSort): SearchMarketRow[] {
  if (sort === "relevance") {
    // Default view floats live (open) markets above closed/resolved ones, while
    // preserving relevance order within each group (Array.sort is stable). Live
    // markets are actionable; resolved history is reference, so it sinks. Only
    // the default sort does this — explicit sorts keep pure semantics (and
    // `closing` already floats open-first on its own).
    return [...rows].sort((a, b) => {
      const ao = a.market_status === "open" ? 0 : 1;
      const bo = b.market_status === "open" ? 0 : 1;
      return ao - bo;
    });
  }
  const sorted = [...rows];
  sorted.sort((a, b) => {
    if (sort === "volume") {
      return Number(b.total_volume) - Number(a.total_volume);
    }
    if (sort === "newest") {
      const at = a.published_at?.getTime() ?? 0;
      const bt = b.published_at?.getTime() ?? 0;
      return bt - at;
    }
    if (sort === "closing") {
      // open markets first, soonest close first
      const ao = a.market_status === "open" ? 0 : 1;
      const bo = b.market_status === "open" ? 0 : 1;
      if (ao !== bo) return ao - bo;
      return a.close_at.getTime() - b.close_at.getTime();
    }
    // competitive — closest top price to 50%
    const ac = Math.abs(Number(a.top_price ?? 0) - 0.5);
    const bc = Math.abs(Number(b.top_price ?? 0) - 0.5);
    return ac - bc;
  });
  return sorted;
}

function sortProfileRows(
  rows: SearchProfileRow[],
  sort: ProfileSort,
  stats: Map<string, { resolvedCount: number; accuracy: number | null }>,
  followers: Map<string, number>
): SearchProfileRow[] {
  // Name relevance is the candidate filter; the requested sort reorders within
  // the name-matched set (search is name-first, then ranked by the chosen stat).
  const sorted = [...rows];
  sorted.sort((a, b) => {
    if (sort === "newest") {
      return b.created_at.getTime() - a.created_at.getTime();
    }
    if (sort === "followers") {
      return (followers.get(b.user_id) ?? 0) - (followers.get(a.user_id) ?? 0);
    }
    // accuracy (default) — nulls (no resolved history) sink last
    const aa = stats.get(a.user_id)?.accuracy ?? -1;
    const ba = stats.get(b.user_id)?.accuracy ?? -1;
    return ba - aa;
  });
  return sorted;
}

// The viewer's saved markets, newest-save-first, in the same enriched row shape
// the search results page renders (so the "saved" view reuses the row template).
// Published markets only; capped like search. Requires an authenticated viewer.
export async function readSavedMarkets(
  db: Queryable,
  viewerUserId: string,
  limit = MAX_SEARCH_LIMIT
): Promise<PublicSearchResult[]> {
  const capped = Math.max(1, Math.min(MAX_SEARCH_LIMIT, limit));
  const result = await db.query<SearchMarketRow>(
    `
      with outcome_prices as (
        select market_id, max(last_price)::text as top_price
        from market_outcome_state
        group by market_id
      )
      select
        m.id as market_id,
        m.title,
        m.description,
        m.category_key,
        case
          when m.status = 'open' and m.close_at <= now() then 'closed'
          else m.status
        end as market_status,
        m.close_at,
        coalesce(m.updated_at, m.created_at) as updated_at,
        m.published_at,
        count(o.id)::int as outcome_count,
        coalesce(ps.total_volume, 0)::text as total_volume,
        op.top_price,
        0 as rank_score
      from user_market_saves ums
      join markets m
        on m.id = ums.market_id
       and m.published_at is not null
      join market_outcomes o
        on o.market_id = m.id
      left join market_pricing_state ps
        on ps.market_id = m.id
      left join outcome_prices op
        on op.market_id = m.id
      where ums.user_id = $1
      group by
        m.id, m.title, m.description, m.category_key, m.status,
        m.close_at, m.updated_at, m.created_at, m.published_at,
        ps.total_volume, op.top_price, ums.created_at
      order by ums.created_at desc
      limit $2
    `,
    [viewerUserId, capped]
  );
  const rows = result.rows;
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.market_id);
  const [commentsR, leadingR] = await Promise.allSettled([
    readMarketCommentCounts(db, ids),
    readMarketLeadingOutcomes(db, ids)
  ]);
  const comments = commentsR.status === "fulfilled" ? commentsR.value : new Map<string, number>();
  const leading = leadingR.status === "fulfilled" ? leadingR.value : new Map<string, string>();
  return rows.map((row) =>
    buildMarketSearchResult(row, {
      commentCount: comments.get(row.market_id) ?? 0,
      leadingOutcomeLabel: leading.get(row.market_id) ?? null
    })
  );
}

export async function readPublicSearch(
  db: Queryable,
  options?: {
    q?: string | null;
    kind?: string | null;
    limit?: string | null;
    sort?: string | null;
    status?: string | null;
    enrich?: boolean;
    viewerUserId?: string | null;
  }
): Promise<PublicSearchResponse> {
  const query = normalizeSearchQuery(options?.q);
  const kind = normalizeKind(options?.kind ?? null);
  const limit = clampLimit(options?.limit ?? null);
  const enrich = options?.enrich === true;
  const viewerUserId = options?.viewerUserId?.trim() || null;
  const shouldSearchMarkets = kind === "all" || kind === "markets";
  const shouldSearchProfiles = kind === "all" || kind === "profiles";
  const runnable = query.length >= 2;

  // The full page enriches + sorts over a candidate pool; the dropdown (no enrich)
  // fetches exactly `limit` by relevance, unchanged behaviour.
  const fetchLimit = enrich ? Math.max(limit, ENRICH_CANDIDATE_POOL) : limit;

  let events: PublicSearchResult[] = [];
  let markets: PublicSearchResult[] = [];
  let profiles: PublicSearchResult[] = [];
  let marketsHasMore = false;
  let profilesHasMore = false;

  // Parent events ride along with the market surface (they're the grouping page
  // for their children). Capped small so they lead without crowding out markets.
  if (runnable && shouldSearchMarkets) {
    try {
      const eventRows = await readEventResults(db, query, 4);
      events = eventRows.map(buildEventSearchResult);
    } catch {
      events = []; // best-effort: never fail the search over the event lane
    }
  }

  if (runnable && shouldSearchMarkets) {
    const status = normalizeMarketStatus(enrich ? options?.status : "all");
    // Dropdown (no enrich) = short list → order live-first in SQL, before the LIMIT.
    const rows = await readMarketResults(db, query, fetchLimit, status, !enrich);
    if (enrich) {
      const sort = normalizeMarketSort(options?.sort);
      const ordered = sortMarketRows(rows, sort);
      const page = ordered.slice(0, limit);
      const ids = page.map((row) => row.market_id);
      // Enrichment is best-effort: a failed batch degrades to no-stat rows,
      // never a failed search.
      const [commentsR, leadingR] = await Promise.allSettled([
        readMarketCommentCounts(db, ids),
        readMarketLeadingOutcomes(db, ids)
      ]);
      const comments = commentsR.status === "fulfilled" ? commentsR.value : new Map<string, number>();
      const leading = leadingR.status === "fulfilled" ? leadingR.value : new Map<string, string>();
      markets = page.map((row) =>
        buildMarketSearchResult(row, {
          commentCount: comments.get(row.market_id) ?? 0,
          leadingOutcomeLabel: leading.get(row.market_id) ?? null
        })
      );
      marketsHasMore = rows.length > limit;
    } else {
      // Already live-first + volume-ordered by SQL (liveFirst above).
      markets = rows.map((row) => buildMarketSearchResult(row));
      marketsHasMore = rows.length >= limit;
    }
  }

  if (runnable && shouldSearchProfiles) {
    const filter = normalizeProfileFilter(enrich ? options?.status : "all");
    const rows = await readProfileResults(db, query, fetchLimit, filter);
    if (enrich) {
      const ids = rows.map((row) => row.user_id);
      // Best-effort enrichment (see markets block) — degrade, don't 500.
      const [statsR, followersR, followingR] = await Promise.allSettled([
        readProfileStats(db, ids),
        readFollowerCounts(db, ids),
        viewerUserId ? readViewerFollowing(db, viewerUserId, ids) : Promise.resolve(new Set<string>())
      ]);
      const stats = statsR.status === "fulfilled"
        ? statsR.value
        : new Map<string, { resolvedCount: number; accuracy: number | null }>();
      const followers = followersR.status === "fulfilled" ? followersR.value : new Map<string, number>();
      const following = followingR.status === "fulfilled" ? followingR.value : new Set<string>();
      const sort = normalizeProfileSort(options?.sort);
      const ordered = sortProfileRows(rows, sort, stats, followers);
      const page = ordered.slice(0, limit);
      profiles = page.map((row) =>
        buildProfileSearchResult(row, {
          accuracy: stats.get(row.user_id)?.accuracy ?? null,
          resolvedCount: stats.get(row.user_id)?.resolvedCount ?? 0,
          followerCount: followers.get(row.user_id) ?? 0,
          isFollowing: viewerUserId ? following.has(row.user_id) : null,
          isSelf: viewerUserId ? row.user_id === viewerUserId : false
        })
      );
      profilesHasMore = rows.length > limit;
    } else {
      profiles = rows.map((row) => buildProfileSearchResult(row));
      profilesHasMore = rows.length >= limit;
    }
  }

  // Events lead: the grouping page is usually what someone means when they type
  // the race ("מונדיאל"), with the individual children right behind it.
  const results = [...events, ...markets, ...profiles].slice(0, limit);

  return {
    query,
    kind,
    generatedAt: new Date().toISOString(),
    results,
    events,
    markets,
    profiles,
    pagination: {
      limit,
      hasMore: marketsHasMore || profilesHasMore
    }
  };
}
