// The single network seam for the community surface. Every tab module talks to
// the backend ONLY through an adapter instance — nothing else fetches. This is
// also where the comments plaster lives, isolated to one place so the backend
// handoff is a drop-in (see workspace/coordination/front-market-detail.md § A2).

const POSITIONS_LIMIT = 50;
const TRADES_LIMIT = 25;

async function getJSON(url) {
  const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function query(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) search.set(key, value);
  });
  const text = search.toString();
  return text ? `?${text}` : '';
}

async function sendJSON(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function sendDELETE(url) {
  const res = await fetch(url, { method: 'DELETE', credentials: 'include', cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function createCommentsClient(marketKey) {
  const enc = (k) => encodeURIComponent(k || '');

  return {
    list(options = {}) {
      return getJSON(`/api/markets/${enc(marketKey)}/comments${query({
        limit: '30',
        eventId: options.eventId,
      })}`);
    },
    post(payload = {}) {
      return sendJSON(`/api/markets/${enc(marketKey)}/comments`, {
        body: payload.body,
        eventId: payload.eventId,
      });
    },
    like(payload = {}) {
      return sendJSON(`/api/markets/${enc(marketKey)}/comments/${enc(payload.commentId)}/like${query({
        eventId: payload.eventId,
      })}`);
    },
    reply(payload = {}) {
      return sendJSON(`/api/markets/${enc(marketKey)}/comments/${enc(payload.commentId)}/replies`, {
        body: payload.body,
        eventId: payload.eventId,
      });
    },
    report(payload = {}) {
      return sendJSON(`/api/markets/${enc(marketKey)}/comments/${enc(payload.commentId)}/report`, {
        reason: payload.reason,
      });
    },
    remove(payload = {}) {
      return sendDELETE(`/api/markets/${enc(marketKey)}/comments/${enc(payload.commentId)}`);
    },
  };
}

export function createCommunityAdapter(marketKey) {
  const enc = (k) => encodeURIComponent(k || '');

  // Boards (holders + positions) come from one endpoint and never change within
  // a page load, so they are memoized PER KEY — switching holders↔positions on
  // the same market reuses the single request, and event-mode child switching
  // caches each child it visits. Activity is intentionally NOT memoized: it polls.
  const boardsCache = new Map();

  return {
    fetchBoards(key = marketKey) {
      if (!boardsCache.has(key)) {
        boardsCache.set(key, getJSON(`/api/markets/${enc(key)}/positions?limit=${POSITIONS_LIMIT}`));
      }
      return boardsCache.get(key);
    },
    invalidateBoards(key = null) {
      if (key) {
        boardsCache.delete(key);
        return;
      }
      boardsCache.clear();
    },
    fetchActivity(key = marketKey) {
      return getJSON(`/api/markets/${enc(key)}/trades?limit=${TRADES_LIMIT}`);
    },
    comments: createCommentsClient(marketKey),
  };
}
