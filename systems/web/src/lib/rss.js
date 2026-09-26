import {
  DEFAULT_OG_IMAGE,
  DEFAULT_SEO_DESCRIPTION,
  SITE_LANGUAGE,
  SITE_NAME,
  SITE_ORIGIN,
  buildAbsoluteUrl,
  clampSeoText,
  compactText,
} from './seo.js';

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function rssDate(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toUTCString() : date.toUTCString();
}

function marketDescription(item) {
  const outcomes = Array.isArray(item?.preview?.topOutcomes) ? item.preview.topOutcomes : item?.outcomes || [];
  const outcomeText = outcomes
    .slice(0, 4)
    .map((outcome) => {
      const label = compactText(outcome.label || outcome.shortLabel || outcome.outcomeKey);
      const probability = compactText(outcome.displayProbability);
      return [label, probability].filter(Boolean).join(' ');
    })
    .filter(Boolean)
    .join(', ');
  const parts = [
    `שוק תחזיות בהחוזה: ${compactText(item?.title, 'שוק פעיל')}`,
    item?.category?.label ? `קטגוריה: ${item.category.label}` : '',
    item?.volume?.label ? `מחזור: ${item.volume.label}` : '',
    item?.closeLabel ? `סגירה: ${item.closeLabel}` : '',
    outcomeText ? `תוצאות מובילות: ${outcomeText}` : '',
  ].filter(Boolean);

  return clampSeoText(parts.join('. '), 360, DEFAULT_SEO_DESCRIPTION);
}

function renderItem(item) {
  const title = compactText(item?.title, 'שוק בהחוזה');
  const path = item.href || item.publicPath || `/markets/${encodeURIComponent(item.marketKey)}`;
  const link = buildAbsoluteUrl(path);
  const pubDate = rssDate(item.updatedAt || item.publishedAt || item.lifecycle?.updatedAt || item.lifecycle?.publishedAt);

  return [
    '    <item>',
    `      <title>${escapeXml(title)}</title>`,
    `      <link>${escapeXml(link)}</link>`,
    `      <guid isPermaLink="true">${escapeXml(link)}</guid>`,
    `      <description>${escapeXml(marketDescription(item))}</description>`,
    item?.category?.label ? `      <category>${escapeXml(item.category.label)}</category>` : '',
    `      <pubDate>${escapeXml(pubDate)}</pubDate>`,
    '    </item>',
  ].filter(Boolean).join('\n');
}

export function renderMarketRssFeed({
  title,
  description,
  path,
  items = [],
} = {}) {
  const link = buildAbsoluteUrl(path || '/');
  const feedTitle = compactText(title, SITE_NAME);
  const feedDescription = compactText(description, DEFAULT_SEO_DESCRIPTION);

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    '  <channel>',
    `    <title>${escapeXml(feedTitle)}</title>`,
    `    <link>${escapeXml(link)}</link>`,
    `    <description>${escapeXml(feedDescription)}</description>`,
    `    <language>${escapeXml(SITE_LANGUAGE)}</language>`,
    `    <lastBuildDate>${escapeXml(new Date().toUTCString())}</lastBuildDate>`,
    `    <generator>${escapeXml(SITE_NAME)}</generator>`,
    '    <image>',
    `      <url>${escapeXml(DEFAULT_OG_IMAGE)}</url>`,
    `      <title>${escapeXml(SITE_NAME)}</title>`,
    `      <link>${escapeXml(SITE_ORIGIN)}</link>`,
    '    </image>',
    ...items.filter((item) => item?.marketKey).map(renderItem),
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');
}

export function rssResponse(body, { maxAge = 300 } = {}) {
  return new Response(body, {
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      'cache-control': `public, max-age=${maxAge}`,
    },
  });
}
