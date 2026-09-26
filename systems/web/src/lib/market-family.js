// Server-side recurring-series fetch. Public, unauthenticated — fully server-renderable.
// Powers the family-hub page (/series/{familyKey}); returns every published instance of
// a market family as date-ordered chain items ({ id, label, href, temporalStatus }).
import { BACKEND_INTERNAL_URL as BACKEND } from './backend.js';

export async function fetchMarketFamily(familyKey) {
  const url = `${BACKEND}/api/market-families/${encodeURIComponent(familyKey)}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`market-family "${familyKey}" → HTTP ${res.status}`);
  return res.json();
}
