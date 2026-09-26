import type { Queryable } from "../db/client/pool";
import { readMarketCategoryMeta } from "../shared/market-category";
import { resolvePublicDisplayName } from "../shared/public-user-identity";
import { sanitizePublicAvatarUrl } from "../shared/public-avatar-url";
import { buildAuthorTint, initialOf } from "./community-shared";

// "נדון עכשיו" — markets carrying the most community discussions right now.
type RailNowRow = { market_id: string; category_key: string | null; title: string; cnt: string };

async function readRailNow(db: Queryable): Promise<Array<{ topic: string; cnt: string }>> {
  const r = await db.query<RailNowRow>(
    `
      select d.market_id, m.category_key, m.title, count(*)::text as cnt
      from community_discussions d
      join markets m on m.id = d.market_id
      where d.status = 'visible'
      group by d.market_id, m.category_key, m.title
      order by count(*) desc, max(d.last_activity_at) desc
      limit 5
    `
  );
  return r.rows.map((row) => ({
    topic: readMarketCategoryMeta(row.category_key)?.label ?? row.title,
    cnt: `${row.cnt} דיונים`
  }));
}

// "קולות לעקוב" — accuracy-ranked forecasters with a minimum of resolved history.
type RailPersonRow = {
  user_id: string;
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
  verified_tier: "gray" | "gold" | "diamond" | null;
  resolved_count: string;
  accuracy: string | null;
  viewer_follows: boolean;
};

function sealForTier(tier: RailPersonRow["verified_tier"]): string | null {
  if (tier === "diamond" || tier === "gold") return "verified";
  if (tier === "gray") return "workspace_premium";
  return null;
}

async function readRailPeople(db: Queryable, viewerUserId: string | null) {
  const r = await db.query<RailPersonRow>(
    `
      select
        u.id as user_id, u.handle, u.display_name, u.avatar_url, ver.tier as verified_tier,
        stats.resolved_count::text as resolved_count,
        stats.accuracy::text as accuracy,
        (exists (select 1 from user_follows uf where uf.follower_user_id = $1 and uf.followed_user_id = u.id)) as viewer_follows
      from users u
      left join lateral (
        select tier from user_verification_tier_purchases v
        where v.user_id = u.id order by v.purchased_at desc limit 1
      ) ver on true
      join lateral (
        select
          count(*) as resolved_count,
          round(count(*) filter (where type = 'resolution_win')::numeric / nullif(count(*), 0), 4) as accuracy
        from realization_events re
        where re.user_id = u.id and re.type in ('resolution_win', 'resolution_loss')
      ) stats on true
      where u.status = 'active' and u.privacy_erased_at is null
        and stats.resolved_count >= 5
        and ($1::text is null or u.id <> $1)
      order by stats.accuracy desc nulls last, stats.resolved_count desc
      limit 3
    `,
    [viewerUserId]
  );
  return r.rows.map((row) => {
    const name = resolvePublicDisplayName(row.user_id, row.display_name, row.handle);
    return {
      userId: row.user_id,
      handle: row.handle,
      name,
      tint: buildAuthorTint(row.user_id),
      initial: initialOf(name),
      avatarUrl: sanitizePublicAvatarUrl(row.avatar_url),
      seal: sealForTier(row.verified_tier),
      cat: null,
      accuracy: row.accuracy != null ? Math.round(Number(row.accuracy) * 100) : null,
      viewerFollows: Boolean(row.viewer_follows)
    };
  });
}

export async function readCommunityRail(db: Queryable, viewerUserId: string | null = null) {
  const [now, people] = await Promise.all([readRailNow(db), readRailPeople(db, viewerUserId)]);
  return { now, people };
}
