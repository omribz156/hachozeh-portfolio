import { BACKEND_INTERNAL_URL as BACKEND } from './backend.js';

export async function fetchPublicProfileCatalog({ limit = 100, cursor = null, offset = null, includeTotal = false } = {}) {
  const url = new URL('/api/social/profiles', BACKEND);
  url.searchParams.set('limit', String(limit));
  if (cursor) url.searchParams.set('cursor', cursor);
  if (offset !== null && offset !== undefined) url.searchParams.set('offset', String(offset));
  if (includeTotal) url.searchParams.set('includeTotal', '1');

  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`public profile catalog -> HTTP ${res.status}`);
  return res.json();
}
