# Market Integrity And Abuse Controls V1

Updated: 2026-06-17
Status: current
Owner: back-risk lane

Purpose:
- define the first boring market-integrity posture
- keep abuse detection aligned with existing operator actions
- avoid ML theater before basic endpoint and account-risk rules exist

## Scope

V1 covers first-line detection and review, not automatic punishment.

Covered now:
- route-family rate-limit crossings
- OTP send quota pressure
- trade/quote rejection signals for selected abuse-sensitive failures
- repeated account-linked trade rejection patterns
- emergency faucet/grant rejection signals
- admin-visible risk signal inbox
- compact admin risk summary
- manual admin review actions for risk signals
- recent user-linked risk context in admin user reads
- operator response policy tied to existing user controls

Not covered yet:
- graph/collusion analytics
- multi-account clustering
- permanent fraud scoring
- automated account locks
- destructive correction flows

## Endpoint Policy

| Endpoint family | Default posture | Default response |
| --- | --- | --- |
| `market_read` | audit only | watch scrape pressure; block only after repeated or service-impacting pressure |
| `portfolio_read` | audit only | review repeated signed-in account-read hammering |
| `trade_write` | review needed | review actor, market, recent trades; use trade-block or lock only with supporting evidence |
| `auth_write` | review needed | review auth pressure; prefer cooldown and observation before account lock |
| `auth_otp_send` | review needed | review OTP pressure and quota burn; throttle first, then lock only if account-linked abuse repeats |
| `feedback_write` | audit only | watch for spam pressure; moderate content separately |
| `admin_write` | block candidate | investigate immediately; admin write pressure can indicate automation or compromised operator access |
| `oracle_write` | block candidate | investigate immediately; Oracle writes affect trust and lifecycle truth |
| `economy_grant` | review needed | review faucet or grant pressure before reversing grants or restricting accounts |

## Signal Storage

Risk signals are stored as audit events:

- action: `risk.signal.recorded`
- actor: `system:risk-monitor`
- entity:
  - user actor when known
  - session when only session is known
  - hashed IP subject when unauthenticated
- payload:
  - `kind`
  - `severity`
  - `endpointFamily`
  - `method`
  - `path`
  - `reasonCode`
  - hashed IP when available
  - response recommendation
  - bounded details

Raw IPs and raw email identifiers are not stored in the risk payload.

## Signal Triggers

Current automatic signals:
- rate-limit exceeded for route families
- fallback `general_request` crossings for unmatched API paths
- OTP verification pressure via the `auth_verify` route family
- OTP send cap exceeded
- trade/quote rejection when the reason is integrity-relevant:
  - `market_state_version_mismatch`
  - `trade_access_blocked`
  - `invalid_request`
  - `unauthorized`
- `trade_hammering_pattern` when a known actor has 5 or more integrity-relevant trade write rejections in 10 minutes
- `economy_grant_rejected` for emergency faucet rejection reasons:
  - `emergency_faucet_cooldown`
  - `emergency_faucet_not_eligible`

Ordinary economic failures such as insufficient cash are not risk signals.

## Operator Surface

Admin read:

```text
GET /admin/risk/signals?limit=50
GET /admin/risk/signals?subject=<entity_id>
GET /admin/risk/signals/summary?windowHours=24
POST /admin/risk/signals/:signalId/review
```

The inbox endpoint returns recent signals plus the current endpoint policy map.

The summary endpoint returns counts by severity, endpoint family, reason code,
and open review count for the requested window.

The review endpoint records `risk.signal.reviewed` audit events with one of:
- `reviewed`
- `dismissed`
- `escalated`

`GET /admin/users/:id` also returns `recentRiskSignals` so operators can see
account-linked risk context beside session, portfolio, restriction, and grant
truth.

Operator response stays manual:
- `GET /admin/users/:id` for account context
- lock/unlock for account availability
- trade-block/trade-restore for trading access
- revoke sessions for suspected session compromise
- reverse starter grant for grant misuse
- archive only for support/admin lifecycle, not as a casual abuse button

## Boundary

V1 deliberately does not auto-lock accounts.

Rule:
- `observe`: record and trend
- `review`: show to operator; use existing controls only after context review
- `block_candidate`: investigate immediately; still requires human action

This keeps detection separate from punishment and avoids wrecking normal users during early platform launch.

## Production Limiter Backing

The current route-family limiter is in-memory and local-process scoped.

That is acceptable for local/dev proof and single-process production smoke, but not
for multi-process or production truth.

Before production/multi-instance deployment:
- keep the same route-family policy names
- move limiter state to shared backing, such as Redis or a DB-backed token bucket
- enforce the same family policy at the edge/WAF where possible and keep backend
  recording risk signals from limiter crossings
- preserve the existing `x-rate-limit-*`, `Retry-After`, and JSON error contract

Do not treat local in-memory counters as cluster-wide abuse evidence.
