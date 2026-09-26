import { describe, expect, it } from "vitest";

import {
  buildCloseCandidate,
  inspectCloseCandidate,
  validateCloseCommand
} from "../../../src/lifecycle/horizon/close-check";
import {
  projectClosePolicyFromMarket,
  type HorizonMarketLifecycle
} from "../../../src/lifecycle/horizon/contracts";

const OPEN_MARKET: HorizonMarketLifecycle = {
  marketId: "market_seed_next_prime_minister",
  status: "open",
  openAt: "2026-03-01T10:00:00Z",
  closeAt: "2026-06-01T10:00:00Z",
  closeOnEventCompletion: true,
  eventCompletionCloseRequiresHumanApproval: true,
  closedAt: null,
  resolvedAt: null
};

describe("horizon close policy projection", () => {
  it("projects allowed trigger types from market policy", () => {
    expect(
      projectClosePolicyFromMarket({
        closePolicyId: "cp_market_seed_next_prime_minister",
        createdAt: "2026-03-01T10:00:00Z",
        updatedAt: "2026-03-01T10:00:00Z",
        market: OPEN_MARKET
      })
    ).toMatchObject({
      closeOnEventCompletion: true,
      eventCompletionCloseRequiresHumanApproval: true,
      allowedTriggerTypes: ["scheduled_time", "oracle_confirmed_event_completion"]
    });
  });
});

describe("horizon close legality checks", () => {
  it("accepts a due scheduled close", () => {
    const candidate = buildCloseCandidate({
      closeCandidateId: "cc_due",
      evaluatedAt: "2026-06-01T10:01:00Z",
      triggerType: "scheduled_time",
      market: OPEN_MARKET,
      whyNow: "Close time passed."
    });

    expect(
      inspectCloseCandidate({
        closeCheckResultId: "chk_due",
        checkedAt: "2026-06-01T10:01:00Z",
        candidate,
        market: OPEN_MARKET
      })
    ).toMatchObject({
      eligible: true,
      requiredNextAction: "execute-close"
    });
  });

  it("waits when scheduled close is still in the future", () => {
    const candidate = buildCloseCandidate({
      closeCandidateId: "cc_early",
      evaluatedAt: "2026-05-01T10:01:00Z",
      triggerType: "scheduled_time",
      market: OPEN_MARKET,
      whyNow: "Scheduler sweep."
    });

    expect(
      inspectCloseCandidate({
        closeCheckResultId: "chk_wait",
        checkedAt: "2026-05-01T10:01:00Z",
        candidate,
        market: OPEN_MARKET
      })
    ).toMatchObject({
      eligible: false,
      requiredNextAction: "wait",
      rejectionReasons: ["Scheduled close time has not been reached."]
    });
  });

  it("alerts when approval-gated early close has no approval actor", () => {
    const candidate = buildCloseCandidate({
      closeCandidateId: "cc_oracle_pending",
      evaluatedAt: "2026-05-01T10:01:00Z",
      triggerType: "oracle_confirmed_event_completion",
      market: OPEN_MARKET,
      whyNow: "Oracle says event already ended.",
      triggerContextSummary: "Official coalition agreement announced."
    });

    expect(
      inspectCloseCandidate({
        closeCheckResultId: "chk_alert",
        checkedAt: "2026-05-01T10:01:00Z",
        candidate,
        market: OPEN_MARKET
      })
    ).toMatchObject({
      eligible: false,
      requiredNextAction: "alert",
      approvalMissing: true,
      rejectionReasons: ["Event-completion close requires explicit human approval."]
    });
  });

  it("rejects early close when market policy disables it", () => {
    const market: HorizonMarketLifecycle = {
      ...OPEN_MARKET,
      closeOnEventCompletion: false,
      eventCompletionCloseRequiresHumanApproval: false
    };

    const candidate = buildCloseCandidate({
      closeCandidateId: "cc_oracle_blocked",
      evaluatedAt: "2026-05-01T10:01:00Z",
      triggerType: "oracle_confirmed_event_completion",
      market,
      whyNow: "Oracle says event already ended.",
      triggerContextSummary: "Source posted final result."
    });

    expect(
      inspectCloseCandidate({
        closeCheckResultId: "chk_reject",
        checkedAt: "2026-05-01T10:01:00Z",
        candidate,
        market
      })
    ).toMatchObject({
      eligible: false,
      requiredNextAction: "reject",
      rejectionReasons: ["Market does not allow event-completion close."]
    });
  });
});

describe("horizon close command validation", () => {
  it("requires exceptional context for oracle early close commands", () => {
    expect(
      validateCloseCommand({
        objectType: "close_command",
        closeCommandId: "clc_missing_context",
        marketId: "market_seed_next_prime_minister",
        actorId: "system:lifecycle-scheduler",
        triggerType: "oracle_confirmed_event_completion",
        idempotencyKey: "close:1",
        requestedAt: "2026-05-01T10:01:00Z"
      })
    ).toEqual([
      "oracle_confirmed_event_completion requires evidenceSnapshot, sourceRef, or triggerContextSummary."
    ]);
  });
});
