import { BACKEND_INTERNAL_URL } from './backend.js';

const VALID_RANGES = ['1H', '6H', '1D', '1W', '1M', 'all'];

// The client chart (market-detail-chart.js) resolves its initial range as
// URL ?range, else "all" (see resolvedInitialRange there). The SSR seed only
// pays off if it matches that range — otherwise the client discards it (range
// mismatch) and re-fetches, wasting the server round-trip. So default to "all",
// in lockstep with the client. (Keep these two in sync if either default moves.)
export function resolveSeedRange(urlRange) {
  return VALID_RANGES.includes(urlRange) ? urlRange : 'all';
}

// Fetch the initial chart history server-side so the chart's first paint needs
// no client fetch. Never throws — degrades to null so the caller falls back to
// its post-mount client fetch and the page is never blocked by chart data.
export async function fetchChartSeed(marketKey, range) {
  try {
    const res = await fetch(
      `${BACKEND_INTERNAL_URL}/api/markets/${encodeURIComponent(marketKey)}/history?range=${encodeURIComponent(range)}`,
      { signal: AbortSignal.timeout(1500) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data.seriesByOutcome)) {
      return { range, seriesByOutcome: data.seriesByOutcome };
    }
  } catch {
    // degrade to client fetch
  }
  return null;
}

// Event-chart seed: same contract as fetchChartSeed but hits the event-history
// endpoint (one line per child). Never throws — degrades to null so the event
// chart falls back to its post-mount client fetch.
export async function fetchEventChartSeed(marketKey, range) {
  try {
    const res = await fetch(
      `${BACKEND_INTERNAL_URL}/api/markets/${encodeURIComponent(marketKey)}/event-history?range=${encodeURIComponent(range)}`,
      { signal: AbortSignal.timeout(1500) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data.seriesByOutcome)) {
      return { range, seriesByOutcome: data.seriesByOutcome };
    }
  } catch {
    // degrade to client fetch
  }
  return null;
}
