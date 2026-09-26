# Feed Card Taxonomy

Updated: 2026-04-28
Status: current
Owner: frontend / discovery surface

Purpose:
- define the small card-role family for discovery feeds
- separate market type from visual role
- keep the feed system intentional without spawning card-zoo goblins

Read with:
- `systems/design/guide/surfaces/discovery/README.md`
- `systems/design/guide/surfaces/discovery/discovery-card-role-spec.md`
- `systems/design/guide/surfaces/discovery/feed-card-composition.md`

## This Doc Owns

- the split between market type and card role
- the allowed card-role family
- high-level route usage guidance

## This Doc Does Not Own

- exact content allowed inside each role
- exact size, spacing, or hierarchy rules
- page-level route composition

Those live in:
- `discovery-card-role-spec.md`
- `feed-card-composition.md`
- `discovery-route-spec.md`

## Core Principle

Discovery feeds need two different ideas:

1. market type
2. card role

Market type affects:
- what content exists
- what signals matter

Card role affects:
- how the market is presented in the feed
- how much attention it gets

These should not collapse into one thing.

## Market Types

Current useful market-type layer:
- binary
- multi-outcome
- sports
- metric
- live-oriented

This is still compatible with the current runtime `variant` model.

## Card Roles

Start with 4 roles only:
- `standard`
- `emphasis`
- `featured`
- `signal-led`

That is enough for:
- `trending`
- `breaking`
- `new`
- `live`
- category feeds

without making taxonomy soup.

## Role Meanings

### Standard

The default discovery unit.

Job:
- fast recognition
- fast scan
- route into detail

### Emphasis

A stronger feed unit, but not a hero.

Job:
- rhythm break
- attention lift

### Featured

The promoted top-stage unit.

Job:
- mark one market as the opening moment

### Signal-Led

A movement-first or state-first unit.

Job:
- make change, movement, or live state the first read

## Role And Type Examples

- multi-outcome:
  - usually `standard`
  - sometimes `emphasis`
  - rarely `featured`

- binary:
  - usually `standard`
  - sometimes `signal-led`

- sports:
  - usually `standard`
  - sometimes `emphasis`

- metric:
  - usually `standard`
  - sometimes `signal-led`

- live-oriented:
  - often `signal-led`
  - sometimes `emphasis`
  - occasionally `featured`

Important:
- not every live-oriented market should be loud
- not every important market deserves hero treatment

## High-Level Route Usage

- `trending`
  - mostly `standard`
  - some `emphasis`
  - optional `featured`

- `breaking`
  - more `signal-led`
  - more early `emphasis`

- `new`
  - mostly `standard`
  - little hero pressure

- `live`
  - mostly `signal-led`
  - more `emphasis`
  - maybe one `featured` stage

- category feeds
  - mostly `standard`
  - selective `emphasis`

For the real route composition, use `discovery-route-spec.md`.

## Upgrade Path

Recommended evolution:
1. keep current market-type variants
2. keep the role family small
3. let role drive composition decisions in docs first
4. only later decide whether runtime or API should encode role explicitly

## Anti-Slop Rule

If every card is:
- the same box
- the same hierarchy
- the same metadata strip
- the same action row

then the taxonomy failed.

Difference must come from:
- role
- hierarchy
- signal treatment
- composition

not from random decoration.

## Success Test

The taxonomy succeeds when:
- cards still feel like one family
- routes can build different rhythms without a new design system
- market type and visual role no longer get confused
