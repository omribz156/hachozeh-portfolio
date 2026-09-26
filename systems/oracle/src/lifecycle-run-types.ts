import type { HorizonCloseSweepResult } from "../../back/src/platform-surface/oracle";
import type { CredibleReportingEvaluationResult } from "./credible-reporting-evaluator-service";
import type { CloseProvenanceItem } from "./lifecycle-run-provenance";
import type { CloseConditionItem } from "./lifecycle-run-close-conditions";
import type { OracleOfficialFinalIntakeResult } from "./official-final-intake-service";
import type { OracleResolveInboxResult } from "./resolve-inbox-service";
import type { OracleLifecycleCapability } from "./source-adapter-registry";
import type { SourceLagEventUpdateResult } from "./market-event-update-service";

export type SourceSnapshotCaptureItem = {
  objectType: "oracle_source_snapshot_capture_item";
  marketId: string;
  sourceFamily: string;
  action: "would_capture" | "captured" | "skipped_existing";
  symbol?: string;
  observedAt?: string;
  lifecycleEventId?: string | null;
  machineResolutionEndpoint?: string;
  reason: string;
};

export type SourceSnapshotCapturePhase = {
  objectType: "oracle_source_snapshot_capture_phase";
  checkedMarketCount: number;
  capturedCount: number;
  skippedExistingCount: number;
  dryRun: boolean;
  items: SourceSnapshotCaptureItem[];
};

export type LifecycleRunStatus =
  | "completed_clean"
  | "completed_with_actions"
  | "completed_with_warnings"
  | "blocked"
  | "failed";

export type LifecycleActionRiskLevel =
  | "read_only"
  | "safe_repeatable"
  | "state_mutating_low_risk"
  | "approval_required"
  | "dangerous_manual_only";

export type LifecycleNextAction = {
  actionId: string;
  actionType: string;
  riskLevel: LifecycleActionRiskLevel;
  safeToAutoExecute: boolean;
  requiresExplicitApproval: boolean;
  marketId?: string;
  oracleCaseId?: string;
  reason: string;
  command: string | null;
};

export type LifecycleBlocker = {
  blockerId: string;
  blockerCode:
    | "blocked_missing_close_provenance"
    | "blocked_invalid_close_provenance"
    | "blocked_resolution_intake_failed"
    | "blocked_lifecycle_capability";
  severity: "medium" | "high";
  marketId: string;
  reason: string;
  safeToAutoExecute: false;
  requiresExplicitApproval: true;
  riskLevel: "dangerous_manual_only";
};

export type LifecycleWarning = {
  warningId: string;
  warningCode:
    | "unsupported_final_source"
    | "final_source_not_ready"
    | "manual_resolution_parked";
  marketId: string;
  reason: string;
};

export type OracleLifecycleRunPhaseSummary = {
  objectType: string;
  [key: string]: unknown;
};

export type OracleLifecycleRunResult = {
  objectType: "oracle_lifecycle_run";
  runId: string;
  startedAt: string;
  completedAt: string;
  status: LifecycleRunStatus;
  dryRun: boolean;
  mutationMode: "execute_safe_actions" | "report_only";
  marketId: string | null;
  nextRecommendedRunAt: string;
  phases: {
    preflight: OracleLifecycleRunPhaseSummary;
    closeDueMarkets: HorizonCloseSweepResult;
    capability: {
      objectType: "oracle_lifecycle_capability_phase";
      checkedMarketCount: number;
      supportedCount: number;
      unsupportedCount: number;
      incompleteCount: number;
      manualResolutionRequiredCount: number;
      blockedByContractCount: number;
      items: OracleLifecycleCapability[];
    };
    closeCondition: {
      objectType: "oracle_lifecycle_close_condition_phase";
      checkedMarketCount: number;
      satisfiedCount: number;
      createdCaseCount: number;
      dryRun: boolean;
      items: CloseConditionItem[];
    };
    closeProvenance: {
      objectType: "oracle_close_provenance_phase";
      checkedMarketCount: number;
      confirmedCount: number;
      missingCount: number;
      invalidCount: number;
      items: CloseProvenanceItem[];
    };
    sourceSnapshots: SourceSnapshotCapturePhase;
    evidenceIntake: {
      objectType: "oracle_lifecycle_evidence_intake_phase";
      eligibleMarketCount: number;
      skippedForMissingProvenanceCount: number;
      dryRun: boolean;
      results: OracleOfficialFinalIntakeResult[];
      credibleReportingResults: CredibleReportingEvaluationResult[];
    };
    eventUpdates: SourceLagEventUpdateResult;
    inbox: OracleResolveInboxResult;
  };
  actions: LifecycleNextAction[];
  blockers: LifecycleBlocker[];
  warnings: LifecycleWarning[];
  receipts: Array<{
    receiptType: string;
    marketId?: string;
    id?: string;
    summary: string;
  }>;
};
