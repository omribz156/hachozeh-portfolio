# Backend Engine Future Topics

Updated: 2026-05-27
Status: reference
Owner: backend lane

Purpose:
- park rising ideas without polluting V1 rules
- keep future-us from re-litigating the same threads
- separate "later maybe" from "build now"

Read with:
- `systems/back/docs/README.md`
- `systems/back/docs/market-engine.md`
- `systems/back/docs/engine-decisions.md`
- `workspace/tasks/reference/history/backend-market-engine-foundation.md`

This doc owns:
- parked later topics
- pressure notes for future phases

This doc does not own:
- build-now truth
- runtime status
- locked engine rules

## Near-Next Topics

These are close enough to V1 that they will likely be discussed soon:
- separate docs for:
  - backend overview
  - core engine
  - market management
  - Oracle layer
  - discovery / research layer
- first persistence/cache strategy for hot portfolio reads
- exact database locking/index strategy once schema work starts

## Accounting / Economy Upgrades

Likely later, but worth parking now:
- fee precision policy
- tick-size policy if Hachozeh adds price-bearing orders later
- minimum trade notional / dust controls
- `positionCycleId` for reopen / close / reopen grouping
- richer correction event model beyond base compensating ledger tx
- explicit settlement batching model and batch observability
- more formal supply analytics around mint / treasury / sink
- economy policy versioning
- promo expiry / promo retirement semantics

## Integrity / Audit Upgrades

Potential future hardening:
- periodic hash-chain verification job
- checkpoint signing
- internal signatures on ledger batches
- anomaly detection for suspicious trade / grant / correction patterns
- review-case linkage for sensitive admin actions

## Market Logic Upgrades

Possible later-engine topics:
- linked / related markets with explicit relation modeling
- shared-event grouping without shared pricing state
- richer resolution workflow and evidence packages
- market pause / halt semantics beyond open / closed / resolved
- async settlement orchestration for large markets
- slippage guards / strict version-match execution paths
- special-delay trade modes for edge markets if Hachozeh ever needs them

## Portfolio / Analytics Upgrades

Likely future reads:
- realized history page and W/L summaries
- equity curve snapshots
- day/week/month PnL windows
- category / sector exposure
- user performance leaderboards
- archived position-cycle views

## API / Infra Upgrades

Later once V1 core contracts settle:
- API versioning policy
- public API hardening
- webhook / event stream patterns
- background job boundaries
- replay / rebuild tooling for derived caches
- outbox / distributed idempotency design if write flows ever split across services

## V2 Schema Candidates

Real later tables once V1 engine truth is proven:
- `position_cycles`
- `settlement_batches`
- `portfolio_snapshot_cache`
- `market_summary_cache`
- `verification_cases`
- `review_cases`
- linked-market relation tables
- fee / reward program tables

## Rule

If a topic:
- is not needed for V1 trading correctness
- is not needed for V1 balance correctness
- is not needed for V1 trust/audit integrity

then park it here first, not inside the core engine rules.
