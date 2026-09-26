# Market Detail Outcome Ladder

Updated: 2026-05-04
Status: current
Owner: frontend / market-detail surface

Purpose:
- reusable tradable outcome list
- show all outcomes, probabilities, volume/position context, and entry buttons
- turn comparison into action without becoming a table dump

## Product Job

The outcome ladder helps the user:
- compare outcomes quickly
- see which side is priced where
- choose an action that updates the trade ticket

It is the market's tradable structure.

## Design Flow

Each row reads:
- outcome label
- volume / position context
- probability
- small movement delta
- buy/sell affordances

Visual rules:
- outcome title is larger than supporting data
- volume sits below title
- held position sits below volume when present
- yes/no buttons carry green/red meaning
- action text must be big enough for button size
- no redundant toolbar words above the ladder

## Runtime Role

Runtime component:
- `systems/design/assets/js/pages/market-detail/components/outcome-ladder.js`

Current integration:
- loaded by `systems/design/pages/market-detail.html`
- called from `systems/design/assets/js/pages/market-detail.js`

It renders:
- `data-market-detail-outcomes`

## Inputs It Uses

Data:
- snapshot outcomes/current probabilities
- outcome volumes
- holdings
- selected ticket side/outcome/contract

Helpers:
- price/probability/share formatters
- sparkline path builder
- trade capability checks
- holding lookup

State:
- selected outcome
- order side
- contract side
- backend trade capability

## Used For

Now:
- canonical market detail outcome list

Next likely reuse:
- live cards that expose a small tradable market
- discovery cards that need richer action rows

## Non-Goals

- does not submit trades
- does not own quote fetching
- does not own full ticket summary

## Guardrails

- no fake volume hiding; show zero if backend says zero
- disable sell when no holding exists
- do not invent complement truth outside backend/holding helpers
- keep row clicks synced to the ticket
