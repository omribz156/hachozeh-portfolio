import { BACKEND_INTERNAL_URL as BACKEND } from './backend.js';

// Related-markets read (the tag co-graph) for the market-detail module. Fail-soft:
// related content is non-critical, so any error yields an empty result and the
// module simply renders nothing rather than breaking the page.
export async function fetchRelatedMarkets(marketKey) {
  const url = `${BACKEND}/api/market-detail/markets/${encodeURIComponent(marketKey)}/related`;
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) return { tags: [], panels: {} };
    const data = await res.json();
    return { tags: data?.tags ?? [], panels: data?.panels ?? {} };
  } catch {
    return { tags: [], panels: {} };
  }
}
