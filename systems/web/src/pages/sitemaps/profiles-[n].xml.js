import { fetchPublicProfileCatalog } from '../../lib/public-profile-catalog.js';
import { buildAbsoluteUrl } from '../../lib/seo.js';
import {
  PROFILE_SITEMAP_CHUNK_SIZE,
  dedupeSitemapUrls,
  renderUrlset,
  sitemapXmlResponse,
} from '../../lib/sitemap.js';

function parseChunkIndex(param) {
  const raw = String(param ?? '').replace(/\.xml$/i, '');
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

// One backend round trip per chunk: offset = n * PROFILE_SITEMAP_CHUNK_SIZE
// addresses chunk n directly (see readPublicProfileCatalog's offset option),
// so crawlers fetching /sitemaps/profiles-7.xml never pay for chunks 0-6.
export async function GET({ params }) {
  const chunkIndex = parseChunkIndex(params.n);
  if (chunkIndex === null) return new Response('Not found', { status: 404 });

  const urls = [];

  try {
    const catalog = await fetchPublicProfileCatalog({
      limit: PROFILE_SITEMAP_CHUNK_SIZE,
      offset: chunkIndex * PROFILE_SITEMAP_CHUNK_SIZE,
    });
    const profiles = Array.isArray(catalog?.profiles) ? catalog.profiles : [];

    for (const profile of profiles) {
      if (!profile?.handle) continue;
      urls.push({
        loc: buildAbsoluteUrl(`/@${encodeURIComponent(profile.handle)}`),
        lastmod: profile.updatedAt || undefined,
        changefreq: 'weekly',
        priority: '0.5',
        images: [{
          loc: buildAbsoluteUrl(`/share/profiles/${encodeURIComponent(profile.handle)}.png`),
          title: profile.displayName || profile.handle,
        }],
      });
    }
  } catch {
    // Backend outage on this chunk shouldn't 500 — an empty chunk is fine,
    // other chunks and the index stay servable independently.
  }

  return sitemapXmlResponse(renderUrlset(dedupeSitemapUrls(urls)));
}
