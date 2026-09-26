// Server-side search fetch. Runs in the Astro SSR server (Node), calling the
// same /api/search backend the header dropdown uses, but with enrich=1 so the
// full results page gets per-row stats (market comments/leading outcome/signal,
// profile accuracy/resolved/followers/isFollowing). Mirrors lib/discovery.js.
import { BACKEND_INTERNAL_URL as BACKEND } from './backend.js';

const DEFAULT_PAGE_LIMIT = 30;

// Sorts the results page exposes per surface (must match the backend's
// normalizeMarketSort / normalizeProfileSort allow-lists).
export const MARKET_SORTS = ['relevance', 'volume', 'newest', 'closing', 'competitive'];
export const PROFILE_SORTS = ['accuracy', 'followers', 'newest'];

export async function fetchSearch(
  query,
  kind = 'markets',
  { limit = DEFAULT_PAGE_LIMIT, sort = null, status = null, cookie = null } = {}
) {
  const q = (query ?? '').trim();
  const empty = {
    query: q,
    kind,
    results: [],
    events: [],
    markets: [],
    profiles: [],
    pagination: { limit, hasMore: false },
  };
  if (q.length < 2) {
    return empty;
  }

  const url = new URL('/api/search', BACKEND);
  url.searchParams.set('q', q);
  url.searchParams.set('kind', kind);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('enrich', '1');
  if (sort) url.searchParams.set('sort', sort);
  if (status) url.searchParams.set('status', status);

  try {
    const headers = { accept: 'application/json' };
    // Forward the viewer's session so isFollowing reflects the logged-in user.
    if (cookie) headers.cookie = cookie;
    const res = await fetch(url, { headers });
    if (!res.ok) return empty;
    const data = await res.json();
    return {
      query: data.query ?? q,
      kind: data.kind ?? kind,
      results: Array.isArray(data.results) ? data.results : [],
      // Parent events ride the market lane — the grouping page is its own subject.
      events: Array.isArray(data.events) ? data.events : [],
      markets: Array.isArray(data.markets) ? data.markets : [],
      profiles: Array.isArray(data.profiles) ? data.profiles : [],
      pagination: data.pagination ?? { limit, hasMore: false },
    };
  } catch (e) {
    console.error('[search] fetchSearch failed', e);
    return empty;
  }
}
