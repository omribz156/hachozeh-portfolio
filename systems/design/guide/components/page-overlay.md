# Page Overlay

Updated: 2026-04-28
Status: current
Owner: frontend / access surface

Purpose:
- document the shared auth + deposit overlay system
- keep overlay behavior out of chat history
- make fallback route behavior explicit

Read with:
- `systems/design/guide/component-logic.md`
- `systems/design/guide/components/site-shell.md`

## This Doc Owns

- overlay query-param state model
- shared auth/deposit overlay behavior
- fallback-route redirect contract

## This Doc Does Not Own

- shell layout
- backend auth/session truth
- real payment logic

Those live in:
- `systems/design/guide/components/site-shell.md`
- `systems/back/docs/control-plane/auth-flow-session-policy-v1.md`

## Source Files

- `systems/design/assets/js/components/auth-session.js`
- `systems/design/assets/js/components/page-overlay.js`
- `systems/design/assets/js/components/site-shell.js`
- `systems/design/assets/js/components/fallback-route.js`

## Scope

The overlay system owns:
- guest auth overlays
- signed-in deposit overlay
- auth success / handoff overlay
- backdrop, scroll lock, and URL-driven open state

It does not own:
- page content underneath
- shell layout
- backend auth truth
- real payment logic

When backend auth mode is enabled:
- overlay drives UX only
- auth/session truth comes from backend routes plus `GET /api/session`

## State Model

Overlay state is driven by the `overlay` query param on the current page.

Examples:
- `trending.html?overlay=login`
- `trending.html?overlay=signup`
- `trending.html?overlay=deposit`

Reason:
- back button closes or rewinds overlay state cleanly
- deep links stay possible
- current page context remains the base surface

## Current Overlay States

Guest pages:
- `login`
- `signup`
- `otp`
- `auth-processing`
- `auth-error`

Signed-in pages:
- `deposit`
- `auth-success`

## CTA Contract

Shared shell CTAs point to current-page overlay URLs and also include `data-overlay-open`.

Meaning:
- with JavaScript, overlays open in place without page reload
- without JavaScript, links still resolve to the same page with `?overlay=...`

## Fallback Routes

Standalone auth/deposit route files still exist as fallback entry points.

Current behavior:
- `systems/design/pages/fallback/login.html` redirects to `trending.html?overlay=login`
- `systems/design/pages/fallback/signup.html` redirects to `trending.html?overlay=signup`
- `systems/design/pages/fallback/otp.html` redirects to `trending.html?overlay=otp`
- `systems/design/pages/fallback/processing-of-login-or-signup.html` redirects to `trending.html?overlay=auth-processing`
- `systems/design/pages/fallback/signup-success.html` redirects to `trending.html?overlay=auth-success`
- `systems/design/pages/fallback/signup-failed.html` redirects to `trending.html?overlay=auth-error`
- `systems/design/pages/fallback/vshekel-deposit.html` redirects to `trending.html?overlay=deposit`

These files are fallback entry routes now, not primary UX surfaces.

Implementation note:
- these fallback routes should stay tiny
- redirect truth lives in the route target + `systems/design/assets/js/components/fallback-route.js`
- do not rebuild standalone auth/deposit page surfaces inside these files

## Current UX Notes

- overlay backdrop is **dim-only by default — no page-behind blur** (a soft radial dim, matched to the How It Works scrim). `.navi-overlay-backdrop` is defined once, in `auth-overlays.css` (the old duplicate in `base/primitives.css` was removed). Blur is **opt-in per overlay**: `renderOverlay()` stamps `[data-overlay="<name>"]` on the root, so a CSS selector keyed by overlay name re-enables blur for chosen overlays (none enabled today)
- `window.NaviOverlays = { open, close }` is a public seam (mirrors `NaviPageOverlayGuards`) so non-auth surfaces drive the overlay system without importing the module — e.g. How It Works hands off to signup via `NaviOverlays.open("signup")`
- **no close-X**: the corner × was removed from every overlay (auth + idea). Dismiss
  is tap-outside — the centering `.navi-overlay-shell` is `pointer-events: none` so a
  tap anywhere outside the panel falls through to the backdrop's `data-overlay-close`
  (only the panel stays interactive). Don't re-add a close-X. (The page-overlay system
  has no Esc; the back/switch links handle in-flow navigation.)
- page scroll is locked while an overlay is open
- auth-processing is now a short-lived waiting state around real backend start/verify calls
- first signed-in redirect now lands on clean `trending.html`, not `?overlay=auth-success`
- reason: smoother post-login browsing; no lingering overlay shell intercepting discovery clicks
- portfolio quick-deposit and shell deposit CTA both open the shared deposit overlay
- auth overlays use a compact `440px` panel width so login/signup fit standard laptop viewports without vertical scroll
- social auth buttons are rendered in a `2 x 2` grid to keep auth height under control
- login keeps a tiny bottom legal/help row
- signup keeps legal copy inline and does not repeat a bottom legal/help row
- OTP overlay can surface a dev helper code when backend returns `devCode`
- logout is triggered from the shared shell, but cleanup flows through the same shared auth-session state

## Editing Guidance

When changing overlay behavior:

1. update `systems/design/assets/js/components/page-overlay.js`
2. verify the relevant page already mounts `site-shell` and `page-overlay.js`
3. keep shell CTA behavior aligned with overlay states
4. update this doc and `workspace/docs/engineering-decisions.md` if the overlay contract changes
