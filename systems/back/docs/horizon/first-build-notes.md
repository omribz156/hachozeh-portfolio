# Horizon First Build Notes v1

Updated: 2026-05-27
Status: current
Owner: backend / lifecycle lane

Version:
- v1

Purpose:
- turn the Horizon doctrine into a practical first build slice
- help the next builder session stay narrow and deterministic

Placement:
- this first-build note belongs to backend lifecycle work, not to the agent layer

Read with:
- `systems/back/docs/horizon/README.md`
- `systems/back/docs/horizon/overview.md`
- `systems/back/docs/horizon/schemas-v1.md`

This doc owns:
- first implementation slice
- command shape recommendation
- build-now vs later line

This doc does not own:
- Horizon mission
- authority theory
- canonical schema truth

## Build Stance

First pass should be:
- deterministic
- backend-first
- CLI/script friendly
- scheduler friendly
- review-light for the normal path

## Good First Scope

Build a narrow loop that can:
- read markets with `status = open`
- identify which ones are due by `closeAt`
- validate close eligibility
- execute one explicit close command
- write one audit event
- return one stable execution result
- emit one alert item when scheduled close should have happened but did not

## Recommended First Slice

Start with:
- scheduled close only
- one Oracle-confirmed early-close contract shape documented but not yet automated
- one alert shape for abnormal cases

Keep Oracle-confirmed early-close documented, but not fully automated in the first pass.

Why:
- this proves the lifecycle skeleton
- avoids policy sprawl too early

## Good First Commands

Examples of a narrow CLI/dev shape:
- `horizon close-sweep`
- `npm --prefix systems/back run horizon:close-worker`
- `horizon inspect-close --market <id>`
- `horizon close-market --market <id> --trigger scheduled_time`
- `horizon alerts`

Later these can rename or move behind HTTP/job orchestration.

The main point is:
- one path to discover due closes
- one path to inspect legality
- one path to execute a close explicitly
- one path to inspect failures/alerts
- one bounded worker entry for scheduled-time production ticks

## Suggested First Execution Flow

1. query open markets whose `closeAt <= now`
2. build `close_candidate` objects
3. validate each candidate into `close_check_result`
4. for eligible candidates:
   - create/load idempotency row
   - use a stable scheduled close key: `close:<marketId>:scheduled:<scheduledCloseAt>`
   - lock market row
   - confirm status still `open`
   - set `status = closed`
   - set `closedAt`
   - write audit event
   - store execution result snapshot
5. for ineligible or failed candidates:
   - emit `lifecycle_alert_item`

## What To Keep Simple

Keep simple in the first pass:
- trigger set
- approval logic
- alert routing
- retry behavior
- scheduler cadence
- observability depth

## What Not To Build Yet

Do not build yet:
- full policy engine
- pause/halt semantics beyond `closed`
- AI-based lifecycle decisions
- automatic Oracle-driven early-close execution
- broad admin UI
- distributed job orchestration
- complex replay machinery

## First Success Condition

The first pass is successful if:
- due open markets close once and only once
- duplicate close attempts are boring
- closed markets refuse further trading
- open positions remain intact
- each close has audit context
- the next builder can extend from this without semantic guessing

That is enough to prove the Horizon spine is real.
