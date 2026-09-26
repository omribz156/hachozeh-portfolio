# Discovery Card Role Spec

Updated: 2026-04-28
Status: current
Owner: frontend / discovery surface

Purpose:
- define what each discovery card role is allowed to contain
- separate feed role from market type
- keep route work from inventing visual rules ad hoc

Read with:
- `systems/design/guide/surfaces/discovery/README.md`
- `systems/design/guide/surfaces/discovery/feed-system.md`
- `systems/design/guide/surfaces/discovery/feed-card-taxonomy.md`
- `systems/design/guide/surfaces/discovery/feed-card-composition.md`
- `systems/design/guide/components/hz-card.md` (the active card pattern; replaces the retired `market-card.md` / `featured-market.md`)

Status:
- v1 role spec for task `09a`
- frontend implementation brief

## This Doc Owns

- what each card role is allowed to contain
- what each role should prioritize
- content guardrails by role

## This Doc Does Not Own

- the card-role family itself
- exact size and spacing rules
- page-level route composition

Those live in:
- `feed-card-taxonomy.md`
- `feed-card-composition.md`
- `discovery-route-spec.md`

## Shared Rules

All card roles should share:
- same premium dark material family
- same route-to-detail behavior
- same category and volume semantics
- same basic market preview intent

All card roles should differ by:
- hierarchy
- signal priority
- footprint
- amount of context allowed

Hard rules:
- no trade execution on discovery cards
- no role-specific fake schema fields in engine tables
- no decorative complexity pretending to be hierarchy

## Standard

Use for:
- baseline discovery inventory
- most `trending`
- most `new`
- most category feeds

Required content:
- category
- title
- one dominant market signal
- route/action area

Optional content:
- image
- top 2 outcomes preview
- small secondary metadata

Do not include by default:
- long explanation copy
- more than one main signal block
- heavy movement treatment

Visual rules:
- one grid unit on desktop
- compact-to-medium height
- 2 title lines preferred
- scan in under 2 seconds

Current mapping:
- shared `market-card` baseline

## Emphasis

Use for:
- priority markets inside a feed
- rhythm break after repeated standards
- one stronger card every few rows, not every row screaming for attention

Required content:
- title with more breathing room
- one stronger signal block
- route/action area

Optional content:
- richer preview of top outcomes
- slightly larger image or metric area

Do not include by default:
- hero-only explanation panels
- long editorial body
- multiple competing submodules

Visual rules:
- 1.5x to 2x standard presence on desktop
- may span width or height, not necessarily both
- 2 to 3 title lines allowed
- still must feel native to the feed grid

## Signal-Led

Use for:
- `breaking`
- future `live`
- markets where delta, movement, or live state is the main hook

Required content:
- movement/state signal as first read
- title
- route/action area

Optional content:
- sparkline
- mover label
- delta chip
- live badge

Do not include by default:
- large editorial explanation
- too many small metrics
- alarm-light styling

Visual rules:
- similar footprint to standard unless route composition promotes it
- strongest contrast belongs in the signal zone
- title may be second read, but never buried

Current mapping:
- breaking rows should evolve toward this role
- `live` market-card variant can also render in this role later

## Featured

Use for:
- one intentional top-stage promoted market
- the opening moment of `trending`
- optional opening stage for `live`

Required content:
- richer market preview
- stronger visual stage
- clear reason this market is promoted
- route-to-detail actions only

Optional content:
- image
- trend chart
- outcome depth
- context points

Do not include:
- trade execution
- feed-grid logic pasted bigger
- more than one featured module in the same opening viewport

Visual rules:
- outside normal feed rhythm
- editorial stage, not oversized card
- should justify the extra height with actual extra context

Current mapping:
- shared `featured-market` module on landing

## Runtime Mapping Rule

Safe now:
- market type still controls content shape
- card role controls composition and placement

Not safe:
- treating `live` market type as automatically `signal-led`
- treating `featured` as a backend market attribute
- storing layout concerns in engine truth

## Done Test

This doc is doing its job when:
- frontend work can choose a role without guessing the allowed content
- backend work does not need to care about presentation span rules
- `breaking` and future `live` feel sharper without creating a second design system
