import type {
  HorizonCloseCandidate,
  HorizonCloseCheckResult,
  HorizonCloseCommand,
  HorizonCloseTriggerType,
  HorizonMarketLifecycle
} from "./contracts";

function toTimestamp(value: string): number {
  return new Date(value).getTime();
}

function hasExceptionalContext(command: HorizonCloseCommand): boolean {
  return Boolean(
    command.evidenceSnapshot ||
    command.sourceRef ||
    command.triggerContextSummary
  );
}

export function buildCloseCandidate(input: {
  closeCandidateId: string;
  evaluatedAt: string;
  triggerType: HorizonCloseTriggerType;
  market: HorizonMarketLifecycle;
  whyNow: string;
  actorId?: string;
  proposedBySubsystem?: string;
  approvalActorId?: string;
  triggerContextSummary?: string;
  sourceRef?: string;
}): HorizonCloseCandidate {
  return {
    objectType: "close_candidate",
    closeCandidateId: input.closeCandidateId,
    marketId: input.market.marketId,
    marketStatus: input.market.status,
    scheduledCloseAt: input.market.closeAt,
    evaluatedAt: input.evaluatedAt,
    triggerType: input.triggerType,
    whyNow: input.whyNow,
    createdAt: input.evaluatedAt,
    actorId: input.actorId,
    proposedBySubsystem: input.proposedBySubsystem,
    approvalActorId: input.approvalActorId,
    triggerContextSummary: input.triggerContextSummary,
    sourceRef: input.sourceRef
  };
}

export function inspectCloseCandidate(input: {
  closeCheckResultId: string;
  checkedAt: string;
  candidate: HorizonCloseCandidate;
  market: HorizonMarketLifecycle;
  notes?: string;
}): HorizonCloseCheckResult {
  const rejectionReasons: string[] = [];
  let requiredNextAction: HorizonCloseCheckResult["requiredNextAction"] = "execute-close";
  let decisionSummary = "Market is legally closable now.";
  let approvalMissing = false;

  if (input.market.status !== "open") {
    rejectionReasons.push("Market is not open.");
    requiredNextAction = "reject";
    decisionSummary = "Only open markets may transition to closed.";
  }

  if (input.candidate.triggerType === "scheduled_time") {
    if (toTimestamp(input.market.closeAt) > toTimestamp(input.checkedAt)) {
      rejectionReasons.push("Scheduled close time has not been reached.");
      requiredNextAction = "wait";
      decisionSummary = "Market should stay open until the scheduled close time.";
    }
  }

  if (input.candidate.triggerType === "oracle_confirmed_event_completion") {
    if (!input.market.closeOnEventCompletion) {
      rejectionReasons.push("Market does not allow event-completion close.");
      requiredNextAction = "reject";
      decisionSummary = "Event-completion close is disabled for this market.";
    }

    const hasTriggerContext = Boolean(
      input.candidate.triggerContextSummary || input.candidate.sourceRef
    );

    if (!hasTriggerContext) {
      rejectionReasons.push("Event-completion close requires explicit trigger context.");
      requiredNextAction = "alert";
      decisionSummary = "Oracle-driven event-completion close needs context before Horizon should act.";
    }

    if (
      input.market.eventCompletionCloseRequiresHumanApproval &&
      !input.candidate.approvalActorId
    ) {
      rejectionReasons.push("Event-completion close requires explicit human approval.");
      requiredNextAction = "alert";
      approvalMissing = true;
      decisionSummary =
        "Event-completion close is policy-gated until a human approval is attached.";
    }
  }

  return {
    objectType: "close_check_result",
    closeCheckResultId: input.closeCheckResultId,
    marketId: input.market.marketId,
    eligible: rejectionReasons.length === 0,
    marketStatus: input.market.status,
    triggerType: input.candidate.triggerType,
    decisionSummary,
    checkedAt: input.checkedAt,
    rejectionReasons: rejectionReasons.length > 0 ? rejectionReasons : undefined,
    requiredNextAction,
    approvalMissing: approvalMissing || undefined,
    notes: input.notes
  };
}

export function validateCloseCommand(command: HorizonCloseCommand): string[] {
  const problems: string[] = [];

  if (!command.marketId) {
    problems.push("marketId is required.");
  }

  if (!command.actorId) {
    problems.push("actorId is required.");
  }

  if (!command.idempotencyKey) {
    problems.push("idempotencyKey is required.");
  }

  if (
    command.triggerType === "oracle_confirmed_event_completion" &&
    !hasExceptionalContext(command)
  ) {
    problems.push(
      "oracle_confirmed_event_completion requires evidenceSnapshot, sourceRef, or triggerContextSummary."
    );
  }

  return problems;
}
