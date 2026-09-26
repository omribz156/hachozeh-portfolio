import type { Queryable } from "../../db/client/pool";
import { resolveBackendCategoryKeys } from "../../shared/market-category";
import { readMarketSummariesByIds } from "./catalog-read-service";

// The card-identical summary produced by readMarketSummariesByIds.
export type MarketSummaryValue = Awaited<ReturnType<typeof readMarketSummariesByIds>> extends Map<string, infer V>
  ? V
  : never;

export type RelatedTag = { slug: string; label: string; kind: string | null; count: number };
export type RelatedItem = {
  marketKey: string;
  href: string;
  title: string;
  prob: number | null;
  categoryKey: string | null;
  categoryLabel: string | null;
  closeAt: string | null;
  marketStatus: string;
};
export type RelatedMarketsResult = { tags: RelatedTag[]; panels: Record<string, RelatedItem[]> };

const PER_TAG_LIMIT = 12;
const ALL_LIMIT = 8;

function topProb(prices: Record<string, string> | null | undefined): number | null {
  const values = Object.values(prices ?? {})
    .map(Number)
    .filter((n) => Number.isFinite(n));
  if (!values.length) {
    return null;
  }
  return Math.round(Math.max(...values) * 100);
}

function toItem(summary: MarketSummaryValue): RelatedItem {
  const category = summary.category as { key?: string | null; label?: string | null } | null;
  return {
    marketKey: summary.marketKey,
    href: summary.publicPath || `/markets/${encodeURIComponent(summary.marketKey)}`,
    title: summary.title,
    prob: topProb(summary.prices),
    categoryKey: category?.key ?? null,
    categoryLabel: category?.label ?? null,
    closeAt: summary.closeAt ?? null,
    marketStatus: summary.marketStatus
  };
}

/**
 * Related-markets read model — the tag co-graph. Given a market, returns its visible
 * tags (most-central first) and, per tag, the top co-tagged published markets, plus a
 * blended "all" panel. Ranking within a tag: same-family boost → close-window proximity
 * → volume → recency. Tags with no live peers are dropped (thin-content gate).
 */
export async function readRelatedMarkets(db: Queryable, marketId: string): Promise<RelatedMarketsResult> {
  const empty: RelatedMarketsResult = { tags: [], panels: {} };

  const selfRes = await db.query<{ market_family_key: string | null; close_at: Date; event_id: string | null }>(
    `select market_family_key, close_at, event_id from markets where id = $1`,
    [marketId]
  );
  const self = selfRes.rows[0];
  if (!self) {
    return empty;
  }

  const tagRes = await db.query<{ tag_id: string; slug: string; label: string; kind: string | null }>(
    `select t.id as tag_id, t.slug, t.label, t.kind
       from market_tags mt
       join tags t on t.id = mt.tag_id
      where mt.market_id = $1 and t.hidden = false
      order by mt.weight desc, t.label asc`,
    [marketId]
  );
  if (!tagRes.rows.length) {
    return empty;
  }

  const perTagIds = new Map<string, string[]>();
  const allIds = new Set<string>();
  for (const tag of tagRes.rows) {
    const peers = await db.query<{ market_id: string }>(
      `select mt.market_id
         from market_tags mt
         join markets m on m.id = mt.market_id
         left join market_pricing_state ps on ps.market_id = m.id
        where mt.tag_id = $1
          and mt.market_id <> $2
          and m.published_at is not null
          and ($5::text is null or m.event_id is distinct from $5)
        order by
          (m.market_family_key is not distinct from $3) desc,
          abs(extract(epoch from (m.close_at - $4))) asc,
          coalesce(ps.total_volume, 0) desc,
          m.published_at desc
        limit $6`,
      [tag.tag_id, marketId, self.market_family_key, self.close_at, self.event_id, PER_TAG_LIMIT]
    );
    const ids = peers.rows.map((row) => row.market_id);
    perTagIds.set(tag.slug, ids);
    for (const id of ids) {
      allIds.add(id);
    }
  }

  const summaries = await readMarketSummariesByIds(db, [...allIds]);

  const panels: Record<string, RelatedItem[]> = {};
  const visibleTags: RelatedTag[] = [];
  for (const tag of tagRes.rows) {
    const items = (perTagIds.get(tag.slug) ?? [])
      .map((id) => summaries.get(id))
      .filter((summary): summary is MarketSummaryValue => Boolean(summary))
      .map(toItem);
    if (!items.length) {
      continue;
    }
    panels[tag.slug] = items;
    visibleTags.push({ slug: tag.slug, label: tag.label, kind: tag.kind, count: items.length });
  }
  if (!visibleTags.length) {
    return empty;
  }

  // "All" = round-robin across visible tags, deduped by marketKey, capped.
  const seen = new Set<string>();
  const all: RelatedItem[] = [];
  for (let rank = 0; all.length < ALL_LIMIT; rank += 1) {
    let added = false;
    for (const tag of visibleTags) {
      const list = panels[tag.slug];
      const item = list[rank];
      if (item && !seen.has(item.marketKey)) {
        seen.add(item.marketKey);
        all.push(item);
        added = true;
        if (all.length >= ALL_LIMIT) {
          break;
        }
      }
    }
    if (!added) {
      break;
    }
  }
  panels.all = all;

  return { tags: visibleTags, panels };
}

export type TagPageResult = {
  tag: { slug: string; label: string; kind: string | null };
  markets: MarketSummaryValue[];
  relatedTags: PublicTagListItem[];
} | null;

/**
 * All published markets carrying a given tag slug, as card-identical summaries — the read
 * behind the indexable `/t/<slug>` entity hub. Returns null for an unknown or hidden tag
 * (the route 404s; the frontend then redirects unknown/thin slugs to the noindex `/search`
 * fallback, Poly-style). Gating (min market count) is applied at the presentation layer so
 * the raw count stays visible to the caller.
 */
export async function readTagPage(db: Queryable, slug: string): Promise<TagPageResult> {
  const normalized = String(slug || "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const tagRes = await db.query<{ id: string; slug: string; label: string; kind: string | null }>(
    `select id, slug, label, kind from tags where slug = $1 and hidden = false`,
    [normalized]
  );
  const tag = tagRes.rows[0];
  if (!tag) {
    return null;
  }

  const idRes = await db.query<{ market_id: string }>(
    `select mt.market_id
       from market_tags mt
       join markets m on m.id = mt.market_id
      where mt.tag_id = $1 and m.published_at is not null`,
    [tag.id]
  );
  const ids = idRes.rows.map((row) => row.market_id);
  const summaries = await readMarketSummariesByIds(db, ids);
  const markets = ids
    .map((id) => summaries.get(id))
    .filter((market): market is MarketSummaryValue => Boolean(market));

  // Sibling tags: other visible tags that co-occur on this tag's markets, each with its
  // OWN total published-market count so the frontend can gate cross-links to real hubs.
  const relatedRes = await db.query<{ slug: string; label: string; kind: string | null; count: string }>(
    `with sibling_ids as (
       select distinct mt2.tag_id
         from market_tags mt1
         join market_tags mt2 on mt2.market_id = mt1.market_id and mt2.tag_id <> mt1.tag_id
        where mt1.tag_id = $1
     )
     select t.slug, t.label, t.kind, count(m.id)::text as count
       from sibling_ids s
       join tags t on t.id = s.tag_id and t.hidden = false
       join market_tags mt on mt.tag_id = t.id
       join markets m on m.id = mt.market_id and m.published_at is not null
      group by t.slug, t.label, t.kind
      order by count(m.id) desc, t.slug asc`,
    [tag.id]
  );
  const relatedTags = relatedRes.rows.map((row) => ({
    slug: row.slug,
    label: row.label,
    kind: row.kind,
    count: Number(row.count) || 0
  }));

  return { tag: { slug: tag.slug, label: tag.label, kind: tag.kind }, markets, relatedTags };
}

/**
 * Populated entity tags whose published markets sit in a given category — powers the
 * category → entity cross-links on `/topics/<key>`. Takes the FRONTEND hub key and
 * resolves it to the market-level category key(s) (one hub can map to several, e.g.
 * entertainment→[entertainment,culture]). Includes each tag's published count so the
 * page can gate to indexable hubs and drop the category's own mirror tag.
 */
export async function readCategoryTags(db: Queryable, categoryKey: string): Promise<PublicTagListItem[]> {
  const normalized = String(categoryKey || "").trim();
  if (!normalized) {
    return [];
  }
  const keys = [...new Set([normalized, ...(resolveBackendCategoryKeys(normalized) ?? [])].filter(Boolean))];

  const res = await db.query<{ slug: string; label: string; kind: string | null; count: string }>(
    `select t.slug, t.label, t.kind, count(m.id)::text as count
       from tags t
       join market_tags mt on mt.tag_id = t.id
       join markets m on m.id = mt.market_id and m.published_at is not null and m.category_key = any($1::text[])
      where t.hidden = false
      group by t.slug, t.label, t.kind
      order by count(m.id) desc, t.slug asc`,
    [keys]
  );
  return res.rows.map((row) => ({
    slug: row.slug,
    label: row.label,
    kind: row.kind,
    count: Number(row.count) || 0
  }));
}

export type PublicTagListItem = { slug: string; label: string; kind: string | null; count: number };

/**
 * Every visible tag with its count of published markets — the source for the tag-hub
 * sitemap and any "browse tags" surface. Only counts markets that are actually published,
 * so the sitemap can gate on real, indexable population (mirrors the /t/<slug> gate).
 */
export async function readPublicTagList(db: Queryable): Promise<PublicTagListItem[]> {
  const res = await db.query<{ slug: string; label: string; kind: string | null; count: string }>(
    `select t.slug, t.label, t.kind, count(mt.market_id)::text as count
       from tags t
       join market_tags mt on mt.tag_id = t.id
       join markets m on m.id = mt.market_id and m.published_at is not null
      where t.hidden = false
      group by t.slug, t.label, t.kind
      order by count(mt.market_id) desc, t.slug asc`
  );
  return res.rows.map((row) => ({
    slug: row.slug,
    label: row.label,
    kind: row.kind,
    count: Number(row.count) || 0
  }));
}
