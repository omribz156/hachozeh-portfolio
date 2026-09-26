# Portfolio Surface Contract

Updated: 2026-05-19
Status: current
Owner: frontend / portfolio surface

Purpose:
- define the visual and interaction direction for the portfolio route
- give future frontend work one clear design target
- keep the page from drifting into broker data-dump, engagement-portfolio, or casino-countdown patterns

Authority:
- this is a surface contract under `workspace/docs/design.md`
- it is binding for portfolio work unless the design constitution changes
- it does not override platform-wide typography, tone, or anti-slop rules

It does not define backend contracts or implementation seams.
For current route structure and ownership, see:
- `systems/design/guide/components/portfolio.md`

## Role In The Product

Portfolio is where the user comes back to themselves.

Market-detail is the page where the user *acts*. Portfolio is the page where they *understand what they did*. It is the page they open between sessions, in the morning, after news, before deciding what to do next.

The user should be able to walk away from this page knowing:
- whether they are up or down
- what moved, and which positions drove it
- what is about to close, and whether they need to do anything about it

If the user leaves the page still asking any of those, the page failed.

This page is not for trading. The trading happens on market-detail.

## Core User Jobs

The page must help the user do 3 things fast:

1. read total state — "am I up or down?"
2. read change — "what moved, and which positions drove it?"
3. read urgency — "what is closing, and when?"

The user must answer all three within seconds of the page loading, without scrolling and without clicking.

If any of those needs a hunt, a second click, or a mental calculation across two cards, the page failed.

## Emotional Target

The feeling should be:
- legible
- sober
- consequential
- self-contained

Not:
- noisy
- engaging-for-its-own-sake
- dashboard-busy
- casino-countdown urgent

The user should feel like:
- a serious person reviewing their book
- an analyst reading their own positions

Not like:
- someone being nudged to trade again
- someone navigating a broker data dump
- someone watching numbers tick to make the page feel alive

## Page Thesis

The central experience of portfolio is:
- look at where you are
- read what moved
- notice what's closing

Everything on the page should support one of those three verbs.

If a section does not directly serve at least one of them, it does not belong on this page.

## Default Hierarchy

The route should read in this order, using RTL reading flow as a hierarchy primitive:

1. **top-right card — total state** (the lede)
   - account total value
   - available cash for trading
   - the at-a-glance "where am I" answer

2. **top-left card — PnL** (the subhead)
   - total movement (day / week / month / all, filterable)
   - chart with gradient stroke + area-fill "shading"
   - no in-card movers list — movers fall to the positions tab

3. **claims strip — "נצחונות"** (conditional, full-width below top fold)
   - renders only when there are resolved-won positions to claim
   - per row: title + outcome chip + winning amount + collect button (`אסוף`)
   - the page's loudest warm-amber moment — but tone is sober, not engagement-y

4. **closing-soon strip** (full-width below claims)
   - five columns: שוק / אני / השוק / שווי / סגירה
   - the "אני vs השוק" pairing is the page's diagnostic insight

5. **depth layer — positions / orders / history tabs**
   - sortable column headers (positions tab)
   - tabs + search inline on a single bar (`.pf-depth-bar`)
   - each tab answers exactly one sub-question

6. **session/security panel** (existing)
   - stays compact, account-facing
   - does not become a fake device-management center

Important:
- the top fold is the scan layer; the depth layer is the depth layer
- a user who only sees the top fold should still be able to answer all three core questions
- the depth layer is for tactical reading after the scan, not as a replacement for it

## Layout Direction

Current implementation lock:
- `systems/design/pages/portfolio.html` is the live route (promoted from stage on 2026-05-19)
- pre-v1 stage snapshot archived at `systems/design/guide/history/2026-05-portfolio-pre-v1-proof/`
- centered frame, no full-bleed
- **frame max-width: `1020px`** — deliberately narrower than trending / market-detail (1280px). Portfolio is reflection, not action; a tighter column reads as analyst's-report, not dashboard sprawl. This is a per-surface decision and intentional drift from the platform-wide harmonization.
- current font direction is Arimo for UI, IBM Plex Mono for all numerals

Desktop composition (locked):
- top fold is two equal-width cards at 50/50 (`grid-template-columns: 1fr 1fr`, `align-items: stretch` so the cards match heights as sibling heroes)
- right column: total card (the lede)
- left column: pnl card (formerly "change") with chart only — **no top-movers list inside the pnl card** (movers fall to the positions tab default sort)
- pending-claims strip ("נצחונות") renders **between top fold and closing-soon**, only when there are resolved-won positions to claim
- closing-soon is a **full-width strip below the top fold** (not nested inside the pnl card). Five columns: שוק | אני | השוק | שווי | סגירה
- depth layer is full-width below, tabbed

Top-fold composition explicitly differs from trending and market-detail:
- trending uses 65/35 hero+sidebar — appropriate because the hero is the protagonist
- market-detail uses main+rail — appropriate because the market is the protagonist
- portfolio top fold is lede + subhead, not hero + rail; do not "harmonize" the ratio with trending

Recommended mobile composition:
- top cards stack: total first, then pnl card, then claims (if any), then closing-soon, then depth layer
- timeframe filter on the pnl card remains inline
- no persistent bottom CTA strip; the page is not a trading surface

## Section Blueprint

### 1. Total State Card (top-right)

Purpose:
- answer "where am I right now"
- carry the calm authority of the page

Must show:
- total account value (large, mono)
- available cash for trading (smaller, but unambiguous)
- "as of" timestamp when backend mode is on

Should feel:
- still
- definite
- expensive

Should not feel:
- like a CTA card with a number on top
- like a "deposit more" funnel

Design rules:
- numbers are the strongest element on the card; chrome supports them, not the other way around
- IBM Plex Mono for the total; size and weight do the work
- no decorative gradients or "celebrate your wealth" framing
- the deposit CTA, if present, sits below the numeric pair and is visually quieter than the numbers themselves

### 2. PnL Card (top-left, formerly "Change")

Eyebrow text: **`רווח/הפסד`** (matches the positions-tab column header).

Purpose:
- answer "what moved"
- carry the page's only live narrative

Must show (rebuilt 2026-05-28):
- eyebrow `רווח/הפסד` + **sub-eyebrow** with timeframe context (`ב-24 שעות` / `ב-7 ימים` / `ב-30 ימים` / `ב-12 חודשים` / `מתחילת השנה` / `מתחילת התיק`) so the hero number reads with its window
- **hero**: signed V₪ for the selected timeframe, mono, tone-colored
- **subline**: signed pct + plain-language context (`מתוך {totalNow} V₪`) — the baseline the pct is relative to
- **mini-stats** (when any activity in the window): muted line `{N} עסקאות · {N} מימוש`
- **sparkline** rendered by `HzPnlSparklineRenderer` (`assets/js/components/pnl-sparkline-renderer.js`) — Layer 1 pure SVG renderer aligned with `practice_chart_creation.md`, with two **deliberate deviations** from the doctrine for the portfolio P&L use case (calibrated against Polymarket reference 2026-05-30):
  1. **Smooth cubic-bezier interpolation** (not step). Doctrine default is step for time-series charts because "smoothing fakes activity that wasn't there" on probability lines. Portfolio P&L is different — the underlying mark value is continuous between candle samples, so smoothing doesn't fake anything; it reads more naturally as a value curve.
  2. **Decimation to a target point count** (per-range targets: day 24, week 56, month 60, year/ytd 52, all 100; default fallback 80). Backend's mark-to-market series can be 1000+ points; that reads as noise at sparkline scale. Polymarket caps similarly (~50-130). Y autoscale still runs on the full series so outlier bounds reflect the real data.

  Visual treatment: `stroke-width: 1.6`, no opacity dim, `height: 72px`. Area fill: vertical gradient (`currentColor` at 40% opacity → 5%) via id-scoped `<linearGradient>` in the renderer's SVG defs — the 5% floor (not 0) keeps a visible wash under low/undulating curves; without it, ranges where the curve hugs the lower band (e.g. a calm 1D) showed no fill at all (calibrated 2026-06-17). Other behavior matches doctrine: outlier-resistant Y autoscale with P&L 0-anchor (all-positive → floor at 0; all-negative → ceiling at 0; crosses zero → free autoscale with a dashed zero hairline); `getCTM().inverse()` for pointer→SVG coords. Chart color: **single source `--hz-brand` (gold)** set on `.hz-pnl-spark`; line, area fill, and cursor dot all inherit via `currentColor` (golden identity chosen 2026-06-17 — see Design rules). Suppressed when backend series has < 2 points. Consumer is `change-card.js`; renderer is reusable for any future single-series P&L sparkline. Entry reveal: the line traces via CSS `stroke-dashoffset`, but the area fill is clipped to the line's drawn point each frame via **rAF + `getPointAtLength`** (same as the market-detail chart) — a CSS X-wipe is linear in X while the line draws by arc length, so on a smooth curve the fill outran the stroke; the rAF locks the fill edge to the pen-tip. The clip rect inits at full width so a Preact re-mount that orphans the rAF degrades to a complete fill, never an invisible one (fixed 2026-06-23).
- **scrub interaction**: vertical dashed crosshair line follows the cursor x; a dot snaps to the nearest data point (step lines don't interpolate intermediate positions). Renderer's `onHover` callback fires with `{ point, formatted }`; `change-card.js · mount()` wires it to **swap the hero number** to the hovered value AND **swap the sub-eyebrow** from the timeframe context (`ב-24 שעות`) to the absolute hovered timestamp (`29 במאי 06:00`). On pointer leave / touch end the renderer's `onLeave` callback fires and both restore to defaults stored on `data-portfolio-hero-default-value` / `data-portfolio-sub-eyebrow-default`. Line stays uniform color throughout — no past/future opacity dim (Polymarket-reference visual chosen 2026-05-29).
- timeframe selector (day / week / month / year / YTD / all) — locked compact pattern, top-right

**Backend data source (typed, 2026-05-28):** read `performance.views[<tf>].movement` for the headline number. The block has uniform shape `{ basis, totalNow, changeAbs, changePct, changeSign }` across all four timeframes — front consumers should not branch on day vs. non-day. Multi-point series lives at `performance.views[<tf>].series.points`; **as of 2026-05-30 this is mark-to-market** composed from per-market candles (`composePortfolioMarkSeries`), bucketed at the candle infra's cadences (1D→5min, 1W→1h, 1M→4h, ALL→adaptive). Backend now replays shares from current positions plus in-window trades/realizations, so buys/sells inside the selected range only affect later buckets. Fallback to realized-events-only series for accounts with no exposure or markets without candle history yet. The legacy top-level `performance.dayMovement` is still emitted with the `dayChange*` prefix for backward compatibility, but new code should use `views.day.movement`. See `workspace/tasks/reference/current-backend-api-map.md` §`GET /api/portfolio/performance`.

Should feel:
- analytical
- precise
- sober — data over storytelling

Should not feel:
- like a stock-ticker
- like a casino "your wins" wall

Design rules:
- hero number in IBM Plex Mono, tone-colored by direction (`--hz-action-buy` / `--hz-action-sell` / `--hz-text-muted` for flat)
- hierarchy: hero is *clearly smaller* than the total-card lede (currently `clamp(1.4rem, 2vw, 1.8rem)` vs total's `clamp(1.4rem, 2.2vw, 1.9rem)` — close but the total card stays the page lede)
- sparkline: single-color via `currentColor`, color source `--hz-brand` (**gold**, 2026-06-17 — was `--chart-line-info`), `stroke-width: 1.6`, height `72px`, gradient area fill (top 40% opacity → 5% floor). The gold line is the portfolio's **identity** — the equivalent of Polymarket leaning on its brand purple for its P&L curve. The line carries identity; the hero number still tones green/red by direction. This is a **deliberate exception** to the "brand-amber reserved for the deposit amount + button only" rule below — the P&L curve is the one chart element that earns the brand color (see Brand rules note).
- timeframe selector uses the locked compact pattern, not a chip explosion
- empty-state for week/month/all timeframes (no fixture data yet) **keeps the timeframe pills visible** so the user can navigate back to "day". Stranding the user with no nav out is a bug.
- empty-zero state (no activity in the window): hero shows `0.00 V₪` in muted info-tone, sub-line and mini-stats suppressed, no sparkline. The hero alone carries the "no movement" signal.
- **No top-movers list inside this card.** Movers surface via the positions tab default sort. Having movers here AND in the positions table duplicates information.

### 3. Claims Strip ("נצחונות") — pending resolved-won positions

Purpose:
- surface resolved positions ready for the user to redeem
- a fourth question on top of the original three: *"do I have any winnings waiting?"*

Renders only when at least one position has `marketStatus === "resolved_win"` — the strip is invisible when there's nothing to claim. No empty state.

Position: between the top fold and the closing-soon strip.

Must show:
- eyebrow + total claimable amount (mono, warm-amber)
- per row: market title, outcome chip (buy tone), winning amount, claim button (`אסוף`)

Should feel:
- present but contained
- the page's loudest warm-amber moment — but *only* the amount + the button carry the brand color
- sober — framing is "נצחונות" / "אסוף" (collect), not "Free Money!" or "Claim Now!"

Should not feel:
- like Polymarket's `You won $1.18 [Redeem]` engagement banner
- like a casino notification

Design rules:
- same lining family as closing-soon (border + radius + shadow + `--hz-surface-1`)
- only the *amount* and the *button* carry `--hz-brand` tones
- title truncates with ellipsis on overflow
- click on the button triggers a redeem action through `POST /api/portfolio/claims/:claimId/claim`

### 4. Closing Soon Strip (full-width, below the top fold)

Purpose:
- answer "what is about to close"
- surface urgency without *performing* urgency

Must show:
- up to 3 positions where the market resolves within 7 days
- per row: market title (truncated), your stake/value, time-until-close label
- graduated time labels:
  - **< 1 hour** — live countdown (`סוגר בעוד 23:14`), mono numerals tick
  - **1–24 hours** — static hour count (`סוגר בעוד 6 שעות`), refreshes on data reload
  - **1–7 days** — static day name (`סוגר מחר`, `סוגר ביום ראשון`)

Should feel:
- quietly unmissable
- specific
- actionable without nagging

Should not feel:
- like a banner ad
- like a "TIME RUNNING OUT" countdown wall

Columns (RTL right-to-left): **שוק | אני | השוק | שווי | סגירה**

- **אני** — chip showing the user's own current state: `<percent>% <outcome>` (e.g., `27% לא`). Tone-colored: buy when user's side is leading (price ≥ 50%), sell when behind. Uses the shared `.pf-state-chip` pattern.
- **השוק** — chip showing the market's leading outcome: `<percent>% <leader>` (e.g., `73% כן`). Always info-toned (neutral) — this is data, not user-state. For binary markets we derive the opposite when the user is on the losing side; for multi-outcome we show percent only.
- The "אני vs השוק" pairing is the page's diagnostic insight — at a glance the user can see if they're aligned with where the market thinks the resolution is going. **Polymarket does not have this**; it's a deliberate per-product move.

Design rules:
- the whole row is the click target; row links to that market's detail page
- only the < 1h countdown is live; everything else is static. The lone moving element earns its motion by being lone.
- live countdown does **not** use `direction: ltr` — that would flip the mixed Hebrew + digit run visually against the RTL row. `unicode-bidi: isolate` alone handles the digit run correctly.
- honest empty state when nothing is closing — "אין שווקים בקרוב לסגירה" — not a fake "all clear" celebration

### 5. Depth Layer (tabbed body)

Purpose:
- give the user tactical depth after the scan
- each tab answers one sub-question

Each tab is a sentence:
- **positions** — "what do I own and how is each one doing right now?"
- **orders** — "what did I queue that hasn't filled?"
- **history** — "tell me the story of what happened."

Tab + search live inline on a single row (`.pf-depth-bar`):
- tabs anchor at the RTL-start (right edge)
- search input anchors at the RTL-end (left edge)
- `justify-content: space-between` pushes them apart
- the bar's bottom border runs continuously beneath both; the active-tab amber underline overlaps it via `margin-block-end: -1px`

Positions tab specifics — Polymarket-mirrored 5-column structure:
- **שוק** — title + outcome chip (`<percent>% <outcome>`, shared `.pf-state-chip`) + contract quantity
- **מחיר** — stacked `כניסה / נוכחי` price pair (entry vs current, mono digits)
- **הושקעו** — cost basis (mono)
- **לזכייה** — max payout if the position wins (= contracts × 1 V₪)
- **שווי** — current value + P&L percent, tone-colored

Sortable column headers:
- each header is a clickable button; click toggles sort by that column
- inactive columns show `unfold_more` (neutral chevrons, faded)
- active column shows `arrow_drop_up` / `arrow_drop_down` in `--hz-brand`
- default sort: **biggest day movement** (per the original surface contract) even though no day column is visible
- each column has a default direction (title → asc, numerics → desc); first click respects the default, repeat clicks toggle

No outcome-filter chip row above the table. (An earlier iteration added one; removed in favor of sortable headers — sort is more useful with the new structure.)

Outcome chip on every position row uses the shared `.pf-state-chip` pattern (same as closing-soon and claims), tone-colored by current-state. The pre-existing `hz-position-pill` is no longer consumed by this surface — `.pf-state-chip` is the unified outcome-chip primitive across portfolio.

Orders tab specifics:
- "future feature" deboxed placeholder (single quiet centered line: *"תכונה עתידית — הזמנות פתוחות יופיעו כאן כשהמסחר בהגבלת מחיר ייפתח"*). Uses `.pf-future-feature` (no card chrome) to declare intent rather than mimic a dashboard widget. The orchestrator calls `ordersTab.render()` with no args today; when the limit-order flow lands, the render body grows to a sortable table mirroring positions/history.
- see Intentionally Parked below — orders is a parked-by-design tab, not broken

History tab specifics (rebuilt 2026-05-20 as Activity table):
- 3-col sortable table mirroring Polymarket Activity structure: **סוג** | **שוק** | **סכום**. Borrows structure; tone stays ours (Hebrew chip vocabulary, IBM Plex Mono on numerals, sober copy)
- `סוג` column carries `.pf-state-chip`: `קנייה` (buy-tone), `מכירה` (sell-tone), `פדיון` (resolution_win, buy-tone), `הפסד` (resolution_loss, sell-tone — cash shows "—" since no money moves at loss-settlement)
- `שוק` column is a tap-through link to `market-detail.html?market=<key>`; under the title sits a sub-row with outcome chip + qty (mirrors the positions row's chip+qty sub-row vocabulary)
- `סכום` column carries the mono numeric + Hebrew relative time (`עכשיו` / `לפני N דק׳` / `לפני N שע׳` / `לפני N ימים` / `לפני N חוד׳` / `לפני N שנים`) via `formatHebrewRelative`
- Sortable headers reuse the `.pf-position-header` + `data-portfolio-sort` primitive. Defaults: `time→desc`, `amount→desc`, `type→asc`. Tab-switch sets default `state.sortBy = "time"` when activating history (positions defaults to `"day"`).
- Day grouping is gone. Per-row relative time replaces it — denser and more forensic
- The `buildHistoryDescription` Hebrew prose helper remains in the view-model (still searched against) but no longer rendered as the row body
- Mobile (`≤767px`): card-row collapse to one line per event — `[type chip] [title (truncate)] [amount + time-stack]`. Outcome chip + qty drop off mobile; tap-through to market-detail carries them.

### 6. Session/Security Panel (existing)

Purpose:
- give the user a real account-facing security card when backend exposes it
- not become a device-management cosplay

Stays as-is in scope:
- compact
- self-service session revocation as a narrow safety action
- capped recent-actions history, human-readable

This section is governed by the component contract at `components/portfolio.md`; the surface contract does not redesign it.

## Mobile Composition (calibrated 2026-05-20)

Two breakpoints:
- `880px` — top fold collapses to single column
- `767px` — three table-grids (closing-soon, positions, history) collapse to card-row peek shapes. Tab bar tightens.

The mobile philosophy is **peek + tap-through**, not miniaturized desktop:
- Each row reads as a one-line glanceable peek
- Secondary metrics (entry/now prices, cost, toWin, outcome+qty on history) drop off
- Tap-row → market-detail carries the full diagnostic

Per-zone mobile shape:
- **Top fold:** stacks; total card above pnl card. Same per-card content.
- **Claims strip:** one line per win — title + amount (brand-amber, tappable, carries `data-portfolio-claim`). Outcome chip + אסוף button hide. Header total dropped from both desktop and mobile.
- **Closing-soon:** one line per market — title + closing time. אני vs השוק chip pairing + value hide.
- **Positions tab:** one row per position — title (truncate) + שווי tone-colored with pnl% sub. Chip + qty + entry/now prices + cost + toWin all drop. Sort headers hidden.
- **History tab:** one row per event — `[type chip] [title (truncate)] [amount + time-stack]`. Outcome chip + qty drop. Sort headers hidden; default sort is `time desc` (newest first).
- **Orders tab:** same deboxed "future feature" line as desktop — no special mobile handling needed.
- **Depth bar (tabs + search):** inline on one row. Search uses `margin-inline-start: auto` to hug the LTR-end (visual left) at a fixed `10.5rem` width; tabs hug the start with compact `0.7rem` gap.

Calibration pattern (this slice, for future mobile work): write the mobile shape, ship to actual iPhone (Brave, hard-refresh), react, iterate. Multi-round is normal per *visual-calibration-runs-in-loops*.

## Visual Character

Portfolio should hold the *quietest* tone of the three anchor surfaces.

Visual ingredients:
- restrained warm-amber (only at moments of consequence)
- generous spacing — let the page breathe
- precise numerals (IBM Plex Mono for all money, percentages, timestamps)
- low-contrast surfaces; high-contrast numerics
- weight and size do the hierarchy work, not color

Tone family across anchor surfaces:
- trending = warm hero energy
- market-detail = live theater energy
- portfolio = analyst's-study energy

All three share the same floor. They earn their distinction through *restraint relative to each other*, not through novelty.

If the page starts to glow, ticker, or pulse, it has drifted into market-detail's lane.

## Motion Guidance

Motion on portfolio should be the *quietest* of the three anchor surfaces.

The page has exactly one element that moves:
- the < 1 hour closing countdown

Everything else is static on data reload:
- performance chart re-renders, does not animate
- P&L numbers update on refresh, do not tick
- position values update on refresh, do not pulse

Good candidates:
- subtle page-load reveal that stages right card → left card → depth (single frame, no slide-cascades)
- timeframe-filter transitions on the change card (precise, restrained)
- tab transitions on the depth layer (no slide-in; fade or instant)

Avoid:
- pulsing on P&L or position rows
- shimmer-style loading bars (use honest "loading…" copy instead)
- any constant-motion element other than the < 1h countdown
- celebratory animations on positive P&L

Discipline rule: when everything moves, nothing reads as urgent. Portfolio earns its single live element by keeping everything else still.

## Typography Guidance

This page is numerals-first.

The typography must clearly separate:
- the total value (largest, mono, dominant)
- the change number (large, mono, directional tone)
- position titles and outcome labels (Hebrew, Arimo)
- secondary metadata (small, muted)
- history prose (Arimo, full sentence)

Requirements:
- Hebrew-first readability
- IBM Plex Mono for *all* numerals — money, percentages, timestamps, counts
- Arimo for everything else
- mixed RTL/LTR handling on numbers within Hebrew sentences (use `unicode-bidi: plaintext` / `isolate` as needed)

Current font direction:
- Arimo + IBM Plex Mono per platform lock (trending handoff, 2026-05-12)
- weight cap 700
- no further font families on this page

## Color Guidance

Color should serve:
- direction (movement up vs down)
- state (open / closing soon / resolved)
- consequence (your action, your CTA, your "you are here")

Not:
- per-market identity (the rainbow rotation that previously existed is prohibited)
- decoration

Recommended behavior:
- **warm-amber `--hz-brand`** — reserved for moments of consequence only:
  - the deposit / funding CTA, if present
  - "your position" markers
  - selected state on tabs and timeframe filters
  - the **P&L sparkline line + fill** (added 2026-06-17): the one chart that carries brand identity, the way Polymarket's P&L curve carries its brand purple. Deliberate exception — the curve *is* the portfolio's signature; everything else here still earns amber only at the deposit amount + button.
- **trade colors** `--hz-action-buy` (mint) and `--hz-action-sell` (coral) — used for direction of movement and outcome side
- **info** `--hz-info` (cool blue) — restrained, only where buy/sell tone would mislead (e.g., neutral market status)
- **status** — restrained tone for open / closing / resolved, no traffic-light explosion

Hard rule: do not assign per-market tone via hash rotation. Outcomes carry their canonical buy / sell / info tone. If you cannot tell which tone applies, default to muted.

Hard rule: the legacy `--hz-market-blue` alias is for back-compat only. New code uses `--hz-info` or `--hz-brand`.

## Legal Framing Implication

This page must never look like an account statement *for gambling*.

Avoid cues associated with:
- sportsbook winnings tallies
- casino "session profit" panels
- "lucky streaks" / "wins this week" framing
- big celebratory positive-P&L animations

Prefer cues associated with:
- brokerage account statements (in tone, not in chrome)
- analyst-built P&L reports
- forecasting track records

Even when the user is up significantly, the page must still feel:
- sober
- analytical
- virtual-economy based

## Current Visual Smells To Watch

Based on the current route direction, watch for:
- per-market color rotation (rainbow toy-board effect)
- ticking countdowns on anything other than the <1h closing window
- engagement nudges ("you've earned X this week!", "trade more to climb")
- decorative gradients on summary cards
- generic dashboard chrome (busy headers, too many filter chips, illustrated empty states)
- the depth layer feeling louder than the top fold (means the hierarchy has inverted)
- inline Tailwind tone strings reinventing `hz-position-pill` or other locked patterns
- harmonizing the top-fold ratio with trending's 65/35 (different job, different ratio)

## Resolved Via Stage Proof

These were Open Design Questions in the prior draft; the stage proof landed answers:
- **Top-fold ratio:** 50/50 stretch, locked
- **Frame width:** 1020px (per-surface, narrower than trending/market-detail at 1280px)
- **Positions tab default sort:** biggest day movement (default); user can override via sortable column headers
- **Change-card chart with movers overlay:** no — chart stays single-line, movers fall to the positions tab default sort (movers removed from the pnl card entirely)
- **Closing-soon location:** full-width strip below top fold (not nested in pnl card)
- **A fourth zone for resolved-won claims:** added as the "נצחונות" strip between top fold and closing-soon

## Still Open

- **History typed event shape from backend.** Today fixture history carries hand-rolled `kind: "trade" | "settlement"` events; view-model derives chip+tone in `buildHistoryTypeChip`. When backend exposes typed events (trade, claim, expiry, deposit, fee), the chip-derivation should be replaced with a direct mapping from the backend event-type field. Per *backend-seam-over-plaster*: ideally backend emits the Hebrew sentence too (`event.description` field), and the chip-tone is a typed enum (`buy | sell | info | warn`) rather than derived from `sideLabel === "קנייה"`. Once that lands, simplify `normalizeHistoryItem` in `view-model.js`.

## Intentionally Parked

- **Orders tab:** kept as its own tab with an honest empty state. Mechanic isn't needed yet; killing the tab and re-introducing it later costs more than leaving it parked. Revisit when limit-order flow has real volume.
- **Per-row redeem affordance** on resolved-won positions inside the positions tab. The claims strip already carries the diagnostic CTA ("you have wins, אסוף") at the top of the page. Per-row אסוף would duplicate the CTA for a rare state. Future revisit only if user research shows the strip isn't getting the click.
- **`hz-position-pill` → `.pf-state-chip` unification across surfaces.** Portfolio now uses `.pf-state-chip` (tone-aware, three variants, multi-context). The legacy `.hz-position-pill` (single-tone, single-purpose) still lives at `assets/css/patterns/position-pill.css` and is consumed by market-detail's `community.js`. Unification is a market-detail-touching task, not a portfolio one — parked here so a future market-detail session can pick it up.

## Implementation Guardrails

When the redesign starts:
- do not add a fourth question to the top fold
- do not let the pnl card grow louder than the total card on the right (the lede must dominate)
- do not introduce per-market tone rotation
- do not introduce live ticking on anything other than the < 1h countdown
- do not redesign session/security into a device-management center
- do not move the trade ticket UI onto this page; trading lives on market-detail
- claims strip never renders empty — show nothing if no claims

## Success Test

The page is successful when a user lands on it cold and, within 3 seconds, without scrolling and without clicking, can say aloud:

> "I'm [up/down] X V₪. [Position Y] moved most. [Position Z] is closing [soon]."

And, when there are unclaimed wins:

> "I have [N] wins waiting, total [X] V₪."

And the page still feels:
- legible
- sober
- self-contained
