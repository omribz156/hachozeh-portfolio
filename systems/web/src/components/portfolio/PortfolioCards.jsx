import { useState, useEffect, useRef } from 'preact/hooks';
import { VShekelText } from '../currency/VShekel.jsx';
import usePortfolioModel from './usePortfolioModel.js';

// Owns the top-fold cards section: TotalCard, ChangeCard (PnL sparkline),
// Claims (נצחונות), ClosingSoon.
//
// This island is a SIBLING of [data-portfolio-cards], mounted via
// <PortfolioCards client:load /> in PortfolioIsland.astro. It must never be
// placed inside [data-portfolio-cards] — the orchestrator's innerHTML would
// destroy a hydrated island placed inside that container.
//
// The data layer stays vanilla. Model is read via usePortfolioModel() which
// reads from window.NaviPortfolioDataSource / window.NaviPortfolioViewModel.
// No own fetch.

// ─── TotalCard ───────────────────────────────────────────────────────────────
// Port of total-card.js · render(summary, asOfLabel).

function TotalCard({ summary, asOfLabel }) {
  if (!summary) return null;

  return (
    <section class="pf-total-card" data-portfolio-total>
      <dl class="pf-total-secondary">
        <div class="pf-total-secondary-row pf-total-secondary-row--lede">
          <dt>שווי תיק</dt>
          <dd><VShekelText text={summary.totalValue} /></dd>
        </div>
        <div class="pf-total-secondary-row">
          <dt>זמין למסחר</dt>
          <dd><VShekelText text={summary.availableValue} /></dd>
        </div>
        <div class="pf-total-secondary-row">
          <dt>שווי פוזיציות</dt>
          <dd><VShekelText text={summary.positionsValue} /></dd>
        </div>
      </dl>
      {asOfLabel && <div class="pf-card-meta">{asOfLabel}</div>}
    </section>
  );
}

// ─── ClosingSoon ─────────────────────────────────────────────────────────────
// Port of closing-soon.js · render() + startTicking()/stopTicking().
//
// The vanilla module kept a module-level tickHandle and mutated DOM text nodes
// directly. In Preact we keep a `ticks` counter in state; every second we
// re-classify each row's remaining time and produce new label strings. Rows
// whose timing returns null (expired) are filtered out so they disappear
// exactly as the vanilla `row.remove()` did.
//
// The interval is started in a useEffect and cleaned up on unmount. It also
// re-starts whenever `positions` changes so a fresh model always gets a fresh
// tick cycle.

function ClosingSoonRow({ entry }) {
  const marketHref = `/markets/${encodeURIComponent(entry.marketKey)}`;
  return (
    <li
      class={`pf-closing-row${entry.timing.live ? ' is-live' : ''}`}
      data-portfolio-close-at={entry.timing.live ? entry.timing.closeAt : undefined}
    >
      <a class="pf-closing-link" href={marketHref}>
        <span class="pf-closing-title">{entry.marketTitle}</span>
        <span class={`pf-state-chip pf-tone-${entry.currentStateTone}`}>{entry.currentStateLabel}</span>
        <span class={`pf-state-chip pf-tone-${entry.marketSaysTone}`}>{entry.marketSaysLabel}</span>
        <span class="pf-closing-value"><VShekelText text={entry.currentValueLabel} /></span>
        <span class="pf-closing-time">{entry.liveLabel ?? entry.timing.label}</span>
      </a>
    </li>
  );
}

function ClosingSoon({ positions }) {
  // SSR-guard: window.NaviPortfolioViewModel unavailable on Node.
  const getVm = () =>
    typeof window !== 'undefined' ? window.NaviPortfolioViewModel : null;

  // Compute the initial entries synchronously so the first render is correct
  // even before the first tick fires.
  function computeEntries(now) {
    const vm = getVm();
    if (!vm?.closingSoonPositions) return [];
    return vm.closingSoonPositions(positions, now, 3);
  }

  const [entries, setEntries] = useState(() => computeEntries(new Date()));
  // Per-row live labels keyed by closeAt string. We store these separately so
  // we can update label text without re-computing the full entry list.
  const [liveLabels, setLiveLabels] = useState({});

  // Re-compute full entry list whenever positions prop changes (new model).
  useEffect(() => {
    setEntries(computeEntries(new Date()));
    setLiveLabels({});
  }, [positions]);

  // Countdown interval — fires every 1 second, re-classifies live rows.
  // Rows whose classifyClosingTime returns null are expired and dropped.
  //
  // Background-tab guard mirrors Community.jsx's activity-feed poll: skip the
  // tick body while document.hidden (a hidden tab gains nothing from a 1s
  // countdown burning CPU/battery), and re-run the same tick immediately on
  // visibilitychange so the countdown catches up instead of showing a stale
  // label for up to a second after the tab regains focus.
  useEffect(() => {
    const liveEntries = entries.filter((e) => e.timing.live);
    if (liveEntries.length === 0) return;

    function tick() {
      const vm = getVm();
      if (!vm?.classifyClosingTime) return;
      const now = new Date();
      const nextLabels = {};
      const expiredKeys = new Set();

      liveEntries.forEach((entry) => {
        const timing = vm.classifyClosingTime(entry.timing.closeAt, now);
        if (!timing) {
          expiredKeys.add(entry.timing.closeAt);
        } else {
          nextLabels[entry.timing.closeAt] = timing.label;
        }
      });

      if (expiredKeys.size > 0) {
        // Drop expired rows from the rendered list.
        setEntries((prev) => prev.filter((e) => !expiredKeys.has(e.timing.closeAt)));
      }
      setLiveLabels(nextLabels);
    }

    const id = window.setInterval(() => {
      if (!document.hidden) tick();
    }, 1000);
    const onVisible = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // Re-subscribe when the live entries set changes (e.g. after expiry).
  }, [entries]);

  // Hide the whole strip when nothing's closing soon — match vanilla behavior.
  if (entries.length === 0) return null;

  return (
    <section class="pf-closing-card" data-portfolio-closing-card>
      <header class="pf-card-eyebrow">סוגרים בקרוב</header>
      <div class="pf-closing-columns" aria-hidden="true">
        <span>שוק</span>
        <span>אני</span>
        <span>השוק</span>
        <span>שווי</span>
        <span>סגירה</span>
      </div>
      <ol class="pf-closing-list">
        {entries.map((entry) => (
          <ClosingSoonRow
            key={entry.timing.closeAt ?? entry.marketKey}
            entry={{
              ...entry,
              liveLabel: entry.timing.live ? (liveLabels[entry.timing.closeAt] ?? entry.timing.label) : null,
            }}
          />
        ))}
      </ol>
    </section>
  );
}

// ─── Claims ──────────────────────────────────────────────────────────────────
// Port of claims.js · render(). The claim button action moves into the island:
// on click → claimPortfolioReward(claimId) → dispatch snapshot-updated event
// (which causes usePortfolioModel's refresh subscription to fire).
//
// Returns null when no claimable entries exist — matches vanilla empty behavior.

function ClaimRow({ entry, onClaim, claiming, failedId }) {
  const claimId = entry.claimId || entry.marketKey;
  const failed = failedId === claimId;
  return (
    <li class="pf-claim-row">
      <span class="pf-claim-title">{entry.marketTitle}</span>
      <span class="pf-claim-outcome">
        <span class="pf-state-chip pf-tone-buy">{entry.outcomeLabel || ''}</span>
      </span>
      <button
        type="button"
        class="pf-claim-amount"
        aria-disabled={claiming === claimId}
        onClick={() => onClaim(entry)}
      ><VShekelText text={entry.toWinLabel} /></button>
      <button
        class="pf-claim-button"
        type="button"
        data-portfolio-claim={claimId}
        disabled={claiming === claimId}
        onClick={() => onClaim(entry)}
      >אסוף</button>
      {failed && (
        <span class="pf-claim-error" role="status">לא הצלחנו לאסוף. נסו שוב.</span>
      )}
    </li>
  );
}

function claimShareParams(entry, payload) {
  const claim = payload?.claim || {};
  const params = new URLSearchParams();
  const claimId = claim.claimId || entry.claimId || '';
  const marketKey = claim.marketKey || entry.marketKey || '';
  const title = claim.marketTitle || entry.marketTitle || '';
  const outcome = claim.outcomeLabel || entry.outcomeLabel || '';
  const amount = claim.proceeds || entry.toWin || '';
  const amountLabel = entry.toWinLabel || '';

  // `claim` is the persisted-truth key: once share consent is stamped, the share
  // page/card render identity + entry odds from the backend snapshot. The plain
  // params below are the pre-consent fallback — deletable once consent stamping
  // is verified in prod (see share-loop-audit.md).
  if (claimId) params.set('claim', claimId);
  if (marketKey) params.set('market', marketKey);
  if (title) params.set('title', title.slice(0, 140));
  if (outcome) params.set('outcome', outcome.slice(0, 60));
  if (amount) params.set('amount', String(amount));
  if (amountLabel) params.set('amountLabel', amountLabel);

  return params.toString();
}

// Act-of-share = consent: the first real share action stamps the claim as
// publicly readable. Fire-and-forget, once per opened modal.
function buildClaimShareConsent(claimId) {
  if (!claimId) return null;
  let sent = false;
  return () => {
    if (sent) return;
    sent = true;
    fetch(`/api/portfolio/claims/${encodeURIComponent(claimId)}/share`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }).catch(() => {});
  };
}

function formatClaimShareAmount(entry, payload) {
  const value = Number(payload?.claim?.proceeds ?? entry?.toWin);
  if (!Number.isFinite(value)) return entry?.toWinLabel || '';
  return `V₪ ${new Intl.NumberFormat('he-IL', {
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value)}`;
}

function openClaimShare(entry, payload) {
  if (typeof window === 'undefined' || !window.HachozehShare?.open) return;

  const query = claimShareParams(entry, payload);
  if (!query) return;

  const title = payload?.claim?.marketTitle || entry.marketTitle || 'שוק בהחוזה';
  const amountLabel = formatClaimShareAmount(entry, payload);

  window.HachozehShare.open({
    kind: 'claim',
    title: 'קריאה נכונה בהחוזה',
    text: amountLabel ? `קראתי את זה נכון: "${title}". ${amountLabel} בהחוזה.` : `קראתי את זה נכון: "${title}". בהחוזה.`,
    url: `/share/claims/win?${query}`,
    image: `/share/claims/win.png?${query}`,
    onAction: buildClaimShareConsent(payload?.claim?.claimId || entry.claimId),
  });
}

// Shared with the parent (PortfolioCards) so it can decide glance-first
// ordering — pending claims first — without duplicating the derivation.
function resolveClaimEntries(claimsOrPositions) {
  if (!claimsOrPositions?.length) return [];
  if (claimsOrPositions.some((e) => e.claimId)) return claimsOrPositions;
  const vm = typeof window !== 'undefined' ? window.NaviPortfolioViewModel : null;
  return vm?.claimablePositions?.(claimsOrPositions) ?? [];
}

function Claims({ claimsOrPositions, leading }) {
  const [claiming, setClaiming] = useState(null);
  const [failedId, setFailedId] = useState(null);

  const entries = resolveClaimEntries(claimsOrPositions);

  if (entries.length === 0) return null;

  function handleClaim(entry) {
    const ds = typeof window !== 'undefined' ? window.NaviPortfolioDataSource : null;
    const claimId = entry?.claimId || entry?.marketKey;
    if (!ds?.claimPortfolioReward || claiming) return;
    setClaiming(claimId);
    setFailedId(null);
    ds.claimPortfolioReward(claimId)
      .then((payload) => {
        openClaimShare(entry, payload);
        // Invalidate the cache so the model re-loads with the claim removed.
        ds.invalidate?.();
        window.dispatchEvent(new CustomEvent('navi:portfolio-snapshot-updated'));
      })
      .catch(() => {
        // Claim failed: keep it visible and tell the user, so they can retry
        // instead of wondering why the button stopped responding.
        setFailedId(claimId);
      })
      .finally(() => setClaiming(null));
  }

  return (
    <section class={`pf-claims-card${leading ? ' pf-claims-card--leading' : ''}`} data-portfolio-claims>
      <header class="pf-claims-head">
        <span class="pf-card-eyebrow">נצחונות</span>
      </header>
      <div class="pf-claims-columns" aria-hidden="true">
        <span>שוק</span>
        <span>תוצאה</span>
        <span>רווח</span>
        <span></span>
      </div>
      <ol class="pf-claims-list">
        {entries.map((entry) => (
          <ClaimRow
            key={entry.claimId || entry.marketKey}
            entry={entry}
            onClaim={handleClaim}
            claiming={claiming}
            failedId={failedId}
          />
        ))}
      </ol>
    </section>
  );
}

// ─── ChangeCard ──────────────────────────────────────────────────────────────
// Port of change-card.js · render() + mount().
//
// The sparkline is a vanilla canvas/SVG renderer (window.HzPnlSparklineRenderer).
// We keep it vanilla and mount it via ref + useEffect:
//   1. The SVG element is created in JSX with a ref.
//   2. A useEffect fires after the SVG is in the DOM and calls
//      HzPnlSparklineRenderer.render(svgNode, { points, ... }).
//   3. The returned handle is stored on svgNode._hzPnlHandle (matching
//      change-card.js's convention) so the cleanup can call handle.destroy().
//   4. onHover/onLeave update `heroOverride` component state which swaps the
//      hero number, tone, direction glyph, and sub-eyebrow label.
//   5. On unmount / re-render (new timeframe) the effect teardown calls destroy().
//
// Timeframe pills are local state; selecting one calls
// readPortfolioPerformanceTimeframe(tf) then dispatches snapshot-updated so the
// hook's refresh fires and threads the new timeframe data into the model.

const TARGET_POINTS_BY_RANGE = {
  day: 24,
  week: 56,
  month: 60,
  year: 52,
  ytd: 52,
  all: 100,
};

// Default the PnL card to "day" (last 24h) on initial mount. The backend
// currently emits `activeTimeframe: "all"` on the perf endpoint — frontend
// overrides because "day" is the more useful glance for the analyst-study tone
// (most-recent movement, not all-time PnL). User picks any other range and that
// selection sticks for the session.
const DEFAULT_TIMEFRAME_ID = 'day';

function classifyTone(value) {
  if (value > 0) return 'buy';
  if (value < 0) return 'sell';
  return 'info';
}
function glyphForTone(tone) {
  if (tone === 'buy') return '▲';
  if (tone === 'sell') return '▼';
  return '·';
}

function ChangeCard({ change, activeTimeframeId, pendingTf, onTimeframeSelect }) {
  const svgRef = useRef(null);

  // Hover-driven hero override. null = show defaults from `view`.
  const [heroOverride, setHeroOverride] = useState(null);

  // The chart renders the ACTIVE timeframe (which only advances once its data is
  // loaded), so it never blanks. The pill highlight follows the PENDING
  // selection immediately so the click still feels responsive.
  const view = change?.viewsByTimeframe?.[activeTimeframeId];
  const displayTf = pendingTf ?? activeTimeframeId;

  // Default display values (used when not hovering).
  const heroTone = view?.isZero ? 'info' : (view?.totalMovementTone ?? 'info');
  const heroLabel = view?.totalMovementLabel ?? '';
  const directionGlyph = glyphForTone(heroTone);
  const defaultSubEyebrow = view?.subEyebrowLabel || '';

  // What's actually rendered — hover override takes precedence.
  const displayTone = heroOverride?.tone ?? heroTone;
  const displayLabel = heroOverride?.label ?? heroLabel;
  const displayGlyph = heroOverride?.glyph ?? directionGlyph;
  const displaySubEyebrow = heroOverride?.subEyebrow ?? defaultSubEyebrow;

  // Mount / remount the sparkline renderer whenever the SVG ref or view changes.
  // The effect runs AFTER the DOM is painted so svgRef.current is valid.
  useEffect(() => {
    const svgNode = svgRef.current;
    if (!svgNode) return;
    if (typeof window === 'undefined') return;
    if (!window.HzPnlSparklineRenderer) return;
    if (!view?.chartHasData) return;

    // Destroy any previous handle (idempotent on timeframe switch).
    if (svgNode._hzPnlHandle?.destroy) {
      svgNode._hzPnlHandle.destroy();
    }

    let points;
    try {
      points = JSON.parse(svgNode.dataset.portfolioChartPoints || '[]');
    } catch {
      points = [];
    }
    if (!points.length) return;

    const formatters = window.NaviPortfolioFormatters || {};
    function formatHoveredTime(date) {
      if (formatters.formatHebrewTooltipTimestamp) {
        return formatters.formatHebrewTooltipTimestamp(date.toISOString());
      }
      return date.toISOString();
    }

    const activeRange = svgNode.dataset.portfolioChartRange || 'day';
    const targetPoints = TARGET_POINTS_BY_RANGE[activeRange];

    const handle = window.HzPnlSparklineRenderer.render(svgNode, {
      points,
      targetPoints,
      reveal: true, // pen-draw the line + sync the area fill on mount + timeframe switch
      formatters: {
        formatValue: formatters.formatSignedCurrency,
        formatTime: formatHoveredTime,
      },
      onHover: ({ point, formatted }) => {
        const tone = classifyTone(point.value);
        setHeroOverride({
          tone,
          label: formatted.value,
          glyph: glyphForTone(tone),
          subEyebrow: formatted.time,
        });
      },
      onLeave: () => setHeroOverride(null),
    });

    svgNode._hzPnlHandle = handle;

    return () => {
      if (svgNode._hzPnlHandle?.destroy) {
        svgNode._hzPnlHandle.destroy();
        svgNode._hzPnlHandle = null;
      }
      // Clear any lingering hover state so defaults show on remount.
      setHeroOverride(null);
    };
    // Re-run when the view changes (new timeframe data) so a fresh renderer
    // is mounted into the new SVG.
  }, [view]);

  if (!change) return null;

  const timeframeRowMarkup = (
    <div class="pf-timeframes" role="tablist">
      {change.timeframes.map((t) => (
        <button
          key={t.id}
          class={`pf-timeframe${t.id === displayTf ? ' is-active' : ''}`}
          data-portfolio-timeframe={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === displayTf}
          onClick={() => onTimeframeSelect(t.id)}
        >{t.label}</button>
      ))}
    </div>
  );

  if (!view) {
    return (
      <section class="pf-change-card" data-portfolio-change>
        <div class="pf-change-head">
          <header class="pf-card-eyebrow">רווח/הפסד</header>
          {timeframeRowMarkup}
        </div>
        <div class="pf-empty">אין נתונים לטווח הזה.</div>
      </section>
    );
  }

  const chartPointsJson = view.chartHasData
    ? JSON.stringify(view.chartPoints)
    : '';

  return (
    <section
      class={`pf-change-card${pendingTf ? ' is-loading' : ''}`}
      data-portfolio-change
    >
      <div class="pf-change-head">
        <div class="pf-change-head-text">
          <header class="pf-card-eyebrow">
            <span class={`pf-change-direction pf-tone-${displayTone}`}>{displayGlyph}</span>
            <span>רווח/הפסד</span>
          </header>
          <div class={`pf-change-total pf-tone-${displayTone}`}><VShekelText text={displayLabel} /></div>
          {displaySubEyebrow && (
            <div class="pf-change-sub-eyebrow">{displaySubEyebrow}</div>
          )}
        </div>
        {timeframeRowMarkup}
      </div>

      {view.miniStatsLabel && (
        <div class="pf-change-mini-stats"><VShekelText text={view.miniStatsLabel} /></div>
      )}

      {view.chartHasData && (
        <div class="pf-change-sparkline-wrap">
          <svg
            ref={svgRef}
            class="hz-pnl-spark"
            data-portfolio-chart
            data-portfolio-chart-points={chartPointsJson}
            data-portfolio-chart-tone={view.totalMovementTone}
            data-portfolio-chart-range={activeTimeframeId}
            aria-hidden="true"
          />
        </div>
      )}
    </section>
  );
}

// ─── PortfolioCards (island root) ────────────────────────────────────────────
// Self-gates: returns null unless view === 'portfolio' and model is present.
// Active timeframe is local state here — ChangeCard reads it as a prop and
// calls onTimeframeSelect to update it. This mirrors the `state.activeTimeframeId`
// that portfolio.js maintained.

export default function PortfolioCards() {
  const { model, refresh } = usePortfolioModel();

  // Default to "day" — see comment in change-card.js and DEFAULT_TIMEFRAME_ID.
  const [activeTimeframeId, setActiveTimeframeId] = useState(DEFAULT_TIMEFRAME_ID);
  // The timeframe being loaded. The chart stays on `activeTimeframeId` until the
  // new range's data is in; `pendingTf` only drives the pill highlight + dim.
  const [pendingTf, setPendingTf] = useState(null);

  // Tell the vanilla shell we're painting, so it drops its loading skeleton without an
  // empty-frame gap. The EVENT alone is race-prone on soft-nav re-entry: this island can
  // re-hydrate and fire BEFORE portfolio.js re-binds its listener → the event is lost and
  // the skeleton stays stuck under the real cards. So we ALSO set a durable, synchronously-
  // checkable flag on `window` (survives soft-nav) that the orchestrator's paint() reads;
  // cleared on unmount so a fresh visit starts un-ready until this island paints again.
  useEffect(() => {
    if (model && typeof window !== 'undefined') {
      window.__pfCardsReady = true;
      window.dispatchEvent(new CustomEvent('navi:portfolio-content-ready'));
    }
    return () => { if (typeof window !== 'undefined') window.__pfCardsReady = false; };
  }, [!!model]);

  // Gate: render once a model is loaded.
  if (!model) return null;

  // Inject the active timeframe into the change model (same as portfolio.js did
  // before calling changeCard.render(model.change)).
  const changeWithTf = model.change
    ? { ...model.change, activeTimeframeId }
    : null;

  // Glance-first ordering (mobile-audit task 1.7): when there's something to
  // collect, put it first — don't make the user scroll past Total/PnL to find
  // it. Re-derived from `model` every render, so it re-settles automatically
  // after a claim, a refresh, or a live SSE snapshot update.
  const claimEntries = resolveClaimEntries(model.claims || model.positions);
  const hasPendingClaims = claimEntries.length > 0;

  const claimsCard = (
    <Claims claimsOrPositions={model.claims || model.positions} leading={hasPendingClaims} />
  );
  const topFold = (
    <div class="pf-top-fold">
      <TotalCard summary={model.summary} asOfLabel={model.asOfLabel} />
      <ChangeCard
        change={changeWithTf}
        activeTimeframeId={activeTimeframeId}
        pendingTf={pendingTf}
        onTimeframeSelect={handleTimeframeSelect}
      />
    </div>
  );

  async function handleTimeframeSelect(tf) {
    if (tf === activeTimeframeId) return;

    // Already loaded → switch instantly, the data's right there.
    if (model.change?.viewsByTimeframe?.[tf]) {
      setActiveTimeframeId(tf);
      return;
    }

    // Not loaded yet — keep the current chart on screen (don't advance
    // activeTimeframeId), mark the target pill pending, fetch the range, THEN
    // switch. This is what stops the blank-flash jump on date change.
    setPendingTf(tf);
    const ds = typeof window !== 'undefined' ? window.NaviPortfolioDataSource : null;
    try {
      if (ds?.readPortfolioPerformanceTimeframe) {
        await ds.readPortfolioPerformanceTimeframe(tf);
      }
      await refresh();
    } catch {
      // On failure the current chart simply stays.
    }
    setActiveTimeframeId(tf);
    setPendingTf(null);
  }

  return (
    <>
      {hasPendingClaims ? (
        <>
          {claimsCard}
          {topFold}
        </>
      ) : (
        <>
          {topFold}
          {claimsCard}
        </>
      )}

      <ClosingSoon positions={model.positions} />
    </>
  );
}
