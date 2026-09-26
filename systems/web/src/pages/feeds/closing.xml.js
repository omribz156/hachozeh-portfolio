import { fetchFeed } from '../../lib/discovery.js';
import { renderMarketRssFeed, rssResponse } from '../../lib/rss.js';

export async function GET() {
  const data = await fetchFeed('closing');
  const items = Array.isArray(data?.items) ? data.items : [];
  const body = renderMarketRssFeed({
    title: 'נסגר בקרוב בהחוזה',
    description: 'שווקים פתוחים בהחוזה שנסגרים ב-24 השעות הקרובות.',
    path: '/closing-markets',
    items,
  });

  return rssResponse(body);
}
