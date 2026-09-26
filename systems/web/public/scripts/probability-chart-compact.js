/**
 * probability-chart-compact.js — L3 "compact mount".
 *
 * A chrome-light wrapper around the L1 renderer (HzProbabilityChartRenderer)
 * for surfaces that want the real chart engine without L2's range tabs, picker,
 * footer, or polling: the trending hero today; trending cards / portfolio rows /
 * breaking feed later. Doctrine:
 *   systems/design/guide/components/market-detail/probability-chart.md → L3.
 *
 * What it owns:
 *   - palette token resolution (--hz-* custom prop → computed color)
 *   - the binary complement hover row (built here — a closure can't be seeded)
 *   - reveal gating: play the trace + lead-dot entry ONCE, the first time the
 *     chart scrolls into view (IntersectionObserver). Floors to instant paint
 *     on <2 points or prefers-reduced-motion.
 *   - forwarding L1's onHover/onHoverClear so the consumer paints its own
 *     readout (the hero legend column), with hoverLabels suppressed.
 *
 * What it does NOT own: the surrounding card chrome, the legend DOM, the trade
 * button — the consumer wires those via onHover/onHoverClear.
 */
(function () {
  "use strict";

  function resolveColor(token) {
    if (!token) return "";
    var t = String(token).trim();
    if (t.charAt(0) === "#" || t.indexOf("rgb") === 0) return t;
    // "var(--hz-brand)" or "--hz-brand" → read the computed custom property.
    var name = t.replace(/^var\(\s*/, "").replace(/\s*\)$/, "").trim();
    if (name.charAt(0) !== "-") return t; // not a custom property — pass through
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || t;
  }

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  /**
   * @param {SVGElement} svgNode  pre-placed <svg> host (sized by CSS)
   * @param {Object} options
   *   seriesByOutcome  [{ outcomeId, label, shortLabel?, points:[{t,value}], areaFill?, endDotVariant? }]
   *   palette          [token|color, ...]  (resolved here)
   *   complementLabel  string?  binary → adds a "<label> <1-v>%" hover row
   *   dimensions       optional L1 dimensions override
   *   settings         optional L1 settings override
   *   revealRoot       Element?  IntersectionObserver root (the carousel track)
   *   onHover/onHoverClear  forwarded from L1
   * @returns {{ destroy: () => void }}
   */
  function mount(svgNode, options) {
    options = options || {};
    var R = window.HzProbabilityChartRenderer;
    if (!R || !svgNode) return { destroy: function () {} };

    // Data arrives via fetchSeries() — called once, on first in-view — so a
    // lazy slide only hits /history when it's actually seen. The hero seeds
    // slide 0 (fetchSeries returns the SSR-embedded series instantly) and
    // fetches /history for the rest on demand. A static seriesByOutcome still
    // works (wrapped as a resolved promise).
    var getSeries = typeof options.fetchSeries === "function"
      ? options.fetchSeries
      : function () { return Promise.resolve(options.seriesByOutcome || []); };
    var series = [];
    var palette = (options.palette || []).map(resolveColor);
    var settings = options.settings || {
      autoscaleY: true,
      showXAxis: true,
      showYAxis: true,
      horizontalGrid: true,
      verticalGrid: true,
    };
    var hoverExtras = options.complementLabel
      ? [{ label: options.complementLabel, computeValue: function (v) { return 1 - v; } }]
      : null;

    // Render at the host's actual pixel size so the viewBox is 1:1 with the
    // box — fills a stretched cell without the non-uniform scale that would
    // distort axis text (the trap that kept the hero's old chart on an HTML
    // axis column). Caller can still force dimensions via options.dimensions.
    function currentDims() {
      if (options.dimensions) return options.dimensions;
      var r = svgNode.getBoundingClientRect();
      return { width: Math.round(r.width), height: Math.round(r.height) };
    }
    var lastW = 0, lastH = 0;
    var handle = null;
    function draw(reveal) {
      var d = currentDims();
      if (!d || d.width < 40 || d.height < 30) return false; // not laid out yet
      lastW = d.width; lastH = d.height;
      if (handle) handle.destroy();
      handle = R.render(svgNode, {
        seriesByOutcome: series,
        palette: palette,
        settings: settings,
        dimensions: d,
        hoverExtras: hoverExtras || undefined,
        // Default true = L1's floating value pills (market-detail display).
        // A consumer (e.g. a bare sparkline) may pass false to read values out
        // via onHover instead.
        hoverLabels: options.hoverLabels !== false,
        reveal: reveal,
        onHover: options.onHover || undefined,
        onHoverClear: options.onHoverClear || undefined,
      });
      return true;
    }

    var ro = null;
    var drawn = false;
    var loading = false;

    function setupResize() {
      if (ro || typeof ResizeObserver !== "function") return;
      ro = new ResizeObserver(function () {
        if (!drawn) return;
        var r = svgNode.getBoundingClientRect();
        if (Math.abs(r.width - lastW) < 2 && Math.abs(r.height - lastH) < 2) return;
        draw(false); // refit to the new size; the reveal already played
      });
      ro.observe(svgNode);
    }

    function fire() {
      if (drawn || loading) return;
      loading = true;
      // Resolve the series (instant for a seeded slide, a /history fetch for a
      // lazy one), then draw. Reveal only if allowed AND the data can carry it
      // (>=2 points, motion ok) — computed here since lazy slides have no points
      // until the fetch resolves.
      Promise.resolve().then(getSeries).then(function (resolved) {
        series = resolved || [];
        var canReveal =
          options.allowReveal !== false &&
          series.some(function (s) { return (s.points || []).length >= 2; }) &&
          !reducedMotion();
        if (draw(canReveal)) { // only "done" once it actually rendered (laid out)
          drawn = true;
          setupResize();
        }
        loading = false;
      }).catch(function () { loading = false; });
    }

    // Render as soon as mount() is called. The CONSUMER controls timing: the
    // hero mounts slide 0 on load (instant, SSR-seeded) and schedules the rest
    // after first paint, so off-screen slides are ready before they're rotated
    // to — without blocking the page or waiting for a view/click.
    fire();

    return {
      // Live refresh: re-resolve the series (a fresh /history fetch for the
      // consumer's fetchSeries) and redraw WITHOUT replaying the entry reveal —
      // the chart is already on screen, so a re-trace would read as noise. No-op
      // until the first draw has happened, or while a draw is in flight.
      refresh: function () {
        if (!drawn || loading) return;
        loading = true;
        Promise.resolve().then(getSeries).then(function (resolved) {
          if (resolved && resolved.length) series = resolved;
          draw(false);
          loading = false;
        }).catch(function () { loading = false; });
      },
      destroy: function () {
        if (ro) { ro.disconnect(); ro = null; }
        if (handle) { handle.destroy(); handle = null; }
      },
    };
  }

  window.HzProbabilityChartCompact = { mount: mount };
})();
