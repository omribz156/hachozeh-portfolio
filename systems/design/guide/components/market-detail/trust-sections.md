# Market Detail Trust Sections

Updated: 2026-05-04
Status: current
Owner: frontend / market-detail surface

Purpose:
- reusable rules/timeline/prohibitions surface
- explain how the market resolves without drowning the page
- keep confidence details below the tradable market object

## Product Job

Trust sections answer:
- what is measured
- how the winner is decided
- what source resolves it
- when trading closes
- when payout happens
- what trading limitations matter

This is the “can I trust this market?” layer.

## Design Flow

Chosen shape:
- foldable sections
- rules open by default
- timeline closed by default unless state/copy later changes that
- prohibitions folded and short
- rules render as deboxed reading rows, not nested cards
- source/date/market-structure facts sit as a quiet side rail

Timeline rule:
- horizontal 3-point rhythm in stage/proof shape
- open -> close -> payout
- progress fill is derived from lifecycle state and timeline dates
- open markets can fill gradually toward close; closed/awaiting-resolution stops at close
- resolved/settled/paid markets move to payout
- payout defaults to 10 minutes after close when source data allows

Copy rule:
- plain Hebrew
- concrete source link when backend exposes it
- no invented source/rule copy
- avoid legal-document density

Surface rule:
- use hairlines and spacing before panels
- avoid card-in-card stacks
- labels can carry green, but body copy stays calm and readable
- when `snapshot.contract` has structured presentation fields, render them directly:
  - `measurement` -> `מה נמדד`
  - `resolutionRule` -> `איך מוכרע`
  - `delayPolicy` -> `אם יש עיכוב`
- when backend/Seer sends `trust.resolutionRules`, do not append frontend
  market-structure filler; keep the side rail to source/date only
- only parse `trust.resolutionRules` or use the hardcoded market-structure card/fact as a legacy missing-contract fallback

## Runtime Role

Runtime component:
- `systems/design/assets/js/pages/market-detail/components/trust-sections.js`

Current integration:
- loaded by `systems/design/pages/market-detail.html`
- called from `systems/design/assets/js/pages/market-detail.js`

It renders:
- `data-market-detail-rules`
- `data-market-detail-timeline`
- `data-market-detail-prohibitions`
- fold open/closed state

## Inputs It Uses

Data:
- snapshot trust payload
- timeline events
- resolution object
- market status

Helpers:
- contract-section builder
- timeline date helpers
- source metadata resolver
- escaping helpers

State:
- `trustOpenSections`
- legacy `timelineOpen` for non-stage path

## Used For

Now:
- canonical market detail rules/timeline/prohibitions

Next likely reuse:
- closed/awaiting-resolution/resolved market state pages
- backend proof-market trust display

## Non-Goals

- does not create official source truth
- does not settle markets
- does not decide lifecycle state

## Guardrails

- source links must come from backend/market truth
- source URL should be clickable and normalized
- rules should be market-specific, not generic filler
- timeline should distinguish close, resolution, and payout
