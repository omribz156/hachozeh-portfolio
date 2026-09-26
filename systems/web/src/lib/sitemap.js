import { SITE_ORIGIN, buildAbsoluteUrl } from './seo.js';

export function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function renderSitemapUrl({ loc, lastmod, changefreq, priority, images = [] }) {
  return [
    '  <url>',
    `    <loc>${escapeXml(loc)}</loc>`,
    lastmod ? `    <lastmod>${escapeXml(lastmod)}</lastmod>` : '',
    changefreq ? `    <changefreq>${escapeXml(changefreq)}</changefreq>` : '',
    priority ? `    <priority>${escapeXml(priority)}</priority>` : '',
    ...images.map((image) => [
      '    <image:image>',
      `      <image:loc>${escapeXml(image.loc)}</image:loc>`,
      image.title ? `      <image:title>${escapeXml(image.title)}</image:title>` : '',
      '    </image:image>',
    ].filter(Boolean).join('\n')),
    '  </url>',
  ].filter(Boolean).join('\n');
}

export function renderUrlset(urls) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
    ...urls.map(renderSitemapUrl),
    '</urlset>',
    '',
  ].join('\n');
}

export function renderSitemapIndex(children) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...children.map(({ loc, lastmod }) => [
      '  <sitemap>',
      `    <loc>${escapeXml(loc)}</loc>`,
      lastmod ? `    <lastmod>${escapeXml(lastmod)}</lastmod>` : '',
      '  </sitemap>',
    ].filter(Boolean).join('\n')),
    '</sitemapindex>',
    '',
  ].join('\n');
}

export function sitemapXmlResponse(body, { maxAge = 900 } = {}) {
  return new Response(body, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': `public, max-age=${maxAge}`,
      'x-sitemap-origin': SITE_ORIGIN,
    },
  });
}

const CHANGEFREQ_RANK = new Map([
  ['always', 7],
  ['hourly', 6],
  ['daily', 5],
  ['weekly', 4],
  ['monthly', 3],
  ['yearly', 2],
  ['never', 1],
]);

function pickLatestLastmod(a, b) {
  if (!a) return b;
  if (!b) return a;
  const aTime = Date.parse(a);
  const bTime = Date.parse(b);
  if (Number.isFinite(aTime) && Number.isFinite(bTime)) {
    return bTime > aTime ? b : a;
  }
  return String(b) > String(a) ? b : a;
}

function pickHigherPriority(a, b) {
  const aValue = Number.parseFloat(a);
  const bValue = Number.parseFloat(b);
  if (!Number.isFinite(aValue)) return b;
  if (!Number.isFinite(bValue)) return a;
  return bValue > aValue ? b : a;
}

function pickMoreFrequentChangefreq(a, b) {
  const aRank = CHANGEFREQ_RANK.get(a) ?? 0;
  const bRank = CHANGEFREQ_RANK.get(b) ?? 0;
  return bRank > aRank ? b : a;
}

function mergeImages(existing = [], incoming = []) {
  const byLoc = new Map();
  for (const image of [...existing, ...incoming]) {
    if (!image?.loc) continue;
    const current = byLoc.get(image.loc) || { loc: image.loc };
    byLoc.set(image.loc, {
      ...current,
      title: current.title || image.title || undefined,
    });
  }
  return [...byLoc.values()];
}

export function dedupeSitemapUrls(urls) {
  const byLoc = new Map();

  for (const url of urls) {
    if (!url?.loc) continue;
    const current = byLoc.get(url.loc);
    if (!current) {
      byLoc.set(url.loc, {
        ...url,
        images: mergeImages([], url.images),
      });
      continue;
    }

    byLoc.set(url.loc, {
      ...current,
      lastmod: pickLatestLastmod(current.lastmod, url.lastmod),
      changefreq: pickMoreFrequentChangefreq(current.changefreq, url.changefreq),
      priority: pickHigherPriority(current.priority, url.priority),
      images: mergeImages(current.images, url.images),
    });
  }

  return [...byLoc.values()];
}

// Sitemap-index chunking (growth-shape fix): the profile catalog is chunked
// so each `/sitemaps/profiles-<n>.xml` child request costs exactly one
// backend round trip (PUBLIC_PROFILE_CATALOG_LIMIT rows via offset = n * limit),
// instead of the old sitemap.xml walking the ENTIRE catalog on every uncached
// request. Sitemap spec allows up to 50,000 URLs per file; this stays far
// under that per chunk.
export const PROFILE_SITEMAP_CHUNK_SIZE = 1000;

export function profileSitemapChunkCount(total) {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.ceil(total / PROFILE_SITEMAP_CHUNK_SIZE);
}

export function profileSitemapChildPath(chunkIndex) {
  return `/sitemaps/profiles-${chunkIndex}.xml`;
}

export function buildProfileSitemapChildUrl(chunkIndex) {
  return buildAbsoluteUrl(profileSitemapChildPath(chunkIndex));
}
