# systems/web — Active Astro + Preact Frontend

Updated: 2026-06-28
Owner: frontend lane

This is the active Hachozeh frontend. It is Astro SSR with Preact islands and a persistent
ClientRouter shell for soft navigation. `systems/design/` is the upstream design sandbox — doctrine,
canvas, and prod-page reference material; nothing there ships directly. New product surfaces are
built and shipped here. The design constitution, doctrine, and guide in `systems/design/guide/`
remain the authority reference — tokens, surfaces, and base laws apply here too.

## Dev Flow

Start the build-loop watcher (from repo root):

```bash
npm --prefix systems/web run dev
```

This runs the Astro build in watch mode (`build --watch`). Do NOT use `astro dev` — it serves an
uncached dev server that does not match the production path. Do NOT use the retired `:4173` static
preview server.

**Daily work topology:**

```
dev.hachozeh.com   (email-gated via Cloudflare Access)
  → Cloudflare Tunnel
    → Caddy :6969  (TLS termination / local reverse proxy)
      → Astro build output :4321  (npm run dev above)
      → /api/* + /health* → backend :3001
```

The `dev.hachozeh.com` gateway replaced the retired Mac-proof direct access (retired 2026-06-03).
Production `hachozeh.com` is the live Render gateway; use this dev host only for gated local proof.

Full topology: `workspace/dev/README.md`
Migration QA history: `workspace/tasks/completed/astro-migration.md`
Dev environment setup: `workspace/dev/README.md`

## Folder Map

### `src/pages/`

Astro page routes. Each `.astro` file is a route. Most legacy `.html.astro` redirect shims were
removed after migration cleanup; keep only route-specific compatibility files that still exist.

Current route inventory:
- `index.astro` — trending / front door
- `trending.astro`
- `breaking-markets.astro` / `breaking-markets.html.astro`
- `new-markets.astro`
- `portfolio.astro`
- `profile.astro` — signed-in owner convenience route / profile entry
- `[handle].astro` — public profile route, `@handle` model
- `settings.astro`
- `achievements.astro`
- `community.astro`
- `community/t/[id].astro`
- `topics/[categoryKey].astro`
- `status.astro`
- `privacy.astro`
- `terms.astro`
- `cookies.astro`
- `accessibility.astro`
- `help/index.astro` — Help Center hub (`מרכז עזרה`); content-collection backed
- `help/[topic].astro` — help topic / collection
- `help/[topic]/[article].astro` — help article (markdown body + TOC)
- `qanda.astro` / `qanda.html.astro` — retired Q&A, 301 → `/help`
- `graphs-and-accuracy.astro`
- `event/[slug].astro` — public/canonical market detail doorway; resolves event slug then rewrites to the market renderer
- `markets/[marketKey].astro` — market detail (SSR, dynamic)
- `share/claims/win.astro`
- `fallback/[kind].astro`
- `404.astro`

Parked/deleted route:
- `/admin/markets` is not an active `systems/web` route. The old Astro admin route was deleted in the post-migration curation lane; treat future admin work as a new lane, not a current route.

### `src/components/`

Astro components organized by surface.

Top-level shared components:
- `FeedPage.astro`, `MarketCard.astro`, `HeroCarousel.astro`, `SiteHeader.astro`, `SiteFooter.astro`, `SocialGameBox.astro`
- `components/header/`, `components/overlay/`, and page-specific Preact islands own interactive chrome and overlays
- `currency/VShekel.jsx` — shared VShekel JSX helpers: `VShekelAmount`, `VShekelPrice`, `VShekelProbabilityPrice`, and `VShekelText`

#### `src/components/market-detail/`

Islands and sections for the market-detail route:
- `ChartIsland.astro`, `OutcomeLadder.astro`, `EventLadder.astro`
- `TradeTicketIsland.astro`, `ViewerPositionsIsland.astro`
- `TrustSection.astro`, `CommunitySection.astro`
- Preact islands handle the market-detail shell; legacy static scripts remain only where explicitly listed under `public/scripts/`

#### `src/components/portfolio/`

- `PortfolioIsland.astro`

#### `src/components/static/`

- `StaticPageShell.astro`

### `src/layouts/`

- `Layout.astro` — global shell (header, footer, auth client bootstrap)

The layout vendors the auth client from `src/client/auth/` and the shell session handler from
`src/client/shell/`.

### `src/client/`

Vanilla-JS client modules loaded by the layout:
- `auth/auth-session.js` — auth state machine
- `auth/page-overlay.js` — email-gate overlay
- `auth/runtime-config.js` — env injection
- `currency/vshekel.client.js` — exposes `window.HZCurrency.moneyHtml(value)`, `moneyText(value)`, `symbolHtml()`, and `upgrade(root)`; upgrades plain/dynamic `V₪` text into shared symbol markup
- `shell/header-session.client.js` — header reactive session state

Auth state is broadcast as a `navi:auth-state` custom event on `window`, picked up by islands.
ClientRouter means some scripts run in one long-lived document; click interception that must beat
the router uses capture phase, and page-specific lifecycle should bind on Astro navigation events.

### `src/lib/`

SSR data-fetching helpers (Astro server context only):
- `market-detail.js`, `discovery.js`, `feed-helpers.js`
- `vshekel.ts` — SSR/string helpers for the custom VShekel symbol (`vshekelMoneyHtml`, `vshekelMoneyText`, `vshekelSymbolHtml`)

### `src/styles/`

CSS layer, token-first. Mirrors the doctrine from `systems/design/guide/base/`.

- `global.css` — entry; imports base + patterns
- `base/tokens.css` — `--hz-*` design tokens
- `base/reset.css`, `base/primitives.css`, `base/compat.css`
- `pages/` — route-scoped overrides (market-detail, portfolio, event-mode, etc.)
- `patterns/` — shared component patterns (site-shell, outcome-ladder, trade-ticket, hero-card, etc.)
  - `patterns/vshekel.css` — shared `hz-money` and `hz-vshekel-symbol` contract; paints `/assets/currency/vshekel-symbol.png` as a `currentColor` mask while preserving `V₪` fallback text

## Currency Rendering

VShekel is rendered as UI markup, not as a real Unicode character. New web-visible money UI should use one of the shared helpers instead of hand-formatting visible `V₪` strings:

```jsx
<VShekelAmount value={25} />
<VShekelPrice value={45} />
```

For dynamic browser scripts, use:

```js
window.HZCurrency.moneyHtml(25)
window.HZCurrency.moneyHtml(123, { signed: true })
```

Money helpers accept `{ signed: true }` for PnL/deltas so positive values keep the visible `+`.
`symbolHtml()` / `<VShekelSymbol />` are accessible standalone symbols; inside an already-labelled
`hz-money` wrapper, use `symbolHtml({ decorative: true })` / `<VShekelSymbol decorative />`.

The rendered contract is `bdi.hz-money[dir="ltr"]` containing `.hz-vshekel-symbol` plus the number. This keeps symbol-first ordering stable inside Hebrew/RTL text and lets the symbol inherit local color.

### `public/scripts/`

Vendored vanilla-JS modules served as static assets (not bundled by Astro):
- `market-detail-chart.js`, `probability-chart-renderer.js`
- `components/pnl-sparkline-renderer.js`
- `portfolio/` — portfolio page modules (portfolio.js, positions-tab.js, etc.)

## Island Model

The app is SSR-first. Pages render static HTML on the server; interactive behavior is layered on via
Preact islands and small vanilla client modules that hydrate after paint.

Islands live under `src/components/` and are mounted by Astro. They communicate via custom DOM
events (`navi:auth-state`, portfolio stream events, etc.) rather than a global app store.
Component scripts are bundled by Astro/Vite into hashed `/_astro/` assets; modules under
`public/scripts/` are served unbundled as static assets where the legacy/vendored path is still
intentional.

## Soft Navigation Model

The site currently keeps Astro `ClientRouter` and uses a persistent shell:
- header/menu/auth chrome must live inside the persisted shell wrapper
- active navigation and page-specific behavior must re-sync on `astro:page-load`
- streams, intervals, observers, and page-owned event listeners must clean up on navigation
- anything that must intercept a click before ClientRouter should bind in capture phase

Current lane doc: `workspace/tasks/active/render-stability-clientrouter-and-font.md`.

## Authoritative References

- `workspace/tasks/completed/astro-migration.md` — migration QA receipt, per-route proof, known gotchas (including the per-outcome holdings shape)
- `workspace/tasks/active/render-stability-clientrouter-and-font.md` — active ClientRouter / persistent-shell / soft-nav stability work
- `workspace/tasks/active/preact-post-migration-curation.md` — active Preact migration cleanup ledger and parked follow-up tiers
- `workspace/tasks/reference/astro-port-curation-ledger.md` — older port-era curation ledger; reference only
- `workspace/dev/README.md` — full dev environment topology and Caddy/tunnel setup
- `systems/design/guide/README.md` — design reference (tokens, surfaces, doctrine)
- `workspace/docs/design.md` — platform design constitution; mandatory before product/design work
