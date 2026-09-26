import { fetchPublicTagList } from '../../lib/tag-page.js';
import { getCategoryHub } from '../../lib/category-hubs.js';
import { buildAbsoluteUrl } from '../../lib/seo.js';
import { dedupeSitemapUrls, renderUrlset, sitemapXmlResponse } from '../../lib/sitemap.js';

// Entity tag hubs (/t/{slug}). Listed only when a tag is BOTH populated enough to
// earn an indexable page (>= MIN_MARKETS published markets) AND not a mirror of a
// /topics/ category hub (those slugs 301 to /topics/{key}, so listing /t/{key} would
// point at a redirect). Mirrors pages/t/[slug].astro's own routing gate so the
// sitemap never lists a URL that redirects. One backend call, fetched lazily per crawl.
const MIN_MARKETS = 3;

export async function GET() {
  const urls = [];

  try {
    const tags = await fetchPublicTagList();
    for (const tag of tags) {
      if (!tag?.slug || (tag.count ?? 0) < MIN_MARKETS) continue;
      if (getCategoryHub(tag.slug)) continue; // duplicates a /topics/ hub → excluded
      urls.push({
        loc: buildAbsoluteUrl(`/t/${encodeURIComponent(tag.slug)}`),
        changefreq: 'daily',
        priority: '0.7',
      });
    }
  } catch {
    // Degrade to an empty child rather than a crawler-facing 500.
  }

  return sitemapXmlResponse(renderUrlset(dedupeSitemapUrls(urls)));
}
