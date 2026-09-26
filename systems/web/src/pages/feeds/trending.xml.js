import { fetchFeed } from '../../lib/discovery.js';
import { renderMarketRssFeed, rssResponse } from '../../lib/rss.js';

export async function GET() {
  const data = await fetchFeed('trending');
  const items = Array.isArray(data?.items) ? data.items : [];
  const body = renderMarketRssFeed({
    title: 'טרנדי בהחוזה',
    description: 'שווקים מובילים ועדכניים בהחוזה.',
    path: '/',
    items,
  });

  return rssResponse(body);
}
