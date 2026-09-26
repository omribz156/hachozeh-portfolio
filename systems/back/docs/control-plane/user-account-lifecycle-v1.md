# User Account Lifecycle V1

Updated: 2026-05-27
Status: current
Owner: backend / access lane

Purpose:
- define the first real platform user model beyond "auth actor exists"
- keep auth, session, user, and money boundaries from smearing together
- give later deposit, support, risk, and account-surface work one stable base

Read with:
- `systems/back/docs/control-plane/README.md`
- `systems/back/docs/current-status.md`
- `systems/back/docs/engine-decisions.md`
- `SECURITY.md`
- `workspace/tasks/completed/platform-control-plane-foundation.md`
- `workspace/tasks/completed/06-market-integrity-and-abuse-controls.md`
- `systems/back/docs/market-integrity-and-abuse-controls-v1.md`

## Current Truth

Already exists in code:
- `users`
- `user_identities`
- `otp_challenges`
- `sessions`
- `GET /api/me`
- `GET /admin/users/:id`

Already true in behavior:
- session cookie is backend truth
- quote/trade/portfolio bind to resolved actor
- admin routes require a real admin session
- current-user read is session-only with no demo fallback
- admin user read is session-only with no demo fallback
- `users` now carry first lifecycle/control fields:
  - `trade_access_status`
  - `lock_reason_code`
  - `locked_at`

What is still too thin:
- the meaning of a platform `user`
- user lifecycle and lock semantics
- operator/support-safe user actions

## Design Rule

Treat these as separate objects:

- `users`
  - platform account lifecycle and capability boundary
- `user_identities`
  - login identifiers and verification state
- `sessions`
  - browser/device authentication state
- `accounts` + ledger
  - money state only
- portfolio reads
  - derived trading state only

Do not collapse them into one blurry "account" object.

## What The User Aggregate Owns

The `users` aggregate should own:
- stable platform user id
- account lifecycle state
- role
- trade-access policy
- major lock/restriction reason
- created/updated/last-login timestamps

The `users` aggregate should not own:
- login codes
- session tokens
- balances
- portfolio value
- promo/grant balances
- profile fluff
- notification preferences

## Recommended V1 User Shape

Keep the core row small.

Recommended durable fields:
- `id`
- `status`
- `role`
- `trade_access_status`
- `lock_reason_code`
- `locked_at`
- `created_at`
- `updated_at`
- `last_login_at`

Recommended meanings:
- `status`
  - account availability
- `role`
  - authorization tier
- `trade_access_status`
  - whether the user may open/close exposure

Reason:
- full account lock and trade-only restriction are not the same thing
- support/risk/admin work will need that distinction fast

## Recommended V1 States

### User status

Use:
- `active`
- `locked`
- `archived`

Meaning:
- `active`
  - normal user account
- `locked`
  - no new authenticated platform use until reviewed/unlocked
- `archived`
  - terminal/internal state for later offboarding or suppressed accounts

Rule:
- do not encode every support/risk nuance into `status`
- keep `status` small and durable

### Trade access status

Use:
- `enabled`
- `blocked`

Meaning:
- `enabled`
  - user may trade normally
- `blocked`
  - user may still authenticate and view account state, but may not open/close positions

Important:
- trade block must not block rightful settlement payout
- money owed at resolution is not optional just because a user got restricted later

## Identity Rules

`user_identities` owns login identifier truth.

V1 rules:
- one primary identity path first
- email-first is fine for current implementation
- user id is the durable platform key, not the email
- a later second identity path should attach to the same user, not fork a second user silently
- verification belongs to identity truth, not to the `users` row

Do not add:
- `email` as the source-of-truth field on `users`
- login-only metadata to the `users` row just because it is convenient

## Session Rules

`sessions` owns browser/device authentication state.

V1 rules:
- session cookie resolves actor
- session validity depends on both:
  - session status
  - user status
- locked/archived users should not continue to get fresh authenticated platform use through old sessions
- session revocation should be possible without mutating money/account truth

## Money Boundary Rule

Money belongs to ledger/account truth, not to the user aggregate.

Meaning:
- `availableCash` lives in `accounts` + ledger derivation
- portfolio value lives in portfolio read models
- welcome grant belongs to ledger/audit truth
- future promo/deposit/reversal logic should not become booleans on `users`

Practical rule:
- one user may own one `user_cash` account in V1
- that still does not make the user row the cash source of truth

## First Current-User Read

Keep one dedicated current-user read instead of overloading `GET /api/session`.

Recommended endpoint:
- `GET /api/me`

Why:
- `GET /api/session` should stay about authentication/session truth
- `GET /api/me` should expose platform-user truth

Recommended response:

```json
{
  "user": {
    "userId": "user_123",
    "status": "active",
    "role": "user",
    "tradeAccessStatus": "enabled",
    "lockReasonCode": null,
    "lockedAt": null,
    "createdAt": "2026-04-04T10:00:00.000Z",
    "lastLoginAt": "2026-04-04T10:15:00.000Z"
  },
  "identity": {
    "primary": {
      "channel": "email",
      "identifierHint": "om***@g***.com",
      "verifiedAt": "2026-04-04T10:12:00.000Z"
    }
  },
  "capabilities": {
    "canTrade": true,
    "canAccessAdmin": false
  }
}
```

Rules:
- no raw normalized identifier
- no internal lock-review notes
- authenticated surfaces may use `lockReasonCode` + `lockedAt` to explain a real restriction state
- do not make frontend policy decisions from copy; `capabilities.canTrade` stays the gating truth
- no balance duplication from portfolio snapshot
- capability booleans should be derived server-side

## First Admin User Read

Keep the first admin-facing user read narrow and truthful.

Recommended endpoint:
- `GET /admin/users/:id`

Rules:
- admin session only
- no demo fallback
- no user list or search pretend mode yet
- expose safe control-plane truth only
- mask the primary identity
- include lifecycle and session summary fields if they help internal ops, but do not leak session tokens or raw identifiers
- allow a narrow extension for operator context:
  - starter-grant state
  - recent user-scoped admin actions
  - compact account/exposure summary
  - archive-readiness warning when unresolved exposure still exists
  - keep both compact and backend-derived

## Operator Actions V1

First operator-safe user actions should be narrow:
- lock user account
- unlock user account
- archive user account
- block trading
- restore trading
- revoke all active sessions

Current implementation status:
- landed 2026-04-05
- admin routes now exist:
  - `POST /admin/users/:userId/lock`
  - `POST /admin/users/:userId/unlock`
  - `POST /admin/users/:userId/archive`
  - `POST /admin/users/:userId/trade-block`
  - `POST /admin/users/:userId/trade-restore`
  - `POST /admin/users/:userId/sessions/revoke`
- lock/trade-block require `reasonCode`
- archive requires `reasonCode`, blocks trading, and revokes active sessions
- quote/trade runtime now enforces `trade_access_status`

## First Correction Path

Current first correction-safe adjustment:
- `POST /admin/users/:userId/reverse-starter-grant`

Rules:
- admin session only
- compensating ledger transaction only
- no silent balance edit path
- requires `reasonCode`
- succeeds only while user cash still covers the original grant
- response should stay correction-facing:
  - original grant transaction id
  - compensating transaction id
  - before/after cash + treasury values
  - whether reversal had already happened

Not this first cut:
- arbitrary balance edits here
- profile editing center
- notification management
- role sprawl beyond `user` / `admin`

## Auth Flow Relationship

This user model does not replace auth flow policy.

Split:
- `06b`
  - what a platform user is
- `06c`
  - how signup/login/session behavior works

Example:
- whether "login" may create a new user is an auth-flow question
- what state that created user starts in is a user-lifecycle question

## Recommended Build Order

1. lock this boundary in docs
2. add `GET /api/me`
   - landed 2026-04-05
3. widen `users` minimally for lifecycle + trade-access truth
   - first fields landed 2026-04-05
4. add narrow operator actions
   - landed 2026-04-05
5. remove demo fallback only after auth/session policy is explicit

## Non-Goals

Not part of this first user-account foundation:
- avatars
- public profiles
- follows/social graph
- settings center
- notification preferences
- payment provider work
- referral system
- KYC-style identity expansion

## Short Rule

Auth proves who is here.

`users` says what kind of account this is and what it may do.

Ledger/accounts say how much money it has.
