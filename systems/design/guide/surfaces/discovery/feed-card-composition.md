# Feed Card Composition

Updated: 2026-04-28
Status: current
Owner: frontend / discovery surface

Purpose:
- define how Navi feed cards should be composed visually
- lock size, density, and hierarchy rules by card role
- improve the current card system without replacing its product logic

This doc is about card form.

Not:
- backend data truth
- trade logic
- card taxonomy theory alone

Read with:
- `systems/design/guide/surfaces/discovery/README.md`
- `systems/design/guide/surfaces/discovery/feed-card-taxonomy.md`
- `systems/design/guide/surfaces/discovery/feed-system.md`
- `systems/design/guide/components/hz-card.md` (the active card pattern; replaces the retired `market-card.md`)

## This Doc Owns

- size, spacing, hierarchy, and density rules by role
- the visual form of discovery cards

## This Doc Does Not Own

- feed payload boundaries
- the card-role family definition
- page-level route composition

Those live in:
- `discovery-feed-contract.md`
- `feed-card-taxonomy.md`
- `discovery-route-spec.md`

## Core Rule

Card design should improve:
- scanability
- rhythm
- identity
- professionalism

Not just:
- decoration
- novelty
- density for density's sake

## Shared Card Shell Rules

All feed cards should share a family resemblance:
- same material language
- same border/surface logic
- same typography family
- same interaction confidence

But they should not share:
- identical size
- identical hierarchy
- identical spacing

If every card has the same internal rhythm, the feed will still feel generic.

## Base Grid Thinking

Use the grid as a rhythm system, not just a packing system.

Recommended desktop logic:
- standard cards occupy the baseline unit
- emphasis cards span wider or taller
- featured stage breaks the grid intentionally

Recommended mobile logic:
- almost everything becomes one column
- difference comes more from internal hierarchy and height than width

## Card Roles And Size Rules

### Standard Card

Role:
- default feed unit

Recommended behavior:
- one grid cell wide
- compact vertical footprint
- enough room for title + one signal + action area

Should feel:
- efficient
- premium
- not cramped

Title rule:
- 2 lines max preferred

Signal rule:
- one main signal only

### Emphasis Card

Role:
- rhythm break
- attention lift

Recommended behavior:
- span wider or slightly taller than standard
- give the title and signal more space
- still fit naturally inside the feed

Should feel:
- more important
- not oversized for ego

Title rule:
- 2 to 3 lines allowed

Signal rule:
- can support one stronger visual or movement block

### Featured Stage

Role:
- promoted discovery moment

Recommended behavior:
- outside normal feed rhythm
- acts as a stage, not a card pasted bigger

Should feel:
- editorial
- premium
- intentional

Title rule:
- larger and more expressive than feed cards

Signal rule:
- context + signal can both appear

### Signal-Led Card

Role:
- movement-first or state-first card

Recommended behavior:
- title may become secondary to a main live/movement metric
- stronger contrast in the signal zone
- still preserve route clarity

Should feel:
- sharp
- active
- controlled

Not:
- flashy
- noisy

## Internal Card Hierarchy

Most cards should read in this order:

1. category / top strip
2. title
3. strongest signal
4. supporting context
5. route/action area

Do not let:
- bookmark
- badges
- decoration
- secondary metadata

beat the title or signal.

## Title Treatment

Titles are one of the biggest current upgrade opportunities.

Rules:
- strong line-height discipline
- better line wrapping
- tighter but more confident spacing
- do not let title size stay timid and generic

By role:
- standard:
  - concise
  - sharp
- emphasis:
  - more breathing room
  - stronger presence
- featured:
  - display-level confidence

## Signal Treatment

Signal is what makes the card matter now.

Types of signal:
- probability leader
- binary split
- movement delta
- live value
- metric snapshot
- sports outcome spread

Rules:
- one signal should dominate
- do not show five competing small metrics
- signal should be readable before supporting metadata

## Action Area

Card actions should still route, not trade.

So the action area should feel:
- light
- precise
- directional

Not:
- like a submit CTA
- like a purchase UI

Button rules:
- standard cards:
  - compact
  - clear
- signal-led cards:
  - stronger action emphasis is okay
- sports cards:
  - matchup buttons must stay readable and balanced

## Density Rules

Card density should vary by role, not by accident.

Standard:
- compact-medium

Emphasis:
- medium

Featured:
- spacious

Signal-led:
- compact but sharp

Important:
- do not solve professionalism by making everything bigger
- do not solve premium feel by making everything sparse

## Visual Material Rules

Cards should feel:
- refined
- tactile enough to matter
- crisp

They should not rely on:
- thick borders everywhere
- giant shadows
- glow spam
- loud gradients as identity shortcuts

Material should support hierarchy, not replace it.

## Card Size Recommendations

These are design-level guidance, not locked CSS yet.

Desktop:
- standard:
  - one unit wide
  - baseline height band
- emphasis:
  - 1.5x to 2x visual presence of standard
- featured:
  - full top-stage module
- signal-led:
  - close to standard size, but with stronger signal allocation

Mobile:
- mostly one-column stack
- standard and signal-led differ mostly by content hierarchy
- emphasis cards can gain extra vertical breathing room

## Route-Specific Composition Notes

### Trending

Needs:
- smooth standard-card flow
- occasional emphasis breaks
- one stronger top-stage module is okay

### Breaking

Needs:
- more signal-led cards
- stronger first-screen rhythm
- cards should show movement faster

### New

Needs:
- cleaner standard-card system
- less visual drama
- more browse comfort

### Live

Needs:
- stronger signal-led card treatment
- more immediate top-stage or grouped moments
- careful control so it does not become exhausting

### Category

Needs:
- same card family
- tone shifts by category
- no full structural reset

## Current Upgrade Advice

For the current Navi card system, the most valuable visual upgrades are likely:
- title hierarchy
- spacing discipline
- clearer size differences between roles
- less accidental sameness
- more intentional signal blocks

Not:
- inventing many new card widgets
- layering on decorative UI

## Anti-Slop Test

A card fails if:
- it looks like a generic dark fintech card
- its title could belong to any startup product
- the signal is weak or buried
- the size changes but the hierarchy does not

## Success Test

The composition system succeeds when:
- cards feel like one family
- card roles are obvious without labels
- the feed feels more premium and more authored
- the current product direction is improved, not replaced
