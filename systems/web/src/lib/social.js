import { BACKEND_INTERNAL_URL as BACKEND } from './backend.js';

export async function fetchWeeklyLeaderboard(limit = 3) {
  const url = new URL('/api/social/leaderboard/weekly', BACKEND);
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url, { headers: { accept: 'application/json' } });

  if (!res.ok) {
    throw new Error(`weekly leaderboard → HTTP ${res.status}`);
  }

  return res.json();
}
