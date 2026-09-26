# Feed System Design

Updated: 2026-04-29
Status: current
Owner: frontend / discovery surface

Purpose:
- define the shared Discovery feed language for Hachozeh
- keep `trending`, `breaking`, `new`, and `live` related but not identical
- improve the current direction without flattening it into generic feed UI

This doc is an upgrade brief, not a redesign-from-zero brief.

Read with:
- `systems/design/guide/surfaces/discovery/README.md`
- `systems/design/guide/surfaces/discovery/discovery-route-spec.md`
- `systems/design/guide/surfaces/discovery/live-page.md`

## This Doc Owns

- discovery feed family doctrine
- shared route personality rules
- anti-generic feed guardrails

## This Doc Does Not Own

- exact route composition by page
- exact discovery payload boundaries
- exact card layout rules

Those live in:
- `discovery-route-spec.md`
- `discovery-feed-contract.md`
- `feed-card-composition.md`

Important:
- the current direction already has a useful base
- the goal is to make it better, sharper, and more professional
- do not reset the product into a generic new look just because a redesign is happening

Route maturity is not equal:
- `trending` already has a real base and should be upgraded carefully
- `breaking` already has a real base and should be sharpened
- `new` exists, but is still visually weak and under-shaped
- `live` does not exist yet and will be defined from docs first
- category feeds are also still mostly doc-led territory and should not be treated as already-solved surfaces

## Core Feed Thesis

Hachozeh feeds should feel:
- abundant
- current
- smooth
- premium
- easy to scan

The user should feel:
- there is always more to explore
- the market world is alive
- they can read the room quickly

The feeds are not just lists.
They are the discovery engine of the product.

## What Must Stay

Keep and improve:
- dark/ink-led premium direction
- strong market-card based discovery
- smooth scrolling
- route shells that drop the user directly into market browsing
- high card count / market abundance

Do not casually replace:
- the general atmosphere
- the feed-first browsing behavior
- the existing discovery energy

## What Must Improve

The feeds should become:
- more authored
- more distinctive
- more typographically confident
- more rhythmically composed
- more professional

They should become less:
- uniform
- default-grid-ish
- template-safe
- visually interchangeable

## Shared Feed Grammar

All feed routes should share:
- the same underlying market language
- the same card family
- the same shell DNA
- the same premium tone

But they should differ in:
- rhythm
- emphasis
- density
- urgency
- editorial framing

Think:
- one system
- four moods

## Feed Building Blocks

The shared feed system should use a controlled set of building blocks:

1. hero or top-stage module
   - optional per route
   - strongest editorial emphasis

2. standard market cards
   - core discovery unit
   - high-frequency scan object

3. emphasis cards
   - slightly larger
   - higher attention
   - used to break feed monotony

4. section dividers / feed labels
   - create rhythm
   - prevent endless sameness

5. continuation/load behavior
   - smooth
   - infinite-feeling
   - low-friction

Important:
- do not make every feed purely one card size forever
- do not make emphasis so dramatic that the feed feels chaotic

## Shared Card Principles

Market cards should feel:
- rich enough to matter
- fast enough to scan
- premium enough to carry the brand

Cards should communicate:
- what the market is
- what is interesting right now
- one immediate signal

Cards should not try to do everything.

Card hierarchy should generally be:
1. market title
2. strongest live signal
3. supporting context
4. route into detail

## Scroll Feel

Scrolling is part of the product feel.

The feed should feel:
- continuous
- rewarding
- natural
- alive

It should not feel:
- like pagination in disguise
- like endless identical blocks
- like a cold data dump

To keep the scroll alive:
- vary rhythm slightly
- use occasional emphasis moments
- let spacing breathe
- avoid repetitive grid fatigue

## Upgrade Rule

When improving the feeds:
- evolve the current look
- do not replace the whole visual language casually

Safe upgrades:
- stronger typography
- better spacing discipline
- cleaner card hierarchy
- better route differentiation
- more intentional hero/emphasis modules
- better motion restraint

Risky upgrades:
- full palette reset without reason
- replacing all card behavior with a new system at once
- flattening every route into the same structure
- adding flashy decoration to simulate originality

## Route Personalities

### Trending

This is the main landing route.

It should feel:
- broad
- abundant
- smooth
- current
- live without becoming noisy

Role:
- show the market world at large
- let the user fall into discovery fast

Structure:
- one stronger top-stage moment is fine, but it must be a market, not marketing copy
- after that, market abundance should take over

Current handoff:
- the old dashboard-like featured area is not the target
- trending is locked at `systems/design/pages/trending.html` (legacy `systems/design/stage/trending.html` retired 2026-05-13; the lab loop served as the staging proof)
- the hero shape — title + outcomes column + chart + volume/end context, minimal words — is implemented; see `trending-front-page.md` and `components/hz-card.md`
- avoid "hot now" inside trending because breaking will own that behavior

Personality:
- confident
- open
- continuous

It should not feel:
- too urgent
- too editorially narrow
- too sparse

### Breaking

This is the sudden-movement route.

It should feel:
- sharper
- tenser
- faster
- more contrasty

Role:
- surface the biggest movers
- show underdogs gaining force
- make movement immediately visible

Structure:
- more front-loaded emphasis
- stronger movement signals in the top viewport
- tighter visual contrast than trending

Personality:
- alert
- premium urgency
- controlled volatility

It must not become:
- panic UI
- red flashing news channel energy

### New

This is the freshest inventory route.

It should feel:
- clean
- direct
- browseable
- low-friction

Role:
- answer one question simply:
  - what is new here

Structure:
- less need for hero drama
- clearer list/feed logic
- cleaner card rhythm

Personality:
- straightforward
- honest
- broad

It should not feel:
- overdesigned
- editorially heavy

Current reality:
- this route exists
- but it is still comparatively blank
- it needs stronger design definition than the current surface provides

### Live

This route does not exist yet, but its identity should be the strongest.

It should feel:
- electrifying
- immediate
- now-driven
- eventful

Role:
- serve users who already want immediate action
- show what is happening right now

Structure:
- strongest signal density at the top
- tighter update rhythm
- more event-centric grouping

Personality:
- alive
- intense
- precise

It must not become:
- visual chaos
- a glitchy terminal cosplay

Current reality:
- there is no live route yet
- this page should be designed from docs first, not assumed from an existing page

### Category Feeds

Category routes are also still open design territory.

They should be treated as:
- extensions of the Hachozeh discovery system
- not fully invented products with disconnected identities

Current recommendation:
- keep one shared feed language across categories
- let each category shift tone, signal emphasis, and editorial rhythm
- do not make every category page identical
- do not make every category page feel like a total redesign either

Good direction:
- politics feels more editorial and civic
- sports feels faster and more kinetic
- economics feels sharper and more analytical
- entertainment can feel lighter without becoming fluffy

Current reality:
- these pages are not mature design surfaces yet
- docs should define them before implementation starts guessing

## Card Rhythm Strategy

Do not use the exact same feed rhythm everywhere.

Recommended strategy:
- most cards stay standard size
- occasional emphasis cards break monotony
- hero/stage blocks are route-dependent

Rough behavior by route:
- trending:
  - one larger opening stage
  - then broad mixed rhythm
- breaking:
  - more emphasis early
  - more contrast in movement-heavy cards
- new:
  - more even rhythm
  - less dramatic variation
- live:
  - denser signals
  - faster feeling transitions

## Motion Strategy

Feed motion should support:
- continuity
- hierarchy
- freshness

Good feed motion:
- staggered reveal on initial load
- smooth card enter/append behavior
- subtle hover clarity
- gentle continuity as more cards appear

Bad feed motion:
- ornamental bouncing
- aggressive hover tricks
- every card shouting for attention
- animation that slows scanning

## Typography Strategy

Typography is a major part of making the feeds feel authored.

Needs:
- stronger headline personality
- clearer market-title hierarchy
- confident secondary text
- crisp numeric treatment

If the feed typography stays generic, the whole product will feel generic even if the layout improves.

## Professional Upgrade Direction

To make the current look more professional:
- tighten spacing
- reduce accidental visual noise
- improve route differentiation
- make emphasis states more deliberate
- make card information read faster
- give the feed a stronger editorial rhythm

This is the key:
- not "more design"
- better design discipline

## Anti-Slop Feed Rule

The feeds must not look like:
- default startup card grids
- template marketplaces
- generic dark dashboards with cards pasted in

If a feed screenshot could belong to any random finance/news/product app, it failed.

## Open Design Questions

Questions worth resolving before implementation work:
- how many card sizes should the feed system have
- should emphasis come from size, density, imagery, or signal treatment
- how much hero presence should remain on trending once the feed gets stronger
- how should live grouping differ from breaking grouping

## Success Test

The feed system succeeds when:
- users can scroll for a while without visual fatigue
- each route feels related but distinct
- the product feels more premium and authored than it does now
- the existing direction is clearly improved, not replaced
