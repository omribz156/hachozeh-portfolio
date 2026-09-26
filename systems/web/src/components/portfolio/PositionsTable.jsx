import { applySort, applySearch } from './depth-shared.js';
import { VShekelText } from '../currency/VShekel.jsx';

// 1:1 port of public/scripts/portfolio/positions-tab.js — same columns, classes,
// sort keys, search fields, and empty state. The only behavioral move: share is
// island-owned (local onClick) instead of delegated to the orchestrator, since
// this island is a sibling of [data-portfolio-cards] and the delegated handler
// can't reach it.

const SORT_KEYS = {
  title:  { fn: (p) => p.marketTitle || '', defaultDir: 'asc',  type: 'string' },
  // The merged avg→now column sorts by the current ("now") price.
  price:  { fn: (p) => p.currentPrice,      defaultDir: 'desc', type: 'number' },
  traded: { fn: (p) => p.costBasis,         defaultDir: 'desc', type: 'number' },
  toWin:  { fn: (p) => p.toWin,             defaultDir: 'desc', type: 'number' },
  value:  { fn: (p) => p.currentValue,      defaultDir: 'desc', type: 'number' },
  day:    { fn: (p) => Math.abs(p.dayPnl),  defaultDir: 'desc', type: 'number' },
};
const SEARCH_FIELDS = ['marketTitle', 'outcomeLabel', 'marketKey'];

// Compact price for the avg→now cell — bare 0-100 number, 1 decimal, no
// trailing .0 (Polymarket's "69 → 68" / "33.9 → 36.5" shape). The price is a
// 0-1 probability; ×100 gives the agorot-style display the column header frames.
function priceCompact(v) {
  const n = (Number(v) || 0) * 100;
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function SortIcon({ columnId, sortBy, sortDir }) {
  if (columnId !== sortBy) {
    return <span class="material-symbols-outlined pf-sort-icon">unfold_more</span>;
  }
  const cfg = SORT_KEYS[sortBy] || SORT_KEYS.day;
  const dir = sortDir || cfg.defaultDir;
  return (
    <span class="material-symbols-outlined pf-sort-icon pf-sort-icon--active">
      {dir === 'asc' ? 'arrow_drop_up' : 'arrow_drop_down'}
    </span>
  );
}

function Header({ columnId, label, sortBy, sortDir, onSort }) {
  return (
    <button
      class={`pf-position-header ${columnId === sortBy ? 'is-active' : ''}`}
      data-portfolio-sort={columnId}
      type="button"
      role="columnheader"
      onClick={() => onSort(columnId)}
    >{label}<SortIcon columnId={columnId} sortBy={sortBy} sortDir={sortDir} /></button>
  );
}

// Build the share URL at click time (client-only) so render stays SSR-safe.
// A position share is the BOLD CALL: the user stakes their read publicly,
// pre-resolution — the text invites the recipient to disagree.
function shareMarket(p, btn) {
  const marketKey = p.marketKey;
  const title = `${p.marketTitle} · החוזה`;
  const url = marketKey
    ? `${window.location.origin}/markets/${encodeURIComponent(marketKey)}`
    : window.location.origin;
  const image = marketKey
    ? `/share/markets/${encodeURIComponent(marketKey)}.png`
    : '';
  const entryPct = Number.isFinite(p.averageEntryPrice)
    ? Math.min(99, Math.max(1, Math.round(p.averageEntryPrice * 100)))
    : null;
  const text = p.outcomeLabel && entryPct != null
    ? `אני על "${p.outcomeLabel}" ב־${entryPct}%. מה הקריאה שלך?`
    : `מה הקריאה שלך? "${p.marketTitle}" בהחוזה.`;

  if (window.HachozehShare?.open) {
    window.HachozehShare.open({
      kind: 'market',
      title,
      text,
      url,
      image,
    });
    return;
  }

  (async () => {
    try {
      if (navigator.share) await navigator.share({ title, text, url });
      else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        btn.setAttribute('title', 'הקישור הועתק');
      }
    } catch (e) {
      if (e?.name !== 'AbortError') btn.setAttribute('title', 'לא הצלחנו לשתף');
    }
  })();
}

function PositionRow({ p }) {
  const marketHref = p.marketKey ? `/markets/${encodeURIComponent(p.marketKey)}` : '/';
  const initial = (p.marketTitle || '').trim().charAt(0) || '•';
  return (
    <li class="pf-position-row" role="row">
      <div class="pf-position-market" role="cell">
        <a class="pf-position-market-link" href={marketHref}>
          <span class="pf-position-avatar" aria-hidden="true">
            {p.imageSrc
              ? <img src={p.imageSrc} alt="" loading="lazy" />
              : <span class="pf-position-avatar-initial">{initial}</span>}
          </span>
          <span class="pf-position-market-text">
            <div class="pf-position-title" title={p.marketTitle}>{p.marketTitle}</div>
            <div class="pf-position-sub">
              <span class={`pf-state-chip pf-tone-${p.currentStateTone}`}>{p.currentStateLabel}</span>
              <span class="pf-position-quantity">{p.quantityLabel}</span>
            </div>
          </span>
        </a>
      </div>
      <div class="pf-position-arrow" role="cell">
        <span class="pf-position-arrow-to">{priceCompact(p.currentPrice)}</span>
        <span class="pf-position-arrow-mark" aria-hidden="true">←</span>
        <span class="pf-position-arrow-from">{priceCompact(p.averageEntryPrice)}</span>
      </div>
      <div class="pf-position-numeric" role="cell"><VShekelText text={p.costBasisLabel} /></div>
      <div class="pf-position-numeric" role="cell"><VShekelText text={p.toWinLabel} /></div>
      <div class="pf-position-numeric pf-position-value" role="cell">
        <VShekelText text={p.currentValueLabel} />
        {/* Poly-style: value stays neutral, the signed P&L + % sub carries the
            green/red tone (was on the cell, where .pf-position-numeric's color
            overrode it by source order — so the sub never actually colored). */}
        {p.pnlSubLabel ? <div class={`pf-position-pnl-sub pf-tone-${p.pnlTone}`}><VShekelText text={p.pnlSubLabel} /></div> : null}
      </div>
      <div class="pf-position-share-cell" role="cell">
        <button
          class="pf-position-share"
          type="button"
          aria-label="שתף שוק"
          title="שתף"
          onClick={(e) => shareMarket(p, e.currentTarget)}
        ><span class="material-symbols-outlined">ios_share</span></button>
      </div>
    </li>
  );
}

export default function PositionsTable({ positions, searchQuery, sortBy, sortDir, onSort }) {
  let visible = applySort(positions, sortBy, sortDir, SORT_KEYS, 'day');
  visible = applySearch(visible, searchQuery, SEARCH_FIELDS);

  if (visible.length === 0) {
    return <div class="pf-empty pf-empty--padded">אין פוזיציות להציג.</div>;
  }

  return (
    <div class="pf-positions" role="table" aria-label="פוזיציות">
      <div class="pf-positions-head" role="row">
        <Header columnId="title" label="שוק" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
        {/* Label order is entry→current so it lines up with the value cell,
            which is forced direction:ltr (Poly "73.7 ← 12" number shape):
            in RTL this header renders כניסה on the right, נוכחי on the left,
            matching entry-right / current-left in the data. */}
        <Header columnId="price" label="כניסה ← נוכחי" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
        <Header columnId="traded" label="הושקעו" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
        <Header columnId="toWin" label="לרווח" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
        <Header columnId="value" label="שווי" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
        <span class="pf-positions-head-spacer" aria-hidden="true"></span>
      </div>
      <ul class="pf-positions-list" role="rowgroup">
        {visible.map((p, i) => <PositionRow key={p.marketKey || i} p={p} />)}
      </ul>
    </div>
  );
}
