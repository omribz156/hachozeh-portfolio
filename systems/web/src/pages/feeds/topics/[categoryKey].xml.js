import { getCategoryHub, categoryHubPath } from '../../../lib/category-hubs.js';
import { fetchFeed } from '../../../lib/discovery.js';
import { renderMarketRssFeed, rssResponse } from '../../../lib/rss.js';

export async function GET({ params }) {
  const hub = getCategoryHub(params.categoryKey);
  if (!hub) return new Response('Not found', { status: 404 });

  const data = await fetchFeed('trending', hub.key);
  const items = Array.isArray(data?.items) ? data.items : [];
  const body = renderMarketRssFeed({
    title: `${hub.label} בהחוזה`,
    description: hub.description,
    path: categoryHubPath(hub.key),
    items,
  });

  return rssResponse(body);
}
