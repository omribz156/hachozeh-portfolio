/**
 * HzProbabilityChartRenderer — Layer 1 pure SVG renderer.
 *
 * Takes a host SVG node + options → mounts the probability chart into that SVG.
 * Returns a handle for hover control and cleanup.
 *
 * Constraints (by spec):
 *   - ZERO chrome: no buttons, labels above/below, legend, footer, picker, settings UI.
 *   - ZERO data fetching: caller passes already-resolved series.
 *   - ZERO knowledge of global `state`, ranges, palette-by-name, line selection,
 *     or settings storage. Caller passes resolved values.
 *   - No ES modules / bundler. Exported as window.HzProbabilityChartRenderer.
 */

(function () {
  "use strict";

  // ─── SVG helpers ──────────────────────────────────────────────────────────
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

  // ─── Step path builder ────────────────────────────────────────────────────
  // Single interpolation mode: step (smooth-through-points was evaluated and
  // rejected — it fabricates motion between samples; see
  // spec 2026-05-26-market-detail-chart-redesign.md). Corners are ROUNDED
  // (Kalshi-style, verified 2026-06-15): the price still holds flat then jumps,
  // but the right-angle is softened with a small quadratic fillet. The radius is
  // clamped to a fraction of the shorter adjacent segment so every tread/riser
  // keeps a straight middle — it never rounds so hard it reads as a curve that
  // implies movement that didn't happen. Polymarket's smoothing stays rejected.
  const CORNER_RADIUS = 3.5; // viewBox units (~4-5px at typical render scale)

  function num(n) {
    return Math.round(n * 100) / 100;
  }

  function stepPath(points) {
    if (!points.length) return "";
    if (points.length === 1) return "M " + num(points[0].x) + " " + num(points[0].y);

    // Sharp staircase vertices: start, then a tread-end + riser-end per point.
    // Skip zero-length segments (flat spans, coincident x) so collinear runs
    // don't spawn phantom corners.
    const v = [{ x: points[0].x, y: points[0].y }];
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1], cur = points[i];
      if (cur.x !== prev.x) v.push({ x: cur.x, y: prev.y }); // horizontal tread
      if (cur.y !== prev.y) v.push({ x: cur.x, y: cur.y });  // vertical riser
    }
    if (v.length === 1) return "M " + num(v[0].x) + " " + num(v[0].y);

    const parts = ["M " + num(v[0].x) + " " + num(v[0].y)];
    for (let k = 1; k < v.length - 1; k++) {
      const a = v[k - 1], c = v[k], b = v[k + 1];
      // Only a genuine turn (perpendicular segments) gets a fillet; a collinear
      // junction is drawn straight.
      const turn = (a.y === c.y) !== (c.y === b.y);
      const lenIn = Math.hypot(c.x - a.x, c.y - a.y);
      const lenOut = Math.hypot(b.x - c.x, b.y - c.y);
      const r = Math.min(CORNER_RADIUS, lenIn * 0.4, lenOut * 0.4);
      if (!turn || r < 0.25 || lenIn === 0 || lenOut === 0) {
        parts.push("L " + num(c.x) + " " + num(c.y));
        continue;
      }
      const inX = c.x - ((c.x - a.x) / lenIn) * r;
      const inY = c.y - ((c.y - a.y) / lenIn) * r;
      const outX = c.x + ((b.x - c.x) / lenOut) * r;
      const outY = c.y + ((b.y - c.y) / lenOut) * r;
      parts.push("L " + num(inX) + " " + num(inY));
      parts.push("Q " + num(c.x) + " " + num(c.y) + " " + num(outX) + " " + num(outY));
    }
    const last = v[v.length - 1];
    parts.push("L " + num(last.x) + " " + num(last.y));
    return parts.join(" ");
  }

  // ─── Coordinate projectors ────────────────────────────────────────────────
  function plotX(t, tMin, tMax, W, PAD) {
    if (tMax <= tMin) return PAD.left;
    const usable = W - PAD.left - PAD.right;
    return PAD.left + (usable * (t - tMin)) / (tMax - tMin);
  }

  function plotY(v, lo, hi, H, PAD) {
    if (hi <= lo) return PAD.top;
    const usable = H - PAD.top - PAD.bottom;
    return PAD.top + usable * (1 - (v - lo) / (hi - lo));
  }

  // ─── Y domain ─────────────────────────────────────────────────────────────
  // Adaptive Y-domain: fit actual data range with padding when autoscaleY is
  // true; otherwise lock to full probability space [0, 1].
  // NOTE: reads `autoscaleY` from `settings` passed by the caller — never from
  // any global state object.
  // Probabilities packed into less than 20pp of vertical space tend to read
  // as indistinguishable to the eye — multi-outcome markets on short ranges
  // (3/10 outcomes on 1H/6H/1D) suffer this most, since per-outcome values
  // naturally cluster in narrow bands. Floor the autoscaled domain at 20pp
  // and expand symmetrically around the data center to give the chart
  // meaningful resolution without throwing autoscale away entirely.
  const MIN_DOMAIN_WIDTH = 0.2;

  // Outlier-resistant bounds. Naive min/max gets fooled by single-point
  // seed artifacts (e.g. a market that briefly held one outcome at 100%
  // before trading kicked in). When we have enough data to be statistical
  // about it (≥50 points), use 2nd/98th percentile so a lone spike doesn't
  // drag the Y-domain across the whole probability space. Below that
  // threshold, fall back to literal min/max — sparse data is its own story.
  function _outlierResistantBounds(visibleSeries) {
    const all = [];
    for (const s of visibleSeries) {
      for (const p of s.points) all.push(p.value);
    }
    if (!all.length) return null;
    if (all.length < 50) {
      let lo = Infinity, hi = -Infinity;
      for (const v of all) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      return { lo: lo, hi: hi };
    }
    all.sort(function (a, b) { return a - b; });
    const idxLo = Math.floor(0.02 * (all.length - 1));
    const idxHi = Math.ceil(0.98 * (all.length - 1));
    return { lo: all[idxLo], hi: all[idxHi] };
  }

  function computeYDomain(visibleSeries, settings) {
    if (!settings.autoscaleY) return { lo: 0, hi: 1 };
    const bounds = _outlierResistantBounds(visibleSeries);
    if (!bounds) return { lo: 0, hi: 1 };
    let lo = bounds.lo;
    let hi = bounds.hi;
    if (!isFinite(lo) || !isFinite(hi)) return { lo: 0, hi: 1 };

    // Anchor rule (Polymarket / Kalshi move): give the chart a natural
    // baseline when one is obvious.
    //   - All data below 50% → anchor lo=0  ("how far above impossible")
    //   - All data above 50% → anchor hi=1  ("how far below certain")
    //   - Data crosses 50%   → free autoscale (the spread IS the context)
    // Without anchoring, a multi-outcome market with 4 lines clustered at
    // 12-17% reads as a tight, baseline-less band; with anchoring it reads
    // as four lines hovering low above the floor — and you can tell at a
    // glance "these are minority outcomes," which is the truth.
    const allLow = hi < 0.5;
    const allHigh = lo > 0.5;
    const pad = Math.max((hi - lo) * 0.08, 0.02);
    let paddedLo = allLow ? 0 : Math.max(0, lo - pad);
    let paddedHi = allHigh ? 1 : Math.min(1, hi + pad);

    const snap = function (v, up) {
      const step = 0.05;
      return up ? Math.ceil(v / step) * step : Math.floor(v / step) * step;
    };
    let finalLo = Math.max(0, snap(paddedLo, false));
    let finalHi = Math.min(1, snap(paddedHi, true));

    // Apply minimum-width floor. Expand symmetrically around the data
    // center; if the expansion would push past 0 or 1, slide the window
    // back inside the [0, 1] range so the floor is still 20pp wide.
    if (finalHi - finalLo < MIN_DOMAIN_WIDTH) {
      const center = (finalLo + finalHi) / 2;
      let newLo = center - MIN_DOMAIN_WIDTH / 2;
      let newHi = center + MIN_DOMAIN_WIDTH / 2;
      if (newLo < 0) { newHi -= newLo; newLo = 0; }
      if (newHi > 1) { newLo -= (newHi - 1); newHi = 1; }
      finalLo = Math.max(0, newLo);
      finalHi = Math.min(1, newHi);
    }
    return { lo: finalLo, hi: finalHi };
  }

  // Horizontal-grid tick values across [lo, hi]. Polymarket/Kalshi both run ~5
  // gridlines at round-number marks (0/20/40/60/80%) — but they can, because
  // their Y axis is a FIXED full-range scale. Ours autoscales to the traded
  // band (outlier-resistant zoom), so we can't hardcode 0–100 marks. Instead we
  // snap to "nice" probability steps (1%…50%) that fall INSIDE the zoomed
  // domain — Poly's round-% grid texture, honest to our domain. Targets ~5
  // lines: pick the step whose division count lands closest to 5.
  const NICE_Y_STEPS = [0.01, 0.02, 0.025, 0.05, 0.1, 0.2, 0.25, 0.5];
  function niceYTicks(lo, hi) {
    const span = hi - lo;
    if (!(span > 0)) return [(lo + hi) / 2];
    const TARGET = 5;
    let step = NICE_Y_STEPS[0];
    let bestErr = Infinity;
    for (const s of NICE_Y_STEPS) {
      const err = Math.abs(span / s - TARGET);
      if (err < bestErr) { bestErr = err; step = s; }
    }
    const ticks = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
      ticks.push(Math.round(v * 1e6) / 1e6);
    }
    return ticks.length ? ticks : [(lo + hi) / 2];
  }

  // ─── Time label helpers ───────────────────────────────────────────────────
  const HE_MONTHS = [
    "ינו'", "פבר'", "מרץ", "אפר'", "מאי", "יוני",
    "יולי", "אוג'", "ספט'", "אוק'", "נוב'", "דצמ'",
  ];

  // Tick label format adapts to the actual data span, not the nominal range.
  // Year is dropped when span < 1 year — matches Poly's pattern.
  function formatAxisLabel(date, spanMs) {
    if (spanMs < 2 * 86400000) {
      // < 2 days → time-of-day
      const hh = date.getHours().toString().padStart(2, "0");
      const mm = date.getMinutes().toString().padStart(2, "0");
      return hh + ":" + mm;
    }
    if (spanMs < 90 * 86400000) {
      // < ~3 months → day + month
      return date.getDate() + " " + HE_MONTHS[date.getMonth()];
    }
    if (spanMs < 365 * 86400000) {
      // < 1 year → month only
      return HE_MONTHS[date.getMonth()];
    }
    // longer → month + year
    return HE_MONTHS[date.getMonth()] + " " + (date.getFullYear() % 100);
  }

  function formatTooltipTimestamp(date) {
    const day = date.getDate();
    const month = HE_MONTHS[date.getMonth()];
    const hh = date.getHours().toString().padStart(2, "0");
    const mm = date.getMinutes().toString().padStart(2, "0");
    return day + " " + month + " · " + hh + ":" + mm;
  }

  // ─── Adaptive X-axis tick spacing ─────────────────────────────────────────
  // Targets ~6 ticks across the visible span by picking the smallest "nice"
  // step >= span/6. All ticks snap to clock boundaries.
  // Polymarket's pattern: ticks adapt to the *actual data span*, not the
  // nominal range tab. A NEW market on the 1D tab shows appropriate ticks.
  const NICE_TICK_STEPS_MS = [
    1 * 60000,           // 1m
    2 * 60000,           // 2m
    5 * 60000,           // 5m
    10 * 60000,          // 10m
    15 * 60000,          // 15m
    20 * 60000,          // 20m
    30 * 60000,          // 30m
    60 * 60000,          // 1h
    2 * 60 * 60000,      // 2h
    3 * 60 * 60000,      // 3h
    4 * 60 * 60000,      // 4h  ← matches Poly's 1D density
    6 * 60 * 60000,      // 6h
    8 * 60 * 60000,      // 8h
    12 * 60 * 60000,     // 12h
    24 * 60 * 60000,     // 1d
    2 * 24 * 60 * 60000, // 2d
    3 * 24 * 60 * 60000, // 3d
    7 * 24 * 60 * 60000, // 1w
    14 * 24 * 60 * 60000, // 2w
    30 * 24 * 60 * 60000, // ~1mo
    60 * 24 * 60 * 60000, // ~2mo
    90 * 24 * 60 * 60000, // ~3mo
    180 * 24 * 60 * 60000, // ~6mo
  ];

  function pickAdaptiveTickStep(spanMs) {
    const idealStep = spanMs / 6;
    for (const step of NICE_TICK_STEPS_MS) {
      if (step >= idealStep) return step;
    }
    return NICE_TICK_STEPS_MS[NICE_TICK_STEPS_MS.length - 1];
  }

  function ceilTimestampToStep(t, stepMs) {
    const d = new Date(t);
    if (stepMs < 86400000) {
      // Sub-day: snap to a minutes-since-midnight grid.
      const stepMin = stepMs / 60000;
      const totalMins =
        d.getHours() * 60 +
        d.getMinutes() +
        (d.getSeconds() > 0 || d.getMilliseconds() > 0 ? 1 / 60 : 0);
      const ceilTotal = Math.ceil(totalMins / stepMin) * stepMin;
      d.setHours(Math.floor(ceilTotal / 60), ceilTotal % 60, 0, 0);
      return d.getTime();
    }
    // Day+ steps → align to start of day, then push forward if needed.
    d.setHours(0, 0, 0, 0);
    if (d.getTime() < t) d.setDate(d.getDate() + 1);
    return d.getTime();
  }

  function pickAxisTickTimes(tMin, tMax) {
    const span = tMax - tMin;
    if (span <= 0) return [tMin];
    const stepMs = pickAdaptiveTickStep(span);
    const first = ceilTimestampToStep(tMin, stepMs);
    const ticks = [];
    for (let t = first; t <= tMax; t += stepMs) ticks.push(t);
    return ticks;
  }

  // ─── Default dimensions ───────────────────────────────────────────────────
  // These match the current stage canvas. Callers may override via
  // options.dimensions. The 3:1 aspect (600×200) matches Poly/Kalshi's
  // ~3.55:1 more closely than the old 1.8:1 proof canvas.
  const DEFAULT_DIMENSIONS = {
    width: 600,
    height: 200,
    pad: { top: 12, right: 72, bottom: 22, left: 8 },
    gutterX: null, // computed: W - PAD.right + 6
  };

  // ─── Public API ───────────────────────────────────────────────────────────
  /**
   * Render a probability chart into the given SVG node.
   *
   * @param {SVGElement} svgNode  Empty SVG element to render into.
   * @param {Object}     options
   * @param {Array}      options.seriesByOutcome
   *   Filtered series (already selection-resolved).
   *   Shape: [{ outcomeId, label, shortLabel?, points: [{t, value}] }]
   *   Colors are NOT carried on series — they come from `palette` + index.
   * @param {string[]}   options.palette
   *   Array of colors (one per visible line). Index i of seriesByOutcome
   *   uses palette[i % palette.length].
   * @param {Object}     options.settings
   *   { autoscaleY, showXAxis, showYAxis, horizontalGrid, verticalGrid }
   * @param {Object=}    options.dimensions
   *   { width, height, pad: {top,right,bottom,left}, gutterX }
   *   Defaults to current stage values (W=600, H=200, etc).
   *
   * @param {Array=}     options.hoverExtras
   *   Optional secondary hover rows rendered below the first series' label.
   *   Each entry: { label: string, computeValue: (canonicalValue: number) => number }.
   *   The renderer reads the FIRST series' current point value, runs each
   *   computeValue, and renders `"<label> <Math.round(computed * 100)>%"`.
   *   Used by binary mode to show the implied complement (e.g. canonical
   *   "Yes 38%" → secondary "No 62%"). Each extra inherits the first series'
   *   color; renderer doesn't know what "complement" means.
   *
   * ──────────────────────────────────────────────────────────────────────
   * Per-series tags (read from each `seriesByOutcome[i]`):
   *
   * - `endDotVariant` (optional, default "default"):
   *     "default" — plain colored dot (r=3)
   *     "live"    — colored dot with soft halo (.end-dot--live)
   *     "winner"  — enlarged dot (r=6) + white ✓ overlay (.end-dot--winner)
   *     "loser"   — enlarged dot (r=6) + white ✗ overlay (.end-dot--loser)
   *
   * - `areaFill` (optional, default false): when true, that series gets a
   *   vertical-gradient area fill below its line. Independent per series.
   *
   * The renderer dispatches on these tags. It doesn't know what a "winner"
   * means, doesn't know that binary mode exists — the caller decides.
   * ──────────────────────────────────────────────────────────────────────
   *
   * @returns {{
   *   applyHover: (clientX: number) => void,
   *   clearHover: () => void,
   *   destroy: () => void
   * }}
   */
  function render(svgNode, options) {
    const series = options.seriesByOutcome || [];
    const palette = options.palette || [];
    const settings = options.settings || {
      autoscaleY: true,
      showXAxis: true,
      showYAxis: true,
      horizontalGrid: true,
      verticalGrid: false,
    };
    const dims = options.dimensions || {};
    const hoverExtras = Array.isArray(options.hoverExtras) ? options.hoverExtras : [];
    // Entry-animation flag (the wrapper gates it to fire once, on first mount).
    // L1 only emits the markup the CSS animates — no market knowledge.
    const reveal = !!options.reveal;
    // Compact (L3) consumers suppress L1's floating value pills and read the
    // hovered values out via onHover to paint their own readout (e.g. the hero
    // legend column). Crosshair + dots + timestamp pill stay. Defaults keep
    // market-detail unchanged.
    const hoverLabels = options.hoverLabels !== false;
    const onHover = typeof options.onHover === "function" ? options.onHover : null;
    const onHoverClear = typeof options.onHoverClear === "function" ? options.onHoverClear : null;
    const W = dims.width || DEFAULT_DIMENSIONS.width;
    const H = dims.height || DEFAULT_DIMENSIONS.height;
    const PAD = dims.pad || DEFAULT_DIMENSIONS.pad;
    const GUTTER_X = dims.gutterX != null
      ? dims.gutterX
      : W - PAD.right + 6;

    // Assign colors from palette by index. Caller controls ordering — index i
    // of seriesByOutcome gets palette[i % palette.length].
    //
    // Empty palette is a caller error — fail loud in the console so the
    // bug surfaces, then render with a single fallback color rather than
    // crashing. The fallback hex matches the stage's Lift palette[0] for
    // visual continuity if the warning is missed; production callers must
    // supply a real palette.
    if (!palette.length && series.length) {
      // eslint-disable-next-line no-console
      console.warn(
        "[HzProbabilityChartRenderer] empty palette with non-empty series; falling back to single color"
      );
    }
    const FALLBACK_COLOR = "#4fb8c4";
    const coloredSeries = series.map(function (s, i) {
      return Object.assign({}, s, {
        color: palette.length ? palette[i % palette.length] : FALLBACK_COLOR,
      });
    });

    // Clear the SVG and set viewBox.
    svgNode.innerHTML = "";
    svgNode.setAttribute("viewBox", "0 0 " + W + " " + H);
    // CSS keys all entry-animation rules off this attribute. innerHTML="" does
    // not clear root attributes, so remove it explicitly on non-reveal renders
    // (polling, range switches) — otherwise the line re-draws on every poll.
    if (reveal) {
      svgNode.setAttribute("data-reveal", "1");
    } else {
      svgNode.removeAttribute("data-reveal");
    }

    if (coloredSeries.length === 0) {
      return {
        applyHover: function () {},
        clearHover: function () {},
        destroy: function () { svgNode.innerHTML = ""; },
      };
    }

    // ── Y domain ──────────────────────────────────────────────────────────
    const { lo, hi } = computeYDomain(coloredSeries, settings);

    // ── Time domain ───────────────────────────────────────────────────────
    let tMin = Infinity;
    let tMax = -Infinity;
    for (const s of coloredSeries) {
      for (const p of s.points) {
        const t = p.t * 1000;
        if (t < tMin) tMin = t;
        if (t > tMax) tMax = t;
      }
    }
    if (!isFinite(tMin) || tMin === tMax) {
      // Single-point fallback — paint a flat sample at the center.
      tMin -= 1;
      tMax += 1;
    }

    // ── Y grid + Y axis labels ─────────────────────────────────────────────
    const yTicks = niceYTicks(lo, hi);
    for (const v of yTicks) {
      const y = plotY(v, lo, hi, H, PAD);
      if (settings.horizontalGrid) {
        svgNode.appendChild(
          el("line", {
            class: "grid",
            x1: PAD.left,
            x2: W - PAD.right,
            y1: y,
            y2: y,
          })
        );
      }
      if (settings.showYAxis) {
        svgNode.appendChild(
          el("text", {
            class: "axis-text",
            x: GUTTER_X,
            y: y + 3,
            "text-anchor": "start",
          }, Math.round(v * 100) + "%")
        );
      }
    }

    // ── Project series into pixel space ───────────────────────────────────
    const projected = coloredSeries.map(function (s) {
      return Object.assign({}, s, {
        plotted: s.points.map(function (p) {
          const rawY = plotY(p.value, lo, hi, H, PAD);
          // The settlement point's true value (1.0/0.0) usually sits outside the
          // outlier-resistant Y-domain (which tracks the traded range so the line
          // keeps its amplitude). Clamp its RENDERED y to the plot edge so the
          // dashed hop + ✓/✗ dot stay on-canvas; `value` stays true for the
          // "הוכרע X%" hover readout. Doctrine: domain ignores the spike, geometry
          // follows (same rule as the seed-artifact 100% spike).
          const y =
            p.kind === "settlement"
              ? Math.max(PAD.top, Math.min(H - PAD.bottom, rawY))
              : rawY;
          return {
            t: p.t * 1000,
            value: p.value,
            kind: p.kind, // "settlement" on the backend-appended terminal point
            x: plotX(p.t * 1000, tMin, tMax, W, PAD),
            y: y,
          };
        }),
      });
    });

    // ── Clip paths for past/future split ──────────────────────────────────
    // Dual-pass line rendering — past at opacity 1, future at 0.45.
    // Hover position drives the clip boundary. Left-edge guard: past clip
    // width is clamped to a minimum so the bright zone never collapses to
    // zero. Avoids the "chart disappears" case at the leftmost data point
    // on mobile.
    const variantId = "hz-" + Math.random().toString(36).slice(2, 8);
    const defs = el("defs");
    svgNode.appendChild(defs);

    const clipPast = el("clipPath", { id: "clip-past-" + variantId });
    const clipPastRect = el("rect", {
      x: PAD.left,
      y: 0,
      width: W - PAD.left - PAD.right,
      height: H,
    });
    clipPast.appendChild(clipPastRect);

    const clipFuture = el("clipPath", { id: "clip-future-" + variantId });
    const clipFutureRect = el("rect", { x: W, y: 0, width: 0, height: H });
    clipFuture.appendChild(clipFutureRect);

    defs.appendChild(clipPast);
    defs.appendChild(clipFuture);

    // ── Area fill gradients (per-series) ──────────────────────────────────
    // Each series flagged with `areaFill: true` gets a unique linearGradient
    // in <defs>. Vertical: series color at 0.18 opacity at the top → fully
    // transparent at the bottom. The fill sits BEHIND the line, clipped to
    // the chart area. variantId makes IDs instance-unique across multiple
    // chart mounts.
    for (let si = 0; si < projected.length; si++) {
      const s = projected[si];
      if (!s.areaFill) continue;
      const gradId = "area-grad-" + variantId + "-" + si;
      const grad = el("linearGradient", {
        id: gradId,
        x1: "0", y1: "0", x2: "0", y2: "1",
      });
      const stopTop = el("stop", {
        offset: "0%",
        "stop-color": s.color,
        "stop-opacity": "0.18",
      });
      const stopBottom = el("stop", {
        offset: "100%",
        "stop-color": s.color,
        "stop-opacity": "0",
      });
      grad.appendChild(stopTop);
      grad.appendChild(stopBottom);
      defs.appendChild(grad);
    }

    // ── Line layer ────────────────────────────────────────────────────────
    const linesLayer = el("g", { class: "lines" });
    svgNode.appendChild(linesLayer);

    // Captured during the loop: the series the wrapper tagged `leadDot` (the
    // canonical line). Its path drives the entry animation's leading dot.
    let featuredReveal = null;

    // Area-fill reveal clips to drive each frame (rAF) so the fill tracks the
    // line's arc-length draw exactly. Populated in the loop when reveal is on.
    const revealAreaClips = [];

    for (let si = 0; si < projected.length; si++) {
      const s = projected[si];
      // The backend appends a terminal settlement point (kind:"settlement") to
      // resolved series — the redemption value (winner→1, loser→0) at resolvedAt.
      // The trade line draws solid over the real trades; the final hop to the
      // settlement point draws as a separate dashed segment below. So the trade
      // line, its area fill, and the reveal all run over `linePlotted` (trades
      // only); the dashed settlement hop and the ✓/✗ terminal dot key off the
      // real last point.
      const hasSettlement =
        s.plotted.length >= 2 &&
        s.plotted[s.plotted.length - 1].kind === "settlement";
      const linePlotted = hasSettlement ? s.plotted.slice(0, -1) : s.plotted;
      const pathStr = stepPath(linePlotted);

      if (reveal && s.leadDot && linePlotted.length >= 2) {
        featuredReveal = {
          pathStr: pathStr,
          color: s.color,
          last: linePlotted[linePlotted.length - 1],
        };
      }

      // Area fill (per-series): closed path below the line, drawn first so
      // it sits behind the line. Path: line from first point, same step
      // trace, then close to bottom-right → bottom-left → back to start.
      // Requires ≥2 points — a single-point series has no horizontal span
      // to anchor an area against; rendering it would emit a zero-width
      // degenerate path. The end-dot still renders for the single point.
      // The caller tags series with `areaFill: true` — the renderer
      // doesn't decide which series gets a fill.
      if (s.areaFill && linePlotted.length >= 2) {
        const first = linePlotted[0];
        const last = linePlotted[linePlotted.length - 1];
        const bottomY = H - PAD.bottom;
        const areaD = pathStr +
          " L " + last.x + " " + bottomY +
          " L " + first.x + " " + bottomY +
          " Z";
        const gradId = "area-grad-" + variantId + "-" + si;
        const areaAttrs = {
          class: "line-area",
          d: areaD,
          fill: "url(#" + gradId + ")",
        };
        // On reveal, sync the fill to the LINE's arc-length draw: a CSS wipe is
        // linear in X, but the line draws by arc length, so on a stepped path
        // the fill outruns the line (vertical steps cost arc without advancing
        // X). We can't express "X at arc-fraction t" in CSS, so a rAF reads the
        // line's drawn point via getPointAtLength and clips the fill to that X
        // each frame — fill edge tracks the line's leading edge exactly.
        if (reveal) {
          const clipId = "area-reveal-" + variantId + "-" + si;
          const clip = el("clipPath", { id: clipId });
          // Clip rect grows leftward-anchored; width is set each rAF frame to
          // the line's drawn X. Starts at 0 so the fill is hidden at t=0.
          const clipRect = el("rect", { x: 0, y: 0, width: 0, height: H });
          clip.appendChild(clipRect);
          defs.appendChild(clip);
          // Invisible measuring path (same geometry as the line) for
          // getPointAtLength — lives in <defs>, never painted.
          const measPath = el("path", { d: pathStr, fill: "none", stroke: "none" });
          defs.appendChild(measPath);
          areaAttrs["clip-path"] = "url(#" + clipId + ")";
          revealAreaClips.push({ rect: clipRect, measPath: measPath });
        }
        const areaPath = el("path", areaAttrs);
        linesLayer.appendChild(areaPath);
      }

      const pastLineAttrs = {
        class: "line line--past",
        d: pathStr,
        stroke: s.color,
        "clip-path": "url(#clip-past-" + variantId + ")",
      };
      // pathLength=1 normalizes stroke-dashoffset to [0,1] so the CSS draw
      // keyframe is path-length-agnostic (any line length draws in one tween).
      if (reveal) pastLineAttrs.pathLength = 1;
      const pastLine = el("path", pastLineAttrs);
      const futureLine = el("path", {
        class: "line line--future",
        d: pathStr,
        stroke: s.color,
        "clip-path": "url(#clip-future-" + variantId + ")",
      });
      linesLayer.appendChild(pastLine);
      linesLayer.appendChild(futureLine);

      // Settlement segment (resolved): the dashed hop from the last real trade
      // to the backend's terminal settlement point — a horizontal carry then a
      // step to the redemption value (winner→1.0/top, loser→0.0/bottom) at the
      // real resolution time. Dashed/distinct so it never reads as a trade —
      // settlement is an event, not a tick — but it IS a real data point (the
      // line genuinely reaches it, and it's hoverable), not a synthetic riser.
      if (hasSettlement) {
        // Split the settlement step into two passes:
        //  1) a SOLID horizontal carry holding the last traded price across the
        //     dead stretch (no trades between the final trade and resolution —
        //     the LMSR price genuinely held there), and
        //  2) the DASHED vertical jump to the redemption value at resolution.
        // Previously the whole step was one dashed path, so a market whose last
        // trade was hours before resolution showed a long dangling dashed tail
        // that read as "projected." Solid carry + short dashed jump reads as
        // "price held flat, then settled."
        const aPt = s.plotted[s.plotted.length - 2]; // last real (traded) point
        const bPt = s.plotted[s.plotted.length - 1]; // terminal settlement point
        linesLayer.appendChild(
          el("path", {
            class: "line line--settlement-carry",
            d: "M " + aPt.x + " " + aPt.y + " L " + bPt.x + " " + aPt.y,
            stroke: s.color,
          })
        );
        linesLayer.appendChild(
          el("path", {
            class: "line line--settlement",
            d: "M " + bPt.x + " " + aPt.y + " L " + bPt.x + " " + bPt.y,
            stroke: s.color,
          })
        );
      }
    }

    // Entry-animation lead dot: rides the featured (canonical) line's leading
    // edge via CSS offset-path, landing on its end-dot. Exactly one, regardless
    // of line count — the wrapper tags only the canonical series with leadDot.
    if (reveal && featuredReveal) {
      const lead = el("circle", {
        class: "reveal-lead-dot",
        r: 5,
        fill: featuredReveal.color,
        cx: 0,
        cy: 0,
      });
      // `color` drives the CSS drop-shadow (currentColor) so the glow matches
      // the series; offset-path drives the ride.
      lead.setAttribute(
        "style",
        'offset-path: path("' + featuredReveal.pathStr + '"); color: ' + featuredReveal.color
      );
      linesLayer.appendChild(lead);
    }

    // Area-fill reveal: clip each fill to the X of the line's drawn point at
    // fraction t, every frame, so the fill edge tracks the line's leading edge
    // exactly. t runs 1500ms linear to match the CSS line draw (hz-chart-draw).
    // getPointAtLength maps arc-fraction → point, which is the piece CSS can't
    // express (a CSS wipe is linear in X and outruns the stepped line). Bails if
    // the chart re-rendered (measuring path detached from the DOM).
    if (reveal && revealAreaClips.length && typeof requestAnimationFrame === "function") {
      const REVEAL_MS = 1500;
      const totals = revealAreaClips.map(function (c) {
        try { return c.measPath.getTotalLength(); } catch { return 0; }
      });
      let startTs = null;
      const tick = function (now) {
        if (startTs === null) startTs = now;
        const t = Math.min(1, (now - startTs) / REVEAL_MS);
        for (let i = 0; i < revealAreaClips.length; i++) {
          const c = revealAreaClips[i];
          if (!c.measPath.isConnected) return; // re-rendered/destroyed — stop
          let x;
          try { x = c.measPath.getPointAtLength(totals[i] * t).x; } catch { return; }
          c.rect.setAttribute("width", String(x));
        }
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }

    // ── End-of-line dots ──────────────────────────────────────────────────
    // Dot terminators at line endpoints — small color anchors so the line
    // "lands" visibly even when nothing else is drawn at the right edge.
    // No end-of-line text labels (Poly/Kalshi put identification in the top
    // legend above the chart, leaving the canvas pure).
    //
    // Per-series dispatch on `series.endDotVariant`:
    //   "winner" / "loser" → enlarged dot (r=6) + white ✓/✗ glyph overlay
    //   "live"             → small dot (r=3) + .end-dot--live class (halo)
    //   "default" (or unset) → small dot (r=3), no extra class
    //
    // The renderer dispatches on the tag; the caller decides which series
    // gets which variant.
    const endLayer = el("g", { class: "end-labels" });
    svgNode.appendChild(endLayer);
    for (const s of projected) {
      const last = s.plotted[s.plotted.length - 1];
      if (!last) continue;
      const variant = s.endDotVariant || "default";
      // `last` is the terminal point — on resolved series that's the backend's
      // settlement point itself (winner→1.0/top, loser→0.0/bottom), so the ✓/✗
      // dot lands on it for free; no synthetic snap needed.
      const dotX = last.x;
      const dotY = last.y;

      if (variant === "winner" || variant === "loser") {
        const dotClass = "end-dot end-dot--" + variant;
        const glyph = variant === "winner" ? "✓" : "✗";
        endLayer.appendChild(
          el("circle", {
            class: dotClass,
            cx: dotX, cy: dotY, r: 6, fill: s.color,
          })
        );
        endLayer.appendChild(
          el("text", {
            class: "end-dot-glyph",
            x: dotX, y: dotY,
            "text-anchor": "middle",
            "dominant-baseline": "central",
          }, glyph)
        );
      } else {
        const isLive = variant === "live";
        // Continuous live "heartbeat" ring behind EVERY line's end dot — a slow
        // expand+fade that signals the chart is live. This branch covers the
        // non-resolved dots (default + live); winner/loser are handled above and
        // never pulse (they're settled). The canonical line additionally carries
        // the .end-dot--live glow so it stays visually primary among the pulses.
        // Separate element from the dot so it never collides with the reveal.
        // Animated in probability-chart.css (hz-chart-ping; held until after the
        // draw under [data-reveal]; off for reduced-motion).
        endLayer.appendChild(
          el("circle", {
            class: "end-dot-ping",
            cx: last.x, cy: last.y, r: 3, fill: s.color,
          })
        );
        const dotClass = isLive ? "end-dot end-dot--live" : "end-dot";
        endLayer.appendChild(
          el("circle", {
            class: dotClass,
            cx: last.x, cy: last.y, r: 3, fill: s.color,
          })
        );
      }
    }

    // ── X grid + X axis labels ────────────────────────────────────────────
    if (settings.verticalGrid || settings.showXAxis) {
      const tickTimes = pickAxisTickTimes(tMin, tMax);
      const visibleSpanMs = tMax - tMin;
      const xMinPx = PAD.left;
      const xMaxPx = W - PAD.right;
      const labelHalfWidthPx = 18; // crude guard to keep labels in-frame
      // Resolution marker: the "nice" round ticks rarely land on the exact
      // moment a market settled, so a resolved chart's right edge (where it
      // jumps to 100/0 with the ✓/✗ dots) had no time label — you couldn't read
      // WHEN it ended. Pin the resolution time there, and suppress any regular
      // tick label that would collide with it.
      const settledPt = (function () {
        for (let i = 0; i < projected.length; i++) {
          const pl = projected[i].plotted;
          if (pl.length && pl[pl.length - 1].kind === "settlement") {
            return pl[pl.length - 1];
          }
        }
        return null;
      })();
      tickTimes.forEach(function (t) {
        const x = plotX(t, tMin, tMax, W, PAD);
        if (settings.verticalGrid) {
          svgNode.appendChild(
            el("line", {
              // Distinct class: the vertical grid is styled quieter than the
              // horizontal (Poly's rule — time gridlines never compete with the
              // probability gridlines the eye reads values off).
              class: "grid grid--vertical",
              x1: x,
              x2: x,
              y1: PAD.top,
              y2: H - PAD.bottom,
            })
          );
        }
        if (settings.showXAxis) {
          // Drop a regular tick label that would sit on top of the resolution
          // label (the resolution label wins — it carries the meaningful time).
          if (settledPt && Math.abs(x - settledPt.x) < labelHalfWidthPx * 2) {
            return;
          }
          let anchor = "middle";
          if (x < xMinPx + labelHalfWidthPx) anchor = "start";
          else if (x > xMaxPx - labelHalfWidthPx) anchor = "end";
          svgNode.appendChild(
            el("text", {
              class: "axis-text",
              x: x,
              y: H - 6,
              "text-anchor": anchor,
            }, formatAxisLabel(new Date(t), visibleSpanMs))
          );
        }
      });
      if (settings.showXAxis && settledPt) {
        svgNode.appendChild(
          el("text", {
            class: "axis-text axis-text--resolution",
            x: settledPt.x,
            y: H - 6,
            "text-anchor": "end",
          }, formatAxisLabel(new Date(settledPt.t), visibleSpanMs))
        );
      }
    }

    // ── Hover overlay layer ───────────────────────────────────────────────
    // Drawn last so it paints on top.
    const hoverLayer = el("g", { class: "hover-layer", visibility: "hidden" });
    svgNode.appendChild(hoverLayer);

    const crosshair = el("line", {
      class: "crosshair",
      x1: 0, x2: 0,
      y1: PAD.top,
      y2: H - PAD.bottom,
    });
    hoverLayer.appendChild(crosshair);

    // Per-series hover dot + floating label.
    const hoverArtifacts = projected.map(function (s) {
      const dot = el("circle", {
        class: "hover-dot",
        cx: 0, cy: 0,
        r: 4,
        fill: s.color,
      });
      const bg = el("rect", { class: "hover-label-bg", rx: 4, ry: 4 });
      const text = el("text", {
        class: "hover-label",
        fill: s.color,
        "text-anchor": "end",
      }, "");
      hoverLayer.appendChild(bg);
      hoverLayer.appendChild(dot);
      hoverLayer.appendChild(text);
      return { series: s, dot: dot, bg: bg, text: text };
    });

    // Hover extras — secondary rows that ride below the first series'
    // label on hover. Each extra has a `computeValue(canonicalValue)`
    // callback the caller provides; the renderer just evaluates it and
    // renders the result. Inherits the first series' color so the rows
    // read as related.
    //
    // Common shape (binary mode complement): one extra computing
    // `(canonical) => 1 - canonical`. But the renderer doesn't know
    // about probability complements — it just runs whatever closure the
    // caller hands in.
    const hoverExtraArtifacts = [];
    if (hoverExtras.length && projected.length >= 1) {
      const inheritColor = projected[0].color;
      for (const _extra of hoverExtras) {
        const xBg = el("rect", { class: "hover-label-bg", rx: 4, ry: 4 });
        const xText = el("text", {
          class: "hover-label",
          fill: inheritColor,
          "text-anchor": "end",
          opacity: "0.65",
        }, "");
        hoverLayer.appendChild(xBg);
        hoverLayer.appendChild(xText);
        hoverExtraArtifacts.push({ bg: xBg, text: xText });
      }
    }

    // Timestamp pill at the top of the crosshair.
    const tsBg = el("rect", { class: "timestamp-bg", rx: 4, ry: 4 });
    const tsText = el("text", {
      class: "timestamp-text",
      "text-anchor": "middle",
    }, "");
    hoverLayer.appendChild(tsBg);
    hoverLayer.appendChild(tsText);

    // ── Initial state: no hover → past covers everything, future empty ────
    clipPastRect.setAttribute("width", W - PAD.left - PAD.right);
    clipFutureRect.setAttribute("width", 0);

    // ── Hover helpers ─────────────────────────────────────────────────────
    function applyHoverSvgX(svgX) {
      if (svgX < PAD.left || svgX > W - PAD.right) {
        hideHover();
        return;
      }
      // Defensive guard — if hover fires after a partial re-render or
      // against a stale handle, projected may be empty. Don't throw.
      if (!projected.length || !projected[0].plotted.length) {
        hideHover();
        return;
      }

      // Hover SNAPS to the nearest sample point so the readout lands on real
      // bucket times (10:00 → 10:05 → 10:10 on 1D), not arbitrary in-between
      // times. EXCEPTION: across a genuine large gap — a resolved market's
      // dashed carry from the last trade to its settlement point — we free-follow
      // the cursor so the timestamp advances smoothly instead of teleporting
      // 19:43→22:46. Regular buckets are uniform at the range resolution, so a
      // gap well beyond the median spacing is a real hole, not normal cadence.
      const points = projected[0].plotted;

      // Median inter-point gap ≈ the range resolution (buckets are uniform).
      let medianGapMs = Infinity;
      if (points.length > 1) {
        const gaps = [];
        for (let i = 1; i < points.length; i++) gaps.push(points[i].t - points[i - 1].t);
        gaps.sort(function (a, b) { return a - b; });
        medianGapMs = gaps[gaps.length >> 1];
      }

      // Carry-forward bracket: prev = last point at-or-before the cursor.
      let prevIdx = 0;
      for (let i = 0; i < points.length; i++) {
        if (points[i].x <= svgX) prevIdx = i;
        else break;
      }
      const nextIdx = prevIdx + 1 < points.length ? prevIdx + 1 : prevIdx;
      const inLargeGap =
        nextIdx !== prevIdx && points[nextIdx].t - points[prevIdx].t > medianGapMs * 3;

      // Settlement endpoint catchment: it sits on the right clip boundary, so
      // within a small band snap fully to it (lands on the ✓/✗ dot, "הוכרע X%").
      const lastPt = points[points.length - 1];
      const snapToSettlement =
        lastPt.kind === "settlement" && svgX >= lastPt.x - 14;

      let nearestIdx;
      let snapToPoint;
      if (snapToSettlement) {
        nearestIdx = points.length - 1;
        snapToPoint = true;
      } else if (inLargeGap) {
        // Real gap → free-follow the cursor; value carried forward from prev.
        nearestIdx = prevIdx;
        snapToPoint = false;
      } else {
        // Dense/uniform region → snap to the nearer sample for a bucket-aligned time.
        nearestIdx =
          svgX - points[prevIdx].x <= points[nextIdx].x - svgX ? prevIdx : nextIdx;
        snapToPoint = true;
      }
      const nearest = points[nearestIdx];

      // Snapped → crosshair + readout land on the sample's real time/position.
      // Free-follow (large gap only) → crosshair tracks the cursor, time
      // interpolated, value held from the carried point, so the gap doesn't jump.
      const hoverX = snapToPoint ? nearest.x : svgX;
      const hoverT = snapToPoint
        ? nearest.t
        : tMin + ((svgX - PAD.left) / (W - PAD.left - PAD.right)) * (tMax - tMin);

      // Crosshair line.
      crosshair.setAttribute("x1", hoverX);
      crosshair.setAttribute("x2", hoverX);

      // Update clip rects so past = left of hoverX, future = right.
      // The split sits exactly at the hovered data point — earlier we
      // clamped past-width to 8% of dataWidth to avoid a "chart
      // disappears" case when hovering at the leftmost point on mobile,
      // but with the future opacity at 0.45 the lines stay readable
      // even when past collapses to zero, so the precision is back.
      const dataWidth = W - PAD.right - PAD.left;
      const pastWidth = Math.max(0, hoverX - PAD.left);
      const futureX = PAD.left + pastWidth;
      clipPastRect.setAttribute("x", PAD.left);
      clipPastRect.setAttribute("width", pastWidth);
      clipFutureRect.setAttribute("x", futureX);
      clipFutureRect.setAttribute("width", Math.max(0, dataWidth - pastWidth));

      // Update per-series hover dots + labels.
      const labelX = hoverX > W / 2 ? hoverX - 8 : hoverX + 8;
      const anchor = hoverX > W / 2 ? "end" : "start";
      const padX = 5;
      const padY = 2;
      // Layout-thrash mitigation: batch all SVG writes BEFORE any getBBox()
      // read so the browser does a single forced layout per hover event
      // instead of one per text element. With binary's complement label,
      // pre-batching shaves a hover from 3 forced layouts to 2 (we can't
      // batch the complement's bbox read because its position depends on
      // the canonical's bbox bottom edge).
      const labelEntries = [];
      for (const art of hoverArtifacts) {
        // Read THIS series' value at the hover TIME (step value = last point at
        // or before hoverT), not a shared index. The shared nearestIdx only
        // aligns when every series shares the same sample times; on an event
        // chart the children are separate markets whose points bunch at
        // different times (an eliminated child clusters at its resolution), so
        // index N lands on the wrong time — the pill would read a pre-resolution
        // value while the line sits flat at 0. Time-lookup keeps dot + pill on
        // the line.
        const seriesPlotted = art.series.plotted;
        let seriesPoint = seriesPlotted[0];
        for (let k = 1; k < seriesPlotted.length; k++) {
          if (seriesPlotted[k].t <= hoverT) seriesPoint = seriesPlotted[k];
          else break;
        }
        if (!seriesPoint) continue;
        // The settlement point is a real data point — hovering it reads
        // "הוכרע X%" (resolved), distinct from a trade tick.
        const settled = seriesPoint.kind === "settlement";
        const dotY = seriesPoint.y;
        // Dot rides the crosshair (cursor X) at the step value's Y, so it traces
        // the drawn line — including the flat dashed carry — as the cursor moves.
        art.dot.setAttribute("cx", hoverX);
        art.dot.setAttribute("cy", dotY);
        if (!hoverLabels) continue; // dots + crosshair only; values go out via onHover
        const labelText =
          (art.series.shortLabel || art.series.label) +
          (settled ? " הוכרע " : " ") +
          Math.round(seriesPoint.value * 100) + "%";
        art.text.textContent = labelText;
        art.text.setAttribute("x", labelX);
        // Label sits above the dot, but a top-clamped dot (resolved winner snaps
        // to the top edge) would push it off-canvas — flip it below the dot when
        // it's within label-height of the top.
        art.text.setAttribute("y", dotY < PAD.top + 14 ? dotY + 13 : dotY - 7);
        art.text.setAttribute("text-anchor", anchor);
        labelEntries.push(art);
      }
      tsText.textContent = formatTooltipTimestamp(new Date(hoverT));
      tsText.setAttribute("x", hoverX);
      tsText.setAttribute("y", PAD.top - 1);

      // Read each value pill's bbox and size its background.
      for (const art of labelEntries) {
        const bbox = art.text.getBBox();
        art.bg.setAttribute("x", bbox.x - padX);
        art.bg.setAttribute("y", bbox.y - padY);
        art.bg.setAttribute("width", bbox.width + padX * 2);
        art.bg.setAttribute("height", bbox.height + padY * 2);
      }

      // Timestamp pill (top of the crosshair). Position it FIRST so the value
      // pills can de-overlap below it. Clamp x so it stays in the plot — it's
      // centered on the crosshair, so near an edge half of it would clip (the
      // date was getting cut at the left).
      const tsBox = tsText.getBBox();
      const tsHalf = tsBox.width / 2 + 6;
      const tsX = Math.max(PAD.left + tsHalf, Math.min(W - PAD.right - tsHalf, hoverX));
      if (tsX !== hoverX) tsText.setAttribute("x", tsX);
      tsBg.setAttribute("x", tsX - tsHalf);
      tsBg.setAttribute("y", tsBox.y - 2);
      tsBg.setAttribute("width", tsBox.width + 12);
      tsBg.setAttribute("height", tsBox.height + 4);
      const tsBottom = tsBox.y - 2 + (tsBox.height + 4);

      // De-overlap the value pills below the timestamp. Close probabilities
      // place their labels at near-identical Y, stacking the pills (a 4-outcome
      // market showed only 3); and a top line's pill collided with the date.
      // Sort by Y, reserve the timestamp band as the top floor, push apart by
      // pill height, and if the stack runs past the bottom shift it up +
      // re-resolve — so all stay visible, clear of the date, inside the plot.
      let canonicalLabelBottomY = null;
      if (labelEntries.length > 0) {
        const topLimit = tsBottom + 2;
        const slotH = Number(labelEntries[0].bg.getAttribute("height")) + 2;
        const items = labelEntries
          .map(function (art) { return { art: art, top: Number(art.bg.getAttribute("y")) }; })
          .sort(function (a, b) { return a.top - b.top; });
        items[0].top = Math.max(items[0].top, topLimit);
        for (let i = 1; i < items.length; i++) {
          const minTop = items[i - 1].top + slotH;
          if (items[i].top < minTop) items[i].top = minTop;
        }
        const overflow = items[items.length - 1].top + slotH - (H - PAD.bottom);
        if (overflow > 0) {
          for (const it of items) it.top = Math.max(topLimit, it.top - overflow);
          for (let i = 1; i < items.length; i++) {
            const minTop = items[i - 1].top + slotH;
            if (items[i].top < minTop) items[i].top = minTop;
          }
        }
        for (const it of items) {
          const delta = it.top - Number(it.art.bg.getAttribute("y"));
          if (delta !== 0) {
            it.art.bg.setAttribute("y", it.top);
            it.art.text.setAttribute("y", Number(it.art.text.getAttribute("y")) + delta);
          }
        }
        const bottomItem = items[items.length - 1];
        canonicalLabelBottomY =
          bottomItem.top + Number(bottomItem.art.bg.getAttribute("height"));
      }

      // Complement hover label (binary mode). Stacks below the canonical
      // label, so its Y depends on the canonical bbox — that's why this
      // can't batch with the writes above. Still one layout pass for the
      // complement bbox, but bounded.
      if (hoverLabels && hoverExtraArtifacts.length) {
        const seriesPoint = projected[0].plotted[nearestIdx];
        if (seriesPoint) {
          const canonicalValue = seriesPoint.value;
          let stackY = canonicalLabelBottomY != null
            ? canonicalLabelBottomY + 11
            : seriesPoint.y + 7;
          for (let xi = 0; xi < hoverExtraArtifacts.length; xi++) {
            const art = hoverExtraArtifacts[xi];
            const extra = hoverExtras[xi];
            const computed = extra.computeValue
              ? extra.computeValue(canonicalValue)
              : canonicalValue;
            const pct = Math.round(computed * 100);
            art.text.textContent = extra.label + " " + pct + "%";
            art.text.setAttribute("x", labelX);
            art.text.setAttribute("y", stackY);
            art.text.setAttribute("text-anchor", anchor);
            const cbbox = art.text.getBBox();
            art.bg.setAttribute("x", cbbox.x - padX);
            art.bg.setAttribute("y", cbbox.y - padY);
            art.bg.setAttribute("width", cbbox.width + padX * 2);
            art.bg.setAttribute("height", cbbox.height + padY * 2);
            stackY = cbbox.y + cbbox.height + padY + 11; // next row below
          }
        }
      }

      // Hand the hovered point out so a compact consumer can paint its own
      // readout. L1 stays ignorant of what a "legend column" is.
      if (onHover) {
        onHover({
          t: hoverT,
          series: projected.map(function (s) {
            var sp = s.plotted[nearestIdx];
            return {
              outcomeId: s.outcomeId,
              label: s.shortLabel || s.label,
              value: sp ? sp.value : null,
            };
          }),
        });
      }

      hoverLayer.setAttribute("visibility", "visible");
      endLayer.setAttribute("visibility", "hidden");
    }

    function hideHover() {
      hoverLayer.setAttribute("visibility", "hidden");
      endLayer.setAttribute("visibility", "visible");
      clipPastRect.setAttribute("width", W - PAD.left - PAD.right);
      clipFutureRect.setAttribute("width", 0);
      if (onHoverClear) onHoverClear();
    }

    // ── Public applyHover takes a clientX (screen coord) ─────────────────
    // Translates via getCTM so the math works regardless of how the SVG is
    // scaled (the SVG may be stretched to fill its CSS container).
    function applyHover(clientX) {
      const ctm = svgNode.getScreenCTM();
      if (!ctm) return;
      const pt = svgNode.createSVGPoint();
      pt.x = clientX;
      pt.y = 0;
      const inSvg = pt.matrixTransform(ctm.inverse());
      applyHoverSvgX(inSvg.x);
    }

    // ── Attach DOM event handlers ─────────────────────────────────────────
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

    // ── Return handle ─────────────────────────────────────────────────────
    return {
      /**
       * Pass a client-space X coordinate; updates dim split + crosshair +
       * tooltip. Used by external hover handlers (e.g. a wrapper that
       * intercepts pointer events on a container larger than the SVG).
       */
      applyHover: applyHover,

      /**
       * Restore non-hover state (full-opacity past, hidden overlay).
       */
      clearHover: hideHover,

      /**
       * Remove all rendered nodes and detach event listeners. Idempotent.
       */
      destroy: function () {
        svgNode.removeEventListener("mousemove", onMouseMove);
        svgNode.removeEventListener("mouseleave", onMouseLeave);
        // Mirror the `{ passive: false }` from `addEventListener` for
        // symmetry. `passive` doesn't affect listener identity (capture
        // does), but keeping the option object explicit prevents drift if
        // someone later flips `capture` on one side without the other.
        svgNode.removeEventListener("touchstart", onTouchStart, { passive: false });
        svgNode.removeEventListener("touchmove", onTouchMove, { passive: false });
        svgNode.removeEventListener("touchend", onTouchEnd);
        svgNode.removeEventListener("touchcancel", onTouchEnd);
        svgNode.innerHTML = "";
      },
    };
  }

  // ── Export ────────────────────────────────────────────────────────────────
  window.HzProbabilityChartRenderer = { render: render };
})();
