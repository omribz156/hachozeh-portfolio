import { fetchPublicProfileCatalog } from '../lib/public-profile-catalog.js';
import { buildAbsoluteUrl } from '../lib/seo.js';
import {
  buildProfileSitemapChildUrl,
  profileSitemapChunkCount,
  renderSitemapIndex,
  sitemapXmlResponse,
} from '../lib/sitemap.js';

// /sitemap.xml is a SITEMAP INDEX, not a flat urlset (growth-shape fix): it
// used to paginate the ENTIRE markets + users catalogs itself (sequential
// 100-row-page backend round trips, hard-capped at 100 pages), which both
// silently truncated large catalogs past the cap and cost one round trip per
// page on every uncached request. Now the index only needs the profile
// catalog's cheap total count to know how many chunk children exist — the
// static page + market + profile-chunk children each fetch their OWN content
// lazily, one backend call per child request (see sitemaps/markets.xml.js
// and sitemaps/profiles-[n].xml.js).
export async function GET() {
  const children = [
    { loc: buildAbsoluteUrl('/sitemaps/static.xml') },
    { loc: buildAbsoluteUrl('/sitemaps/markets.xml') },
    { loc: buildAbsoluteUrl('/sitemaps/series.xml') },
    { loc: buildAbsoluteUrl('/sitemaps/tags.xml') },
  ];

  try {
    const catalog = await fetchPublicProfileCatalog({ limit: 1, includeTotal: true });
    const total = catalog?.pagination?.total ?? 0;
    const chunkCount = profileSitemapChunkCount(total);
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      children.push({ loc: buildProfileSitemapChildUrl(chunkIndex) });
    }
  } catch {
    // Keep the index useful during local/backend outages. Static + markets
    // children are better than a crawler-facing 500; profile chunks resume
    // appearing once the backend recovers (cache-control keeps this short).
  }

  return sitemapXmlResponse(renderSitemapIndex(children));
}
