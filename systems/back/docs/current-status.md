# Backend Current Status

Updated: 2026-06-26
Status: current
Owner: backend lane

Purpose:
- give one factual checkpoint for what systems/back/runtime truth exists now
- reduce re-reading fatigue
- keep "what is live" separate from backend doctrine and backend shape docs

Read this when:
- you need current systems/back/runtime truth
- you need to know what is verified vs still bridgey
- you are about to touch backend contracts, lifecycle, auth, or trust seams

This doc is not:
- the backend architecture explainer
- the engine doctrine
- a historical milestone memo

For those, read:
- `systems/back/docs/README.md`
- `systems/back/docs/backend-overview.md`
- `systems/back/docs/market-engine.md`
- `systems/back/docs/engine-decisions.md`
- `systems/back/docs/v1-contract-brief.md`

This doc owns:
- live backend/runtime truth
- what is verified now
- what is still bridgey

This doc does not own:
- backend architecture explanation
- engine doctrine
- auth/session policy detail
- archive history

## Locked Foundation

The following backend foundation is now doc-locked:
- engine / management / verification / discovery split
- market / outcome / trade / position model
- money actors and allowed flows
- immutable global ledger
- realization history
- precision and rounding policy
- quote and trade contracts
- trade execution flow
- resolution execution flow
- schema cut
- idempotency model
- backend architecture
- DB constraints / indexes
- runtime module layout
- Fastify-owned HTTP route-family boundary
- market API read facade split
- trade execution helper module split while keeping one authoritative transaction
- auth session facade split for OTP challenge reads, request parsing, session responses, identity writes, session records, and starter-bonus ledger grant helpers
- market draft creation facade split for validation, Oracle source policy normalization, derived IDs, request hashing, idempotency, and market/outcome writes
- market publish facade split for request parsing, idempotency, account/market locks, initial pricing state, and seed ledger writes
- market-detail passive read-model facade split for identity, chart replay, volume, trust, chain, trades, and fixture presentation
- discovery feed facade split for feed query, ranking, formatting, and item presentation
- HTTP route tests split by route family; the old `app.test.ts` mega-suite is retired
- migration rollout strategy
- additive execution-leg seam for complement bundles
- contract-native position read model for real `YES` / `NO` holder and position rows
- persisted Seer `market_contract_v1` storage on markets and market-detail pass-through exposure
- persisted read-through market-history candles for reusable graph/history reads
- Google OAuth service path exists and converges into the same backend session/user identity model as email OTP
- route-family rate-limit gate exists in `src/http/rate-limit.ts` and is
  attached at the Fastify boundary
- market-integrity V1 records endpoint-abuse/risk signals into `audit_events`,
  exposes admin inbox/summary/review seams, and does not auto-lock accounts

## Runtime Shell

Runtime shell exists:
- backend package
- Fastify-owned HTTP app/server boundary
- `/health/live`
- `/health/ready`
- `/health/diagnostics`
- JSON-line logging
- Docker Compose Postgres baseline
- migrations
- seed / reset / bootstrap scripts
- backend push-gate script (`npm --prefix systems/back run push-gate`)
- market seam receipts through `smoke:market-api` and `receipt:lifecycle`
- dry-run-first stress cleanup through `stress:cleanup`

Important:
- this scaffold is host metal
- `src/http/app.ts` is now Fastify server construction, not the old raw route chain
- engine shape remains the design authority

## Live Product-Facing Surfaces

HTTP/API surfaces live now:
- discovery and search
  - `GET /api/discovery/feed`
  - `GET /api/discovery/feed/stream`
  - `GET /api/search`
- passive market-detail read
  - `GET /api/market-detail/markets/:marketKey`
- public market catalog/data
  - `GET /api/markets`
  - `GET /api/markets/live-count`
  - `GET /api/markets/:marketKey`
  - `GET /api/markets/:marketKey/prices`
  - `GET /api/markets/:marketKey/trades`
  - `GET /api/markets/:marketKey/positions`
  - `GET /api/markets/:marketKey/comments`
  - `GET /api/markets/:marketKey/history`
  - `GET /api/markets/:marketKey/price-history`
  - `GET /api/markets/:marketKey/lifecycle-events`
  - `GET /api/markets/:marketKey/stream`
- quote
  - `POST /api/markets/:marketKey/quote`
- trade
  - `POST /api/markets/:marketKey/trades`
- market comments
  - `POST /api/markets/:marketKey/comments`
  - `POST /api/markets/:marketKey/comments/:commentId/replies`
  - `POST /api/markets/:marketKey/comments/:commentId/like`
- portfolio
  - `GET /api/portfolio/snapshot`
  - `GET /api/portfolio/orders`
  - `GET /api/portfolio/history`
  - `GET /api/portfolio/performance`
  - `GET /api/portfolio/claims`
  - `POST /api/portfolio/claims/:claimId/claim`
  - `GET /api/portfolio/stream`
- social/profile
  - `GET /api/social/users/:userKey`
  - `POST /api/social/users/:userKey/follow`
  - `DELETE /api/social/users/:userKey/follow`
  - `GET /api/social/users/:userKey/positions`
  - `GET /api/social/users/:userKey/record`
  - `GET /api/social/users/:userKey/track-record`
  - `GET /api/social/leaderboard/weekly`
- auth/session
  - `GET /api/auth/google/start`
  - `GET /api/auth/google/callback`
  - `POST /api/auth/start`
  - `POST /api/auth/verify`
  - `POST /api/auth/logout`
  - `GET /api/session`
  - `POST /api/feedback`
  - `GET /api/uploads/feedback/:fileName`
  - `GET /api/me`
  - `PATCH /api/me/profile`
  - `GET /api/me/profile/handle-availability`
  - `POST /api/me/avatar`
  - `DELETE /api/me/avatar`
  - `GET /api/uploads/avatars/:fileName`
  - `GET /api/me/sessions`
  - `DELETE /api/me/sessions/:sessionId`
  - `POST /api/me/sessions/revoke-others`
  - `GET /api/me/notification-preferences`
  - `PUT /api/me/notification-preferences`
  - `GET /api/me/notifications`
  - `POST /api/me/notifications/:id/read`
  - `POST /api/me/notifications/:id/dismiss`
  - `POST /api/me/notifications/read-all`
  - `POST /api/me/notifications/unread-all`
  - `GET /api/me/social-links`
  - `PUT /api/me/social-links`
  - `DELETE /api/me/social-links/:platform`
  - `GET /api/me/data-export`
  - `GET /api/me/account-deletion`
  - `POST /api/me/account-deletion`
  - `DELETE /api/me/account-deletion`
- privacy erasure operations
  - backend runtime starts an automated account-deletion erasure worker by default
  - `npm run privacy:account-deletion-erasure`
  - `npm run privacy:account-deletion-erasure -- --pending --json` lists scheduled requests without mutation
  - CLI is dry-run by default; `--execute` completes due scheduled account-deletion requests manually
  - clears direct identity/profile/session/settings data, hides deleted-user comments, retains economy/trading/ledger integrity rows, and writes `user.account_deletion.complete`
- privacy retention cleanup
  - backend runtime starts an automated TTL cleanup worker by default
  - `npm run privacy:retention-cleanup -- --json`
  - CLI is dry-run by default; `--execute` deletes expired OTP/session/support/audit/risk leftovers and old orphan avatar files according to the documented retention policy
- API exposure guard
  - `npm run security:api-exposure`
  - checks representative public DTOs for internal key leaks, session route `401`s, production-style unauth trade blocking, and normal-user admin rejection
- admin market lifecycle
  - `POST /admin/markets`
  - `POST /admin/markets/:id/publish`
  - `POST /admin/markets/:id/close`
  - `POST /admin/markets/:id/resolve`
- admin user ops
  - `GET /admin/users/:id`
  - lock / unlock / archive
  - trade block / restore
  - revoke sessions
  - starter-grant reversal
- admin risk/integrity
  - `GET /admin/risk/signals`
  - `GET /admin/risk/signals/summary`
  - `POST /admin/risk/signals/:signalId/review`
  - risk signal inbox for route-limit crossings, OTP quota pressure,
    integrity-relevant trade/quote rejections, trade hammering patterns, and
    emergency faucet/grant rejection signals
- Oracle admin/operator seams
  - review queue
  - case detail
  - source poll
  - lifecycle worker status
  - family-route audit
  - capability check
  - intake / review action / approve candidate

CLI-first seams live now:
- Horizon
  - `npm run horizon -- close-sweep`
  - `npm run horizon -- inspect-close`
  - `npm run horizon -- close-market`
  - `npm run horizon -- alerts`
- Oracle
  - current runtime command map lives in `systems/oracle/README.md`
  - current source-family readiness lives in `workspace/docs/agents/lifecycle-readiness-map.md`
  - lifecycle run / lifecycle heartbeat / supervised lifecycle worker
  - family route audit / capability check
  - official final intake for supported adapter families
  - credible-reporting intake / evaluate
  - operator-observed event / operator resolve
  - inspect / review queue / case history / case detail
  - approve close-condition / approve resolution / reject / request-more-evidence
  - intake candidate / approve candidate
  - EOL gauntlet: `npm run oracle:eol-gauntlet`
  - retired shared-source commands (`source-plan`, `source-poll`, `heartbeat`, `cycle`, `source-sweep`) are no longer current surfaces

## Contract And Lifecycle Truth

Current contract-side trading truth:
- quote and trade accept optional `contractSide`
- default stays `yes`
- binary `no` normalizes to the opposite outcome
- multi-outcome `no` executes as a complement bundle across all non-anchor outcomes
- positions, ledger, LMSR state, and settlement stay outcome-native
- quote/trade responses expose additive `executionLegs[]`
- multi-outcome bundle execution uses:
  - `executionOutcomeKey = null`
  - `executionOutcomeId = null`
  - `executionLegs[]` as the authority
- `contract_positions` stores requested open position intent separately from outcome-native economic exposure
- market holders/positions API reads unsettled `contract_positions`, so `YES` and `NO` appear as distinct open positions only while exposure is open
- Oracle settlement now marks `contract_positions.settled_at` during resolution, while `positions` is still deleted and `realization_events` records settlement PnL
- Oracle official-final intake can create human-gated resolution cases for supported NBA official final game pages; it does not approve, resolve, or settle.
- public reads expose effective lifecycle status: an `open` DB row past `close_at` reads as `closed`, matching quote/trade `market_not_open`
- quote/trade now map sell attempts whose proceeds quantize to zero into `409 untradeable_amount`, not backend `500`

Current portfolio/history truth:
- requested contract-side wording is preserved
- execution-leg truth is additive
- complement bundles do not invent synthetic holdings
- portfolio snapshot exposes `positions[]` as requested-side display holdings when `contract_positions` exists, with outcome-native `positions` used only as legacy fallback; `contractPositions[]` stays the explicit requested contract book
- portfolio snapshot position rows now include `image` from the same discovery visual ladder, so portfolio row avatars do not invent their own market-image logic
- multi-outcome `NO` holdings read back as `contractSide='no'` on the requested outcome; matching complement execution legs are sanitized out of display holdings
- resolved markets no longer appear as open portfolio positions; settlement visibility comes from `realization_events`
- portfolio snapshot/history expose effective lifecycle status as `marketStatus`, plus `persistedMarketStatus` and `effectiveMarketStatus` for close-sweep-lag visibility
- winning resolution payouts are user-claimable: new `resolution_win` realization events start as `claim_status='pending'`, claim action credits user cash and marks them `claimed`
- portfolio performance exposes a typed `movement` block on **every** timeframe view (day/week/month/all), uniform shape `{ basis, totalNow, changeAbs, changePct, changeSign }`; the legacy top-level `dayMovement` stays for backward compatibility but is now equivalent to `views.day.movement`. Series points are no longer flattened to two — `views.<tf>.series.points` carries the multi-point mark-to-market path when market history exists, with realized-only fallback only when no mark history exists.
- portfolio performance series is now composed **mark-to-market** from per-market history (`composePortfolioMarkSeries` in `engine/portfolio/portfolio-mark-series.ts`, consumed by `buildPerformanceView`). For each timeframe range the portfolio PnL series is `realized_pnl_before_window + (mark_value(t) - cost_basis(t)) + Σ realized_pnl_in_window_through(t)`, sampled at the same cadences market-detail charts use (1D→5min, 1W→1h, 1M→4h, ALL→adaptive). All performance ranges start no earlier than the user's cash-account `created_at`; within that account-lived window every bucket emits a numeric carried value, so no-movement spans stay flat instead of creating null gaps or compressed chart time. If clipped market history begins after an injected window-start bucket, the first in-range price is used as the boundary baseline instead of emitting a fake zero mark. `mark_value(t)` and `cost_basis(t)` use full user trade/realization replay through `asOf`, not only in-window events, so holdings opened before the selected window are marked from the window start and move when market price history moves even if the user does not trade. Resolved-market tracks terminal-clip at `markets.resolved_at`, so later market-history points do not keep carrying shares after resolution; settlement/claim visibility belongs to `realization_events`. Portfolio mark reads reuse the standard market `/history` seam so they get persisted candle coverage instead of capped custom replay gaps; a live `asOf` mark point is appended from current outcome prices only for nonterminal open tracks. Final PnL points are carry-forward-filled onto a uniform portfolio grid (`day=5m`, `week=1h`, `month=4h`, `year/ytd/all=1d`) so quiet spans render as honest flat lines instead of diagonal jumps. `views.<tf>.value`, `views.<tf>.movement.changeAbs`, and legacy `dayMovement.dayChangeAbs` are derived as `last_series_value - first_series_value`, not from a separate movement query. Accounts with no exposure (or no history yet) fall back to the realized-events-only series.
- voided markets are excluded from portfolio mark-to-market history reconstruction, including historical trade/realization replay, so bad/stale market prices cannot create phantom past PnL towers after a market is triaged out of the live book.

Current passive market-detail truth:
- market identity uses `marketKey`
- old `/api/market-detail/meetings/:meetingId` path is retired
- `next-prime-minister` now reads honest DB-backed passive truth
- backend owns title / close / version / current prices / explicit outcome labels
- market-detail backend mode consumes raw market trades, positions, on-demand `/history` ranges, and stream seams where available; `/api/market-detail` does not inline chart timeframes
- `/api/markets/:market/history` is now the graph-first reusable market-history border API; it returns backend-sampled carry-forward probability vectors for all outcomes and uses read-through persisted candles for standard range reads
- market history replays from the current LMSR `q_shares` vector plus `trade_execution_legs`, so multi-outcome `NO` trades move complement legs instead of corrupting the requested outcome line
- open-market history carries the current vector forward to request time; quiet windows render as flat lines ending now, not stale last-trade timestamps
- resolved-market history appends a derived terminal `kind: "settlement"` point at `resolvedAt` (winner `1.0`, losers `0.0`) without writing settlement/redemption rows into `market_history_candles`
- first standard `/history` read can materialize `market_history_candles` from all known trades for that range; fresh open-market candles are reused briefly across market-state-version churn, while stale open-market candles rebuild
- stale open-market candles do not extend buckets to request time; the first stale response ends at the last stored candle bucket and background revalidation fills the tail on the next poll
- `/history` sampling is span-aware: when the actual returned span is younger than the nominal range, broader ranges reuse the smallest enclosing cadence instead of coarsening the same data into fewer points
- `/history` and persisted candle replay now snap bucket timestamps to clock-boundary cadence points (`:00/:05/...`, top-of-hour, etc.) while keeping the final open-market point anchored to request time, so chart/PnL hovers do not show false `XX:43` precision
- `/history` route-cache entries use the 15s open-market candle freshness window, not the generic 2s market-read cache, so graph polling does not repeatedly fall off a cold-read cliff during normal page use
- `/history` responses stamp range-aware `Cache-Control` for frontend polling/CDN-style caches: `1H=10s`, `6H=15s`, `1D=30s`, `1W=60s`, `1M=120s`, `all=300s`
- timestamp-bounded/custom `/history` reads and `/api/markets/:market/price-history` remain capped replay bridges for compatibility and QA inspection
- market-detail chart cadence is split like Polymarket: dense backend points for hover/data, sparse visible axis labels for readability
- price-history now accepts timestamp-bounded history reads and Polymarket-style range aliases, with frontend timestamp labels instead of raw replay event names
- market-detail chart labels are compact on-axis, full in tooltip/range stat, and verified in-browser on the kept stress seam market
- market stream now carries `market.lifecycle` events for publish/close/resolve and Oracle-approved resolution paths
- market stream now carries live community comment events from the same per-market SSE: `comment.new`, `comment.reply`, and `comment.like`. Comment creation/reply events carry the public comment record; likes carry `commentId` plus the updated count. Edit/delete event names are reserved until those write routes exist.
- market stream events carry SSE ids where available; reconnect current-state replay is still anchored by the fresh initial snapshot
- portfolio stream now exists at `GET /api/portfolio/stream`: real-session-only SSE with `portfolio.ready`, heartbeat, and `portfolio.snapshot_invalidated` events after own trades/claims plus generic settlement/void invalidations; the Astro shell owns this stream globally and dispatches `navi:portfolio-snapshot-updated`
- discovery feed stream now exists at `GET /api/discovery/feed/stream`: one feed-level SSE emitting `discovery.feed_snapshot`; feed pages should consume this instead of opening per-card market streams
- market-detail consumes `GET /api/markets/:marketKey/stream` as a public live-fetch doorbell and dispatches `hz:market-live-fetch`; chart/history, ticket prices/holdings, viewer positions, community boards/activity, and comment merges reuse the same stream
- lifecycle mutations now also write durable append-only `lifecycle_events` rows for publish, close, source-not-final, resolution-case-created, resolution-approved, resolved, and settlement-completed milestones; this is a ledger/outbox spine, not a replacement for the live SSE refresh seam
- `GET /api/markets/:market/lifecycle-events` exposes a sanitized ordered timeline from `lifecycle_events` for one market, including lifecycle capsule, source system, safe actor label, references, and public payload fields
- market-detail exposes stored Seer `market_contract_v1` at `snapshot.contract` when available, including `delayPolicy`; it omits the field for old markets rather than guessing from flat `resolution_rules`
- market-detail exposes recent lifecycle ledger rows at `snapshot.eventUpdates`; official-source lag uses `eventType=official_source_not_ready` and `tier=system_status`
- market-detail exposes simple result truth at `snapshot.result`, with direct `snapshot.settlementStatus`, `snapshot.resolvedAt`, and `snapshot.winner` fields for Front/operator consumption
- market-detail exposes `snapshot.lifecycle` with ISO lifecycle dates, expected resolution date, persisted/effective status, settlement status, and payout policy; fallback payout policy says payout follows official resolution/settlement, never close time
- market-detail exposes `snapshot.tradingMode` so Front does not guess trading controls from live-backend status; current two-or-more-outcome markets use `contract_side`, with requested YES/NO on rows and buy/sell in the ticket/sidebar
- sports market-detail `snapshot.outcomes[]` rows now expose optional `colorPrimary` / `colorOn` identity colors resolved from the same visual registry team brands as discovery matchup cards; unmatched labels omit the fields
- resolved market-detail outcomes expose explicit `finalValue` (`1` winner, `0` loser), and the resolved rail consumes it before falling back to older winner-id inference for local fixtures
- public market catalog/detail, positions, and discovery feed expose compact `result`, `lifecycle`, and `trust` fields so browse/detail/operator consumers do not invent source/rule/result/lifecycle truth
- public exact-market and discovery `trust.contract` now include broader `market_contract_v1` fields such as `measurementKind`, `resultShape`, `sourceRolePlan`, `payoutPolicy`, `referenceQuarantine`, `oracleCapability`, and `outcomeMap`
- public exact-market outcome rows expose `isWinner` and resolved `finalValue` so Front/operators do not need to infer winner/payout state from separate ids
- discovery feed previews now include up to 4 top outcomes; browse graph consumers use `/api/markets/:market/history` instead of an embedded discovery preview series
- discovery event-group cards expose `href` plus `event` metadata (`eventKey`, `parentKey`, representative child, child keys); Front should use `href` for card navigation so grouped cards land on the parent event surface instead of a child binary
- discovery feed cards expose backend-owned `shape` (`binary`, `matchup`, `multi`, `live`) plus `outcomes[].role` / `preview.topOutcomes[].role` so Front does not infer layout from category or labels
- discovery feed cards expose earned `signals[]` only; empty array means no badge, at most one signal is emitted per card, and current priority is `live` > `moved` > `hot` > `closing` > `new`; `moved` is computed probability movement from the backend `movement` block, while `breaking` is reserved for verified breaking-news/topic or explicit editorial/operator placement, not generic activity
- `GET /api/discovery/feed?feed=breaking` now filters to true 24h movers and exposes `movement` with moved `outcomeKey`, from/to probabilities, signed/absolute percentage-point delta, trade count, and movement-window volume; zero qualifying movers returns an honest empty item list
- discovery feed cards expose authenticated `viewerPosition` for the current user's largest open market exposure; unauthenticated reads return `null`
- market-detail community comments are backend-backed for v1: public list, session-only post/reply/like, one-level replies, event-level thread support through `eventId`, public profile-safe author fields, and live per-market SSE fanout for create/reply/like
- frontend still keeps some page-shaped display behavior local
- raw market reads share a short version-aware bounded in-memory cache / single-flight layer
- `/health/diagnostics` exposes process memory, market API cache stats, passive market-detail cache stats, and SSE stream counts for soak/RSS triage
- backend-style market ids (`disc-cm-*`, `stress-*`, `market_*`) do not fall back to prototype market-detail fixtures when DB truth is missing
- public market read, portfolio read, auth/session, admin user, and admin Oracle routes are now extracted out of the main HTTP app shell
- HTTP tests now have focused files for health, public market reads, discovery, portfolio, auth/session, CORS preflight, admin/Oracle, admin user ops, and passive market-detail route coverage

## Verified Now

### Core Runtime

Verified:
- backend install completed
- backend typecheck passed
- health/runtime shell is up
- local DB bootstrap passed:
  - `db:reset`
  - `db:migrate`
  - `db:seed`

### Quote / Trade / Portfolio

Verified:
- live quote path exists in code
- live trade path exists in code
- live portfolio read surfaces exist in code
- live portfolio claim read/mutation surfaces exist in code
- quote/trade smoke passed against local Postgres:
  - buy quote `200`
  - sell quote `200`
  - buy trade `200`
  - sell trade `200`
- idempotency behavior is proven:
  - same key + same payload replays prior result
  - same key + different payload returns `409 idempotency_conflict`
- browser preflight support exists for quote/trade `OPTIONS`

### Auth / Control Plane

Verified:
- auth/session foundation exists in code
- Google OAuth start/callback routes exist in code; they require configured Google client credentials for live use
- Google OAuth links verified Google identity by provider `sub`, can attach to an existing email identity, and creates the same normal session cookie
- protected routes resolve actor from session first, demo second
- invalid session cookie does not silently fall back to demo mode
- stale/expired cookies are cleared explicitly
- valid session use updates `last_seen_at`
- `GET /api/me` is real session-only truth and exposes own-profile fields additively
- `GET /api/me` also exposes owner `social.followerCount` and `social.followingCount`
- public social profile V1 exists: real chosen profile identity, unique public root `handle`, public social links, follow counts, profile-view count, follow/unfollow writes, and public-safe proof positions/record endpoints
- public handle availability pre-check exists as a session-only settings helper; it shares the same validation as `PATCH /api/me/profile` and returns only `{ handle, available, reason }`
- user-curated `showcaseCategories` is live on `PATCH /api/me/profile`, `GET /api/me`, and `GET /api/social/users/:userKey`; writes keep only categories where the user has resolved record history
- public track-record category breakdown rows expose backend-owned Hebrew `categoryLabel` next to canonical `categoryKey`
- public track-record highlights expose `longestWinStreak` and `biggestWin` from resolved realization events
- global search returns minimal public profile results for active/non-erased users, searches public `handle`/display name only, links them to `/<handle>`, and keeps email/bio/private identity out of shell search payloads
- market comments expose public `authorId` so comment authors can link to profiles without leaking private identity
- profile badge showcase is skeleton-only for now (`showcaseBadges: []`) with source reference to `systems/design/to-integrate/achievements`; numeric level/monthly rank still need Omri product definition
- signup is open; invite-only access was retired
- local dev OTP is explicitly dev/operator-only (`AUTH_DEV_OTP_CODE`, default `111111`), and production must suppress exposed dev OTP
- Settings seams exist for profile update, avatar upload/clear/readback, session list/single revoke/revoke-others, notification preference storage, and shell notification feed/read state
- Shell notification feed exists for real sessions. First producer is market-resolution win/loss notifications from `realization_events`, gated by `notification_preferences.resolve.channel_app`; read/open events are retained in `user_notification_events`; per-row dismiss is a soft-delete (`dismissed_at`) hidden from feed/unread reads; result-overlay fields, mark-all unread, and market art thumbnails are backend-backed.
- Saved markets exist as session-only market subscriptions through `GET/POST/DELETE /api/markets/:marketKey/save`. Saved state is a viewer overlay and is not embedded in the cached public market-detail read model.
- Avatar upload is the first outside-file ingress seam: backend caps decoded input at 4MB, validates image signatures, quarantines raw bytes, runs configured `AVATAR_MALWARE_SCANNER` fail-closed, re-encodes with `sharp` to sanitized WebP, stores only sanitized output, and serves with `X-Content-Type-Options: nosniff`
- first lifecycle/control fields exist on `users`
- admin user ops routes exist and write audit events
- `smoke:auth-session` exists
- `smoke:auth-session` accepts open-market overrides and passed on `stress-contract-position-root-2`
- seeded admin/dev smoke path exists and passed on `stress-contract-position-root-2`

### Horizon / Oracle

Verified:
- Horizon legality foundation exists in code
- first CLI-first Horizon runtime exists
- draft markets may store `oracle_source_policy`
- Oracle inspect runtime persists case/evidence/output memory
- Oracle review queue / case-detail seams exist; retired source-plan/source-poll shared-source bridge is no longer a current surface
- Oracle review-action seam can hand approved close-condition cases into Horizon close
- Oracle review-action seam can hand approved resolution into trusted resolve
- Oracle alerts seam exists; retired shared-source heartbeat/cycle commands are no longer current surfaces
- `oracle:lifecycle-worker` is the preferred production lifecycle loop and emits JSONL heartbeat receipts while delegating scheduled closes to Horizon
- `horizon:close-worker` remains a bounded one-shot close sweep, not the continuous daemon
- thin admin Oracle read surfaces exist for lifecycle worker status, family-route audit, and capability check

## Still Bridgey Or Incomplete

Not fully verified or not fully settled yet:
- Google OAuth is code-backed but provider credentials/live callback proof are still environment-dependent
- email OTP is still challenge/session plumbing; real mail/SMS delivery provider remains outside this backend spine unless wired by deployment/env work
- production process-manager/cron ownership for `oracle:lifecycle-worker`
- lifecycle worker exists locally; production still needs a boring off-machine/supervised run story
- no Oracle-native source fetch worker
- no dedicated Oracle review console beyond thin admin tab + CLI/gateway/admin JSON seams
- shared-source candidate evidence still requires explicit Oracle review
- DB-backed EOL proof exists for a dummy 5-minute scheduled close, dummy 10-minute early close, and Oracle-approved resolution
- passive route still leans on bridge fixtures for:
  - timeline
  - related markets
  - volume labels
  - some page-shaped chart history outside raw market-data consumers
- Bank of Israel bridge markets still use extra fixture shaping
- legacy BOI aliases may still use prototype fixture fallback until those pages are retired or fully DB-backed
- frontend auth overlay is still UX-only; full credentialed page wiring is still pending
- demo actor mode still exists as an explicit bridge fallback
- trade path still needs broader automated coverage beyond current unit tests + live smoke
- served-page browser assertion is not yet folded into the smoke runner

## Current Pressure

Backend pressure now is mostly:
- proof and cleanup, not “can we boot a backend at all?”
- control-plane follow-through
- trust / Oracle follow-through
- broader verification coverage
- production runtime supervision, backup, and restore policy
- removal of remaining passive bridge baggage where it matters

## Not In This Doc

This doc should not become:
- the backend architecture explainer
- the full contract reference
- the engine theory doc
- the historical memo pile

Use:
- `systems/back/docs/README.md`
  - backend docs front door
- `systems/back/docs/backend-overview.md`
  - backend shape and orientation
- `systems/back/docs/v1-contract-brief.md`
  - app-facing contract truth
- `systems/back/docs/market-engine.md`
  - engine logic and backend model
- `systems/back/docs/engine-decisions.md`
  - durable backend decisions
- `systems/back/docs/control-plane/README.md`
  - auth/session/user-account cluster
- `systems/back/docs/history/`
  - crossed backend milestones and transitional memos
