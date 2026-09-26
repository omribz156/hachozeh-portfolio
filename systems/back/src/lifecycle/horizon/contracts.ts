export const MARKET_LIFECYCLE_STATUSES = ["draft", "open", "closed", "resolved", "voided"] as const;

export type MarketLifecycleStatus = (typeof MARKET_LIFECYCLE_STATUSES)[number];

export const HORIZON_CLOSE_TRIGGER_TYPES = [
  "scheduled_time",
  "oracle_confirmed_event_completion"
] as const;

export type HorizonCloseTriggerType = (typeof HORIZON_CLOSE_TRIGGER_TYPES)[number];

export const HORIZON_CLOSE_NEXT_ACTIONS = [
  "execute-close",
  "wait",
  "reject",
  "alert"
] as const;

export type HorizonCloseNextAction = (typeof HORIZON_CLOSE_NEXT_ACTIONS)[number];

export type HorizonClosePolicy = {
  objectType: "close_policy";
  closePolicyId: string;
  marketId: string;
  scheduledCloseAt: string;
  closeOnEventCompletion: boolean;
  eventCompletionCloseRequiresHumanApproval: boolean;
  createdAt: string;
  updatedAt: string;
  allowedTriggerTypes?: HorizonCloseTriggerType[];
  notes?: string;
};

export type HorizonCloseCandidate = {
  objectType: "close_candidate";
  closeCandidateId: string;
  marketId: string;
  marketStatus: MarketLifecycleStatus;
  scheduledCloseAt: string;
  evaluatedAt: string;
  triggerType: HorizonCloseTriggerType;
  whyNow: string;
  createdAt: string;
  actorId?: string;
  proposedBySubsystem?: string;
  approvalActorId?: string;
  triggerContextSummary?: string;
  sourceRef?: string;
};

export type HorizonCloseCheckResult = {
  objectType: "close_check_result";
  closeCheckResultId: string;
  marketId: string;
  eligible: boolean;
  marketStatus: MarketLifecycleStatus;
  triggerType: HorizonCloseTriggerType;
  decisionSummary: string;
  checkedAt: string;
  rejectionReasons?: string[];
  requiredNextAction?: HorizonCloseNextAction;
  approvalMissing?: boolean;
  notes?: string;
};

export type HorizonCloseCommand = {
  objectType: "close_command";
  closeCommandId: string;
  marketId: string;
  actorId: string;
  triggerType: HorizonCloseTriggerType;
  idempotencyKey: string;
  requestedAt: string;
  proposedBySubsystem?: string;
  approvalActorId?: string;
  triggerContextSummary?: string;
  evidenceSnapshot?: string;
  sourceRef?: string;
  notes?: string;
};

export type HorizonCloseExecutionResult = {
  objectType: "close_execution_result";
  closeExecutionResultId: string;
  marketId: string;
  previousStatus: Extract<MarketLifecycleStatus, "open" | "closed" | "resolved">;
  resultingStatus: "closed" | "closed-noop" | "rejected";
  triggerType: HorizonCloseTriggerType;
  executed: boolean;
  auditEventId: string;
  idempotencyScope: string;
  idempotencyKey: string;
  executedAt: string;
  closedAt?: string;
  actorId?: string;
  proposedBySubsystem?: string;
  approvalActorId?: string;
  notes?: string;
};

export type HorizonLifecycleAlertItem = {
  objectType: "lifecycle_alert_item";
  alertItemId: string;
  marketId: string;
  severity: "low" | "medium" | "high";
  alertType:
    | "close-overdue"
    | "illegal-close-attempt"
    | "missing-approval"
    | "repeated-close-failure"
    | "state-conflict";
  summary: string;
  detectedAt: string;
  triggerType?: HorizonCloseTriggerType;
  marketStatus?: MarketLifecycleStatus;
  requiredHumanAction?: "inspect" | "approve" | "retry" | "escalate";
  sourceRef?: string;
  notes?: string;
};

export type HorizonMarketLifecycle = {
  marketId: string;
  status: MarketLifecycleStatus;
  openAt: string;
  closeAt: string;
  closeOnEventCompletion: boolean;
  eventCompletionCloseRequiresHumanApproval: boolean;
  closedAt?: string | null;
  resolvedAt?: string | null;
};

export function projectClosePolicyFromMarket(input: {
  closePolicyId: string;
  createdAt: string;
  updatedAt: string;
  market: HorizonMarketLifecycle;
  notes?: string;
}): HorizonClosePolicy {
  const allowedTriggerTypes: HorizonCloseTriggerType[] = input.market.closeOnEventCompletion
    ? [...HORIZON_CLOSE_TRIGGER_TYPES]
    : ["scheduled_time"];

  return {
    objectType: "close_policy",
    closePolicyId: input.closePolicyId,
    marketId: input.market.marketId,
    scheduledCloseAt: input.market.closeAt,
    closeOnEventCompletion: input.market.closeOnEventCompletion,
    eventCompletionCloseRequiresHumanApproval:
      input.market.eventCompletionCloseRequiresHumanApproval,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    allowedTriggerTypes,
    notes: input.notes
  };
}
