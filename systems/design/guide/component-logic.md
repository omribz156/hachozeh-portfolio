# Component Logic

Updated: 2026-05-13
Status: current
Owner: frontend lane

Purpose:
- lightweight entry file
- keep session startup small
- point work to deeper component docs

Read order for trending / breaking / new discovery work:
1. `ARCHITECTURE.md`
2. `systems/design/guide/surfaces/discovery/trending-front-page.md`
3. `systems/design/guide/components/hz-card.md`
4. `systems/design/guide/components/social-game-box.md`
5. `systems/design/pages/trending.html` (the canonical surface). Siblings:
   - `pages/breaking-markets.html` — redesigned 2026-05-25 with its own row+track pattern (not `hz-card`); see `guide/surfaces/discovery/breaking-page.md`
   - `pages/new-markets.html` — still awaits redesign
6. `systems/design/assets/js/pages/trending-stage.js` (also serves breaking/new via `data-feed=` when the page uses the trending shape — does *not* drive `breaking-markets.html`, which has its own `breaking-markets-stage.js`)
7. `systems/design/assets/js/pages/discovery-data-source.js`
8. `systems/design/assets/js/data/guest-landing-feed-data.js` and `breaking-markets-page-data.js` only for local-seed fallback truth

Read order for shell work:
1. `systems/design/guide/components/site-shell.md`
2. `systems/design/assets/js/components/site-shell.js`
3. `systems/design/guide/base/css-base-contract.md`
4. `systems/design/assets/css/base.css`
5. `systems/design/tailwind.config.js` when legacy Tailwind aliases are in scope
6. relevant mounted page only

Read order for overlay work:
1. `systems/design/guide/components/page-overlay.md`
2. `systems/design/guide/components/site-shell.md`
3. `systems/design/assets/js/components/page-overlay.js`
4. `systems/design/assets/js/components/site-shell.js`
5. `systems/design/guide/base/css-base-contract.md`
6. `systems/design/assets/css/base.css`
7. relevant mounted page only

Read order for fallback auth/deposit route work:
1. `systems/design/guide/components/page-overlay.md`
2. relevant fallback route under `systems/design/pages/`
3. `systems/design/assets/js/components/fallback-route.js`
4. `systems/design/assets/js/components/page-overlay.js` only if the overlay contract itself is changing

Read order for market-detail work:
1. `ARCHITECTURE.md`
2. `systems/design/guide/components/market-detail.md`
3. `systems/design/pages/market-detail.html`
4. `systems/design/assets/js/pages/market-detail.js` if chart/outcomes/ticket behavior is in scope
5. `systems/design/assets/css/pages/market-detail.css`
6. `systems/design/guide/base/css-base-contract.md` if base tokens/primitives are in scope
7. `systems/design/assets/css/base.css`
8. `workspace/scripts/browser-qa/tests/market-detail-guest-readonly.spec.mjs` / `workspace/scripts/browser-qa/tests/market-detail-authenticated-holdings.spec.mjs` when live auth/holding truth is in scope
9. `workspace/tasks/reference/history/market-detail-follow-up.md`

Read order for portfolio work:
1. `ARCHITECTURE.md`
2. `systems/design/guide/components/portfolio.md`
3. `systems/design/pages/portfolio.html`
4. `systems/design/assets/js/pages/portfolio-data-source.js`
5. `systems/design/assets/js/pages/portfolio.js`
6. `systems/design/assets/js/data/portfolio-page-data.js` for fallback seed truth
7. `workspace/scripts/browser-qa/tests/portfolio-live.spec.mjs` when systems/back/session truth is in scope
8. `workspace/tasks/queued/03-frontend-authenticated-surface-expansion.md`

Read order for admin command work:
1. `SECURITY.md`
2. `systems/design/guide/components/admin/README.md`
3. `workspace/tasks/queued/03-frontend-authenticated-surface-expansion.md`
4. `workspace/tasks/completed/07-admin-market-management-foundation.md` for the landed route foundation
5. `systems/design/guide/components/admin/admin-market-management.md`
6. matching service doc:
   - `systems/design/guide/components/admin/admin-market-service.md`
   - `systems/design/guide/components/admin/admin-oracle-service.md`
   - `systems/design/guide/components/admin/admin-user-service.md`
7. `systems/design/assets/js/components/auth-session.js`
8. matching frontend service file
9. matching backend service contract only

Read order for extracted static-page work:
1. relevant route under `systems/design/pages/`
2. matching page data under `systems/design/assets/js/data/`
3. matching page controller under `systems/design/assets/js/pages/`
4. `systems/design/guide/components/site-shell.md`
5. `systems/design/guide/components/page-overlay.md` if the page has overlay CTAs

Current extracted page pairs:
- `systems/design/pages/trending.html`
  - `systems/design/assets/js/pages/trending-stage.js`
  - `systems/design/assets/js/pages/discovery-data-source.js`
  - `systems/design/assets/js/data/guest-landing-feed-data.js` (local-seed fallback)
- `systems/design/pages/portfolio.html`
  - `systems/design/assets/js/data/portfolio-page-data.js`
  - `systems/design/assets/js/pages/portfolio-data-source.js`
  - `systems/design/assets/js/pages/portfolio.js`
- `systems/design/pages/graphs-and-accuracy.html`
  - `systems/design/assets/js/data/graphs-and-accuracy-page-data.js`
  - `systems/design/assets/js/pages/graphs-and-accuracy.js`
- `systems/design/pages/qanda.html` — RETIRED 2026-06-09. The Q&A surface was
  rebuilt as the Help Center (`מרכז עזרה`) in `systems/web` at `/help`
  (`/help/[topic]/[article]`, content-collection backed). `/qanda` 301s to
  `/help`. These three legacy lab files are now deletable design-ref:
  - `systems/design/assets/js/data/qanda-page-data.js`
  - `systems/design/assets/js/pages/qanda.js`
  - design lab for the new surface: `systems/design/design_handoff_help_center/`
  - surface contract: `systems/design/guide/surfaces/help-center/README.md`

Source of truth:
- card pattern and variant rules live in `systems/design/guide/components/hz-card.md`
- trending surface composition and locked decisions live in `systems/design/guide/surfaces/discovery/trending-front-page.md`
- social/game side panel (mock-data shape + future community-API seam) lives in `systems/design/guide/components/social-game-box.md`
- header/footer shell logic lives in `systems/design/guide/components/site-shell.md`
- auth/deposit overlay logic lives in `systems/design/guide/components/page-overlay.md`
- fallback auth/deposit route redirects live in tiny route files plus `systems/design/assets/js/components/fallback-route.js`
- market-detail route ownership and local ticket behavior live in `systems/design/guide/components/market-detail.md`
- live discovery feed bridge lives in `systems/design/assets/js/pages/discovery-data-source.js`
- this file should stay short and stable

Current component docs:
- `systems/design/guide/components/admin/README.md`
- `systems/design/guide/components/admin/admin-market-management.md`
- `systems/design/guide/components/admin/admin-market-service.md`
- `systems/design/guide/components/admin/admin-oracle-service.md`
- `systems/design/guide/components/admin/admin-user-service.md`
- `systems/design/guide/components/hz-card.md` (the active card pattern)
- `systems/design/guide/components/social-game-box.md`
- `systems/design/guide/components/portfolio.md`
- `systems/design/guide/components/site-shell.md`
- `systems/design/guide/components/page-overlay.md`
- `systems/design/guide/components/market-detail.md`

Historical (retired renderers — kept for context, do not write new code against):
- `systems/design/guide/history/legacy-market-card-renderer.md`
- `systems/design/guide/history/legacy-featured-market-renderer.md`
- `systems/design/guide/history/legacy-guest-market-feed-renderer.md`

Rule:
- if admin route ownership changes, update `systems/design/guide/components/admin/admin-market-management.md` first
- if admin market command wiring changes, update `systems/design/guide/components/admin/admin-market-service.md` first
- if admin Oracle wiring changes, update `systems/design/guide/components/admin/admin-oracle-service.md` first
- if admin user-op wiring changes, update `systems/design/guide/components/admin/admin-user-service.md` first
- if card pattern, variants, or hero shape changes, update `systems/design/guide/components/hz-card.md` first
- if trending surface composition (hero zone, filter row, stream, social panel layout) changes, update `systems/design/guide/surfaces/discovery/trending-front-page.md` first
- if header/footer logic changes, update `systems/design/guide/components/site-shell.md` first
- if auth/deposit overlay logic changes, update `systems/design/guide/components/page-overlay.md` first
- if social/game-box mock-data shape or API seam changes, update `systems/design/guide/components/social-game-box.md` first
- if market-detail route/ticket ownership changes, update `systems/design/guide/components/market-detail.md` first
- keep this file as the entrypoint, not the full dump
