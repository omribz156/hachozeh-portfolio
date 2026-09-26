const DEFAULT_SITE_ORIGIN = 'https://hachozeh.com';
const DEFAULT_IMAGE_PATH = '/assets/brand/apple-touch-icon.png';
const WEBSITE_ID = '#website';

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function readSiteOrigin() {
  const configured = process.env.PUBLIC_SITE_ORIGIN || process.env.SITE_ORIGIN || DEFAULT_SITE_ORIGIN;

  try {
    return new URL(configured).origin;
  } catch {
    return DEFAULT_SITE_ORIGIN;
  }
}

export const SITE_ORIGIN = readSiteOrigin();
export const SITE_NAME = 'החוזה';
export const SITE_LANGUAGE = 'he-IL';
export const SITE_LOCALE = 'he_IL';
export const DEFAULT_SEO_DESCRIPTION = 'החוזה — שוק תחזיות עברי לניתוח אירועים, מחירים והסתברויות בזמן אמת.';
export const DEFAULT_OG_IMAGE = buildAbsoluteUrl(DEFAULT_IMAGE_PATH);

export function buildAbsoluteUrl(pathOrUrl = '/') {
  if (!pathOrUrl) return `${SITE_ORIGIN}/`;

  try {
    return new URL(pathOrUrl, `${trimTrailingSlash(SITE_ORIGIN)}/`).toString();
  } catch {
    return `${SITE_ORIGIN}/`;
  }
}

export function buildSocialImageUrl(pathOrUrl) {
  const value = compactText(pathOrUrl);
  if (!value) return DEFAULT_OG_IMAGE;

  const pathname = (() => {
    try {
      return new URL(value, `${trimTrailingSlash(SITE_ORIGIN)}/`).pathname;
    } catch {
      return value;
    }
  })();

  return /\.(png|jpe?g|webp)$/i.test(pathname) ? buildAbsoluteUrl(value) : DEFAULT_OG_IMAGE;
}

export function buildSocialImageMeta(pathOrUrl) {
  const imageUrl = buildSocialImageUrl(pathOrUrl);
  const path = (() => {
    try {
      return new URL(imageUrl).pathname;
    } catch {
      return '';
    }
  })();
  const isShareCard = /\/share\/(claims|markets|pages|profiles)\//i.test(path);
  const isRootOgImage = path === '/og-image.jpg';
  const isJpeg = /\.jpe?g$/i.test(path);
  const largeImage = isShareCard || isRootOgImage;

  return {
    url: imageUrl,
    type: isJpeg ? 'image/jpeg' : 'image/png',
    width: largeImage ? 1200 : 180,
    height: largeImage ? 630 : 180,
  };
}

export function buildCanonicalUrl(pathname = '/') {
  const path = String(pathname || '/').split('?')[0].split('#')[0] || '/';
  return buildAbsoluteUrl(path.startsWith('/') ? path : `/${path}`);
}

export function buildFeedUrl(pathname = '/') {
  return buildCanonicalUrl(pathname);
}

export function compactText(value, fallback = '') {
  return String(value || fallback || '').replace(/\s+/g, ' ').trim();
}

export function clampSeoText(value, maxLength, fallback = '') {
  const text = compactText(value, fallback);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

export function withLargeImagePreviewRobots(value = 'index, follow') {
  const robots = compactText(value, 'index, follow');
  return /(^|,\s*)max-image-preview:/i.test(robots)
    ? robots
    : `${robots}, max-image-preview:large`;
}

export function buildPageTitle(value) {
  const title = compactText(value, SITE_NAME);
  return title.includes(SITE_NAME) ? title : `${title} · ${SITE_NAME}`;
}

export function buildWebSiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': buildAbsoluteUrl(WEBSITE_ID),
    name: SITE_NAME,
    url: SITE_ORIGIN,
    inLanguage: SITE_LANGUAGE,
    description: DEFAULT_SEO_DESCRIPTION,
    // Advertises the /search endpoint so Google is eligible to render a Sitelinks
    // Searchbox under the brand result. The target is intentionally the noindex
    // /search page — Google uses this for the search feature, not for indexing.
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE_ORIGIN}/search?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

/**
 * @param {{ title?: string, description?: string, canonicalUrl?: string, imageUrl?: string, type?: string }} [opts]
 */
export function buildWebPageJsonLd({ title, description, canonicalUrl, imageUrl, type = 'WebPage' } = {}) {
  const pageUrl = canonicalUrl || SITE_ORIGIN;
  return {
    '@context': 'https://schema.org',
    '@type': type,
    '@id': `${pageUrl}#webpage`,
    name: compactText(title, SITE_NAME),
    description: compactText(description, DEFAULT_SEO_DESCRIPTION),
    url: pageUrl,
    inLanguage: SITE_LANGUAGE,
    image: imageUrl || DEFAULT_OG_IMAGE,
    isPartOf: {
      '@type': 'WebSite',
      '@id': buildAbsoluteUrl(WEBSITE_ID),
      name: SITE_NAME,
      url: SITE_ORIGIN,
      inLanguage: SITE_LANGUAGE,
    },
  };
}

export function buildBreadcrumbJsonLd({ items = [] } = {}) {
  const itemListElement = items
    .filter((item) => item?.name && item?.href)
    .map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: compactText(item.name),
      item: buildAbsoluteUrl(item.href),
    }));

  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement,
  };
}

/**
 * @param {{ name?: string, items?: any[] }} [opts]
 */
export function buildMarketItemListJsonLd({ name, items = [] } = {}) {
  const itemListElement = items
    .filter((item) => item?.marketKey || item?.href)
    .map((item, index) => {
      const href = item.href || `/markets/${encodeURIComponent(item.marketKey)}`;
      const url = buildAbsoluteUrl(href);
      const descriptionParts = [
        item.category?.label ? `קטגוריה: ${item.category.label}` : '',
        item.volume?.label ? `מחזור: ${item.volume.label}` : '',
        item.closeLabel ? `סגירה: ${item.closeLabel}` : '',
      ].filter(Boolean);

      return {
        '@type': 'ListItem',
        position: index + 1,
        item: {
          '@type': 'WebPage',
          name: compactText(item.title, 'שוק בהחוזה'),
          url,
          ...(descriptionParts.length ? { description: descriptionParts.join('. ') } : {}),
        },
      };
    });

  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: compactText(name, 'שווקים בהחוזה'),
    numberOfItems: itemListElement.length,
    itemListElement,
  };
}

/**
 * ProfilePage schema for a public forecaster profile (`/@handle`). Head-only — it
 * doesn't change the rendered page, it just tells search + AI assistants that this
 * page is ABOUT a specific person (name + handle), which the generic WebPage type
 * doesn't convey. Optional stats (followers/predictions) enrich it when available.
 *
 * @param {{ name?: string, handle?: string, canonicalUrl?: string, imageUrl?: string, description?: string, followers?: number, predictions?: number }} [opts]
 */
export function buildProfilePageJsonLd({ name, handle, canonicalUrl, imageUrl, description, followers, predictions } = {}) {
  const pageUrl = canonicalUrl || SITE_ORIGIN;
  const stats = [];
  if (Number.isFinite(followers)) {
    stats.push({ '@type': 'InteractionCounter', interactionType: 'https://schema.org/FollowAction', userInteractionCount: followers });
  }
  if (Number.isFinite(predictions)) {
    stats.push({ '@type': 'InteractionCounter', interactionType: 'https://schema.org/WriteAction', userInteractionCount: predictions });
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    '@id': `${pageUrl}#profilepage`,
    url: pageUrl,
    inLanguage: SITE_LANGUAGE,
    ...(description ? { description: compactText(description) } : {}),
    primaryImageOfPage: buildSocialImageUrl(imageUrl),
    mainEntity: {
      '@type': 'Person',
      name: compactText(name, SITE_NAME),
      ...(handle ? { alternateName: `@${handle}`, identifier: handle } : {}),
      url: pageUrl,
      image: buildSocialImageUrl(imageUrl),
      ...(stats.length ? { interactionStatistic: stats } : {}),
    },
    isPartOf: {
      '@type': 'WebSite',
      '@id': buildAbsoluteUrl(WEBSITE_ID),
      name: SITE_NAME,
      url: SITE_ORIGIN,
      inLanguage: SITE_LANGUAGE,
    },
  };
}

// Shared publisher/author identity for editorial schema (Article, etc.).
function buildOrganizationNode() {
  return {
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_ORIGIN,
    logo: {
      '@type': 'ImageObject',
      url: buildAbsoluteUrl(DEFAULT_IMAGE_PATH),
    },
  };
}

/**
 * Article schema for editorial help-center pages.
 *
 * Deliberately `Article`, NOT `FAQPage`: Google restricted FAQ rich results to
 * authoritative health/gov domains in 2023, so FAQPage earns no SERP snippet here —
 * and the only page where the answer text is visible is the article itself (a single
 * editorial article, not a visible Q&A list), so a FAQPage would be a mismatched-
 * content violation. `Article` is the honest fit and is what search + AI assistants
 * read (headline / dates / publisher / language) to understand and cite the page.
 *
 * @param {{ title?: string, description?: string, canonicalUrl?: string, imageUrl?: string, dateModified?: string|Date, section?: string, keywords?: string }} [opts]
 */
export function buildArticleJsonLd({ title, description, canonicalUrl, imageUrl, dateModified, section, keywords } = {}) {
  const pageUrl = canonicalUrl || SITE_ORIGIN;
  let iso;
  if (dateModified) {
    try {
      iso = new Date(dateModified).toISOString();
    } catch {
      iso = undefined;
    }
  }
  const org = buildOrganizationNode();
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    '@id': `${pageUrl}#article`,
    headline: compactText(title, SITE_NAME),
    description: compactText(description, DEFAULT_SEO_DESCRIPTION),
    inLanguage: SITE_LANGUAGE,
    url: pageUrl,
    mainEntityOfPage: { '@type': 'WebPage', '@id': `${pageUrl}#webpage` },
    image: buildSocialImageUrl(imageUrl),
    author: org,
    publisher: org,
    ...(section ? { articleSection: compactText(section) } : {}),
    ...(keywords ? { keywords: compactText(keywords) } : {}),
    ...(iso ? { datePublished: iso, dateModified: iso } : {}),
    isPartOf: {
      '@type': 'WebSite',
      '@id': buildAbsoluteUrl(WEBSITE_ID),
      name: SITE_NAME,
      url: SITE_ORIGIN,
      inLanguage: SITE_LANGUAGE,
    },
  };
}
