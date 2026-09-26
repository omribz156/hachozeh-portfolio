import type { Queryable } from "../db/client/pool";
import { resolveCanonicalMarketKeyById } from "../shared/market-identity";
import {
  buildAbsolutePublicUrl,
  pingIndexNow,
  type IndexNowLogger
} from "./indexnow-service";

type MarketIndexNowRow = {
  event_slug: string | null;
  tag_slugs: string[] | null;
};

export function buildMarketIndexNowUrls(
  marketId: string,
  row: MarketIndexNowRow
): string[] {
  const eventSlug = row.event_slug?.trim();
  const marketKey = resolveCanonicalMarketKeyById(marketId) ?? marketId;
  const marketPath = eventSlug
    ? `/event/${encodeURIComponent(eventSlug)}`
    : `/markets/${encodeURIComponent(marketKey)}`;
  const tagPaths = (row.tag_slugs ?? [])
    .map((slug) => slug.trim())
    .filter(Boolean)
    .map((slug) => `/t/${encodeURIComponent(slug)}`);

  return [...new Set([marketPath, ...tagPaths])].map(buildAbsolutePublicUrl);
}

async function readMarketIndexNowUrls(db: Queryable, marketId: string): Promise<string[]> {
  const result = await db.query<MarketIndexNowRow>(
    `
      select
        e.slug as event_slug,
        coalesce(
          array_agg(distinct t.slug) filter (where t.slug is not null and t.hidden = false),
          '{}'::text[]
        ) as tag_slugs
      from markets m
      left join events e on e.id = m.event_id
      left join market_tags mt on mt.market_id = m.id
      left join tags t on t.id = mt.tag_id
      where m.id = $1
      group by e.slug
    `,
    [marketId]
  );
  const row = result.rows[0];

  return row ? buildMarketIndexNowUrls(marketId, row) : [];
}

/**
 * Resolve a market's public event/tag URLs after lifecycle commit, then notify IndexNow.
 * Both the database read and the network request are best-effort. Failures emit warnings but never
 * reach the caller or affect lifecycle success.
 */
export function pingMarketIndexNow(
  db: Queryable,
  marketId: string,
  logger: IndexNowLogger = console
): void {
  void readMarketIndexNowUrls(db, marketId)
    .then((urls) => pingIndexNow(urls, logger))
    .catch((error) => {
      logger.warn?.("indexnow.market_url_lookup_failed", {
        marketId,
        error: String(error)
      });
    });
}
