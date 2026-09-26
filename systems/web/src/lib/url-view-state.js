// Shared read/write helpers for URL-addressable view state (tabs, sections,
// sort, filters) — the `?range=` idiom from market-detail-chart.js
// generalized for Preact islands. Framework-agnostic; no DOM assumptions
// beyond `window.location`/`window.history` (guarded, so SSR import is safe).
//
// Contract for every surface using this: replaceState only (never
// pushState — Back must not walk through view-state changes), default state
// = param absent (clean URL at default), invalid values fall back to default
// silently.

// Reads a URL param, returning `fallback` when absent OR not in `allowed`
// (when `allowed` is given). Safe to call during SSR (returns fallback).
export function readParam(name, fallback, allowed) {
  if (typeof window === 'undefined') return fallback;
  try {
    const value = new URL(window.location.href).searchParams.get(name);
    if (!value) return fallback;
    if (allowed && !allowed.includes(value)) return fallback;
    return value;
  } catch {
    return fallback;
  }
}

// Writes (or clears, when value === fallback) a URL param via replaceState.
export function writeParam(name, value, fallback) {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    if (!value || value === fallback) url.searchParams.delete(name);
    else url.searchParams.set(name, value);
    window.history.replaceState(null, '', url);
  } catch {
    // Non-browser or cross-origin — swallow.
  }
}
