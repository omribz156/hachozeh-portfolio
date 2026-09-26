# Admin User Service

Updated: 2026-04-28
Status: current
Owner: frontend / admin surface

Purpose:
- define the thin frontend seam for admin user ops
- keep user controls contract-led
- stop fake moderation state from leaking into the client

Read with:
- `systems/design/guide/components/admin/README.md`
- `systems/design/guide/components/admin/admin-market-management.md`

## This Doc Owns

- user-op service seam
- user read contract summary
- user-op error behavior

## This Doc Does Not Own

- admin route layout/tab behavior
- market command service contract
- Oracle service contract

Those live in:
- `admin-market-management.md`
- `admin-market-service.md`
- `admin-oracle-service.md`

## Source Files

- `systems/design/assets/js/components/auth-session.js`
- `systems/design/assets/js/components/admin-user-service.js`
- `systems/design/pages/admin-market-management.html`
- `systems/design/assets/js/pages/admin-market-management.js`

## What This Owns

The shared user-ops service owns:
- backend base-url resolution
- credentialed admin user-op posts
- backend error normalization

Current commands:
- `lock`
- `unlock`
- `archive`
- `trade-block`
- `trade-restore`
- `sessions-revoke`
- `starter-grant-reversal`

Current read:
- `GET /admin/users/:id`

## Backend Truth

Current backend routes:
- `GET /admin/users/:id`
- `POST /admin/users/:id/lock`
- `POST /admin/users/:id/unlock`
- `POST /admin/users/:id/archive`
- `POST /admin/users/:id/trade-block`
- `POST /admin/users/:id/trade-restore`
- `POST /admin/users/:id/sessions/revoke`
- `POST /admin/users/:id/reverse-starter-grant`

Contract rules:
- real admin session only
- no demo fallback
- `lock` and `trade-block` require `reasonCode`
- `archive` requires `reasonCode`
- read payloads are backend-owned snapshots with `user`, `identity`, `sessions`, and compact account/exposure truth
- read payloads may also include `archiveReadiness`, `starterGrant`, and `recentAdminOps`
- grant reversals should be compensating transactions, not silent balance edits
- write payloads are backend-owned snapshots / audit results

Frontend rule:
- do not invent user lists, moderation queues, or role state
- do not send actor ids
- if `/api/me` says no admin, keep the surface closed in the client

## Global Contract

The service attaches:

```html
window.NaviAdminUserService
```

Methods:
- `readUser(userId)`
- `lockUser(userId, reasonCode)`
- `unlockUser(userId)`
- `archiveUser(userId, reasonCode)`
- `blockUserTrading(userId, reasonCode)`
- `restoreUserTrading(userId)`
- `revokeUserSessions(userId)`
- `reverseStarterGrant(userId, request)`
- `buildCommandUrl(userId, action)`
- `buildStarterGrantReversalUrl(userId)`
- `getBackendBaseUrl()`

Grant reversal request fields:
- `reasonCode`

## Error Behavior

- backend `401` routes through `NaviAuthSession.handleUnauthorized`
- other backend failures throw an error with:
  - `status`
  - `code`
  - `payload`

## Editing Guidance

When user-op or user-read behavior changes:

1. re-check the backend route contract first
2. update `systems/design/assets/js/components/admin-user-service.js`
3. update the admin route consumer if fields or result expectations changed
4. keep it thin; no local moderation reducer unless real read surfaces exist
5. update this doc in the same pass
