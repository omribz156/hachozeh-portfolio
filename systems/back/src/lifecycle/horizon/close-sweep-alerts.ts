import { randomUUID } from "node:crypto";

import {
  CloseMarketServiceError
} from "./close-market-service";
import type {
  HorizonCloseCandidate,
  HorizonCloseCheckResult,
  HorizonLifecycleAlertItem,
  HorizonMarketLifecycle
} from "./contracts";
import type { HorizonMarketLifecycleRow } from "./market-lifecycle-row";

type CloseInspectionForAlert = {
  market: HorizonMarketLifecycle;
  candidate: HorizonCloseCandidate;
  check: HorizonCloseCheckResult;
};

type BuildLifecycleAlertInput = Omit<
  HorizonLifecycleAlertItem,
  "objectType" | "alertItemId"
>;

function buildLifecycleAlert(input: BuildLifecycleAlertInput): HorizonLifecycleAlertItem {
  return {
    objectType: "lifecycle_alert_item",
    alertItemId: `alt_${randomUUID()}`,
    ...input
  };
}

function alertTypeFromCloseCheck(check: HorizonCloseCheckResult): HorizonLifecycleAlertItem["alertType"] {
  if (check.approvalMissing) {
    return "missing-approval";
  }

  if (check.requiredNextAction === "alert") {
    return "illegal-close-attempt";
  }

  return "close-overdue";
}

export function buildAlertFromCheck(
  inspection: CloseInspectionForAlert
): HorizonLifecycleAlertItem | undefined {
  if (inspection.check.eligible) {
    return undefined;
  }

  return buildLifecycleAlert({
    marketId: inspection.market.marketId,
    severity: inspection.check.approvalMissing ? "high" : "medium",
    alertType: alertTypeFromCloseCheck(inspection.check),
    summary:
      inspection.check.rejectionReasons?.[0] ??
      inspection.check.decisionSummary,
    detectedAt: inspection.check.checkedAt,
    triggerType: inspection.candidate.triggerType,
    marketStatus: inspection.market.status,
    requiredHumanAction: inspection.check.approvalMissing ? "approve" : "inspect",
    sourceRef: inspection.candidate.sourceRef
  });
}

export function buildAlertFromCloseError(input: {
  inspection: CloseInspectionForAlert;
  error: unknown;
  detectedAt: string;
}): HorizonLifecycleAlertItem {
  const error = input.error;

  if (error instanceof CloseMarketServiceError) {
    return buildLifecycleAlert({
      marketId: input.inspection.market.marketId,
      severity: error.code === "market_not_closable" ? "medium" : "high",
      alertType:
        error.code === "market_not_closable"
          ? "illegal-close-attempt"
          : "repeated-close-failure",
      summary: error.message,
      detectedAt: input.detectedAt,
      triggerType: input.inspection.candidate.triggerType,
      marketStatus: input.inspection.market.status,
      requiredHumanAction: error.code === "market_not_closable" ? "inspect" : "retry",
      sourceRef: input.inspection.candidate.sourceRef
    });
  }

  return buildLifecycleAlert({
    marketId: input.inspection.market.marketId,
    severity: "high",
    alertType: "repeated-close-failure",
    summary: error instanceof Error ? error.message : "Unexpected Horizon close failure.",
    detectedAt: input.detectedAt,
    triggerType: input.inspection.candidate.triggerType,
    marketStatus: input.inspection.market.status,
    requiredHumanAction: "retry",
    sourceRef: input.inspection.candidate.sourceRef
  });
}

export function buildLifecycleConflictAlert(
  row: HorizonMarketLifecycleRow,
  detectedAt: string
): HorizonLifecycleAlertItem {
  return buildLifecycleAlert({
    marketId: row.id,
    severity: "medium",
    alertType: "state-conflict",
    summary: `Market is due by time but lifecycle timestamps contradict status "${row.status}".`,
    detectedAt,
    triggerType: "scheduled_time",
    marketStatus: row.status,
    requiredHumanAction: "inspect"
  });
}
