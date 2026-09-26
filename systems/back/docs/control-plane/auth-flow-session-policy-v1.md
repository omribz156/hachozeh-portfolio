# Auth Flow And Session Policy V1

Updated: 2026-06-10
Status: current
Owner: backend / access lane

Purpose:
- define the product and backend policy for:
  - sign up
  - log in
  - verify
  - stay signed in
  - sign out
- keep auth behavior explicit now that the happy path already works
- stop random pages or future lanes from inventing auth policy by accident

Read with:
- `systems/back/docs/current-status.md`
- `systems/back/docs/control-plane/user-account-lifecycle-v1.md`
- `systems/back/docs/control-plane/README.md`
- `systems/design/guide/components/page-overlay.md`
- `SECURITY.md`
- `workspace/tasks/completed/platform-control-plane-foundation.md`
- `workspace/tasks/completed/06-market-integrity-and-abuse-controls.md`
- `systems/back/docs/market-integrity-and-abuse-controls-v1.md`

## Top-Level Product Model

Hachozeh has two public-facing product states:
- `guest`
- `user`

Meaning:
- `guest`
  - anonymous visitor
  - may browse discovery and market-detail reads
  - may not perform user-state or money-state actions
- `user`
  - authenticated platform account
  - may perform session-bound reads and writes

Important:
- `admin` is not a third product mode
- it is a hidden privileged backend capability
- public UX should still think in `guest` / `user`

## Core Rule

Auth should decide:
- whether the visitor is still a `guest`
- or is now a `user`

Auth should not decide:
- balances
- portfolio value
- market permissions
- admin lifecycle truth

Those belong elsewhere.

## Identity Path V1

Use one primary launch identity path:
- Google OAuth

Secondary path:
- email OTP stays supported by the existing challenge/verify spine.
- resend/recovery UX can be added later without changing session truth.

Not in current V1:
- phone OTP
- providers beyond Google
- password flow

Reason:
- Google gives the cleanest launch entry with verified identity and low friction
- email OTP remains useful for fallback/operator flows
- both paths must converge into the same backend session and user-account truth

## Google OAuth Launch Path

Google auth uses redirect-based OAuth:
- `GET /api/auth/google/start?returnTo=<current-page-url>` redirects to Google
- `GET /api/auth/google/callback` validates state, exchanges the code, reads verified Google identity, creates or resumes a user, sets the normal session cookie, and redirects back to `returnTo`

Rules:
- frontend does not store Google tokens
- backend owns Google token exchange and session creation
- `returnTo` must be sanitized against `PUBLIC_BASE_URL` origin
- Google identity key is `user_identities.type = 'google'` and `identifier_normalized = Google sub`
- verified Google email may link to an existing email identity instead of creating a duplicate user
- new Google users receive the same first-account starter grant as email OTP users

## Login vs Signup Semantics

Product meaning:
- `signup`
  - user intent: "I want to create/use Hachozeh for the first time"
- `login`
  - user intent: "I already have a Hachozeh account"

Backend/privacy rule:
- public responses should not reveal whether an email already exists
- both flows may proceed to OTP without account enumeration

Verification rule:
- if the identity already exists:
  - verification signs into that existing user
- if the identity does not exist:
  - verification creates a new user and first session

Meaning:
- login and signup are distinct UX intents
- but they converge into one privacy-safe verify path

Why:
- cleaner OTP flow
- avoids "email not found" leaks
- matches the current thin auth model well

## Dev Vs Production Access

Dev/operator access:
- local/operator testing may use the fixed dev OTP, gated by
  `AUTH_DEV_OTP_EXPOSED=true` (default-closed; never active in production —
  `assertProductionInvariants` refuses the boot)
- with the flag off, OTP codes are random and delivered by email only
- OTP rate limits hold in every environment

Retired (2026-06-10): the invite-only signup flow. The old invite-required
flag, email-bound invites, and related invite smoke commands were removed —
the platform launches fully open. Migration `030_drop_beta_invites.sql`
dropped the table and `otp_challenges.beta_invite_id`. History:
the historical access-retirement record.

Code-backed routes:
- `GET /api/auth/google/start`
- `GET /api/auth/google/callback`
- `POST /api/auth/start`
- `POST /api/auth/verify`
- `POST /api/auth/logout`
- `GET /api/session`
- `GET /api/me`
- `PATCH /api/me/profile`
- `POST /api/me/avatar`
- `DELETE /api/me/avatar`
- `GET /api/uploads/avatars/:fileName`
- `GET /api/me/sessions`
- `DELETE /api/me/sessions/:sessionId`
- `POST /api/me/sessions/revoke-others`
- `GET /api/me/notification-preferences`
- `PUT /api/me/notification-preferences`

Code-backed env:
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_OAUTH_REDIRECT_URI`
- `GOOGLE_OAUTH_STATE_SECRET`
- `REQUIRE_SESSION_FOR_TRADES` (was `BETA_SESSION_ONLY`)
- `PUBLIC_BASE_URL` (was `BETA_PUBLIC_BASE_URL`)
- `AUTH_DEV_OTP_EXPOSED` (replaced `BETA_SUPPRESS_DEV_OTP`, inverted + default-closed)

## First-Time User Policy

On first successful verification of a new identity:
- create `users` row
- create primary `user_identities` row
- create `user_cash` account
- issue first session
- post the documented welcome grant through ledger truth

Rule:
- the welcome grant happens on first successful account creation only
- never on repeated logins for the same identity

## Guest Gating Policy

Guests may:
- browse feeds
- open market-detail pages
- read passive/public platform surfaces

Guests may not:
- trade
- read portfolio
- deposit or purchase currency
- use notifications
- access account-only actions

When a guest attempts a blocked action:
- stay on the current page
- open the auth overlay on top of that page
- do not bounce them away unless the page itself is guest-only and success needs a signed-in home

## Overlay Policy

Overlay is UX only.

Backend session is truth.

Current mapping stays:
- `login`
- `signup`
- `otp`
- `auth-processing`
- `auth-error`
- `auth-success`

Rule:
- do not let overlay state become the source of auth truth
- do not move auth truth into local page state

## Post-Auth Navigation Policy

Default rule:
- after successful verification, keep the user on the current surface when that surface is valid for users

Examples:
- market detail:
  - stay on the same market page
- portfolio-triggered auth:
  - go to portfolio if that was the intended protected target
- guest landing shell auth:
  - redirect to signed-in landing with success affordance

Practical V1 rule:
- preserve current page context where possible
- only redirect to signed-in landing when the starting surface was the guest landing shell path

## Post-Logout Policy

Logout means:
- revoke current session
- clear session cookie
- clear frontend auth state immediately

User-facing behavior:
- if current page requires authenticated truth, route to guest home
- otherwise stay on the current public page in guest mode

Current product-safe default:
- shared shell may send logout back to guest landing
- later refinement can preserve more current-page context

## Resend Policy

V1 does not need a dedicated resend endpoint yet.

Policy:
- resend may be implemented by calling `POST /api/auth/start` again with the same identifier and intent
- backend cooldown remains authoritative

Minimum rules:
- short resend cooldown
- short OTP TTL
- bounded verify attempts
- no trust in client timers

Current baseline:
- resend cooldown: `30s`
- OTP TTL: `10m`
- max attempts: `5`

## Session Policy

V1 session rules:
- cookie-backed server session only
- one current session cookie per browser context
- multiple active sessions across devices/browsers are allowed in V1
- logout revokes the current session only
- self-service may revoke every other active session while keeping the current one alive
- admin user-ops may still revoke all sessions

Expiry policy:
- explicit session expiry is required
- V1 may use fixed expiry without sliding extension
- `last_seen_at` should still update for audit/support truth

Current implementation-aligned baseline:
- session TTL: `7d`
- valid session reads update `last_seen_at`
- stale/expired/invalid cookies are cleared explicitly by backend responses

## Session Summary Contract

Keep `GET /api/session` narrow.

It should answer:
- authenticated or not
- current actor id when authenticated
- session expiry
- masked identity hint

It should not become:
- full user profile
- balance endpoint
- capability kitchen sink

Use `GET /api/me` for platform-user truth and own-profile read fields.
Use `PATCH /api/me/profile` for own display-name/bio updates.
Use `POST /api/me/avatar` and `DELETE /api/me/avatar` for own avatar storage; V1 accepts PNG/JPEG/WebP/GIF data URLs up to 4MB, quarantines raw bytes, runs configured `AVATAR_MALWARE_SCANNER` fail-closed, decodes/re-encodes with `sharp`, stores only sanitized WebP files under `workspace/runtime/uploads/avatars`, and reads them through `/api/uploads/avatars/:fileName` with `nosniff`.
Use `GET /api/me/sessions` for narrow self session/security truth.
Use `GET/PUT /api/me/notification-preferences` for settings-page preference storage only; delivery is a later system.
Use `GET/PUT /api/me/social-links` and `DELETE /api/me/social-links/:platform` for manual public-profile link storage. V1 supports X, Telegram, Instagram, and website; OAuth/verification is later.
Use `GET /api/me/data-export` for direct session-only JSON data download. Do not route this through email unless an async export/store worker is intentionally added.
Use `GET/POST/DELETE /api/me/account-deletion` for scheduled self-delete state. Scheduling blocks trading and revokes other active sessions during a 14-day grace window; final erasure/anonymization remains a separate privacy worker because ledger rows cannot be casually deleted.
Use `POST /api/feedback` for signed-in idea/bug/feedback submissions. This is an inbound operator seam, not a guest contact form; backend stamps `user_id` from the session and ignores client identity.

## Multi-Session And Device Policy

V1 policy:
- allow multiple sessions
- keep device-management UX thin: current session + capped active session rows + disconnect actions
- store enough session metadata for later support/risk work:
  - `last_seen_at`
  - `ip_hash`
  - `user_agent_hash`

Reason:
- current platform does not need fancy device UI
- but future support/risk work will need session facts

Current authenticated self-read:
- `GET /api/me/sessions`
- keep it compact:
  - `summary.activeCount`
  - `summary.hasOtherActiveSessions`
  - `summary.lastSeenAt`
  - `currentSession.id`
  - `currentSession.expiresAt`
  - `currentSession.lastSeenAt`
  - capped `sessions[]` with `id`, generic `label`, `current`, `createdAt`, `lastSeenAt`, `expiresAt`
  - capped `recentSecurityActions`
- do not turn it into raw support telemetry; labels stay generic because UA/IP are hashed in V1

Current authenticated self-mutation:
- `DELETE /api/me/sessions/:sessionId`
  - revoke one owned non-current session
  - current-session logout remains owned by `POST /api/auth/logout`
- `POST /api/me/sessions/revoke-others`
- purpose:
  - let the user cut off every other live session fast
  - keep the current browser alive
- keep the response thin:
  - `revokedSessionCount`
  - `revokedAt`

## Error Policy

Public auth errors should be:
- safe against account enumeration
- specific enough for recovery
- not overly technical

Good examples:
- invalid or expired code
- wait before requesting another code
- please start again

Avoid:
- "this email does not exist"
- "this email already exists"
- backend-detail leakage

## Demo Actor Removal Policy

Demo actor mode is now a bridge only.

Removal order:
1. keep public guest reads truly public
2. keep auth/session stable on served pages
3. keep trade/portfolio fully session-bound
4. remove demo fallback from protected routes
5. keep dedicated workspace/test/dev helpers outside normal product behavior

Rule:
- demo fallback must not survive just because it is convenient
- especially not on trade, portfolio, or privileged flows

## Relationship To User Lifecycle

This doc owns:
- flow semantics
- guest/user transitions
- session behavior

It does not own:
- user lifecycle states
- trade block semantics
- operator lock/unlock flows

Those live in:
- `systems/back/docs/control-plane/user-account-lifecycle-v1.md`

## Recommended Next Build Order

1. prove Google OAuth with real provider credentials and callback origin
2. keep email OTP as fallback/operator path, then wire real delivery only if it remains user-facing
3. keep `GET /api/me`, session summary, and revoke-other-sessions as the shared account truth
4. decide whether logout should preserve more current-page context
5. remove demo fallback from protected trade/portfolio flows after credentialed frontend paths are stable

Current proof status:
- Google OAuth service/routes exist in current code, including state signing and email-identity linking
- `smoke:auth-session` exists and covers the session spine
- session-bound quote path stayed healthy after control-plane widening

## Short Rule

`signup` and `login` may feel different to the user.

They should still converge into one privacy-safe OTP verify path.
