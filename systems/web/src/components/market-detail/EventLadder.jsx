import { useState, useEffect, useRef, useCallback, useMemo } from 'preact/hooks';
import { VShekelProbabilityPrice, VShekelText } from '../currency/VShekel.jsx';
import { fetchSnapshot } from './snapshot-fetch.js';

// Preact island for the event-mode child-market ladder.
//
// DOM is byte-identical to the previous SSR output so that CSS selectors,
// data-* attributes, and the trade-ticket retarget seam are all preserved.

// ─── helpers (mirrored from EventLadder.astro frontmatter) ───────────────────

const isTerminal = (s) => s === 'resolved' || s === 'voided';
const isClosed = (s) => s === 'closed';

const pct = (v) => Math.max(0, Math.min(100, Math.round(Number(v ?? 0) * 100)));

const sharesFmt = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 1 });
const fmtShares = (n) => sharesFmt.format(Number(n) || 0);

function yesOf(c) { return c.outcomes?.find((o) => o.side === 'yes'); }
function noOf(c)  { return c.outcomes?.find((o) => o.side === 'no'); }

function rowData(c) {
  const y = yesOf(c), n = noOf(c);
  return {
    marketKey:  c.marketId,
    canonical:  y?.outcomeId || '',
    noOutcome:  n?.outcomeId || '',
    yesPrice:   Number(y?.price ?? c.canonicalProbability ?? 0),
    noPrice:    Number(n?.price ?? (1 - (c.canonicalProbability ?? 0))),
    label:      c.label || c.marketId,
    // Child flag/crest — empty until child images exist; the ticket falls back to
    // the market icon. Wired through so it "just works" once pics are added.
    crest:      c.crestPath || y?.crestPath || '',
  };
}

// ─── resolved row (linked detail, no trade interaction) ───────────────────────

function ResolvedRow({ c }) {
  const win = c.winner === 'yes';
  return (
    <div class={`hz-outcome-row hz-outcome-row--resolved hz-outcome-row--${win ? 'winner' : 'loser'}`}>
      <a class="hz-outcome-row__main hz-event-row__link" href={`/markets/${c.marketId}?focus=1`}>
        {c.crestPath && (
          <span class="hz-outcome-row__avatar hz-outcome-row__avatar--photo">
            <img src={c.crestPath} alt="" loading="lazy" decoding="async" />
          </span>
        )}
        <div class="hz-outcome-row__text">
          <span class="hz-outcome-row__title">{c.label || c.marketId}</span>
          <div class="hz-outcome-row__meta">
            {c.volumeLabel != null && (
              <span class="hz-outcome-row__volume">נפח <VShekelText text={c.volumeLabel} /></span>
            )}
          </div>
        </div>
      </a>
      <span class={`hz-outcome-row__resolution-chip hz-outcome-row__resolution-chip--${win ? 'winner' : 'loser'}`}>
        <span>{win ? 'כן' : 'לא'}</span>
        <span class="hz-outcome-row__resolution-chip-glyph">{win ? '✓' : '✗'}</span>
      </span>
    </div>
  );
}

function ClosedRow({ c }) {
  return (
    <div class="hz-outcome-row hz-outcome-row--resolved hz-outcome-row--loser">
      <a class="hz-outcome-row__main hz-event-row__link" href={`/markets/${c.marketId}?focus=1`}>
        {c.crestPath && (
          <span class="hz-outcome-row__avatar hz-outcome-row__avatar--photo">
            <img src={c.crestPath} alt="" loading="lazy" decoding="async" />
          </span>
        )}
        <div class="hz-outcome-row__text">
          <span class="hz-outcome-row__title">{c.label || c.marketId}</span>
          <div class="hz-outcome-row__meta">
            {c.volumeLabel != null && (
              <span class="hz-outcome-row__volume">נפח <VShekelText text={c.volumeLabel} /></span>
            )}
          </div>
        </div>
      </a>
      <span class="hz-outcome-row__resolution-chip hz-outcome-row__resolution-chip--loser">
        <span>ממתין להכרעה</span>
      </span>
    </div>
  );
}

// ─── active row ──────────────────────────────────────────────────────────────

function ActiveRow({ c, selected, onBuy, holding }) {
  const d    = rowData(c);
  // Per-row price state — updated by the hz:market-live-fetch handler below.
  const [yesPrice, setYesPrice] = useState(d.yesPrice);
  const [noPrice,  setNoPrice]  = useState(d.noPrice);
  const [prob,     setProb]     = useState(pct(c.canonicalProbability));
  const [volumeLabel, setVolumeLabel] = useState(c.volumeLabel);

  const delta = Math.round(Number(c.probabilityChange ?? 0) * 100);

  // Keep refs on prices for the live-update handler so the closure is stable.
  const yesPriceRef = useRef(yesPrice);
  const noPriceRef  = useRef(noPrice);
  useEffect(() => { yesPriceRef.current = yesPrice; }, [yesPrice]);
  useEffect(() => { noPriceRef.current  = noPrice;  }, [noPrice]);

  // Listen for live price pushes keyed to this child market.
  useEffect(() => {
    function onLiveFetch(event) {
      if (event.detail?.type !== 'market.snapshot') return;
      if (event.detail.marketKey !== d.marketKey) return;

      const prices    = Array.isArray(event.detail?.payload?.prices) ? event.detail.payload.prices : [];
      const byKey     = new Map(prices.map((item) => [String(item.outcomeKey || item.outcomeId || ''), Number(item.price)]));
      const newYes    = byKey.has(d.canonical) ? byKey.get(d.canonical) : yesPriceRef.current;
      const newNo     = byKey.has(d.noOutcome)  ? byKey.get(d.noOutcome)  : Math.max(0, 1 - newYes);

      setYesPrice(newYes);
      setNoPrice(newNo);
      setProb(Math.round(newYes * 100));

      // volume now rides the snapshot (backend seam) → keep נפח live instead of
      // frozen at SSR until a page refresh.
      const vol = event.detail?.payload?.volume;
      if (vol && vol.label != null) setVolumeLabel(vol.label);
    }
    window.addEventListener('hz:market-live-fetch', onLiveFetch);
    return () => window.removeEventListener('hz:market-live-fetch', onLiveFetch);
  }, [d.marketKey, d.canonical, d.noOutcome]);

  return (
    <div
      class={`hz-outcome-row hz-event-row${selected ? ' hz-outcome-row--selected' : ''}`}
      data-event-child-row
      data-child-market-key={d.marketKey}
      data-child-canonical={d.canonical}
      data-child-no-outcome={d.noOutcome}
      data-child-yes-price={yesPrice}
      data-child-no-price={noPrice}
      data-child-label={d.label}
      data-child-crest={d.crest}
      data-child-status={c.status}
    >
      <a class="hz-outcome-row__main hz-event-row__link" href={`/markets/${d.marketKey}?focus=1`}>
        {d.crest && (
          <span class="hz-outcome-row__avatar hz-outcome-row__avatar--photo">
            <img src={d.crest} alt="" loading="lazy" decoding="async" />
          </span>
        )}
        <div class="hz-outcome-row__text">
          <span class="hz-outcome-row__title">{c.label || c.marketId}</span>
          <div class="hz-outcome-row__meta">
            {volumeLabel != null && (
              <span class="hz-outcome-row__volume">נפח <VShekelText text={volumeLabel} /></span>
            )}
            {holding && (holding.yes > 0 || holding.no > 0) && (
              <span class="hz-event-row__holding" title="הפוזיציה שלך">
                {holding.yes > 0 && (
                  <span class="hz-event-row__holding-chip hz-event-row__holding-chip--yes">{fmtShares(holding.yes)}·כן</span>
                )}
                {holding.no > 0 && (
                  <span class="hz-event-row__holding-chip hz-event-row__holding-chip--no">{fmtShares(holding.no)}·לא</span>
                )}
              </span>
            )}
          </div>
        </div>
      </a>
      <div class="hz-outcome-row__probability hz-event-row__probability">
        <span class="hz-outcome-row__probability-value" data-event-child-prob>{prob}%</span>
        {delta !== 0 && (
          <span class={`hz-outcome-row__delta hz-event-row__delta ${delta > 0 ? 'is-up' : 'is-down'}`}>
            {delta > 0 ? '+' : ''}{delta}%
          </span>
        )}
      </div>
      <div class="hz-outcome-row__actions">
        <button
          class="hz-trade-button hz-trade-button--yes"
          type="button"
          data-event-buy
          data-side="yes"
          data-ticket-outcome-id={d.canonical}
          data-ticket-order-side="buy"
          data-ticket-contract-side="yes"
          onClick={() => onBuy(d.marketKey, 'yes')}
        >
          <span>כן</span>
          <span dir="ltr" data-event-child-price-yes><VShekelProbabilityPrice value={yesPrice} /></span>
        </button>
        <button
          class="hz-trade-button hz-trade-button--no"
          type="button"
          data-event-buy
          data-side="no"
          data-ticket-outcome-id={d.canonical}
          data-ticket-order-side="buy"
          data-ticket-contract-side="no"
          onClick={() => onBuy(d.marketKey, 'no')}
        >
          <span>לא</span>
          <span dir="ltr" data-event-child-price-no><VShekelProbabilityPrice value={noPrice} /></span>
        </button>
      </div>
    </div>
  );
}

// ─── root component ──────────────────────────────────────────────────────────

// `items` not `children`: `children` is a reserved Preact prop (slot content),
// so the event-child data must arrive under a non-reserved name.
export default function EventLadder({ items = [], selectedMarketId }) {
  const [selectedKey, setSelectedKey] = useState(selectedMarketId ?? null);

  const active   = items.filter((c) => !isTerminal(c.status) && !isClosed(c.status));
  const closed   = items.filter((c) => isClosed(c.status));
  const resolved = items.filter((c) =>  isTerminal(c.status));

  // Per-child holdings so each active row can show "you hold X·כן/לא". Derived
  // from the shared portfolio snapshot; refreshed when a trade lands (the shared
  // ticket dispatches navi:portfolio-snapshot-updated) or auth flips.
  const childMeta = useMemo(() => {
    const map = {};
    for (const c of items) {
      const d = rowData(c);
      if (d.marketKey) map[d.marketKey] = { canonical: d.canonical, noOutcome: d.noOutcome };
    }
    return map;
  }, [items]);
  const [holdingsByMarket, setHoldingsByMarket] = useState({});
  const refreshHoldings = useCallback(async () => {
    const auth = window.NaviAuthSession?.getState?.();
    if (auth?.enabled && auth.initialized && !auth.authenticated) { setHoldingsByMarket({}); return; }
    try {
      const snap = await fetchSnapshot();
      const map = {};
      for (const p of snap?.positions || []) {
        const meta = childMeta[p.marketKey];
        if (!meta) continue;
        const shares = Number(p?.shares || p?.quantity || 0);
        if (!(shares > 0)) continue;
        const side = p.outcomeKey === meta.canonical ? 'yes'
                   : p.outcomeKey === meta.noOutcome ? 'no' : null;
        if (!side) continue;
        if (!map[p.marketKey]) map[p.marketKey] = { yes: 0, no: 0 };
        map[p.marketKey][side] += shares;
      }
      setHoldingsByMarket(map);
    } catch {
      setHoldingsByMarket({});
    }
  }, [childMeta]);
  useEffect(() => {
    refreshHoldings();
    const onUpdate = () => refreshHoldings();
    window.addEventListener('navi:portfolio-snapshot-updated', onUpdate);
    window.addEventListener('navi:auth-state', onUpdate);
    return () => {
      window.removeEventListener('navi:portfolio-snapshot-updated', onUpdate);
      window.removeEventListener('navi:auth-state', onUpdate);
    };
  }, [refreshHoldings]);

  // armChild: move selected emphasis + retarget the trade ticket.
  // Mirrors armChild() in event-mode.client.js exactly.
  const armChild = useCallback((marketKey, side, rowEl) => {
    setSelectedKey(marketKey);

    // rowEl is the DOM node we need to read data-* from — kept in sync by
    // the data-child-* attrs on ActiveRow. We read them off the DOM so the
    // retarget payload is always fresh (live-fetch may have updated them).
    const ticketHost = document.querySelector('[data-hz-ticket]');
    if (!ticketHost || !ticketHost._hzTicket) return;

    // Re-read the live data-* attrs from the clicked row in the DOM.
    const row = rowEl || document.querySelector(
      `[data-event-child-row][data-child-market-key="${CSS.escape(marketKey)}"]`
    );
    if (!row) return;

    const target = {
      marketKey:         row.dataset.childMarketKey,
      canonicalOutcomeId: row.dataset.childCanonical,
      noOutcomeId:       row.dataset.childNoOutcome,
      yesPrice:          Number(row.dataset.childYesPrice),
      noPrice:           Number(row.dataset.childNoPrice),
      title:             row.dataset.childLabel,
      crest:             row.dataset.childCrest || '',
      marketStatus:      row.dataset.childStatus || 'open',
      side:              side === 'no' ? 'no' : 'yes',
    };
    ticketHost._hzTicket.retarget(target);
    window.dispatchEvent(new CustomEvent('hz:market-live-target', { detail: target }));
  }, []);

  // Click handler attached to the section so we also cover any future CTA
  // added outside ActiveRow, matching the original delegated listener shape.
  function handleSectionClick(e) {
    const cta = e.target.closest('[data-event-buy]');
    if (!cta) return;
    const row = cta.closest('[data-event-child-row]');
    if (!row) return;
    armChild(row.dataset.childMarketKey, cta.dataset.side, row);
  }

  return (
    <section
      class="market-detail-panel hz-outcome-ladder hz-event-ladder"
      data-hz-event-ladder
      onClick={handleSectionClick}
    >
      <div class="hz-event-ladder__section-label">פעילים ({active.length})</div>
      <div class="hz-outcome-ladder__list divide-y divide-white/5">
        {active.map((c) => (
          <ActiveRow
            key={c.marketId}
            c={c}
            selected={c.marketId === selectedKey}
            holding={holdingsByMarket[c.marketId]}
            onBuy={(mk, side) => {
              // Locate the DOM row by its data attr so armChild can read live prices.
              const rowEl = document.querySelector(
                `[data-event-child-row][data-child-market-key="${CSS.escape(mk)}"]`
              );
              armChild(mk, side, rowEl);
            }}
          />
        ))}
      </div>

      {resolved.length > 0 && (
        <details class="hz-event-ladder__resolved" open>
          <summary class="hz-event-ladder__resolved-summary">הוכרעו ({resolved.length})</summary>
          <div class="hz-outcome-ladder__list hz-outcome-ladder--resolved divide-y divide-white/5">
            {resolved.map((c) => (
              <ResolvedRow key={c.marketId} c={c} />
            ))}
          </div>
        </details>
      )}
      {closed.length > 0 && (
        <details class="hz-event-ladder__resolved" open>
          <summary class="hz-event-ladder__resolved-summary">ממתינים להכרעה ({closed.length})</summary>
          <div class="hz-outcome-ladder__list hz-outcome-ladder--resolved divide-y divide-white/5">
            {closed.map((c) => (
              <ClosedRow key={c.marketId} c={c} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
