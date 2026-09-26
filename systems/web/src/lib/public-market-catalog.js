import { BACKEND_INTERNAL_URL as BACKEND } from './backend.js';

export async function fetchPublicMarketCatalog({ limit = 100, status = 'all', cursor = null, sort = null } = {}) {
  const url = new URL('/api/markets', BACKEND);
  url.searchParams.set('status', status);
  url.searchParams.set('limit', String(limit));
  if (cursor) url.searchParams.set('cursor', cursor);
  if (sort) url.searchParams.set('sort', sort);

  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`public market catalog → HTTP ${res.status}`);
  return res.json();
}
