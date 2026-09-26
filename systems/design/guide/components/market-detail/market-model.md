# Market Detail Market Model

Updated: 2026-05-29
Status: current
Owner: frontend / market-detail surface

Purpose:
- keep market-detail outcome/status/timeframe logic out of the page orchestrator
- provide one reusable source for chart, ladder, ticket, and community selection semantics
- preserve visual behavior while making the route easier to split further

File:
- `systems/design/assets/js/pages/market-detail/market-model.js`

Used by:
- `systems/design/assets/js/pages/market-detail.js`
- chart component
- outcome ladder component
- trade ticket model
- holdings model
- community renderer
- resolved-rail component
- chart-integration module

Owns:
- active outcome order derived from backend snapshot `current`
- top-4 chart outcome selection for stage view
- chart line picker toggling rules
- timeframe option discovery and backend alias lookup
- outcome label normalization and palette fallback
- market status metadata
- market-open checks
- layout-shape predicates (`isBinaryLayoutMarket`, `isBinaryContractMarket`)
- winner identity helpers (`getWinnerOutcomeId`, `getWinnerLabel`) — single source consumed by the resolved rail, probability hero, timeline terminator, and chart wrapper's end-dot tagging
- page title fallback
- empty community fallback shape
- current probability / contract price / selection key helpers
- short trend delta for outcome rows

Does not own:
- backend market truth
- Seer trust/rule copy
- chart rendering
- ticket rendering
- trade submission

Design flow:
- this is not a visual component
- it exists to keep reused market mechanics consistent across visual surfaces
- if outcome labels, status copy, or chart line rules change, update here before touching each renderer

## Predicates over component presence

Layout decisions read through predicates (`isBinaryLayoutMarket()`), not through whether a given component instance happens to exist. Code like `binaryTradeTicketComponent && doBinaryThing()` couples layout intent to accidental DOM construction order; if the binary trade ticket fails to mount for any reason, the binary launcher chip also disappears, which is the wrong cascade. Read the predicate.

Important:
- multi-outcome is the default mental model
- binary yes/no is only a special case
- chart display can show max four lines, but the outcome ladder can show all outcomes
