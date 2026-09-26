# Market Detail Trust Model

Updated: 2026-05-04
Status: current
Owner: frontend / market-detail surface

Purpose:
- keep trust/timeline shaping out of the page orchestrator
- keep the frontend honest about what it owns: presentation and parsing, not rule invention
- provide a stable seam for Seer-provided source/rule/timeline truth

File:
- `systems/design/assets/js/pages/market-detail/trust-model.js`

Used by:
- `systems/design/assets/js/pages/market-detail.js`
- `systems/design/assets/js/pages/market-detail/components/trust-sections.js`
- chart date helpers through `getCloseDateLabel`

Owns:
- Hebrew timeline date parsing
- close date label derivation
- payout label derivation as close + 10 minutes
- timeline lifecycle progress metadata
- resolution source display metadata
- splitting Seer/backend rule text into presentational rule sections

Does not own:
- official source truth
- market rule authoring
- source URL selection beyond reading exposed backend/Seer fields
- resolution decisions

Design flow:
- trust display should feel grounded and quiet
- rules are readable sections, not a boxed legal wall
- timeline is a three-point rail: open -> close -> payout
- if backend does not expose source/rule truth, show pending/missing state; do not fake copy

Important:
- Seer owns market rule/source substance
- Front owns rendering, missing states, link surface, and RTL/timeline readability
