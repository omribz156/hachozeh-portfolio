# Control Plane

Updated: 2026-05-27
Status: current
Owner: backend / access lane

Purpose:
- front door for backend auth/session/user-account docs
- keep control-plane truth out of the engine salad
- group guest/user/session/account policy in one place
- route identity-provider details to one doc before code changes

## Read Order

1. `systems/back/docs/control-plane/user-account-lifecycle-v1.md`
   - user aggregate, lifecycle state, operator actions
2. `systems/back/docs/control-plane/auth-flow-session-policy-v1.md`
   - guest/user auth flow, Google OAuth, email OTP fallback, production session policy, overlay behavior
3. `systems/back/docs/current-status.md`
   - what backend control-plane surfaces already exist in code

## What Each Doc Owns

- `user-account-lifecycle-v1.md`
  - `users`
  - `user_identities`
  - `sessions` relationship
  - operator actions
  - trade-access policy
- `auth-flow-session-policy-v1.md`
  - guest vs user semantics
  - signup/login/verify behavior
  - Google OAuth redirect/callback behavior
  - email OTP challenge behavior
  - production session-only flags
  - session-cookie policy
  - logout/resend/overlay rules

## Rule

- auth proves who is here
- user lifecycle says what the account may do
- ledger/accounts own money truth
- frontend never stores provider tokens or invents actor identity
