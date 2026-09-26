import { fetchPublicMarketCatalog } from '../../lib/public-market-catalog.js';
import { buildAbsoluteUrl } from '../../lib/seo.js';
import { dedupeSitemapUrls, renderUrlset, sitemapXmlResponse } from '../../lib/sitemap.js';

// One backend round trip per request: MAX_MARKET_LIMIT (1000) comfortably
// covers the whole public markets catalog at current scale (~186 markets).
// If the catalog ever grows past one page, `nextCursor` is logged rather than
// silently dropped — that's a visible signal to raise MAX_MARKET_LIMIT or
// split this child into its own chunked children, not a silent truncation.
export async function GET() {
  const urls = [];

  try {
    const catalog = await fetchPublicMarketCatalog({ status: 'all', limit: 1000, sort: 'id_asc' });
    const markets = Array.isArray(catalog?.markets) ? catalog.markets : [];

    if (catalog?.pagination?.nextCursor) {
      console.error('sitemaps/markets.xml: catalog exceeded one page — markets are being truncated', {
        nextCursor: catalog.pagination.nextCursor,
        pageSize: markets.length,
      });
    }

    for (const market of markets) {
      if (!market?.marketKey) continue;
      const marketPath = market.publicPath || `/markets/${encodeURIComponent(market.marketKey)}`;
      urls.push({
        loc: buildAbsoluteUrl(marketPath),
        lastmod: market.updatedAt || market.publishedAt || undefined,
        changefreq: market.marketStatus === 'open' ? 'hourly' : 'weekly',
        priority: market.marketStatus === 'open' ? '0.9' : '0.6',
        images: [{
          loc: buildAbsoluteUrl(`/share/markets/${encodeURIComponent(market.marketKey)}.png`),
          title: market.title || market.trust?.contract?.measurement || undefined,
        }],
      });
    }
  } catch {
    // Keep this child useful during local/backend outages rather than a
    // crawler-facing 500 — an empty markets sitemap on a bad request is
    // better than the whole index failing.
  }

  return sitemapXmlResponse(renderUrlset(dedupeSitemapUrls(urls)));
}
