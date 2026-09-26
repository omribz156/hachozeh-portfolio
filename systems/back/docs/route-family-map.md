# Backend route family map

Updated: 2026-06-26
Status: current
Owner: backend lane

Purpose:
- show where HTTP route families live after the first route-soup cleanup
- keep `src/http/app.ts` from becoming the only map of the backend
- make future handler extraction boring

This is not the full API contract. For route parameters and consumer seams, use:
- `../../workspace/tasks/reference/current-backend-api-map.md`

## Current Handler Split

Thin app shell:
- `systems/back/src/http/app.ts`
  - creates the Fastify app server
  - wires Fastify close handling to the returned Node server

Fastify app:
- `systems/back/src/http/fastify-app.ts`
  - health/readiness/diagnostics routes
  - `GET /api/session`
  - `GET /api/auth/google/start`
  - `GET /api/auth/google/callback`
  - `POST /api/auth/start`
  - `POST /api/auth/verify`
  - `POST /api/auth/logout`
  - `POST /api/feedback`
  - `GET /api/uploads/feedback/:fileName`
  - `GET /api/me`
  - `PATCH /api/me/profile`
  - `POST /api/me/avatar`
  - `DELETE /api/me/avatar`
  - `GET /api/uploads/avatars/:fileName`
  - avatar uploads are session-only, 4MB max, quarantined, optionally scanner-checked, and stored as backend-sanitized WebP
  - feedback images are session-submitted, sanitized to WebP, stored under `feedback/` in R2/local fallback, and read only by admin sessions
  - `GET /api/me/sessions`
  - `DELETE /api/me/sessions/:sessionId`
  - `POST /api/me/sessions/revoke-others`
  - `GET /api/me/notification-preferences`
  - `PUT /api/me/notification-preferences`
  - `GET /api/me/notifications`
  - `POST /api/me/notifications/:id/read`
  - `POST /api/me/notifications/:id/dismiss`
  - `POST /api/me/notifications/read-all`
  - `POST /api/me/notifications/dismiss-all`
  - `POST /api/me/notifications/unread-all`
  - `GET /api/me/social-links`
  - `PUT /api/me/social-links`
  - `DELETE /api/me/social-links/:platform`
  - `GET /api/me/data-export`
  - `GET /api/me/account-deletion`
  - `POST /api/me/account-deletion`
  - `DELETE /api/me/account-deletion`
  - `GET /api/markets`
  - `GET /api/markets/live-count`
  - `GET /api/markets/:market`
  - `GET /api/markets/:market/prices`
  - `GET /api/markets/:market/stream`
  - `GET /api/markets/:market/trades`
  - `GET /api/markets/:market/save`
  - `POST /api/markets/:market/save`
  - `DELETE /api/markets/:market/save`
  - `GET /api/markets/:market/positions`
  - `GET /api/markets/:market/comments`
  - `GET /api/markets/:market/history`
  - `GET /api/markets/:market/price-history`
  - `GET /api/markets/:market/lifecycle-events`
  - `GET /api/search`
  - shell-shaped public market and profile search; profile results match only public handle/display name and expose only public shell identity, not email/bio
  - `GET /api/portfolio/snapshot`
  - `GET /api/portfolio/orders`
  - `GET /api/portfolio/history`
  - `GET /api/portfolio/performance`
  - `GET /api/portfolio/claims`
  - `POST /api/portfolio/claims/:claimId/claim`
  - `GET /api/market-detail/markets/:market`
  - DB-backed page-shaped read with fixture fallback only for legacy fixture keys
  - `GET /api/discovery/feed`
  - `POST /api/markets/:market/quote`
  - `POST /api/markets/:market/trades`
  - `POST /api/markets/:market/comments`
  - `POST /api/markets/:market/comments/:commentId/replies`
  - `POST /api/markets/:market/comments/:commentId/like`
  - `GET /admin/users/:user`
  - admin lock / unlock / archive / trade-block / trade-restore / session-revoke / starter-grant-reversal routes
  - `GET /admin/risk/signals`
  - `GET /admin/risk/signals/summary`
  - `POST /admin/risk/signals/:signalId/review`
  - risk signal inbox, summary, and manual review actions for endpoint abuse, OTP quota pressure, trade hammering, emergency faucet/grant pressure, and integrity-relevant trade/quote rejection signals
  - `POST /admin/markets`
  - `POST /admin/markets/:market/close`
  - `POST /admin/markets/:market/publish`
  - `POST /admin/markets/:market/resolve`
  - `POST /admin/markets/:market/void`
  - Oracle review queue / alerts / case detail / market assist
  - Oracle lifecycle worker status / family-route audit / source capability check
  - Oracle candidate intake / review action / approve candidate
  - SSE routes use Fastify's native server so long-lived responses keep the
    real `ServerResponse`
  - route-family rate-limit attachment and 429 envelopes
  - request-id/CORS hooks
  - request completion metrics/logging
  - final 404/error guards

Shared handler helpers:
- `systems/back/src/http/default-market-stream-bus.ts`
  - shared default SSE bus for public market streams and trade broadcasts
- `systems/back/src/http/market-stream-broadcasts.ts`
  - shared post-trade, lifecycle, and comment SSE broadcasts
- `systems/back/src/http/json.ts`
  - shared CORS header builder and raw SSE response helpers still used by
    Fastify request hooks and market streams
- `systems/back/src/http/rate-limit.ts`
  - route-family classification and in-memory per-client limits used by
    Fastify's request hook for market reads, portfolio reads, trade writes,
    session reads, auth writes, auth verify attempts, admin writes, Oracle writes, a catch-all
    `admin_write` bucket for `/admin/*`, and a bounded `general_request`
    fallback for unmatched `/api/*` paths
  - shared IP-level SSE connection cap across market, portfolio, and discovery
    streams, layered on top of per-market/per-actor/per-feed stream caps
- `systems/back/src/risk/market-integrity-service.ts`
  - endpoint-abuse policy, risk signal recording, summaries, review actions, and admin risk-signal read model

## Current Test Split

Shared HTTP test harness:
- `systems/back/test/http/app-test-harness.ts`
  - starts the app against stubbed DB query handlers
  - closes test servers after each test
  - owns shared portfolio query fixture helpers

Extracted route-family tests:
- `systems/back/test/http/health-routes.test.ts`
  - `GET /health/live`
  - `GET /health/diagnostics`
- `systems/back/test/http/public-market-routes.test.ts`
  - public market catalog/detail/live-count/prices/trades/history/price-history/stream reads
- `systems/back/test/http/market-lifecycle-events-routes.test.ts`
  - public sanitized lifecycle-event timeline route
- `systems/back/test/http/market-stream-bus.test.ts`
  - in-memory market stream bus fanout and close behavior
- `systems/back/test/http/market-stream-broadcasts.test.ts`
  - stream event framing for comment fanout over the existing market bus
- `systems/back/test/http/search-routes.test.ts`
  - shell market search contract and tiny-query no-DB guard
- `systems/back/test/http/discovery-routes.test.ts`
  - `GET /api/discovery/feed`
- `systems/back/test/http/portfolio-routes.test.ts`
  - portfolio snapshot, orders, history, performance, claims, and claim-action routes
- `systems/back/test/engine/portfolio/portfolio-claim-service.test.ts`
  - pending claim reads and user-claimed payout mutation
- `systems/back/test/http/auth-session-routes.test.ts`
  - current-user, Google auth route behavior, session summary, revoke-other-sessions, and anonymous session routes
- `systems/back/test/auth/google-oauth-service.test.ts`
  - Google OAuth state, token exchange/userinfo handling, identity linking, and session creation behavior
- `systems/back/test/http/cors-preflight-routes.test.ts`
  - browser `OPTIONS` coverage for trade/auth/admin write routes
- `systems/back/test/http/admin-oracle-routes.test.ts`
  - admin auth guards plus Oracle assist/intake/admin-role checks
- `systems/back/test/http/risk-routes.test.ts`
  - admin risk-signal auth/read/summary/review routes plus OTP quota and faucet rejection signal recording
- `systems/back/test/risk/market-integrity-service.test.ts`
  - risk signal storage, classification, trade-rejection filtering, summaries, review actions, hammering patterns, grant rejection signals, and read model
- `systems/back/test/http/market-detail-routes.test.ts`
  - passive market-detail page-shaped reads and retired meeting route
- `systems/back/test/http/admin-user-routes.test.ts`
  - admin user truth, lock, archive, and starter-grant reversal routes
- `systems/back/test/http/admin-market-lifecycle-routes.test.ts`
  - admin create, publish, close, resolve, and void route-family dispatch

Retired:
- `systems/back/test/http/app.test.ts`
  - old mega-suite split into route-family files on 2026-05-03

## Still Inline In `app.ts`

No product route families remain inline.

Keep inline:
- runtime server construction only

## Extraction Rule

Good handler boundary:
- one route family
- route matching
- request parsing
- actor resolution for that family
- service error translation
- response writing

Do not move:
- domain logic into HTTP handlers
- SQL into HTTP handlers
- product copy or frontend shaping into generic backend route maps
