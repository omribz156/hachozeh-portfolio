# Admin Market Service

Updated: 2026-04-28
Status: current
Owner: frontend / admin surface

Purpose:
- define the first frontend seam for admin market commands
- keep future admin UI aligned to backend truth
- stop fake admin state from breeding in the client

Read with:
- `systems/design/guide/components/admin/README.md`
- `systems/design/guide/components/admin/admin-market-management.md`

## This Doc Owns

- market admin command service seam
- market admin request shapes
- market admin error/idempotency behavior

## This Doc Does Not Own

- route tab/layout behavior
- Oracle service contract
- user-op service contract

Those live in:
- `admin-market-management.md`
- `admin-oracle-service.md`
- `admin-user-service.md`

## Source Files

- `systems/design/assets/js/components/auth-session.js`
- `systems/design/assets/js/components/admin-market-service.js`
- `systems/design/pages/admin-market-management.html`
- `systems/design/assets/js/pages/admin-market-management.js`

## What This Owns

The shared admin service owns:
- backend base-url resolution
- credentialed admin command posts
- backend error normalization
- default idempotency key generation

Current first consumer:
- `systems/design/pages/admin-market-management.html`
  - thin internal route
  - uses the shared admin services directly
  - reads `/api/me` through shared auth state before opening admin tools
  - shows backend payload/error truth for market commands

Current commands:
- `create draft`
- `publish`
- `close`
- `resolve`

## Backend Truth

Current backend command routes:
- `POST /admin/markets`
- `POST /admin/markets/:id/publish`
- `POST /admin/markets/:id/close`
- `POST /admin/markets/:id/resolve`

Contract rules:
- real admin session only
- no demo fallback
- idempotency key required
- explicit lifecycle payloads returned from backend

Frontend rule:
- do not send client actor ids
- do not invent extra admin lifecycle states
- backend session truth decides whether the user is allowed to act
- shared auth may pre-gate on `/api/me`, but backend authz is still final

## Global Contract

The service attaches:

```html
window.NaviAdminMarketService
```

Methods:
- `createMarketDraft(request)`
- `publishMarket(marketId, request)`
- `closeMarket(marketId, request)`
- `resolveMarket(marketId, request)`
- `createIdempotencyKey(scope, subject)`
- `getBackendBaseUrl()`

## Request Shape Notes

`createMarketDraft` forwards:
- `marketId`
- `title`
- `description`
- `categoryKey`
- `openAt`
- `closeAt`
- `resolutionSource`
- `resolutionRules`
- `oracleSourcePolicy` optional
- `liquidityB`
- `closeOnEventCompletion`
- `eventCompletionCloseRequiresHumanApproval`
- `outcomes[]`
- `idempotencyKey`

`createMarketDraft` outcome entries forward:
- `outcomeId`
- `label`
- `shortLabel`
- `description`
- `colorKey`

`publishMarket` forwards:
- `publishAt`
- `seedAmount`
- `note`
- `reviewId`
- `checklistVersion`
- `managementApprovedAt`
- `idempotencyKey`

`closeMarket` forwards:
- `triggerType`
- `reason`
- `sourceUrl`
- `note`
- `oracleCaseId`
- `idempotencyKey`

`resolveMarket` forwards:
- `winningOutcomeId`
- `triggerType`
- `resolutionSourceUrl`
- `resolutionNote`
- `oracleCaseId`
- `evidenceSnapshot`
- `idempotencyKey`

Important:
- thin client only
- backend remains validator
- create route may omit `marketId` and let backend derive it
- `oracleSourcePolicy` is optional and currently backend-facing; front may add a real editor later
- close/resolve stay session-led; actor ids are not authored by the client
- service may normalize nullable strings and generate an idempotency key when missing

## Error Behavior

- backend `401` routes through `NaviAuthSession.handleUnauthorized`
- other backend failures throw an error with:
  - `status`
  - `code`
  - `payload`

## Editing Guidance

When admin command behavior changes:

1. update `systems/design/assets/js/components/admin-market-service.js`
2. update the first consumer route if request fields or response expectations changed
3. re-check the backend request/response contract first
4. keep command names route-aligned: `create`, `publish`, `close`, `resolve`
5. do not add local lifecycle reducers unless a real admin UI needs them
6. update this doc in the same task
