# Trending / Front Page

Updated: 2026-05-12
Owner: frontend / discovery surface

Status:
- **locked** — the trending shape promoted from lab to production
- live at `systems/design/pages/trending.html`
- still on placeholder data for the social/game box; market stream + hero are wired to the live feed

> **Note on the promotion path:** this surface intentionally skipped the
> `systems/design/stage/` step. The lab loop (multiple iterations under
> `systems/design/mockups/trending-shape-lab.html` and
> `systems/design/mockups/market-card-shape-lab.html`) served as the real
> staging proof, and `pages/trending.html` is the new canonical home. The
> retired `systems/design/stage/trending.html` and `assets/css/stage/trending.css`
> have been removed. Future trending changes go directly to the patterns +
> page file; future *new* surfaces should still use `stage/` unless their
> design loop produces an equivalent lab proof.

Purpose:
- document the canonical trending/front-page surface
- keep promoted production shape, placeholder seams, and follow-up boundaries clear

## Read Order

1. `workspace/docs/design.md`
2. `systems/design/guide/base/css-base-contract.md`
3. this file
4. `systems/design/guide/components/hz-card.md`

Adjacent docs in this folder describe broader discovery doctrine and the legacy feed pattern. The shape locked in this doc is what trending uses today; the broader docs apply to other discovery surfaces (live, breaking, new) until they migrate.

## What Trending Is

The front page is the **broad market doorway**. Should feel: alive, abundant, fast to scan, premium, human, less boxed. Should not feel: like a mini dashboard, like a stack of pasted cards, like a generic SaaS homepage, like a spacey AI hero.

The locked shape delivers that by:
- putting a **live market** at the top of the page (hero with chart + outcomes + footer strip)
- carouseling a **second market of a different shape** so the page rotates between binary and multi/match-up moods
- keeping a **social/game side panel** that fills the right column (community-first, no fake metrics)
- following with a **dense 4-per-row card stream** that holds the whole feed

## Page Shape

```
[data-site-shell]              ← rendered by site-shell.js
└── HERO ZONE  (1fr | clamp 17rem..22vw..20rem  · RTL)
    ├── HERO CAROUSEL          ← right column in RTL
    │   └── slides: binary | multi | matchup · scroll-snap
    └── SOCIAL / GAME BOX      ← left column in RTL, stretches to hero height
        ├── לוח מובילים · השבוע
        ├── רצפים חמים
        └── אתה מול הקהל   (logged-in)
            │  – or –
            └── חוכמת ההמונים  (logged-out)
[NAV BAND]                     ← below cards: dots (right) · named prev/next chips (left) · community CTA
[FILTER ROW]                   ← chips (categories present in feed) + sort
[MARKET STREAM]                ← 4-per-row · responsive 4→3→2→1
[data-site-footer]
```

## Pattern Files

CSS lives in patterns + page-layout files. Trending HTML stays thin: structural slots only, JS fills them.

| Concern | File |
| --- | --- |
| Big hero card (binary + multi) | `assets/css/patterns/hero-card.css` (`hz-hero`) |
| Carousel wrapper + nav band (dots + named prev/next chips) | `assets/css/patterns/hero-carousel.css` (`hz-hero-carousel`) |
| Side community panel — CSS | `assets/css/patterns/social-game-box.css` (`hz-social`) |
| Side community panel — renderer | `assets/js/components/social-game-box.js` (self-mounts into `[data-social-game]`); contract in `components/social-game-box.md` |
| Market card (every variant) | `assets/css/patterns/market-card.css` (`hz-card`); contract in `components/hz-card.md` |
| Page layout (frame, hero zone grid, filter row, stream grid) | `assets/css/pages/trending-stage.css` |
| HTML slots + script wiring | `systems/design/pages/trending.html` |
| Hero + market stream render pipeline | `systems/design/assets/js/pages/trending-stage.js` |

## Locked Decisions

### Hero
- Two variants live in the carousel: **binary** (single Yes/No + chart) and **multi** (ranked outcomes + multi-line chart).
- The chart uses **logical axes**: Y on the right (RTL end), X under the SVG, viewBox is LTR-direction inside the panel.
- **Chart engine — converged onto L1 (done).** The hero chart runs on the market-detail **L1 renderer via the L3 compact mount** — design owned by [`components/market-detail/probability-chart.md` → L3 · Compact mount](../../components/market-detail/probability-chart.md). The bespoke SSR inline-SVG (`chart-math.js`) is retired. This fixed the index-based time axis (hover timestamps were wrong), the solid-block hover "fade", the fixed 0–1 scale, and smooth-vs-step drift, and added the trace + lead-dot reveal (a page-load entrance — only the first slide animates; carousel rotation/swipe does not replay). Y-on-the-right already matches L1's layout.
- **Chart data — single source (`/history`), same as market-detail.** No bespoke preview points. Slide 0 is SSR-seeded (resolves its series server-side and embeds it, so it paints with the page); slides 1–N resolve client-side after first paint (`requestIdleCallback`, not on click). An **event** card's outcomes are separate child markets, so each fetches its own `/history` and we take its canonical "yes" line — mirroring how Polymarket charts an event. Range is `all` (doc-locked for later revisit).
- Wide title cap `clamp(1.4rem, 2.1vw, 1.85rem)`. Big probability in amber for binary.
- Footer strip docks the bottom: vol · participants · close date.
- **Auto-rotate**: carousel advances every `HERO_ROTATE_MS = 7000` (see `initHeroCarousel` in `trending-stage.js`). Pauses on `mouseenter`, resumes on `mouseleave`. Pauses when the tab is hidden (`document.hidden`), resumes on `visibilitychange`. Manual dot click resets the timer so the user gets a full interval to read their chosen slide. Single-slide carousels do not auto-rotate.
- **Do not use `scrollIntoView` to advance slides.** It scrolls every ancestor — including the page itself — to bring the slide into view, which yanks the user back up when they're scrolled down reading cards. Use `track.scrollTo({ left: ±index * clientWidth })` with sign from `getComputedStyle(track).direction === "rtl"` instead.
- **Nav band sits below the cards — shared furniture, not per-slide chrome.** Under both columns is one horizontal band (`top: 100%`, floated out of flow): the carousel's dots ride the RTL start (physical right), a **named prev/next chip pair** is pushed to the physical **left edge** via `space-between` (each chip shows the neighbouring slide's shortened title and retargets/relabels per active slide — `updateNav` in the carousel island), and the community CTA sits at the foot of the social column. Dots, chips, and CTA are the **same pill height on one baseline**. Because the band is absolutely positioned, the cards stay equal-height while the controls live beneath them — but the hero-zone must reserve enough `margin-bottom` (`var(--hz-space-8) + 2rem`) so the band clears the filter divider instead of riding onto it.
- **Hero thumb earns the editorial photo.** When the backend feed item ships `image.photoSrc` (hydrated from the registry asset's `photoPath`), `renderHeroThumb` renders the photo with the `.hz-hero__thumb--photo` variant (no tint, larger size ~5rem). When only `image.src` is present (the SVG icon), the hero renders the small tinted square like any card thumb. **Card thumbs never use `photoSrc`** — only the hero earns the photo. That's the doctrine: SVG is the floor everywhere; photo is editorial topping on surfaces that earn it (hero + market-detail header).

### Social / Game Box
- Real component (`components/social-game-box.js`), currently fed with **mock data hardcoded inside the renderer**. The page slot is a single empty `<aside data-social-game>`.
- Two **auth-state** variants. Both share the leaderboard + streaks; only the third section differs (You-vs-Crowd for users, Wisdom-of-Crowds for guests).
- Switch via `data-auth-state="user"` / `"guest"` on the root `.hz-social` — CSS hides the wrong section.
- Default is `guest` so the page reads sensibly without JS.
- Data shape (`leaders`, `streaks`, `yvc`, `wisdom`) defined in `components/social-game-box.md` — this is the seam for the future community API.
- **Engagement CTA — stub.** A "קחו אותי לשם" pill (brand-bordered, Poly "Get started" register) sits in the nav band beneath the panel, not inside the bordered box. The panel + CTA are wrapped in `.hz-social-col` (panel fills the column = carousel-card height; CTA floated below at `top: 100%`). It is **inert** (`aria-disabled`, no link) until the community destination exists — a deletable plaster; wire its `href` when the community page lands.

### Filter Row
- Chips built from the **actual categories present in the feed**, sorted by count, top 7 + "הכל".
- Sort options: trending · new · closing · volume. Client-side for now.

### Market Stream
- Cards use the `hz-card` pattern (see `components/hz-card.md`).
- Body never exceeds **2 outcomes**.
- One bookmark per card, **in the footer only**.
- Variant chosen from the market shape: binary | live | multi | match-up.

### Thumb Tint Palette
- The colored tint *behind* the market SVG on each card thumb is a **frontend concern**, separate from the registry's 3-color SVG palette (amber / mint / neutral). The registry is source-of-truth for the SVG/photo; the tint sitting behind it is `CATEGORY_LOOK` in `assets/js/pages/trending-stage.js`.
- **Six tones, semantic clusters** — every registry frontendKey maps to one of: `amber` (money-stable: economy, fx, commodities, awards) · `warn` (money-volatile / vivid: crypto, business, entertainment, travel, weather, transportation) · `info` (civic / intellectual: politics, world, news, technology, ai, science) · `buy` (growth / matchup energy: sports, esports, social, health) · `sell` (restrictive / risk: legislation, security) · `mono` (general / fallback).
- **No unmapped categories.** When you add a category to the registry, also add it to `CATEGORY_LOOK`. The default fallback to `mono` is intentional only for `general`; new categories landing on `mono` by accident is the bug this map closes.
- **Within-category variety is a separate concern.** All sports markets share the `buy` tint by design; if specific match-ups should look distinct, the move is entity assets (per-team identity in the registry), not per-market hue-shifting.

## Responsive Contract

Trending has **two structural breakpoints**. Each does multiple things, but always together — no double-reflows split across a 76px gap.

| Width | Hero zone (hero + social) | Card stream | Filter row |
| --- | --- | --- | --- |
| ≥ 1281 px | **visible** — 2-col (hero \| social, RTL) | 4 cols | row |
| 1025–1280 px | **visible** — 2-col (hero \| social, RTL) | **3 cols** | row |
| 901–1024 px | **hidden** (`display: none`) | **2 cols** | row |
| ≤ 900 px | hidden | **1 col** | column |

**Doctrine:**
- **3-col middle band, Poly-mirrored.** Live-measured against Polymarket 2026-07-02 (desktop-audit F2b): Poly's own feed grid is 4-col only from 1280px up, and runs 3-col at 1024–1279 (cards 312–371px) — their implicit floor is ~295px, and our old 4-col-from-1025 rule gave cards 237–292px, ~20% narrower than anything Poly ships. The feared "3-col clash" (3-col cards wider than 4-col desktop cards) is exactly what Poly ships (371px > 317px) and it reads fine there — the card is elastic. Our 3-col band lands cards at 316–401px, inside the card's already-exercised envelope (419–480px at 2-col, ~298px at the 4-col cap), so this is a grid-rule change only, no card rework. This supersedes the former "no 3-col middle state" clause below.
- **One break = atomic.** Resizing through 1280 collapses the card stream 4→3 (hero zone unaffected — it's still visible either side). Resizing through 1024 collapses opening + drops cards 3→2 *together*. Resizing through 900 drops cards 2→1 + flips filter to column *together*. No close-together steps.
- The hero zone does *not* compress, stack, or reflow — it's either rich (≥1025) or absent.
- CSS handles the hide: `display: none` on `.hz-trending__hero-zone`, grid changes on `.hz-trending__stream`, flex direction on `.hz-trending__filters`.
- **JS also gates the hero work below 1024.** `display: none` doesn't cancel `<img>` downloads and doesn't stop the auto-rotate `setInterval` — both keep running on a hidden carousel and waste mobile battery / data. `trending-stage.js` checks `matchMedia("(min-width: 1025px)")` before building hero DOM, fetching hero photos, or starting the carousel timer. Re-renders once on `change` so devtools resize / tablet rotation still work. Any future widget added to the hero zone should sit inside the same gate.
- Borrowed pattern: Polymarket — rich opening on desktop, generous 2-col below, and now the same 3-col middle band they run at 1024–1279.

**Anti-pattern to avoid:**
- Card-grid breakpoint that doesn't align with a structural break (e.g. 1100) — gives user two close reflows in one drag.

**Cross-session smoke check:** open `/pages/trending.html` at **1440 / 1281 / 1280 / 1100 / 1024 / 950 / 900 / 430**. Drag slowly through 1280, through 1024, and through 900 — at each boundary you should see exactly **one** snap (multiple things changing, but in lockstep). Between boundaries, the layout should hold steady — no in-between reflows.

Sibling discovery surfaces (breaking, new, live, category) inherit this contract unless they document a reason to diverge — see `discovery-route-spec.md` → "Shared Discovery Rules".

## Data Contract

Source: `window.NaviDiscoveryDataSource.readFeed({ feed: "trending" })` (defined in `assets/js/pages/discovery-data-source.js`).

Returns `{ markets, featured, mode }`. Falls back to `NaviGuestLandingFeedData.markets` when backend mode is off (default).

Variant detection in `trending-stage.js` (`pickCardVariant`):

| Market shape | Card variant |
| --- | --- |
| `liveMeta.isLive` or `variant === "live"` | `live` |
| `variant === "sports"` or `sportsMatch` present | `matchup` |
| 3+ outcomes, or `variant` in `["ranking", "default"]` | `multi` |
| anything else (incl. `binary`, `metric-binary`) | `binary` |

Hero selection picks **up to 2 markets favoring variety**: prefers `featured.market` first, then ensures one binary + one multi/matchup. Backfills from feed if needed.

## RTL & A11y Rules

- All layout uses **logical properties** (`padding-inline`, `inset-inline-end`, etc.). No physical `right`/`left` in new code.
- Hero carousel JS uses `Math.abs(track.scrollLeft)` so the dot syncs in both directions.
- Hebrew copy in product strings; English in code and identifiers.

## Smoke Standard

After changes that touch trending:

1. Hit `pages/trending.html` locally (`cd systems/design && python3 -m http.server 8080`).
2. Verify the shell + footer render (Tailwind + `site-shell.js` must be loaded).
3. Confirm the hero carousel has 2 different shapes (binary + multi/matchup if available).
4. Confirm the market stream renders at least 6–8 cards of mixed variants.
5. Toggle `NaviAuthSession` state — the social-box third section flips between yvc and wisdom.
6. Resize: stream grid breaks 4 → 3 → 2 → 1; hero-zone collapses to single column under 1024px.

## Known Gaps

- Cards still hardcode placeholder bookmarked state — no save/unsave wiring yet.
- Backend `previewChart.points` is now threaded into the hero chart, but the chart axes are hardcoded (`100/75/50/25/0` Y for binary, `50/40/30/20/10` Y for multi; fixed X labels). Adaptive y-domain + real timestamps is queued for the same session as the market-detail graph polish (see `workspace/coordination/inbox.md` Front handoff on market-detail graph behavior).
- Filter chips don't refetch by category from backend; purely client-side filter on the loaded feed.
- Social/game box uses static mock data inside `components/social-game-box.js`. When the community APIs exist, drop in a `community-data-source.js` and call `window.NaviSocialGameBox.setData(...)`; the data shape is documented in `components/social-game-box.md`.

## Deletable Once Backend Stabilizes

These exist only as fallbacks for data missing the locked seam. Delete after a deprecation window confirms no production market is hitting them:

- `pickCardVariant` in `assets/js/pages/trending-stage.js` — `if (market.shape) return market.shape;` is the production path. The remaining lines (`liveMeta.isLive`, `category.key === "sports"`, outcomes-count fallback) are a heuristic for markets shipped before the backend `shape` slice landed (2026-05-12). Once feeds confirm every item carries `shape`, the function becomes a one-liner.
- `isDrawOutcome` fallback to label-match (`/^(draw|תיקו)$/`). Production path is `outcome.role === "draw"`. Delete the regex once all sports markets ship `role`.
- Emoji fallback in `renderThumb` / `renderHeroThumb`. The Seer image-curation handoff requires `image.src` to be non-null in every published feed item; the emoji branch is belt-and-suspenders for unpublished/preview state, not production.
- Match-up cards pick tone (amber/info/sell) heuristically. Real team palettes from `sportsMatch.homeTeam.badgeClass` aren't threaded yet.

## What Belongs Next

Adjacent surfaces — **Live, Breaking, New** — are sibling moods. Same `hz-card` and stream layout, different feed slug, plus 1–2 mood signals (urgency on live, motion on breaking, freshness on new). They should adopt this page's patterns rather than reinvent.

Portfolio comes after the discovery surfaces share one card grammar.
