import { BACKEND_INTERNAL_URL as BACKEND } from './backend.js';

// SSR comment preview for the market page: the 10 most recent visible comments +
// the total count, rendered as static HTML so crawlers and first paint get real
// social proof (the full interactive thread stays lazy — `client:visible`).
//
// Cached in-memory per market with a short TTL so this is NOT a per-view DB hit on
// the hot market path (the share-loop lane's R2 scope). Fail-soft: any error yields
// an empty preview and the module renders nothing.

const TTL_MS = 90_000;
const PREVIEW_LIMIT = 10;
const EMPTY = { count: 0, comments: [] };
const cache = new Map(); // marketKey -> { expires, data }

export async function fetchCommentPreview(marketKey) {
  if (!marketKey) return EMPTY;
  const hit = cache.get(marketKey);
  if (hit && hit.expires > Date.now()) return hit.data;

  let data = EMPTY;
  try {
    const url = `${BACKEND}/api/markets/${encodeURIComponent(marketKey)}/comments?limit=${PREVIEW_LIMIT}`;
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (res.ok) {
      const payload = await res.json();
      const comments = (payload?.comments ?? [])
        .slice(0, PREVIEW_LIMIT)
        .map((c) => ({
          author: c.author || (c.authorHandle ? `@${c.authorHandle}` : 'משתמש'),
          handle: c.authorHandle || '',
          body: String(c.body || '').trim(),
          createdAt: c.createdAt || '',
        }))
        .filter((c) => c.body);
      data = { count: Number(payload?.counts?.total ?? comments.length) || 0, comments };
    }
  } catch {
    data = EMPTY;
  }
  cache.set(marketKey, { expires: Date.now() + TTL_MS, data });
  return data;
}
