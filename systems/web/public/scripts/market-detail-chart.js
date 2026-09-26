/**
 * HzMarketDetailChart — Layer 2 full chart card wrapper.
 *
 * Owns all chart chrome: legend, range tabs, line picker, settings menu,
 * footer stats row, refresh polling, persistence (URL ?range + localStorage
 * settings). Delegates pure SVG drawing to HzProbabilityChartRenderer (Layer 1).
 *
 * Usage:
 *   const handle = window.HzMarketDetailChart.mount(hostNode, {
 *     marketKey, palette, fetchHistory, marketMeta,
 *     initialRange, initialSettings, dimensions,
 *     onRangeChange,
 *   });
 *   handle.setMarket(key, meta?);
 *   handle.setPalette(colors);
 *   handle.setMeta(meta);
 *   handle.refresh();
 *   handle.destroy();
 *
 * No ES modules / bundler — exports on window.HzMarketDetailChart.
 * Depends on: window.HzProbabilityChartRenderer (probability-chart-renderer.js)
 */

(function () {
  "use strict";

  // ─── Constants ────────────────────────────────────────────────────────────

  const RANGES = ["1H", "6H", "1D", "1W", "1M", "all"];
  const RANGE_LABELS = {
    "1H": "1H",
    "6H": "6H",
    "1D": "1D",
    "1W": "1W",
    "1M": "1M",
    all: "ALL",
  };
  const TOP_OUTCOMES_CAP = 4;

  // Poll cadence — DEMOTED to a slow reconcile. The market.snapshot SSE (which
  // postdates the 2026-05-26 chart-redesign spec's 10/15/30 cadence) now refreshes
  // the chart instantly on every trade, so the poll only needs to advance the
  // time-axis on quiet markets and recover a dropped SSE. 1W/1M/all stay
  // visibility-regain only. (Supersedes that spec's "Locked decisions" row 7.)
  const REFRESH_INTERVAL_MS = {
    "1H": 60_000,
    "6H": 60_000,
    "1D": 60_000,
  };

  // Empty-state seed: virtual range spans for flat-line generation.
  // Decided presentation (UX cold-start audit, owner decision #6, 2026-07-02):
  // the flat line stays as the zero-trade chart state — not a placeholder
  // awaiting a redesign.
  const SEED_RANGE_MS = {
    "1H": 60 * 60 * 1000,
    "6H": 6 * 60 * 60 * 1000,
    "1D": 24 * 60 * 60 * 1000,
    "1W": 7 * 24 * 60 * 60 * 1000,
    "1M": 30 * 24 * 60 * 60 * 1000,
    all: 90 * 24 * 60 * 60 * 1000,
  };

  // Settings toggle definitions — matches Polymarket's split between axes
  // and gridlines so users can have one without the other.
  const SETTINGS_TOGGLES = [
    { key: "autoscaleY", label: "קנה מידה אוטומטי" },
    { key: "showXAxis", label: "ציר X" },
    { key: "showYAxis", label: "ציר Y" },
    { key: "horizontalGrid", label: "רשת אופקית" },
    { key: "verticalGrid", label: "רשת אנכית" },
  ];

  const DEFAULT_SETTINGS = {
    autoscaleY: true,
    showXAxis: true,
    showYAxis: true,
    horizontalGrid: true,
    verticalGrid: true,
  };

  function chartEscapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function currencyLabelHtml(value) {
    return chartEscapeHtml(value).replace(
      /V[\u200e\u200f]?\u20aa/g,
      window.HZCurrency?.symbolHtml?.() || "V₪",
    );
  }

  // localStorage key for settings persistence.
  const SETTINGS_STORAGE_KEY = "hzChartSettings";

  // ─── Settings persistence ─────────────────────────────────────────────────

  function loadStoredSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function saveSettings(settings) {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Quota or private-mode — swallow; settings just won't persist.
    }
  }

  // ─── Data shaping helpers ─────────────────────────────────────────────────

  function isEmptyHistory(seriesByOutcome) {
    if (!seriesByOutcome || !seriesByOutcome.length) return true;
    return seriesByOutcome.every((s) => !s.points || s.points.length === 0);
  }

  function seedFlatPoints(seriesByOutcome, range) {
    const n = seriesByOutcome.length || 1;
    const initial = 1 / n;
    const rangeMs = SEED_RANGE_MS[range] || SEED_RANGE_MS["1D"];
    const now = Date.now();
    const start = now - rangeMs;
    return seriesByOutcome.map((s) => ({
      ...s,
      points: [
        { t: start / 1000, value: initial },
        { t: now / 1000, value: initial },
      ],
    }));
  }

  function rankByCurrentValue(seriesByOutcome) {
    const withCurrent = seriesByOutcome.map((s) => {
      const last = s.points[s.points.length - 1];
      return { ...s, currentValue: last?.value ?? 0 };
    });
    withCurrent.sort((a, b) => b.currentValue - a.currentValue);
    return withCurrent;
  }

  // A series is "resolved" when its last point is a settlement snap (winner→1 /
  // loser→0, carried flat to the edge). On an event chart the eliminated children
  // sit flat at 0 — we must NOT let them fill default line slots ahead of live
  // children just because there are fewer than 4 live lines.
  function _isResolvedSeries(s) {
    const last = s?.points?.[s.points.length - 1];
    return !!(last && last.kind === "settlement");
  }

  function defaultSelectedIds(seriesByOutcome) {
    const ranked = rankByCurrentValue(seriesByOutcome);
    // Default to the live (unresolved) children only — so a 2-live / 10-resolved
    // event shows exactly the 2 live lines, not padded to 4 with flat-at-0 dead
    // ones. Resolved children stay available via the line picker. When the whole
    // event has settled (no live children) fall back to the full ranking so the
    // winner (100) and top movers still show.
    const live = ranked.filter((s) => !_isResolvedSeries(s));
    const pool = live.length ? live : ranked;
    return new Set(pool.slice(0, TOP_OUTCOMES_CAP).map((s) => s.outcomeId));
  }

  // ─── Market age helper ────────────────────────────────────────────────────

  function computeMarketAgeMs(seriesByOutcome) {
    let firstT = Infinity;
    for (const s of seriesByOutcome || []) {
      for (const p of s.points || []) {
        // points.t is in seconds (backend contract)
        const t = p.t * 1000;
        if (t < firstT) firstT = t;
      }
    }
    if (firstT === Infinity) return 0;
    return Date.now() - firstT;
  }

  // Binary-mode signal — the chart drops to a single canonical-side line +
  // area fill only when the underlying market is binary. This must key off the
  // full raw market series, not the currently selected lines: the line picker
  // filters visibility, it must not change the market's chart mode.
  function _isBinaryMode(allSeries, canonicalOutcomeId, namedOpponents) {
    // Named-opponent binaries (team-vs-team, candidate duels) render as a normal
    // two-line market (a line per side) instead of the single-canonical collapse,
    // so they are NOT treated as "binary mode" here. Yes/no propositions still are.
    return !!canonicalOutcomeId && allSeries.length === 2 && !namedOpponents;
  }

  // A per-outcome kit/entity color (colorPrimary) can be near-black — e.g. a
  // player's #111827 — which dissolves into the dark chart and reads as a MISSING
  // line (a matchup then looks like one line, not two). Reject a color as a line
  // stroke when its brightest channel is too low: saturated reds/blues survive
  // (one channel stays bright), only near-grays/near-blacks are rejected.
  function _lineColorTooDark(hex) {
    const m = String(hex || "").replace("#", "").trim();
    if (m.length < 6) return true;
    const r = parseInt(m.slice(0, 2), 16);
    const g = parseInt(m.slice(2, 4), 16);
    const b = parseInt(m.slice(4, 6), 16);
    if ([r, g, b].some(Number.isNaN)) return true;
    return Math.max(r, g, b) < 110;
  }

  // Trust kit colors for the lines only if EVERY visible outcome has one that's
  // bright enough to read. Otherwise fall back to the bright chart palette for
  // ALL lines, so a matchup always shows distinct, visible lines instead of one
  // good line + one that vanishes (or two muddy near-duplicates).
  function _kitColorsUsable(selectedList, teamColors) {
    return (
      selectedList.length > 0 &&
      selectedList.every(function (s) {
        const c = teamColors[s.outcomeId];
        return c && !_lineColorTooDark(c);
      })
    );
  }

  // ─── Mount ────────────────────────────────────────────────────────────────

  /**
   * Mount the full chart UI into hostNode and return a control handle.
   *
   * @param {HTMLElement} hostNode
   * @param {Object}      options
   * @param {string}      options.marketKey
   * @param {string[]}    options.palette           Array of hex color strings.
   * @param {Function}    options.fetchHistory      async (marketKey, range) => { seriesByOutcome }
   * @param {Object=}     options.marketMeta        { volume, closeDate, statusLabel }
   * @param {string=}     options.initialRange      Defaults to URL ?range, then "1D".
   * @param {Object=}     options.initialSettings   Overrides localStorage defaults.
   * @param {Object=}     options.dimensions        Forwarded to renderer. Defaults: W=600,H=200.
   * @param {Function=}   options.onRangeChange     Optional callback (range) => void.
   *
   * @returns {{ destroy, setMarket, setPalette, setMeta, refresh }}
   */
  function mount(hostNode, options) {
    if (!hostNode) throw new Error("HzMarketDetailChart.mount: hostNode is required");
    if (!options || !options.fetchHistory) throw new Error("HzMarketDetailChart.mount: options.fetchHistory is required");
    // options.initialData ({ range, seriesByOutcome }) — SSR-seeded first
    // paint. When it matches the resolved initial range, the chart renders
    // from it immediately and skips only the boot fetch; range switches and
    // polling still go through fetchHistory.

    // ── Resolve initial range ───────────────────────────────────────────────
    const urlRange = (function () {
      try {
        return new URLSearchParams(window.location.search).get("range") || null;
      } catch {
        return null;
      }
    })();
    const resolvedInitialRange =
      options.initialRange ||
      (urlRange && RANGES.includes(urlRange) ? urlRange : null) ||
      "all";

    // ── Resolve initial settings ────────────────────────────────────────────
    const storedSettings = loadStoredSettings();
    const resolvedSettings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      storedSettings || {},
      options.initialSettings || {}
    );

    // ── Internal state ──────────────────────────────────────────────────────
    // All state is local to this mount() call. No leakage to window globals.
    const state = {
      marketKey: options.marketKey,
      palette: options.palette ? options.palette.slice() : [],
      marketMeta: options.marketMeta || null,
      range: resolvedInitialRange,
      rawByRange: {},
      loading: false,
      error: null,
      selectedOutcomeIds: null,
      colorSlotByOutcomeId: new Map(),
      lineMenuOpen: false,
      settings: Object.assign({}, resolvedSettings),
      settingsMenuOpen: false,
    };

    // SSR seed: pre-populate the initial range so first paint needs no fetch.
    if (
      options.initialData &&
      options.initialData.range === resolvedInitialRange &&
      Array.isArray(options.initialData.seriesByOutcome)
    ) {
      state.rawByRange[resolvedInitialRange] = options.initialData.seriesByOutcome;
    }

    // Tracks outcomes that were selected at the LAST picker render, for
    // animation-on-fresh-select logic. Cleared on market switch.
    let _prevSelectedSnapshot = new Set();

    // The active renderer handle (returned by HzProbabilityChartRenderer.render).
    let _chartHandle = null;

    // Entry animation fires once, on the first paint (its job is covering the
    // rest-of-page hydration). Flipped true after the first reveal render, so
    // polling and range switches never replay it.
    let _hasRevealed = false;

    // The reveal is a 1500ms CSS animation keyed off [data-reveal] (see
    // probability-chart.css). A refresh re-render clears that attribute, so a
    // refresh landing mid-reveal — notably the market SSE's connect snapshot,
    // which fires ~immediately on every page load — snaps the draw to its end
    // frame ("draws really fast"). Track when the reveal ends so refreshes can
    // defer past it. REVEAL_MS must match the CSS animation-duration.
    const REVEAL_MS = 1500;
    let _revealUntil = 0;
    let _revealDeferTimer = null;

    // Polling timer.
    let _refreshTimerId = null;

    // Whether this instance has been destroyed.
    let _destroyed = false;

    // ── Color slot assignment ───────────────────────────────────────────────
    // Once an outcome claims a palette slot it keeps it until deselected.
    // This prevents colors shuffling when a new outcome is added or removed.
    function getOrAssignColorSlot(outcomeId) {
      const slots = state.colorSlotByOutcomeId;
      if (slots.has(outcomeId)) return slots.get(outcomeId);
      const used = new Set(slots.values());
      for (let i = 0; i < TOP_OUTCOMES_CAP; i++) {
        if (!used.has(i)) {
          slots.set(outcomeId, i);
          return i;
        }
      }
      // Cap is enforced upstream; this fallback should be unreachable.
      // Warn loud so a future regression surfaces immediately instead of
      // silently collapsing two outcomes onto the same color.
      // eslint-disable-next-line no-console
      console.warn(
        "[HzMarketDetailChart] color slot overflow — outcomes exceed TOP_OUTCOMES_CAP=" + TOP_OUTCOMES_CAP
      );
      return 0;
    }

    function pickSelectedOutcomes(seriesByOutcome) {
      const ranked = rankByCurrentValue(seriesByOutcome);
      const selectedIds =
        state.selectedOutcomeIds || defaultSelectedIds(seriesByOutcome);
      const pal = state.palette;
      const teamColors = state.marketMeta?.outcomeColors || {};
      const selected = ranked
        .filter((s) => selectedIds.has(s.outcomeId))
        .slice(0, TOP_OUTCOMES_CAP);
      // Identity (kit) colors only when every line has a readable one; else the
      // bright palette for all — so a near-black kit color can't hide a line.
      const kitUsable = _kitColorsUsable(selected, teamColors);
      return selected.map((s) => ({
        ...s,
        color: kitUsable
          ? teamColors[s.outcomeId]
          : pal[getOrAssignColorSlot(s.outcomeId) % Math.max(pal.length, 1)],
      }));
    }

    // ── DOM structure ───────────────────────────────────────────────────────
    // The wrapper builds its own DOM inside hostNode. The host must be
    // empty on mount. We clear it and append the card shell.
    hostNode.innerHTML = "";

    const card = document.createElement("div");
    card.className = "chart-card";

    // Legend
    const legendEl = document.createElement("div");
    legendEl.className = "chart-card__legend";
    card.appendChild(legendEl);

    // SVG wrap + SVG
    const svgWrap = document.createElement("div");
    svgWrap.className = "chart-card__svg-wrap";
    const svgNode = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgNode.setAttribute("class", "chart-card__svg");
    svgNode.setAttribute("viewBox", "0 0 600 200");
    svgNode.setAttribute("preserveAspectRatio", "none");
    svgNode.setAttribute("direction", "ltr");
    svgWrap.appendChild(svgNode);
    card.appendChild(svgWrap);

    // Footer
    const footerEl = document.createElement("div");
    footerEl.className = "chart-card__footer";

    // Controls cluster (settings + line picker + range tabs)
    const controlsEl = document.createElement("div");
    controlsEl.className = "chart-card__controls";

    const settingsHostEl = document.createElement("div");
    settingsHostEl.className = "chart-card__settings";
    controlsEl.appendChild(settingsHostEl);

    const linePickerHostEl = document.createElement("div");
    linePickerHostEl.className = "chart-card__line-picker";
    controlsEl.appendChild(linePickerHostEl);

    const rangeTabsEl = document.createElement("div");
    rangeTabsEl.className = "chart-card__range-tabs";
    controlsEl.appendChild(rangeTabsEl);

    footerEl.appendChild(controlsEl);

    // Stats
    const statsEl = document.createElement("div");
    statsEl.className = "chart-card__stats";
    footerEl.appendChild(statsEl);

    card.appendChild(footerEl);
    hostNode.appendChild(card);

    // ── Range persistence ───────────────────────────────────────────────────
    function writeRangeToUrl(range) {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set("range", range);
        window.history.replaceState(null, "", url);
      } catch {
        // Non-browser or cross-origin — swallow.
      }
    }

    // ── Chart render bridge ─────────────────────────────────────────────────
    function _renderChart(ctx) {
      if (_destroyed) return;
      if (_chartHandle) {
        _chartHandle.destroy();
        _chartHandle = null;
      }
      const rawFromState = state.rawByRange[state.range];
      if (!rawFromState) return;

      const raw = isEmptyHistory(rawFromState)
        ? seedFlatPoints(rawFromState, state.range)
        : rawFromState;

      // Context comes from _rerenderAll when called from there (hoisted to
      // dedupe sort + binary inference). Direct callers (line-picker toggle,
      // settings change) pass no ctx — compute inline.
      const selectedSeries = ctx?.selectedSeries ?? pickSelectedOutcomes(raw);
      if (!selectedSeries.length) return;

      const canonicalOutcomeId =
        ctx?.canonicalOutcomeId ?? (state.marketMeta?.canonicalOutcomeId || null);
      const isBinaryMode =
        ctx?.isBinaryMode ?? _isBinaryMode(raw, canonicalOutcomeId, state.marketMeta?.namedOpponents);

      // The wrapper makes all the market-domain decisions HERE — what's
      // binary, what's resolved, who won — and tags each series with the
      // per-series flags the renderer dispatches on. The renderer never
      // asks "is this the winner?" or "is this binary mode?" — it just
      // draws what each series is tagged to look like.
      let renderSeries = selectedSeries;
      let hoverExtras = null;

      if (isBinaryMode) {
        const canonicalSeries = selectedSeries.find(
          (s) => s.outcomeId === canonicalOutcomeId
        );
        const nonCanonicalSeries = selectedSeries.find(
          (s) => s.outcomeId !== canonicalOutcomeId
        );

        if (canonicalSeries && nonCanonicalSeries) {
          renderSeries = [canonicalSeries];
          // Binary single-line mode: the visible (canonical) series gets an area
          // fill. The hover shows ONLY the canonical (yes) value — the complement
          // ("no" = 1 - canonical) is intentionally NOT added as a hover-extra row
          // (product decision: binary hover reads cleaner with the single side).
          hoverExtras = null;
        }
        // Defensive: canonical-ID mismatch falls through to multi-outcome
        // rendering with no tags — renderer draws plain lines.
      }

      // Per-series tag assignment. End-dot variant:
      //   resolved + winner outcome → "winner"
      //   resolved + other outcome  → "loser"
      //   open binary single-line   → "live" (soft halo on the live tip)
      //   everything else           → "default"
      // areaFill: only the binary single-line case asks for it today.
      const meta = state.marketMeta || {};
      const isResolved = !!meta.isResolved;
      const winnerOutcomeId = meta.winnerOutcomeId || null;
      const isSingleBinaryLine = isBinaryMode && renderSeries.length === 1;
      const taggedSeries = renderSeries.map((s) => {
        let endDotVariant = "default";
        // endDotVariant picks the ✓/✗ glyph on the terminal dot. The terminal
        // point + dashed settlement hop are now real data (backend appends a
        // kind:"settlement" point to resolved series); the renderer keys the
        // dashing + dot placement off that point, so no settlementValue plumbing.
        if (isResolved && winnerOutcomeId) {
          endDotVariant = s.outcomeId === winnerOutcomeId ? "winner" : "loser";
        } else if (isSingleBinaryLine) {
          endDotVariant = "live";
        }
        return {
          ...s,
          endDotVariant,
          areaFill: isSingleBinaryLine,
          // Lead dot rides exactly one line — the canonical. For binary that's
          // the single rendered line; for multi it's the canonical outcome.
          // Null canonical (defensive) → no lead dot, lines still trace.
          leadDot: canonicalOutcomeId != null && s.outcomeId === canonicalOutcomeId,
        };
      });

      const paletteArr = taggedSeries.map((s) => s.color);
      const seriesClean = taggedSeries.map(({ color: _c, ...rest }) => rest);

      // Reveal once, on first paint — unless reduced-motion is requested or the
      // canonical line is too short to draw (a stub trace reads as broken).
      const featured = taggedSeries.find((s) => s.leadDot);
      const reduceMotion =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const shouldReveal =
        !_hasRevealed &&
        !reduceMotion &&
        !!featured &&
        Array.isArray(featured.points) &&
        featured.points.length >= 2;

      _chartHandle = window.HzProbabilityChartRenderer.render(svgNode, {
        seriesByOutcome: seriesClean,
        palette: paletteArr,
        settings: state.settings,
        // dimensions is optional; the renderer falls back to its own defaults
        // (W=600, H=200, pad={top:12,right:72,bottom:22,left:8}).
        dimensions: options.dimensions,
        hoverExtras: hoverExtras || undefined,
        reveal: shouldReveal,
      });

      if (shouldReveal) {
        _hasRevealed = true;
        _revealUntil = Date.now() + REVEAL_MS;
      }
    }

    // ── Legend ──────────────────────────────────────────────────────────────
    function _renderLegend(ctx) {
      legendEl.innerHTML = "";
      const raw = state.rawByRange[state.range];
      if (!raw || !raw.length) return;
      // Same context fallback as _renderChart — see comment there.
      const visible = ctx?.selectedSeries ?? pickSelectedOutcomes(raw);
      const canonicalOutcomeId =
        ctx?.canonicalOutcomeId ?? (state.marketMeta?.canonicalOutcomeId || null);
      const isBinaryMode =
        ctx?.isBinaryMode ?? _isBinaryMode(raw, canonicalOutcomeId, state.marketMeta?.namedOpponents);

      if (isBinaryMode) {
        // Binary mode: NO legend above the chart. The probability hero
        // above already shows the canonical-side value ("11% סיכוי"), the
        // Y-axis labels carry the percentage scale, and the chart's area
        // fill + line carry the shape. A `Yes 11% · No 89%` chip on top
        // is the third surface saying the same thing — drop it.
        // `legendEl:empty` in the wrapper CSS keeps the slot collapsed.
        return;
      }

      // Multi-outcome legend (unchanged).
      for (const s of visible) {
        const item = document.createElement("span");
        item.className = "chart-card__legend-item";

        const dot = document.createElement("span");
        dot.className = "chart-card__legend-dot";
        dot.style.background = s.color;
        item.appendChild(dot);

        const name = document.createElement("span");
        name.className = "chart-card__legend-name";
        name.textContent = s.shortLabel || s.label || "";
        item.appendChild(name);

        const value = document.createElement("span");
        value.className = "chart-card__legend-value";
        value.style.color = s.color;
        const cv = s.currentValue != null ? s.currentValue : (s.points && s.points.length ? s.points[s.points.length - 1].value : 0);
        value.textContent = `${Math.round(cv * 100)}%`;
        item.appendChild(value);

        legendEl.appendChild(item);
      }
    }

    // ── Footer stats ────────────────────────────────────────────────────────
    function _renderStats() {
      if (state.loading) {
        statsEl.innerHTML = `<span class="chart-card__stat" style="color: var(--text-faint)">טוען…</span>`;
        return;
      }
      if (state.error) {
        // Authored copy only — the raw error can carry backend response
        // fragments, so it goes to console for diagnostics, never on screen.
        console.error('[market-detail-chart] chart load failed', state.error);
        const errorStat = document.createElement('span');
        errorStat.className = 'chart-card__stat';
        errorStat.style.color = '#e77a8a';
        errorStat.textContent = 'הגרף לא נטען. נסו לרענן.';
        statsEl.replaceChildren(errorStat);
        return;
      }
      const meta = state.marketMeta || {};
      const volume = meta.volume || null;
      const closeDate = meta.closeDate || null;
      const statusLabel = meta.statusLabel || null;

      // NEW pill — fires when the market itself is fresh (opened within
      // the past 7 days), NOT when the chart's current view window starts
      // recently. Earlier this used `computeMarketAgeMs(series)` which read
      // the first data point in the visible range — so on the 1H range it
      // always showed NEW because the earliest visible point was ~1h ago.
      // Prefer `meta.openedAtMs` (from snapshot.lifecycle.openAt) when the
      // page supplies it; fall back to the data-window heuristic only for
      // stage / no-meta callers. Suppress on resolved markets — "new" is
      // meaningless once the market has decided.
      const NEW_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;
      let marketAgeMs;
      if (Number.isFinite(meta.openedAtMs)) {
        marketAgeMs = Date.now() - meta.openedAtMs;
      } else {
        marketAgeMs = computeMarketAgeMs(state.rawByRange[state.range] || []);
      }
      const isNewMarket =
        !meta.isResolved &&
        marketAgeMs > 0 &&
        marketAgeMs < NEW_THRESHOLD_MS;

      const parts = [];
      if (volume) {
        // Volume label shortened from "נפח מסחר:" to bare "נפח" so it fits
        // alongside the controls cluster on mobile too — no longer needs
        // to drop on small viewports. `__stat--volume` modifier preserved
        // for the hide-when-NEW-pill-present rule.
        parts.push(`<span class="chart-card__stat chart-card__stat--volume">
          <span class="chart-card__stat-label">נפח</span> ${currencyLabelHtml(volume)}
        </span>`);
      }
      if (closeDate) {
        parts.push(`<span class="chart-card__stat chart-card__stat--date">
          <span class="chart-card__stat-label">מסתיים ב-</span>${closeDate}
        </span>`);
      }
      if (isNewMarket) {
        parts.push(`<span class="chart-card__new-pill">חדש</span>`);
      }
      if (statusLabel) {
        parts.push(`<span class="chart-card__status-pill">
          <span class="chart-card__status-pill-dot" aria-hidden="true"></span>${statusLabel}
        </span>`);
      }
      statsEl.innerHTML = parts.join("");
    }

    // ── Range tabs ──────────────────────────────────────────────────────────
    function _renderRangeTabs() {
      rangeTabsEl.innerHTML = "";
      for (const r of RANGES) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className =
          "chart-card__range-tab" +
          (r === state.range ? " chart-card__range-tab--active" : "");
        btn.textContent = RANGE_LABELS[r];
        btn.addEventListener("click", () => _setRange(r));
        rangeTabsEl.appendChild(btn);
      }
    }

    async function _setRange(r) {
      if (_destroyed) return;
      state.range = r;
      writeRangeToUrl(r);
      if (options.onRangeChange) {
        try { options.onRangeChange(r); } catch { /* ignore callback errors */ }
      }
      if (!state.rawByRange[r]) {
        await _loadRange(r);
      }
      _rerenderAll();
      _restartRefreshTimer();
    }

    async function _loadRange(r) {
      if (_destroyed) return;
      // Capture the intended key+range BEFORE awaiting so we can detect a
      // mid-flight market or range switch when the fetch resolves. Without
      // this guard, a slow fetch can land its payload under a different
      // market's bucket (rare but visible — stage switches markets often).
      const keyAtStart = state.marketKey;
      try {
        state.loading = true;
        _renderStats();
        const payload = await options.fetchHistory(keyAtStart, r);
        if (_destroyed || state.marketKey !== keyAtStart) return;
        state.rawByRange[r] = payload?.seriesByOutcome || [];
      } catch (err) {
        if (_destroyed || state.marketKey !== keyAtStart) return;
        state.error = err.message;
      } finally {
        if (state.marketKey === keyAtStart) state.loading = false;
      }
    }

    // Silent refresh — no טוען… flash. Used by polling timer + visibility regain.
    async function _refreshCurrentRange() {
      if (_destroyed) return;
      // Don't let a refresh interrupt the entry reveal: re-rendering clears
      // [data-reveal] and snaps the 1500ms draw to its end frame. Defer one
      // coalesced refresh until just after the reveal finishes, then run it.
      const msLeft = _revealUntil - Date.now();
      if (msLeft > 0) {
        if (_revealDeferTimer === null) {
          _revealDeferTimer = setTimeout(function () {
            _revealDeferTimer = null;
            _refreshCurrentRange();
          }, msLeft + 20);
        }
        return;
      }
      // Same stale-write guard as _loadRange. Polling fires repeatedly while
      // `setMarket` may swap state from under us — if the key or range
      // changed during the await, drop the payload silently.
      const keyAtStart = state.marketKey;
      const rangeAtStart = state.range;
      try {
        const payload = await options.fetchHistory(keyAtStart, rangeAtStart);
        if (_destroyed || state.marketKey !== keyAtStart || state.range !== rangeAtStart) return;
        state.rawByRange[rangeAtStart] = payload?.seriesByOutcome || [];
        _rerenderAll();
      } catch {
        // Swallow transient poll failure — next tick will retry.
      }
    }

    // ── Line picker ─────────────────────────────────────────────────────────
    function _renderLinePicker() {
      linePickerHostEl.innerHTML = "";
      const raw = state.rawByRange[state.range] || [];
      if (raw.length <= TOP_OUTCOMES_CAP) return;

      const ranked = rankByCurrentValue(raw);
      const selectedIds = state.selectedOutcomeIds || defaultSelectedIds(raw);
      const pal = state.palette;
      const teamColors = state.marketMeta?.outcomeColors || {};
      // Match the line-color rule (pickSelectedOutcomes) so the picker dots agree
      // with the lines: kit colors only if all are readable, else palette.
      const kitUsable = _kitColorsUsable(
        ranked.filter((s) => selectedIds.has(s.outcomeId)),
        teamColors
      );
      const colorByOutcomeId = new Map();
      for (const s of ranked) {
        if (!selectedIds.has(s.outcomeId)) continue;
        colorByOutcomeId.set(
          s.outcomeId,
          kitUsable
            ? teamColors[s.outcomeId]
            : pal[getOrAssignColorSlot(s.outcomeId) % Math.max(pal.length, 1)]
        );
      }

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chart-card__line-picker-button";
      btn.setAttribute("aria-expanded", state.lineMenuOpen ? "true" : "false");
      // `__line-picker-text` is split so mobile CSS can drop the word
       // "קווים" and keep just the count, saving ~30px in the controls cluster.
      btn.innerHTML = `<span class="chart-card__line-picker-glyph" aria-hidden="true"></span><span><span class="chart-card__line-picker-text">קווים · </span>${selectedIds.size}/${raw.length}</span>`;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        state.lineMenuOpen = !state.lineMenuOpen;
        _renderLinePicker();
      });
      linePickerHostEl.appendChild(btn);

      if (!state.lineMenuOpen) return;

      const menu = document.createElement("div");
      menu.className = "chart-card__line-menu";
      menu.addEventListener("click", (e) => e.stopPropagation());

      const title = document.createElement("span");
      title.className = "chart-card__line-menu-title";
      title.textContent = "עד 4 תוצאות בגרף";
      menu.appendChild(title);

      const optsToActivate = [];
      for (const s of ranked) {
        const isSelected = selectedIds.has(s.outcomeId);
        const isDisabled = !isSelected && selectedIds.size >= TOP_OUTCOMES_CAP;
        const isFloor = isSelected && selectedIds.size <= 1;
        const wasSelected = _prevSelectedSnapshot.has(s.outcomeId);

        const opt = document.createElement("button");
        opt.type = "button";
        opt.className = "chart-card__line-option";
        if (isDisabled || isFloor) opt.disabled = true;

        if (isSelected) {
          const lineColor = colorByOutcomeId.get(s.outcomeId);
          if (lineColor) opt.style.setProperty("--chart-line-color", lineColor);
          if (wasSelected) {
            opt.classList.add("chart-card__line-option--active");
          } else {
            optsToActivate.push(opt);
          }
        }

        const last = s.points[s.points.length - 1];
        const valuePct = Math.round((last?.value ?? 0) * 100);
        opt.innerHTML = `
          <span class="chart-card__line-check" aria-hidden="true"></span>
          <span class="chart-card__line-label">${s.shortLabel || s.label}</span>
          <span class="chart-card__line-value">${valuePct}%</span>
        `;
        opt.addEventListener("click", (e) => {
          e.stopPropagation();
          _toggleOutcome(s.outcomeId);
        });
        menu.appendChild(opt);
      }

      linePickerHostEl.appendChild(menu);

      if (optsToActivate.length) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            for (const o of optsToActivate) {
              o.classList.add("chart-card__line-option--active");
            }
          });
        });
      }

      _prevSelectedSnapshot = new Set(selectedIds);
    }

    function _toggleOutcome(outcomeId) {
      const raw = state.rawByRange[state.range] || [];
      const current = state.selectedOutcomeIds || defaultSelectedIds(raw);
      const next = new Set(current);
      if (next.has(outcomeId)) {
        if (next.size <= 1) return; // floor rule
        next.delete(outcomeId);
        state.colorSlotByOutcomeId.delete(outcomeId);
      } else {
        if (next.size >= TOP_OUTCOMES_CAP) return; // cap rule
        next.add(outcomeId);
      }
      state.selectedOutcomeIds = next;
      _renderLinePicker();
      _renderLegend();
      _renderChart();
    }

    // ── Settings menu ────────────────────────────────────────────────────────
    function _renderSettings() {
      settingsHostEl.innerHTML = "";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chart-card__settings-button";
      btn.setAttribute("aria-expanded", state.settingsMenuOpen ? "true" : "false");
      btn.setAttribute("aria-label", "הגדרות גרף");
      btn.title = "הגדרות גרף";
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>
      `;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        state.settingsMenuOpen = !state.settingsMenuOpen;
        _renderSettings();
      });
      settingsHostEl.appendChild(btn);

      if (!state.settingsMenuOpen) return;

      const menu = document.createElement("div");
      menu.className = "chart-card__settings-menu";
      menu.addEventListener("click", (e) => e.stopPropagation());

      const menuTitle = document.createElement("span");
      menuTitle.className = "chart-card__settings-menu-title";
      menuTitle.textContent = "הגדרות גרף";
      menu.appendChild(menuTitle);

      for (const toggle of SETTINGS_TOGGLES) {
        const row = document.createElement("label");
        row.className = "chart-card__settings-option";
        const labelSpan = document.createElement("span");
        labelSpan.textContent = toggle.label;
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = !!state.settings[toggle.key];
        input.addEventListener("change", () => {
          state.settings[toggle.key] = input.checked;
          saveSettings(state.settings);
          _renderChart();
        });
        row.appendChild(labelSpan);
        row.appendChild(input);
        menu.appendChild(row);
      }

      settingsHostEl.appendChild(menu);
    }

    // ── Outside-click dismiss ────────────────────────────────────────────────
    function _onDocumentClick() {
      let changed = false;
      if (state.lineMenuOpen) {
        state.lineMenuOpen = false;
        _renderLinePicker();
        changed = true;
      }
      if (state.settingsMenuOpen) {
        state.settingsMenuOpen = false;
        _renderSettings();
        changed = true;
      }
      return changed;
    }
    document.addEventListener("click", _onDocumentClick);

    // ── Visibility guard ─────────────────────────────────────────────────────
    function _onVisibilityChange() {
      if (_destroyed) return;
      if (document.visibilityState === "visible") {
        _refreshCurrentRange();
        _restartRefreshTimer();
      } else {
        _clearRefreshTimer();
      }
    }
    document.addEventListener("visibilitychange", _onVisibilityChange);

    // ── Polling ──────────────────────────────────────────────────────────────
    function _clearRefreshTimer() {
      if (_refreshTimerId !== null) {
        clearInterval(_refreshTimerId);
        _refreshTimerId = null;
      }
    }

    function _restartRefreshTimer() {
      _clearRefreshTimer();
      if (_destroyed) return;
      if (document.visibilityState !== "visible") return;
      const interval = REFRESH_INTERVAL_MS[state.range];
      if (!interval) return; // 1W/1M/all — no interval polling
      _refreshTimerId = setInterval(_refreshCurrentRange, interval);
    }

    // ── Full rerender ────────────────────────────────────────────────────────
    function _rerenderAll() {
      if (_destroyed) return;
      // Compute the shared per-render context once so _renderChart and
      // _renderLegend don't independently call pickSelectedOutcomes (which
      // internally sorts via rankByCurrentValue) and _isBinaryMode.
      // For ranges with no data yet, selectedSeries is empty and downstream
      // functions short-circuit on their own raw-data guards.
      const raw = state.rawByRange[state.range] || [];
      const selectedSeries = raw.length ? pickSelectedOutcomes(raw) : [];
      const canonicalOutcomeId = state.marketMeta?.canonicalOutcomeId || null;
      const isBinaryMode = _isBinaryMode(raw, canonicalOutcomeId, state.marketMeta?.namedOpponents);
      const ctx = { selectedSeries, canonicalOutcomeId, isBinaryMode };
      _renderRangeTabs();
      _renderChart(ctx);
      _renderLegend(ctx);
      _renderLinePicker();
      _renderSettings();
      _renderStats();
    }

    // ── Boot ─────────────────────────────────────────────────────────────────
    (async function _boot() {
      // SSR-seeded data renders immediately; only fetch when the slot is empty.
      if (!state.rawByRange[state.range]) {
        await _loadRange(state.range);
      }
      _rerenderAll();
      _restartRefreshTimer();
    })();

    // ── Public handle ────────────────────────────────────────────────────────

    /**
     * Remove all DOM content, cancel polling, detach listeners.
     * Idempotent — safe to call multiple times.
     */
    function destroy() {
      if (_destroyed) return;
      _destroyed = true;
      _clearRefreshTimer();
      if (_revealDeferTimer !== null) {
        clearTimeout(_revealDeferTimer);
        _revealDeferTimer = null;
      }
      document.removeEventListener("click", _onDocumentClick);
      document.removeEventListener("visibilitychange", _onVisibilityChange);
      if (_chartHandle) {
        _chartHandle.destroy();
        _chartHandle = null;
      }
      hostNode.innerHTML = "";
    }

    /**
     * Switch to a different market. Resets selection, color slots, range cache.
     * Optional meta updates the footer immediately.
     */
    async function setMarket(key, meta) {
      if (_destroyed) return;
      if (key === state.marketKey && !meta) return;
      state.marketKey = key;
      state.rawByRange = {};
      state.error = null;
      state.selectedOutcomeIds = null;
      state.colorSlotByOutcomeId.clear();
      _prevSelectedSnapshot = new Set();
      state.lineMenuOpen = false;
      if (meta !== undefined) state.marketMeta = meta || null;
      _clearRefreshTimer();
      // Remember the intended key so we don't render this market's data
      // if `setMarket` was called again during _loadRange's await.
      const intendedKey = key;
      await _loadRange(state.range);
      if (_destroyed || state.marketKey !== intendedKey) return;
      _rerenderAll();
      _restartRefreshTimer();
    }

    /**
     * Re-color all lines with a new palette array. No refetch.
     */
    function setPalette(colors) {
      if (_destroyed) return;
      state.palette = colors ? colors.slice() : [];
      _rerenderAll();
    }

    /**
     * Update footer chrome metadata without redrawing the chart.
     */
    function setMeta(meta) {
      if (_destroyed) return;
      state.marketMeta = meta || null;
      _renderStats();
    }

    /**
     * Force a poll right now (identical to the interval tick).
     */
    async function refresh() {
      if (_destroyed) return;
      await _refreshCurrentRange();
    }

    return { destroy, setMarket, setPalette, setMeta, refresh };
  }

  // ── Export ──────────────────────────────────────────────────────────────────
  window.HzMarketDetailChart = { mount };

})();
