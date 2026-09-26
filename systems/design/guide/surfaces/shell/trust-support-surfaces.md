# Trust And Support Surfaces

Updated: 2026-04-28
Owner: frontend / shell surface

Purpose:
- define the trust/support lane separately from engagement work
- lock first philosophy for FAQ, docs, help, legal, social, language, and theme honesty
- keep explanation and trust surfaces from getting mixed into leaderboard/rewards logic

Status:
- surface contract for shell trust/support work
- doc-first; several destinations do not exist yet

Read with:
- `systems/design/guide/surfaces/shell/README.md`
- `workspace/docs/design.md`
- `systems/design/guide/components/site-shell.md`
- `systems/design/guide/base/typography-and-print.md`

## This Doc Owns

- FAQ / how-it-works direction
- documentation/help-center strategy
- terms/privacy/legal surface philosophy
- accuracy/trust explanation pages
- official social/support destinations
- footer trust links
- language and theme honesty rules

## This Doc Does Not Own

- leaderboard
- rewards
- engagement menu hierarchy
- participation identity loops

Those live in:
- `global-menu-and-engagement-surfaces.md`

## Core Thesis

Trust/support surfaces are Hachozeh's clarity spine.

They should help users understand:
- what Hachozeh is
- what virtual shekel means
- why it is virtual
- how prices work
- how outcomes resolve
- where the platform's limits are
- where to get help

They should feel:
- calm
- precise
- Hebrew-first
- serious without legal sludge
- accessible to non-experts

They should not feel:
- footer filler
- generic FAQ template sludge
- a legal escape hatch
- marketing fluff hiding the mechanics

## Surface Rule

Trust/support destinations may appear in:
- the drawer
- the footer
- header help links
- FAQ/how-it-works CTAs

That does not make them "menu docs."

Their product job is:
- explanation
- safety
- clarity
- support routing

## Recommended Trust Group

Useful trust/support set:
- Accuracy
- Documentation
- Help Center
- FAQ / How It Works
- Terms of Use
- Privacy
- Language
- Dark mode
- official social channels

Rules:
- route only to real pages or honest future placeholders
- do not let social links outrank product-trust links
- do not show fake language or theme controls
- keep official destinations clearly labeled

## FAQ / How It Works

Core idea:
- explain the prediction-market mechanic without gambling confusion

FAQ should explain:
- what Hachozeh is
- what virtual shekel is
- why it is virtual
- how market prices work
- how outcomes resolve
- how portfolio/positions work
- what accuracy means
- what is not allowed
- how to get help

Tone:
- plain Hebrew
- specific
- calm
- not legalese-first

Avoid:
- hiding mechanics behind marketing copy
- implying real-money withdrawal
- using `bet` as the default metaphor
- burying the virtual-currency constraint

## Documentation / Help Center / Terms

These are product surfaces, not link filler.

Documentation should cover:
- market mechanics
- API/developer docs if real
- source/resolution docs later

Help Center should cover:
- support workflows
- account/session issues
- market/trade explanations
- virtual-currency questions

Terms and Privacy should cover:
- product/legal boundaries
- virtual-currency framing
- non-withdrawable virtual shekel
- user conduct
- account/data handling

## Accuracy Page

Core idea:
- explain resolved-market history and forecasting accuracy clearly

It should show:
- resolved markets
- how accuracy is measured
- limitations and caveats
- source/resolution notes where relevant
- enough history to trust the system

It should not:
- overclaim prediction certainty
- treat prices as absolute truth
- hide thin data
- gamify accuracy into pressure

## Social And Official Links

Social refs should support:
- official updates
- community discussion
- support routing
- trust / transparency

Good destinations:
- official X/Twitter
- Telegram announcements
- moderated community spaces if real
- email/contact/help center

Rules:
- do not ship placeholder URLs
- mark official channels clearly
- do not imply trading advice or financial signals
- do not let community links outrank explanation/help surfaces

## APIs / Developer Docs

API docs belong in this lane when they are about:
- public docs
- allowed usage
- rate limits
- contact path
- source/accuracy policy

If an `API` link appears in the engagement group, this doc still owns the honesty rules behind the destination.

## Language And Theme Honesty

Language:
- Hachozeh is Hebrew-first
- multilingual support can come later
- do not show a fake language submenu

Theme:
- current platform direction is dark / ink-led
- do not show a light-mode toggle unless a real light theme exists
- do not imply theme parity that is not shipped

## Visual Direction

Trust/support pages should feel:
- editorial
- clear
- premium
- calmer than live/market-detail
- more explanatory than feeds

Use:
- Civic Ledger typography
- strong section headings
- short answer blocks
- sober callouts for legal/virtual-currency boundaries
- ink-led surfaces with reading comfort

Avoid:
- generic accordion soup
- dense legal walls with no product explanation
- promo-colored trust pages
- disconnected support surfaces

## Content / Backend Notes

Trust/support routes likely need:
- static content first
- durable Hebrew copy
- real destinations before links ship
- later CMS/admin only if the need becomes real

Do not:
- depend on trading-engine tables for support pages
- store core legal/product truth only in components
- bury virtual-currency framing in unreachable legal pages

## Safe Work Now

Safe now:
- strengthen FAQ/how-it-works flow
- improve footer/menu labels
- remove or mark placeholder trust/support links
- make virtual-currency framing easier to find

Not safe yet:
- placeholder social URLs
- public API claims
- fake language support
- fake theme toggles
- legal copy that contradicts product framing

## Acceptance Test

This lane succeeds if:
- users understand virtual shekel and platform limits quickly
- support links go somewhere real or are honestly deferred
- accuracy explains limits clearly
- official/social links feel safe and explicit

It fails if:
- trust links become filler
- mechanics stay hidden
- social links point nowhere
- fake toggles imply unsupported behavior
