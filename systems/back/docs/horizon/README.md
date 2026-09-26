# Horizon

Updated: 2026-05-27
Status: current
Owner: backend / lifecycle lane

Purpose:
- front door for deterministic lifecycle-close docs
- keep Horizon easy to enter without pretending it is an agent lane
- separate mission, authority, build scope, and schema truth

## Read Order

Read in this order:

1. `systems/back/docs/README.md`
   - backend docs front door
2. `workspace/docs/agents/autonomous-operations-model.md`
   - platform-level doctrine
3. `systems/back/docs/horizon/overview.md`
   - mission, lifecycle meaning, trigger model, invariants
4. `systems/back/docs/horizon/authority-boundary.md`
   - who may propose, approve, execute, or only alert
5. `systems/back/docs/market-engine.md`
   - existing engine truth for lifecycle commands
6. `systems/back/docs/engine-decisions.md`
   - locked backend decisions Horizon must respect
7. `SECURITY.md`
   - trust-sensitive write-path posture
8. `systems/back/docs/horizon/first-build-notes.md`
   - narrow first implementation slice
9. `systems/back/docs/horizon/schemas-v1.md`
   - concrete Horizon object shapes

## What Each Doc Owns

- `overview.md`
  - mission
  - close meaning
  - trigger types
  - lifecycle invariants
  - Horizon boundaries
- `authority-boundary.md`
  - systems/seer/management/Oracle/engine split
  - approval rules
  - who can propose vs execute
  - abnormal-case escalation logic
- `first-build-notes.md`
  - practical first pass
  - narrow deterministic scope
  - what to build now vs later
- `schemas-v1.md`
  - close policy
  - close candidate
  - close command
  - close execution result
  - lifecycle alert item

## Use By Intent

- if you need Horizon mission / system picture:
  - `overview.md`
- if you need who may propose or execute:
  - `authority-boundary.md`
- if you need narrow implementation scope:
  - `first-build-notes.md`
- if you need lifecycle object shapes:
  - `schemas-v1.md`

## Current Runtime

- `npm --prefix systems/back run horizon:scheduler`
  - long-running scheduled-close reconciler
  - grabs a Postgres advisory lock by default, so only one scheduler mutates in prod
  - on each tick, runs the same idempotent `runHorizonCloseSweep` path
  - uses Postgres `now()` for due-work checks and sleep timing
  - after sweeping, reads overdue open-market count plus the next open market `close_at`
  - sleeps until that close time, capped by `HORIZON_SCHEDULER_MAX_SLEEP_MS`
  - default max sleep is `30000` ms; this keeps restart/drift recovery boring
  - persists `horizon-scheduler` runtime snapshots by default for diagnostics and doctor checks
  - this is the preferred production owner for scheduled `open -> closed`
- `npm --prefix systems/back run horizon:scheduler:once`
  - runs one scheduler tick and prints a formatted JSON receipt
  - use `-- --dry-run true --persist-snapshot false` for non-mutating smoke checks
- `npm --prefix systems/back run horizon:close-worker`
  - runs a bounded scheduled-time close sweep
  - default batch limit is `50`
  - uses stable idempotency keys based on `marketId + scheduledCloseAt`
  - one-shot command, not a continuous daemon
- `npm --prefix systems/back run horizon -- close-sweep --dry-run true --limit 50 --json`
  - inspects due markets without closing them
- `npm --silent --prefix systems/back run oracle:lifecycle-worker`
  - preferred production lifecycle loop, and still useful as an Oracle evidence/case/reminder worker
  - calls Oracle `lifecycle-heartbeat`, which invokes Horizon close sweeps and then Oracle evidence intake
  - streams JSONL receipts while running
  - `--silent` keeps npm banners out of JSONL logs

Important:
- this worker only owns scheduled `close_at <= now()` closes
- Oracle-confirmed early close still enters through human-approved Oracle review action
- Horizon remains the mutation authority for both paths
- for production, run `horizon:scheduler` as the primary scheduled-close reconciler and keep Oracle lifecycle worker on the slower evidence/case cadence
- the Oracle worker may still call Horizon close sweep as idempotent safety/ordering inside `lifecycle-run`, but scheduled close must not depend on source-adapter health
- `/internal/diagnostics` exposes `runtime.latestHorizonScheduler`; production doctor treats missing/stale/bad snapshots, overdue-open count, alerts, and DB/app clock skew as watch signals

## Current Goal

These docs should let a builder:
- orient fast
- choose one narrow lifecycle slice
- implement without reopening the whole philosophy loop
