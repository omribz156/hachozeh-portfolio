# Admin Oracle Service

Updated: 2026-04-28
Status: current
Owner: frontend / admin surface

Purpose:
- define the first frontend seam for Oracle operator actions
- keep admin Oracle reads/actions aligned to backend truth
- avoid page-local fetch soup in the first review surface

Read with:
- `systems/design/guide/components/admin/README.md`
- `systems/design/guide/components/admin/admin-market-management.md`

## This Doc Owns

- Oracle admin service seam
- Oracle admin route contract summary
- Oracle-specific error/idempotency behavior

## This Doc Does Not Own

- admin route layout/tab behavior
- market command service contract
- user-op service contract

Those live in:
- `admin-market-management.md`
- `admin-market-service.md`
- `admin-user-service.md`

## Source Files

- `systems/design/assets/js/components/admin-oracle-service.js`
- `systems/design/assets/js/components/admin-oracle-result-summary.js`
- `systems/design/assets/js/components/admin-oracle-workspace.js`
- `systems/design/assets/js/components/admin-market-service.js`
- `systems/design/pages/admin-market-management.html`
- `systems/design/assets/js/pages/admin-market-management.js`

## What This Owns

The shared Oracle admin service owns:
- backend base-url resolution
- credentialed Oracle operator reads
- credentialed Oracle operator writes
- backend error normalization
- default idempotency generation for review actions

Current first consumer:
- `systems/design/pages/admin-market-management.html`
  - internal admin route
  - Oracle now has its own surface tab beside markets/users
  - still thin
  - still backend-led
  - management-layer copy stays English-only for operator clarity
  - Oracle form submits are checked before the shared admin submit handler exits on non-market/non-user forms
  - Oracle result summaries render queue/case/action payloads above raw JSON without becoming client-side truth
  - Oracle surface now uses a dedicated workspace composition with command rail + active mission panel
  - Oracle result cards can now launch the next exact form with prefilled fields instead of forcing manual case-id / candidate JSON copy-paste

Current commands:
- `readAlerts(options)`
- `readMarketAssist(marketId, options)`
- `readReviewQueue(options)`
- `readCaseDetail(caseId)`
- `intakeCandidateEvidence(request)`
- `reviewCase(request)`
- `approveResolutionCandidate(request)`

## Backend Truth

Current backend Oracle admin routes:
- `GET /admin/oracle/alerts`
- `GET /admin/oracle/market-assist/:marketId`
- `GET /admin/oracle/review-queue`
- `GET /admin/oracle/cases/:id`
- `POST /admin/oracle/intake-candidate`
- `POST /admin/oracle/review-action`
- `POST /admin/oracle/approve-resolution-candidate`

Contract rules:
- real admin session only
- no demo fallback
- Oracle evidence remains inspectable
- candidate evidence is not auto-trusted truth
- `alerts` may persist a runtime snapshot server-side so the operator has an audit breadcrumb for pressure checks
- `alerts` response may also include recent runtime snapshots so the operator can see fresh alerts/lifecycle memory without opening a second tool
- candidate intake now returns explicit domain errors such as `candidate_not_intakeable` when the supplied winner mapping does not belong to the target market, instead of collapsing that into a fake `internal_error`
- frontend intake / approve forms should ask backend `market-assist` for exact market truth before winner selection
- `market-assist` returns the canonical market key, title, current market status, exact outcome keys, and a compact source-policy summary
- frontend may keep a tiny seeded-market fallback map only while backend truth is loading or temporarily unavailable
- when exact market truth is loaded, frontend should block resolution submit if the typed `winningOutcomeKey` is not in that backend map
- when exact market truth is still loading for a resolution flow, frontend may hold submit briefly instead of racing a stale key to backend
Important:
- intake promotes candidate evidence into a persisted Oracle case/evidence/output trail
- review action remains explicit
- approve-from-candidate still goes through trusted resolve, not direct client mutation

## UI Stance

The first Oracle admin tab is intentionally thin:
- forms over fake local state
- payload/error truth shown directly
- small backend-payload summaries for operator scanability
- alerts cards may deep-link into existing queue/case forms instead of inventing a new client-side workflow
- alerts summary may show a compact runtime-memory list; still breadcrumb truth, not a client-owned timeline authority
- one dedicated workspace composition instead of a plain form stack
- launch buttons only prefill existing forms; they do not invent new client-side lifecycle state
- market-assist powers the outcome-map card so the operator sees exact backend keys instead of seed-only guesses
- no made-up dashboard metrics
- no hidden client reducers for lifecycle truth

This is good:
- usable operator seam now

This is not built yet:
- dedicated Oracle moderation console

Current guard:
- browser-QA checks that the Oracle review queue form reaches `GET /admin/oracle/review-queue`

## Editing Guidance

When Oracle admin behavior changes:

1. update `systems/design/assets/js/components/admin-oracle-service.js`
2. update `systems/design/assets/js/pages/admin-market-management.js`
3. check backend Oracle admin routes first
4. keep candidate evidence explicitly review-led
5. update this doc in the same task
