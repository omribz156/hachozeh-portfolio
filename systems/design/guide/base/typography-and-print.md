# Typography And Print Tone

Updated: 2026-04-29
Owner: frontend / product design lane

Purpose:
- define the design tone for Hachozeh before broad visual rollout
- make typography and print/editorial feeling part of the product identity
- keep future redesign work from becoming generic app polish

Status:
- current frontend typography direction
- Arimo is the active platform proof font
- older Noto Serif / Noto Sans exploration is historical unless explicitly revived

## Core Thesis

Hachozeh typography should feel like:
- financial newspaper
- live trading desk
- civic forecasting arena

Not:
- generic SaaS
- crypto dashboard
- sportsbook
- startup template
- tech blog

The goal is a platform-wide tone:
- premium
- analytical
- locally grounded
- easy to scan
- alive without shouting

## Why Typography Matters Here

For Hachozeh, typography is not decoration.

Typography must carry:
- luxury
- trust
- Hebrew-first clarity
- market tension
- anti-slop identity

If the type system feels generic, the whole product will feel generic even if the layout improves.

## Platform Tone

The platform should feel:
- composed
- editorial
- market-aware
- controlled
- confident

It should not feel:
- cute
- over-friendly
- casino-like
- terminal-cold
- inflated with fake importance

Good mental model:
- a sharp Hebrew financial paper became a live market product

Not:
- a dashboard got Hebrew labels pasted on it

## Hebrew-First Rules

Hebrew text is the main product language.

Rules:
- Hebrew rhythm comes first
- English and numbers must support Hebrew, not disrupt it
- titles must wrap gracefully in RTL
- metadata should stay compact and readable
- do not choose a font because it looks good only in English demos

Important:
- Hebrew market questions can get long
- typography must preserve authority without making long titles feel like walls

## Numerals And Market Data

Numbers are part of the brand.

Market data must feel:
- precise
- calm
- immediately readable

Numeral needs:
- percentages
- prices
- `V₪`
- PnL
- portfolio values
- dates and times
- ranks and movement deltas

Rules:
- numbers should scan faster than surrounding prose
- movement deltas should feel controlled, not alarmist
- price/probability typography should be stronger than labels but not louder than the market question

Avoid:
- tiny faint numbers that look decorative
- huge casino-style gains
- mixed numeral styles that make the UI feel accidental

## Print / Editorial Feeling

Hachozeh should borrow from print where it helps:
- hierarchy
- rhythm
- section identity
- title confidence
- visual breathing room

It should not become:
- a literal newspaper layout everywhere
- slow editorial reading product
- heavy magazine cosplay

Use print influence for:
- strong headings
- market-title authority
- route openers
- category tone
- trust/resolution sections

Use product UI discipline for:
- trading actions
- portfolio data
- admin/control surfaces
- dense feed scanning

## Type Roles

The platform needs clear type roles:

### Display / Brand Voice

Use for:
- major route openers
- featured market stage
- strong editorial modules

Tone:
- distinctive
- confident
- premium

Do not overuse.

### Market Title

Use for:
- card titles
- market-detail question
- related-market headings

Tone:
- direct
- analytical
- readable fast

This is the most important type role in the product.

### Numeric / Price

Use for:
- probabilities
- prices
- portfolio values
- movement deltas

Tone:
- precise
- strong
- stable

Numbers should feel like trustworthy market state.

### Utility UI

Use for:
- labels
- chips
- tabs
- filters
- buttons
- admin controls

Tone:
- clear
- compact
- calm

This layer should not steal personality from the title/numeric layers.

### Trust / Explanation

Use for:
- rules
- timeline
- resolution
- legal framing
- help copy

Tone:
- sober
- readable
- not lawyer-heavy

## Route Tone Guidance

### Trending

Type feeling:
- open
- abundant
- editorial enough to feel curated

Titles:
- compact but expressive

Numbers:
- strong but secondary to breadth

### Breaking

Type feeling:
- sharper
- more urgent
- still controlled

Titles:
- can be slightly tighter and more forceful

Numbers:
- movement/delta should be first-read in signal-led cards

### New

Type feeling:
- clean
- direct
- browse-first

Titles:
- simple, readable, less dramatic

Numbers:
- supportive, not theatrical

### Live

Type feeling:
- electric
- immediate
- strong signal hierarchy

Titles:
- second to live state when needed, but never buried

Numbers:
- most prominent of the feed routes

### Market Detail

Type feeling:
- strongest product authority

Market question:
- high authority
- high readability
- not oversized for drama alone

Numbers:
- precise and tradable

Trust copy:
- calm enough to reduce gambling vibes

### Portfolio

Type feeling:
- status board
- calm command

Numbers:
- clear and dominant

Labels:
- restrained

Avoid:
- fake analytics-dashboard styling

### Admin / Control Plane

Type feeling:
- operational
- plain
- reliable

This area should be less expressive than consumer surfaces.

But:
- it should still feel like Hachozeh
- not a random admin template

## Font Direction

Current platform direction:
- primary UI/display: `Arimo`
- fallback: `Noto Sans Hebrew`, system UI
- technical/chart/tiny numeric support: `IBM Plex Mono`

Arimo is active because:
- Hebrew support is strong enough for dense UI
- it feels clean without becoming sterile
- it is compact enough for market rows and sticky headers
- it gives the platform a more real/product feel than generic system stacks

Font choices must satisfy:
- strong Hebrew support
- strong numeral rendering
- enough personality to avoid default SaaS tone
- good readability at dense UI sizes
- clean behavior in mixed Hebrew/English/number strings

Avoid:
- default system stacks as identity
- overused neutral UI fonts without a strong reason
- display fonts that only work in Latin
- novelty fonts that make trust surfaces weaker

Keep it to:
- one or two type families unless a real need appears

Important:
- do not add another display font just because a mockup feels quiet
- fix hierarchy, spacing, and copy density first
- any new typeface needs a focused proof before global adoption

## Color And Type Relationship

Typography should carry identity before color does.

Color should support:
- state
- movement
- focus
- action

Not:
- compensate for weak hierarchy

If a card only feels distinct because of color, it is probably under-designed.

For the first `Civic Ledger` proof:
- keep dark blue as the base direction
- shift from generic slate-card darkness toward an ink-blue ledger palette
- keep accents controlled
- soften positive/negative colors so they read as market signals, not casino/neon cues

Liquid Glass influence:
- acceptable as an edge/control-layer inspiration
- not acceptable as the main content material
- keep dense market data on stable ink-led surfaces
- use liquid-like depth sparingly for rails, controls, selected states, and transient feedback

## Motion And Type Relationship

Motion can make typography feel alive.

Good:
- measured title reveal
- numeric state update with restrained transition
- card append reveal that preserves reading flow

Bad:
- bouncing labels
- pulsing numbers everywhere
- kinetic type that makes Hebrew harder to read

## One-Page Proof Rule

Before platform-wide rollout:
- create one proof page
- test the design tone there
- review visually
- only then expand

The proof page should answer:
- does the typography feel like Hachozeh
- does it improve scanability
- does it avoid generic slop
- does it preserve Hebrew-first confidence
- does it avoid gambling/product-risk cues

Current proof state:
- `market-detail` proved the Arimo direction well enough to treat it as the current platform tone
- `trending` should reuse Arimo while solving hero/feed rhythm
- do not restart typography exploration during front-page hero work unless the type itself is clearly blocking the shape

## Anti-Slop Checks

Typography fails if:
- it looks like a default SaaS dashboard
- Hebrew feels like an afterthought
- numbers do not feel trustworthy
- market titles are timid or generic
- every route feels textually identical
- the page would still look the same with a random brand name

Typography succeeds if:
- the product feels authored before color/images do any work
- market questions feel important
- prices and probabilities feel precise
- dense feeds remain readable
- trust sections feel serious without becoming heavy

## Open Decisions

Still open:
- exact global type scale
- route-specific display sizes
- numeric tabular behavior in all browsers
- whether IBM Plex Mono should appear only in charts/tiny meta or broader numeric support

Not open unless explicitly reopened:
- returning to the Noto Serif / Noto Sans proof as the primary platform direction
