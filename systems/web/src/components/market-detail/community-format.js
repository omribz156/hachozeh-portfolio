// Shared formatting helpers for the community surface modules (comments /
// board / activity). Kept in one place because all three modules render the
// same money/count/time/price vocabulary; the island pattern elsewhere inlines
// these, but here four modules would otherwise duplicate them.

const nf2 = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 });

export function money(n) {
  return `\u2066V₪ ${nf2.format(Number(n) || 0)}\u2069`;
}

export function signedMoney(n) {
  const v = Number(n) || 0;
  return `\u2066V₪ ${v >= 0 ? '+' : '−'}${nf2.format(Math.abs(v))}\u2069`;
}

export function count(n) {
  return nf0.format(Number(n) || 0);
}

// Share/avg prices are V₪ 0-1 probabilities; render them with the same money
// shape as the viewer-positions island ("V₪ 0.42") for cross-surface consistency.
export function price(n) {
  return money(n);
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Hebrew relative-time label for activity rows and comment timestamps.
export function relativeTime(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diff = Math.max(0, Date.now() - t) / 1000;
  if (diff < 60) return 'עכשיו';
  const m = Math.floor(diff / 60);
  if (m < 60) return `${m} דק׳`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} שע׳`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'יום' : `${d} ימים`;
}

export const CONTRACT_LABELS = { yes: 'כן', no: 'לא' };
