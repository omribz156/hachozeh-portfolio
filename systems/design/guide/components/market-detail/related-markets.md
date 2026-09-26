# Market Detail Related Markets

Updated: 2026-05-04
Status: current
Owner: frontend / market-detail surface

Purpose:
- reusable adjacent-market rail/list
- keep related opportunities available without distracting from the current trade

## Product Job

Related markets answer:
- what else is nearby
- where can the user go after this market

This is secondary navigation, not the page thesis.

## Design Flow

Rules:
- sidebar only in non-stage/canonical desktop path
- hidden/empty in stage proof shape when not needed
- compact cards
- title, volume, probability only

## Runtime Role

Runtime component:
- `systems/design/assets/js/pages/market-detail/components/related-markets.js`

Current integration:
- loaded by `systems/design/pages/market-detail.html`
- called from `systems/design/assets/js/pages/market-detail.js`

It renders:
- `data-market-detail-related`

## Inputs It Uses

Data:
- `snapshot.relatedMarkets`

Helpers:
- `renderPanelEmptyState`

## Used For

Now:
- canonical market detail related rail

Next likely reuse:
- discovery side context
- resolved market “next markets” area

## Non-Goals

- does not rank markets
- does not fetch recommendations
- does not replace discovery

## Guardrails

- stay secondary
- no dashboard cards
- do not create fake related markets when backend has none
