import { fetchFeed } from '../../lib/discovery.js';
import { renderMarketRssFeed, rssResponse } from '../../lib/rss.js';

export async function GET() {
  const data = await fetchFeed('breaking');
  const items = Array.isArray(data?.items) ? data.items : [];
  const body = renderMarketRssFeed({
    title: 'מתפרץ בהחוזה',
    description: 'השווקים שזזו הכי הרבה ב-24 שעות האחרונות בהחוזה.',
    path: '/breaking-markets',
    items,
  });

  return rssResponse(body);
}
