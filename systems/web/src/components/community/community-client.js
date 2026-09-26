// Client-side write + market-search helpers for the community composers.
// Same-origin: /api is proxied by the gateway, so relative fetch with the
// session cookie (credentials:include) authenticates the viewer.

export async function postCommunity(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error?.message || 'הבקשה נכשלה');
  }
  return data;
}

// Toggle the viewer's like on any community target (feed item / discussion
// opening / comment / reply), keyed by its globally-unique id. Returns the
// authoritative { likes, liked } so the caller can reconcile optimistic state.
export async function toggleCommunityLike(targetId) {
  return postCommunity(`/api/community/like/${encodeURIComponent(targetId)}`, {});
}

// Live subject lookup for the composers: child markets AND parent events, in one
// list (events tagged). Returns [{ kind:'market'|'event', key, title, cat, prob, href }].
export async function searchCommunitySubjects(query) {
  const q = (query || '').trim();
  if (q.length < 2) return [];
  try {
    const res = await fetch(`/api/community/subjects?q=${encodeURIComponent(q)}`, {
      credentials: 'include',
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.subjects || [];
  } catch {
    return [];
  }
}

// Composer picker data for authored position/result/milestone modes — the
// viewer's own real positions / resolved markets / earned milestones. The list
// carries the derived preview numbers, so the picker doubles as the preview.
export async function fetchMyList(kind) {
  const path = kind === 'position' ? 'my-positions' : kind === 'result' ? 'my-results' : 'my-milestones';
  const key = kind === 'position' ? 'positions' : kind === 'result' ? 'results' : 'milestones';
  try {
    const res = await fetch(`/api/community/${path}`, { credentials: 'include', headers: { accept: 'application/json' } });
    if (!res.ok) return [];
    const data = await res.json();
    return data[key] || [];
  } catch {
    return [];
  }
}
