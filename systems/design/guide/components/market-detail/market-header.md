# Market Detail Header

Updated: 2026-05-04
Status: current
Owner: frontend / market-detail surface

Purpose:
- reusable market identity surface for market-detail pages
- own the top market title, breadcrumbs, date rail, and utility action row
- keep orientation separate from chart/outcome/trade rendering

## Product Job

The header tells the user:
- where they are
- what market this is
- which category/context owns it
- which sibling date/market is selected

It should make the page readable before the user reaches odds or actions.

## Design Flow

Header hierarchy:
- category/breadcrumbs first, quiet
- market title second, loud and readable
- date chain underneath, separate from market identity
- utility actions secondary

Important behavior:
- desktop header starts larger
- sticky/compact behavior is CSS-owned
- long Hebrew/English mixed titles need graceful wrapping, not clipping
- date options are sibling markets, not chart timeframe controls

## Runtime Role

Runtime component:
- `systems/design/assets/js/pages/market-detail/components/market-header.js`

Current integration:
- loaded by `systems/design/pages/market-detail.html`
- called from `systems/design/assets/js/pages/market-detail.js`

It renders:
- `data-market-detail-topbar-main`
- `data-market-detail-action-row`
- `data-market-detail-date-rail`

## Inputs It Uses

Data:
- market context
- snapshot title/date/status
- market chain
- current market key

Helpers:
- `buildPageTitle`
- `buildMarketStatusPillMarkup`
- `getCommunitySnapshot` for export metadata

Browser/API:
- `window.location` for share URL
- JSON download blob for local snapshot export

## Used For

Now:
- canonical market detail route

Next likely reuse:
- stage/proof market pages
- closed/resolved market detail surfaces
- any route that needs a market identity rail without a full page rewrite

## Non-Goals

- does not decide market status
- does not fetch market data
- does not own sticky CSS
- does not own chart timeframe controls

## Guardrails

- do not put volume/end date back into the top header when it belongs under the chart
- do not merge date rail into the title module
- keep action buttons visually secondary
- preserve RTL-first breadcrumb flow
