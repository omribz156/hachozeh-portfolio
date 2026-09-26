// Server-side discovery feed fetch. Runs in the Astro SSR server (Node),
// calling the same backend endpoint the legacy browser client used —
// just from the server now (Phase A of the migration).
import { BACKEND_INTERNAL_URL as BACKEND } from './backend.js';

export async function fetchFeed(feed = 'trending', category = null, options = {}) {
  const url = new URL('/api/discovery/feed', BACKEND);
  url.searchParams.set('feed', feed);
  if (category) url.searchParams.set('category', category);
  if (options?.limit != null) url.searchParams.set('limit', String(options.limit));
  if (options?.cursor) url.searchParams.set('cursor', String(options.cursor));
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`discovery feed "${feed}" → HTTP ${res.status}`);
  return res.json();
}
