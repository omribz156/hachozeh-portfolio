# Horizon Authority Boundary v1

Updated: 2026-05-27
Status: current
Owner: backend / lifecycle lane

Version:
- v1

Purpose:
- lock who is allowed to suggest, approve, execute, or only observe close transitions
- prevent lifecycle authority from smearing across discovery, Oracle, and generic admin paths

Placement:
- this is an engine/lifecycle boundary doc, not an agent spec

Read with:
- `systems/back/docs/horizon/README.md`
- `systems/back/docs/horizon/overview.md`
- `systems/back/docs/engine-decisions.md`

This doc owns:
- role split
- approval boundary
- trigger ownership
- alert/escalation boundary

This doc does not own:
- Horizon mission
- first-build scope
- lifecycle object schemas

## Core Rule

Close authority should stay layered:
- some systems may suggest
- some actors may approve
- one trusted backend path executes

Short version:
- propose is not approve
- approve is not execute
- execute is not resolve

## Role Split

### Discovery

Discovery may:
- suggest useful close timing during market creation
- suggest market structure that includes close shape

Discovery may not:
- change live market close timing silently
- close a live market
- override lifecycle state

Why:
- discovery is upstream and heuristic
- close authority is downstream and deterministic

### Market Management

Management may:
- set close policy before publish
- approve exceptional close requests where policy requires approval

Management may not:
- bypass engine legality checks
- silently resolve by closing
- patch lifecycle state through generic market edit behavior
- manually close a live market just because an operator feels like it

### Oracle

Oracle may:
- detect that trading should stop early
- propose `oracle_confirmed_event_completion`
- attach evidence, confidence, and notes
- later propose winner truth for resolution

Oracle may not:
- directly mutate market status on its own
- directly settle the market
- act as final authority in early versions

Why:
- Oracle knows reality signals
- it does not own lifecycle mutation authority

### Human Oversight

Humans may:
- approve exceptional close cases when policy requires review
- inspect alerts and failures

Humans should not need to:
- babysit every normal scheduled close
- act as a generic "close market" button

Target stance:
- humans supervise exceptions
- not routine time-based closure

### Horizon

Horizon may:
- inspect due markets
- validate close eligibility
- reject illegal close attempts
- execute explicit close commands through the trusted backend path
- emit alert items

Horizon may not:
- infer winners
- settle payouts
- rewrite market semantics
- invent approval that was not provided

### Core Engine

The engine is the final mutation authority.

It must validate:
- market exists
- market status is `open`
- requested trigger path is legal
- transition is allowed under policy
- idempotency path is valid

It then executes:
- `open -> closed`

Important:
- the engine/market aggregate holds canonical lifecycle truth
- scheduler, alerts, and review surfaces only observe or propose
- they must not become parallel lifecycle authorities

## Approval Model

### Scheduled close

Approval posture:
- no human approval required by default

Reason:
- this is the boring path
- if `closeAt <= now` and market is `open`, the system should close it

### Oracle-confirmed early close

Approval posture:
- policy-driven

Recommended v1 rule:
- require explicit approval for early close unless the market policy already allows automatic Horizon execution for that exact Oracle-confirmed trigger class

Why:
- early close is more sensitive than time-based close
- it can affect trader trust if used casually

## Trigger Ownership

Good model:
- scheduler owns `scheduled_time` proposals
- Oracle owns `oracle_confirmed_event_completion` proposals

Both still pass through the same trusted Horizon execution contract.

## Alert Boundary

The service should alert instead of acting when:
- trigger context is incomplete
- approval is missing
- market lifecycle is illegal for the requested transition
- repeated scheduled close failures happen
- the market looks corrupted or contradictory

Alert means:
- stop and surface

Not:
- guess and continue

## Identity And Audit Expectations

Every close attempt should preserve:
- actor identity when a human/operator initiated the request
- proposing subsystem identity when applicable
- trigger type
- approval identity when applicable
- market id
- prior and resulting status
- timestamps

This matters because later sessions should be able to answer:
- who asked for this close?
- under what authority?
- why was it allowed?

## Close Is Not Resolve

This boundary must stay sharp.

Close:
- stops trading
- preserves open positions
- does not create a winner
- does not settle balances

Resolve:
- chooses a winning outcome
- creates settlement truth
- pays winners / closes losers

If this line gets blurry:
- lifecycle becomes hard to reason about
- trust drops
- builder sessions start making up dangerous shortcuts

## Practical Builder Rule

If a future builder asks:
- "can this path choose a winning outcome?"

Answer:
- no, wrong service

If the builder asks:
- "can this path stop trading now?"

Answer:
- yes, if trigger + authority + legality are explicit
