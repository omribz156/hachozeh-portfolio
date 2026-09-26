# Global Menu And Engagement Surfaces

Updated: 2026-04-28
Owner: frontend / shell surface

Purpose:
- define the engagement lane inside the shell before the menu becomes a junk drawer
- lock first philosophy for `leaderboard`, `rewards`, and future product-expansion links
- keep engagement identity separate from trust/support explanation work

Status:
- surface contract for shell engagement work
- doc-first; leaderboard and rewards routes do not exist yet

Read with:
- `systems/design/guide/surfaces/shell/README.md`
- `workspace/docs/design.md`
- `systems/design/guide/components/site-shell.md`
- `systems/design/guide/base/typography-and-print.md`
- `systems/design/guide/surfaces/discovery/feed-system.md`
- `systems/design/guide/surfaces/discovery/live-page.md`

## This Doc Owns

- the menu's engagement group
- leaderboard page philosophy
- rewards page philosophy
- product-expansion link guardrails inside the menu

## This Doc Does Not Own

- FAQ / how-it-works content
- help/docs/legal/social surfaces
- footer trust links
- language or dark-mode truth

Those live in:
- `trust-support-surfaces.md`

## Core Thesis

The three-strip menu is Hachozeh's side corridor.

It should not be:
- a random drawer of leftovers
- a settings dump
- a crypto exchange sidebar
- a graveyard for unfinished routes

It should guide users into:
- compete
- progress
- expand deeper into the product

Short version:
- engagement first
- support separate
- fake routes nowhere

## Menu Grouping Rule

Recommended order inside the drawer:
1. engagement / product-expansion group
2. separator
3. trust/support group, only if those links are real
4. system preferences, only if they are real

Important:
- one physical drawer can host multiple lanes
- grouping still needs to make the lanes obvious
- unfinished pages should be hidden or honestly marked

## Engagement Group

Recommended first group:
- Leaderboard
- Rewards
- APIs, only if a real developer/API surface exists or is clearly future-labeled

These links should feel:
- intentional
- product-shaped
- connected to the platform loop

They should not feel:
- equal to every utility link
- like random leftovers

## Platform Role

These surfaces support the loop after the core trade:

1. discover a market
2. understand the event
3. take a position
4. track portfolio and skill
5. compare performance
6. return with clearer identity/progress

Leaderboard and rewards are not side quests.

They are:
- retention
- identity
- participation surfaces

## Leaderboard Page

Core idea:
- public skill board for forecasting judgment

Primary question:
- who is forecasting well on Hachozeh?

It should feel:
- competitive
- credible
- analytical
- social without childish podium energy

It should not feel:
- a gambling winners list
- a whale board
- a jackpot wall
- a richest-users flex page

Good ranking lenses:
- overall forecast score
- resolved-market accuracy
- virtual portfolio performance, clearly labeled
- consistency over time
- category-specific skill

First useful filters:
- all
- politics
- sports
- economy
- technology
- last 7 days
- last 30 days
- all time

First viewport:
- compact route title
- user's own rank/score if logged in
- restrained top-3 treatment
- ranked table/list visible quickly

Data honesty:
- do not rank until scoring rules are real
- do not show accuracy without enough resolved markets
- do not blur score, accuracy, and virtual portfolio value into one vague flex number
- include minimum-activity thresholds before public rank

Copy guardrail:
- use `score`, `accuracy`, `forecasting`, `rank`, `performance`
- avoid `winners`, `cash`, `payout`, `jackpot`, `biggest earners`

## Rewards Page

Core idea:
- progress and recognition for useful platform participation

Primary question:
- what progress have I earned by participating well?

It should feel:
- motivating
- transparent
- collectible enough to be fun
- serious enough for an analytical product

It should not feel:
- loot box
- bonus page
- casino promotion
- dark-pattern retention trap

Reward types that fit:
- onboarding milestones
- restrained forecasting streaks
- accuracy-based badges
- category expertise
- resolved-market participation
- later community contribution

Reward types to avoid:
- deposit bonus framing
- cashback language
- spin/wheel mechanics
- urgency pressure
- trade-now-to-unlock goblinry

First viewport:
- user's progress summary
- 2 to 3 active tracks
- next useful milestone
- completed badges below

Data honesty:
- rewards should be deterministic and explainable
- each reward needs a clear rule
- locked rewards should show requirements, not mystery bait
- never imply monetary value

## APIs Link

APIs can sit in the engagement group only if the destination is honest.

For now:
- hide it
- disable it
- or mark it clearly future

Do not:
- imply public API availability that does not exist
- treat `API` as generic growth garnish

Detailed docs honesty belongs in:
- `trust-support-surfaces.md`

## Visual Direction

Use:
- dark ink panel
- crisp row rhythm
- small clear icons
- one separator between engagement and trust/support groups when both exist
- subtle liquid-glass edge on the drawer shell only

Avoid:
- heavy rounded-card rows everywhere
- multicolor icon circus
- white dropdown material
- hover-glow spam

The drawer should feel attached to Hachozeh's shell, not pasted in from a third-party widget.

## Mobile Behavior

On mobile:
- the drawer can become the main secondary nav
- rows need clear hit targets
- group labels must stay short
- coming-soon states should not trap taps

Do not:
- bury real route tabs too deeply
- build a second unrelated mobile nav
- blur engagement and trust links into one equal-priority pile

## Backend / Data Notes

Leaderboard likely needs:
- scoring model
- resolved-market history
- user display profiles
- minimum-activity thresholds
- category/time-window aggregation

Rewards likely needs:
- reward definitions
- user progress records
- deterministic evaluation
- later anti-abuse review

Do not:
- derive public leaderboard from raw portfolio value alone
- keep reward state only in frontend local storage
- hardcode fake ranks as if they are real

## Safe Work Now

Safe now:
- improve menu grouping and labels
- hide or mark placeholder engagement links honestly
- route only real existing destinations

Not safe yet:
- fake leaderboard data
- fake rewards progress
- public API claims
- prize/bonus language
- dark-pattern streak pressure

## Acceptance Test

This lane succeeds if:
- the engagement group feels intentional
- leaderboard feels like skill, not gambling
- rewards feel like progress, not promotions
- placeholder routes are honest

It fails if:
- the menu becomes a random pile of links
- leaderboard becomes a richest-users flex board
- rewards drift into casino language
- APIs overpromise
