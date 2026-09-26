# Market Detail Probability Chart

Updated: 2026-06-16
Status: current
Owner: frontend / market-detail surface

Purpose:
- reusable market movement surface
- render the probability chart, legend, timeframe controls, and visible line picker
- keep market-history display separate from outcome rows and trade actions

## Product Job

The chart makes the market feel real:
- current odds
- direction of movement
- timeframe context
- selected outcome lines

It is a trust surface, not decoration.

## Design flow

The chart should feel:
- calm but alive
- finance/sports signal, not fake analytics
- readable before the user studies the outcome ladder

Rules:
- show max 4 outcome lines at once (multi-outcome only)
- expose line picker when outcomes exceed that
- timeframes are compact: `1H`, `6H`, `1D`, `1W`, `1M`, `ALL`
- if backend has no movement, do not fake noisy movement
- lines are **stepped with rounded corners** — price holds flat then jumps (honest:
  no fabricated motion between samples), with a small clamped fillet softening each
  corner (Kalshi pattern, adopted 2026-06-15; radius clamps to a fraction of the
  shorter adjacent segment so dense ranges stay crisp). Smoothing the line *through*
  points (Polymarket) is **rejected** — it invents intermediate values that never
  traded. Verified: our `/history` already buckets at Poly/Kalshi cadence, so the
  only honest difference was step-vs-smooth, and step wins (Kalshi steps too).
- chart labels stay quiet; lines and probabilities carry meaning
- binary markets render as **one canonical-side line** (see below), not two mirrored lines
- resolved markets default to `ALL` range and overlay endpoint glyphs (✓ winner, ✗ loser) on the line terminators
- **settlement is a DATA point, not a render snap** (adopted 2026-06-20): the backend appends one terminal point per outcome — `kind:"settlement"`, redemption value (winner→1.0, losers→0.0) at `resolvedAt` — to `/history`. The renderer draws the final hop from the last real trade to it as a **dashed** segment (settlement is an event, not a tick) and lands the ✓/✗ dot on it. The point's true value drives the hover readout ("הוכרע X%"); its rendered Y is **clamped to the plot edge** when the redemption value sits outside the outlier-resistant Y-domain (an underdog winner traded at 25% still shows ✓ at the top). This replaced the earlier synthetic vertical riser — honest (real terminal fact at the real time), hoverable for free, less special-casing.

## Architecture — three layers

The chart ships as three independent layers so each consumer pulls only what it needs.

### L1 · Pure renderer — `assets/js/components/probability-chart-renderer.js`

Stateless SVG drawer. Knows nothing about markets, winners, binary modes, or probability complements. Draws exactly what each series is tagged to look like.

```js
window.HzProbabilityChartRenderer.render(svgNode, {
  seriesByOutcome,  // [{ outcomeId, label, points, endDotVariant, areaFill }]
  palette,          // ['#hex', ...] — colors by series index
  settings,         // { autoscaleY, showXAxis, showYAxis, horizontalGrid, verticalGrid }
  dimensions,       // optional { width, height, pad, gutterX }
  hoverExtras,      // optional [{ label, computeValue(canonicalValue) }]
  reveal,           // optional bool — play the trace + lead-dot entry once on this render
  hoverLabels,      // optional bool (default true) — false suppresses L1's floating value
                    //   pills (the ts pill still shows); crosshair + dots stay. Compact
                    //   consumers read values out via onHover and render them elsewhere.
  onHover,          // optional ({ t, series:[{outcomeId,label,value}] }) => void — emitted
                    //   on each hover so a consumer drives its own readout (e.g. hero legend)
  onHoverClear,     // optional () => void — emitted when the cursor leaves
}) → { applyHover, clearHover, destroy };
```

Per-series tags the renderer dispatches on:
- `endDotVariant: "default" | "winner" | "loser" | "live"` — controls the terminator (small dot / ✓ glyph / ✗ glyph / soft halo)
- `areaFill: boolean` — paints a gradient area between the line and the baseline

`hoverExtras` is how the wrapper threads "secondary hover row" semantics through without the renderer needing to know what a probability complement is — each extra is a `{ label, computeValue }` pair, and the renderer calls `computeValue(canonicalValue)` to derive the displayed value at hover time.

`onHover` / `hoverLabels` keep L1 pure while letting a chrome-light consumer own its own value readout: L1 draws the crosshair + dots and hands the consumer `{ t, series }` to paint into whatever surface it owns (instead of, or alongside, its own floating pills). The renderer never learns what a "legend column" is.

**Hover model — snap to the sample bucket, free-follow only across real gaps (adopted 2026-06-23).** The crosshair snaps to the nearest sample point, so the readout lands on real bucket-aligned times (`10:00 → 10:05 → 10:10` on 1D, `:00/:30` on 1W, 4h marks on 1M) — not arbitrary in-between times. The exception is a genuine large gap — a resolved market's dashed carry from the last trade to its settlement point — where it **free-follows the cursor** so the time advances smoothly instead of teleporting; a gap `> ~3× the median sample spacing` is treated as a real hole, not normal cadence. The terminal **settlement** point sits on the right clip boundary, so it keeps a small catchment band so it lands on the ✓/✗ dot ("הוכרע X%"). (This supersedes the 2026-06-21 pure-free-follow model, which read arbitrary continuous times on dense data.)

**Hover labels.** Multi-outcome value pills **de-overlap vertically** — close probabilities otherwise place their labels at near-identical Y and stack on top of each other (a 4-outcome market showed only 3). They sort by Y, reserve the timestamp band at the top, push apart by pill height, and clamp inside the plot. The timestamp pill is **RTL** (the SVG is force-LTR for axis geometry, which mis-orders the Hebrew date — overridden to `direction: rtl`, safe because it's `text-anchor:middle`) and **clamps within the plot** so it never clips at an edge.

**Grid — dotted, nice-number Y ticks, both axes (adopted 2026-06-23).** Borrowed from Polymarket/Kalshi, who both run a **dotted** grid (`stroke-dasharray: 1 3`, true dots) rather than solid rules — it reads as a reference plane *behind* the data instead of a frame competing with it. Y lines land on **round-percentage marks** (`niceYTicks`: ~5 lines at the nicest 1%/2%/5%/10%/20% step that fits) — but, unlike the references' fixed 0–100 axis, snapped to marks that fall *inside* our outlier-resistant autoscaled domain, so the labels stay round without forcing a full-range axis. Vertical (time) gridlines ride at **half opacity** of the horizontal (`.grid--vertical { opacity: 0.5 }`) — the references keep time lines quieter than the value lines the eye reads off. Grid stroke sits at `--hz-border` (0.18α via `--chart-grid`), a step up from the `border-faint` a solid line would use: the dotted dash reads ~half as present, so faint vanished on the dark stage. Both axes are **on by default** for market-detail (L2) and the hero (L3 compact); the picker still toggles each.

**Reusable by L3 compact mounts without dragging L2's chrome.**

### L2 · Wrapper — `assets/js/components/market-detail-chart.js`

Owns every piece of chrome the market-detail page expects:
- top legend (dot · name · value per visible outcome)
- range tabs (1H / 6H / 1D / 1W / 1M / ALL)
- outcome picker (`קווים` dropdown, 4-cap + floor rules)
- age pill, footer stats row, NEW pill
- range-aware polling + visibility guard
- backend adapter calls
- hover state coordination with L1

```js
window.HzMarketDetailChart.mount(hostNode, {
  marketKey, palette, fetchHistory, marketMeta,
  initialRange, initialSettings, dimensions, onRangeChange,
}) → { destroy, setMarket, setPalette, setMeta, refresh };
```

**Makes all the market-domain decisions** — what's binary, what's resolved, who won — and tags each series before handing it to L1. The renderer never asks "is this the winner?" — the wrapper sets `endDotVariant` per series and L1 just dispatches.

### L3 · Compact mount — `systems/web/public/scripts/probability-chart-compact.js`

A small reusable mount for chrome-light consumers: trending hero, (future) trending cards, portfolio rows, breaking feed. Same role as L2 — own the market-domain decisions and tag series — but **no range tabs, no picker, no footer, no polling, no settings menu**. One render from already-resolved data; optional reveal; hover forwarded to the consumer. Covers both single-line sparklines and multi-line (up to 4) compact charts. **Inherits L1's purity for free.**

```js
window.HzProbabilityChartCompact.mount(hostNode, {
  fetchSeries,            // () => Promise<seriesByOutcome> — called on mount, AND again on
                          //   each refresh() (live). The hero seeds slide 0 once (resolves
                          //   instantly), then fetches /history on refresh. (Static accepted.)
  palette,                // token names or colors (resolved here)
  complementLabel,        // binary → adds a "<label> <1-v>%" hover row (כן/לא)
  dimensions,             // optional; default = the host's measured pixel box (1:1)
  allowReveal,            // only the slide that loads with the page passes true
  hoverLabels,            // default true (L1 pills); false → read values via onHover
  onHover, onHoverClear,  // optional; for a consumer that paints its own readout
}) → { destroy, refresh };  // refresh() re-resolves fetchSeries + redraws WITHOUT replaying
                            //   the reveal (no-op until first draw / while one is in flight)
```

**First consumer — the trending hero** (`HeroCarousel.astro`). Status: **shipped 2026-06-16.** Replaced the bespoke SSR inline-SVG + `chart-math.js` (retired — nothing else imported it), fixing the index-axis trap and moving to `/history` as the single chart source.

- **Data source — `/history`, single source.** The hero charts from `/api/markets/<key>/history` (same as market-detail), **not** a separate feed series. (We first embedded `preview.chart.points`; it only carried recent trades, so values were flat-early and the chart squashed right — and Poly/Kalshi don't split either: each fetches real history per chart. `preview.chart.points` is now retired — see inbox handoff.) The SSR config embeds which outcomes to chart + their tags; the mount resolves the points: a single market is **one fetch**; an **event**'s outcomes are separate child markets, so each missing one fetches its own `/history` and we take its canonical `yes` line (mirrors Polymarket — one history call per child). Top-4 by current prob; binary collapses to the canonical side (line + live dot + complement hover row); **no area fill** on the hero (owner pref). Range = `all` (see Range & density).
- **First paint + loading (owner model).** **Slide 0 is SSR-seeded from `/history`** (resolved server-side via `BACKEND_INTERNAL_URL`, embedded in the HTML) so it loads *with the page*. **Slides 1–4 fetch `/history` after first paint** — eager (`requestIdleCallback`), so they're ready before rotation, but never blocking the page and never waiting for a view/click. Hero chrome (title, legend, buttons) stays SSR; the chart host reserves height (no CLS). NOTE: `/api` is only reachable through Caddy (`:6969`), not bare Astro (`:4321`) — verify the hero on `:6969`.
- **Reveal = page entrance, not per-slide.** Only the slide that loads with the page (slide 0) animates; slides reached by rotation/swipe render static (the hero passes `allowReveal:true` only to slide 0). Reuses the shipped 1.5s-linear rounded reveal; floors on <2 points / `prefers-reduced-motion`.
- **Live (shipped 2026-06-24).** The hero charts now refresh off the discovery feed doorbell (`hz:discovery-feed-snapshot`, dispatched by `FeedPage.astro` / `breaking-markets.astro`) — same doorbell→refresh pattern as market-detail. The init keeps each mount's handle on its host (`host._hzChartHandle`) and a single window-guarded listener queries the live DOM and calls `refresh()` on each, debounced 1.5s and skipped while hidden/mobile. `refresh()` re-fetches `/history` (slide 0 drops its one-time SSR seed) and redraws without replaying the reveal. The **live "heartbeat" ping** on every line's end-dot is the visual tell (see Entry animation).
- **SSR seed = one parallel wave (shipped 2026-06-24).** The market-detail page (`markets/[marketKey].astro`) hoists the chart-history seed fetch into a `Promise.all` alongside `fetchMarketDetail()` and passes it to `ChartIsland` as `seed=`, collapsing what were two *sequential* SSR round-trips on the hottest page. Shared helper `lib/chart-seed.js` (`resolveSeedRange` + `fetchChartSeed`); ChartIsland falls back to its own fetch when unseeded. The seed range must match the client's `resolvedInitialRange` (URL `?range`, else **`all`**) or the client discards it — keep `resolveSeedRange` in lockstep with that default. Pay-off is prod (dev edge is `no-store`).
- **Hover = market-detail display.** L1 draws the crosshair + dots + timestamp pill + floating value pills; binary adds the complement row (`כן/לא`) via `complementLabel`. The legend/headline stay at the current value — the pills do the time-travel readout. (`hoverLabels:false` + `onHover` remain for a bare sparkline that suppresses pills and drives its own readout.)
- **Interpolation / scale.** Step + rounded corners and outlier-resistant autoscale come from L1 — no smooth bézier, no fixed 0–1 domain. Line stroke bumped to 2.5px (hero is 1:1, so the shared 1.5u reads thin); chart box ~2:1 (taller than the initial ~2.6:1, for vertical breathing room).
- **Responsive.** Desktop only — the hero is already hidden ≤1024px (discovery responsive contract).

**Range & density — `all` for now, REVISIT (calibration-locked 2026-06-16).** The hero requests `range=all`, matching Polymarket (`interval=all`) and our own market-detail default. So the window length = the market's **age** (a 2h-old market shows 2h; a year-old one shows a year) — which is why stretch & timestamps differ per market, *not* because history is hidden. Open calibration, revisit when markets age:
- **(a) Window.** Kalshi instead picks an adaptive *recent* window per market (~6h…~400d) with bucket size scaling. We may cap the hero to a recent window (`1W`/`1M`) so it reads more uniformly — a one-line change (`range` in `buildChartConfig`). Couldn't judge it today: the sim markets are too young for a cap to differ from `all`.
- **(b) Density vs width.** The *same* market can read denser in the narrow hero than in the wide detail page (Poly's "Hormuz" does exactly this) — they tune fidelity to the available width. We pass `/history`'s `all` fidelity unchanged (no width-aware tuning). Revisit a width-aware fidelity request.
- **(c) Height.** Chart box ~2:1 is itself a calibration target (grows the above-the-fold hero zone).

## Binary single-line treatment

Open binary markets render **one line, not two**. The canonical-side series carries:
- `areaFill: true` — gradient fade under the line
- `endDotVariant: "live"` — soft halo on the live tip

A `hoverExtras` entry passes `{ label: nonCanonicalLabel, computeValue: (v) => 1 - v }` so the hover tooltip shows both sides as a stacked pair (`כן 11%` / `לא 89%`) without the renderer knowing what a probability complement is. The wrapper makes the complement decision; the renderer just evaluates the closure.

Resolved binary uses the same single-line shape but swaps `endDotVariant: "live"` for `"winner"` or `"loser"` depending on whether the canonical side won.

## Entry animation — trace + lead dot

On first paint the chart reveals itself instead of appearing flat. The job is
signature polish that *also* covers the rest of the market-detail page
hydrating (trade ticket, viewer positions, community) — the eye locks to the
moving line while the islands below mount. The chart's own data is SSR-seeded
and paints instantly, so this masks page hydration, never a chart fetch.

Motion:
- all visible series trace left→right (oldest→newest) **in parallel**, **1.5s,
  linear** — even velocity end-to-end, tick-by-tick along the step path, not a
  smooth sweep. (An ease-out was tried and rejected: it front-loaded the trace —
  ~75% of the line drew in the first quarter-second, flashing the actual move,
  then the lead dot crawled the flat tail. Linear gives every segment screen-time
  proportional to where it sits. Calibrated 2026-06-15 against a moving market;
  flat markets are useless for judging a reveal.)
- the one featured series (the `areaFill: true` line — binary's canonical line,
  multi's canonical) carries a **lead dot** that rides its leading edge to "now";
  it keeps the `.end-dot--live` glow so it stays visually primary
- the featured area fill wipes in synced behind its line
- non-featured multi-outcome series trace too, but carry no lead dot during the
  draw — exactly one bead rides, so the guide-to-now never gets busy
- **end-dots land *after* the trace, on every line** (adopted 2026-06-24): every
  line's terminal dot holds hidden through the 1.5s draw, then pops in together
  the instant the lines finish (`hz-chart-dotpop`, delay = draw duration). On a
  **live** chart each end-dot then carries a continuous "heartbeat" ring
  (`hz-chart-ping` — slow expand+fade, on *every* line, held until after the
  draw); resolved (`winner`/`loser`) dots don't pulse. This replaced the old
  one-time reveal pulse that fired on just the featured dot mid-draw.

Rules:
- plays **once, on initial mount only** — range-tab switches afterward are
  instant, no replay (the cover job is finished after first paint)
- floors (skip the draw, fade in instead): featured series has < 2 usable points
  or too short a span (a just-opened market — a stub trace reads as broken);
  and `prefers-reduced-motion` → instant paint, no draw
- **default range is `ALL` for every market** (was `1D`); the SSR seed fetches
  `ALL`. Longer line = better reveal and better hydration cover. (Resolved
  markets already defaulted to `ALL` — this extends it to open markets.)

Layering (respects the L1/L2 boundary above):
- **L1** owns the motion primitive only — dash-draw on the line paths,
  clip-wipe on the area, `offset-path` on the lead dot — exposed as a render
  flag, not market knowledge
- **L2** decides *when* (once, on first mount) and *which* series carries the
  lead dot (the featured/`areaFill` series it already tags)

## Inputs

Data:
- snapshot current probabilities
- backend `/history` responses
- outcome metadata
- market status + winner identity (from market-model)
- volume/close labels

Helpers (consumed by L2):
- `getCanonicalOutcomeId`, `getMarketStatusMeta`, `getWinnerOutcomeId` (market-model)
- range-aware polling cadence map

State (lives in L2's closure, not the page orchestrator):
- active range (mirrored to URL `?range=X`)
- chart settings (persisted in `localStorage["hzChartSettings"]`)
- selected outcome IDs (top-N rule)

## Runtime integration

- L1 + L2 loaded by `systems/design/pages/market-detail.html`
- L2 mounted by `systems/design/assets/js/pages/market-detail/chart-integration.js` (the orchestrator-side wiring module — owns the `_chartHandle` closure, the palette token reader, and the `extractMarketMeta` helper)
- Page orchestrator calls `chartIntegration.mountChart()` once and `chartIntegration.renderChart()` on each snapshot refresh

## Used For

Now:
- canonical market detail chart (all four shapes: binary open, binary resolved, multi-outcome open, multi-outcome resolved)

Next likely reuse:
- sparkline (L3) on trending cards, portfolio rows, breaking feed

## Non-Goals

- L1 does not fetch history
- L1 does not know what a winner or a binary market is
- L2 does not own the chart-card panel's surrounding chrome (status pill, volume, close-date sit in the panel header/footer, not in L2)
- nothing in the stack creates synthetic movement

## Guardrails

- chart/history fidelity is beta-critical
- keep backend gaps visible, not disguised
- do not let timeframe controls collide with market metadata
- do not push market-domain knowledge back into L1 — if a future surface wants a new visual variant, add a per-series tag and a wrapper-side dispatch entry, not a new L1 option
- do not put end date/volume back in the header when chart footer owns it
