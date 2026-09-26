# Live Page Design

Updated: 2026-05-03
Owner: frontend / discovery surface

Purpose:
- define Hachozeh's future `live` discovery route before implementation
- keep the page distinct from `trending`, `breaking`, and `new`
- create a design target that feels alive without becoming noisy or fake

Status:
- surface contract for the live page direction
- first stage proof now exists at `systems/design/stage/live.html`
- stage proof is static/local for shape only; it is not canonical and not backend-wired yet

Read with:
- `systems/design/guide/surfaces/discovery/README.md`
- `workspace/docs/design.md`
- `systems/design/guide/surfaces/discovery/feed-system.md`
- `systems/design/guide/surfaces/discovery/discovery-route-spec.md`
- `systems/design/guide/surfaces/discovery/discovery-feed-contract.md`
- `systems/design/guide/surfaces/discovery/discovery-card-role-spec.md`
- `systems/design/guide/surfaces/discovery/feed-card-composition.md`
- `systems/design/guide/base/typography-and-print.md`

## This Doc Owns

- the deep design target for the future `live` route
- live-specific page structure, honesty rules, and signal hierarchy

## This Doc Does Not Own

- the whole discovery family
- generic route-composition rules for every route
- the general discovery feed contract

Those live in:
- `feed-system.md`
- `discovery-route-spec.md`
- `discovery-feed-contract.md`

## Core Thesis

The live page is Hachozeh's action radar.

It should answer:
- what is happening now
- which markets are moving right now
- where user attention should go first

It should feel:
- electrifying
- immediate
- precise
- premium
- controlled

It should not feel:
- chaotic
- casino-like
- like a generic news ticker
- like a crypto exchange clone
- like `breaking` with extra badges

Short version:
- live, not loud
- signal, not noise
- market room, not alarm room

## Frontend Skill Frame

Visual thesis:
- an ink-blue civic trading floor at the moment the room wakes up; live signals cut through restrained ledger surfaces with sharp, controlled energy

Content plan:
- opening now-stage
- active pulse rails
- grouped live feed
- calm continuation into more markets

Interaction thesis:
- initial load should feel like signals locking into place, not cards popping randomly
- live-state changes should use restrained updates, not constant blinking
- hover/focus should sharpen a market's signal and route to detail, not simulate trade execution

## Product Role

Users who open live already want the current moment.

They are not browsing casually like `trending`.
They are not only looking for biggest movers like `breaking`.
They are not checking inventory like `new`.

They are asking:
- where is attention concentrated now
- which market changed recently
- which market is active enough to inspect
- which event feels alive this minute

The page should make them feel:
- "I can read the room quickly"
- "I know where the action is"
- "This is live, but still trustworthy"

## Difference From Breaking

`breaking` is about sudden movement.

`live` is about current activity.

Breaking leads with:
- delta
- volatility
- surprise
- underdog shifts

Live leads with:
- recency
- activity
- current participation
- active price/outcome movement
- market freshness

Important:
- a market can be breaking without being live now
- a market can be live without being a huge mover
- do not collapse both routes into the same ranked mover list

Design difference:
- `breaking` feels like controlled urgency
- `live` feels like an active market floor

## Data Honesty

Live must be honest.

Do not create a page that visually claims real-time behavior if the backend only has seeded/static markets.

Safe live signals:
- `updatedAt`
- recent price/probability changes, if real
- recent volume or participation, if real
- market status
- active backend feed flag, if real
- short-horizon movement summary, if derived honestly

Unsafe fake signals:
- fake pulse dots
- fake online-user counts
- fake trade counts
- random animated tickers
- looping movement that does not reflect backend data
- "live now" labels when the market is merely open

Fallback rule:
- if true live data is not available, the first implementation can be "recently active"
- label it honestly in UI and code
- do not call it live in a way that overpromises

## Backend Contract Need

The live page likely needs a richer discovery read model than `trending`.

Useful future fields:
- `signals.isLive`
- `signals.liveReason`
- `signals.lastActivityAt`
- `preview.movement.shortWindow`
- `preview.movement.displayDelta`
- `preview.activity.displayLabel`
- `preview.activity.intensity`
- `preview.sparkline`
- `groups.liveBucket`

These should be derived/read-model fields.

Do not add visual fields to core engine truth:
- `liveCardSize`
- `heroLayout`
- `tickerColor`
- `pulseAnimation`

The engine owns market truth.
The discovery read model owns live grouping.
The frontend owns composition.

## Page Structure

Current stage-proof structure:
1. right category rail
2. center main live market
3. center secondary live market grid with a bottom peek
4. left trade ticket based on the market-detail ticket anatomy

Earlier generic structure:
1. live now-stage
2. pulse strip
3. grouped live feed
4. more active markets
5. quiet empty/fallback state

Current direction supersedes the generic pulse-strip version for the first live
page proof. The page should feel more like a live sports center / event market
room than a broad discovery dashboard.

The page should start fast.

Do not spend the first viewport on explanation.
Live users need the market room, not a brochure.

## Live Now-Stage

Role:
- the strongest current live moment
- one market that deserves immediate attention

Content:
- live state label
- market title
- strongest current signal
- leading outcome / probability
- short sparkline or compact movement chart
- freshness text
- route-to-detail action

Visual direction:
- one central event object, not a grid card enlarged by accident
- top reads like a selected live market state, not marketing copy
- middle reads like team/event state
- bottom reads like market-detail chart truth
- dark ink base with sharp but restrained blue signal
- no casino glow

Hierarchy:
1. selected market probability
2. selected market label
3. score / live minute / event identity
4. chart movement
5. close / location / supporting facts

Possible UI copy direction:
- "חי עכשיו"
- "עודכן כעת"
- "תנועה בדקות האחרונות"
- "פתח שוק"

Avoid:
- "הימור חי"
- "זכייה"
- "קאש אאוט"
- jackpot language
- fake urgency copy

## Current Stage Proof

Runtime files:
- `systems/design/stage/live.html`
- `systems/design/assets/js/pages/live-stage.js`
- `systems/design/assets/css/stage/live.css`

Current visual decision:
- 3-column layout
- right rail = one-line live category rail
- center = one main live market plus 2 visible secondary cards and 2 peeking cards
- left = market-detail-like trade ticket

Chosen main-card anatomy:
- top shape from the "Trading Tape" mock direction
- middle team-v-team row from the "Market Board" mock direction
- bottom chart/footer from the "Market Board" mock direction

Important implementation notes:
- team row must be a true 3-part grid
- team crests tuck toward the score/time center, not toward page edges
- main chart should stay close to market-detail chart language
- secondary cards should stay simple; no mini charts in the first pass
- live page action ticket should eventually be extracted from market-detail instead of being hand-copied

Known status:
- stage page is useful for design shaping only
- content is static placeholder data
- no backend live ranking seam exists yet
- no canonical route promotion yet
- next architectural move should be extracting reusable market-detail pieces before expanding live behavior

## Pulse Strip

Role:
- compact read of the live room
- bridge between now-stage and feed

Possible groups:
- most recently updated
- highest activity
- biggest short-window shift
- closing soon and active

Visual direction:
- horizontal rail on desktop
- compact stacked modules on mobile
- sharp numeric read
- quiet labels
- small movement indicators

Rules:
- do not overload with too many chips
- 3 to 4 pulse cells is enough
- each pulse cell needs one clear reason to exist

Good pulse cell:
- label
- one number/signal
- one market title or category hint

Bad pulse cell:
- label, icon, badge, timer, chart, percentage, avatar pile, CTA, and confetti goblin

## Grouped Live Feed

The feed should be grouped by live behavior, not by generic categories.

Recommended group names:
- moving now
- just updated
- active near close
- watched markets
- new live activity

Use Hebrew UI labels later, but keep the product meaning above.

Preferred card role mix:
- `signal-led`: primary
- `emphasis`: frequent but controlled
- `standard`: supporting
- `featured`: only the opening now-stage

Feed rhythm:
- denser than `trending`
- sharper than `new`
- less panic than `breaking`
- more grouped than the broad landing feed

Do not make the whole page one endless identical signal-card list.

## Signal-Led Card For Live

Live signal-led cards should prioritize:
- current signal
- title
- freshness
- route

Recommended hierarchy:
1. live/freshness marker
2. dominant signal
3. market title
4. outcome preview
5. detail action

Dominant signal examples:
- probability changed in the last window
- leader switched
- volume/participation increased
- market updated recently
- close time is near and activity is high

Visual rules:
- signal zone can be stronger than standard cards
- title must not disappear
- freshness should read as real data, not decoration
- use one accent at a time

Bad:
- every card glowing
- every card pulsing
- all deltas red/green neon
- decorative sparklines with no read value

## Typography

Use the platform tone from `typography-and-print.md`.

Current platform type direction:
- display / route title: `Arimo`
- UI / labels / numbers: `Arimo`
- tiny technical/chart support: `IBM Plex Mono` only where useful

Live-specific rule:
- numbers and freshness labels need stronger discipline than the route title
- the live page succeeds by making current signals readable quickly

The page title should not become a marketing hero.

Good title direction:
- compact
- serious
- immediate

Bad title direction:
- giant inspirational headline
- generic "Discover what's happening"
- startup SaaS hero copy

## Color And Material

Base:
- dark blue / ink-led Civic Ledger palette

Live accent:
- cool electric blue is safer than casino green/red
- positive/negative movement should stay softened
- activity/freshness can use a separate restrained cyan/blue signal

Material:
- ink ledger panels for data
- thin borders
- controlled depth
- liquid-glass influence only on edges, selected state, and small controls

Do not:
- make the page a translucent glass dashboard
- put glass behind dense numeric rows
- use neon gradients as the identity
- make red/green the primary brand feeling

## Motion

Motion should make live feel current.

Good motion:
- initial signals settle in with a short stagger
- updated rows can use a brief edge highlight
- hover/focus sharpens the signal zone
- feed additions preserve scroll stability
- top-stage chart/sparkline can animate in once, not loop forever

Bad motion:
- constant blinking
- fake ticker movement
- pulsing every live badge
- decorative animated particles
- any motion that makes the user trust the data less

Motion principle:
- live motion should say "fresh data arrived"
- not "look, animation"

## Chart And Sparkline Use

Live page charts should be compact and useful.

Use sparklines for:
- short-window movement
- direction
- quick scan

Do not use sparklines for:
- decorative texture
- fake market complexity
- unreadable tiny spaghetti

Rules:
- only show a sparkline when data exists
- no fake interpolation for thin history
- axis can be omitted on small cards, but tooltip/detail view must carry exactness later
- market-detail remains the place for full chart reading

## Empty And Thin States

The live page needs a non-embarrassing low-data state.

If no true live signals exist:
- show a calm "recently active markets" version
- explain that live ranking needs fresh market movement
- route users into trending/new without making the page feel broken

If data is stale:
- show freshness honestly
- reduce live intensity
- avoid active pulse visuals

If market count is low:
- do not pad with fake live cards
- show fewer stronger items
- let the page breathe

## Mobile Direction

Mobile live should feel like a fast signal stack.

Mobile structure:
- compact live now-stage
- 2 to 3 pulse cells
- grouped signal-led feed
- sticky route tabs only if already part of shell behavior

Mobile rules:
- avoid horizontal overflow traps
- keep market titles readable in RTL
- avoid tiny chart hitboxes
- keep action targets clear
- do not force desktop rails into cramped mobile rows

## Anti-Gambling Guardrails

Live can easily drift into sportsbook energy.

Avoid:
- bet slip language
- cash-out language
- win/jackpot language
- odds-board styling
- flashing red/green odds
- urgency designed to pressure action

Prefer:
- market activity
- position
- probability
- forecast
- movement
- update
- analysis

The page should invite attention and inspection.
It should not pressure users to trade.

## Implementation Guardrails

Do not implement live by:
- copying `breaking-markets.html`
- hardcoding fake live data
- inventing a new card system unrelated to discovery
- adding presentation fields to engine SQL
- making live route logic depend on CSS-only tricks

Safe first implementation later:
- create page shell
- use shared discovery card family
- add live-specific grouping only if data exists
- start with honest "recently active" fallback if needed
- keep all trading actions inside market-detail

First useful implementation should prove:
- route identity
- signal hierarchy
- data honesty
- card rhythm
- mobile readability

Not:
- full backend live infrastructure
- perfect ranking algorithm
- new design system

## Acceptance Test

Live page succeeds if:
- it feels like the most immediate discovery surface in Hachozeh
- it is clearly different from `breaking`
- it still belongs to the same Civic Ledger platform
- users can identify the strongest live market quickly
- signals feel truthful, not theatrical
- the page avoids gambling/sportsbook cues
- market-detail remains the primary trading surface

Live page fails if:
- it becomes a generic dark dashboard
- it clones `breaking`
- it uses fake live movement
- every card screams equally
- animation harms trust
- it looks like a crypto/casino product

## Open Decisions

Before implementation:
- define which backend fields are enough for an honest first live route
- decide if v1 is truly `live` or an honest `recently active` fallback
- choose the opening now-stage market selection rule
- decide how many live groups appear in the first viewport
- test card density on mobile before building a large feed

Recommended next step:
- keep market-detail as the first visual proof page
- keep this doc as the live-page surface contract
- implement live only after discovery read-model work can support honest current activity
