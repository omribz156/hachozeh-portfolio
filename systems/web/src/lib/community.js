// Server-side community fetch. Runs in the Astro SSR server, calling the real
// /api/community backend that replaced the seeded preview. Mirrors lib/search.js:
// forward the viewer's session cookie so viewer-scoped fields resolve. Every
// helper degrades to empty rather than throwing, so a backend hiccup renders an
// empty-but-alive surface instead of a 500.
import { BACKEND_INTERNAL_URL as BACKEND } from './backend.js';

// The topic filter chips (must stay in sync with the community topics the
// backend derives from market categories).
export const COMMUNITY_TOPICS = ['הכל', 'פוליטיקה', 'מאקרו', 'ספורט', 'תרבות', 'מזג אוויר'];

async function getJson(path, cookie) {
  const url = new URL(path, BACKEND);
  try {
    const headers = { accept: 'application/json' };
    if (cookie) headers.cookie = cookie;
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.error('[community] fetch failed', path, e);
    return null;
  }
}

// Home surface: discussions + live feed + rail, fetched in parallel.
export async function fetchCommunityHome({ cookie = null } = {}) {
  const [discussions, feed, rail] = await Promise.all([
    getJson('/api/community/discussions?limit=20', cookie),
    getJson('/api/community/feed?limit=24', cookie),
    getJson('/api/community/rail', cookie),
  ]);
  return {
    topics: COMMUNITY_TOPICS,
    discussions: discussions?.discussions ?? [],
    discussionsCursor: discussions?.pagination?.nextCursor ?? null,
    feed: feed?.feed ?? [],
    feedCursor: feed?.pagination?.nextCursor ?? null,
    railNow: rail?.now ?? [],
    railPeople: rail?.people ?? [],
  };
}

// Thread detail: returns null when the discussion doesn't exist (→ 404 the page).
export async function fetchCommunityThread(id, { cookie = null } = {}) {
  if (!id) return null;
  return getJson(`/api/community/discussions/${encodeURIComponent(id)}`, cookie);
}
