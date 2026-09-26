import { useEffect, useState } from 'preact/hooks';
import { VShekelAmount, VShekelPrice } from '../currency/VShekel.jsx';

// DOM structure, classes, data-* attrs, and ARIA are byte-identical to the original SSR output.

function pct(current, outcomeId) {
  const value = Number(current?.[outcomeId] ?? 0);
  return Math.max(0, Math.min(100, Math.round(value * 100)));
}

function volumeAmount(outcomeVolumes, outcomeId) {
  const rawValue = outcomeVolumes?.[outcomeId] ?? 0;
  const value = Number(String(rawValue).replace(/[^\d.-]/g, ''));
  return Number.isFinite(value) ? value : 0;
}

// Sub-floor volumes come through as null (see shared/public-volume.ts). The
// span is omitted entirely rather than showing "V₪ 0".
function hasVolume(outcomeVolumes, outcomeId) {
  return outcomeVolumes?.[outcomeId] != null;
}

export default function OutcomeLadder({ marketKey, outcomes = [], current = {}, outcomeVolumes = {} }) {
  // Which outcome+side the row highlight follows. Defaults to the first outcome's
  // yes side (the prior static default), then tracks whichever כן/לא the user taps
  // so the emphasis moves with the selection instead of staying stuck on row 0.
  const [sel, setSel] = useState({ id: outcomes[0]?.id ?? null, side: 'yes' });
  useEffect(() => {
    // Mirror of the inline <script> from OutcomeLadder.astro:
    // listen to window 'hz:market-live-fetch' and update price nodes in the DOM.
    const ladder = document.querySelector('[data-hz-outcome-ladder]');
    if (!ladder) return;
    const key = ladder.getAttribute('data-ticket-market-key') || '';
    const money = (p) => {
      const amount = Math.max(0, Math.min(100, Math.round(Number(p) || 0)));
      return window.HZCurrency?.moneyHtml?.(amount) || `V₪ ${amount}`;
    };

    // last-seen values so the cue fires only on a real change (HzLive falls back to
    // a plain text set if the helper hasn't loaded).
    const prev = {};
    const put = (node, text, key, num) => {
      if (!node) return;
      node.innerHTML = text;
      window.HZCurrency?.upgrade?.(node);
      if (prev[key] !== undefined && prev[key] !== num) {
        node.classList.remove('hz-live-pulse');
        void node.offsetWidth;
        node.classList.add('hz-live-pulse');
      }
      prev[key] = num;
    };

    function handleLiveFetch(event) {
      if (event.detail?.marketKey !== key || event.detail?.type !== 'market.snapshot') return;
      const prices = Array.isArray(event.detail?.payload?.prices) ? event.detail.payload.prices : [];
      prices.forEach((item) => {
        const rowKey = String(item.outcomeKey || item.outcomeId || '');
        const row = Array.from(ladder.querySelectorAll('[data-outcome-row]')).find(
          (candidate) => candidate.dataset.outcomeRowId === rowKey,
        );
        if (!row) return;
        const yes = Math.max(0, Math.min(100, Math.round(Number(item.price || 0) * 100)));
        const no = 100 - yes;
        put(row.querySelector('[data-outcome-price-prob]'), yes + '%', 'prob:' + rowKey, yes);
        put(row.querySelector('[data-outcome-price-yes]'), money(yes), 'yes:' + rowKey, yes);
        put(row.querySelector('[data-outcome-price-no]'), money(no), 'no:' + rowKey, no);
      });
    }

    window.addEventListener('hz:market-live-fetch', handleLiveFetch);
    return () => window.removeEventListener('hz:market-live-fetch', handleLiveFetch);
  }, [marketKey]);

  return (
    <section
      class="market-detail-panel hz-outcome-ladder"
      data-hz-outcome-ladder
      data-ticket-market-key={marketKey}
    >
      <div class="market-detail-outcomes-head">
        <span class="flex-1 pr-2">תוצאה</span>
        <span class="w-20 text-center">הסתברות</span>
        <span class="w-24 text-center hidden sm:block">מגמה</span>
        <span class="w-56 text-center pl-2">מסחר</span>
      </div>
      <div class="hz-outcome-ladder__list divide-y divide-white/5">
        {outcomes.map((outcome, index) => {
          const value = pct(current, outcome.id);
          const noValue = 100 - value;
          const resolved = outcome.finalValue != null;
          const win = Number(outcome.finalValue) === 1;
          const delta = Math.round(Number(outcome.probabilityChange ?? 0) * 100);
          const isDraw = /^(תיקו|draw|tie)$/i.test(String(outcome.label || outcome.shortLabel || '').trim());
          const isSel = outcome.id === sel.id;
          const rowClass = [
            'hz-outcome-row',
            resolved
              ? `hz-outcome-row--resolved hz-outcome-row--${win ? 'winner' : 'loser'}`
              : isSel
              ? 'hz-outcome-row--selected'
              : '',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <article
              class={rowClass}
              data-outcome-row
              data-outcome-row-id={outcome.id}
            >
              <div class="hz-outcome-row__main">
                {(outcome.crestPath || isDraw) && (
                  <span class={`hz-outcome-row__avatar${outcome.crestPath ? ' hz-outcome-row__avatar--photo' : ' hz-outcome-row__avatar--draw'}`}>
                    {outcome.crestPath
                      ? <img src={outcome.crestPath} alt={outcome.label || ''} loading="lazy" decoding="async" />
                      : (
                          <svg class="hz-outcome-row__draw-glyph" viewBox="0 0 24 24" aria-hidden="true">
                            <rect x="5" y="8.4" width="14" height="2.7" rx="1.35" />
                            <rect x="5" y="12.9" width="14" height="2.7" rx="1.35" />
                          </svg>
                        )}
                  </span>
                )}
                <div class="hz-outcome-row__text">
                  <span class="hz-outcome-row__title">{outcome.label || outcome.id}</span>
                  <div class="hz-outcome-row__meta">
                    {hasVolume(outcomeVolumes, outcome.id) && (
                      <span class="hz-outcome-row__volume">נפח <VShekelAmount value={volumeAmount(outcomeVolumes, outcome.id)} maximumFractionDigits={0} /></span>
                    )}
                    <span class="hz-outcome-row__holdings" data-outcome-row-holdings={outcome.id}></span>
                  </div>
                </div>
              </div>
              <div class="hz-outcome-row__probability">
                <span class="hz-outcome-row__probability-value" data-outcome-price-prob>{value}%</span>
                {delta !== 0 && (
                  <span class={`hz-outcome-row__delta ${delta > 0 ? 'is-up' : 'is-down'}`}>
                    {delta > 0 ? '+' : ''}{delta}%
                  </span>
                )}
              </div>
              <div class="hz-outcome-row__sparkline" aria-hidden="true"></div>
              <div class="hz-outcome-row__actions">
                <button
                  class={`hz-trade-button hz-trade-button--yes${isSel && sel.side === 'yes' ? ' hz-trade-button--selected' : ''}`}
                  data-ticket-market-key={marketKey}
                  data-ticket-outcome-id={outcome.id}
                  data-ticket-order-side="buy"
                  data-ticket-contract-side="yes"
                  type="button"
                  onClick={() => setSel({ id: outcome.id, side: 'yes' })}
                >
                  <span>כן</span>
                  <span data-outcome-price-yes><VShekelPrice value={value} /></span>
                </button>
                <button
                  class={`hz-trade-button hz-trade-button--no${isSel && sel.side === 'no' ? ' hz-trade-button--selected' : ''}`}
                  data-ticket-market-key={marketKey}
                  data-ticket-outcome-id={outcome.id}
                  data-ticket-order-side="buy"
                  data-ticket-contract-side="no"
                  type="button"
                  onClick={() => setSel({ id: outcome.id, side: 'no' })}
                >
                  <span>לא</span>
                  <span data-outcome-price-no><VShekelPrice value={noValue} /></span>
                </button>
              </div>
              {resolved && (
                <div
                  class={`hz-outcome-row__resolution-chip hz-outcome-row__resolution-chip--${win ? 'winner' : 'loser'}`}
                >
                  <span class="hz-outcome-row__resolution-chip-glyph">{win ? '✓' : '✗'}</span>
                  <span>{win ? 'כן' : 'לא'}</span>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
