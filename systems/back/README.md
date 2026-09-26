# Backend

Updated:
- 2026-06-12

Status: current
Owner: backend lane

Purpose:
- identify the backend runtime package
- give command entry without replacing backend docs
- make ownership boundaries clear before code changes
- point new sessions to current backend truth

This is the backend runtime for Hachozeh.

Internal/dev namespace:
- this package and some technical identifiers still use the legacy `Navi` name during the transition
- do not rename backend identifiers casually; read `../../workspace/docs/brand-rename-hachozeh.md` first

Current stance:
- one modular Node.js + TypeScript backend service
- PostgreSQL source of truth
- Fastify-owned HTTP boundary
- SQL-first persistence
- explicit transactions for trusted money / trade paths
- immediate-execution market engine, not an order book

Owns:
- HTTP API under `/api/`
- market engine and LMSR pricing
- quote and trade execution
- accounts, ledger, and position state
- portfolio read surfaces
- auth/session control plane
- admin market lifecycle
- Horizon close/lifecycle CLI seams
- backend side of Oracle and Seer materialization seams
- migrations, seed/reset/bootstrap scripts
- backend smoke, stress, and unit/integration tests

Does not own:
- frontend product rendering
- product Discovery page design
- Seer agent runtime identity
- Oracle runtime identity
- autonomous publish authority
- direct browser QA
- private local machine ops truth

Read with:
- `docs/README.md`
- `docs/current-status.md`
- `docs/backend-overview.md`
- `docs/v1-contract-brief.md`
- `docs/market-engine.md`
- `docs/engine-decisions.md`
- `docs/route-family-map.md`
- `../../workspace/tasks/reference/current-backend-api-map.md`
- `../../ARCHITECTURE.md`
- `../../SECURITY.md`

Use this doc for:
- backend package identity
- first commands
- quick ownership check
- read path into deeper backend docs

Do not use this doc as:
- full backend architecture
- exact route contract map
- historical milestone memo
- replacement for `docs/current-status.md`

## Current Package Shape

- `src/`
  - runtime, HTTP routes, domain services, DB helpers, engine, lifecycle, auth, discovery, scripts
- `test/`
  - backend Vitest coverage
- `migrations/`
  - ordered PostgreSQL migrations
- `docs/`
  - backend doctrine, status, contracts, and history
- `.env.example`
  - sanitized local env baseline
- `package.json`
  - package scripts and backend dependencies

Important:
- keep HTTP route callbacks thin
- put trusted behavior in focused services
- keep DB mutations explicit and transaction-aware
- do not hide durable backend choices in chat

## Quick Commands

Run from the repo root.

Start backend:

```bash
npm --prefix systems/back run dev
```

Core checks:

```bash
npm --prefix systems/back run typecheck
npm --prefix systems/back test
npm --prefix systems/back run push-gate
npm --prefix systems/back run smoke:health
npm --prefix systems/back run smoke:market-api
npm --prefix systems/back run smoke:auth-session
npm --prefix systems/back run doctor:platform
npm --prefix systems/back run doctor:platform:report
```

Database:

```bash
npm --prefix systems/back run db:migrate
npm --prefix systems/back run db:seed
npm --prefix systems/back run db:reset
npm --prefix systems/back run db:bootstrap
```

Stress / operator seams:

```bash
npm --prefix systems/back run stress:market
npm --prefix systems/back run stress:cleanup
npm --prefix systems/back run soak:market
npm --prefix systems/back run watchdog:platform
npm --prefix systems/back run watchdog:platform:gauntlet
npm --prefix systems/back run receipt:lifecycle -- --market <market-id-or-key>
npm --prefix systems/back run horizon -- --help
npm --prefix systems/back run horizon:close-worker
npm --prefix systems/back run oracle -- --help
npm --prefix systems/back run oracle:lifecycle-worker:status
npm --prefix systems/back run oracle:eol-smoke
npm --prefix systems/back run oracle:eol-gauntlet
npm --prefix systems/back run seer-create -- --help
```

## Main Scripts

- `dev`
  - watched local HTTP server
- `build`
  - TypeScript build
- `start`
  - run compiled backend
- `typecheck`
  - backend TypeScript check
- `test`
  - backend Vitest suite
- `push-gate`
  - backend clean-push gate: backend typecheck, Seer typecheck, and full backend suite
- `smoke:health`
  - live/readiness smoke
- `smoke:market-api`
  - public market API smoke, including prices, trades, positions, history, market-detail, event updates, and stream
- `receipt:lifecycle`
  - compact market lifecycle receipt for `lifecycle_events`, settlement/result fields, and market-detail event updates
- `smoke:auth-session`
  - auth/session smoke; accepts `AUTH_SMOKE_MARKET_KEY` and `AUTH_SMOKE_OUTCOME_KEY`
- `smoke:admin-user-ops`
  - admin user-control smoke; accepts `ADMIN_SMOKE_MARKET_KEY` and `ADMIN_SMOKE_OUTCOME_KEY`
- `doctor:platform`
  - one-command local platform verdict over backend live/ready/diagnostics and frontend static route
- `doctor:platform:json`
  - full JSON doctor output
- `doctor:platform:report`
  - compact doctor run plus local JSONL report receipt under `workspace/runtime/doctor/`
- `stress:market`
  - concurrent market-engine stress runner
- `stress:cleanup`
  - dry-run-first stress market cleanup; closes temporary stress markets only with `--execute`
- `soak:market`
  - long-running market movement/diagnostics runner for graph and RSS gauntlets
- `watchdog:platform`
  - one-shot dry-run health watcher for backend/front local platform lanes; writes JSONL receipts
- `watchdog:platform:loop`
  - continuous dry-run platform watchdog
- `watchdog:platform:execute`
  - continuous platform watchdog that restarts only configured tmux lanes after repeated failed checks
- `watchdog:platform:gauntlet`
  - bounded two-hour dry-run watchdog companion for long local soaks
- `gauntlet:repair-platform`
  - repair helper for platform state after gauntlet pressure
- `horizon`
  - deterministic close/lifecycle CLI
- `horizon:close-worker`
  - bounded one-shot close sweep worker command
- `oracle`
  - Oracle operator CLI through backend toolchain
- `oracle:lifecycle-worker:*`
  - lifecycle worker dry-run/start/stop/restart/status/tail/once wrappers
- `oracle:eol-smoke`
  - short EOL lifecycle smoke
- `oracle:eol-gauntlet`
  - longer EOL lifecycle gauntlet
- `seer-create`
  - materialize/publish Seer-generated creation drafts
- `seer`
  - Seer runtime entry through backend toolchain

## Live API Spine

Current product-facing families:
- health
- session/auth
- current user
- discovery feed
- search
- live-event count
- market catalog
- raw market data
- lifecycle event timeline
- page-shaped market detail
- quote/trade
- portfolio
- admin market lifecycle
- admin user ops
- Oracle operator/admin seams

For exact route parameters and examples:
- `../../workspace/tasks/reference/current-backend-api-map.md`

For app-facing contract shape:
- `docs/v1-contract-brief.md`

## Engine Notes

Current trusted model:
- markets have first-class outcomes
- trades execute immediately
- quote is advisory only
- trade recomputes authoritative execution inside the transaction
- ledger records money movement
- realization events record position closeout
- `positions` is outcome-native economic exposure
- `contract_positions` is user-intent open position truth for distinct `YES` / `NO`
- `trade_execution_legs` records normalized execution legs for complement bundles

Current `NO` semantics:
- binary `NO` normalizes to the opposite outcome
- multi-outcome `NO` executes as a complement bundle across non-anchor outcomes
- API activity preserves requested `contractSide`
- public market holders/positions read contract-native rows, not inferred complement exposure

## Local Runtime Notes

Common local ports:
- backend HTTP: `3001`
- local Postgres default in this repo: `55432`
- frontend dev/static surface often uses `4173`

Do not assume:
- every machine uses the same private ops setup
- backend must be restarted for docs-only work
- browser QA is required for backend-only changes

When runtime truth matters, prefer cheap probes first:

```bash
curl -sS http://127.0.0.1:3001/health/ready
npm --prefix systems/back run smoke:market-api
```

## Work Rules

- Read `docs/current-status.md` before changing backend contracts.
- Read `docs/v1-contract-brief.md` before changing frontend/backend seams.
- Read `docs/market-engine.md` before changing trade, pricing, position, ledger, or settlement logic.
- Read `docs/engine-decisions.md` before moving architecture boundaries.
- Update docs in the same slice when behavior changes.
- Keep admin/operator routes boring.
- Keep product Discovery and Seer runtime boundaries separate.
- Keep Oracle evidence/review separate from trusted market mutation authority.

Release hygiene:
- use `../../workspace/docs/release-hygiene.md`
- run the smallest checks that prove the touched surface
- commit only the owned slice in mixed worktrees
