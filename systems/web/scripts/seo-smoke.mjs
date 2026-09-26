const astroBaseUrl = process.env.SEO_ASTRO_URL || process.env.STATUS_ASTRO_URL || 'http://127.0.0.1:4321';
const caddyBaseUrl = process.env.SEO_CADDY_URL || process.env.STATUS_CADDY_URL || 'http://127.0.0.1:6969';
const publicOrigin = new URL(process.env.PUBLIC_SITE_ORIGIN || process.env.SITE_ORIGIN || 'https://hachozeh.com').origin;
const timeoutMs = Number(process.env.SEO_TIMEOUT_MS || 5000);

const topicKeys = [
  'politics',
  'security',
  'economy',
  'sports',
  'crypto',
  'legislation',
  'technology',
  'entertainment',
  'climate',
  'health',
  'energy',
  'education',
  'people',
  'science',
  'fx',
];

const helpTopicPaths = [
  '/help/getting-started',
  '/help/markets',
  '/help/account-vshekel',
  '/help/portfolio',
  '/help/account-support',
  '/help/faq',
];

const publicStaticPaths = [
  '/help',
  '/terms',
  '/privacy',
  '/cookies',
  '/accessibility',
  '/graphs-and-accuracy',
  '/community',
];
const publicStaticImagePaths = Object.fromEntries(
  publicStaticPaths.map((path) => [path, `/share/pages/${path.replace(/^\//, '')}.png`])
);

function pass(name, detail = '') {
  console.log(`ok   ${name}${detail ? ` ${detail}` : ''}`);
}

function fail(name, detail = '') {
  console.error(`fail ${name}${detail ? ` ${detail}` : ''}`);
  process.exitCode = 1;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function text(path) {
  const response = await fetchWithTimeout(`${astroBaseUrl}${path}`);
  const body = await response.text();
  return { response, body };
}

function readMeta(html, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`<meta[^>]+${escaped}[^>]+content="([^"]+)"`, 'i'));
  return match?.[1] || '';
}

function readCanonical(html) {
  return html.match(/<link rel="canonical" href="([^"]+)"/i)?.[1] || '';
}

function readAlternates(html) {
  return [...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/gi)]
    .map((match) => ({ lang: match[1], href: match[2] }));
}

function readAlternateFeeds(html) {
  return [...html.matchAll(/<link rel="alternate" type="([^"]+)" title="([^"]+)" href="([^"]+)"/gi)]
    .map((match) => ({ type: match[1], title: match[2], href: match[3] }));
}

function readJsonLdTypes(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)]
    .map((match) => JSON.parse(match[1]))
    .map((item) => item['@type']);
}

async function expectPage({
  path,
  canonicalPath,
  jsonLdTypes = [],
  robots = 'index, follow, max-image-preview:large',
  imagePath = '',
}) {
  const { response, body } = await text(path);
  const expectedCanonical = new URL(canonicalPath, publicOrigin).toString();
  const expectedImage = imagePath ? new URL(imagePath, publicOrigin).toString() : '';
  const canonical = readCanonical(body);
  const alternates = readAlternates(body);
  const types = readJsonLdTypes(body);
  const robotsMeta = readMeta(body, 'name="robots"');
  const ogLocale = readMeta(body, 'property="og:locale"');
  const ogImage = readMeta(body, 'property="og:image"');
  const ogImageWidth = readMeta(body, 'property="og:image:width"');
  const ogImageHeight = readMeta(body, 'property="og:image:height"');

  const ok =
    response.status === 200 &&
    canonical === expectedCanonical &&
    robotsMeta === robots &&
    ogLocale === 'he_IL' &&
    (!expectedImage || (
      ogImage === expectedImage &&
      ogImageWidth === '1200' &&
      ogImageHeight === '630'
    )) &&
    alternates.some((item) => item.lang === 'he-IL' && item.href === expectedCanonical) &&
    alternates.some((item) => item.lang === 'x-default' && item.href === expectedCanonical) &&
    jsonLdTypes.every((type) => types.includes(type));

  if (ok) {
    pass(`page ${path}`, `${response.status} ${types.join(',')}`);
  } else {
    fail(
      `page ${path}`,
      JSON.stringify({ status: response.status, canonical, expectedCanonical, robotsMeta, ogLocale, ogImage, expectedImage, ogImageWidth, ogImageHeight, alternates, types })
    );
  }
}

async function expectFeedLink(pagePath, feedPath) {
  const { response, body } = await text(pagePath);
  const feeds = readAlternateFeeds(body);
  const expectedFeedUrl = new URL(feedPath, publicOrigin).toString();
  const ok =
    response.status === 200 &&
    feeds.some((feed) => feed.type === 'application/rss+xml' && feed.href === expectedFeedUrl);

  ok
    ? pass(`feed-link ${pagePath}`, feedPath)
    : fail(`feed-link ${pagePath}`, JSON.stringify({ status: response.status, expectedFeedUrl, feeds }));
}

async function expectRssFeed(path, expectedLinkPath, { requireItem = true } = {}) {
  const { response, body } = await text(path);
  const contentType = response.headers.get('content-type') || '';
  const expectedLink = new URL(expectedLinkPath, publicOrigin).toString();
  const bodyWithoutUrls = body.replace(/<(link|guid)\b[^>]*>.*?<\/\1>/gis, '');
  const ok =
    response.status === 200 &&
    contentType.includes('application/rss+xml') &&
    body.includes('<rss version="2.0">') &&
    body.includes(`<link>${expectedLink}</link>`) &&
    (!requireItem || body.includes('<item>')) &&
    !/(Frontend|handoff|Image-bucket|visual-check-market|קלט)/i.test(bodyWithoutUrls);

  ok
    ? pass(`rss ${path}`, contentType)
    : fail(`rss ${path}`, JSON.stringify({ status: response.status, contentType, expectedLink }));
}

async function expectRedirect(path, expectedPath) {
  const response = await fetchWithTimeout(`${astroBaseUrl}${path}`, { redirect: 'manual' });
  const location = response.headers.get('location') || '';
  if (response.status === 301 && location.endsWith(expectedPath)) {
    pass(`redirect ${path}`, `301 ${location}`);
  } else {
    fail(`redirect ${path}`, `${response.status} ${location}`);
  }
}

async function firstMarketEntry() {
  const response = await fetchWithTimeout(`${caddyBaseUrl}/api/discovery/feed`);
  if (!response.ok) throw new Error(`discovery feed HTTP ${response.status}`);
  const payload = await response.json();
  const item = payload?.items?.find((candidate) => candidate?.marketKey);
  if (!item?.marketKey) throw new Error('discovery feed did not include a marketKey');
  return {
    marketKey: item.marketKey,
    path: item.href || item.publicPath || `/markets/${encodeURIComponent(item.marketKey)}`,
  };
}

async function firstPublicProfileHandle() {
  const response = await fetchWithTimeout(`${caddyBaseUrl}/api/social/profiles?limit=1`);
  if (!response.ok) return null;
  const payload = await response.json();
  return payload?.profiles?.[0]?.handle || null;
}

async function expectMarketPage({ marketKey, path }) {
  const { response, body } = await text(path);
  const canonical = readCanonical(body);
  const expectedCanonical = new URL(path, publicOrigin).toString();
  const ogImage = readMeta(body, 'property="og:image"');
  const ogImageWidth = readMeta(body, 'property="og:image:width"');
  const ogImageHeight = readMeta(body, 'property="og:image:height"');
  const types = readJsonLdTypes(body);
  const noDuplicateUi = !body.includes('תקציר השוק') && !body.includes('שווקים קשורים');

  if (
    response.status === 200 &&
    canonical === expectedCanonical &&
    ogImage.endsWith(`/share/markets/${encodeURIComponent(marketKey)}.png`) &&
    ogImageWidth === '1200' &&
    ogImageHeight === '630' &&
    types.includes('WebSite') &&
    types.includes('WebPage') &&
    types.includes('BreadcrumbList') &&
    types.includes('ItemList') &&
    noDuplicateUi
  ) {
    pass(`market ${marketKey}`, `${path} ${types.join(',')}`);
  } else {
    fail(`market ${marketKey}`, JSON.stringify({ status: response.status, canonical, expectedCanonical, ogImage, ogImageWidth, ogImageHeight, types, noDuplicateUi }));
  }
}

async function expectEventRewrite() {
  // The canonical public market URL is `/event/{slug}`, served 100% via Astro.rewrite
  // (event/[slug].astro → markets/[marketKey]). A rewrite/resolution regression
  // silently breaks the CANONICAL, indexed URL (falls to the noindex "שוק לא נמצא"
  // error page) while the `/markets/{key}` fallback keeps working — an inversion that
  // would deindex live pages. Guard the event path explicitly so a regression fails CI.
  const sitemap = await text('/sitemaps/markets.xml');
  const eventPath = [...sitemap.body.matchAll(/<loc>[^<]*?(\/event\/[^<]+?)<\/loc>/g)]
    .map((match) => match[1])
    .find((path) => !path.endsWith('.png'));
  if (!eventPath) {
    pass('event rewrite', 'no /event/ URLs in sitemap');
    return;
  }
  const { response, body } = await text(eventPath);
  const robotsMeta = readMeta(body, 'name="robots"');
  const types = readJsonLdTypes(body);
  const ok =
    response.status === 200 &&
    robotsMeta.startsWith('index') && // NOT the noindex error fallback
    !body.includes('שוק לא נמצא') && // NOT the "market not found" copy
    types.includes('WebPage') &&
    types.includes('BreadcrumbList');
  ok
    ? pass('event rewrite', `${eventPath} ${response.status}`)
    : fail('event rewrite', JSON.stringify({ eventPath, status: response.status, robotsMeta, types }));
}

async function expectMarketsIndex() {
  // /markets is the all-markets crawl BRIDGE: its whole value is server-rendered
  // <a href> links to every market/event hub, independent of the homepage's
  // rotating slice. A regression that drops the anchors (e.g. cards go client-only)
  // or 500s the page silently removes the durable internal-link path and quietly
  // strands the long tail — guard the anchors + schema + sitemap loc explicitly.
  const { response, body } = await text('/markets');
  const canonical = readCanonical(body);
  const types = readJsonLdTypes(body);
  const anchorCount = (body.match(/class="allmk__link/g) || []).length;
  const sitemap = await text('/sitemaps/static.xml');
  const ok =
    response.status === 200 &&
    canonical === `${publicOrigin}/markets` &&
    types.includes('CollectionPage') &&
    types.includes('ItemList') &&
    types.includes('BreadcrumbList') &&
    anchorCount > 0 &&
    sitemap.body.includes(`${publicOrigin}/markets<`);
  ok
    ? pass('markets index', `${anchorCount} hub links`)
    : fail('markets index', JSON.stringify({ status: response.status, canonical, types, anchorCount }));
}

async function expectShareImage(marketKey) {
  const response = await fetchWithTimeout(`${astroBaseUrl}/share/markets/${encodeURIComponent(marketKey)}.png`, {
    method: 'HEAD',
  });
  const contentType = response.headers.get('content-type') || '';
  if (response.status === 200 && contentType.includes('image/png')) {
    pass(`share-image ${marketKey}`, contentType);
  } else {
    fail(`share-image ${marketKey}`, `${response.status} ${contentType}`);
  }
}

async function expectRobotsAndSitemap({ marketKey } = {}) {
  const robots = await text('/robots.txt');
  const sitemap = await text('/sitemap.xml');
  const expectedMarketImage = marketKey
    ? `${publicOrigin}/share/markets/${encodeURIComponent(marketKey)}.png`
    : '';
  const sitemapLocs = [...sitemap.body.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
  const duplicateSitemapLocs = sitemapLocs.filter((loc, index) => sitemapLocs.indexOf(loc) !== index);
  const robotsOk =
    robots.response.status === 200 &&
    robots.body.includes('Disallow: /admin') &&
    robots.body.includes('Disallow: /fallback') &&
    robots.body.includes('User-agent: OAI-SearchBot') &&
    robots.body.includes('User-agent: GPTBot') &&
    robots.body.includes('User-agent: ClaudeBot') &&
    robots.body.includes('User-agent: PerplexityBot') &&
    robots.body.includes(`${publicOrigin}/llms.txt`) &&
    robots.body.includes(`${publicOrigin}/llms-full.txt`) &&
    robots.body.includes(`${publicOrigin}/sitemap.xml`);
  const sitemapOk =
    sitemap.response.status === 200 &&
    sitemap.body.includes('<urlset') &&
    sitemap.body.includes('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"') &&
    sitemap.body.includes(`${publicOrigin}/og-image.jpg`) &&
    publicStaticPaths.every((path) => sitemap.body.includes(`${publicOrigin}${path}`)) &&
    helpTopicPaths.every((path) => sitemap.body.includes(`${publicOrigin}${path}`)) &&
    sitemap.body.includes(`${publicOrigin}/help/getting-started/what-is-hachozeh`) &&
    topicKeys.every((key) => sitemap.body.includes(`${publicOrigin}/topics/${key}`)) &&
    duplicateSitemapLocs.length === 0 &&
    (!expectedMarketImage || sitemap.body.includes(expectedMarketImage));

  robotsOk ? pass('robots.txt') : fail('robots.txt');
  sitemapOk
    ? pass('sitemap.xml', `${topicKeys.length} topics`)
    : fail('sitemap.xml', JSON.stringify({ duplicateSitemapLocs: duplicateSitemapLocs.slice(0, 5) }));
}

async function expectLlmsTxt() {
  const { response, body } = await text('/llms.txt');
  const full = await text('/llms-full.txt');
  const contentType = response.headers.get('content-type') || '';
  const fullContentType = full.response.headers.get('content-type') || '';
  const ok =
    response.status === 200 &&
    contentType.includes('text/plain') &&
    body.includes('Hachozeh') &&
    body.includes(`[Home / trending markets](${publicOrigin}/)`) &&
    body.includes(`[/sitemap.xml](${publicOrigin}/sitemap.xml)`) &&
    body.includes(`[/llms-full.txt](${publicOrigin}/llms-full.txt)`) &&
    body.includes(`[/@{handle}](${publicOrigin}/@{handle})`);
  const fullOk =
    full.response.status === 200 &&
    fullContentType.includes('text/plain') &&
    full.body.includes('# Hachozeh AI Assistant Guide') &&
    full.body.includes(`[Trending RSS](${publicOrigin}/feeds/trending.xml)`) &&
    full.body.includes('V₪ cannot be bought, deposited, withdrawn, or converted to real money.');

  ok ? pass('llms.txt', contentType) : fail('llms.txt', JSON.stringify({ status: response.status, contentType }));
  fullOk ? pass('llms-full.txt', fullContentType) : fail('llms-full.txt', JSON.stringify({ status: full.response.status, fullContentType }));
}

async function expectProfileSitemap(profileHandle) {
  if (!profileHandle) {
    pass('profile sitemap', 'no public profiles returned');
    return;
  }

  const sitemap = await text('/sitemap.xml');
  const encodedHandle = encodeURIComponent(profileHandle);
  const expectedProfile = `${publicOrigin}/@${encodedHandle}`;
  const expectedImage = `${publicOrigin}/share/profiles/${encodedHandle}.png`;
  const ok =
    sitemap.response.status === 200 &&
    sitemap.body.includes(expectedProfile) &&
    sitemap.body.includes(expectedImage);

  ok
    ? pass('profile sitemap', profileHandle)
    : fail('profile sitemap', JSON.stringify({ status: sitemap.response.status, expectedProfile, expectedImage }));
}

await expectPage({
  path: '/',
  canonicalPath: '/',
  imagePath: '/og-image.jpg',
  jsonLdTypes: ['WebSite', 'CollectionPage', 'BreadcrumbList', 'ItemList'],
});
await expectFeedLink('/', '/feeds/trending.xml');
await expectPage({
  path: '/breaking-markets',
  canonicalPath: '/breaking-markets',
  imagePath: '/share/pages/breaking-markets.png',
  jsonLdTypes: ['WebSite', 'CollectionPage', 'BreadcrumbList', 'ItemList'],
});
await expectFeedLink('/breaking-markets', '/feeds/breaking.xml');
for (const key of topicKeys) {
  await expectPage({
    path: `/topics/${key}`,
    canonicalPath: `/topics/${key}`,
    imagePath: `/share/pages/topics/${key}.png`,
    jsonLdTypes: ['WebSite', 'CollectionPage', 'BreadcrumbList', 'ItemList'],
  });
}
await expectFeedLink('/topics/sports', '/feeds/topics/sports.xml');

for (const path of publicStaticPaths) {
  await expectPage({
    path,
    canonicalPath: path,
    imagePath: publicStaticImagePaths[path],
    jsonLdTypes: path === '/community'
      ? ['WebSite', 'CollectionPage', 'BreadcrumbList']
      : ['WebSite', 'WebPage'],
  });
}
for (const path of helpTopicPaths) {
  await expectPage({
    path,
    canonicalPath: path,
    imagePath: '/share/pages/help.png',
    jsonLdTypes: ['WebSite', 'WebPage'],
  });
}
await expectPage({
  path: '/help/getting-started/what-is-hachozeh',
  canonicalPath: '/help/getting-started/what-is-hachozeh',
  imagePath: '/share/pages/help.png',
  jsonLdTypes: ['WebSite', 'WebPage'],
});

await expectRedirect('/trending?category=sports', '/topics/sports');
await expectRedirect('/trending?category=technology', '/topics/technology');
await expectRedirect('/trending', '/');
await expectRedirect('/breaking-markets.html', '/breaking-markets');
// Q&A retired 2026-06-09 → folded into the Help Center (/help).
await expectRedirect('/qanda.html', '/help');
await expectRedirect('/qanda', '/help');

const marketEntry = await firstMarketEntry();
const profileHandle = await firstPublicProfileHandle();
await expectMarketPage(marketEntry);
await expectEventRewrite();
await expectMarketsIndex();
await expectShareImage(marketEntry.marketKey);
await expectRobotsAndSitemap({ marketKey: marketEntry.marketKey });
await expectLlmsTxt();
await expectProfileSitemap(profileHandle);
await expectRssFeed('/feeds/trending.xml', '/');
await expectRssFeed('/feeds/breaking.xml', '/breaking-markets', { requireItem: false });
await expectRssFeed('/feeds/topics/sports.xml', '/topics/sports');

if (process.exitCode) process.exit(process.exitCode);
