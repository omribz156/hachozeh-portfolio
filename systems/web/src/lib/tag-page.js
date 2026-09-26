import { BACKEND_INTERNAL_URL as BACKEND } from './backend.js';

// Fetch an entity tag hub: { tag: {slug,label,kind}, markets: [...card summaries] }.
// Returns null for an unknown/hidden tag (backend 404) so the page can redirect the
// slug to the noindex /search fallback instead of rendering a thin indexable page.
export async function fetchTagPage(slug) {
  const url = new URL(`/api/tags/${encodeURIComponent(slug)}`, BACKEND);
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`tag page → HTTP ${res.status}`);
  return res.json();
}

// Every visible tag + its published-market count. Powers the tag-hub sitemap child.
// Returns [] on failure so the sitemap degrades rather than 500s.
export async function fetchPublicTagList() {
  const url = new URL('/api/tags', BACKEND);
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data?.tags) ? data.tags : [];
}

// Entity tags whose markets sit in a category (frontend hub key) — powers the
// category → /t/ cross-links on /topics/<key>. Each carries its published count.
export async function fetchCategoryTags(categoryKey) {
  const url = new URL(`/api/tags/by-category/${encodeURIComponent(categoryKey)}`, BACKEND);
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data?.tags) ? data.tags : [];
}
