# Market Detail

Updated: 2026-06-21
Status: current
Owner: frontend / market-detail surface

> **Implementation migrated (2026-06-21).** The live route is now Astro SSR + **Preact islands** in
> `systems/web/src/components/market-detail/` — `OutcomeLadder.jsx`, `ResolvedRail.jsx`,
> `ViewerPositions.jsx`, `Community.jsx`, `TradeTicket.jsx`, `EventLadder.jsx` (the chart stays vanilla:
> `ChartIsland.astro` + `market-detail-chart.js` + `probability-chart-renderer.js`; `TrustSection.astro`
> stays static). The port was **1:1** — every behavior and the exact DOM (classes / `data-*` / ARIA) below
> still hold; the visual + UX spec in this doc is unchanged. Implementation-level references further down to
> `*.client.js`, `window.Hz*.mount(...)`, and `market-detail.js` describe the **legacy vanilla structure**
> (the pre-Astro `systems/front`); the equivalents now live in the `.jsx` islands. Cross-island wiring
> remained on the same window-event bus (`navi:auth-state`, `navi:portfolio-snapshot-updated`,
> `hz:market-live-fetch`, `hz:viewer-position-sell`, `hz:trade-complete`) + the `host._hzTicket.retarget`
> handle + shared `snapshot-fetch.js`. Receipt: `workspace/tasks/completed/market-detail-preact-migration.md`.

Purpose:
- document the current `market-detail.html` route surface
- separate visual-surface ownership from page-local ticket behavior and later deeper logic/data work
- keep future refactors from reopening solved layout issues

Design target:
- see `systems/design/guide/surfaces/market-detail/README.md`
- this file describes current implementation ownership
- the design blueprint describes where the route should feel/behave visually

## This Doc Owns

- current route implementation ownership
- market-detail data-source seams
- current ticket/runtime behavior boundaries

## This Doc Does Not Own

- market-detail visual doctrine
- backend engine truth
- deeper product-tone proof work

Those live in:
- `systems/design/guide/surfaces/market-detail/README.md`
- `ARCHITECTURE.md`
- `workspace/tasks/reference/market-detail-v1-shape-handoff.md`

## Files

- `systems/design/pages/market-detail.html`
  - canonical route markup — what users actually hit
  - top-level layout plus page mount points
  - loads the current deboxed market-detail surface
- `systems/design/guide/history/2026-04-market-detail-pre-v1-proof/market-detail-stage-promoted.html`
  - archived final stage-shell snapshot (2026-04-27)
  - provenance only; do not edit for current work
  - `systems/design/stage/market-detail.html` itself was deleted on 2026-05-20 (had drifted past this snapshot, never canonical)
- `systems/design/assets/js/pages/market-detail.js`
  - page-local state orchestration and render coordination
  - DOM events
  - backend refresh / portfolio overlay / quote orchestration
  - delegates major visual rendering to component modules
- `systems/design/assets/js/pages/market-detail/components/market-header.js`
  - top identity rail
  - breadcrumbs/category path
  - date chain
  - utility action row and export/share helpers
- `systems/design/assets/js/components/probability-chart-renderer.js`
  - L1 pure renderer — SVG canvas, step lines, hover crosshair + dim split, axis tick logic
  - data-in, SVG-out — no chrome, no fetching, no state object
  - exports `window.HzProbabilityChartRenderer.render(svgNode, options)`
  - reusable for the planned sparkline (trending/portfolio) without the wrapper chrome
- `systems/design/assets/js/components/market-detail-chart.js`
  - L2 chart wrapper — owns the chart-card chrome (legend, footer, controls)
  - own range-aware polling loop + visibility guard
  - line picker with identity-locked palette slots + animation snapshot
  - settings menu (autoscale / X axis / Y axis / horizontal grid / vertical grid)
  - range tab persistence in URL (`?range=X`), settings persistence in `localStorage["hzChartSettings"]`
  - exports `window.HzMarketDetailChart.mount(hostNode, options)` → `{ destroy, setMarket, setPalette, setMeta, refresh }`
  - (replaced `pages/market-detail/components/probability-chart.js` on 2026-05-29 — see "Chart redesign — Phase 2" log entry below)
- `systems/design/assets/js/pages/market-detail/components/outcome-ladder.js`
  - outcome rows
  - probability / movement / volume display
  - row-level trade action buttons
- `systems/design/assets/js/pages/market-detail/components/trade-ticket.js`
  - buy/sell ticket rendering
  - yes/no contract switch rendering
  - amount, chips, quote summary, feedback, and disabled state display
- `systems/design/assets/js/pages/market-detail/components/trust-sections.js`
  - rules fold
  - timeline fold
  - prohibitions fold
  - resolved/source display surface
- `systems/design/assets/js/pages/market-detail/components/related-markets.js`
  - related market rail/list rendering
- `systems/design/assets/js/pages/market-detail/shell.js`
  - route DOM mount discovery
  - static shell/template rendering for trust folds and ticket chrome
  - ticket DOM reference collection
- `systems/design/assets/js/pages/market-detail/formatters.js`
  - shared page-local formatting, escaping, decimal parsing, and trade amount rounding
- `systems/design/assets/js/pages/market-detail/chart-utils.js`
  - chart probability normalization
  - current-state chart flattening for stage view
  - sparkline path helper (the X-axis label machinery + `buildLinePath` retired 2026-05-29 — the L1 renderer owns its own line/axis math now; see Tier D + cleanup log)
- `systems/design/assets/js/pages/market-detail/chart-integration.js`
  - L2 chart wrapper mount + render orchestration (owns the `_chartHandle` closure, the `--chart-line-*` token reader, `extractMarketMeta`, the backend-adapter-to-`fetchHistory` shim)
  - extracted from the page orchestrator 2026-05-29 (D4)
- `systems/design/assets/js/pages/market-detail/components/resolved-rail.js`
  - resolved-state side rail (verdict block + viewer-position summary)
  - extracted from the page orchestrator 2026-05-29 (D4)
- `systems/design/assets/js/pages/market-detail/market-model.js`
  - outcome order, chart line selection, timeframe aliases, status metadata, and price/selection helpers
  - shared by chart, ladder, ticket, holdings, and community surfaces
- `systems/design/assets/js/pages/market-detail/trust-model.js`
  - Seer/backend trust text parsing and timeline/source/payout derivation
  - keeps trust presentation shaping out of the route orchestrator
- `systems/design/assets/js/pages/market-detail/trade-state.js`
  - live-trade capability checks
  - auth/trade restriction state
  - active quote state
  - quote/trade request body creation
  - backend trade error copy
- `systems/design/assets/js/pages/market-detail/holdings.js`
  - selected holding lookup
  - binary and complement-side holding derivation
  - position context for the ticket and outcome rows
- `systems/design/assets/js/pages/market-detail/ticket-model.js`
  - ticket mode config for buy/sell
  - ticket position-impact markup
  - stage ticket summary copy/value derivation
- `systems/design/assets/js/pages/market-detail/community.js`
  - market conversation tabs
  - holders / positions / activity panels
  - community outcome filters and social row markup
  - Community board/activity display rules (2026-06-23, `Community.jsx` + `comment-feed.css`):
    - holders rows show no per-row meta (the "open shares" caption duplicated the מניות column + value)
    - positions rows show the avg **inline** with the trader name (`.hz-community-row-id`), not stacked
    - activity rows are a gapped flex (`.hz-community-trade-copy`) and render the **side as the outcome**:
      `contractSide` is normalized mechanics, NOT display — for a yes/no outcome show it as-is (binary
      "no" trades carry outcomeLabel כן/לא, so prefixing produced "לא לא"); only a NAMED multi outcome
      gets a "לא <outcome>" prefix for a no-bet. The "סל משלים (n)" complement-leg hint is dropped.
    - mobile keeps the two yes/no board columns side-by-side (compacted), not stacked
- `systems/design/assets/js/pages/market-detail/portfolio-overlay.js`
  - backend portfolio snapshot hydration
  - available cash and per-market holding overlay state
  - portfolio refresh event emission after trade
- `systems/design/assets/js/pages/market-detail/mobile-ticket.js`
  - compact stage ticket overlay state
  - launcher copy
  - mobile rail aria/backdrop sync
- `systems/design/guide/components/market-detail/`
  - component-level docs for extracted market-detail visual surfaces
  - read these before reusing a surface elsewhere
- `systems/design/assets/js/data/market-detail-seed-data.js`
  - seeded passive market-detail records
  - seeded community records
  - route-local constants used by the page
- `systems/design/assets/js/pages/market-detail-local-adapter.js`
  - maps seeded records into the page-facing read shape
- `systems/design/assets/js/pages/market-detail-backend-adapter.js`
  - backend passive read adapter
  - supports explicit `source=backend` / `backendBase=...`
  - also follows shared local backend auth/runtime config on `127.0.0.1` / `localhost`
- `systems/design/assets/js/pages/market-detail-data-source.js`
  - single switch point between local data now and backend adapters later
- `workspace/tasks/reference/adapters-and-fallback-policy.md`
  - canonical rules for which market-detail adapters/fallbacks are temporary, beta-safe, or slated for removal
- `systems/design/assets/css/pages/market-detail.css`
  - page-owned visual surface styles
  - as of slice 1 (2026-05-12), this is the single source for the page; the former `pages/market-detail-stage.css` was merged in and deleted
  - slice 2c (2026-05-13) routed 36 slate-blue hairlines and 100 cool-slate text hex values through `--hz-border-*` / `--hz-text-*` warm tokens
  - slice 3 (2026-05-13) dropped the `--stage` body modifier and renamed state classes: `market-detail-page--stage-{scrolled,has-moved,ticket-open}` → `market-detail-page--{scrolled,has-moved,ticket-open}`
  - slice 4 (2026-05-13, three waves) extracted 16 patterns into `assets/css/patterns/` and shrank this file from 3570 → ~880 lines. What remains here is page-arrangement only: grid (`.market-detail-stage`, `.market-detail-stage-main`, `.market-detail-stage-rail`), sticky head (`.market-detail-stage-head` + atmosphere backdrop), dossier shell, page-local helpers (`market-detail-panel`, `market-detail-section*`, `market-detail-copy-block`, `market-detail-content-panel`), and the legacy vertical timeline fallback (`market-detail-timeline-{line,point,dot}`)
  - the `--stage-*` CSS variable aliases at the top of the file remain as a transitional layer; a future slice can replace `var(--stage-text-strong)` with `var(--hz-text)` directly and delete the alias block

- `systems/design/assets/css/patterns/` — wave-1 atoms, wave-2 single-purpose, wave-3 composites
  - **wave 1 atoms (2026-05-13):** `status-pill`, `position-pill`, `icon-action`, `avatar`, `breadcrumb`
  - **wave 2 single-purpose (2026-05-13):** `date-rail`, `trade-button`, `timeline`, `trust-fold`, `rule-card`
  - **wave 3 composites (2026-05-13):** `outcome-dot`, `chart` (full chart vocabulary), `outcome-ladder` (`.hz-outcome-row` + sub-elements), `button-primary` (generic CTA), `trade-ticket` (order card + side-toggle + contract-toggle + amount + chips + summary), `comment-feed` (social-shell + tabs + form + comments + replies + community-toolbar + position-table classes)
  - all patterns use the `hz-` BEM prefix; JS renderers in `assets/js/pages/market-detail/` emit the same class names
- `systems/design/assets/css/base.css`
  - shared utilities still used by market detail
  - examples: sticky order widget, timeline line/dot, chart utility classes
- `workspace/test/backend/next-prime-minister-BE-test.html`
  - backend smoke harness for the PM 4-outcome target

## Current Ownership

- route layout still uses the proven Tailwind grid split
  - `market-detail-layout`
  - `market-detail-main-column`
  - `market-detail-sidebar`
  - plus `lg:grid-cols-12`, `lg:col-span-8`, `lg:col-span-4`
- route HTML now stays mostly at mount-level for:
  - rules section chrome
  - timeline section chrome
  - community section shell
  - order ticket shell
- page CSS owns named visual surfaces, not data logic
  - panels
  - top identity / breadcrumb / action strip
  - date pills
  - avatar tokens
  - outcome dots
  - icon actions
  - chart chrome
  - outcome table rows and trade buttons
  - section titles and content panels
  - comment tabs, textarea, action buttons
  - order-card controls
  - related-market cards
- page script owns page state and rendering, not raw seeded truth anymore
  - section shell rendering for rules / timeline / community / order ticket
  - top identity block copy for breadcrumb tail, title, and market meta line
  - topbar chrome for source mark, category path, and action row
  - date-chain rendering as navigation between sibling markets, not in-page state tabs
  - chart rendering and timeframe switching
  - hovered chart point / tooltip state
  - outcome rows rendered from the same snapshot as the chart
  - related markets rendered from the same active market snapshot
  - topbar save/share/download actions handled locally until real integration exists
  - comments / top holders / positions / activity tabs rendered from seeded market-local community data
  - comments filtering between open-position holders and users without open positions
  - holders and positions views filtered by selected market outcome
  - buy / sell side switching inside the order ticket
  - outcome-row button clicks selecting the current ticket contract
  - rules and timeline/payment sections rendered from page-local market-detail data
  - ticket copy and values rendered from one stateful config instead of duplicated buy/sell HTML
- local adapter/data-source seam now owns record loading
  - passive market-detail read record
  - seeded community record
  - future backend handoff point without page surgery
- backend mode now supports backend-only passive markets without a local seed twin
  - backend record loading is async fetch-based; renderers read the cached record synchronously after load
  - synthetic zero holdings keep the ticket renderable
  - synthetic empty community keeps the page stable until live community exists
  - raw backend trades from `GET /api/markets/:marketKey/trades?limit=25` now populate the activity tab when available
  - anonymized backend positions from `GET /api/markets/:marketKey/positions?limit=50` now populate top holders and positions when available
  - holders/positions consume backend contract-position rows now; real `YES` and `NO` rows stay separate instead of frontend complement inference
  - raw trade activity shows `contractSide=no` as a visible side intent, with a complement-bundle hint when the backend sends multiple execution legs
  - backend market history comes only from `GET /api/markets/:marketKey/history?range=<range>`; `/api/market-detail` no longer inlines `snapshot.timeframes` (cut 2026-05-30; chart wrapper owns range-aware fetches and mini surfaces consume the merged-in 1D)
  - chart display follows the Poly-style density split: hover/data points can be denser than visible axis labels (`1H`: 1m data / ~10m labels, `6H`: 1m data / ~1h labels, `1D`: 5m data / ~4h labels, `1W`: 1h data / ~2d labels, `1M`: 4h data / ~1w labels, `all`: backend-chosen data / sparse date landmarks)
- page outcome rendering is no longer tied only to the old BOI 3-outcome order
  - chart
  - outcome rows
  - community outcome filters
  - ticket selection safety
  now derive from the active passive record outcome keys
- page now degrades more honestly when backend passive payloads are thin
  - date-chain rail now prefers backend family truth when `chain` is present on the passive payload
  - real backend families should come from persisted market family keys, not seeded page-local pills
  - chart timeframe controls only show available buckets
  - empty related/community sections render soft empty states
- page is now lifecycle-status ready on passive reads
  - adapters normalize missing `snapshot.marketStatus` to `open` for now
  - top meta + chart footer surface lifecycle label when backend sends it
  - live trade affordances disable early when passive status is not `open`
- backend chart rendering now tolerates partial timeframe payloads
  - missing outcome values inside a point fall back to prior / current snapshot truth instead of emitting `NaN` SVG paths
- resolved-market trust summary now has a first real product seam
  - backend passive reads may send `snapshot.resolution`
  - the rules/confidence section renders:
    - winning outcome
    - short explanation
    - resolved timestamp
    - source link
  - frontend keeps this additive and does not invent a separate trust widget tree yet
- live ticket pass now exists behind backend mode
  - quote: debounced `POST /api/markets/:marketKey/quote`
  - trade: `POST /api/markets/:marketKey/trades`
  - available cash and holdings now hydrate from `GET /api/portfolio/snapshot`
  - successful trade invalidates passive cache, refreshes portfolio snapshot truth, then re-renders the ticket
  - outcome rows now reflect live holdings when they exist, instead of pretending every outcome starts from zero
  - ticket now shows a compact "your position here" block so buy/sell intent has live context before submission
  - ticket now also shows the estimated post-trade position effect for the current action
  - live selection/quote state now keys on `market + outcome + buy/sell` instead of the old hidden yes/no ticket side
  - guest backend sessions now stay explicitly read-only instead of optimistic-then-401
  - shared auth `canTrade=false` now disables row actions, chips, side toggles, and submit before a fake-live request is sent
  - blocked sessions still get the same market read surface, with explicit restricted-state copy plus compact lock context and a path back to portfolio/session surfaces
  - direct-outcome sell buttons now stay disabled when there is no live holding to sell
  - successful live trades now keep a short explicit success line instead of being instantly overwritten by the next quote refresh
  - binary markets now expose the full contract-side surface:
    - `קנה כן`
    - `קנה לא`
    - `מכור כן`
    - `מכור לא`
  - buy/sell mode is now surfaced twice on-page:
    - explicit action rail inside the ticket
    - synced page-level action rail above the outcomes table
  - users should not have to infer that sell exists just because yes/no buttons changed wording
  - binary ticket now also has an explicit `כן / לא` contract switch inside the ticket itself
  - sell quick chips are now position percentages:
    - `25%`
    - `50%`
    - `75%`
    - `הכל`
  - binary `no` requests now go through backend `contractSide` truth, not fake frontend-only copy
  - binary `sell no` stays inventory-backed by the opposite outcome exposure; no naked short theater
  - live multi-outcome backend markets now also expose:
    - `קנה כן`
    - `קנה לא`
    - `מכור כן`
    - `מכור לא`
  - multi-outcome `מכור לא` is backed by a derived complement position:
    - minimum live shares across all non-anchor outcomes
    - summed average cost across those legs
  - seeded/local prototype markets still reserve direct `קנה / מכור` wording until they run through the live backend contract
- served-page backend mode rerun now verifies:
  - 4 outcomes render
  - live buy quote/trade succeeds
  - live sell quote/trade succeeds
  - no console/request failures in the tested path
- important current limitation:
  - live backend pass now supports:
    - binary contract-side trading
    - multi-outcome contract-side trading through complement execution
  - community and some local prototype data still use binary-style seeded shapes
  - served-page rerun should verify ticket cash/holdings stay aligned after portfolio snapshot refresh
  - passive backend route still falls back to `open` when `snapshot.marketStatus` is missing, but the current backend route already sends it

## Important Constraint

- do not replace the route's main grid split with a second custom grid system unless the layout is re-tested in browser
- this page already regressed once because the sidebar was pushed outside the intended desktop layout during CSS extraction
- if the main split changes, verify both:
  - desktop two-column layout
  - sticky order widget behavior while scrolling

## Header + Sticky Rail Scroll Behavior (2026-06-29)

Polymarket-style media-object header with a sidebar that reads as fixed while scrolling. The decisions and the bugs each one avoids:

- **Header = media object.** Bigger brand mark (~3.2–3.9rem) on the leading side; the breadcrumb is a quiet eyebrow stacked over the title (moved out of its own row into `.market-detail-title-block`). The mark vertically centers the eyebrow+title stack.
- **Scroll fold.** On scroll the eyebrow collapses (max-height/opacity transition) into a compact bar. The brand mark keeps its size on purpose — it PINS the header height, so folding never changes the header's height and therefore can't reflow the chart/ticket below it. That reflow, re-fired every frame near a single threshold, was the "page shake." Driven by `--head-compact` with hysteresis (add >64px, remove <20px) so it can't flicker. The title size is never touched — resizing it caused the old slice-2b hard break at scrollY≈190.
- **Flat surface, no atmosphere.** `.market-detail-page` is flat `--hz-bg` (page atmosphere removed for THIS page only; the global token in `tokens.css` is unchanged). The sticky header paints flat `--hz-bg` + border with NO opacity fade. Three bugs this kills: a fading `::before` bled scrolled content through the half-opaque header; an instant solid base under a still-fading gradient flashed plain `--hz-bg`; and the page's `scroll`-attached glow vs a `fixed`-attached header glow left a tonal band. Flat everywhere = the header is invisible except its hairline border.
- **Minimal headroom + rail offset.** Page-shell top padding shrunk to ~0.6rem (was 1.8rem + the stage's 1.05rem margin ≈ 47px). That headroom was sticky "travel" — the rail rose ~39px to meet the chrome before pinning. Now it pins on the first pixel (rise ~1.6px). The rail then sits ~20px below the header via matched `margin-top` + sticky `top` — both MUST move together, or the rise returns.

## Probability Hero — Versus Readout (2026-06-29)

A single big `X% סיכוי` is a yes/no-proposition affordance. It's correct for true yes/no markets (weather, "will X happen?") where one side is privileged. For a **named-opponent binary** (Brazil v Japan, Israel v Czechia — `namedOpponents` in `[marketKey].astro`) it's the wrong shape: the number is unattributed (52% of WHICH team?) and hides the other side.

- **Named-opponent binary** → `.hz-probability-hero--versus`: both sides shown in a row, **leader** big + a team-color dot, **opponent** smaller/dimmer to its left (RTL). `heroSides` is sorted leader-first; each value carries `data-hz-outcome` so the live updater (now a `querySelectorAll` loop) pulses both.
- **Yes/no binary** → unchanged single `% סיכוי`.
- Dot color = kit `colorPrimary` (chromatic ground, monochrome type); clustered kits (two blues) lean on the name, not the dot.
- **Open follow-ups (shipped as a "try it" pass):** (1) no live re-sort — a mid-session lead flip updates the numbers but keeps the SSR big/small order until reload; (2) confirm the market is a true two-way (the pair sums to 100) vs "team-to-win" yes/no with the draw folded into the other side — current code trusts the binary `current` values.

## Outcome Images (2026-06-29)

Per-outcome pictures across the ladders + ticket (Polymarket-style). Key decisions:

- **Pics only, no fallback dots.** Outcome rows lead with a flag/crest when the outcome maps to a registry entity, the `=` glyph for draw/tie, and **nothing** otherwise (the avatar slot only renders when there's an image/glyph). An earlier colored-dot fallback was dropped: the chart has only 4 line colors (`--chart-line-1..4`), so on a 10-outcome market the dots recurred and read worse than empty. Both ladders; `__main` flexes via `:has(.hz-outcome-row__avatar)`.
- **Data path — one field, not a new system.** `crestPath` is surfaced from the existing team-brand registry: `read-models/market-detail/outcomes.ts` passes the `crestPath` already on the `teamBrand` it uses for `colorPrimary`. No DB column, no asset pipeline. Flags served at `/assets/images/flags/{iso}.svg`. (This is the only backend touch — distinct from the deferred general outcome-image system.)
- **Volume alignment.** Rows are `[avatar][text column]`, so the name + volume share an edge instead of the volume drifting under the old (unstyled, invisible) dot. Text sizing scoped to `.hz-outcome-row__text` so dotless event rows match.
- **Ticket flag** (`TradeTicket` context-header media object): the selected outcome's flag, swapping with the binary side (Brazil⇄Japan) or chosen multi outcome; `=` glyph for draw; falls back to the **market icon** (`marketCrest = brandSrc`) for yes/no, non-entity multi, and events. Per-child crest is wired through `armChild` (falls back to the market icon until event children carry pics).
- **Ladder selection follows the click** in multi (was hardcoded to row 0); events already did via `armChild`.

## Scope Boundary

This doc is mostly for route structure plus the current ticket behavior boundary.

Out of scope for this phase:
- live chart behavior
- full trade engine calculations
- comments data/state
- durable backend-backed market-social reads
- dynamic market data
- section mount/render logic
- full renderer extraction into modules/components

The current page script is intentionally local and shallow:
- okay: one page-facing record from `market-detail-data-source.js` driving chart, outcomes, rules, timeline, topbar, related, and community
- okay: side toggle, outcome selection from row buttons, mirrored copy, quick chips, summary updates
- okay: rendering rules and timeline/payment content from one page-local source
- okay: basic chart hover and timeframe switching on top of passive market-detail reads
- not okay yet: treating the numbers as backend-truth trading calculations

## Integration Shape

- `market-detail.html` now loads:
  - seed data
  - local adapter
  - data-source seam
  - extracted page helpers:
    - formatters
    - chart utils
    - trade state
    - holdings
    - ticket model
    - community renderer
    - shell
  - page controller
  - current stage/deboxed market-detail CSS
- `market-detail-stage.html` is no longer a live route; use `market-detail.html`
- route markup should stay thin unless a shell needs no JS state at all
- route identity now centers on `?market=...`
- old `?meeting=...` links should only survive as a compatibility bridge
- unknown backend market keys should render an honest unavailable state, not silently reuse a different local market
- backend integration should replace the data-source internals first, not rewrite page renderers
- keep passive market-detail reads separate from future quote / trade execution seams
- current frontend can fall back to generic `option-*` labels for backend-only markets, but that is only a bridge

## Backend Handoff

- first backend hook point is `systems/design/assets/js/pages/market-detail-data-source.js`
- keep `systems/design/assets/js/pages/market-detail.js` renderer-facing
- passive route identity should stay market-based, not meeting-based
- backend mode on the route can be enabled through:
  - shared local runtime/auth config on `127.0.0.1` / `localhost`
  - `?source=backend`
  - `backendBase=...`
- first live pass should replace only passive market-detail reads for:
  - topbar/meta
  - active market snapshot
  - chart/history
  - outcomes
  - rules/timeline/payment
  - related markets
- family/date rail should stay backend-owned once Seer-created markets persist a shared family key
- keep community seeded on the first live pass unless backend explicitly ships that read too
- do not treat current ticket math as server truth; quote/trade must be separate follow-up seams
- useful next passive contract improvement:
  - expose explicit outcome labels on the passive payload
  - `snapshot.outcomes` array is fine if backend wants a small additive seam
- dedicated 4-outcome backend test harness lives at:
  - `workspace/test/backend/next-prime-minister-BE-test.html`

## Good Next Steps

- simplify leftover yes/no ticket internals now that backend mode is browser-verified
- keep market-detail ticket cash/holdings tied to portfolio snapshot truth as the portfolio slice grows
- run the blocked-session browser proof once the local systems/back/frontend pair is up
- optionally add dedicated served-page browser smoke on top of the repo smoke runner

## Binary layout (2026-05-15)

The market-detail page renders through one of two layout modules, picked at bootstrap based on the snapshot. This is the layout-module dispatch documented as Option C in the archived spec at `workspace/docs/history/superpowers-archive/specs/2026-05-15-market-detail-binary-layout-design.md`.

### Dispatch rule

```js
function isBinaryLayoutMarket() {
  return supportsContractSideTrading() && isBinaryContractMarket();
}
```

Both helpers live in `market-model.js`. The combined rule fires only when the market is both 2-outcome AND contract-side (Yes + No = 1.00). A 2-outcome `direct_outcome` market falls back to multi-outcome layout.

`shell.pickLayout({ isBinaryLayoutMarket, binaryLayout })` returns one of:

- `binaryLayout` (from `layouts/binary.js`) with `kind: "binary"`
- the implicit multi-outcome layout (from `shell.js` itself today) with `kind: "multi-outcome"`

Bootstrap in `market-detail.js`:

```js
const binaryLayout = binaryLayoutModule.createBinaryLayout();
const layout = shell.pickLayout({ isBinaryLayoutMarket, binaryLayout });
layout.renderStaticShell({ refs, routeShellCopy });
layout.bindMountedRefs({ refs });
if (!layout.hasRequiredRenderedShell(refs)) return;
const ticketRefs = layout.collectTicketRefs(refs.ticket);
if (!layout.hasRequiredTicketRefs(ticketRefs)) return;
```

The render fan-out branches on `layout.kind`: binary calls `renderHero` + `renderViewerPositions` (new), skips `renderOutcomes` + `renderRelatedMarkets`.

### Binary anatomy

Main column, top-to-bottom:

1. Header (title, breadcrumb, brand mark, action icons, date rail) — shared.
2. **Probability hero** *(new)* — `hz-probability-hero` block. `X% סיכוי ▲N`. Renders the canonical side. Resolved variant kicks in via `snapshot.settlementStatus`. ROI overlay appears when viewer holds a position.
3. Graph — `hz-chart` pattern, single canonical-side line (the binary layout sets `state.chartOutcomeIds = [getCanonicalOutcomeId()]` at boot).
4. **Viewer-positions panel** *(new, conditional)* — `hz-viewer-positions` block. Renders nothing when viewer holds zero shares. Otherwise one row per side held with `[מכור]` and `[↗ שתף]` action buttons. `מכור` switches the ticket to Sell mode + matching pill, focuses amount input. `↗ שתף` is a v1 stub.
5. Trust section — shared.
6. Comments section — shared.

Sidebar (rail):

7. **Binary trade ticket** — `hz-trade-ticket--binary` shell. Context-header (title + selected-side) → Buy/Sell tabs (`hz-side-toggle--stage`) → `hz-binary-pill-duo` → amount + chips → conditional summary panel → submit. Summary panel surfaces only when viewer holds shares.

### Canonical-side anchoring

One side is canonical per binary market type. Yes/No → Yes. Up/Down → Up. Above/Below → Above. The helper `getCanonicalOutcomeId()` returns `getOutcomeOrder()[0]` for binary markets, null otherwise. The first outcome in the snapshot is the canonical side by convention; a future market type that breaks this can add an explicit `canonicalOutcomeId` field.

The page is anchored to canonical-side truth:
- Chart line = canonical probability over time
- Probability hero = canonical % + delta
- ROI overlay = viewer's position on the canonical side

The non-canonical pill in the trade ticket is a *trade-direction selector only*. Clicking it changes which side the user buys/sells; it does NOT flip the chart, hero, or positions panel. This collapses the old "outcome ladder mirrors the same probability twice" loop into one focal truth.

### Vocabulary parameterization

The `hz-binary-pill-duo` pattern is vocabulary-blind. Labels come from `snapshot.outcomes[*].shortLabel`:
- Yes/No markets → `כן` / `לא`
- Up/Down markets → `Up` / `Down` (or whatever the contract supplies)

Same layout, same pattern, same code. The chart-content variation for Up/Down markets (underlying-asset price + target line) is a chart UX pass concern, not a layout concern.

### New CSS patterns

- `patterns/probability-hero.css` (`hz-probability-hero` + `__value`, `__qualifier`, `__delta`, `__resolution`, `__roi`)
- `patterns/binary-pill-duo.css` (`hz-binary-pill-duo` + `hz-binary-pill` with `--yes` / `--no` / `--active` / `--disabled` modifiers)
- `patterns/viewer-positions.css` (`hz-viewer-positions` + `__header`, `__row`, `__cell`, `__return`, `__actions`, responsive desktop-table → mobile-cards)

Modified:
- `patterns/trade-ticket.css` — added `--binary` shell modifier + `__context-header`, `__context-title`, `__context-side` sub-elements
- `pages/market-detail.css` — added page-arrangement rules for the new `data-market-detail-hero` and `data-market-detail-viewer-positions` mount points, with `:empty` collapse rules so the slots take zero space when the layout doesn't fill them

### New JS files

- `assets/js/pages/market-detail/layouts/binary.js`
- `assets/js/pages/market-detail/components/probability-hero.js`
- `assets/js/pages/market-detail/components/viewer-positions.js`
- `assets/js/pages/market-detail/components/binary-trade-ticket.js`

### Hooks for future work

- Per-market trade history (`Bought 11 Yes at 9¢ · 3d ago` style) — placeholder comment in `viewer-positions.js`. Awaits back-lane endpoint.
- Share-position flow — `↗ שתף` button is a wired stub.
- Chart UX pass (hover crosshair, tooltip, adaptive y-axis, sparse-state honesty) — see `workspace/coordination/inbox.md`. Plugs in on top of the existing chart pattern without touching the binary layout structure.
- keep settlement/PnL language for multi-outcome complement trades aligned to requested-vs-executed truth, not fake standalone `no` assets

## Mobile polish (2026-05-18)

Three UX gaps surfaced when running the page on a real device (iPhone 15 Pro / 393px):

### 1. Sticky bottom buy/sell launcher

At ≤960px the rail becomes a centered modal (existing rule). But the *trigger* element was scaffolded in JS only — there was no DOM element to open it, so mobile users had no path to the trade form at all. Fixed by:

- New mount in `pages/market-detail.html`: `<div data-market-detail-mobile-launcher>` between `<main>` and `<div data-site-footer>` so the launcher is anchored to the viewport, not the scroll container.
- New pattern `patterns/mobile-trade-launcher.css` (`.hz-mobile-trade-launcher` + `__row`, `__button`, `__pill`, `__pill--yes`, `__pill--no`). Fixed at bottom, hidden on desktop, hidden when modal is open, honors `env(safe-area-inset-bottom)` for the iPhone home indicator. Body picks up `padding-bottom` via a `:has(.hz-mobile-trade-launcher__row)` rule so the last bit of page content doesn't sit under the bar. Background ramps from transparent at top to solid `rgb(2,8,19)` by 60% of bar height plus `backdrop-filter: blur(14px)` — content scrolling behind it stays legible through the fade-in but is decisively cut off under the pills (a translucent overlay made the pills feel ghostly and the rules text bled through).
- **Binary markets only**: split Yes/No pill duo (Polymarket / Kalshi pattern). Each pill carries the side label + live price and pre-selects that side on tap before opening the modal. **Multi-outcome markets get no launcher** — with 4+ outcomes a single-CTA chip doesn't carry enough info to be useful (you'd still need to pick an outcome inside the modal), so the bar is hidden entirely. The `renderMobileTicketLauncher` function is a no-op for multi-outcome consumers; the `:not(:has(.__row))` CSS rule on the launcher container then collapses both `display` and the body's bottom-padding reservation so multi-outcome pages don't waste any vertical space on a phantom bar.
- Click wiring uses event delegation on the mount (`[data-market-detail-mobile-ticket-open]`) so the same handler routes both variants. The optional `data-mobile-launcher-side` attr on binary pills triggers `state.contractSide = "yes"|"no"` + `state.orderSide = "buy"` + `renderAll()` before opening — so the modal shows the side the user actually tapped, not whatever was last selected.

The renders live in `mobile-ticket.js`: `renderMobileTicketLauncher(modeConfig)` for the single-CTA variant and `renderBinaryMobileLauncher({ yesLabel, yesPrice, noLabel, noPrice })` for the split-pill variant. The binary trade ticket calls the latter from its `renderTicket()` cycle so prices stay in sync with the rail.

### 2. Chart footer flow (mobile)

At ≤767px the `.hz-chart__stats` row (volume / closes / status) was using `flex-wrap: wrap` with no `justify-content`. Each stat dropped to its own line with trailing dead space whenever its width exceeded one column.

Fix: lay the stats out as a 2-column grid (`grid-template-columns: minmax(0,1fr) minmax(0,1fr)`). Volume + closes pair compactly on row one; the status stat spans the full row two via `:has(.hz-chart__stat-icon--status)` so its dot+label aren't squeezed.

Critical detail: also reset `flex: 0 0 auto` on the stats element at mobile. The desktop rule sets `flex: 1 1 18rem` on `.hz-chart__stats`, and inside the mobile flex-column footer that grow factor would stretch the grid vertically — producing ~200px of empty space between the chart canvas and the time-filter row. The `align-self: stretch` keeps the grid spanning the footer's width.

### 3. Viewer-positions panel rhythm (both viewports)

The 7-column grid had loose `minmax(7rem, 1.1fr)` cells with a uniform `0.9rem` column gap, so values drifted apart at desktop. Restructured so:

- Tighter `minmax` mins per column reflect the actual value widths (3rem for qty, 3.5rem for currency cells, 5rem for the return punchline).
- Group separators via `padding-inline-end` on cells 1, 3, 5 — visually splits `side | qty avg-cost | mark cost-basis | return | actions`.
- Header row + each data row carry a `border-bottom: 1px solid var(--hz-border-faint)` so the rows scan like a table without needing a full chrome.
- The return cell is now `inline-flex; align-items: baseline; gap: 0.34rem` — primary value and percent sit side-by-side on one line instead of stacking. Slightly larger primary font weights the punchline.
- Mobile (≤767px): cards layout keeps the side label as the title row, return as the punchline (full width, larger), and stretches the actions to fill the row.
- Mobile labels: the desktop column-header row hides on mobile; instead, each cell shows its own label *above* its value as a caption. The label switches from mono+uppercase (which spread Hebrew letters apart awkwardly) to UI font, normal case, soft color — caption-style. Easier to scan in Hebrew at small width.

### Files touched

New:
- `patterns/mobile-trade-launcher.css`

Modified:
- `patterns/chart.css` — mobile stats grid
- `patterns/viewer-positions.css` — column rhythm + return baseline + mobile cards
- `pages/market-detail.html` — launcher mount + cache busters
- `pages/market-detail/shell.js` — `mobileLauncherMount` ref
- `pages/market-detail/mobile-ticket.js` — render the launcher DOM (single + binary variants), delegated aria-expanded
- `pages/market-detail/components/binary-trade-ticket.js` — call `renderBinaryMobileLauncher` from `renderTicket()` with live prices
- `pages/market-detail.js` — delegated launcher click handler, binary side pre-select before open

### Mobile follow-up pass (same slice, second round)

After running the page through the iPhone 14 Pro profile in Playwright, three more spots broke down at 393px and got addressed:

**4. Action-icon row (≤767px) collapses to bookmark + share only, inline with the title.** The 4-icon row (bookmark / share / comment / download) was crowding the title at phone widths AND it consumed a full row of vertical space below the title. Two changes:
  - **Filter**: drop comment + download. Comment is redundant (the comments section lives on the same page, scrollable); download is a desktop-only export use case. Both hidden via CSS selectors keyed off `data-topbar-action="download"` and `a.hz-icon-action[href="#comments-section"]`. JS unchanged — the icons still render in the DOM, they just don't display on mobile.
  - **Placement**: keep the mobile head-grid as a 2-column grid (`minmax(0,1fr) auto`) instead of stacking, so the two remaining icons sit at the top-end corner of the title block (visually top-left in RTL). Saves ~50px of vertical real estate above the fold and matches the convention from Polymarket/Kalshi.

**5. Chart metadata strip (≤767px) collapses to one inline `·`-separated line.** Three loose stat pills (volume / closes / status) read as disconnected at small width. New mobile rule: flex-wrap row with interpunct separators between adjacent stats (`.hz-chart__stat + .hz-chart__stat::before { content: "·" }`), muted color + smaller font. Reads as a single subtitle under the chart — Polymarket / Kalshi pattern.

**6. Community header (≤767px) breaks into row stack.** The `.hz-social-head` desktop 2-column grid (title block | tabs) was pushing the 4 tabs into a cramped right edge. On mobile: title row alone, then tabs row alone as a `grid-template-columns: repeat(4, 1fr)` equal-width strip with `text-overflow: ellipsis` for label safety. The "טופ מחזיקים" tab label was renamed to "מחזיקים" to fit. The filter-pill row under the comments tab gets a small top margin to breathe instead of competing for inline space.

Files added in this pass:
- `pages/market-detail.css` — mobile action-icon hide rules
- `patterns/chart.css` — mobile stats inline-flow rules (replaces the earlier 2-col grid)
- `patterns/comment-feed.css` — page-scoped mobile overrides at the end of file
- `pages/market-detail/community.js` — tab label rename

## Positions panel — card-row restructure (2026-05-18)

The viewer-positions panel was originally a 7-column "table" with faint inter-row borders. Three problems on a sweep:
- Row separators were so faint they disappeared against the dark background — rows didn't read as distinct objects.
- 7 columns spread values too far apart at 1280px+ — eye had to traverse a long horizontal line per row, with no anchor.
- Avg-cost-per-share (`עלות מ׳`, V₪ 0.51) and total cost-basis (`עלות`, V₪ 20) looked visually identical despite being very different numbers — confusing.

Switched to the **Polymarket card-row pattern**:

- Each position renders as a self-contained card (`<article class="hz-viewer-positions__card">`) with a subtle raised background + soft border + rounded corners. The card surface itself provides the row boundary — no inter-row hairlines.
- Above the cards: a **column-header strip** (`.hz-viewer-positions__columns-header`) shares the cards' grid template so each label sits exactly above its column. Without the headers, the numbers floated without anchors — the eye couldn't tell avg-price (V₪ 0.51) from mark-value (V₪ 22) without parsing the format. With the headers, the values become scannable. The strip is mono+uppercase+faint — table-header style.
- Six cells per card (5 data + 1 actions), matched 1:1 to the header labels:
  1. **Side** (`תוצאה`) — `● כן` / `● לא` (color-coded label with dot)
  2. **Qty** (`כמות`) — share count
  3. **Avg cost** (`עלות מ׳`) — entry price per share, slightly softer than mark
  4. **Mark value** (`שווי`) — current worth, slightly bolder
  5. **Return** (`תשואה`) — `+V₪ 2  +11.6%` (color carries sign; weight + size carries punchline emphasis)
  6. **Actions** — `[מכור]` + `[↗]` (sell button + share icon-stub)
- Dropped `cost-basis` (it's `avg × qty`, derivable, and was the source of the avg/cost confusion in the original 7-column layout).
- **Side accent bar**: a 3px-wide colored bar at the card's inline-start edge (logical property so it lands on the visually correct side in both LTR and RTL). Tints the card in its side color (green for Yes, red for No) without flooding the whole surface.

The shared grid template is centralized as a CSS custom property `--hz-positions-cols` on the wrapper, used by both the header strip and the cards. Single source of truth — change the column rhythm in one place and both rows update together.

Mobile layout (≤767px): the column-header strip hides; the card uses `grid-template-areas` to re-flow internals into a 3-row stack:
- Row 1: side label (start) + return punchline (end) — the "headline" of the position
- Row 2: qty + avg + mark value (the math, packed inline)
- Row 3: actions stretched, `[↗]` as a narrow chip + `[מכור]` as the wide primary

Since the column-header strip is hidden on mobile, **pseudo-element captions** reintroduce context inline: the avg cell gets a leading `@` glyph (so `39 @ V₪ 0.51` reads as a phrase), and the mark cell gets a leading `שווי` caption.

This restructure touched:
- `components/viewer-positions.js` — new card markup, column-header row, six cells per card with explicit BEM modifiers per cell (`--side`, `--qty`, `--avg`, `--mark`, `--return`, `--actions`)
- `patterns/viewer-positions.css` — full rewrite around `.hz-viewer-positions__card` + shared `--hz-positions-cols` CSS variable, mobile `grid-template-areas`, mobile-only pseudo-element captions

## Resolved layer — slice 1 (2026-05-20)

Spec: [`2026-05-20-market-detail-resolved-layer-design.md`](../../../../workspace/docs/history/superpowers-archive/specs/2026-05-20-market-detail-resolved-layer-design.md).

The page previously treated a resolved market as a `display: none` swap — trade buttons dimmed, a small `הוכרע` pill flipped, the hero swapped to a one-line verdict, and everything else rendered as if the market were mid-flight. Resolution is the page's reason to exist, so we made it loud.

### Slice 1 surfaces

Four locked product decisions (active claim · trading disabled · verdict-only rail for no-position viewers · chart opens to `ALL`). This slice ships the surfaces that don't need new backend data:

1. **Rail verdict block + earnings card** — replaces the trade ticket in `data-market-detail-order-shell` when `snapshot.marketStatus === "resolved"`. Three viewer states:
   - **Won** — verdict block + per-position payout table + `קבל את הזכייה` green claim CTA. Total at the bottom in accent green.
   - **Lost** — verdict block + a single quiet `הפסדת · <outcome> · <side> · <shares> מניות` line. **No** `₪0.00` table, **no** dead CTA. The Polymarket reference shows a full "Your Earnings" panel even for losing positions (`Position 5,048 Yes · $0.00 · Claim winnings` greyed) — we refuse that. The dead button reads cruel.
   - **No position** — card omitted entirely; verdict block alone fills the rail head.

2. **Outcome ladder per-row chip** — winner row carries `כן ✓` in accent green; loser rows carry `לא ✗` in danger red and drop to `opacity: 0.55`. Trade buttons, probability values, sparkline column are all removed (not just disabled). Toolbar + column-head row are skipped entirely — no "buy/sell" choice exists, no probability axis to label.

3. **Timeline terminator** — the third stage's label flips from `תשלום` to `תוצאה סופית` and its value becomes `<winner> · <date>` (clock stripped — the date is the story, the minute isn't). The Polymarket reference ends its pill chain with `Final outcome: No` instead of `Awaiting`; we ported the move directly.

4. **Duplicate verdict removal** — pre-slice the page rendered the verdict in three places: the rail (open-state ticket disabled), the probability hero (`נפתר → לא · date`), and the rules section (`הוכרע · לא · date` pill above the cards). With the new rail verdict, both the hero and the rules-section pill become noise. Hero now renders empty on resolved; rules-section drops the `.hz-resolution-note` block. Rules cards (the audit trail) stay.

### What's *not* in slice 1

Per the spec, deferred to later passes:
- **Slice 2:** chart resolution marker (vertical dashed rule at the resolved-at timestamp) · rules section terminal banner · status pill widening to carry the outcome label · "Your result" chip in the hero
- **Slice 3 (backend-gated):** diagnostic strip below the claim CTA — `קנית את 'כן' ב‎42¢‎ — השוק היה ב‎56¢‎. הקדמת את הקהל.` Requires a market-lifecycle average mid-price; backend ask filed when the slice opens.

### Plasters in the implementation

Two knowing client-side inferences that should delete when backend ships the proper shape:
- **Per-outcome `finalValue`** is computed from `result.winner.outcomeId` (winner = 1.0, losers = 0.0). Delete when the snapshot carries explicit per-outcome final values.
- **Per-viewer `claimStatus`** defaults to `pending` and the claim CTA currently no-ops. Wire to the backend claim endpoint when that handoff lands (parked in `workspace/coordination/inbox.md`).

Plaster markers live next to the code in `market-detail.js renderResolvedRail`.

### Fixture and test access

`market-detail-seed-data.js` carries a `mar-18-resolved` snapshot spread from the base mar-18 with resolved metadata overlaid. URL: `market-detail.html?market=bank-israel-mar-18-resolved&source=local`. The `?source=local` flag is new — see `market-detail-backend-adapter.js`; it short-circuits to the seed fixture without calling the backend, used for design probes against fixtures the backend doesn't know about (which would otherwise 404 + cache null and kill the page).

### Files touched

- `pages/market-detail.html` — adds the `resolved-rail.css` link
- `pages/market-detail.js` — `renderResolvedRail()` + `buildResolvedViewerSummary()` + dispatch hook in `renderTicket()`
- `pages/market-detail/components/outcome-ladder.js` — resolved branch (per-row chip, toolbar + head skipped)
- `pages/market-detail/components/probability-hero.js` — clears `heroMount` on settled markets
- `pages/market-detail/components/trust-sections.js` — drops the `.hz-resolution-note` pill; timeline terminator label + value flip on resolved
- `pages/market-detail-backend-adapter.js` — `?source=local` short-circuit
- `data/market-detail-seed-data.js` — `mar-18-resolved` fixture + market-key mapping
- `patterns/resolved-rail.css` — new pattern: rail card with verdict + earnings + claim variants
- `patterns/outcome-ladder.css` — resolved row modifiers (winner accent, loser dim, chip styles)

## Chart redesign — Phase 2 (2026-05-29)

Spec: [`2026-05-26-market-detail-chart-redesign.md`](../../../../workspace/docs/superpowers/specs/2026-05-26-market-detail-chart-redesign.md). Stage proof shipped Phase 1 across May 26-27; Phase 2 (live integration) shipped 2026-05-29.

The old `pages/market-detail/components/probability-chart.js` (smooth interpolation, 3 ranges, page-state-coupled, no settings, no token integration) replaced by a three-layer architecture: pure renderer + full-card wrapper + future sparkline. Only L1 and L2 ship now; L3 lands when trending/portfolio adopt the chart.

### Architecture

**L1 renderer** at `components/probability-chart-renderer.js`. Receives `{ seriesByOutcome, palette, settings, dimensions? }`, mounts SVG into a host node, returns `{ applyHover(clientX), clearHover(), destroy() }`. Owns step interpolation, hover crosshair with past/future dim split (clip-path), end-of-line dots, adaptive X tick spacing, adaptive Y domain. Zero chrome, zero state object reads, zero fetching. Reusable for the planned sparkline.

**L2 wrapper** at `components/market-detail-chart.js`. Mounts into an empty host div via `HzMarketDetailChart.mount(hostNode, { marketKey, palette, fetchHistory, marketMeta })`. Builds the chart-card DOM (top legend, SVG wrap, footer with controls + stats), owns the polling loop, line picker state, settings menu, range URL persistence, settings localStorage persistence. Calls L1 for the canvas. Returns `{ destroy, setMarket, setPalette, setMeta, refresh }`.

**Page integration** in `market-detail.js`. `mountChart()` reads `--chart-line-1..4` from `:root` via `getComputedStyle`, builds a `fetchHistory(marketKey, range)` callback that delegates to `backendAdapter.readRemoteHistory`, extracts `marketMeta` from `snapshot.lifecycle.openAt` + `volumeLabel` + `closeLabel` + status, calls `mount()` once. On every snapshot update, page calls `_chartHandle.setMeta(extractMarketMeta(...))` to push fresh footer chrome and `_chartHandle.refresh()` to force a history fetch (so a user's own trade lands on the chart immediately rather than waiting for the next poll tick).

### Locked design decisions

13 decisions locked in spec including step interpolation (rejected smooth — too smoothing-by-default for sparse markets), 4-line cap with picker, 6 ranges (1H/6H/1D/1W/1M/ALL) with tick spacing adaptive to actual data span not the range key, Kalshi-style hover (single crosshair + past/future opacity split, no per-line scrubbing), Lift palette (`#4a98ff` blue / `#ff7e5c` coral / `#2dd2a0` mint / `#ff5fa3` rose — green-red semantics avoided, second-blue replaced with mint, brand-gold lane kept clear), range-aware polling (10s/15s/30s) + visibility guard, autoscale-on default, settings gear with 5 toggles.

### Autoscale move (lifted from Polymarket / Kalshi)

Three layered rules in `computeYDomain`, all gated behind `settings.autoscaleY`:
1. **Outlier-resistant bounds.** For ≥50 points, use 2nd/98th percentile instead of literal min/max. Drops single-point seed artifacts (e.g. an outcome briefly initialized at 100% before trading kicked in) without losing real sustained spreads.
2. **Anchor to natural baseline.** Data all below 50% → floor `lo` at 0 ("how far above impossible"). Data all above 50% → ceiling `hi` at 1 ("how far below certain"). Data crosses 50% → free autoscale (the spread *is* the context). Skips the "compressed band of overlapping lines floating mid-canvas" failure mode for multi-outcome markets.
3. **Min 20pp domain width.** Below ~20pp of vertical room, probability lines tend to read as indistinguishable to the eye. Expands the autoscaled domain symmetrically around the data center when narrower than 20pp, clamped to `[0, 1]`.

SVG `overflow: hidden` ensures off-domain outlier points (the dropped 1.0 spike from rule 1) don't leak above/below the chart card.

### Identity-locked color slots

Old chart assigned line color by rank-of-selected (post-filter index). Adding a 4th outcome reshuffled every existing line's color — confusing UX ("the orange line just became green"). Fixed via `state.colorSlotByOutcomeId` Map. Once an outcome claims a palette slot, it keeps it until deselected. New outcomes take the lowest free slot, never displace. Stable across toggles, palette swaps, and range changes; cleared on market switch.

### Animation only on state change

Line picker's slide-in fill on selection runs only on outcomes that flipped unselected → selected since the last render — not on every render. Tracked via `_prevSelectedSnapshot` Set. Earlier the animation replayed on every render so adding one outcome caused all four chips to re-animate together. Now only the diff animates.

### Footer single-row with asymmetric priority

Controls cluster (range tabs + line picker + gear) is the primary affordance — users interact with it. Stats (volume / close-date / status pill) is read-only context. When space gets tight, stats yields (`flex: 1 1 auto` + `min-width: 0`), controls hold (`flex-shrink: 0`). `flex-wrap: nowrap` on the footer. Earlier the footer wrapped to two rows whenever range-tab label widths nudged content over the threshold; the new asymmetric flex rules encode the priority directly. Each individual `.chart-card__stat` carries `white-space: nowrap` so the squeezed stats group wraps between stats, never breaks text mid-stat.

### Footer chrome demotes by viewport

Mobile compresses the footer to a single short row that mirrors Polymarket's pattern — one informative chip on the left, the controls cluster on the right, a wide empty middle. What the mobile media query drops vs keeps:

- **Dropped — close-date stat.** Already shown prominently in the timeline section below the chart.
- **Dropped — status pill.** The trade ticket fixed to the bottom of the page is itself the "open for trading" signal by being present and active. Showing the pill in the footer too is duplication.
- **Dropped — stat label prefixes** (`נפח מסחר:`, `מסתיים ב-`). Icons carry meaning at the smaller scale.
- **Dropped — line-picker label** (`קווים · `). Just `4/10` next to the picker glyph. Saves ~30px in the controls cluster — the difference between fit and overflow on multi-10.
- **Kept — volume** by default. The volume number is the single most informative read-only stat for the chart.
- **Swap — NEW pill replaces volume when present.** Implemented via `:has()` — `.chart-card__stats:has(.chart-card__new-pill) .chart-card__stat:has(.chart-card__stat-icon--volume) { display: none; }`. Freshness is a one-of-a-kind chart signal worth carrying; the volume number is already on the page hero, so when both want the same slot, NEW wins.
- **Kept — range tabs / line picker / settings gear.** Affordances unique to the chart; the page can't show them.

Footer drops from 84-99px (original wrapping disaster) to 36-47px (single short row). Specificity note: the status-pill hide rule needs a compound selector `.chart-card__stats .chart-card__status-pill` to beat the base `.chart-card__status-pill { display: inline-flex; }` rule that sits later in the file. Source-order cascade with same-specificity rules makes the base win otherwise.

### Footer reads as Poly's — items hug edges, empty middle

The desktop footer originally read as "stretched across the full width" — items inside each group drifted apart from each other even though the groups sat at opposite edges. Three changes pulled the items back together:

- `chart-card__stats { flex: 1 1 auto → 0 1 auto }`. This is the load-bearing change: with `flex-grow: 1`, the stats group absorbed all empty space and let its items spread apart. Switching to `flex-grow: 0` means stats sits at content width and lets the footer's `justify-content: space-between` create the middle gap instead of the stats group consuming it.
- Stats gap `0.95rem → 0.65rem` and range-tab gap `0.3rem → 0.1rem` and range-tab padding `0.32rem 0.7rem → 0.32rem 0.55rem`. Items within each group sit tightly together; the group reads as one tight bundle, not a row of independent chips.
- Empty middle gap measured on a 847px desktop card went from ~30px to 101px after these changes — matches Poly's footer proportion.

### Dropdown anchor

Both `.chart-card__line-menu` and `.chart-card__settings-menu` use `inset-inline-start: 0` (anchor to the button's inline-start edge — visually *right* in RTL) so menus open into the chart area, not off the page edge. Previous `inset-inline-end: 0` pushed menus rightward off the viewport whenever the chart panel sat near the right boundary.

### Token integration

`base/tokens.css` adds `--chart-line-1..4` (Lift palette) plus three chart-namespaced surface aliases — `--chart-grid` → `--hz-border-faint`, `--chart-axis-text` → `--hz-text-muted`, `--chart-crosshair` → `--hz-border-strong`. The aliases bridge the chart pattern files (authored against stage-local short names) to the platform's `--hz-*` system without rewriting every rule by hand.

### Adapter seam restored

`market-detail-backend-adapter.js` exposes `readRemoteHistory(marketKey, range)` on its public API. The L2 wrapper's `fetchHistory` delegates through this seam instead of hand-building URLs and calling `window.fetch` directly. Single source of truth for backend history shape, URL pattern, range-limit policy, auth session, and base-URL resolution.

### NEW pill from lifecycle, not data

Wrapper previously inferred market age from `computeMarketAgeMs(currentRangeData)` — the earliest point in the chart's *visible window*. On 1H this collapsed to "1 hour ago" → always under the 7-day threshold → always NEW. Fix: page reads `snapshot.lifecycle.openAt`, passes as `meta.openedAtMs`. Wrapper uses that; falls back to data-window heuristic only when meta is absent (stage / no-snapshot context). Pill also suppressed entirely when `meta.isResolved` — "new" is meaningless once a market has decided.

### Persistence

Range tab persists in URL as `?range=X` (`history.replaceState`, no back-button accumulation). Settings persist in `localStorage["hzChartSettings"]` (JSON). Range chosen for URL because it's contextual to the moment — sharing a link means "look at this timeframe with me." Settings chosen for localStorage because they're personal preferences that should follow a user across markets, not contaminate shared links.

### Plasters in the implementation

- **Empty-state seed** — `seedFlatPoints` draws flat lines at 1/n probability when `isEmptyHistory(series)` is true. Renders structure where there is none. Delete when backend ships a proper initial-distribution shape, or accept as a renderer concern (the wrapper currently does this before passing data to L1, so the renderer stays pure).
- **Dead page state fields** — `state.activeTimeframe`, `state.chartOutcomeIds`, `state.chartLineMenuOpen`, `state.activeChartIndex` still mutated by old code paths in `market-detail.js` but never read. The new wrapper owns these concerns. Delete in a cleanup pass once Phase 2 has soaked.

### Files touched

- `pages/market-detail.html` — swapped `chart.css` link for `probability-chart.css` + `market-detail-chart.css`; swapped `probability-chart.js` script for `probability-chart-renderer.js` + `market-detail-chart.js`; bumped `probability-hero.js` cache version
- `pages/market-detail.js` — `mountChart()` + `_chartHandle` module state; `makeFetchHistory` delegates to adapter; `extractMarketMeta` reads `lifecycle.openAt`; `renderChart` calls `setMeta` + `refresh`
- `pages/market-detail-backend-adapter.js` — `readRemoteHistory` added to public exports
- `pages/market-detail/components/probability-hero.js` — `buildRoiMarkup` gutted to return empty (ROI chip removed)
- `assets/js/components/probability-chart-renderer.js` — NEW, L1 pure renderer
- `assets/js/components/market-detail-chart.js` — NEW, L2 chart-card wrapper
- `assets/css/patterns/probability-chart.css` — NEW, renderer-owned styles
- `assets/css/patterns/market-detail-chart.css` — NEW, wrapper chrome styles
- `assets/css/base/tokens.css` — `--chart-line-1..4` + chart-namespaced aliases
- **DELETED:** `pages/market-detail/components/probability-chart.js`, `patterns/chart.css`

### What's *not* in this slice

- Chart resolution marker (vertical dashed accent rule + `הכרעה` label at `resolvedAt`) — still P2 of the resolved-layer spec, deferred
- L3 sparkline component — built when trending / portfolio adopt the chart
- ~~Stage retirement — `stage/chart-design.html` snapshot-to-history pending a few days of soak~~ — **retired 2026-05-31** (deleted; chart work shipped end-to-end, see commit log)
- ~~Binary canonical-only vs Yes+No race-view — current behavior shows both lines; revisit if the race-view reads as visual noise to real users~~ — **resolved 2026-05-29** (single canonical line + area fill; see "Binary chart redesign" section below)

## Resolved layer — slice 2 (2026-05-29)

Spec: [`2026-05-20-market-detail-resolved-layer-design.md`](../../../../workspace/docs/history/superpowers-archive/specs/2026-05-20-market-detail-resolved-layer-design.md). Slice 1 shipped 2026-05-20 (rail verdict + earnings card + outcome-ladder chips + timeline terminator). Slice 2 completes the chart-side of the layer and tightens the verdict-surface count through a polish pass.

### What the slice ships

**1. Chart endpoint glyph terminators (replaces the spec's vertical dashed marker).** Omri surfaced Kalshi's pattern as a cleaner alternative — a per-line glyph at the end-of-line dot beats a single vertical rule across the canvas because each line carries its own verdict, not just "the market resolved at this time." Winner's end-dot gets a white ✓ glyph overlaid on a slightly enlarged colored circle (white outer stroke for emphasis); losers get a white ✗ on the same colored-circle base (opacity 0.85 so they recede). Line colors preserved so per-line identity holds.

Implemented in L1 via a new optional `resolutionState: { winnerOutcomeId }` option to the renderer. When absent, end-dots stay plain. The wrapper derives this from `state.marketMeta.isResolved && state.marketMeta.winnerOutcomeId`.

**2. Default chart range = `all` on resolved.** Spec Decision 4 — the page is a debrief, the lifecycle arc is the story. Page reads `snapshot.marketStatus === "resolved"` at mount and passes `initialRange: "all"` to `HzMarketDetailChart.mount()`. **Canonical key is lowercase `"all"`, not the display label `"ALL"`** — passing the label silently routes to a no-op range; this was caught by spec-compliance review before commit. URL `?range=X` still wins the resolution order, so shareable links remain functional.

**3. Binary mobile floating outcome chip.** Replaces the open-state Yes/No pill row in the sticky-bottom mobile launcher slot with a single centered `✓ הוכרע: <winner>` chip. Implementation: `renderBinaryResolvedLauncher({ winnerLabel })` on the mobile-ticket controller, called from `renderResolvedRail` when `binaryTradeTicketComponent` is present. Mobile-only by inheritance from the launcher's existing CSS scope (hidden ≥960px). Desktop binary still gets the rail verdict block doing the same job; multi-outcome layouts unchanged — their outcome ladder ✓ on the winning row is the equivalent indicator.

### What we built and then pulled (intentional)

Two surfaces from the spec's deferred list were implemented, eyeballed alongside the rail block + chart endpoint glyphs, and removed in the same slice run:

- **Chart-card status pill widening** (`הוכרע · <winner>` with info-blue accent on a `--resolved` variant). Read as the fourth surface saying the same thing — already covered by the rail block, the chart endpoint glyph, the outcome ladder chip, and (for binary mobile) the new floating chip. `extractMarketMeta` now returns `statusLabel: null` for resolved markets so the wrapper hides the pill entirely. The `:not(--resolved)` qualifier on the mobile hide rule got simplified back to a plain hide.
- **Rules section terminal banner** (`✓ התוצאה: <winner> · הוכרע ב-<date>` above the rules cards). Same diagnosis — the rules section is supposed to be the quiet audit trail, not a fifth verdict surface. Terminal banner removed from `trust-sections.js`; CSS block removed from `rule-card.css`.

The design move: **verdict surfaces have a budget.** Slice 1 shipped 3 (rail verdict block + outcome ladder ✓ + timeline terminator). Slice 2 added 2 more before realizing 5 was past the budget — the eye couldn't help but read each one and the page felt like it was insisting. After the cut: 3 stable surfaces (rail + chart endpoint glyph + outcome ladder ✓), with binary mobile getting a 4th anchored chip because it's a layout-specific affordance. The "Your result" chip in the hero, also speced, was never built — the rail earnings card already carries it.

### Spec → shipped contract changes worth naming

- Resolution-marker shape changed (vertical dashed → per-line endpoint glyph). Spec wins on intent ("mark the resolution moment"); Kalshi reference wins on execution.
- Status pill widening + rules banner removed entirely from the slice deliverables (spec list reduced).
- Binary mobile floating outcome chip added (not in spec, surfaced from Omri's Polymarket reference mid-slice).

### Code quality refactors that came with the slice

- Date-strip helper `stripTimeFromResolvedLabel(raw)` factored at IIFE level in `trust-sections.js`. Previously duplicated between the (now-removed) rules banner and the still-shipping timeline terminator — extracted so the next format tweak doesn't drift between two surfaces.
- ES2015 shorthand on `resolutionState` in the wrapper.
- Mount-time-only `isResolved` check explicitly documented as intentional UX: if a market resolves mid-session via lifecycle event, the chart stays on the user's current range rather than snapping to `all` beneath their finger.

### Files touched

- `assets/js/components/probability-chart-renderer.js` — `resolutionState` option + endpoint-glyph rendering branch
- `assets/css/patterns/probability-chart.css` — `.end-dot--winner` (outer stroke) + `.end-dot--loser` (opacity 0.85) + `.end-dot-glyph` (white ✓/✗ centered)
- `assets/js/components/market-detail-chart.js` — derives `resolutionState` from meta, passes to renderer
- `assets/css/patterns/market-detail-chart.css` — removed `.chart-card__status-pill--resolved`; mobile hide rule simplified back to plain
- `pages/market-detail.js` — `extractMarketMeta` extracts `winnerOutcomeId` + returns `statusLabel: null` on resolved; `mountChart` passes `initialRange: "all"` on resolved; `renderResolvedRail` calls the binary mobile chip
- `pages/market-detail/components/trust-sections.js` — `stripTimeFromResolvedLabel` helper; terminal banner block removed
- `pages/market-detail/mobile-ticket.js` — `renderBinaryResolvedLauncher({ winnerLabel })` added to the controller exports
- `patterns/mobile-trade-launcher.css` — `.hz-mobile-trade-launcher__row--resolved` + `__outcome-chip` + `__outcome-check` for the centered floating chip
- `patterns/rule-card.css` — terminal banner block removed (the four `.hz-rules-terminal-banner*` rules)
- `pages/market-detail.html` — cache busts (`?v=resolved-slice-2c`)

### What's still parked (P3)

The diagnostic strip (`קנית את "כן" ב‎42¢‎ — השוק היה ב‎56¢‎. הקדמת את הקהל.`) remains backend-gated on a market-lifecycle average mid-price. No movement this slice.

## Binary chart redesign (2026-05-29)

Two mirror lines (canonical side + non-canonical side, mathematically summing to 100%) collapsed to a single canonical-side line, with visual weight added to make the surviving line feel alive instead of bare.

### The design move

**Redundant signal removal.** The non-canonical line carried no new information — `No 62%` is just `100% - Yes 38%`. The chart canvas was doing visual work twice for the same data. Dropping it cleans the canvas; the page hero, Y-axis, and area fill below the canonical line carry the meaning without repetition.

**Visual weight compensates for the lost second line.** A thin single stroke floating against a dark canvas reads as fragile. Three additions restore presence:

- **Area fill below the line.** Vertical linear gradient — line color at 0.18 opacity at the top, 0 at the chart floor. Defined inline as `<linearGradient>` per series via `<defs>`, gradient ID = `area-grad-<variantId>-<si>` so multiple chart instances don't collide. The line stops feeling like a stroke and gains "mass." Implemented as a closed path: stepPath trace → line to bottom-right corner → line to bottom-left corner → close (`Z`).
- **End-dot live glow.** A `.end-dot--live` class applies `filter: drop-shadow(0 0 6px currentColor)` — a quiet halo, no animation. The end-dot reads as the "live tip of the line," the now-state of the data.
- **Resolution glyph wins.** When the chart is resolved, the endpoint glyph (✓ winner / ✗ loser from slice 2) takes the dot slot; no live-glow on top of a glyph. Verdict beats vitality — the question is settled.

**No legend at all.** Initially the slice landed with a primary chip + dimmer satellite (`[● Yes 38%] · No 62%`); after looking at it, dropped entirely. The probability hero above the chart already shows `38% סיכוי`, the Y-axis labels carry the scale, the line + area fill carry the shape. A chip on top is a third surface of the same info — the chart-card's `.chart-card__legend:empty { display: none }` rule collapses the slot.

**No color shifts by value or direction.** Resisting the easy move of coloring the line green when high and red when low — that's the no-green/red-semantics rule from the chart redesign spec. Color encodes "this is the data," not "this is the good outcome." The data's direction is its own story; we don't editorialize.

### Hover behavior

The chart shows one line, but hover is the moment of full interrogation — the tooltip carries the pair. In binary mode the renderer accepts a `complementLabel` (the non-canonical side's display label) and renders a second dimmed value row below the primary: `<complementLabel> <100 - canonical_value>%`. The user sees what the canonical line literally shows AND what the complement implies.

### Architecture

**L1 renderer additions:**
- `areaFill: boolean` option (default false). Gates gradient defs, area path rendering, and the `.end-dot--live` class on the end-dot.
- `complementLabel: string | null` option. Renders the second tooltip row when truthy AND `projected.length === 1`. Empty-string is coerced to null (treated as absent).
- Single-point guard: area path requires `s.plotted.length >= 2`. A single-point series has no horizontal span to anchor an area against; the end-dot still renders for the single point.
- When `areaFill: false` (multi-outcome path), all area/gradient/glow logic is bypassed via guards.

**L2 wrapper additions:**
- Module-level `_isBinaryMode(series, canonicalOutcomeId)` helper: `!!canonicalOutcomeId && series.length === 2`. Consumed by both `_renderChart` and `_renderLegend` — single source of truth, can't drift.
- In binary mode, `_renderChart` filters `selectedSeries` down to the canonical-outcome series only, passes `areaFill: true` + `complementLabel: <non-canonical's display label>` to the renderer.
- In binary mode, `_renderLegend` returns early with no chips rendered.
- Defensive fallback: if `canonicalOutcomeId` doesn't match any series in the selected set (race condition, data shape skew), falls through to multi-outcome rendering rather than showing an empty chart.

**Page integration:**
- `extractMarketMeta(snapshot)` adds `canonicalOutcomeId: getCanonicalOutcomeId()` — the existing market-model helper (already destructured at the page-script top). Returns null for non-binary markets; the wrapper's binary-mode detection handles null cleanly.

### Multi-outcome regression

Verified by DOM probe at multi-10: `areaPaths: 0`, `liveDots: 0`, `lines: 8` (4 series × 2 passes for the past/future opacity split). Multi-3 and multi-10 codepaths take `areaFill: false`, skip the gradient/area/glow blocks, and render identically to pre-slice.

### Files touched

- `assets/js/components/probability-chart-renderer.js` — `areaFill` + `complementLabel` options, gradient defs block, area path construction, `.end-dot--live` class branching, complement hover artifact
- `assets/css/patterns/probability-chart.css` — `.line-area` baseline + `.end-dot--live` glow
- `assets/js/components/market-detail-chart.js` — `_isBinaryMode` module helper, binary-mode branch in `_renderChart`, early-return in `_renderLegend`
- `assets/css/patterns/market-detail-chart.css` — `.chart-card__legend-sep` + `.chart-card__legend-satellite` + descendant rules removed (legend never renders chips in binary mode)
- `assets/js/pages/market-detail.js` — `extractMarketMeta` exports `canonicalOutcomeId`
- `pages/market-detail.html` — cache busts (`?v=binary-single-line-3`)

### Code-quality refactors that came with the slice

- `!!options.areaFill` → `options.areaFill || false` for consistency with the file's existing falsy-coercion style.
- `_isBinaryMode` extracted to a module helper (eliminated a drift surface between the two call sites).
- Single-point area-path guard added with an explanatory comment.
- Empty-string complement-label coercion documented inline.

### Trade-offs / deferred

- **CSS removal comment doesn't enumerate the deleted rules.** `git log -p` is the audit trail for what `.chart-card__legend-sep` and `.chart-card__legend-satellite` used to contain. A future reader who needs to bring them back can recover via git, not the file itself.
- **Defensive fallback to multi-outcome** when canonical ID mismatch — kept as a soft failure rather than throwing. Better than an empty chart on a race condition.
- **No live-glow animation.** A 3-4s breathing pulse on the dot was discussed; defaulted to OFF because motion that's always on becomes noise. Re-introducible as a renderer option if a future surface wants it.
- **Sparkline (L3) consumption of binary mode** — separate slice when trending/portfolio adopt the chart. The renderer's `areaFill` + `complementLabel` options are L3-friendly out of the box. *(Superseded 2026-05-29 by D3 — see Tier D log below; the L3-friendly shape is now per-series tags + `hoverExtras`, even cleaner than `areaFill` + `complementLabel` as top-level options.)*

## Tier D + cleanup sweep (2026-05-29)

A four-step architectural cleanup arc applied immediately after the binary chart redesign shipped, followed by a dead-code sweep and one bug fix. Zero visible behavior change — all moves were structural surgery to make the next thing land cheaply.

### D1 — Predicate proxy

`binaryTradeTicketComponent && doBinaryThing()` reads layout intent through accidental DOM construction. Replaced with `isBinaryLayoutMarket() && doBinaryThing()` at every call site. Layout decisions stop leaking through component-presence checks. Doctrine entry in `market-model.md`.

### D2 — `complementLabel` → `secondaryHoverLabel`

Renamed the renderer option from what produced it (a probability complement) to what it IS (a label for the secondary hover row). Sets up D3 by letting `hoverExtras: [{ label, computeValue }]` read naturally.

### D3 — L1 renderer purity restoration

The renderer had absorbed market-domain knowledge: `resolutionState`, `secondaryHoverLabel`, top-level `areaFill`. Each one was an L3-blocker — a future sparkline would either duplicate the renderer or hack around these options. Pushed all market-domain decisions back to the wrapper.

The new contract:
- Per-series tags: `endDotVariant: "default" | "winner" | "loser" | "live"` and `areaFill: boolean`
- Caller-level: `hoverExtras: [{ label, computeValue(canonicalValue) }]` — closures, not data

The renderer no longer asks "is this the winner?" or "is this binary mode?" — it dispatches on tags the wrapper sets. The wrapper makes ALL the market-domain decisions in one block:

```js
if (isResolved && winnerOutcomeId) variant = (s.outcomeId === winnerOutcomeId) ? "winner" : "loser";
else if (isSingleBinaryLine) variant = "live";
else variant = "default";
```

L3 sparkline arrives free — it just tags its single series with whatever variant + area fill it wants and reuses the L1 renderer. No new L1 options.

### D4 — Orchestrator splits

Two cohesive concerns extracted out of `market-detail.js`:

- `pages/market-detail/components/resolved-rail.js` (237 lines) — `renderResolvedRail`, `buildResolvedViewerSummary`, `buildResolvedVerdictMarkup`. The resolved-state side rail.
- `pages/market-detail/chart-integration.js` (142 lines) — `mountChart`, `renderChart`, `extractMarketMeta`, `readPaletteFromTokens`, `makeFetchHistory`, and the `_chartHandle` closure. The chart-wrapper wiring.

`market-detail.js`: 1909 → 1608 lines (D4 split + the cleanup deletions below).

### Cleanup sweep

Read-only subagent pass classified every chart-/stage-related symbol as `LIVE` / `DEAD` / `TRANSITIONAL`. Seven dead items found, all unambiguous:

- `chart-utils.js`: removed the entire X-axis label machinery (`buildLinePath`, `getChartXAxisLabels`, `VISIBLE_TICK_SECONDS_BY_TIMEFRAME`, `readPointTimeMs`, `readVisibleTickSeconds`, `findNearestPointIndex`, `buildTimeCadenceLabelIndexes`, `chooseAxisLabel`). All pre-L1/L2-architecture leftover — destructured by the orchestrator but never called. **155 lines, 274 → 100.** L1 renderer owns its own line + X-axis math now (different copy of `buildTimeCadenceLabelIndexes` lives inside the renderer; the page-side version was orphaned by the L1/L2 port).
- `market-detail.js`: removed `state.timelineOpen` (zero readers), `CHART_WIDTH`/`CHART_HEIGHT` destructure (only fed `buildLinePath` which is gone).
- `market-detail.css`: removed `.market-detail-stage-meta-row` (3 blocks) + `.market-detail-timeline-line/point/dot` (legacy timeline DOM that no JS emits anymore). **41 lines across 6 selectors + 2 mobile blocks.**

### Bug fix — sticky-sheet ritual on sell-from-position

Tapping "מכור" on the viewer-positions panel on mobile mutated all the right state (`orderSide = "sell"`, `contractSide = side`, `sellTargetOverride`) but never opened the sticky bottom sheet the ticket lives in. State changed correctly inside a hidden container. One-line fix: `openMobileTicketIfCompact()` after `renderTicket()`. On desktop the predicate gates it to a no-op.

Surfaces the **sticky-sheet ritual** — any orchestrator handler that flips ticket-internal state on mobile must either open the sheet or document why it doesn't. Three call sites follow it now (multi-outcome buy click, binary buy-pill tap, sell-from-position click). Doctrine entry in `mobile-ticket.md`.

### Spec → shipped contract changes worth naming

- **Renderer is pure** — no market-domain options. The renderer's job is "draw what each series is tagged to look like." Series tags + `hoverExtras` are the entire seam.
- **Wrapper owns the layout decisions** — `isResolved`, `winnerOutcomeId`, `isBinaryMode`, `isSingleBinaryLine` all live in the wrapper's tagging block. One place to read.
- **Predicates over component presence** — `isBinaryLayoutMarket()` not `binaryTradeTicketComponent &&`. Layout intent is not the same as DOM construction order.
- **Sticky-sheet ritual is a contract** — every state-flipping handler on mobile pays for sheet visibility.

### Files touched

- `assets/js/components/probability-chart-renderer.js` — D2 rename, D3 purity (removed `resolutionState`, `secondaryHoverLabel`, top-level `areaFill`; added per-series `endDotVariant` + `areaFill` tags + `hoverExtras` array)
- `assets/js/components/market-detail-chart.js` — D2 rename, D3 wrapper-side tag dispatch (one block computes `endDotVariant` per series; `hoverExtras` builds the complement closure)
- `assets/js/pages/market-detail.js` — D1 predicate replacement, D4 module imports + delegation, cleanup deletions (dead state field, dead chart-utils destructure, dead `CHART_*` seedData), bug fix (one-line `openMobileTicketIfCompact()`)
- `assets/js/pages/market-detail/market-model.js` — D1 helper expansion (`getWinnerOutcomeId`, `getWinnerLabel`, `isBinaryLayoutMarket`)
- `assets/js/pages/market-detail/chart-utils.js` — cleanup sweep (X-axis machinery + buildLinePath retired; 274 → 100 lines)
- `assets/js/pages/market-detail/chart-integration.js` — NEW (D4 extraction)
- `assets/js/pages/market-detail/components/resolved-rail.js` — NEW (D4 extraction)
- `assets/css/pages/market-detail.css` — cleanup deletions (`.market-detail-stage-meta-row` + `.market-detail-timeline-*`)
- `pages/market-detail.html` — script tags for two new modules, cache busts (`?v=d4-orchestrator-split` and later `?bust=cleanup-sweep` for ad-hoc QA)

### What's not in this arc

- Backend adapter sweep (`pages/market-detail-backend-adapter.js`, 764 lines). Untouched today — different lane (data adapter, not UI). Worth its own dead-query-path classification pass when next visited.
- L3 sparkline implementation. The renderer is ready for it; surfaces aren't asking yet.
- The `require([...])` helper for the 22 window-globals at the top of `market-detail.js`. Considered; rejected. The boilerplate is signal (it shows runtime dependency count at a glance) and a helper would save ~15 net lines across two consumers — not a worthwhile abstraction.
