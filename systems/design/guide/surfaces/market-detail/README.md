# Market Detail Surface Contract

Updated: 2026-05-06
Status: current
Owner: frontend / market-detail surface

Purpose:
- define the visual and interaction direction for the market-detail route
- give future frontend work one clear design target
- keep the product heart from drifting into generic dashboard or betting-slip UI

Authority:
- this is a surface contract under `workspace/docs/design.md`
- it is binding for market-detail work unless the design constitution changes
- it does not override platform-wide typography, tone, or anti-slop rules

It does not define backend contracts or implementation seams.
For current route structure and ownership, see:
- `systems/design/guide/components/market-detail.md`

For market copy/presentation consumption, see:
- `market-presentation-playbook.md`

Wording source of truth:
- Seer shapes visible market copy in `workspace/docs/agents/seer/market-presentation-shaping-v1.md`.
- Market detail displays that structured copy and should not parse or invent rules when `snapshot.contract` fields exist.

## Role In The Product

Market detail is the core touch point of Hachozeh.

This is the page where the platform stops being an interesting feed and becomes a real market experience.

The user should feel:
- the market is live
- the odds matter
- the action is available now
- they can understand the situation quickly

Short framing:
- live market theater
- analyst clarity
- premium execution

## Core User Jobs

The page must help the user do 5 things fast:

1. understand the question
2. read the current market state
3. compare outcomes
4. act immediately
5. gain enough confidence to commit

If the page looks impressive but slows any of those down, it failed.

## Emotional Target

The feeling should be:
- alive
- sharp
- consequential
- premium

Not:
- noisy
- casino-like
- over-technical
- cluttered with pseudo-analytics

The user should feel like:
- a participant in a live market
- an analyst reading a real signal

Not like:
- someone filling a betting slip
- someone navigating a cold admin console

## Page Thesis

The central experience of market detail is:
- watch the market
- choose a conviction
- act with confidence

Everything on the page should support one of those three verbs.

## Default Hierarchy

The route should read in this order:

1. market identity
   - what is this market
   - is it open
   - why should I care now

2. live price stage
   - chart
   - current movement
   - strongest outcome signals

3. outcome ladder
   - all outcomes
   - current prices
   - relative strength
   - immediate entry points

4. trade rail
   - selected outcome
   - buy/sell action
   - amount
   - summary
   - submit

5. confidence layer
   - rules
   - timeline
   - resolution/payment clarity

6. social/supporting context
   - community
   - related markets

Important:
- trade rail is primary action, but it must not visually overpower the market itself
- the market comes first
- the transaction comes second

## Layout Direction

Current implementation lock:
- `systems/design/pages/market-detail.html` is the live route
- the duplicate `market-detail-stage.html` route was retired after promotion
- the final stage snapshot is archived at `systems/design/guide/history/2026-04-market-detail-pre-v1-proof/market-detail-stage-promoted.html`
- `systems/design/mockups/` is scratch-only and ignored
- current font direction is Arimo
- centered narrow-width trade overlay is intentional; no persistent bottom action strip by default

Recommended desktop composition:
- main column = reading + market watching
- right rail = action + adjacent opportunities

Desktop order:
- top identity rail
- price stage
- outcome ladder
- trust sections
- community

Sidebar order:
- sticky trade card
- related markets

Recommended mobile composition:
- market identity
- price stage
- outcome ladder
- trade ticket opens as a centered overlay after an actual outcome action
- trust sections
- community

Mobile principle:
- action must stay close
- but should not smother the content before the user understands the market
- no persistent bottom CTA strip by default

## Section Blueprint

### 1. Top Identity Rail

Purpose:
- orientation
- market status
- category context
- quick utility actions

Must show:
- category/breadcrumb context
- market title
- short market meta line
- open/closed/resolved state

Should feel:
- calm
- expensive
- informative

Should not feel:
- like a toolbar first

Design note:
- save/share/download actions should stay visually secondary
- title and status carry the real hierarchy

### 2. Price Stage

Purpose:
- make the market feel live
- show movement as the main signal layer

This is the visual stage of the page.

It should combine:
- chart
- outcome legend
- timeframe controls
- current state markers

The chart area should feel:
- confident
- atmospheric
- easy to read

Not:
- overly quant-jargon
- overloaded with tiny controls

Design rules:
- one dominant live graphic
- a small amount of strong metadata
- movement should feel visible even before the user reads details

### 3. Outcome Ladder

Purpose:
- compare all outcomes fast
- turn comparison into action

This is not just a table.
It is the market's tradable structure.

Each row should make clear:
- outcome name
- current probability/price
- relative strength
- instant action

Ideal feel:
- like a premium trading ladder
- like a market board with clarity

Not:
- like a generic data table
- like a sportsbook odds list

Design rules:
- row scanning must be extremely fast
- prices should be visually stronger than supporting copy
- selected state should feel precise and confident
- buy/sell entry must be obvious without becoming noisy

### 4. Trade Rail

Purpose:
- convert market understanding into action

This is the action engine of the page.

It should feel:
- focused
- trustworthy
- friction-light
- serious

It should not feel:
- like a gambling slip
- like a toy modal

The trade rail must communicate:
- what the user is trading
- at what current price context
- how much they are entering
- what the result means

Hierarchy inside the trade card:
1. selected contract / outcome
2. side toggle
3. amount entry
4. quick amount shortcuts
5. summary
6. submit
7. legal/support copy

Design rules:
- one action path only
- no duplicate numbers fighting each other
- result summary must feel plain and trustworthy
- success/error/live-quote states should be legible instantly

### 5. Rules And Timeline

Purpose:
- confidence
- trust
- explainability

These sections should feel:
- sober
- clear
- supportive

Not:
- legal dump
- collapsed afterthought

The page should quietly answer:
- how this market resolves
- when it closes
- what happens at payout

These blocks are especially important for the anti-gambling frame:
- they make the market feel rule-based and analytical
- not impulse-driven

### 6. Community

Purpose:
- social proof
- interpretation
- energy

Community is valuable, but it is not the first job of the page.

It should sit below the core market/trust stack.

It should feel:
- alive
- opinionated
- additive

Not:
- louder than the market

### 7. Related Markets

Purpose:
- extend curiosity
- encourage lateral exploration

This module belongs in the sidebar because it supports the main market without hijacking it.

It should feel:
- adjacent
- tempting
- fast to scan

Not:
- like a recommendation grid explosion

## Visual Character

Market detail should hold the strongest "trade" energy in Hachozeh.

Visual ingredients:
- high contrast
- disciplined glow/accent usage
- precise numerals
- premium spacing
- strong active states

The market should feel electrically alive, but under control.

That means:
- signal, not spectacle
- tension, not chaos

## Motion Guidance

Motion on market detail should be sharper than on portfolio and more precise than on feed pages.

Good candidates:
- page-load reveal that stages title, chart, then rail
- subtle chart hover/point emphasis
- selected outcome state transition
- trade-rail response states with crisp timing

Avoid:
- floaty decorative motion
- constant pulsing
- hyperactive gradients
- flashy transitions on every row

## Typography Guidance

This page depends heavily on type hierarchy.

The typography must clearly separate:
- market question
- outcome labels
- live percentages/prices
- secondary metadata
- trust copy

Requirements:
- Hebrew-first readability
- clean mixed RTL/LTR handling
- crisp numeral rendering
- dense information without visual mud

Market question styling goal:
- urgent enough to matter
- calm enough to read

Current font direction:
- Arimo is the active platform type direction for this pass
- keep numeric/market values crisp and compact
- avoid adding more font families until there is a route-level reason

## Color Guidance

Color should serve:
- state
- action
- movement
- emphasis

Not:
- decoration for its own sake

Recommended behavior:
- one main accent for primary interaction
- distinct but restrained positive/negative movement colors
- careful status colors for open/closed/resolved

Important:
- outcome colors must remain readable and elegant when multiple outcomes appear
- avoid a rainbow toy-board effect

## Legal Framing Implication

This page must never look like a real-money gambling interface.

Avoid cues associated with:
- sportsbook tickets
- casino CTA styling
- jackpot framing
- bet-slip language

Prefer cues associated with:
- trading
- forecasting
- conviction
- analysis
- market participation

Even when the page is exciting, it must still feel:
- strategic
- analytical
- virtual-economy based

## Current Visual Smells To Watch

Based on the current route direction, watch for:
- too many neon states at once
- outcome actions reading too much like yes/no betting buttons
- chart chrome becoming generic dashboard scaffolding
- the sidebar card dominating before the market itself lands
- community/social noise diluting the core trade moment

## Pretext / Text Layout Opportunities

Potential high-value future experiments:
- balancing long market questions
- stabilizing line breaks in outcome names
- handling mixed Hebrew + English + numeric labels
- reducing feed-to-detail layout shift in market title blocks

Use only where it creates visible reading improvement.

## Open Design Questions

Questions worth resolving before implementation-heavy redesign:
- should the outcome ladder feel more like rows or more like stacked market cards
- how much live micro-signal belongs above the fold without clutter
- should the chart and outcome ladder feel like one merged stage or two distinct blocks
- how aggressive should the sticky action behavior be on mobile

## Implementation Guardrails

When the redesign starts:
- do not replace the proven desktop split casually
- do not redesign the trade rail into a betting-slip metaphor
- do not let visual polish hide weak hierarchy
- do not add more controls unless they clearly improve decision speed

## Success Test

The page is successful when a first-time user can answer, within seconds:
- what is this market
- what is happening right now
- what are my options
- what happens if I act

And the page still feels:
- premium
- live
- understandable
