// Shared hub partitioning for the market-list surfaces (/markets, /t/<slug>).
// Card summaries dedupe by publicPath — event children share one /event/{slug},
// so we render one anchor per destination, not per child outcome — then split
// into open vs resolved sections. Kept framework-free so any SSR page can use it.

// Hebrew short date (day + month + year) for close/resolve labels. SSR-only, so a
// plain Date is fine here (unlike workflow scripts, where argless Date is blocked).
export function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Collapse card summaries to one hub per publicPath, then partition + sort:
// open by volume desc (then soonest close), resolved by most-recently resolved.
export function partitionHubs(markets) {
  const byPath = new Map();
  for (const m of Array.isArray(markets) ? markets : []) {
    const path = m?.publicPath;
    if (!path) continue;
    const vol = Number(m?.volume?.value) || 0;
    const existing = byPath.get(path);
    if (!existing) {
      byPath.set(path, {
        path,
        title: m.title || 'שוק בהחוזה',
        // A hub is "open" if ANY child is still open; resolved only when all are.
        open: m.marketStatus === 'open',
        closeAt: m.closeAt || null,
        resolvedAt: m.resolvedAt || null,
        winner: m.winner?.label || null,
        volume: vol,
      });
    } else {
      existing.volume += vol;
      if (m.marketStatus === 'open') {
        existing.open = true;
        existing.closeAt = existing.closeAt || m.closeAt || null;
      }
      if (m.resolvedAt && (!existing.resolvedAt || m.resolvedAt > existing.resolvedAt)) {
        existing.resolvedAt = m.resolvedAt;
      }
      if (!existing.winner && m.winner?.label) existing.winner = m.winner.label;
    }
  }

  const hubs = [...byPath.values()];
  const openHubs = hubs
    .filter((h) => h.open)
    .sort((a, b) => b.volume - a.volume || (a.closeAt || '').localeCompare(b.closeAt || ''));
  const resolvedHubs = hubs
    .filter((h) => !h.open)
    .sort((a, b) => (b.resolvedAt || '').localeCompare(a.resolvedAt || ''));
  return { openHubs, resolvedHubs };
}
