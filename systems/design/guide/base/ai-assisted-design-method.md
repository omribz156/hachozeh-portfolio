# AI-Assisted Frontend Design Method

Updated: 2026-04-30
Owner: frontend / product design lane

Status:
- current method note for design sessions with Codex/agents
- distilled from the three deep research notes in `workspace/docs/research/`
- complements `workspace/docs/design.md`; does not replace route docs

Purpose:
- improve how human taste becomes usable agent instructions
- prevent "AI slop" by making intent, references, critique, and craft explicit
- give future frontend sessions a repeatable way to make beautiful product pages

## Thesis

Great AI-assisted design does not come from one perfect prompt.

It comes from a loop:
- sharper intent
- real product objects
- focused references
- structurally different mocks
- honest critique
- staged implementation
- browser verification
- small durable docs

The agent is not magically "a designer". It becomes useful when the human and
agent build a shared language for what good means.

## The Intent Stack

Before asking for visual work, define the stack:

1. Product job
What must this surface help the user do?

2. User moment
What is the user trying to understand, decide, compare, or complete?

3. Domain object
What real object is being designed?

For Hachozeh, common objects are:
- market
- outcome
- probability
- chart
- position
- trade ticket
- rule
- timeline
- portfolio state
- discovery feed

4. Visible anatomy
What must be visible immediately, and what should stay quiet until intent appears?

5. Reference anatomy
What specific move are we borrowing from another product?

Examples:
- Polymarket: market aliveness, fast scan, compact outcome/action rhythm
- Kalshi: trust, rules, timeline, lifecycle clarity
- Linear/Superhuman/Stripe: type discipline, quiet density, premium restraint

6. Anti-goals
What should not come back?

Examples:
- generic SaaS cards
- boxed dashboard stacks
- decorative fake charts
- marketing hero copy on product surfaces
- casino/sportsbook energy

7. Judgment rule
How will we know this pass works?

Example:
The user should understand the live market, leading outcomes, movement, and
available action in three seconds, without a marketing CTA.

## Prompt Shape

Bad prompt:

```text
Make the hero beautiful and premium.
```

Better prompt:

```text
Design a front-page hero for Hachozeh.

This is not a marketing hero. It is a live market object.
The market itself is the content: question, outcomes, probability movement,
volume, and close time.

Use Polymarket only for anatomy: title at top, outcomes as quick read,
chart as the main live object, minimal words.
Use Kalshi only for trust/clarity: sober hierarchy and useful market context.

Avoid generic SaaS cards, spacey AI hero shapes, fake news/social complexity,
extra CTAs, and decorative charts.

Use real Hebrew/RTL stress content and long-title cases.
Show 10 structurally different directions, not color variants.
```

## Mock Rules

Mockups are useful only when they test different structural ideas.

Good mock set:
- one Polymarket-anatomy baseline
- one dense market-board direction
- one editorial/live-news direction
- one chart-first direction
- one outcomes-first direction
- one mobile-first direction
- one ultra-minimal direction
- one high-density trader direction
- one local/Hebrew editorial direction
- one intentionally weird direction for contrast

Bad mock set:
- same card repeated with different gradients
- spectacle without product mechanics
- fake data that makes the layout look better than the product can support
- full-page redesign when the slice is one component

## Craft Rules

Work in this order:

1. Structure
Is the product object clear before styling?

2. Hierarchy
Does the first read happen in the right order?

3. Typography
Are size, weight, line-height, and Hebrew stress cases doing real work?

4. Spacing
Are sections separated through rhythm before borders?

5. Surface
Do fills, borders, shadows, and blur help, or are they hiding weak structure?

6. Color
Does color carry meaning, state, or attention?

7. Motion
Does motion explain state, selection, scroll, or transition?

8. Responsive behavior
Does the surface compress progressively instead of jumping?

9. Data truth
Are charts, odds, prices, and volumes real or honestly placeholder?

## Practical Craft Defaults

Use these as defaults, not laws:
- 8px spacing rhythm for structure
- 4px corrections for optical alignment
- fluid type with `clamp()` for major headings
- progressive sticky compression rather than hard jumps
- fewer borders and more spacing when deboxing a page
- shadows/glow only where they explain elevation or focus
- color tied to state: yes/no, buy/sell, selected, disabled, live, risk
- motion only when it clarifies cause and effect

Avoid treating "premium" as:
- more blur
- more glow
- more gradient
- more glass
- more animation
- more cards

Premium is usually:
- clearer hierarchy
- calmer spacing
- better typography
- fewer words
- precise interaction
- honest data

## Critique Rubric

Before implementing a visual direction, ask:
- Does this feel like a real product people can use?
- Can the user operate it without reading a paragraph?
- Does the domain object lead the composition?
- Does the design survive long Hebrew, RTL, real numbers, and narrow screens?
- Are charts and market signals meaningful, not decorative?
- Did we remove repeated labels and unnecessary CTAs?
- Would this still feel like Hachozeh if the logo disappeared?
- Did rejected ideas stay rejected?

## Hachozeh Translation

For Hachozeh, the page should feel like:
- a live Hebrew prediction market
- premium but not luxury-cosplay
- analytical but not cold
- game-like but not gambling-coded
- dense enough to feel alive
- simple enough to operate

The safest design move is usually:
- start from the market mechanic
- expose the minimum useful state
- let typography and spacing carry hierarchy
- keep action close to intent
- verify in browser with real backend data

## Working Loop

1. Read the route doc and current design doctrine.
2. Inspect the current page in browser.
3. Compare references by anatomy, not vibe.
4. Write the intent stack for the slice.
5. Create focused mock options if shape is open.
6. Select and record what won and what was rejected.
7. Implement in `systems/design/stage/` or mockup first.
8. Browser-check desktop, narrow, scroll, long text, and interactions.
9. Promote only after the stage earns it.
10. Update the relevant guide doc with durable decisions.

The loop is the product. The page is the receipt.
