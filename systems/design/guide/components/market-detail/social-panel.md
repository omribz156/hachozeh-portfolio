# Market Detail Social Panel

Updated: 2026-06-14
Status: current
Owner: frontend / market-detail surface

Purpose:
- own the design contract for the market-detail community surface (שיחת השוק)
- keep comments, holders, positions, and activity as one supporting context surface
- prevent social UI from overpowering the market itself
- pin the load-cost contract: the section is present but never slows the page paint

## Product Job

The social panel answers:
- what are people saying (comments)
- who holds what (holders)
- what exposure/PnL exists per side (positions)
- what is happening right now (activity)

It supports conviction *after* the market/chart/trade layers are understood. It is
community context, not a social-network feed — clean, compact, useful, no fake hype.

## Current Reality (read before editing)

- **Live (Astro):** `systems/web/src/components/market-detail/CommunitySection.astro` is a
  source-owned island. The shell renders on the server; the client hydrates on idle/near-viewport.
  Holders, positions, activity, and comments all use real backend seams. Comments v1 is intentionally
  compact: list/post/reply/like only, no moderation or notification delivery yet.
- **Behavior reference (legacy, NOT live):** `systems/design/assets/js/pages/market-detail/community.js`
  is the frozen stateful renderer (tab switching, comment filter, boards, activity). It is the
  **reference for behavior and class vocabulary only** — the live build is a clean rebuild to
  the same look, not a transplant of this file.
- **CSS (live, reused as-is):** `systems/web/src/styles/patterns/comment-feed.css` already covers
  all four parts. The rebuild emits the identical `hz-*` class vocabulary, so no CSS is
  duplicated or rewritten.

## Target Design — shell + per-concern modules

One section, 4 tabs, decomposed into focused units (chosen over a single monolith renderer and
over four fully-independent islands — the four share a shell, tab bar, and outcome filter, so a
thin shell + small modules is the right grain).

Files (all under `systems/web/src/components/market-detail/`):

- `community.client.js` — **shell.** Owns shared state `{ activeTab, communityOutcomeId,
  commentsFilter }`, tab switching, ARIA tab semantics + arrow-key nav, and a lazy-mount registry
  (a tab's module mounts on first activation, not before).
- `community-adapter.js` — **the single network seam.** The only file that talks to the network:
  - `fetchBoards(marketKey)` → `GET /api/markets/:market/positions?limit=50`
  - `fetchActivity(marketKey)` → `GET /api/markets/:market/trades?limit=25`
  - `comments` → `GET /api/markets/:market/comments`, `POST /api/markets/:market/comments`,
    `POST /api/markets/:market/comments/:commentId/replies`, and
    `POST /api/markets/:market/comments/:commentId/like`
- `community-board.js` — **holders + positions**, one renderer parameterized by `kind`
  (same yes/no two-column board; differ only shares-vs-PnL). Borrows the Polymarket
  "Top Holders / Positions" structure: a **dropdown** selects what to show (outcome in a
  multi-outcome market, child date in an event); binary markets show **no selector**. The
  **Positions** tab adds a min-size filter (`הכל / ≥1 / ≥100 / ≥1K`) + a `יורד/עולה` PnL sort
  on the opposite toolbar end. Values keep **our** tone — yes = mint (buy), no = pink (sell) —
  not the reference's amber.
- `community-activity.js` — **activity.** Trade feed; polls `/trades` only while it is the active
  tab and the page is visible, with stale-write guards.
- `community-comments.js` — **comments.** Composer + stream + replies/likes, holders/observers
  filter, empty + error states. Wired to the backend comments seam.

`CommunitySection.astro` keeps its server-rendered shell markup (first paint isn't blank, comments
tab is the default skeleton) + a `data-market-key` attribute, and loads the shell client.

### Data sources per part

| Part | Tab | Source | State |
|---|---|---|---|
| 1 | תגובות (comments) | `GET/POST /api/markets/:market/comments` + reply/like endpoints | **live v1** |
| 2 | מחזיקים (holders) | `GET /api/markets/:market/positions` → `holdersByOutcome` | **live** |
| 3 | פוזיציות (positions) | `GET /api/markets/:market/positions` → `positionsByOutcome` | **live** |
| 4 | פעילות (activity) | `GET /api/markets/:market/trades` | **live** |

All four parts now have backend seams. Comments is v1 only: real persistence, replies, likes, and
holder/observer classification, but no moderation queue, edit/delete, or notification delivery yet.

### Event mode (date-series markets)

When the market is an event (a series of binary child markets, e.g. "when will the election
happen" with month children), the surface adapts per part — the page passes `eventChildren`
(`{ key: child.marketId, label, status }`), `defaultChildKey` (closest open child), and `eventId`:

- **Comments** stay at the **parent/event** level (no child selector). One conversation for the
  whole event. (Backend handoff: comments should key on `eventId`, not a child market.)
- **Holders + Positions** render a **child-date dropdown** (`community-dropdown.js`),
  defaulting to the closest open child. Selection is shared across the two tabs. Each child is
  binary, so the board shows that child's single yes/no board. (Market mode uses the same
  dropdown shape, selecting an outcome instead of a child.)
- **Activity** renders a dropdown `[הכל, child₁…childₙ]` defaulting to **'all'**. 'all' fetches
  every child's `/trades` in parallel and merges by time (each row tagged with its month, capped
  at 25); a specific child shows just that child's trades.

Non-event markets are unchanged: outcome chips for the board, static "הכל" pill for activity.

## Load-Cost Contract (non-negotiable)

The section is **present from the first frame** but must **not slow the page paint**. "Present" and
"slows paint" are separate concerns — only the second is deferred.

- **Visuals ship in SSR HTML** (tabs, composer, empty state). Markup below the fold paints with the
  rest of the page at ~no cost. The section is visibly there immediately.
- **JS is a deferred ES module** → never blocks parsing or first paint.
- **Yield to the important islands.** The chart and sidebar/ticket hydrate first; the community
  island wakes during main-thread idle (`requestIdleCallback`, fallback timeout) and/or when it
  scrolls near view (`IntersectionObserver`). It never competes with the chart for main-thread time
  during load.
- **Code-split tab modules** via dynamic `import()`: the initial island chunk is shell + comments
  only. `community-board.js` / `community-activity.js` download only when their tab is first opened.
- **Bounded network after idle.** Comments is the default tab and may fetch one capped thread
  (`limit=30`) after the idle/near-viewport wake. Holders/Positions/Activity still do zero network
  until their tab opens.
- **Polling only when active + visible.** Activity polling stops on tab switch or page hide.
- **No layout shift.** The SSR shell reserves a stable `min-height` so hydration/tab-fill doesn't
  shove the footer (CLS protection). Payloads stay capped (`positions limit=50`, `trades limit=25`).

Net: initial market-detail load is unchanged whether or not this section exists.

## Backend Seam Contract

The seam exposes:
- comment shape: `author`, `body`, `postedAt`, `likes`, `hasOpenPosition`, `positionLabel`, `replies[]`
- endpoints: `list` / `post` / `like` / `reply`
- `likedByViewer` when the reader has a valid session cookie
- `hasOpenPosition` powers the holders/observers filter — a backend join (commenter ↔ open position
  in this market/event). The notification-pref `"comments"` type already exists but stays dormant.

## Non-Goals

- moderation
- comment notifications (the pref type exists; no delivery yet)
- realtime/websockets for comments (activity stays poll-based, like the chart)
- does not drive market status

## Guardrails

- keep below the trust/rules sections; keep enough spacing before the social block
- do not let social copy become the market explanation
- the load-cost contract above is a hard requirement, not a nice-to-have
- emit the existing `hz-*` class vocabulary — do not fork the CSS
