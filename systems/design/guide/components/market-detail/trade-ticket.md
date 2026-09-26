# Market Detail Trade Ticket

Updated: 2026-05-04
Status: current
Owner: frontend / market-detail surface

Purpose:
- reusable market action surface for market-detail and future live-market pages
- render the buy/sell ticket without changing the proven market-detail behavior
- keep the transaction layer separate from the market-reading layer

## Product Job

The trade ticket answers one question:
- “What am I about to buy or sell, and what happens if I submit?”

It should stay quiet until intent exists, then become direct:
- selected outcome
- buy/sell mode
- yes/no contract side when relevant
- amount or share quantity
- live quote summary
- submit state
- trading restriction state

## Design Flow

The ticket follows the market-detail design rule:
- market first
- transaction second
- no casino slip energy

Visual priorities:
- compact heading with selected outcome and current price
- subtle buy/sell and yes/no toggles
- amount input with quick chips
- summary appears only after amount exists in stage/mobile mode
- feedback copy explains cause/effect instead of adding dashboard noise

## Runtime Role

Runtime component:
- `systems/design/assets/js/pages/market-detail/components/trade-ticket.js`

Current integration:
- loaded by `systems/design/pages/market-detail.html`
- created from `systems/design/assets/js/pages/market-detail.js`
- receives page-local state and helpers through a scoped factory

Why this shape:
- first extraction pass preserves visual and trading behavior exactly
- later pass can make the component more data-pure after reuse pressure is clear

## Inputs It Uses

State/helpers:
- active market key
- selected outcome
- order side
- contract side
- amount by selection
- quote state
- portfolio/holding context
- market status
- live trading capability
- formatting helpers

DOM refs:
- order ticket shell refs from `market-detail/shell.js`
- mobile ticket launcher refs when stage/mobile mode is active

Backend seams:
- quote state is prepared outside the component
- trade submission is still owned by page orchestration
- component only renders quote/trade readiness and submit affordance

## Used For

Now:
- market detail sidebar ticket
- market detail mobile/compact overlay ticket

Next likely reuse:
- live page left rail
- future focused trade overlay from outcome cards

## Non-Goals

- does not submit trades directly
- does not own quote fetching
- does not invent backend truth
- does not restyle the ticket during extraction

## Guardrails

- keep Hebrew labels short
- keep numbers stable while typing
- preserve decimal precision from quote formatters
- sell mode must show proceeds/realized-PnL truth clearly
- restrictions must disable controls before fake-live requests are sent
