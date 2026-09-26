// Shared profile formatting + derivation — used by the ProfileDossier component
// (rendering) and the profile pages (SSR data shaping). One source of truth so the
// owner (/profile → /u/<own-id>) and public (/u/:id) views can never drift.

// ── value formatters ───────────────────────────────────────────────
export const nf = (v) => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString('en-US') : '—'; };
export const compact = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n >= 1000 ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n) : String(n);
};

// V₪ (virtual shekel) money — mirrors public/scripts/portfolio/formatters.js:
// 2-decimal en-US, "V₪ " prefix wrapped in LRI…PDI (⁦…⁩) so symbol+number stay LTR
// inside the RTL row. Prices are agorot (×100, like formatPriceTag); totals/amounts raw.
const moneyFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const vsh = (s) => `⁦V₪ ${s}⁩`;
export const priceTag = (v) => { const n = Number(v); return Number.isFinite(n) ? vsh(moneyFmt.format(n * 100)) : '—'; };
export const money = (v) => { const n = Number(v); return Number.isFinite(n) ? vsh(moneyFmt.format(n)) : '—'; };
export const signed = (v) => { const n = Number(v); if (!Number.isFinite(n)) return '—'; return vsh((n >= 0 ? '+' : '−') + moneyFmt.format(Math.abs(n))); };
// Compact V₪ for the narrow stat-strip cells (large wins → 1.1K/2.3M, never overflow).
export const moneyCompact = (v) => { const n = Number(v); return Number.isFinite(n) ? vsh(compact(n)) : '—'; };
export const pct1 = (v) => { const n = Number(v); if (!Number.isFinite(n)) return ''; return (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(2) + '%'; };

export function relTime(iso) {
  try {
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (days <= 0) return 'היום'; if (days === 1) return 'אתמול';
    if (days < 7) return `לפני ${days} ימים`; if (days < 14) return 'לפני שבוע';
    if (days < 30) return `לפני ${Math.floor(days / 7)} שבועות`;
    return `לפני ${Math.floor(days / 30)} חודשים`;
  } catch { return ''; }
}

// ── identity derivation ────────────────────────────────────────────
export function buildJoinedLabel(createdAt) {
  if (!createdAt) return '';
  try {
    return `הצטרף ב${new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric' }).format(new Date(createdAt))}`;
  } catch { return ''; }
}

// Cold-start framing (UX audit 1.3, decided floor = 5 per count): below the
// follower/following/view floor the counts row swaps to the join line instead
// of three zeros. Owner call 2026-07-04: the plain month/year join label, not
// relative "השבוע/החודש" wording.
export function buildRecencyLabel(createdAt) {
  return buildJoinedLabel(createdAt);
}

const TIER_LABELS = { gray: 'תג אפור', gold: 'תג זהב', diamond: 'תג יהלום' };
// Verification tier → "חוֹזֶה · <label>" (numeric level is not backed yet, so we show the tier).
export function tierLabelOf(tier) {
  return tier ? `חוֹזֶה · ${TIER_LABELS[tier] || 'מאומת'}` : 'חוֹזֶה';
}

// ── track-record derivation (accuracy + breakdown + highlights) ─────
// Mirrors the original owner-page logic. categoryLabel comes resolved from the
// backend (taxonomy is backend-owned). Rail shows the curated showcaseCategories
// (first 3) when set, else the top-3 MOST ACCURATE (tiebreak: more resolved first).
export function deriveTrackRecord(trackRecord, showcaseCategories) {
  const out = { accuracyPct: null, resolvedCount: 0, allCats: [], breakdown: [], longestWinStreak: null, biggestWin: null };
  const d = trackRecord;
  if (!d) return out;
  out.resolvedCount = Number(d.resolvedCount) || 0;
  if (out.resolvedCount > 0 && typeof d.accuracy === 'number') out.accuracyPct = Math.round(d.accuracy * 100);
  if (Array.isArray(d.categoryBreakdown)) {
    out.allCats = d.categoryBreakdown
      .filter((b) => Number(b.resolvedCount) > 0)
      .sort((a, b) => Number(b.resolvedCount) - Number(a.resolvedCount)) // picker order: most-traded first
      .map((b) => ({ key: String(b.categoryKey || ''), label: b.categoryLabel || 'אחר', pct: Math.round(Number(b.accuracy) * 100), n: Number(b.resolvedCount) }));
    const picked = Array.isArray(showcaseCategories) ? showcaseCategories : [];
    const chosen = picked.map((k) => out.allCats.find((c) => c.key === k)).filter(Boolean);
    // Auto-pick honesty floor: a 1-for-1 category must not outrank a 55%-over-11
    // one, so the accuracy-sorted AUTO pick requires n >= 3 (falls back to the
    // unfiltered list only when nothing qualifies — sparse accounts keep chips).
    // User-CURATED showcase picks are exempt: deliberate choice wins.
    const eligible = out.allCats.filter((c) => c.n >= 3);
    const byAccuracy = [...(eligible.length ? eligible : out.allCats)].sort((a, b) => b.pct - a.pct || b.n - a.n);
    // `key` is carried through (unused by the desktop rail) so the mobile accuracy
    // band (Direction B) can link each chip to its category hub via categoryBrowsePath.
    out.breakdown = (chosen.length ? chosen : byAccuracy).slice(0, 3).map((c) => ({ key: c.key, label: c.label, pct: c.pct }));
  }
  if (d.highlights) {
    if (typeof d.highlights.longestWinStreak === 'number') out.longestWinStreak = d.highlights.longestWinStreak;
    if (d.highlights.biggestWin && d.highlights.biggestWin.amount != null) out.biggestWin = Number(d.highlights.biggestWin.amount);
  }
  return out;
}
