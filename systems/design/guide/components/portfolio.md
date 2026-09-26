# Portfolio

Updated: 2026-05-19
Status: current
Owner: frontend / portfolio surface

Purpose:
- document the live authenticated portfolio surface
- keep the snapshot-first contract explicit
- prevent future sessions from turning the page into fake dashboard sludge

Read with:
- `systems/design/guide/surfaces/portfolio/README.md` (surface contract — feel, role, hierarchy)
- `systems/design/guide/component-logic.md`
- `ARCHITECTURE.md`

## This Doc Owns

- portfolio route surface ownership
- snapshot-first page contract
- optional section-read rules and fallback behavior

## This Doc Does Not Own

- shell/header behavior
- market-detail trade behavior
- backend engine truth beyond the portfolio-facing contract

Those live in:
- `systems/design/guide/components/site-shell.md`
- `systems/design/guide/components/market-detail.md`
- `ARCHITECTURE.md`

## Files

Route + style:
- `systems/design/pages/portfolio.html` — thin shell, mounts `data-portfolio-page`
- `systems/design/assets/css/pages/portfolio.css` — page-level layout + section styles

Data:
- `systems/design/assets/js/data/portfolio-page-data.js` — fixture for fallback / stage mode
- `systems/design/assets/js/pages/portfolio-data-source.js` — clean backend seam

Orchestrator + split modules (under `systems/design/assets/js/pages/`):
- `portfolio.js` — orchestrator: state, click + input handlers, paint loop
- `portfolio/formatters.js` — V₪ currency, Hebrew quantity, percent, dates
- `portfolio/view-model.js` — fixture/snapshot → normalized view shape; sort + classify helpers
- `portfolio/total-card.js` — top-right lede card renderer
- `portfolio/change-card.js` — top-left pnl card renderer (timeframe + chart)
- `portfolio/closing-soon.js` — closing-soon strip + live `<1h` countdown lifecycle
- `portfolio/claims.js` — resolved-won "נצחונות" strip
- `portfolio/positions-tab.js` — positions table (sortable columns, Polymarket-mirrored)
- `portfolio/orders-tab.js` — orders tab (honest empty state)
- `portfolio/history-tab.js` — history as sortable 3-column Activity table (סוג / שוק / סכום)

Tests (under `systems/design/test/`):
- `portfolio-formatters.test.mjs`
- `portfolio-view-model.test.mjs`
- `portfolio-closing-soon.test.mjs`

## Page Scope

Top fold (two equal cards):
- total card (right, RTL lede): account value + available cash + deposit CTA
- pnl card (left, subhead): timeframe filter + total movement + gradient chart

Below top fold:
- claims strip ("נצחונות") — renders only when there are resolved-won positions to redeem
- closing-soon strip — full-width, five columns including "אני" + "השוק" diagnostic chips.
  - The "השוק" chip names the **market leader** (top outcome + its price), not just a %. It uses
    backend snapshot fields on `contractPositions[]`: `binaryComplementOutcomeLabel` (the opposite
    side of a binary, incl. team-vs-team) and `leadingOutcome{Key,Label,Price}` (the field leader,
    for any shape incl. multi). The frontend view-model prefers `leadingOutcome`; without it,
    behind positions used to leak a bare `%`. (2026-06-23)
  - The "אני"/"השוק" chip columns are flexible `fr` tracks (not fixed rem) and the chip text
    caps + ellipsizes, so a long outcome gets room and never overflows into a neighbor.

Depth layer (tabbed body):
- positions tab — Polymarket-mirrored 5-column structure (שוק / מחיר / הושקעו / לזכייה / שווי), sortable column headers, default sort by biggest day movement
- orders tab — honest empty state by default
- history tab — sortable 3-column Activity table: סוג | שוק | סכום (mirrors Polymarket Activity structure)

Session/security card — appears in tab content when backend exposes the data; component-doc-owned, not redesigned at the surface level.

Search + tabs are inline on a single `.pf-depth-bar`. State (active tab, search query, sort column, sort direction, active timeframe) lives in the orchestrator and survives re-renders via event delegation.

## Read Contract

Primary read:
- `GET /api/portfolio/snapshot`

Optional section reads:
- `GET /api/portfolio/orders`
- `GET /api/portfolio/history`
- `GET /api/portfolio/performance?timeframe=day` on first paint
- `GET /api/portfolio/performance?timeframe=<id>` lazily when a P&L range is clicked
- `GET /api/portfolio/claims`
- `POST /api/portfolio/claims/:claimId/claim`
- `GET /api/me/sessions`
- `POST /api/me/sessions/revoke-others`

Rules:
- snapshot stays the anchor
- optional section failures do not take the whole page down
- backend truth wins when present
- do not block first paint on the full all-timeframe performance payload
- local fallback stays honest when backend mode is off
- when shared local auth/runtime config enables backend mode on `127.0.0.1` / `localhost`, portfolio should consume backend truth without requiring `?source=backend`
- `portfolio.js` must consume `NaviPortfolioDataSource.readPortfolioRecord()`; fixture rendering is fallback, not the default local truth path
- session/security read should stay compact and account-facing, not become a fake device center
- self-service session mutation should stay one-button and defensive, not become device-management cosplay
- recent security actions should stay capped and human-readable, not become a raw audit dump

## UI Contract

- keep the analyst's-study tone (defined in `guide/surfaces/portfolio/README.md`)
- keep the positions tab as the default focus
- render orders and history only from real backend payloads or explicit empty states
- do not invent fake rows for missing backend data
- keep performance readable in both chart and snapshot modes
- when history is long enough, group it by day before adding more backend surfaces
- history cards should explain what actually happened, not just dump a generic event label
- contract-side trade history should use requested-side wording first, with execution truth additive when needed
- if shared auth says `canTrade=false`, show an explicit restricted-state notice instead of leaving the page emotionally vague
- when the backend exposes self session/security truth, replace dead placeholder account copy with a real card
- when the backend exposes self session actions, keep them inside the same card as a narrow safety action
- when history/performance payloads already include summary truth, use that to sharpen the page before asking for bigger backend models
- performance chart should use backend `performance.views[timeframe].series` when present; this is currently realized-PnL movement, not a fake full-equity curve
- preserve RTL and Hebrew-first scanability

## Contract-Side Truth

- binary positions remain backed by outcome-native engine truth underneath
- portfolio should present binary activity in the language the user actually chose:
  - `קנייה כן`
  - `קנייה לא`
  - `מכירה כן`
  - `מכירה לא`
- when binary `no` executes through the opposite outcome, history should still keep the requested-side explanation and only add execution truth as supporting context
- binary positions may show a compact complement-side hint; do not pretend a second independent holdings system exists
- live multi-outcome complement trades should also keep requested-side wording first:
  - `קנייה לא על X`
  - `מכירה לא על X`
- for multi-outcome `לא`, portfolio history/performance should explain bundle execution through the non-anchor legs instead of pretending one executed outcome exists
- positions tab intentionally stays outcome-native for now; do not render overlapping synthetic `לא` assets as if they were independent holdings

## Claims / Winnings

- claims are manual user actions, not automatic UI decoration
- backend resolution creates pending winning realizations; users collect them through `POST /api/portfolio/claims/:claimId/claim`
- the claims strip renders only pending backend claims from `GET /api/portfolio/claims`
- claiming credits user cash and marks the realization claimed; do not show pretend success if the mutation fails
- historical wins before this seam are treated as already claimed by migration, to avoid double-payout

## Good Next Steps

- add browser verification for live orders/history/performance once backend smoke stabilizes
- keep the data-source seam tolerant to optional read gaps
- keep future portfolio growth on the same thin contract rather than adding local mock reducers
