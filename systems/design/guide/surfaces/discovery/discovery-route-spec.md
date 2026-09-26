# Discovery Route Spec

Updated: 2026-04-29
Status: current
Owner: frontend / discovery surface

Purpose:
- define how discovery routes should differ structurally
- keep route upgrades aligned with current Hachozeh feel
- give later frontend work a concrete composition brief

Read with:
- `systems/design/guide/surfaces/discovery/README.md`
- `systems/design/guide/surfaces/discovery/trending-front-page.md`
- `systems/design/guide/surfaces/discovery/feed-system.md`
- `systems/design/guide/surfaces/discovery/discovery-card-role-spec.md`
- `systems/design/guide/components/hz-card.md` (the active card pattern; replaces the retired `market-card.md` / `featured-market.md`)

Status:
- v1 route spec for task `09a`

## This Doc Owns

- route-by-route composition
- preferred role mix by route
- migration order for route convergence

## This Doc Does Not Own

- feed family doctrine
- deep single-route proof docs
- feed data boundary rules

Those live in:
- `feed-system.md`
- `live-page.md`
- `discovery-feed-contract.md`

## Route Map

Current route map:
- `trending`
  - current runtime: `systems/design/pages/trending.html`
  - status: locked (2026-05-13); the legacy `systems/design/stage/trending.html` has been retired and the lab loop served as the staging proof. See `trending-front-page.md` for the locked shape.
- `breaking`
  - current runtime: `systems/design/pages/breaking-markets.html`
  - status: redesigned 2026-05-25 with its own row+RTL-delta-track shape (not `hz-card`); warm-amber tokens, platform shell, derived chips, `?category=` URL state. Surface guide: `breaking-page.md`.
- `new`
  - current runtime: `systems/design/pages/new-markets.html`
  - status: still on the original 2026-03-05 design; awaits redesign
- `live`
  - doc-only for now
- category feeds
  - mostly query/filter behavior for now

Important:
- `trending` is the system anchor
- `breaking` can be sharper, but still belongs to the same family
- `new` should become cleaner, not more dramatic
- `live` should not be implemented by copying `breaking` with extra caffeine

## Shared Discovery Rules

All discovery routes should share:
- same premium dark material language
- same `market-card` family DNA
- same route-to-detail behavior
- same category and volume semantics

All discovery routes should differ by:
- first viewport composition
- role mix
- density
- strongest signal
- editorial framing

Shared responsive contract:
- Three structural breakpoints: **1280 / 1024 / 900 px**. Each is atomic — multiple things change but in lockstep.
- Above 1280 px: full route opening visible (hero / stage / sidebar, per route), cards 4-col
- 1025–1280 px: opening still visible, cards **3-col** — Poly-mirrored middle band (live-measured desktop-audit F2b: Polymarket runs 3-col 1024–1279, cards 312–371px; our 3-col band lands 316–401px, inside the card's already-exercised width envelope)
- 901–1024 px: opening **hidden** (`display: none`) **AND** cards jump straight to **2-col**
- ≤ 900 px: cards drop 2 → 1 **AND** filter row flips row → column
- Card-grid breakpoints **must align** with structural ones — never introduce an off-grid card breakpoint that gives users two reflows in one drag
- Canonical implementation: `trending-front-page.md` → "Responsive Contract"
- Cross-session smoke check: open the route at **1440 / 1281 / 1280 / 1100 / 1024 / 950 / 900 / 430** — between 900 and 1024, and between 1025 and 1280, the layout should hold steady (no intermediate reflows)

Hard rules:
- no sportsbook drift
- no newsroom/casino mashup
- no generic infinite card soup
- no route-specific one-off component zoo

## Trending

Goal:
- broad market boulevard
- easy entry into abundance

Opening structure:
- 1 featured/live market stage max
- immediately followed by dense discovery grid

Preferred role mix:
- `featured`: 0-1
- `standard`: heavy majority
- `emphasis`: occasional
- `signal-led`: selective, not dominant

Density:
- highest total card count of all routes
- smooth load-more / infinite-feeling continuation

What leads:
- breadth first
- then one strong immediate signal per card

What not to do:
- over-editorialize the top
- create a "mini dashboard" hero
- add "hot now" when `breaking` owns that lane
- duplicate CTAs when clicking the market is enough
- use decorative/fake chart motion
- make every third card special
- turn trending into breaking-lite

Current stage note:
- latest stage experiments improved structure but the hero still felt too generic/boxy
- next work should focus on one Polymarket-like live market stage, without social/news complexity for now
- use market-detail chart language instead of inventing a separate decorative graph

## Breaking

Goal:
- surface the biggest movers without panic theater

Opening structure:
- movement-led hero band or stage
- fast-entry mover list/feed immediately below
- sidebar/news module optional, not identity-defining

Preferred role mix:
- `signal-led`: primary
- `emphasis`: early and selective
- `standard`: supporting
- `featured`: optional, but if used it should still be movement-first

Density:
- tighter than `trending`
- more contrast in top viewport
- movement signal should read before title detail

What leads:
- delta
- momentum
- underdog wake-up moments

What not to do:
- news-channel chaos
- every row using identical sparkline furniture forever
- pure rank table with a thin cosmetic skin

Implementation note:
- current row-based page is useful directionally, but should evolve toward a card/feed system instead of staying a forever-special case

## New

Goal:
- answer "what just opened?" with low friction

Opening structure:
- lean route header
- chips/filter row
- immediate feed/grid

Preferred role mix:
- `standard`: primary
- `emphasis`: rare and deliberate
- `signal-led`: limited
- `featured`: normally none

Density:
- clean rhythm
- lower drama than `trending`
- slightly more breathing room than `breaking`

What leads:
- freshness
- browseability
- clean scanning

What not to do:
- fake urgency
- hero pressure where freshness alone is enough
- oversized discovery modules with weak reason

## Live

Goal:
- make immediate market action readable and exciting

Opening structure:
- 1 live stage max
- grouped feed below by strongest short-horizon activity

Preferred role mix:
- `signal-led`: primary
- `emphasis`: frequent
- `standard`: supporting only
- `featured`: optional opening stage

Density:
- intense but controlled
- should feel fast, not exhausting

What leads:
- current state
- short-horizon movement
- active market participation

What not to do:
- clone `breaking`
- overload with badges, timers, and blink bait

## Category Feeds

Goal:
- preserve one Hachozeh system while letting topic tone breathe

Opening structure:
- simple category heading
- feed starts quickly

Preferred role mix:
- `standard`: primary
- `emphasis`: selective by category need
- `signal-led`: only when market behavior justifies it
- `featured`: rare

Rule:
- category changes tone through selection and sequencing
- not through a whole new component zoo

## Current Runtime Mapping

Safe now:
- `trending` uses `hz-card` via `trending-stage.js`
- `breaking` runs its own row+track stage (`breaking-markets-stage.js`) against the standard discovery feed; deliberately *not* on `hz-card` — breaking's job is ranked-list scan, not card-stream browse
- `new` can stay grid-first until it gets its own redesign pass
- discovery cards try the live backend feed first through `systems/design/assets/js/pages/discovery-data-source.js`; local seeded card sets are fallback only

Needs future convergence:
- shared `category-presentation` module (S1 in `workspace/coordination/front-breaking.md`) — today trending/live/breaking each carry their own per-category visual map; lift before a fourth sibling lands
- route differences should come from composition, not isolated page inventions — but composition can mean "different shapes for different jobs" (row vs card), not just "same card with different fields"

## Migration Order

Recommended order after this spec:

1. keep `trending` as the contract anchor
2. (done) `breaking` shipped 2026-05-25 with its own shape against the shared feed seam
3. redesign `new` next — likely closer to `trending`'s shape than `breaking`'s
4. define `live` only after real live-state backend truth exists

Reason:
- `new` needs less special movement logic
- `live` should not be born from vibes alone
