# Market Detail Portfolio Overlay

Updated: 2026-05-04
Status: current
Owner: frontend / market-detail surface

Purpose:
- isolate portfolio snapshot hydration from market-detail rendering
- keep ticket/ladder holdings display backed by one normalized overlay shape
- make later portfolio reuse easier without dragging the full page orchestrator

File:
- `systems/design/assets/js/pages/market-detail/portfolio-overlay.js`

Used by:
- `systems/design/assets/js/pages/market-detail.js`
- holdings model through `state.portfolioOverlayByMarket`
- trade ticket through selected holding context

Owns:
- reading backend portfolio snapshot response shape
- mapping positions into `state.portfolioOverlayByMarket`
- mapping available cash into `state.portfolioSummaryOverlay`
- forcing backend portfolio cache invalidation when requested
- emitting `navi:portfolio-snapshot-updated`

Does not own:
- portfolio page UI
- backend portfolio truth
- trade execution
- holding calculation display copy

Design flow:
- this is runtime glue, not visual surface
- after successful trade, refresh overlay first, then render ticket/outcomes
- if portfolio read fails, market-detail stays readable and tradable state falls back safely
