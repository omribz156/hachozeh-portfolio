// Quick-buy ticket-data endpoint. Returns exactly the TradeTicket props for a
// market, built from the SAME shared builder the market-detail page SSR uses
// (lib/ticket-data.js) — so the popped ticket and the detail-page ticket can't
// drift. Served by Astro (NOT /api/*, which Caddy proxies to the backend), on a
// dedicated path to avoid colliding with the /markets/[marketKey] page route.
//
// Public, like the market-detail snapshot it reads. When price caching lands this
// can move to the backend as /api/markets/:key/ticket and pick up edge caching for
// free; clients go through one helper so the URL is swappable.
import { fetchMarketDetail } from '../../lib/market-detail.js';
import { buildTicketProps } from '../../lib/ticket-data.js';

export async function GET({ params }) {
  const marketKey = params.marketKey;
  if (!marketKey) {
    return json({ error: 'missing_market_key' }, 400);
  }
  try {
    const record = await fetchMarketDetail(marketKey);
    return json(buildTicketProps(marketKey, record), 200);
  } catch (e) {
    const notFound = String(e?.message || '').includes('HTTP 404');
    return json({ error: notFound ? 'not_found' : 'fetch_failed' }, notFound ? 404 : 502);
  }
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
