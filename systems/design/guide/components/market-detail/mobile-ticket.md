# Market Detail Mobile Ticket

Updated: 2026-05-29
Status: current
Owner: frontend / market-detail surface

Purpose:
- isolate compact/narrow ticket overlay behavior from market-detail page orchestration
- keep desktop rail and mobile overlay using the same actual trade ticket
- prevent responsive behavior from leaking into visual components

File:
- `systems/design/assets/js/pages/market-detail/mobile-ticket.js`

Used by:
- `systems/design/assets/js/pages/market-detail.js`
- stage market detail route

Owns:
- detecting compact ticket viewport
- opening/closing the stage rail overlay
- syncing `aria-hidden` and `aria-expanded`
- three launcher renderers in the sticky bottom slot:
  - `renderMobileTicketLauncher` — multi-outcome no-op (slot stays empty; CSS hides the container)
  - `renderBinaryMobileLauncher` — open binary: Yes/No pill pair with current prices
  - `renderBinaryResolvedLauncher` — resolved binary: single floating outcome chip ("הוכרע: <winner>")
- closing overlay when viewport expands

Does not own:
- ticket visual rendering
- trade submit
- outcome ladder selection
- page header/footer responsive behavior
- the sell-from-position click handler (lives in the page orchestrator; it calls `openMobileTicketIfCompact()` after flipping state — see Sticky-sheet ritual below)

Design flow:
- on narrow screens, the ticket becomes an overlay rather than jumping below content
- background should stay readable; no heavy blur
- overlay opens only after user intent from outcome/action controls or the launcher
- click-out/backdrop and Escape close the overlay

## Sticky-sheet ritual

Any orchestrator handler that flips ticket-internal state on mobile (orderSide, contractSide, sellTargetOverride) must either open the sheet or document why it doesn't. The sheet is closed by default; mutating state inside it without opening it reads as "click did nothing."

Three call sites follow it today:
- multi-outcome buy click → `openMobileTicketIfCompact()` (page orchestrator)
- binary buy-pill tap → `setMobileTicketOpen(true)` (launcher click handler)
- sell-from-position click → `openMobileTicketIfCompact()` (viewer-positions click handler)

Important:
- this controller must stay behavior-only
- do not restyle the ticket here; use ticket CSS/component docs for visual changes
