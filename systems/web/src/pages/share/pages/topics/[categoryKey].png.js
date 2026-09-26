import { fetchFeed } from '../../../../lib/discovery.js';
import { getCategoryHub } from '../../../../lib/category-hubs.js';
import { renderShareCardPng } from '../../../../lib/share-card-image.js';
import { checkShareImageRateLimit, shareImageRateLimitResponse } from '../../../../lib/share-image-rate-limit.js';

function titles(items) {
  return (Array.isArray(items) ? items : []).map((item) => item?.title).filter(Boolean).slice(0, 3);
}

export async function GET({ params, clientAddress, request }) {
  const gate = checkShareImageRateLimit({ clientAddress, request });
  if (!gate.allowed) return shareImageRateLimitResponse(gate.retryAfterSec);

  const key = params.categoryKey?.replace(/\.png$/i, '');
  const hub = getCategoryHub(key);
  if (!hub) return new Response(null, { status: 404 });

  let items = [];
  try {
    const feed = await fetchFeed('trending', hub.key);
    items = feed?.items || [];
  } catch {}

  const png = await renderShareCardPng({
    eyebrow: 'שווקים לפי קטגוריה',
    title: hub.heading,
    subtitle: hub.intro || hub.description,
    rows: titles(items),
    tone: hub.key === 'sports' || hub.key === 'technology' ? 'blue' : 'green',
    stats: [
      { value: String(items.length || '—'), label: 'שווקים' },
      { value: hub.label, label: 'קטגוריה' },
    ],
  });

  return new Response(png, {
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=300, stale-while-revalidate=3600',
    },
  });
}
