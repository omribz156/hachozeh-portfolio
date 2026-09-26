import { useState, useEffect, useCallback } from 'preact/hooks';
import { VShekelAmount } from '../currency/VShekel.jsx';
import { fetchSnapshot } from './snapshot-fetch.js';

// ---------------------------------------------------------------------------
// Formatters (1:1 from viewer-positions.client.js)
// ---------------------------------------------------------------------------

const nf = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 2 });
const pct = (n) => `${Math.round((Number(n) || 0) * 100)}%`;

// ---------------------------------------------------------------------------
// Holdings helpers (1:1 from viewer-positions.client.js)
// ---------------------------------------------------------------------------

function emptyHoldings() {
  return {
    yes: { shares: 0, costBasis: 0, averageCost: 0 },
    no:  { shares: 0, costBasis: 0, averageCost: 0 },
  };
}

function addHolding(target, position) {
  const shares = Number(position?.shares || position?.quantity || 0);
  const costBasis = Number(position?.costBasis || 0);
  if (!Number.isFinite(shares) || shares <= 0) return;
  target.shares += shares;
  target.costBasis += Number.isFinite(costBasis) ? costBasis : 0;
  target.averageCost = target.shares > 0 ? target.costBasis / target.shares : 0;
}

// Holdings are stored PER OUTCOME: a binary market holds two distinct outcomes
// (canonical = "כן", the other = "לא"), each as its own position. We bucket by
// outcome id — NOT by a contractSide split on the canonical outcome.
//
// IMPORTANT: `snapshot.positions` and `snapshot.contractPositions` are the SAME
// holdings in two representations. Reading both double-counts (the old 2× bug).
// Use one source only — `positions`, the raw per-outcome view.
function holdingsFor(snapshot, marketKey, canonicalOutcomeId, noOutcomeId) {
  const holdings = emptyHoldings();
  for (const position of snapshot?.positions || []) {
    if (position.marketKey !== marketKey) continue;
    if (position.outcomeKey === canonicalOutcomeId) addHolding(holdings.yes, position);
    else if (noOutcomeId && position.outcomeKey === noOutcomeId) addHolding(holdings.no, position);
  }
  return holdings;
}

// ---------------------------------------------------------------------------
// Sub-components — rendered DOM is 1:1 identical to renderRow() / render()
// ---------------------------------------------------------------------------

function PositionRow({ side, label, holding, price, onSell }) {
  const markValue = holding.shares * price;
  const pnl = markValue - holding.costBasis;
  const tone = pnl >= 0 ? 'up' : 'down';

  return (
    <article class="hz-viewer-positions__row">
      <div>
        <span class="hz-viewer-positions__side">{label}</span>
        <span class="hz-viewer-positions__price">{pct(price)}</span>
      </div>
      <div><span>כמות</span><b dir="ltr">{nf.format(holding.shares)}</b></div>
      <div><span>עלות ממוצעת</span><b><VShekelAmount value={holding.averageCost} /></b></div>
      <div><span>שווי</span><b><VShekelAmount value={markValue} /></b></div>
      <div>
        <span>תשואה</span>
        <b class={`hz-viewer-positions__pnl hz-viewer-positions__pnl--${tone}`}>
          <VShekelAmount value={pnl} />
        </b>
      </div>
      <button
        type="button"
        data-viewer-position-sell={side}
        onClick={() => onSell(side)}
      >מכור</button>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export default function ViewerPositions({
  marketKey,
  canonicalOutcomeId,
  noOutcomeId = '',
  yesLabel = 'כן',
  noLabel  = 'לא',
  yesPrice: initialYesPrice = 0,
  noPrice:  initialNoPrice  = 0,
}) {
  // prices can be updated by hz:market-live-fetch before or after mount
  const [yesPrice, setYesPrice] = useState(Number(initialYesPrice) || 0);
  const [noPrice,  setNoPrice]  = useState(Number(initialNoPrice)  || 0);
  const [holdings, setHoldings] = useState(null); // null = not-yet-loaded

  // ------------------------------------------------------------------
  // refresh: fetch snapshot and derive holdings
  // ------------------------------------------------------------------
  const refresh = useCallback(async () => {
    const auth = window.NaviAuthSession?.getState?.();
    if (auth?.enabled && auth.initialized && !auth.authenticated) {
      setHoldings(emptyHoldings()); // clear (same as root.replaceChildren())
      return;
    }
    try {
      const snapshot = await fetchSnapshot();
      setHoldings(holdingsFor(snapshot, marketKey, canonicalOutcomeId, noOutcomeId));
    } catch {
      setHoldings(emptyHoldings());
    }
  }, [marketKey, canonicalOutcomeId, noOutcomeId]);

  // ------------------------------------------------------------------
  // Sell button handler — dispatches the same CustomEvent the trade
  // ticket (vanilla) listens for.
  // ------------------------------------------------------------------
  const handleSell = useCallback((side) => {
    window.dispatchEvent(new CustomEvent('hz:viewer-position-sell', {
      detail: { contractSide: side },
    }));
  }, []);

  // ------------------------------------------------------------------
  // Window event listeners
  // ------------------------------------------------------------------
  useEffect(() => {
    function onAuthState() { refresh(); }
    function onSnapshotUpdated() { refresh(); }
    function onMarketLiveFetch(event) {
      if (event.detail?.marketKey !== marketKey || event.detail?.type !== 'market.snapshot') return;

      // Replicate applyMarketSnapshot: update prices from live payload
      const prices = Array.isArray(event.detail?.payload?.prices) ? event.detail.payload.prices : [];
      if (!prices.length) {
        refresh();
        return;
      }
      const priceByOutcome = new Map(
        prices.map((item) => [String(item.outcomeKey || item.outcomeId || ''), Number(item.price)])
      );
      const readPrice = (key, fallback) => {
        const value = priceByOutcome.get(String(key || ''));
        return Number.isFinite(value) ? value : fallback;
      };

      setYesPrice((prev) => readPrice(canonicalOutcomeId, prev));
      if (noOutcomeId) {
        setNoPrice((prev) => readPrice(noOutcomeId, prev));
      }
      refresh();
    }

    window.addEventListener('navi:auth-state', onAuthState);
    window.addEventListener('navi:portfolio-snapshot-updated', onSnapshotUpdated);
    window.addEventListener('hz:market-live-fetch', onMarketLiveFetch);

    return () => {
      window.removeEventListener('navi:auth-state', onAuthState);
      window.removeEventListener('navi:portfolio-snapshot-updated', onSnapshotUpdated);
      window.removeEventListener('hz:market-live-fetch', onMarketLiveFetch);
    };
  }, [marketKey, canonicalOutcomeId, noOutcomeId, refresh]);

  // Initial load
  useEffect(() => {
    refresh();
  }, [refresh]);

  // ------------------------------------------------------------------
  // Render — 1:1 DOM match with render() + renderRow() in client.js
  // ------------------------------------------------------------------

  // Not yet loaded: render nothing (same as empty root before first paint)
  if (holdings === null) return null;

  const yesShares = holdings.yes.shares;
  const noShares  = holdings.no.shares;

  // No holdings: render nothing (same as root.replaceChildren())
  if (yesShares <= 0 && noShares <= 0) return null;

  return (
    <section class="hz-viewer-positions">
      <header class="hz-viewer-positions__header">
        <h2>הפוזיציה שלך</h2>
        <a href="/portfolio">לתיק המלא</a>
      </header>
      <div class="hz-viewer-positions__rows">
        {yesShares > 0 && (
          <PositionRow
            side="yes"
            label={yesLabel}
            holding={holdings.yes}
            price={yesPrice}
            onSell={handleSell}
          />
        )}
        {noShares > 0 && (
          <PositionRow
            side="no"
            label={noLabel}
            holding={holdings.no}
            price={noPrice}
            onSell={handleSell}
          />
        )}
      </div>
    </section>
  );
}
