import type { Queryable } from "../db/client/pool";
import { readVerificationTierSummary, type VerificationTier } from "../auth/user-verification-tier-service";
import { buildFallbackImage } from "../discovery/feed/image";
import { quantizeMoney, quantizePrice, quantizeShares, toDecimal } from "../shared/decimals";
import {
  resolveCanonicalMarketKeyById
} from "../shared/market-identity";
import { resolvePublicDisplayName } from "../shared/public-user-identity";
import { sanitizePublicAvatarUrl } from "../shared/public-avatar-url";
import {
  EFFECTIVE_PROCEEDS_SQL,
  EFFECTIVE_REALIZATION_TYPE_SQL,
  EFFECTIVE_REALIZED_PNL_SQL,
  INCIDENT_COMPENSATION_LATERAL_JOIN
} from "../shared/incident-compensation";

const PUBLIC_PROFILE_POSITION_LIMIT = 20;
const PUBLIC_PROFILE_RECORD_LIMIT = 20;
// Raised from 100 (growth-shape sweep, sitemap fix): the sitemap's profile
// chunks fetch PUBLIC_PROFILE_CATALOG_LIMIT rows per child request, so this
// is also the sitemap's per-chunk size. 1000 keeps each chunk to a single
// backend round trip and stays far under the sitemap spec's 50k-URLs-per-file
// ceiling. Read-only pagination ceiling, not a security boundary.
const PUBLIC_PROFILE_CATALOG_LIMIT = 1000;

type PublicProfileUserRow = {
  user_id: string;
  handle: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  showcase_categories: string[];
  created_at: Date;
};

type PublicSocialLinkRow = {
  platform: "x" | "telegram" | "instagram" | "website";
  url: string;
};

type ProfileCountsRow = {
  follower_count: number | string;
  following_count: number | string;
  profile_view_count: number | string;
  viewer_follows: boolean | null;
};

type PublicProfilePositionRow = {
  market_id: string;
  market_title: string;
  category_key?: string | null;
  market_contract?: unknown;
  requested_outcome_id: string;
  requested_outcome_label: string;
  outcome_count: number | string;
  complement_outcome_label?: string | null;
  contract_side: "yes" | "no";
  shares: string;
  cost_basis: string;
  current_price: string;
  outcome_image_url?: string | null;
};

type PublicProfileRecordRow = {
  realization_id: string;
  created_at: Date;
  type: "resolution_win" | "resolution_loss";
  shares_closed: string;
  proceeds: string;
  removed_cost_basis: string;
  realized_pnl: string;
  market_id: string;
  market_title: string;
  category_key?: string | null;
  market_contract?: unknown;
  outcome_id: string;
  outcome_label: string;
  outcome_image_url?: string | null;
};

type PublicProfileMarketImage = ReturnType<typeof buildFallbackImage>;

export class PublicProfileServiceError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "PublicProfileServiceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

type PublicSocialLinks = {
  x: { url: string } | null;
  instagram: { url: string } | null;
  website: { url: string } | null;
};

export type PublicUserProfileResponse = {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  verifiedTier: VerificationTier | null;
  createdAt: string;
  socialLinks: PublicSocialLinks;
  followerCount: number;
  followingCount: number;
  profileViewCount: number;
  viewerFollows: boolean | null;
  viewerIsOwner: boolean | null;
  showcaseCategories: string[];
  showcaseBadges: [];
  achievements: {
    status: "skeleton";
    sourceReference: "systems/design/to-integrate/achievements";
  };
};

export type PublicProfileCatalogResponse = {
  generatedAt: string;
  profiles: Array<{
    handle: string;
    displayName: string;
    updatedAt: string;
  }>;
  pagination: {
    limit: number;
    nextCursor: string | null;
    // Only populated when `includeTotal` is requested (sitemap-index caller) —
    // a single extra count(*) query, so it's opt-in rather than paid on every
    // catalog read. Backed by idx_users_handle_active_lookup (a partial index
    // on handle where status = 'active' and privacy_erased_at is null), so
    // the count is an index-only scan.
    total?: number;
  };
};

export type FollowUserResponse = {
  handle: string;
  following: boolean;
  followerCount: number;
};

export type PublicProfilePositionsResponse = {
  asOf: string;
  pagination: {
    limit: number;
    hasMore: boolean;
  };
  positions: Array<{
    marketKey: string;
    title: string;
    image: PublicProfileMarketImage;
    outcomeLabel: string;
    contractSide: "yes" | "no";
    side: "buy";
    contracts: string;
    avgPrice: string | null;
    currentPrice: string;
    value: string;
    pnlPct: string;
  }>;
};

export type PublicProfileRecordResponse = {
  asOf: string;
  pagination: {
    limit: number;
    hasMore: boolean;
  };
  items: Array<{
    marketKey: string;
    title: string;
    image: PublicProfileMarketImage;
    outcomeLabel: string;
    verdict: "correct" | "wrong";
    amount: string;
    realizedPnl: string;
    resolvedAt: string;
  }>;
};

function normalizePublicUserKey(value: string): string {
  const userKey = value.trim().replace(/^@/, "");
  if (!userKey) {
    throw new PublicProfileServiceError(400, "invalid_request", "user key is required.");
  }
  if (userKey.length > 120) {
    throw new PublicProfileServiceError(400, "invalid_request", "user key is too long.");
  }
  return userKey.toLowerCase();
}

function readLimit(value: string | null | undefined, fallback: number, max: number): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

function normalizeProfileCatalogCursor(value: string | null | undefined): string | null {
  const cursor = value?.trim().toLowerCase() ?? "";
  return cursor || null;
}

function displayNameFor(row: PublicProfileUserRow): string {
  return resolvePublicDisplayName(row.user_id, row.display_name, row.handle);
}

function emptySocialLinks(): PublicSocialLinks {
  return {
    x: null,
    instagram: null,
    website: null
  };
}

function safePublicSocialUrl(
  platform: PublicSocialLinkRow["platform"],
  value: string
): string | null {
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (platform === "website") {
    return parsed.protocol === "https:" ? parsed.toString() : null;
  }

  if (parsed.protocol !== "https:") {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (platform === "x") {
    return host === "x.com" ? parsed.toString() : null;
  }
  if (platform === "instagram") {
    return host === "instagram.com" || host === "www.instagram.com" ? parsed.toString() : null;
  }

  return null;
}

function mapPublicSocialLinks(rows: PublicSocialLinkRow[]): PublicSocialLinks {
  const links = emptySocialLinks();

  for (const row of rows) {
    if (row.platform === "x" || row.platform === "instagram" || row.platform === "website") {
      const safeUrl = safePublicSocialUrl(row.platform, row.url);
      if (safeUrl) {
        links[row.platform] = { url: safeUrl };
      }
    }
  }

  return links;
}

async function readActivePublicUser(db: Queryable, userKey: string): Promise<PublicProfileUserRow> {
  const result = await db.query<PublicProfileUserRow>(
    `
      select
        id as user_id,
        handle,
        display_name,
        bio,
        avatar_url,
        showcase_categories,
        created_at
      from users
      where handle = lower($1)
        and status = 'active'
        and privacy_erased_at is null
      limit 1
    `,
    [userKey]
  );

  const row = result.rows[0];
  if (!row) {
    throw new PublicProfileServiceError(404, "user_not_found", "User profile was not found.");
  }

  return row;
}

async function readActivePublicProfileCount(db: Queryable): Promise<number> {
  const result = await db.query<{ count: string | number }>(
    `
      select count(*) as count
      from users
      where status = 'active'
        and privacy_erased_at is null
    `
  );
  return Number(result.rows[0]?.count ?? 0) || 0;
}

function normalizeCatalogOffset(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

export async function readPublicProfileCatalog(
  db: Queryable,
  options: {
    limit?: string | null;
    cursor?: string | null;
    includeTotal?: boolean;
    // Direct chunk addressing for the sitemap-index children (sitemaps/profiles-<n>.xml):
    // offset = n * limit fetches chunk n in one round trip, without walking
    // chunks 0..n-1 first the way the cursor path requires. Rides the same
    // idx_users_handle_active_lookup index as the cursor path (order by handle
    // asc), just with OFFSET instead of a keyset predicate. Mutually exclusive
    // with `cursor` in practice — offset wins when both are passed.
    offset?: number | string | null;
  } = {}
): Promise<PublicProfileCatalogResponse> {
  const limit = readLimit(options.limit, PUBLIC_PROFILE_CATALOG_LIMIT, PUBLIC_PROFILE_CATALOG_LIMIT);
  const offset = normalizeCatalogOffset(options.offset);
  const cursor = offset > 0 ? null : normalizeProfileCatalogCursor(options.cursor);
  const result = await db.query<{
    user_id: string;
    handle: string;
    display_name: string | null;
    updated_at: Date | null;
    created_at: Date;
  }>(
    `
      select
        id as user_id,
        handle,
        display_name,
        updated_at,
        created_at
      from users
      where status = 'active'
        and privacy_erased_at is null
        and ($1::text is null or handle > $1)
      order by handle asc
      limit $2
      offset $3
    `,
    [cursor, limit + 1, offset]
  );
  const rows = result.rows.slice(0, limit);

  return {
    generatedAt: new Date().toISOString(),
    profiles: rows.map((row) => ({
      handle: row.handle,
      displayName: resolvePublicDisplayName(row.user_id, row.display_name, row.handle),
      updatedAt: (row.updated_at ?? row.created_at).toISOString()
    })),
    pagination: {
      limit,
      nextCursor: result.rows.length > limit ? rows.at(-1)?.handle ?? null : null,
      ...(options.includeTotal ? { total: await readActivePublicProfileCount(db) } : {})
    }
  };
}

async function readPublicSocialLinks(db: Queryable, userId: string): Promise<PublicSocialLinkRow[]> {
  const result = await db.query<PublicSocialLinkRow>(
    `
      select platform, url
      from user_social_links
      where user_id = $1
        and platform in ('x', 'instagram', 'website')
      order by platform asc
    `,
    [userId]
  );

  return result.rows;
}

async function recordProfileView(db: Queryable, profileUserId: string, viewerUserId: string | null): Promise<void> {
  if (!viewerUserId || viewerUserId === profileUserId) return;

  await db.query(
    `
      insert into user_profile_views_daily (
        profile_user_id,
        viewer_user_id,
        viewed_on,
        first_viewed_at,
        last_viewed_at,
        view_count
      )
      values ($1, $2, current_date, now(), now(), 1)
      on conflict (profile_user_id, viewer_user_id, viewed_on)
      do update set
        last_viewed_at = now(),
        view_count = user_profile_views_daily.view_count + 1
    `,
    [profileUserId, viewerUserId]
  );
}

async function readProfileCounts(
  db: Queryable,
  userId: string,
  viewerUserId: string | null
): Promise<ProfileCountsRow> {
  const result = await db.query<ProfileCountsRow>(
    `
      select
        (
          select count(*)::int
          from user_follows uf
          join users follower
            on follower.id = uf.follower_user_id
           and follower.status = 'active'
           and follower.privacy_erased_at is null
          where uf.followed_user_id = $1
        ) as follower_count,
        (
          select count(*)::int
          from user_follows uf
          join users followed
            on followed.id = uf.followed_user_id
           and followed.status = 'active'
           and followed.privacy_erased_at is null
          where uf.follower_user_id = $1
        ) as following_count,
        (
          select coalesce(sum(upv.view_count), 0)::int
          from user_profile_views_daily upv
          join users viewer
            on viewer.id = upv.viewer_user_id
           and viewer.status = 'active'
           and viewer.privacy_erased_at is null
          where upv.profile_user_id = $1
        ) as profile_view_count,
        case
          when $2::text is null then null
          else exists (
            select 1
            from user_follows uf
            where uf.follower_user_id = $2
              and uf.followed_user_id = $1
          )
        end as viewer_follows
    `,
    [userId, viewerUserId]
  );

  return result.rows[0] ?? {
    follower_count: 0,
    following_count: 0,
    profile_view_count: 0,
    viewer_follows: null
  };
}

export async function readPublicUserProfile(
  db: Queryable,
  userKeyInput: string,
  options: {
    viewerUserId?: string | null;
    countView?: boolean;
  } = {}
): Promise<PublicUserProfileResponse> {
  const userKey = normalizePublicUserKey(userKeyInput);
  const viewerUserId = options.viewerUserId ?? null;
  const user = await readActivePublicUser(db, userKey);
  const userId = user.user_id;
  const [socialLinks, verification] = await Promise.all([
    readPublicSocialLinks(db, userId),
    readVerificationTierSummary(db, userId)
  ]);

  if (options.countView) {
    await recordProfileView(db, userId, viewerUserId);
  }

  const counts = await readProfileCounts(db, userId, viewerUserId);

  return {
    handle: user.handle,
    displayName: displayNameFor(user),
    avatarUrl: sanitizePublicAvatarUrl(user.avatar_url),
    bio: user.bio,
    verifiedTier: verification.currentTier,
    createdAt: user.created_at.toISOString(),
    socialLinks: mapPublicSocialLinks(socialLinks),
    followerCount: Number(counts.follower_count) || 0,
    followingCount: Number(counts.following_count) || 0,
    profileViewCount: Number(counts.profile_view_count) || 0,
    viewerFollows: counts.viewer_follows,
    viewerIsOwner: viewerUserId ? viewerUserId === userId : null,
    showcaseCategories: user.showcase_categories ?? [],
    showcaseBadges: [],
    achievements: {
      status: "skeleton",
      sourceReference: "systems/design/to-integrate/achievements"
    }
  };
}

export async function followPublicUser(
  db: Queryable,
  targetUserKeyInput: string,
  followerUserId: string
): Promise<FollowUserResponse> {
  const targetUserKey = normalizePublicUserKey(targetUserKeyInput);
  const targetUser = await readActivePublicUser(db, targetUserKey);
  const targetUserId = targetUser.user_id;
  if (targetUserId === followerUserId) {
    throw new PublicProfileServiceError(400, "invalid_request", "Users cannot follow themselves.");
  }

  await db.query(
    `
      insert into user_follows (follower_user_id, followed_user_id, created_at)
      values ($1, $2, now())
      on conflict (follower_user_id, followed_user_id) do nothing
    `,
    [followerUserId, targetUserId]
  );
  const counts = await readProfileCounts(db, targetUserId, followerUserId);

  return {
    handle: targetUser.handle,
    following: true,
    followerCount: Number(counts.follower_count) || 0
  };
}

export async function unfollowPublicUser(
  db: Queryable,
  targetUserKeyInput: string,
  followerUserId: string
): Promise<FollowUserResponse> {
  const targetUserKey = normalizePublicUserKey(targetUserKeyInput);
  const targetUser = await readActivePublicUser(db, targetUserKey);
  const targetUserId = targetUser.user_id;
  if (targetUserId === followerUserId) {
    throw new PublicProfileServiceError(400, "invalid_request", "Users cannot unfollow themselves.");
  }

  await db.query(
    `
      delete from user_follows
      where follower_user_id = $1
        and followed_user_id = $2
    `,
    [followerUserId, targetUserId]
  );
  const counts = await readProfileCounts(db, targetUserId, followerUserId);

  return {
    handle: targetUser.handle,
    following: false,
    followerCount: Number(counts.follower_count) || 0
  };
}

function buildPublicProfileMarketImage(
  row: Pick<
    PublicProfilePositionRow | PublicProfileRecordRow,
    "market_contract" | "category_key" | "market_title" | "outcome_image_url"
  >
): PublicProfileMarketImage {
  return buildFallbackImage(
    row.market_contract ?? null,
    row.category_key ?? null,
    row.market_title,
    row.outcome_image_url ?? null
  );
}

function mapProfilePosition(row: PublicProfilePositionRow): PublicProfilePositionsResponse["positions"][number] {
  const shares = toDecimal(row.shares);
  const costBasis = toDecimal(row.cost_basis);
  const currentPrice = toDecimal(row.current_price);
  const value = shares.mul(currentPrice);
  const pnlPct = costBasis.gt(0)
    ? value.minus(costBasis).div(costBasis).mul(100)
    : toDecimal(0);
  const isBinaryNoContract = Number(row.outcome_count) === 2 && row.contract_side === "no";
  const outcomeLabel = isBinaryNoContract
    ? row.complement_outcome_label ?? row.requested_outcome_label
    : row.requested_outcome_label;

  return {
    marketKey: resolveCanonicalMarketKeyById(row.market_id) ?? row.market_id,
    title: row.market_title,
    image: buildPublicProfileMarketImage(row),
    outcomeLabel,
    contractSide: row.contract_side,
    side: "buy",
    contracts: quantizeShares(shares),
    avgPrice: shares.gt(0) ? quantizePrice(costBasis.div(shares)) : null,
    currentPrice: quantizePrice(currentPrice),
    value: quantizeMoney(value),
    pnlPct: quantizeMoney(pnlPct)
  };
}

export async function readPublicProfilePositions(
  db: Queryable,
  userKeyInput: string,
  options: {
    limit?: string | null;
  } = {}
): Promise<PublicProfilePositionsResponse> {
  const userKey = normalizePublicUserKey(userKeyInput);
  const user = await readActivePublicUser(db, userKey);
  const userId = user.user_id;
  const limit = readLimit(options.limit, PUBLIC_PROFILE_POSITION_LIMIT, 50);
  const result = await db.query<PublicProfilePositionRow>(
    `
      select
        cp.market_id,
        m.title as market_title,
        m.category_key,
        m.market_contract,
        cp.requested_outcome_id,
        o.label as requested_outcome_label,
        outcome_shape.outcome_count,
        outcome_shape.complement_outcome_label,
        cp.contract_side,
        cp.shares,
        cp.cost_basis,
        case
          when cp.contract_side = 'no' then (1 - os.last_price)
          else os.last_price
        end as current_price,
        outcome_image.outcome_image_url
      from contract_positions cp
      join markets m
        on m.id = cp.market_id
       and m.status not in ('resolved', 'voided')
      join market_outcomes o
        on o.market_id = cp.market_id
       and o.id = cp.requested_outcome_id
      join market_outcome_state os
        on os.market_id = cp.market_id
       and os.outcome_id = cp.requested_outcome_id
      left join lateral (
        select
          count(*)::int as outcome_count,
          max(mo.label) filter (where mo.id <> cp.requested_outcome_id) as complement_outcome_label
        from market_outcomes mo
        where mo.market_id = cp.market_id
      ) outcome_shape on true
      left join lateral (
        select mo.image_url as outcome_image_url
        from market_outcomes mo
        where mo.market_id = cp.market_id
          and nullif(trim(mo.image_url), '') is not null
        order by mo.sort_order
        limit 1
      ) outcome_image on true
      where cp.user_id = $1
        and cp.shares > 0
        and cp.settled_at is null
      order by cp.updated_at desc, cp.market_id asc, cp.requested_outcome_id asc, cp.contract_side asc
      limit $2
    `,
    [userId, limit + 1]
  );
  const rows = result.rows.slice(0, limit);

  return {
    asOf: new Date().toISOString(),
    pagination: {
      limit,
      hasMore: result.rows.length > limit
    },
    positions: rows.map(mapProfilePosition)
  };
}

function mapProfileRecord(row: PublicProfileRecordRow): PublicProfileRecordResponse["items"][number] {
  return {
    marketKey: resolveCanonicalMarketKeyById(row.market_id) ?? row.market_id,
    title: row.market_title,
    image: buildPublicProfileMarketImage(row),
    outcomeLabel: row.outcome_label,
    verdict: row.type === "resolution_win" ? "correct" : "wrong",
    amount: quantizeMoney(row.proceeds),
    realizedPnl: quantizeMoney(row.realized_pnl),
    resolvedAt: row.created_at.toISOString()
  };
}

export async function readPublicProfileRecord(
  db: Queryable,
  userKeyInput: string,
  options: {
    limit?: string | null;
  } = {}
): Promise<PublicProfileRecordResponse> {
  const userKey = normalizePublicUserKey(userKeyInput);
  const user = await readActivePublicUser(db, userKey);
  const userId = user.user_id;
  const limit = readLimit(options.limit, PUBLIC_PROFILE_RECORD_LIMIT, 50);
  const result = await db.query<PublicProfileRecordRow>(
    `
      select
        re.id as realization_id,
        re.created_at,
        ${EFFECTIVE_REALIZATION_TYPE_SQL} as type,
        re.shares_closed,
        ${EFFECTIVE_PROCEEDS_SQL} as proceeds,
        re.removed_cost_basis,
        ${EFFECTIVE_REALIZED_PNL_SQL} as realized_pnl,
        re.market_id,
        m.title as market_title,
        m.category_key,
        m.market_contract,
        re.outcome_id,
        o.label as outcome_label,
        outcome_image.outcome_image_url
      from realization_events re
      join markets m
        on m.id = re.market_id
       and m.status = 'resolved'
      join market_outcomes o
        on o.market_id = re.market_id
       and o.id = re.outcome_id
      left join market_resolutions mr
        on mr.id = re.resolution_id
      ${INCIDENT_COMPENSATION_LATERAL_JOIN}
      left join lateral (
        select mo.image_url as outcome_image_url
        from market_outcomes mo
        where mo.market_id = re.market_id
          and nullif(trim(mo.image_url), '') is not null
        order by mo.sort_order
        limit 1
      ) outcome_image on true
      where re.user_id = $1
        and re.type in ('resolution_win', 'resolution_loss')
      order by re.created_at desc, re.id desc
      limit $2
    `,
    [userId, limit + 1]
  );
  const rows = result.rows.slice(0, limit);

  return {
    asOf: new Date().toISOString(),
    pagination: {
      limit,
      hasMore: result.rows.length > limit
    },
    items: rows.map(mapProfileRecord)
  };
}
