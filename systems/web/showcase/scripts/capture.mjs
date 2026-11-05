import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Public GETs only. Never persist whole API responses or authenticated data.
const origin = 'https://hachozeh.com';
const pick = (value, keys) => Object.fromEntries(keys.filter(k => value?.[k] !== undefined).map(k => [k, value[k]]));
const text = value => typeof value === 'string' ? value : null;
const safeUrl = value => { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : null; } catch { return null; } };
const asset = category => `/assets/images/market-buckets/${/^[a-z-]+$/.test(category) ? category : 'general'}.svg`;
async function get(path) {
  const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(20000), redirect: 'error', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
}
const outcome = o => pick(o, ['outcomeKey', 'label', 'probability', 'displayProbability', 'role']);
const feeds = {};
const rawCards = new Map();
const redirects = {};
for (const feed of ['trending', 'new', 'breaking', 'closing']) {
  const response = await get(`/api/discovery/feed?feed=${feed}&limit=48`);
  feeds[feed] = [];
  for (const card of response.items || []) {
    const id = `${card.marketKey}:${card.shape}`;
    feeds[feed].push(id);
    rawCards.set(id, card);
    if (card.href?.startsWith('/event/')) redirects[card.href] = `/markets/${card.marketKey}/`;
  }
}
const cards = [...rawCards.entries()].map(([id, card]) => ({
  id, ...pick(card, ['marketKey', 'shape', 'title', 'closeAt', 'closeLabel', 'updatedLabel', 'publishedAt', 'marketStatus']),
  href: `/markets/${card.marketKey}/`,
  category: pick(card.category, ['key', 'label']),
  image: { src: asset(card.category?.key), alt: card.category?.label || '' },
  volume: pick(card.volume, ['value', 'label']),
  outcomes: (card.outcomes || []).map(outcome), signals: [],
  children: (card.event?.childMarketKeys || []).filter(k => typeof k === 'string'),
}));
const keys = [...new Set(cards.flatMap(c => [c.marketKey, ...c.children]))];
const markets = {};
for (const key of keys) {
  const raw = await get(`/api/market-detail/markets/${encodeURIComponent(key)}`);
  const snap = raw.snapshot;
  if (!snap || !Array.isArray(snap.outcomes)) throw new Error(`Invalid detail: ${key}`);
  const history = await get(`/api/markets/${encodeURIComponent(key)}/history?range=all`);
  const card = cards.find(c => c.marketKey === key || c.children.includes(key));
  markets[key] = {
    key, title: text(raw.context?.marketLabel), category: card.category,
    image: { src: asset(card.category.key), alt: card.category.label },
    status: snap.marketStatus,
    outcomes: snap.outcomes.map(o => pick(o, ['id', 'key', 'label', 'shortLabel'])),
    current: Object.fromEntries(snap.outcomes.map(o => [o.id, Number(snap.current?.[o.id]) || 0])),
    closeLabel: text(snap.closeLabel), volumeLabel: text(snap.volumeLabel), updatedLabel: text(snap.updatedLabel),
    lifecycle: pick(snap.lifecycle, ['openAt', 'closeAt', 'resolvedAt', 'settlementStatus']),
    contract: {
      ...pick(snap.contract, ['measurement', 'resolutionRule', 'delayPolicy', 'dataRevisionPolicy', 'ambiguityPolicy']),
      resolutionSource: { label: text(snap.contract?.resolutionSource?.label), url: safeUrl(snap.contract?.resolutionSource?.url) },
    },
    timeline: (snap.timeline || []).map(t => pick(t, ['title', 'time'])),
    winner: snap.winner ? pick(snap.winner, ['label', 'outcomeId']) : null,
    history: { range: 'all', seriesByOutcome: (history.seriesByOutcome || []).map(s => ({
      ...pick(s, ['outcomeKey', 'outcomeId', 'label']),
      points: (s.points || []).map(p => ({ t: Number(p.t), value: Number(p.value) })).filter(p => Number.isFinite(p.t) && Number.isFinite(p.value)),
    })) },
  };
  console.log(`Captured ${key}`);
}
const snapshot = { schemaVersion: 1, capturedAt: new Date().toISOString(), source: origin, feeds, cards, markets, redirects };
const directory = fileURLToPath(new URL('../data/', import.meta.url));
await mkdir(directory, { recursive: true });
await writeFile(`${directory}/snapshot.json`, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`Snapshot: ${cards.length} cards, ${keys.length} markets. No accounts, comments, trades or sessions exported.`);
