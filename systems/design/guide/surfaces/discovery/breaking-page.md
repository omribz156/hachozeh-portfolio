# Breaking Page Surface

Updated: 2026-05-25
Status: shipped first integration · live design
Owner: frontend / discovery surface

Purpose:
- pin the design contract for `pages/breaking-markets.html`
- keep breaking distinct from its siblings (`trending`, `live`, `new`)
- track the plasters that ship with the first integration and their deletion conditions

Read with:
- `README.md` (sibling family doctrine)
- `live-page.md` (sibling — for difference-from-breaking contrast)
- `discovery-route-spec.md`, `discovery-feed-contract.md`
- `workspace/coordination/front-breaking.md` (active asks + shared seams)

## This Doc Owns

- the breaking page's product job
- the in-page layout and visual moves
- the responsive contract
- the active plasters and their deletion conditions
- what is deliberately excluded from this surface

## This Doc Does Not Own

- the discovery family doctrine (`README.md`)
- the route-by-route composition rules (`discovery-route-spec.md`)
- the backend feed item shape (`discovery-feed-contract.md`)
- the card-role family (`feed-card-taxonomy.md` and friends)

## Product Role

Breaking answers a single, specific question:

> מה זז הכי הרבה ב-24 השעות האחרונות?

Users on breaking are not browsing (`trending`), not watching a live event room (`live`), and not checking inventory (`new`). They want a fast scan of the largest probability swings in the recent window.

Reference semantics:
- Polymarket-style `featured` / `featuredOrder` is promotion/editorial placement, not proof that a market moved.
- Polymarket-style tag pages such as `breaking-news` are taxonomy/collection pages, not the same thing as "largest recent probability movers."
- The data this page needs is movement-first: backend-owned current probability vs prior probability, named moved outcome, and window.
- If a market is also editorially promoted or attached to a breaking-news topic, that should arrive as separate metadata; the row should not infer it from `updatedAt` or trade volume.

The page should feel:
- controlled urgency, not panic
- ledger-clean, not casino-loud
- ranked, not editorial
- readable at a glance, not animated

The page should not feel:
- like a generic "breaking news" ticker
- like a sportsbook movers board
- like an alert dashboard

## In-Page Layout

Above 1024px:

```
┌────────────────────────────────────────────────────────────────┐
│  site-shell (header)                                            │
├────────────────────────────────────────────────────────────────┤
│  HERO BANNER  (date · title · sub · trend motif on the left)   │
├────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────┐  ┌──────────────────┐    │
│  │ CHIPS  (derived from feed)        │  │ mail signup      │    │
│  │                                   │  │  (PLASTER)       │    │
│  │ rank · glyph · title · track · %  │  ├──────────────────┤    │
│  │ rank · glyph · title · track · %  │  │ @hachozeh feed   │    │
│  │ ...                               │  │  (PLASTER)       │    │
│  └──────────────────────────────────┘  └──────────────────┘    │
├────────────────────────────────────────────────────────────────┤
│  site-shell (footer)                                            │
└────────────────────────────────────────────────────────────────┘
```

The row anatomy (RTL, right-to-left visual order in the user's eye):

```
[rank]  [glyph]  [title spanning available width]  [delta track]  [price + signed delta]
```

The delta track is the only visual signal that isn't redundant with the price + delta text — it carries the *distance moved* across the 0–100 range, with the prior position dashed and the current marker filled.

Refinements (2026-06-23):
- **Track orientation: 0% left, 100% right** (was 0% right). Higher probability reads rightward, so a *rise* travels right and a *drop* left — the conventional numeric-axis read.
- **Moved-outcome sub-label** under the title: multi/matchup rows name *who* moved (`↓ אביגדור ליברמן`, `↑ מכבי ת״א`) with a tone-colored arrow, since the question alone can't say which outcome swung. Binary rows omit it (the question is the subject). Only an exact `movement.outcomeKey` match earns a name — no mislabeling a fallback.
- **Event markets are not gated** — for an event, the ladder `outcomes` ARE the child markets and `movement.outcomeKey` points at a child's side (`<childKey>-outcome-yes|no`). The row resolves the moving child and normalizes the no-side delta to the child's yes-chance, so `בחירות ישראל ב-2026` shows e.g. `↑ יולי 51% +9` instead of a meaningless container-level move.

## Hero Banner

- left text block: today's date (Hebrew long form, mono-styled), surface title "חדשות מתפרצות", one-line sub
- right motif: trend SVG that fades into the banner background; decorative only, not data-bound
- no CTA in the hero — the page is the CTA

The hero does not change with the data. It is identity, not a card.

## Category Chips

- always include "הכל" first
- the rest are derived from the feed: count `category.key` occurrences in the current feed, sort by count desc, take the top 7
- the active chip writes `?category=<key>` to the URL (replaceState, not push — back-button should leave the page, not cycle chips)
- if the URL holds a category that isn't in the derived set (e.g. the feed shifted), fall back to "all" silently and clear the param

This is the same precedent as trending — do not hardcode a category vocabulary on this page.

## Market Rows

- ranking is by `|delta|` desc (biggest movers first), regardless of sign
- the row is the click target; href routes to `market-detail.html?market=<id>`
- when `delta` is missing for an item, render `—` in the delta slot and a neutral flat track (single marker, no ghost, no tinted span) — *do not synthesize*
- the glyph swatch uses the page-local CAT_GLYPH map; the long-term home is the shared category-presentation module (front-breaking.md · seam S1)

## Right Rail

Editorial, not value-core. Two blocks:

1. **Mail signup (PLASTER)** — captures email on submit and renders a thank-you. No POST happens. Delete when a mail-list endpoint exists; may share landing-page signup or split off as its own breaking-digest list.
2. **@hachozeh social feed (PLASTER)** — static sample items from `BREAKING_FEED_SAMPLES`. There is no backend source for this today. Delete when a real social-feed endpoint or X syndication source lands.

Both plasters are labeled at the top of `breaking-markets-stage.js`, in the CSS, and in `workspace/coordination/back.md` as backend handoffs.

## Responsive Contract

Single breakpoint at 1024px, matching the family rule.

| Above 1024px | At or below 1024px |
|---|---|
| Two-column body (`1fr 300px`) | Rail hidden — rows fill the width |
| Hero shows trend motif on the right | Hero text-only (motif hidden) |
| Row carries the delta track | Row drops the track — price + delta text carry the signal |
| Row padding 1.1rem | Row padding 0.95rem, tighter rank/glyph columns |

Why drop the track below 1024: the SVG track is 360px wide, designed to read at desktop density. Below 1024 the row already has enough signal in `price + delta text` to scan; cramming a tiny track in adds visual noise without adding information.

The mail signup + social feed are editorial, not part of "what moved in 24h." They go away on smaller widths — users who want them can land on the page at a wider width.

## Empty / Loading / Error States

- **Loading**: the entire `[data-breaking-stage]` is hidden via `visibility: hidden` until JS finishes mounting and sets `data-ready` on the stage. No JS-painted loading text, no skeleton bars — those each flashed visibly for a frame and read as "page is still loading" even though the layout was already laid out. Holding the stage invisible until everything is wired makes the page arrive as one cohesive paint.
- **Empty (no markets in feed)** or **empty after filter**: `"אין שווקים שזזו בקטגוריה הזו כרגע."`
- **Error (data source threw)**: `"לא הצלחנו לטעון את השווקים. נסה שוב בעוד רגע."` — JS still sets `data-ready` on the error path so the page reveals; the rail and mail signup render so the page doesn't look broken.

The empty + error states use a single shared `.hz-breaking__state` shell.

The shell header slot also gets a `min-height` reservation on `[data-site-shell]:empty` so the page doesn't slide downward when `site-shell.js` mounts the chrome — that's currently page-local; the comment in the CSS points to where it should eventually live (`patterns/site-shell.css`).

## Plasters Active

| Plaster | Where | Delete when |
|---|---|---|
| `BREAKING_FEED_SAMPLES` | `assets/js/pages/breaking-markets-stage.js` | a real social-feed endpoint or X syndication lands |
| `wireMail` submit handler | `assets/js/pages/breaking-markets-stage.js` | a mail-list endpoint exists for breaking-digest |
| `NaviBreakingMarketsPageData` | `assets/js/data/breaking-markets-page-data.js` | backend discovery feed reliably ships movement-first items with `movement` / `signals[type="moved"].deltaPercent` |
| `.hz-breaking__glyph--*` modifiers | `assets/css/pages/breaking-markets-stage.css` | the shared `category-presentation` module lands (front-breaking.md · seam S1) |

All four are also tracked in `workspace/coordination/back.md` and `workspace/coordination/front-breaking.md`.

## Deliberately Excluded

- **bespoke header / nav chrome** — site-shell owns all of it
- **trade entry** — every action routes to market-detail; no inline trading on this surface
- **personal feed** — breaking is global, not "your followed markets" (that's a portfolio-side concern)
- **animation beyond the social-feed pulse dot** — the page is a ledger, not a ticker
- **fake delta values** — when the backend doesn't ship a delta, we show `—` and a flat track, not a synthesized number

## Acceptance Test

Breaking succeeds if:
- a user lands on it and can pick the biggest mover in under three seconds
- the page reads as the same product as trending and the rest of the platform
- removing the right rail (below 1024) does not leave the page feeling broken
- no row visual claims a movement that doesn't exist in the data
- the plasters are obvious to a future implementer (commented in code + listed here)

Breaking fails if:
- it looks like a sportsbook movers board
- the track lies about data it doesn't have
- the @hachozeh feed reads as live when it is sample data
- chips drift from the feed (hardcoded vocabulary creeping back in)
- the hero swallows attention from the row list

## Open Decisions / Follow-Ups

- **Seam S1 (shared category-presentation module)** — three discovery surfaces, three vocabularies (`trending` emoji/tone, `live` material-icon, `breaking` glyph-gradient). Open in `workspace/coordination/front-breaking.md`. Don't extend the per-page maps further before this lands.
- **Backend movement signal** — first integration falls back to `—` when missing. The live seam now consumes `movement` / `signals[type="moved"]`; the local seed file still remains as backend-off visual fallback.
