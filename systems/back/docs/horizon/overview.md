# Horizon v1

Updated: 2026-05-27
Status: current
Owner: backend / lifecycle lane

Version:
- v1

Purpose:
- define Hachozeh's deterministic Horizon layer
- turn vague "close the market somehow" into explicit operating doctrine
- make the future builder session start from contracts, not vibes

Placement:
- this doc lives under `systems/back/docs/` because Horizon is part of engine lifecycle truth
- it is not a peer agentic subsystem like discovery or Oracle

Read with:
- `systems/back/docs/horizon/README.md`
- `systems/back/docs/market-engine.md`
- `systems/back/docs/engine-decisions.md`
- `SECURITY.md`

This doc owns:
- Horizon mission
- close meaning
- trigger model
- lifecycle invariants
- close semantics

This doc does not own:
- authority/approval detail
- first-build task slicing
- canonical object schemas

## Mission

Move eligible markets from `open` to `closed` using explicit rules, explicit triggers, and explicit audit context.

Short version:
- know when a market should stop trading
- close it safely
- leave a clean trail

## Core Job

Horizon should answer:
- is this market legally closable now?
- why is it being closed?
- who or what triggered it?
- should it close now, wait, or alert?

It should not answer:
- who won?
- whether the event already resolved in the real world
- whether the market wording was good

## Trigger Outside, Truth Inside

The close trigger may come from outside the engine core.

Examples:
- scheduled time reached
- Oracle proposes early close

But the lifecycle truth still stays inside the engine.

Meaning:
- outside layers may notice or propose
- engine validates legality
- engine executes the actual `open -> closed` transition

So:
- the engine owns close authority
- the engine does not need to invent the reason to close by itself

## Why Horizon Exists

Closing is not the same thing as:
- discovery
- market drafting
- publish approval
- resolution

Closing is mostly:
- scheduled
- rule-based
- deterministic
- trust-sensitive

That means it should be built as boring backend logic first.

Not:
- "AI decides when this feels done"

## Scope

Horizon owns the live-market close transition.

Main concern:
- `open -> closed`

Context note:
- `draft` creation and publish readiness stay upstream in market management
- `resolved` stays downstream in Oracle + engine settlement

Practical line:
- once a market is live, Horizon is the first lifecycle authority that can stop trading

## Inputs

Horizon may use:
- market status
- `openAt`
- `closeAt`
- explicit close-policy fields
- current time
- trigger type
- explicit review/approval context when policy requires it
- Oracle-provided early-close proposal context
- idempotency key

Important:
- close must not depend on fuzzy model judgment
- if a trigger is ambiguous, the service should alert or reject, not improvise

## Outputs

Horizon should produce:
- close command execution
- close execution result
- audit event
- idempotency result
- abnormal-case alert when the market should not auto-close cleanly

## Strong Doctrine

- close is deterministic
- close is server-authoritative
- close is explicit
- close is audited
- close does not settle money
- close does not choose a winner
- closed means no more trading, not resolved truth

## Lifecycle Boundary

User-facing lifecycle stays simple:
- `open`
- `closed`
- `resolved`

Internal note:
- `draft` exists before publish, but is out of scope for Horizon

Rule:
- do not add extra Horizon lifecycle states unless a real product need appears

## What Close Means

When a market becomes `closed`:
- trading stops
- quote/trade endpoints should refuse new trading execution
- open positions remain active
- no payout happens yet
- no winner is chosen yet
- the market waits for later resolution

Important:
- closed-but-unresolved exposure still belongs in active positions

## Trigger Types

Horizon should understand a small trigger set.

Recommended v1 trigger types:
- `scheduled_time`
- `oracle_confirmed_event_completion`

Meaning:

### `scheduled_time`

Normal path.

Use when:
- `market.closeAt <= now`
- no exceptional override is needed

### `oracle_confirmed_event_completion`

Exceptional but structured path.

Use when:
- Oracle has confirmed that the market hit its close condition before the scheduled close
- trigger context is explicit
- required evidence or review conditions are satisfied

Important:
- Oracle may propose this trigger
- Horizon still validates legality and executes the close explicitly

## Close Policy

Every live market should have a close policy that is understandable before trading starts.

At minimum v1 needs:
- a scheduled close time
- whether event completion may close the market before `closeAt`
- whether event-completion close requires human approval

Good rule:
- normal closing should be easy
- exceptional closing should be explicit

## Source Of Truth Rule

There must be one lifecycle truth for each market.

In v1:
- canonical persisted lifecycle truth lives on the market aggregate
- that includes lifecycle fields such as `status`, `closeAt`, `closedAt`
- if event-completion close behavior needs explicit policy fields, those fields should still live on the same market aggregate or the same market-owned write model

Important:
- `close_policy` in these docs is a lifecycle contract shape
- it is not permission to create a second independent persistence authority
- scheduler state, review notes, or alert items must not become competing lifecycle truth

Practical builder rule:
- one market, one lifecycle authority
- no split-brain between `markets.close_at` and some separate close-policy table unless a later version explicitly redesigns that boundary

## V1 Market Fields

For v1, Horizon should rely on market aggregate fields that are explicit and small.

Required market fields:
- `status`
- `openAt`
- `closeAt`
- `closeOnEventCompletion`
- `eventCompletionCloseRequiresHumanApproval`

Recommended recorded timestamps:
- `closedAt`
- `resolvedAt`

Why this shape:
- enough to support normal scheduled close
- enough to gate event-completion close legally
- no second persistence authority
- no policy labyrinth too early

Keep out of the market row in v1:
- last trigger history
- approval history
- evidence snapshots
- alert history

Those belong in:
- command payloads
- audit events
- alert/read models

## Eligibility Model

A market is normally close-eligible when:
- market exists
- market status is `open`
- `closeAt <= now`

A market may be exception-close-eligible when:
- market status is `open`
- trigger type is one of the approved exceptional types
- required context is present
- required Oracle evidence or required approval is present when policy says so

A market is not close-eligible when:
- market is `draft`
- market is already `closed`
- market is already `resolved`
- trigger context is missing or illegal
- actor is unauthorized

## Relationship To Other Layers

### Discovery

Discovery may suggest:
- useful market timing
- suggested close shape

Discovery must not:
- close live markets
- override live lifecycle

### Market Management

Management owns:
- draft creation
- edit/review before publish
- publish-time definition of market close policy

Management does not replace:
- engine close legality checks
- Horizon close execution

### Oracle

Oracle may:
- monitor event status
- confirm that a market hit its close condition early
- attach evidence and confidence notes
- propose later winner truth for resolution

Oracle must not:
- silently close the market by itself
- mutate market state by itself in early versions

### Core Engine

Engine remains the final mutation authority for:
- market status transition
- lifecycle legality
- audit-linked state mutation

Good boundary:
- scheduler or Oracle decides a close should be attempted
- engine validates and executes the actual `open -> closed` mutation

Short mental model:
- trigger outside
- truth inside

## Main Operating Loop

Broad loop:
- inspect
- validate
- execute
- record
- alert when abnormal

Typical scheduled path:
1. find markets with `status = open` and `closeAt <= now`
2. build close candidates
3. validate each candidate
4. execute explicit close command
5. write audit + idempotency result
6. emit alert only if something looks wrong

Typical Oracle-confirmed early-close path:
1. Oracle emits explicit close proposal with evidence
2. Horizon validates trigger, policy, evidence, and lifecycle legality
3. execute close once
4. write audit + idempotency result
5. return resulting market state and audit ids

## Invariants

These should stay true:
- only `open` markets can transition to `closed`
- close is idempotent
- close must be auditable
- close must preserve a reason/trigger trail
- close must not modify balances or settle positions
- close must not create a winning outcome
- close must not bypass policy or evidence requirements for exceptional paths

## Result Semantics

The service should treat these cases differently.

### Same request replay

Meaning:
- same idempotency scope
- same actor
- same idempotency key
- same request payload

Result:
- return the stored prior result
- this is the only normal case that should behave like a close replay/no-op

### Different request after market already closed

Meaning:
- different idempotency key or different payload
- market is already `closed`

Result:
- reject as stale or illegal
- do not silently return success as if this request performed the close

### Request after market already resolved

Result:
- hard reject

### Scheduled sweep finds a due market in contradictory state

Examples:
- due by time but already `resolved`
- due by time but status is not `open`

Result:
- do not mutate
- surface as an alert when the situation is abnormal enough to need inspection

## Abnormal Cases

Horizon should not hide weirdness.

Examples:
- market is due to close but status is not `open`
- scheduled close is in the past but repeated sweeps keep failing
- Oracle early-close request arrives without required evidence or required approval
- market is already closed/resolved
- close command succeeded but audit payload is missing

These should create:
- explicit rejection
- or an alert item

Not:
- silent fallback
- silent mutation

## Audit Expectations

Every close action should carry enough context to explain:
- which market changed
- when it changed
- who or what triggered it
- why this trigger path was legal
- what prior status existed
- what resulting status exists
- which idempotency scope/key guarded the action

## Security Posture

Horizon is a trust-sensitive write path.

That means:
- server-side authorization
- explicit trigger validation
- idempotency required
- race-safe execution
- audit trail required
- no client authority over final status

## First Build Goal

The first implementation should prove one narrow truth:

- scheduled markets can close cleanly and deterministically
- exceptional Oracle-confirmed paths have explicit contracts
- the next builder does not have to invent lifecycle semantics from scratch

## Read And Build

A build session should read:
- `workspace/docs/agents/autonomous-operations-model.md`
- `systems/back/docs/horizon/overview.md`
- `systems/back/docs/horizon/authority-boundary.md`
- `systems/back/docs/horizon/first-build-notes.md`
- `systems/back/docs/horizon/schemas-v1.md`
- `systems/back/docs/market-engine.md`
- `systems/back/docs/engine-decisions.md`
- `SECURITY.md`

Then build toward:
- one close-policy shape
- one scheduler/sweep path
- one explicit Horizon close command path
- one alert path for abnormal cases

## Boundaries And Non-Goals

For early versions, Horizon should not:
- create markets
- rewrite live market content
- infer winners
- settle payouts
- invent new lifecycle states
- become a generic moderation engine
- become an AI judge

It should:
- determine close eligibility
- execute clean close transitions
- preserve trigger context
- surface abnormal lifecycle situations early

## Later Docs

Reasonable future adds:
- `horizon-observability.md`
- `horizon-replay-and-recovery.md`
