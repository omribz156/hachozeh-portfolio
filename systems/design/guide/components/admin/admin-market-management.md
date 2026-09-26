# Admin Market Management

Updated: 2026-04-28
Status: current
Owner: frontend / admin surface

Purpose:
- document the first honest frontend admin consumer
- keep the route thin and contract-led
- stop future sessions from turning it into fake local admin state

Read with:
- `systems/design/guide/components/admin/README.md`
- `systems/design/guide/components/admin/admin-market-service.md`
- `systems/design/guide/components/admin/admin-oracle-service.md`
- `systems/design/guide/components/admin/admin-user-service.md`

## This Doc Owns

- the admin route surface
- which admin tabs/forms/read panels exist
- route-level gating and payload rendering rules

## This Doc Does Not Own

- market command service contract details
- Oracle service contract details
- user-ops service contract details

Those live in:
- `admin-market-service.md`
- `admin-oracle-service.md`
- `admin-user-service.md`

## Files

- `systems/design/pages/admin-market-management.html`
- `systems/design/assets/js/pages/admin-market-management.js`
- `systems/design/assets/js/components/admin-market-service.js`
- `systems/design/assets/js/components/admin-oracle-result-summary.js`
- `systems/design/assets/js/components/admin-oracle-workspace.js`
- `systems/design/assets/js/components/auth-session.js`

## Route Scope

- one internal route for admin ops
- thin forms for market commands:
  - create draft
  - publish
  - close
  - resolve
- thin forms for user ops:
  - lock
  - unlock
  - archive
  - trade-block
  - trade-restore
  - sessions-revoke
  - starter-grant-reversal
- thin user lookup/read panel:
  - `GET /admin/users/:id`
  - real backend user snapshot before writes
  - correction-ready control-plane context for grant reversal
  - compact account/exposure summary before archive decisions
  - backend-derived archive-readiness warning when unresolved exposure still exists
  - optional `starterGrant` and `recentAdminOps` sections when backend adds them
- live payload/error rendering from backend responses
- explicit session-status copy
- admin surface only opens when shared auth state confirms `canAccessAdmin`

## Important Rule

This route does **not** guess admin role.

Current backend truth now available to the page:
- authenticated session or not
- identity hint
- session expiry
- current user status / role / trade access
- capabilities:
  - `canTrade`
  - `canAccessAdmin`

Still not available:
- bulk admin read surfaces like draft lists / user search / audit history

Therefore:
- the route may close itself when `/api/me` says no admin
- the route may explain that backend authz still owns the final say
- the route must not fake local moderation or lifecycle state

## UI Contract

- page keeps the shared logged-user shell
- page keeps premium product styling, but reads clearly as internal ops
- management-layer copy inside this route stays English-only even though the consumer product is Hebrew-first
- user lookup panel stays thin and read-first
- lookup panel may render starter-grant state and recent admin ops when backend sends them
- starter-grant reversal stays compensating-transaction-shaped, not a balance editor
- archive stays explicit about terminal account state, session cut-off, and audit
- archive read context should warn when settlement/exposure still lives on the account
- result panel shows real backend payloads
- Oracle results may render a small scan summary above raw JSON, but the JSON payload remains visible and authoritative
- Oracle surface may use a richer workspace layout, but command execution still runs through the same thin service seams
- Oracle result cards may prefill the next Oracle form:
  - alerts -> case detail / review queue
  - queue -> case detail
  - queue/case detail -> review action
- Oracle form drafts may persist through rerenders so one submit/error cycle does not wipe the operator handoff
- Oracle surface may now load backend `alerts` and show scheduler pressure cards:
  - stale review/recommended cases
  - missing resolution trail after close
  - fetch-gap pressure near/after close
- Oracle intake / approve forms should hydrate a backend market-assist panel from the current market + case-type
- the market-assist panel should show exact backend outcome keys, market metadata, and source-policy counts before winner selection
- a small seeded fallback map is acceptable only as temporary loading coverage, not as the source of truth
- resolution submit should block locally when the typed winner key is outside the loaded backend market truth
- resolution submit may also pause while market-assist is still loading, rather than racing stale form state
- error panel shows backend status/code/message honestly
- no local lifecycle reducer
- no fake draft list
- no fake audit history
- runtime snapshots may be persisted by backend for Oracle `alerts` / lifecycle heartbeats, but the frontend should treat snapshot ids as audit breadcrumbs, not as a second truth source
- Oracle alerts/results may show a compact recent runtime-memory strip:
  - latest lifecycle heartbeat / alerts snapshots
  - enough for drift/pressure memory
  - not a dashboard empire

## Portfolio Entry

Current entry point:
- `systems/design/assets/js/pages/portfolio.js`

Rule:
- only show the entry card in backend session mode
- only show it when shared auth state says `canAccessAdmin=true`
- keep the copy explicit:
  - internal tools
  - backend-backed admin truth
  - no fake admin truth

## Good Next Steps

- add real admin read surfaces before adding picker-heavy UI
- keep correction flows explicit and compensating-transaction shaped
- keep starter-grant / recent-ops display compact and backend-led
- if backend later exposes admin role safely in `/api/session`, the page can boot faster with the same truth
- if admin read routes arrive later, add real draft/market pickers before adding visual complexity
