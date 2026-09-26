// Server-side market-detail fetch. These endpoints are fully PUBLIC (no auth)
// so the whole snapshot is server-renderable.
import { BACKEND_INTERNAL_URL as BACKEND } from './backend.js';

export async function fetchMarketDetail(marketKey) {
  const url = `${BACKEND}/api/market-detail/markets/${encodeURIComponent(marketKey)}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`market-detail "${marketKey}" → HTTP ${res.status}`);
  return res.json();
}

export async function resolveEventMarket(eventSlug) {
  const url = `${BACKEND}/api/market-detail/events/${encodeURIComponent(eventSlug)}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`market-detail event "${eventSlug}" → HTTP ${res.status}`);
  return res.json();
}

export async function fetchMarketSavedState(marketKey, cookieHeader = '') {
  if (!cookieHeader) return false;

  const url = `${BACKEND}/api/markets/${encodeURIComponent(marketKey)}/save`;
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        cookie: cookieHeader,
      },
    });
    if (!res.ok) return false;
    const payload = await res.json().catch(() => null);
    return payload?.saved === true;
  } catch {
    return false;
  }
}
