import { FAMILY_HUBS, familyHubPath } from '../../lib/family-hubs.js';
import { fetchMarketFamily } from '../../lib/market-family.js';
import { buildAbsoluteUrl } from '../../lib/seo.js';
import { dedupeSitemapUrls, renderUrlset, sitemapXmlResponse } from '../../lib/sitemap.js';

// Recurring-series hub URLs (/series/{familyKey}). Included only when a family is BOTH
// curated (lib/family-hubs.js) AND currently resolves to >= 2 published instances —
// mirrors the page's own eligibility gate so the sitemap never lists a hub that 404s.
// One backend call per registered family (a handful), fetched lazily per crawl.
export async function GET() {
  const urls = [];

  for (const family of FAMILY_HUBS) {
    try {
      const data = await fetchMarketFamily(family.familyKey);
      if ((data?.count ?? 0) >= 2) {
        urls.push({
          loc: buildAbsoluteUrl(familyHubPath(family.familyKey)),
          changefreq: 'daily',
          priority: '0.7',
        });
      }
    } catch {
      // Skip on backend outage — better to omit than to list a hub that may 404.
    }
  }

  return sitemapXmlResponse(renderUrlset(dedupeSitemapUrls(urls)));
}
