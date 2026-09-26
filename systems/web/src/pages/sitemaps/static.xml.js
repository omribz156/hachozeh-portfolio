import { PUBLIC_CATEGORY_HUBS, categoryHubPath } from '../../lib/category-hubs.js';
import { getCollection } from 'astro:content';
import {
  HELP_TOPICS,
  articleSlugFromId,
  helpArticlePath,
  helpTopicPath,
  publishedHelpEntries,
} from '../../lib/help-content.js';
import { buildAbsoluteUrl } from '../../lib/seo.js';
import { dedupeSitemapUrls, renderUrlset, sitemapXmlResponse } from '../../lib/sitemap.js';

const STATIC_PUBLIC_ROUTES = [
  {
    path: '/',
    priority: '1.0',
    changefreq: 'hourly',
    images: [{ loc: buildAbsoluteUrl('/og-image.jpg'), title: 'החוזה' }],
  },
  { path: '/closing-markets', priority: '0.8', changefreq: 'hourly' },
  { path: '/breaking-markets', priority: '0.8', changefreq: 'hourly' },
  { path: '/help', priority: '0.5', changefreq: 'weekly' },
  { path: '/terms', priority: '0.3', changefreq: 'monthly' },
  { path: '/privacy', priority: '0.3', changefreq: 'monthly' },
  { path: '/cookies', priority: '0.3', changefreq: 'monthly' },
  { path: '/accessibility', priority: '0.3', changefreq: 'monthly' },
  { path: '/graphs-and-accuracy', priority: '0.7', changefreq: 'daily' },
  { path: '/markets', priority: '0.7', changefreq: 'hourly' },
  { path: '/traders', priority: '0.4', changefreq: 'daily' },
  {
    path: '/community',
    priority: '0.6',
    changefreq: 'hourly',
    images: [{
      loc: buildAbsoluteUrl('/share/pages/community.png'),
      title: 'קהילת החוזה — דיונים ותחזיות',
    }],
  },
];

// Static pages + category hubs + help content — the part of the old
// sitemap.xml that never needed a catalog walk. Split into its own sitemap
// child so the index (sitemap.xml.js) stays cheap and the market/profile
// catalog chunks can be cached and fetched independently by crawlers.
export async function GET() {
  const urls = STATIC_PUBLIC_ROUTES.map((route) => ({
    loc: buildAbsoluteUrl(route.path),
    changefreq: route.changefreq,
    priority: route.priority,
    images: route.images || [],
  }));

  for (const category of PUBLIC_CATEGORY_HUBS) {
    urls.push({
      loc: buildAbsoluteUrl(categoryHubPath(category.key)),
      changefreq: 'hourly',
      priority: '0.8',
    });
  }

  for (const topic of HELP_TOPICS) {
    urls.push({
      loc: buildAbsoluteUrl(helpTopicPath(topic.slug)),
      changefreq: 'weekly',
      priority: '0.5',
    });
  }

  const helpArticles = publishedHelpEntries(await getCollection('help'));
  for (const article of helpArticles) {
    urls.push({
      loc: buildAbsoluteUrl(helpArticlePath(article.data.topic, articleSlugFromId(article.id))),
      lastmod: article.data.updatedDate?.toISOString?.().slice(0, 10),
      changefreq: 'weekly',
      priority: '0.5',
    });
  }

  return sitemapXmlResponse(renderUrlset(dedupeSitemapUrls(urls)));
}
