/**
 * HzPnlSparklineRenderer — SVG renderer for the portfolio P&L sparkline.
 *
 * Doctrine: practice_chart_creation.md.
 *
 * Owned by the portfolio PnL card. Sole consumer is
 * `assets/js/pages/portfolio/change-card.js · mount()`.
 *
 * Constraints:
 *   - ZERO chrome (no legend, no axis labels, no settings UI). The
 *     surrounding card owns the eyebrow, sub-eyebrow, hero number,
 *     and timeframe pills.
 *   - ZERO data fetching. Caller passes already-resolved series.
 *   - ZERO knowledge of global state, ranges, or persistence.
 *   - Smooth cubic-bezier interpolation. Deviates from the platform
 *     chart doctrine (step interpolation) — PnL reads as a continuous
 *     "where is the portfolio sitting" line, not a series of discrete
 *     trade ticks. Flat regions stay flat (consecutive same-value
 *     samples produce a flat bezier); transitions ease through. See
 *     surface contract §2 PnL Card for the documented deviation.
 *   - `getCTM().inverse()` for pointer→SVG coords (handles scaled SVGs).
 *   - No ES modules / bundler. Exported as window.HzPnlSparklineRenderer.
 *
 * Hover model: a single crosshair + cursor dot at the nearest data
 * point. No past/future opacity split (the line stays uniform). The
 * caller-supplied onHover/onLeave callbacks fire with the hovered
 * point so the card can swap its hero + sub-eyebrow text externally.
 */

(function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  function el(tag, attrs, text) {
    attrs = attrs || {};
    const node = document.createElementNS(SVG_NS, tag);
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v == null) continue;
      node.setAttribute(k, v);
    }
    if (text != null) node.textContent = text;
    return node;
  }

  // Cubic-bezier path through projected points. Control points are
  // pulled toward the same y as the segment endpoints (40%/60% along
  // x), so equal-y neighbors render strictly flat and unequal-y
  // neighbors ease in/out through the transition without overshoot.
  // render() already early-returns on <2 points, so the single-point
  // case never reaches here.
  function smoothPath(points) {
    const segments = ["M " + points[0].x + " " + points[0].y];
    for (let i = 1; i < points.length; i++) {
      const p0 = points[i - 1];
      const p1 = points[i];
      const dx = p1.x - p0.x;
      const cx1 = p0.x + dx * 0.4;
      const cx2 = p0.x + dx * 0.6;
      segments.push(
        "C " + cx1.toFixed(2) + "," + p0.y.toFixed(2) +
        " " + cx2.toFixed(2) + "," + p1.y.toFixed(2) +
        " " + p1.x.toFixed(2) + "," + p1.y.toFixed(2)
      );
    }
    return segments.join(" ");
  }

  // Close a smooth path into a filled area down to the baseline at
  // the bottom of the chart. The area fill carries the gradient fade
  // (top: high opacity, bottom: 0) defined inline in render()'s SVG
  // defs. render() already gates on <2 points, so the empty-input
  // case never reaches here.
  function smoothAreaPath(points, baselineY) {
    const line = smoothPath(points);
    const lastX = points[points.length - 1].x;
    const firstX = points[0].x;
    return line + " L " + lastX + " " + baselineY + " L " + firstX + " " + baselineY + " Z";
  }

  // Uniform-stride decimation. Reduces a dense series to ~target
  // points by sampling every Nth index. First and last points are
  // always preserved so the visible endpoints anchor correctly.
  //
  // Why we decimate: backend's mark-to-market series can return
  // 1000+ points (every candle bucket in the window). At sparkline
  // scale that reads as visual noise; Polymarket caps at ~50-130
  // per range. Decimating at the renderer keeps the L1 reusable
  // and lets the wrapper tune density per surface.
  function decimatePoints(points, target) {
    if (!Array.isArray(points) || points.length <= target) return points;
    if (target < 2) return points;
    const stride = (points.length - 1) / (target - 1);
    const out = [];
    for (let i = 0; i < target; i++) {
      const idx = i === target - 1 ? points.length - 1 : Math.round(i * stride);
      out.push(points[idx]);
    }
    return out;
  }

  // Target point count for the portfolio sparkline. Matches the
  // density Polymarket renders (~50-130 per range). At sparkline
  // dimensions (~460×72px) this is the visual sweet spot: enough
  // shape to read inflections, not so much it becomes noise.
  const DEFAULT_TARGET_POINTS = 80;

  // Project a timestamp onto the x-axis, rounded to whole viewBox
  // units. Whole-pixel x kills the sub-pixel alternation that showed
  // up under uniform-time sampling (consecutive gaps of 20.47 / 18.89
  // pixels under float projection, because uniform time slices
  // unevenly across a non-integer pixel width). At 460-unit viewBox
  // the rounding is invisible; what you keep is a clean cadence.
  function plotX(t, tMin, tMax, W, PAD) {
    if (tMax <= tMin) return PAD.left;
    const usable = W - PAD.left - PAD.right;
    return Math.round(PAD.left + (usable * (t - tMin)) / (tMax - tMin));
  }

  function plotY(v, lo, hi, H, PAD) {
    if (hi <= lo) return PAD.top;
    const usable = H - PAD.top - PAD.bottom;
    return PAD.top + usable * (1 - (v - lo) / (hi - lo));
  }

  // Outlier-resistant bounds per the chart doctrine. ≥50 points →
  // 2nd/98th percentile so a single seed spike doesn't pull the
  // domain across the whole range. Below 50 → literal min/max
  // (sparse data is its own story).
  // The renderer plots each timeframe's WINDOW-ANCHORED value (its
  // series relative to its own start), not absolute account-level P&L.
  // view-model.js precomputes displayValue = value - firstSeriesValue;
  // we fall back to the raw value for any caller that doesn't anchor.
  // Autoscale is translation-invariant, so anchoring leaves the line
  // SHAPE identical — what it buys is a true zero reference at the
  // window start, so day/week/month show the "you started here"
  // baseline (the way Polymarket does per range) instead of floating
  // on a deep account-level floor that never crosses zero.
  function plotValueOf(p) {
    return Number.isFinite(p.displayValue) ? p.displayValue : p.value;
  }

  function _outlierResistantBounds(points) {
    const values = points.map(plotValueOf);
    if (!values.length) return null;
    if (values.length < 50) {
      let lo = Infinity, hi = -Infinity;
      for (const v of values) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      return { lo: lo, hi: hi };
    }
    values.sort(function (a, b) { return a - b; });
    const idxLo = Math.floor(0.02 * (values.length - 1));
    const idxHi = Math.ceil(0.98 * (values.length - 1));
    return { lo: values[idxLo], hi: values[idxHi] };
  }

  // P&L domain: autoscale to the visible (window-anchored) values.
  // Because plotY normalizes by (v-lo)/(hi-lo), anchoring shifts lo/hi
  // together and never flattens the line — it only relocates the zero
  // baseline to each timeframe's start.
  function computeYDomain(points) {
    const bounds = _outlierResistantBounds(points);
    if (!bounds) return { lo: -1, hi: 1, baselineVisible: false };
    let lo = bounds.lo;
    let hi = bounds.hi;
    if (!isFinite(lo) || !isFinite(hi)) return { lo: -1, hi: 1, baselineVisible: false };

    const crossesZero = lo < 0 && hi > 0;

    let pad = Math.max((hi - lo) * 0.12, Math.abs(hi - lo) * 0.05);
    // When the data is all-zero (no PnL movement), give the chart a
    // narrow symmetric band around zero so the line is centered.
    if (pad === 0) pad = 1;

    return {
      lo: lo - pad,
      hi: hi + pad,
      baselineVisible: crossesZero,
    };
  }

  const DEFAULT_DIMENSIONS = {
    width: 460,
    height: 72,
    pad: { top: 6, right: 4, bottom: 6, left: 4 },
  };

  /**
   * render(svgNode, options) — mount the sparkline into the given SVG.
   *
   * options.points: [{ t: ms, value: signedV }, ...]
   * options.targetPoints?: number — decimate to this many. Defaults to DEFAULT_TARGET_POINTS.
   * options.formatters?: { formatValue(v) → string, formatTime(date) → string }
   * options.onHover?: ({ point: {t, value}, formatted: {value, time} }) → void
   * options.onLeave?: () → void
   *
   * Returns { applyHover(clientX), clearHover(), destroy() }.
   */
  function render(svgNode, options) {
    const rawInput = (options.points || [])
      .slice()
      .filter(function (p) {
        return Number.isFinite(p.t) && Number.isFinite(p.value);
      })
      .sort(function (a, b) { return a.t - b.t; });
    const formatters = options.formatters || {};
    const onHover = typeof options.onHover === "function" ? options.onHover : null;
    const onLeave = typeof options.onLeave === "function" ? options.onLeave : null;
    const targetPoints = options.targetPoints || DEFAULT_TARGET_POINTS;

    // Decimate the input before projection. Y autoscale still runs
    // on the FULL series (so outlier bounds are correct), but the
    // visible path uses the decimated points. Polymarket-equivalent
    // density.
    const points = decimatePoints(rawInput, targetPoints);

    const { width: W, height: H, pad: PAD } = DEFAULT_DIMENSIONS;

    svgNode.innerHTML = "";
    svgNode.setAttribute("viewBox", "0 0 " + W + " " + H);
    svgNode.setAttribute("preserveAspectRatio", "none");

    if (points.length < 2 || rawInput.length < 2) {
      // Defensive — view-model already gates on chartHasData, but
      // double-checking here lets the renderer be safely callable
      // from any future consumer.
      return {
        applyHover: function () {},
        clearHover: function () {},
        destroy: function () { svgNode.innerHTML = ""; },
      };
    }

    // Domains. Run autoscale on the FULL raw series so outlier
    // bounds reflect the real data, not just the visible decimated
    // points (decimation could otherwise drop a peak the autoscale
    // should account for).
    const yDomain = computeYDomain(rawInput);
    const tMin = rawInput[0].t;
    const tMax = rawInput[rawInput.length - 1].t;
    const baselineY = yDomain.lo <= 0 && yDomain.hi >= 0
      ? plotY(0, yDomain.lo, yDomain.hi, H, PAD)
      : H - PAD.bottom;

    // Project into pixel space. plotX rounds; plotY stays fractional
    // (autoscale pad is small, integer-rounding y would visibly notch
    // the curve at narrow viewBox heights).
    const projected = points.map(function (p) {
      return {
        t: p.t,
        value: p.value,
        displayValue: Number.isFinite(p.displayValue) ? p.displayValue : p.value,
        x: plotX(p.t, tMin, tMax, W, PAD),
        y: plotY(plotValueOf(p), yDomain.lo, yDomain.hi, H, PAD),
      };
    });

    // Zero baseline — dashed hairline at y=0 when the series crosses zero.
    // Pure visual reference; helps the eye separate gains from losses.
    if (yDomain.baselineVisible) {
      const zero = el("line", {
        class: "hz-pnl-spark__zero-line",
        x1: PAD.left,
        x2: W - PAD.right,
        y1: baselineY,
        y2: baselineY,
      });
      svgNode.appendChild(zero);
    }

    // SVG defs — vertical gradient for the area fill. objectBoundingBox
    // units key the opacity to the fill shape's own box, so 0.40 sits at
    // the curve's global peak and fades toward the baseline. A small floor
    // (0.05, not 0) keeps a visible wash under low/undulating curves —
    // without it, ranges like 1D (curve hugs the lower band) show no fill
    // because all their area lands in the faded zone. The gradient id has
    // a random suffix because
    // the PnL card is rebuilt on every chip click and re-mount: a
    // stale gradient from a previous render can otherwise still be
    // resolved by `url(#…)` lookup for a frame during teardown.
    const defs = el("defs");
    const fillGradId = "hz-pnl-spark-fill-" + Math.random().toString(36).slice(2, 8);
    const fillGrad = el("linearGradient", {
      id: fillGradId,
      x1: "0",
      y1: "0",
      x2: "0",
      y2: "1",
    });
    fillGrad.appendChild(el("stop", { offset: "0%", "stop-color": "currentColor", "stop-opacity": "0.40" }));
    fillGrad.appendChild(el("stop", { offset: "100%", "stop-color": "currentColor", "stop-opacity": "0.05" }));
    defs.appendChild(fillGrad);
    svgNode.appendChild(defs);

    // Entry "pen-draw" reveal: the line traces via stroke-dashoffset (CSS, keyed
    // off [data-reveal]); the area fill is clipped to the line's drawn point each
    // frame via rAF (see below). The line draws by ARC LENGTH (dashoffset over
    // pathLength=1), but a CSS clip wipe is linear in X — on a smooth curve the
    // two diverge (a steep segment spends arc-length without advancing much in X,
    // so the fill outran the stroke: "some of it is slower"). Same fix as the
    // market-detail chart: read the line's drawn X via getPointAtLength and clip
    // the fill to it, so the fill edge tracks the stroke's leading edge exactly.
    // Off for reduced-motion (chart paints fully, no animation).
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const reveal = !!options.reveal && !reduceMotion;
    if (reveal) {
      svgNode.setAttribute("data-reveal", "1");
    } else {
      svgNode.removeAttribute("data-reveal");
    }

    // On reveal, clip the fill to a rect whose width the rAF drives to the line's
    // drawn X. userSpaceOnUse (default) keeps the rect in viewBox units, so it
    // clips correctly under the SVG's preserveAspectRatio="none" stretch — more
    // robust than a percentage CSS inset.
    //
    // Init width = full (W), not 0: the original card used CSS specifically
    // because a JS rAF "gets orphaned mid-draw" on Preact re-mount. So we make
    // the orphan failure mode safe — if this mount is torn down before the rAF
    // runs, the rect stays full and the fill shows COMPLETE (a missing reveal),
    // never stuck invisible. rAF runs before the first paint after this append,
    // so it sets the small starting width before anything renders (no full-fill
    // flash); only a true orphan leaves it full.
    var revealClipRect = null;
    var revealClipId = "hz-pnl-area-reveal-" + fillGradId.slice(-6);
    if (reveal) {
      var clip = el("clipPath", { id: revealClipId });
      revealClipRect = el("rect", { x: 0, y: 0, width: W, height: H });
      clip.appendChild(revealClipRect);
      defs.appendChild(clip);
    }

    // Area fill below the line — gradient fade. currentColor inherits
    // from the SVG's CSS color (.hz-pnl-spark { color: --hz-brand }).
    var fillAttrs = {
      class: "hz-pnl-spark__fill",
      d: smoothAreaPath(projected, H - PAD.bottom),
      fill: "url(#" + fillGradId + ")",
    };
    if (revealClipRect) fillAttrs["clip-path"] = "url(#" + revealClipId + ")";
    const fillPath = el("path", fillAttrs);
    svgNode.appendChild(fillPath);

    // The line itself — smooth cubic curve, solid stroke color.
    // pathLength=1 (reveal only) normalizes the CSS draw to a [0,1] tween.
    const linePath = el("path", {
      class: "hz-pnl-spark__line",
      d: smoothPath(projected),
      fill: "none",
      pathLength: reveal ? 1 : null,
    });
    svgNode.appendChild(linePath);

    // rAF fill-sync: each frame, clip the fill to the X of the line's drawn point
    // at fraction t. t runs over the same 1100ms linear clock as hz-pnl-spark-draw
    // (pnl-sparkline.css), and getPointAtLength maps arc-fraction → point — the
    // piece CSS can't express. Bails if the SVG re-rendered mid-draw (Preact
    // re-mount detaches the path), so no orphaned loop touches a dead node.
    if (reveal && revealClipRect && typeof requestAnimationFrame === "function") {
      var REVEAL_MS = 1100; // matches hz-pnl-spark-draw
      var totalLen = 0;
      try { totalLen = linePath.getTotalLength(); } catch (e) { totalLen = 0; }
      var startTs = null;
      var tick = function (now) {
        if (startTs === null) startTs = now;
        if (!linePath.isConnected) return; // re-rendered/destroyed — leaves rect full
        var t = Math.min(1, (now - startTs) / REVEAL_MS);
        if (t >= 1) {
          // Snap to full so no rounding leaves a sliver of fill clipped.
          revealClipRect.setAttribute("width", String(W));
          return;
        }
        var x;
        try { x = linePath.getPointAtLength(totalLen * t).x; } catch (e) { return; }
        revealClipRect.setAttribute("width", String(x));
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }

    // Hover layer — single vertical crosshair + a dot snapped to the
    // nearest data point. Hidden by default; the visibility flips
    // when applyHover() finds a valid point.
    const crosshair = el("line", {
      class: "hz-pnl-spark__crosshair",
      x1: 0,
      x2: 0,
      y1: PAD.top,
      y2: H - PAD.bottom,
      visibility: "hidden",
    });
    svgNode.appendChild(crosshair);

    const cursorDot = el("circle", {
      class: "hz-pnl-spark__cursor-dot",
      cx: 0,
      cy: 0,
      r: 4,
      visibility: "hidden",
    });
    svgNode.appendChild(cursorDot);

    // Invisible capture rect over the full chart area. SVG only
    // catches mouse events where a child path actually paints —
    // empty regions are transparent to events by default. On Day
    // the fill-gradient covers ~the whole chart (line near the top)
    // so hover "just worked", but on Week/Month/All the curve sits
    // in the middle of the band and the area ABOVE the line had no
    // events. This rect makes the entire SVG box a single hit
    // target so the crosshair tracks anywhere the user mouses, not
    // just below the curve. Appended last so it sits on top in the
    // DOM but is visually invisible (fill=transparent, no stroke).
    const captureRect = el("rect", {
      class: "hz-pnl-spark__capture",
      x: 0,
      y: 0,
      width: W,
      height: H,
      fill: "transparent",
    });
    svgNode.appendChild(captureRect);

    // ── Hover behavior ───────────────────────────────────────────
    function applyHoverSvgX(svgX) {
      if (svgX < PAD.left || svgX > W - PAD.right) {
        hideHover();
        return;
      }
      // Nearest data point by x. The dot snaps to an actual sample;
      // we don't interpolate fake intermediate positions.
      let nearest = projected[0];
      let bestDist = Math.abs(projected[0].x - svgX);
      for (let i = 1; i < projected.length; i++) {
        const d = Math.abs(projected[i].x - svgX);
        if (d < bestDist) {
          bestDist = d;
          nearest = projected[i];
        }
      }
      crosshair.setAttribute("x1", nearest.x);
      crosshair.setAttribute("x2", nearest.x);
      crosshair.setAttribute("visibility", "visible");
      cursorDot.setAttribute("cx", nearest.x);
      cursorDot.setAttribute("cy", nearest.y);
      cursorDot.setAttribute("visibility", "visible");

      if (onHover) {
        const valueLabel = formatters.formatValue
          ? formatters.formatValue(nearest.displayValue)
          : String(nearest.displayValue);
        const timeLabel = formatters.formatTime
          ? formatters.formatTime(new Date(nearest.t))
          : new Date(nearest.t).toISOString();
        onHover({
          point: { t: nearest.t, value: nearest.displayValue, chartValue: nearest.value },
          formatted: { value: valueLabel, time: timeLabel },
        });
      }
    }

    function hideHover() {
      crosshair.setAttribute("visibility", "hidden");
      cursorDot.setAttribute("visibility", "hidden");
      if (onLeave) onLeave();
    }

    // `getCTM().inverse()` translates client (screen) X into the
    // SVG's internal coordinate space — handles arbitrary SVG scaling
    // (we use preserveAspectRatio="none" so the SVG stretches to fill
    // the host, and raw getBoundingClientRect math drifts).
    function applyHover(clientX) {
      const ctm = svgNode.getScreenCTM();
      if (!ctm) return;
      const pt = svgNode.createSVGPoint();
      pt.x = clientX;
      pt.y = 0;
      const inSvg = pt.matrixTransform(ctm.inverse());
      applyHoverSvgX(inSvg.x);
    }

    function onMouseMove(e) { applyHover(e.clientX); }
    function onMouseLeave() { hideHover(); }
    function onTouchStart(e) {
      e.preventDefault();
      const t = e.touches[0];
      if (t) applyHover(t.clientX);
    }
    function onTouchMove(e) {
      e.preventDefault();
      const t = e.touches[0];
      if (t) applyHover(t.clientX);
    }
    function onTouchEnd() { hideHover(); }

    svgNode.addEventListener("mousemove", onMouseMove);
    svgNode.addEventListener("mouseleave", onMouseLeave);
    svgNode.addEventListener("touchstart", onTouchStart, { passive: false });
    svgNode.addEventListener("touchmove", onTouchMove, { passive: false });
    svgNode.addEventListener("touchend", onTouchEnd);
    svgNode.addEventListener("touchcancel", onTouchEnd);

    return {
      applyHover: applyHover,
      clearHover: hideHover,
      destroy: function () {
        svgNode.removeEventListener("mousemove", onMouseMove);
        svgNode.removeEventListener("mouseleave", onMouseLeave);
        svgNode.removeEventListener("touchstart", onTouchStart, { passive: false });
        svgNode.removeEventListener("touchmove", onTouchMove, { passive: false });
        svgNode.removeEventListener("touchend", onTouchEnd);
        svgNode.removeEventListener("touchcancel", onTouchEnd);
        svgNode.innerHTML = "";
      },
    };
  }

  window.HzPnlSparklineRenderer = { render: render };
})();
