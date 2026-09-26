# Site Shell

Updated: 2026-05-20
Status: current
Owner: frontend / shell surface

Purpose:
- document the shared header/footer component
- reduce repeated rediscovery in future sessions
- keep guest and user header logic explicit
- pair with the surface contracts under `surfaces/shell/`

## This Doc Owns

- shared header/footer mount contract
- shell variants and their current runtime behavior
- shell-level loading/order constraints
- the inventory of chrome affordances (search, social, hamburger, wallet, bell, avatar, brand)
- the stub contracts the shell relies on (live count, search results, notifications, verification)

## This Doc Does Not Own

- shell visual doctrine (lives in `workspace/docs/design.md`)
- engagement-lane philosophy (`surfaces/shell/global-menu-and-engagement-surfaces.md`)
- trust/support-lane philosophy (`surfaces/shell/trust-support-surfaces.md`)
- backend contracts behind the stubs (`workspace/coordination/shell-backend-stubs.md`)

## Source Files

- `systems/design/assets/js/components/site-shell.js` — structural renderer + lifecycle wiring
- `systems/design/assets/css/patterns/site-shell.css` — surface tone (color, spacing, type, motion)
- `systems/design/assets/js/components/auth-session.js` — auth state the shell reads from
- `systems/design/assets/js/components/site-shell-portfolio-summary.js` — wallet summary seam (cash only in chrome)
- `systems/design/assets/js/runtime-config.js` — backend base config
- `systems/design/assets/css/base.css` — tokens + reset + primitives floor
- `systems/design/tailwind.config.js` — legacy alias map for Tailwind utility names

The JS is structural; the CSS is taste. Changes to color/spacing/type should land in CSS without touching JS. Changes to markup/structure happen in JS.

## What The Component Owns

The site shell currently owns:
- top header (chrome row)
- secondary nav row (feeds + categories + nav-end destinations)
- global footer
- hamburger menu (two content variants, eagerly built at wire time and appended to `body`; rebuilt on every rewire)
- overlay-opening CTAs for login / signup / deposit

The shell is mounted into pages with data attributes, not copied as static markup.

## Mount Contract

Header mount:

```html
<div data-site-shell data-shell-variant="landing-guest" data-page="trending"></div>
```

Footer mount:

```html
<div data-site-footer></div>
```

The page should also load:

```html
<link href="../assets/css/base.css" rel="stylesheet" />
<link href="../assets/css/patterns/site-shell.css" rel="stylesheet" />
<link href="../assets/css/tailwind.css" rel="stylesheet" />
<script src="../assets/js/runtime-config.js"></script>
<script src="../assets/js/components/auth-session.js"></script>
<script src="../assets/js/components/site-shell-portfolio-summary.js"></script>
<script src="../assets/js/components/site-shell.js"></script>
```

Important:
- any page that can upgrade from guest shell to authenticated shell must load `site-shell-portfolio-summary.js`
- otherwise the wallet falls back to local demo numbers even when the session is real
- `auth-session.js` and `site-shell-portfolio-summary.js` keep a short-lived tab cache in `sessionStorage`
- purpose: avoid guest→user shell flips and fake wallet flashes on full page hops
- backend remains source of truth; cache is only for visual stability until refresh completes

## Current Logic Shape

The shell is built from:
- shared auth-session bootstrap
- shared logged-user portfolio summary seam
- shared route/constants layer
- shared top-row assembly
- shared secondary nav assembly
- shared footer assembly
- explicit auth-state header actions
- explicit shell variants
- an eagerly-built hamburger menu, appended to `body` at wire time and rebuilt on every rewire

Meaning:
- guest and user remain separate product modes
- repeated brand/search/nav/footer markup stays shared
- auth-specific actions stay isolated by mode
- when backend auth is enabled, effective shell mode follows `GET /api/session`, not just static page markup
- local frontend sessions on `127.0.0.1` / `localhost` auto-enable backend auth against `http://127.0.0.1:3001`
- explicit query params like `backendBase` override when a workspace/test/session needs a different target

## Supported Header Variants

### `landing-guest`

Used by pages whose first paint is for unauthenticated users.

Top row (RTL right→left):
- brand (mark + wordmark)
- search bar (shown for guests too — market search is a public endpoint; ≥768px)
- `איך זה עובד?` walkthrough CTA (`.hz-shell__hiw-link`, guest-only, paired beside the search; ≥768px, label→icon-only on the 768–1023 band; mobile reaches it via the hamburger)
- *(flex gap)*
- `התחברות` ghost CTA
- `הרשמה` amber CTA
- `☰` hamburger trigger

Nav row (RTL right→left): same as user mode.

Pages currently using guest first-paint:
- `pages/trending.html`
- `pages/landing-page-guest.html`
- `pages/new-markets.html`
- `pages/breaking-markets.html`
- `pages/graphs-and-accuracy.html`
- `pages/qanda.html`
- `pages/market-detail.html`

Behavior:
- sticky shell (since 2026-05-31) — scrolls with the page until `top: 0`, then sticks; moves naturally with iOS / Chrome pull-to-refresh and overscroll instead of being glued behind the browser's native gesture UI like the previous `position: fixed` did
- no dedicated spacer div — the sticky wrap takes flow space directly; downstream content sits below it without extra padding
- both popovers anchored to the shell (hamburger menu, "+ עוד" dropdown) close on scroll so they can't drift away from their trigger when the wrap moves under sticky
- `trending` is the canonical landing tab for both guest and authenticated home
- shared browse/detail pages mount guest shell by default and upgrade to user shell only after auth truth arrives
- `live` is intentionally non-routed for now (no `live.html` page exists yet)

### `landing-user`

Used by pages mounted directly into authenticated UX.

Top row (RTL right→left):
- brand (mark + wordmark)
- search bar with dropdown
- *(flex gap)*
- wallet cell — **cash only** (`זמין למסחר V₪ <amount>`)
- `הפקדה` amber CTA
- bell with red dot (notification indicator)
- avatar — **doubles as the hamburger trigger** (no separate `☰`)
  - frame-aware wrapper (placeholder amber border now; SVG frames future)
  - verified `✓` badge slot (bottom-right, visible when verified)
  - presence dot (bottom-left, mint when online)

Nav row: same as guest.

Pages currently using authenticated first-paint:
- `pages/landing-page-user.html`
- `pages/portfolio.html`
- `pages/admin-market-management.html`

Behavior:
- same fixed-overlay sticky behavior as guest
- deposit CTA opens on top of the current page; never routes the user into a separate page flow
- when backend auth is enabled, the wallet renders `availableCash` from `GET /api/portfolio/snapshot` via the shared seam
- **credit reconcile seam**: the shell listens for a `wallet:credited` window event and re-reads `GET /api/portfolio/snapshot` (forced fresh, bypassing the shared cache) to show the real post-credit balance, plus a brief `.is-pop` bounce on the cell. The daily-streak claim overlay is the first emitter (`public/scripts/daily-streak/`); future payouts can reuse the same event. The number is always server-authoritative — never an optimistic client-side add
- when shared auth carries `/api/me` restriction truth, the signed-in shell may show a compact restriction badge:
  - locked account badge when `user.status === "locked"`
  - trade-block badge when `capabilities.canTrade === false` and `user.tradeAccessStatus === "blocked"`
  - badge copy may use `user.lockReasonCode` and `user.lockedAt`, but must not appear during `/api/me` fetch failure

## Nav Row Anatomy

The nav row is the second strip below the header. Structure:

```
[feeds]  |  [categories ──→ fade]  [nav-end: חברתי · עוד]
```

Three layout zones:

- `.hz-shell__nav-track` — flex row with `overflow-x: auto`, holds feed shortcuts + categories. Has a `mask-image` gradient that fades content at the inline-end so overflow tapers instead of clipping mid-word.
- `.hz-shell__nav-end` — sibling outside the masked track. Holds platform-destination links (`חברתי`, `עוד`). Items here stay sharp regardless of overflow.
- `.hz-shell__nav-divider` — 1px vertical hairline inside the track, separates feeds from categories.

### Feed shortcuts (4 items)

| key | label | icon glyph | semantic |
|---|---|---|---|
| `trending` | טרנדי | `local_fire_department` (hot signal) | default landing |
| `live` | לייב | pulsing red dot + live-count pill | activity beat |
| `breaking` | מתפרץ | `bolt` (warning signal) | urgent |
| `new` | חדש | `auto_awesome` (new signal) | latest |

The `live` item is unique: it renders as a cluster of `[dot] לייב [count-pill]`. The pulsing dot is CSS animation (`hz-live-pulse`); the count is updated periodically — see "Live count stub" below.

### Categories (15 entries)

| key | label |
|---|---|
| `politics` | פוליטיקה |
| `security` | ביטחון |
| `economy` | כלכלה |
| `sports` | ספורט |
| `crypto` | קריפטו |
| `legislation` | חקיקה |
| `technology` | טכנולוגיה |
| `entertainment` | בידור |
| `climate` | אקלים |
| `health` | בריאות |
| `energy` | אנרגיה |
| `education` | חינוך |
| `people` | אישים |
| `science` | מדע |
| `fx` | מ"טח |

Category links navigate to the current page with `?category=<key>`. Landing feeds should use that query state to reorder markets by the selected category.

Categories overflow horizontally with a fade mask. Most-used categories stay sharp; the long-tail (education, people, science, FX) fades but is still reachable by horizontal scroll. The nav row is also where additional destinations live (see next section).

### nav-end destinations

The nav-end slot holds platform destinations that are not market lenses:

- **`חברתי`** — community/social surface teaser. Pill chrome with `forum` icon + label. Rendered disabled until the surface exists.
- **`עוד`** — "בעבודה" coming-soon teaser. Click opens a dropdown panel.

Both render with matched pill chrome so they read as a deliberate pair anchored to the row's end.

## "+ עוד" coming-soon panel

Opens from the `עוד` button. Contents are declarative data (`MORE_COMING_SOON` array in site-shell.js). Currently teases:

- לוח מובילים — תחרות שבועית של תחזיות
- תגמולים — הישגים על דיוק עקבי
- רשימות מעקב — שמור שווקים ועקוב
- תובנות אישיות — ניתוח התחזיות שלך

Each row has icon + label + sub + `בקרוב` amber pill. The panel also has an editorial header (`בעבודה`) and a "כתבו לנו" CTA at the bottom for feedback.

The panel uses `position: fixed` with JS-computed coordinates (see `wireCategoryMore`) to escape the nav-track's `overflow-x: auto` clip. Anchored under the trigger via `inset-inline-end: 0` semantics.

This panel is **not** a category overflow. The 15 categories above are the complete category vocabulary. The panel is a teaser for upcoming platform features that will eventually have real routes.

## Hamburger Menu

The hamburger holds engagement, account, trust, and operational items. Two content variants:

### Trigger

- **Guest**: explicit `☰` `.hz-shell__hamburger` button at the end of the actions row.
- **User**: the avatar IS the trigger. No separate `☰`. Clicking the avatar opens the menu. The verified badge + presence dot stay visible on the avatar.

### Behavior

- **Eagerly built** at wire time and appended to `document.body` so:
  1. it escapes any nav-track overflow clipping (`position: fixed`),
  2. selectors like `[data-auth-logout]` are DOM-discoverable by tests and tooling even when the menu is visually closed.
- CSS keeps it `display: none` until `.is-open` is added.
- Each time the shell re-wires (auth-state change, portfolio refresh, etc.), `wireHamburger` removes any prior menu node and rebuilds. The eager-mount + remove-and-rebuild combo means the menu is always in sync with the current shell mode (guest vs user); the cost is one DOM rebuild per rewire, which is cheap.
- JS-computed coordinates anchor the panel under the trigger.
- Closes on: outside click, `Escape` keypress, second click on trigger.
- `aria-haspopup`, `aria-expanded` on the trigger; `role="menu"` on the panel.

### Guest content

(declared as `HAMBURGER_GUEST` in site-shell.js)

- חברתי — `badge: בקרוב` (community surface, not yet built; mirrors the mobile bottom-tab slot)
- לוח מובילים — `badge: בקרוב`
- דיוק תחזיות והיסטוריה
- ─────────
- איך זה עובד
- **מטבע וירטואלי (V₪)** — `emphasis: true` (renders in brand amber; the trust/legal hook)
- תמיכה / צור קשר
- יש לכם רעיון? — `badge: בקרוב` (suggest-edits surface, picks up the role the desktop עוד dropdown's CTA used to hold)
- ─────────
- תקנון
- מדיניות פרטיות

No account header, no logout.

### User content

(declared as `HAMBURGER_USER` in site-shell.js)

- **Account header row** — two targets side by side:
  - **profile anchor** (avatar + name + rank) → `/portfolio`. Polymarket-style two-step: chrome avatar opens this menu, this anchor navigates into the profile surface.
  - **settings gear** (inline-end, LEFT in RTL) → `/settings` (placeholder route).
  - Shows verified badge if applicable + display name + rank/accuracy line (e.g. `דרגה 4 · 73% דיוק`).
- **מעורבות**
  - חברתי — `badge: בקרוב` (community surface, mirrors the mobile bottom-tab slot)
  - לוח מובילים — `meta: בקרוב` today; will become `meta: #127 השבוע` (their rank) when the surface ships
  - תגמולים — `badge: בקרוב`
  - הזמינו חברים — `badge: בקרוב` (refer & earn surface, not yet built)
- ─────────
- **תמיכה**
  - מרכז עזרה
  - דיוק תחזיות
  - תקנון
  - יש לכם רעיון? — `badge: בקרוב` (suggest-edits surface, picks up the role the desktop עוד dropdown's CTA used to hold)
- ─────────
- `התנתקות` — destructive variant, hairline-separated, carries `data-auth-logout`

Notification preferences live inside Settings (not a standalone menu item). "My history" is reachable via the profile anchor → portfolio (until a dedicated activity surface exists).

### Menu data shape

Each variant is a list of groups. A group can be either:
- `{ divider: true }` — renders as a hairline
- `{ label?: string, items: Item[] }` — renders a labeled group of items

Each item:

```js
{
  icon: "leaderboard",         // material-symbols glyph
  label: "לוח מובילים",
  href: "",                    // empty means disabled / coming soon
  meta?: "בקרוב",              // small right-side stat
  badge?: "בקרוב",              // amber pill (mutex with meta in current chrome)
  emphasis?: true              // amber text + bg on hover (use sparingly)
}
```

## Search

`.hz-shell__search` — input + icon + dropdown panel. Shown for **everyone** ≥768px (guests included — market search is a public endpoint, so it's live chrome, not dead). No longer auth-gated: the old `data-shell-user-search` JS toggle + SSR `hidden` attr were removed; visibility is purely the ≥768px CSS rule. Mobile (<768px) opens it via the bottom-tab search launcher.

### Input

Uses `input.class` specificity (`input.hz-shell__search-input`) and `appearance: none` to beat the Tailwind `forms` plugin's `[type='text']` reset. Don't drop those — see [css-base-contract.md → "Form-element specificity"](../base/css-base-contract.md) for the rationale.

### Dropdown panel

Click/focus the input → panel opens. Two tabs: **שווקים** (live results) / **משתמשים** (empty placeholder until the public profile model exists backend-side).

Input is debounced (`SEARCH_DEBOUNCE_MS = 180ms`). Queries shorter than `SEARCH_MIN_QUERY_LENGTH` (2 characters) are not sent — the panel shows a "type at least two characters" prompt instead. Queries that meet the threshold fetch live from `GET /api/search?q=<term>&kind=all&limit=8`. Results are cached per-session in a `Map` keyed by normalized query string, so moving around the page doesn't re-fetch the same query.

On fetch failure the panel shows an honest unavailable message (`SEARCH_ERROR`); no fake rows are rendered. The markets tab shows `"לא נמצאו שווקים"` for a successful empty result; the profiles tab always shows its placeholder message until profiles ship.

See `workspace/coordination/shell-backend-stubs.md` for the backend contract.

Closes on outside click, `Escape`.

## Stub contracts

One shell feature still runs on a stub today; the other two have graduated to live backend calls. Each is shaped to match its backend contract. See [workspace/coordination/shell-backend-stubs.md](../../../../workspace/coordination/shell-backend-stubs.md) for the full handoff.

### Live count "beat"

- Renders inside the לייב feed item as a small pill (`.hz-shell__feed-count`).
- Live: `refreshLiveCount()` polls `GET /api/markets/live-count` every 15s. On failure the last honest value is kept — no random jitter fallback.
- Pulsing red dot signals "alive"; number-only change avoids eye-noise on each tick.

### Search results

- Live: fetches `GET /api/search?q=<term>&kind=all&limit=8` with debounce + per-session cache.
- Markets tab returns live results; profiles tab returns empty until the public profile model is built backend-side.
- Stub arrays (`SEARCH_SAMPLE_RESULTS`, `SEARCH_PROFILES_RESULTS`) no longer exist — search graduated from stub to live fetch.

### Notifications

- Stub: bell red dot is always rendered.
- Real source: `GET /api/notifications/unread-count` + paginated stream.
- Click handler not wired (no notifications panel built yet).

## Brand mark + Verified badge

### Brand mark (`.hz-shell__brand-mark`)

Currently a CSS-only placeholder: amber 1.5rem square with the `נ` glyph (first letter of the legacy "נביא" wordmark). When the real logo lands, swap one of:

- replace the `::before { content: "נ" }` rule with an SVG mask / background-image
- replace the placeholder element in the markup with an `<img>` or inline `<svg>`

The brand wordmark (`.hz-shell__brand-name`) is a separate element. Both mark and wordmark stay at every breakpoint; the mark just scales up at mobile.

### Verified badge (`.hz-shell__avatar-badge`)

Hidden by default. Shown when the avatar element carries `.hz-shell__avatar--verified`. Currently always-on in stage demos for visual review; production should gate on real `user.isVerified` data once the verification system exists (earned, not paid — accuracy + streak thresholds).

Sits at the bottom-right of the avatar; presence dot (online indicator) sits at the bottom-left, mint.

## Footer

Shared across all mounted pages. Structure (top → bottom):

1. **Brand block** — `.hz-footer__brand`. Anchors the footer top with mark + wordmark + tagline + social icons. Adopted 2026-05-26 after a Poly/Kalshi side-by-side showed our previous "columns-only" footer reading thin/empty. The header anchors the page from above; the brand block anchors the footer from below — symmetry, not redundancy.
2. **Social icons** — `FOOTER_SOCIALS` in `site-shell.js`. Inline SVG buttons for X (Twitter), Telegram, Discord, rendered as circular `.hz-shell__social` chips. All `aria-disabled` with `.is-pending` (55% opacity + `title="<name> — בקרוב"`) until the channels exist. When a channel ships, set its `href` and remove the disabled state — no other changes needed.
3. **3 columns** — `FOOTER_SECTIONS` in `site-shell.js`:
   - `שווקים לפי קטגוריה` (5 categories with sub-labels)
   - `תמיכה` (פנה אלינו · דיוק תחזיות · סטטוס מערכת בקרוב · בלוג בקרוב)
   - `מוצר` (מרכז עזרה · רגולציה ורישוי · מטבע וירטואלי V₪ · API בקרוב · פעילות המערכת בקרוב) — in `systems/web` the non-help links (רגולציה / V₪ / legal) are greyed `aria-disabled` stubs until those pages exist; only `מרכז עזרה` → `/help`
4. Each column link has an optional **sub-label** (Polymarket-style editorial weight). Sub-labels are part of `FOOTER_SECTIONS[].links[].sub`. Density advantage over both competitors' footers — keep these.
5. **Regulatory paragraph** — `.hz-footer__regulatory`. Short virtual-currency clarity block (`V₪`, "not gambling", "no monetary value"). Trust hook per `trust-support-surfaces.md`. Bolded lead phrase.
6. **Bottom row** — copyright (`© 2026 החוזה. כל הזכויות שמורות.`) + legal links (תנאי שימוש · מדיניות פרטיות · עוגיות).

### Footer responsive

At desktop the 3 columns sit side-by-side (`.hz-footer__cols { grid-template-columns: repeat(3, 1fr); }` at ≥768px). At mobile (≤767px) the columns stack vertically AND **the links inside each section switch to a 2-column grid** (`.hz-footer__col-links { display: grid; grid-template-columns: repeat(2, 1fr); }`) — without this the footer reads as airy and very tall (single column of 5+5+4 items takes ~14 vertical rows). The mobile grid rule is placed in CSS **after** the base `.hz-footer__col-links { display: flex }` rule on purpose; same-specificity cascade ordering matters here.

The footer is otherwise stable across viewports — text scales by the base type system, no per-breakpoint surgery.

## Responsive compaction

Single set of rules. From `≤1280` down to `≤768` the strategy is **shed
ornament progressively** — wallet labels, second wallet cell, inline category
strip. At `≤640` the strategy changes: instead of shedding more, the shell
**re-shapes for mobile** (see "Mobile mode" below).

| breakpoint | what changes |
|---|---|
| `≤1280px` | wallet eyebrow label drops (numbers stay) |
| `≤1024px` | search bar narrows; second wallet cell would hide (the user shell only has one) |
| `≤768px` | inline category strip hidden — categories are reachable by horizontal scroll in mobile mode (see below); `עוד` is a feature-teaser panel, not a category overflow |
| `≤640px` | mobile mode (see next section) |

## Mobile mode (≤640px)

At phone widths the shell deliberately re-shapes rather than continuing to
shed. The collapse rules above (categories hidden, feed labels hidden) get
**reversed**, and a fourth surface appears.

### Top row

- right (start, RTL): mark + wordmark — both scaled up (`1.75rem` mark, `1.75rem` wordmark) so the brand cluster anchors the row
- left (end, RTL):
  - **user**: wallet balance chip · avatar (44px, doubles as hamburger trigger) · bell · deposit CTA
  - **guest**: ☰ hamburger · הרשמה pill · התחברות link
- search + link-muted drop — search lives in the bottom-tab + overlay; muted links go to the menu
- **wallet now STAYS on mobile** (2026-06-19, was desktop-only): rendered as a compact **gold balance chip** — soft gold fill + hairline gold border + gold value (`--hz-brand-strong`) — so the user always sees their balance. The gold value is **mobile-only**; desktop keeps the off-white `--hz-text` treatment

### Nav row — flatten + scroll

Feed-nav items and category items **share one horizontally-scrollable strip**
with text labels on everything. Active item gets the amber pill background.
The mask-fade taper at the inline-end (RTL: left edge) signals "there's more,
swipe" — sized so the first off-screen category (`פוליטיקה`) peeks through
half-faded.

- `+ עוד` button is hidden — categories are reachable inline by scroll
- `חברתי` link is hidden from nav-end — it lives inside the hamburger
  ("מעורבות" group, first item) instead
- `nav-end` is hidden entirely (חברתי and עוד both moved out)

Target affordance at 390px: four feed pills sit solid
(`טרנדי / לייב·N / מתפרץ / חדש`), the fifth (`פוליטיקה`) tapers into the fade.

### Bottom tab bar (mobile-only)

Fixed at the viewport bottom, safe-area-aware, 4 thumb-zone slots:

| slot | icon | label | behavior |
|---|---|---|---|
| 1 | `home` | בית | active on `data-page="trending"` |
| 2 | `search` | חיפוש | opens the search wrap as a top-anchored mobile overlay |
| 3 | `forum` | חברתי | disabled (`בקרוב`) — placeholder until the social surface ships |
| 4 | `account_balance_wallet` | תיק | user → portfolio; guest → login overlay |

Active state: amber color + 2px amber rail along the top edge of the slot.
The body gets `padding-bottom: 5rem + safe-area-inset-bottom` (via
`body:has([data-site-shell])`) so the last bit of page content stays
reachable above the bar.

### Search overlay

The bottom-tab search slot triggers `.is-mobile-open` on the search wrap. The
wrap surfaces as a top-anchored overlay (not full-viewport — leaves the rest
of the screen reachable) with:

- larger input (font `1rem`, taller pad)
- explicit X close button at the inline-start corner (renders only when
  `.is-mobile-open` is set)
- dropdown lays out statically below the input, capped at `60vh`
- click-outside also dismisses (existing search wiring); the X is the
  primary affordance because tap-outside is hard to target on a phone

The tab handler calls `e.stopPropagation()` because the search wiring
already listens for document clicks to dismiss — without it the open-then-
close fires in the same gesture.

### Hamburger pickups for mobile

Because חברתי and the עוד-style "what's coming" affordances no longer ride
in the nav row at mobile, the hamburger picks them up:

- top of "מעורבות" (user) / first group (guest): `חברתי` with `forum` icon,
  `בקרוב` badge
- bottom of "תמיכה" (user) / help group (guest): `יש לכם רעיון?` with
  `lightbulb` icon, `בקרוב` badge — the surface the עוד dropdown's CTA
  used to host at desktop

## History

### Stage scaffold — retired 2026-05-20

The shell briefly had a forked stage scaffold (`stage/shell.html` + `site-shell-stage.css` + `site-shell-stage.js`) used as a sandbox while building the current shell against the Poly/Kalshi reference. Once the shell promoted to production, the stage scaffold had no consumer — it existed only to host itself — and was deleted. Future shell experiments edit `patterns/site-shell.css` / `components/site-shell.js` in place, optionally behind a worktree or feature query.

### Encoding note

The shell file previously stored user-facing Hebrew strings as `\u05xx` escapes. The current shell uses direct Hebrew literals throughout — they're more readable and the rest of the codebase (HTML, other component files) already uses direct literals. The `\u` escape convention is preserved in some older files (e.g. `site-shell-portfolio-summary.js`) without functional difference.

If you need to add new Hebrew strings to the shell, use direct literals.

## Current Design Rules

- preserve Hebrew-first UI text
- preserve RTL layout
- keep header visually premium, not generic dashboard
- read `surfaces/shell/global-menu-and-engagement-surfaces.md` before changing the hamburger's engagement group, leaderboard / rewards / APIs links
- read `surfaces/shell/trust-support-surfaces.md` before changing footer support links, FAQ/help/docs/legal/social links, language/dark-mode controls, or placeholder utility routes
- keep guest and logged-in variants in one component file
- avoid duplicating shell markup back into pages
- keep auth/deposit CTA behavior aligned with the shared overlay system
- when adding form elements (inputs, selects), use `element.class` specificity to beat the Tailwind forms plugin reset — see `base/css-base-contract.md`

## Editing Guidance

When changing shell behavior:

1. consider whether the change is **taste** (CSS) or **structure** (JS). Land in the right file.
2. update `site-shell.md` (this file) in the same task if behavior or contract changes
3. keep shared markup shared unless product behavior truly differs
4. keep guest/user action areas explicit by mode
5. verify the relevant page mount still uses the correct `data-shell-variant`
6. verify `auth-session.js` still loads before `site-shell-portfolio-summary.js`
7. verify `site-shell-portfolio-summary.js` still loads before `site-shell.js` on logged-user pages
8. verify routed pages still load `base.css`, `tailwind.css`, and `patterns/site-shell.css`
9. cache-bust the `?v=` query on `patterns/site-shell.css` links across mounted pages when shipping a visual change

## Current Known Exceptions / Stubs

- Community, leaderboard, rewards, refer, notifications, settings, and social routes do not exist yet; shell renders them as disabled `בקרוב` affordances instead of clickable dead routes.
- Search is live (`GET /api/search`) — graduated from stub. Profiles tab returns empty until public profile model ships backend-side.
- Live count polls `GET /api/markets/live-count` every 15s — graduated from random walker. No fallback jitter; if the fetch fails the last honest value is kept.
- *(Previously: search showed hardcoded sample rows; live count was a JS random walker. Both removed.)*
- Notification bell red dot is always rendered, no panel wired — see backend stubs handoff.
- Verified badge is always-on in user-mode for visual review — production should gate on real `user.isVerified`.
- Account header inside the hamburger uses placeholder name/rank in stage — production should read from auth-session + portfolio summary.
- Standalone auth/deposit route files remain as fallback redirects into overlay state, not as primary UX pages.
