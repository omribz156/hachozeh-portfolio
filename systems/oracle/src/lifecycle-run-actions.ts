import { randomUUID } from "node:crypto";

import type { HorizonCloseSweepResult } from "../../back/src/platform-surface/oracle";
import type { CloseConditionItem } from "./lifecycle-run-close-conditions";
import type { CloseProvenanceItem } from "./lifecycle-run-provenance";
import type {
  LifecycleBlocker,
  LifecycleNextAction,
  LifecycleRunStatus,
  LifecycleWarning
} from "./lifecycle-run-types";
import type { OracleOfficialFinalIntakeResult } from "./official-final-intake-service";
import type { OracleResolveInboxResult } from "./resolve-inbox-service";
import type { OracleLifecycleSourceContext } from "./source-adapter-contracts";
import type { OracleLifecycleCapability } from "./source-adapter-registry";

function buildAction(input: Omit<LifecycleNextAction, "actionId">): LifecycleNextAction {
  return {
    actionId: `act_${randomUUID()}`,
    ...input
  };
}

export function buildMissingProvenanceBlocker(item: CloseProvenanceItem): LifecycleBlocker {
  return {
    blockerId: `blk_${randomUUID()}`,
    blockerCode:
      item.provenanceStatus === "invalid"
        ? "blocked_invalid_close_provenance"
        : "blocked_missing_close_provenance",
    severity: "high",
    marketId: item.marketId,
    reason: item.reason,
    safeToAutoExecute: false,
    requiresExplicitApproval: true,
    riskLevel: "dangerous_manual_only"
  };
}

function shouldParkManualResolution(
  item: OracleLifecycleCapability,
  context: OracleLifecycleSourceContext | undefined,
  now: Date
): boolean {
  if (
    item.classification !== "manual_resolution_required" ||
    !item.blockers.some((blocker) => blocker.blockerCode === "manual_resolution_required") ||
    context?.marketStatus !== "open"
  ) {
    return false;
  }

  const closeAtMs = Date.parse(context.closeAt);

  return Number.isFinite(closeAtMs) && closeAtMs > now.getTime();
}

export function buildCapabilityBlockers(
  item: OracleLifecycleCapability,
  context: OracleLifecycleSourceContext | undefined,
  now: Date
): LifecycleBlocker[] {
  if (shouldParkManualResolution(item, context, now)) {
    return [];
  }

  return item.blockers.map((blocker) => ({
    blockerId: `blk_${randomUUID()}`,
    blockerCode: "blocked_lifecycle_capability",
    severity: "high",
    marketId: item.marketId,
    reason: `${blocker.blockerCode}: ${blocker.reason}`,
    safeToAutoExecute: false,
    requiresExplicitApproval: true,
    riskLevel: "dangerous_manual_only"
  }));
}

export function buildResolutionIntakeFailedBlocker(marketId: string, error: unknown): LifecycleBlocker {
  return {
    blockerId: `blk_${randomUUID()}`,
    blockerCode: "blocked_resolution_intake_failed",
    severity: "high",
    marketId,
    reason: error instanceof Error ? error.message : String(error),
    safeToAutoExecute: false,
    requiresExplicitApproval: true,
    riskLevel: "dangerous_manual_only"
  };
}

export function buildWarningFromIntakeItem(
  item: OracleOfficialFinalIntakeResult["items"][number]
): LifecycleWarning | null {
  if (item.action === "skipped_not_final") {
    return {
      warningId: `wrn_${randomUUID()}`,
      warningCode: "final_source_not_ready",
      marketId: item.marketId,
      reason: item.reason
    };
  }

  if (item.action === "skipped_unsupported_source") {
    return {
      warningId: `wrn_${randomUUID()}`,
      warningCode: "unsupported_final_source",
      marketId: item.marketId,
      reason: item.reason
    };
  }

  return null;
}

function buildCloseConditionActions(items: CloseConditionItem[]): LifecycleNextAction[] {
  return items
    .filter((item) =>
      item.action === "would_create_case" ||
      item.action === "created_case" ||
      item.action === "would_close_market"
    )
    .map((item) =>
      buildAction({
        actionType:
          item.action === "created_case"
            ? "approve_close_condition_case"
            : item.action === "would_close_market"
              ? "close_market_from_terminal_official_evidence"
              : "create_close_condition_case",
        riskLevel:
          item.action === "created_case" ? "approval_required" : "state_mutating_low_risk",
        safeToAutoExecute: item.action !== "created_case",
        requiresExplicitApproval: item.action === "created_case",
        marketId: item.marketId,
        oracleCaseId: item.oracleCaseId,
        reason:
          item.action === "created_case"
            ? "Close-condition case exists; explicit approval is required before Horizon closes early."
            : item.action === "would_close_market"
              ? "Official terminal evidence is available; lifecycle can close trading without resolving payout."
            : "Official source indicates the close condition is satisfied; create a human-gated close-condition case.",
        command:
          item.action === "created_case" && item.oracleCaseId
            ? `npm --prefix systems/back run oracle -- approve-close-condition-case --case ${item.oracleCaseId} --json`
            : `npm --prefix systems/back run oracle -- lifecycle-run --market ${item.marketId} --json`
      })
    );
}

function buildCredibleReportingActions(
  results: Array<{ action: string; marketId: string; oracleCaseId?: string; reason: string }>
): LifecycleNextAction[] {
  return results
    .filter((item) => item.oracleCaseId)
    .map((item) =>
      buildAction({
        actionType:
          item.action === "created_case"
            ? "approve_resolution_case"
            : "review_credible_reporting_case",
        riskLevel: "approval_required",
        safeToAutoExecute: false,
        requiresExplicitApproval: true,
        marketId: item.marketId,
        oracleCaseId: item.oracleCaseId,
        reason: item.reason,
        command: `npm --prefix systems/back run oracle -- case-detail --case ${item.oracleCaseId} --json`
      })
    );
}

export function buildInboxActions(
  inbox: OracleResolveInboxResult,
  blockedMarketIds: Set<string>,
  sourceLagMarketIds: Set<string>
): LifecycleNextAction[] {
  const missingCaseActions = inbox.missingCases
    .filter(
      (item) =>
        !blockedMarketIds.has(item.marketId) &&
        !sourceLagMarketIds.has(item.marketId)
    )
    .map((item) =>
      buildAction({
        actionType: "create_resolution_case",
        riskLevel: "approval_required",
        safeToAutoExecute: false,
        requiresExplicitApproval: true,
        marketId: item.marketId,
        reason: `Closed market is missing a resolution case: ${item.marketTitle}.`,
        command: item.suggestedCommand
      })
    );
  const recommendedCaseActions = inbox.recommendedCases
    .filter((item) => !blockedMarketIds.has(item.marketId))
    .flatMap((item) => [
      buildAction({
        actionType: "approve_resolution_case",
        riskLevel: "approval_required",
        safeToAutoExecute: false,
        requiresExplicitApproval: true,
        marketId: item.marketId,
        oracleCaseId: item.oracleCaseId,
        reason: `Approval required for recommended winner "${item.winningOutcomeLabel ?? item.winningOutcomeId ?? "unknown"}".`,
        command: item.suggestedApproveCommand
      }),
      buildAction({
        actionType: "reject_case",
        riskLevel: "approval_required",
        safeToAutoExecute: false,
        requiresExplicitApproval: true,
        marketId: item.marketId,
        oracleCaseId: item.oracleCaseId,
        reason: "Reject this case if the evidence/outcome mapping is wrong.",
        command: item.suggestedRejectCommand
      }),
      buildAction({
        actionType: "request_more_evidence",
        riskLevel: "approval_required",
        safeToAutoExecute: false,
        requiresExplicitApproval: true,
        marketId: item.marketId,
        oracleCaseId: item.oracleCaseId,
        reason: "Request more evidence if the official source is insufficient or ambiguous.",
        command: item.suggestedMoreEvidenceCommand
      })
    ]);
  const reviewNeededCaseActions = inbox.reviewNeededCases
    .filter((item) => !blockedMarketIds.has(item.marketId))
    .map((item) =>
      buildAction({
        actionType: "inspect_review_needed_resolution_case",
        riskLevel: "approval_required",
        safeToAutoExecute: false,
        requiresExplicitApproval: true,
        marketId: item.marketId,
        oracleCaseId: item.oracleCaseId,
        reason: `Closed market has a review-needed resolution case: ${item.marketTitle}.`,
        command: item.suggestedInspectCommand
      })
    );

  return [...missingCaseActions, ...recommendedCaseActions, ...reviewNeededCaseActions];
}

export function buildLifecycleActions(input: {
  closeConditionItems: CloseConditionItem[];
  credibleReportingResults: Array<{
    action: string;
    marketId: string;
    oracleCaseId?: string;
    reason: string;
  }>;
  finalInbox: OracleResolveInboxResult;
  blockedMarketIds: Set<string>;
  sourceLagMarketIds: Set<string>;
}): LifecycleNextAction[] {
  return [
    buildAction({
      actionType: "run_lifecycle_again",
      riskLevel: "safe_repeatable",
      safeToAutoExecute: true,
      requiresExplicitApproval: false,
      reason: "Repeat the lifecycle pipeline on the next heartbeat.",
      command: "npm --prefix systems/back run oracle -- lifecycle-run --json"
    }),
    ...buildCloseConditionActions(input.closeConditionItems),
    ...buildCredibleReportingActions(input.credibleReportingResults),
    ...buildInboxActions(input.finalInbox, input.blockedMarketIds, input.sourceLagMarketIds)
  ];
}

export function deriveStatus(input: {
  blockers: LifecycleBlocker[];
  warnings: LifecycleWarning[];
  actions: LifecycleNextAction[];
  closeSweep: HorizonCloseSweepResult;
  intakeResults: OracleOfficialFinalIntakeResult[];
}): LifecycleRunStatus {
  if (input.blockers.length > 0) {
    return "blocked";
  }

  const createdCaseCount = input.intakeResults.reduce(
    (sum, result) => sum + result.createdCaseCount,
    0
  );

  if (
    input.actions.length > 0 ||
    input.closeSweep.executions.length > 0 ||
    createdCaseCount > 0
  ) {
    return "completed_with_actions";
  }

  if (input.warnings.length > 0 || input.closeSweep.alerts.length > 0) {
    return "completed_with_warnings";
  }

  return "completed_clean";
}
