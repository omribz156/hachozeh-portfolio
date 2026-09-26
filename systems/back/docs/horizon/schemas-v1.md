# Horizon Schemas v1

Updated: 2026-05-27
Status: current
Owner: backend / lifecycle lane

Version:
- v1

Purpose:
- define the first canonical Horizon data schemas
- give the next builder session concrete lifecycle objects to implement
- keep scheduler, command, and audit-facing shapes aligned

Placement:
- these are backend lifecycle/engine-side contract shapes
- they are not discovery or Oracle schemas

Scope:
- Horizon-side schemas only
- not full market tables
- not Oracle/settlement schemas

Read with:
- `systems/back/docs/horizon/README.md`
- `systems/back/docs/horizon/overview.md`
- `systems/back/docs/horizon/first-build-notes.md`

This doc owns:
- canonical Horizon objects
- field-level validation rules
- CLI output targets

This doc does not own:
- Horizon mission
- authority theory
- full market persistence schema

## Design Rules

These schemas should optimize for:
- explicit lifecycle reasoning
- readable CLI/script output
- stable audit context
- small trigger vocabulary
- easy builder implementation

They should not optimize for:
- speculative workflow engines
- giant nested payloads
- fake scoring systems

Practical rule:
- keep v1 flat enough to inspect quickly
- keep the mutation contract explicit
- prefer repeated simple fields over deep nesting when it improves operator clarity

## Canonical Objects

Horizon v1 uses these canonical objects:
- `close_policy`
- `close_candidate`
- `close_check_result`
- `close_command`
- `close_execution_result`
- `lifecycle_alert_item`

These objects support:
- scheduled inspection
- legality checks
- close execution
- abnormal-case surfacing

## Shared Conventions

### Ids

All ids are strings.

Recommended prefixes:
- `cp_` for close policy
- `cc_` for close candidate
- `chk_` for close check result
- `clc_` for close command
- `clr_` for close execution result
- `alt_` for lifecycle alert item

### Timestamps

All timestamps should use ISO 8601 UTC strings.

Example:
- `2026-03-28T10:15:00Z`

## 1. `close_policy`

Purpose:
- represent the market's close behavior contract
- make scheduled and exceptional close paths explicit before trouble starts

Important:
- in v1 this is a canonical contract shape, not a second persistence authority
- it should normally be projected from the market's own lifecycle fields / market-owned write model
- do not create split lifecycle truth by storing independent close timing/policy in two different places

### Required Fields

- `objectType`
  - fixed value: `close_policy`
- `closePolicyId`
- `marketId`
- `scheduledCloseAt`
- `closeOnEventCompletion`
- `eventCompletionCloseRequiresHumanApproval`
- `createdAt`
- `updatedAt`

### Optional Fields

- `allowedTriggerTypes`
- `notes`

### Example

```json
{
  "objectType": "close_policy",
  "closePolicyId": "cp_boi_mar_2026",
  "marketId": "mkt_boi_mar_2026_direction",
  "scheduledCloseAt": "2026-03-30T09:55:00Z",
  "closeOnEventCompletion": true,
  "eventCompletionCloseRequiresHumanApproval": true,
  "allowedTriggerTypes": [
    "scheduled_time",
    "oracle_confirmed_event_completion"
  ],
  "createdAt": "2026-03-28T10:15:00Z",
  "updatedAt": "2026-03-28T10:15:00Z"
}
```

## 2. `close_candidate`

Purpose:
- represent one market the service is evaluating for close
- sit between raw DB query results and actual mutation attempts

### Required Fields

- `objectType`
  - fixed value: `close_candidate`
- `closeCandidateId`
- `marketId`
- `marketStatus`
- `scheduledCloseAt`
- `evaluatedAt`
- `triggerType`
- `whyNow`
- `createdAt`

### Optional Fields

- `actorId`
- `proposedBySubsystem`
- `approvalActorId`
- `triggerContextSummary`
- `sourceRef`

### Enums

`marketStatus`
- `draft`
- `open`
- `closed`
- `resolved`

`triggerType`
- `scheduled_time`
- `oracle_confirmed_event_completion`

### Example

```json
{
  "objectType": "close_candidate",
  "closeCandidateId": "cc_boi_mar_2026_due",
  "marketId": "mkt_boi_mar_2026_direction",
  "marketStatus": "open",
  "scheduledCloseAt": "2026-03-30T09:55:00Z",
  "evaluatedAt": "2026-03-30T09:56:00Z",
  "triggerType": "scheduled_time",
  "whyNow": "Market is still open and scheduled close time has passed.",
  "createdAt": "2026-03-30T09:56:00Z"
}
```

## 3. `close_check_result`

Purpose:
- represent the service's legality check before mutation
- make acceptance or rejection legible

### Required Fields

- `objectType`
  - fixed value: `close_check_result`
- `closeCheckResultId`
- `marketId`
- `eligible`
- `marketStatus`
- `triggerType`
- `decisionSummary`
- `checkedAt`

### Optional Fields

- `rejectionReasons`
- `requiredNextAction`
- `approvalMissing`
- `notes`

### Enums

`requiredNextAction`
- `execute-close`
- `wait`
- `reject`
- `alert`

### Example

```json
{
  "objectType": "close_check_result",
  "closeCheckResultId": "chk_boi_mar_2026_due",
  "marketId": "mkt_boi_mar_2026_direction",
  "eligible": true,
  "marketStatus": "open",
  "triggerType": "scheduled_time",
  "decisionSummary": "Scheduled close time passed and market is legally closable now.",
  "checkedAt": "2026-03-30T09:56:01Z",
  "requiredNextAction": "execute-close"
}
```

## 4. `close_command`

Purpose:
- represent the explicit trusted mutation request
- keep close execution separate from raw scheduler results

### Required Fields

- `objectType`
  - fixed value: `close_command`
- `closeCommandId`
- `marketId`
- `actorId`
- `triggerType`
- `idempotencyKey`
- `requestedAt`

### Optional Fields

- `proposedBySubsystem`
- `approvalActorId`
- `triggerContextSummary`
- `evidenceSnapshot`
- `sourceRef`
- `notes`

### Example

```json
{
  "objectType": "close_command",
  "closeCommandId": "clc_boi_mar_2026_due",
  "marketId": "mkt_boi_mar_2026_direction",
  "actorId": "system:lifecycle-scheduler",
  "triggerType": "scheduled_time",
  "idempotencyKey": "close:mkt_boi_mar_2026_direction:2026-03-30T09:56:00Z",
  "requestedAt": "2026-03-30T09:56:01Z",
  "triggerContextSummary": "Routine scheduled close sweep."
}
```

## 5. `close_execution_result`

Purpose:
- represent the result of an attempted close mutation
- return enough context for audit, replay, and debugging

### Required Fields

- `objectType`
  - fixed value: `close_execution_result`
- `closeExecutionResultId`
- `marketId`
- `previousStatus`
- `resultingStatus`
- `triggerType`
- `executed`
- `auditEventId`
- `idempotencyScope`
- `idempotencyKey`
- `executedAt`

### Optional Fields

- `closedAt`
- `actorId`
- `proposedBySubsystem`
- `approvalActorId`
- `notes`

### Enums

`previousStatus`
- `open`
- `closed`
- `resolved`

`resultingStatus`
- `closed`
- `closed-noop`
- `rejected`

Field notes:
- `closed-noop` is only for valid replay of the same already-completed close request
- it is not the generic result for "someone else already closed this market earlier"

### Example

```json
{
  "objectType": "close_execution_result",
  "closeExecutionResultId": "clr_boi_mar_2026_due",
  "marketId": "mkt_boi_mar_2026_direction",
  "previousStatus": "open",
  "resultingStatus": "closed",
  "triggerType": "scheduled_time",
  "executed": true,
  "closedAt": "2026-03-30T09:56:02Z",
  "auditEventId": "aud_market_close_001",
  "idempotencyScope": "close_market",
  "idempotencyKey": "close:mkt_boi_mar_2026_direction:2026-03-30T09:56:00Z",
  "executedAt": "2026-03-30T09:56:02Z",
  "actorId": "system:lifecycle-scheduler"
}
```

## 6. `lifecycle_alert_item`

Purpose:
- represent a lifecycle abnormality the service refused to hide
- create a clean handoff for later operator or system review

### Required Fields

- `objectType`
  - fixed value: `lifecycle_alert_item`
- `alertItemId`
- `marketId`
- `severity`
- `alertType`
- `summary`
- `detectedAt`

### Optional Fields

- `triggerType`
- `marketStatus`
- `requiredHumanAction`
- `sourceRef`
- `notes`

### Enums

`severity`
- `low`
- `medium`
- `high`

`alertType`
- `close-overdue`
- `illegal-close-attempt`
- `missing-approval`
- `repeated-close-failure`
- `state-conflict`

`requiredHumanAction`
- `inspect`
- `approve`
- `retry`
- `escalate`

### Example

```json
{
  "objectType": "lifecycle_alert_item",
  "alertItemId": "alt_boi_mar_2026_close_overdue",
  "marketId": "mkt_boi_mar_2026_direction",
  "severity": "medium",
  "alertType": "repeated-close-failure",
  "summary": "Market is due to close, still open, and the last two scheduled close attempts failed.",
  "triggerType": "scheduled_time",
  "marketStatus": "open",
  "requiredHumanAction": "inspect",
  "detectedAt": "2026-03-30T10:10:00Z"
}
```

## Object Relationships

Recommended relationship flow:

1. `close_policy`
   - belongs to one market
2. `close_candidate`
   - references one market at one evaluation moment
3. `close_check_result`
   - describes whether that candidate is legal now
4. `close_command`
   - represents the explicit mutation attempt
5. `close_execution_result`
   - records the trusted result
6. `lifecycle_alert_item`
   - appears when the path should stop and surface trouble

## Required CLI Output Targets

For the first build:
- `horizon close-sweep` should emit `close_candidate`
- `horizon inspect-close` should emit `close_check_result`
- `horizon close-market` should emit `close_execution_result`
- `horizon alerts` should emit `lifecycle_alert_item`

## Validation Rules v1

Keep validation simple but strict where it matters.

### `close_policy`

- `marketId` required and non-empty
- `scheduledCloseAt` required
- `closeOnEventCompletion` required
- `eventCompletionCloseRequiresHumanApproval` required
- if `closeOnEventCompletion = false`, `eventCompletionCloseRequiresHumanApproval` must also be `false`

### `close_check_result`

- `decisionSummary` required and non-empty
- `eligible = false` requires at least one rejection reason or a required next action of `alert`

### `close_command`

- `marketId` required and non-empty
- `actorId` required and non-empty
- `triggerType` required
- `idempotencyKey` required and non-empty
- `oracle_confirmed_event_completion` should require at least one trigger context field such as `evidenceSnapshot`, `sourceRef`, or `triggerContextSummary`
- approval-gated exceptional paths should require `approvalActorId`

### `close_execution_result`

- must include one audit event id
- must include one idempotency scope/key pair
- if `executed = true`, `closedAt` is required
- `closed-noop` should only be returned for same-request replay, not stale conflicting requests

### `lifecycle_alert_item`

- must include one severity
- must include one alert type
- must include one short human-readable summary

## v1 Sharp Edges

These schemas are intentionally practical.

Known compromises:
- small trigger vocabulary
- approval logic kept simple
- no full policy DSL
- no scheduler-run aggregate report schema yet
- no replay/recovery schema yet

That is acceptable for v1.

The goal is to support:
- inspect
- decide
- close
- alert

Not to build a workflow cathedral before one market closes correctly.
