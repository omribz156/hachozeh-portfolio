import type { Pool } from "pg";

import {
  runOracleLifecycleRun,
  type OracleLifecycleRunResult,
  type RunOracleLifecycleOptions
} from "./lifecycle-run-service";
import {
  persistOracleRuntimeSnapshot,
  type OracleRuntimeSnapshotSummary
} from "./runtime-snapshot-service";
import {
  createOracleOperatorReminderNotifierFromEnv,
  sendOracleOperatorReminders,
  shouldRunOracleOperatorReminders,
  type OracleOperatorReminderNotifier,
  type OracleOperatorReminderResult
} from "./operator-reminder-service";

type RunLifecycleRun = (
  dbPool: Pool,
  options?: RunOracleLifecycleOptions
) => Promise<OracleLifecycleRunResult>;

export type OracleLifecycleHeartbeatTick = {
  objectType: "oracle_lifecycle_heartbeat_tick";
  tickNumber: number;
  lifecycleRunId: string;
  status: OracleLifecycleRunResult["status"];
  startedAt: string;
  completedAt: string;
  safeAutoActionCount: number;
  unsafeActionCount: number;
  blockerCount: number;
  warningCount: number;
  receiptCount: number;
  operatorReminderSentCount?: number;
  operatorReminderFailedCount?: number;
  nextRecommendedRunAt: string;
  runtimeSnapshotId?: string;
};

export type OracleLifecycleHeartbeatTickEvent = {
  objectType: "oracle_lifecycle_heartbeat_tick_event";
  heartbeatStartedAt: string;
  tick: OracleLifecycleHeartbeatTick;
  lifecycleRun: OracleLifecycleRunResult;
};

export type OracleLifecycleHeartbeatResult = {
  objectType: "oracle_lifecycle_heartbeat";
  startedAt: string;
  completedAt: string;
  dryRun: boolean;
  requestedTickCount: number;
  completedTickCount: number;
  intervalMs: number;
  marketId: string | null;
  safeAutoActionCount: number;
  unsafeActionCount: number;
  blockerCount: number;
  warningCount: number;
  receiptCount: number;
  operatorReminderSentCount: number;
  operatorReminderFailedCount: number;
  runtimeSnapshotId?: string;
  recentRuntimeSnapshots?: OracleRuntimeSnapshotSummary[];
  ticks: OracleLifecycleHeartbeatTick[];
  recommendations: string[];
};

export type RunOracleLifecycleHeartbeatOptions = {
  marketId?: string;
  limit?: number;
  dryRun?: boolean;
  maxTicks?: number;
  intervalMs?: number;
  now?: Date;
  persistSnapshot?: boolean;
  runLifecycleRun?: RunLifecycleRun;
  sleep?: (ms: number) => Promise<void>;
  onTick?: (event: OracleLifecycleHeartbeatTickEvent) => void | Promise<void>;
  operatorRemindersEnabled?: boolean;
  operatorReminderNotifier?: OracleOperatorReminderNotifier | null;
  requireLock?: boolean;
};

function normalizeMaxTicks(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) {
    return 1;
  }

  return Math.min(Math.max(Math.trunc(value), 1), 288);
}

function normalizeIntervalMs(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) {
    return 300_000;
  }

  return Math.min(Math.max(Math.trunc(value), 0), 3_600_000);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toTick(
  tickNumber: number,
  lifecycleRun: OracleLifecycleRunResult,
  runtimeSnapshotId?: string,
  reminderResult?: OracleOperatorReminderResult
): OracleLifecycleHeartbeatTick {
  const safeAutoActionCount = lifecycleRun.actions.filter(
    (action) => action.safeToAutoExecute && action.actionType !== "run_lifecycle_again"
  ).length;
  const unsafeActionCount = lifecycleRun.actions.filter(
    (action) => !action.safeToAutoExecute && action.actionType !== "run_lifecycle_again"
  ).length;

  return {
    objectType: "oracle_lifecycle_heartbeat_tick",
    tickNumber,
    lifecycleRunId: lifecycleRun.runId,
    status: lifecycleRun.status,
    startedAt: lifecycleRun.startedAt,
    completedAt: lifecycleRun.completedAt,
    safeAutoActionCount,
    unsafeActionCount,
    blockerCount: lifecycleRun.blockers.length,
    warningCount: lifecycleRun.warnings.length,
    receiptCount: lifecycleRun.receipts.length,
    ...(reminderResult
      ? {
          operatorReminderSentCount: reminderResult.sentCount,
          operatorReminderFailedCount: reminderResult.failedCount
        }
      : {}),
    nextRecommendedRunAt: lifecycleRun.nextRecommendedRunAt,
    ...(runtimeSnapshotId ? { runtimeSnapshotId } : {})
  };
}

function countCreatedResolutionCases(lifecycleRun: OracleLifecycleRunResult): number {
  return lifecycleRun.phases.evidenceIntake.results.reduce((sum, result) => {
    const createdCaseCount = (result as { createdCaseCount?: unknown }).createdCaseCount;
    return sum + (typeof createdCaseCount === "number" ? createdCaseCount : 0);
  }, 0);
}

function buildWarningSummary(lifecycleRun: OracleLifecycleRunResult): {
  warningBreakdown: Record<string, number>;
  warningItems: Array<{
    warningCode: string;
    marketId: string;
    reason: string;
  }>;
} {
  const warningBreakdown: Record<string, number> = {};
  const warningItems = lifecycleRun.warnings.map((warning) => {
    warningBreakdown[warning.warningCode] = (warningBreakdown[warning.warningCode] ?? 0) + 1;

    return {
      warningCode: warning.warningCode,
      marketId: warning.marketId,
      reason: warning.reason
    };
  });

  return {
    warningBreakdown,
    warningItems
  };
}

function buildLifecycleSnapshotSummary(
  tickNumber: number,
  lifecycleRun: OracleLifecycleRunResult,
  tick: Omit<OracleLifecycleHeartbeatTick, "runtimeSnapshotId">
): Record<string, unknown> {
  const warningSummary = buildWarningSummary(lifecycleRun);

  return {
    tickNumber,
    lifecycleRunId: lifecycleRun.runId,
    status: lifecycleRun.status,
    dryRun: lifecycleRun.dryRun,
    marketId: lifecycleRun.marketId,
    startedAt: lifecycleRun.startedAt,
    completedAt: lifecycleRun.completedAt,
    closeCandidateCount: lifecycleRun.phases.closeDueMarkets.candidates.length,
    closeExecutionCount: lifecycleRun.phases.closeDueMarkets.executions.length,
    resolutionCaseCreatedCount: countCreatedResolutionCases(lifecycleRun),
    missingResolutionCaseCount: lifecycleRun.phases.inbox.missingCaseCount,
    recommendedResolutionCaseCount: lifecycleRun.phases.inbox.recommendedCaseCount,
    reviewNeededResolutionCaseCount: lifecycleRun.phases.inbox.reviewNeededCaseCount,
    safeAutoActionCount: tick.safeAutoActionCount,
    unsafeActionCount: tick.unsafeActionCount,
    blockerCount: tick.blockerCount,
    warningCount: tick.warningCount,
    warningBreakdown: warningSummary.warningBreakdown,
    warningItems: warningSummary.warningItems,
    receiptCount: tick.receiptCount,
    operatorReminderSentCount: tick.operatorReminderSentCount ?? 0,
    operatorReminderFailedCount: tick.operatorReminderFailedCount ?? 0,
    nextRecommendedRunAt: tick.nextRecommendedRunAt
  };
}

function resolveOperatorRemindersEnabled(options?: RunOracleLifecycleHeartbeatOptions): boolean {
  return options?.operatorRemindersEnabled ?? shouldRunOracleOperatorReminders();
}

async function persistLifecycleHeartbeatTickSnapshot(
  dbPool: Pool,
  tickNumber: number,
  lifecycleRun: OracleLifecycleRunResult,
  tick: Omit<OracleLifecycleHeartbeatTick, "runtimeSnapshotId">
): Promise<string> {
  const summarySnapshot = buildLifecycleSnapshotSummary(tickNumber, lifecycleRun, tick);

  return persistOracleRuntimeSnapshot(dbPool, {
    runtimeType: "lifecycle-heartbeat",
    marketStatusFilter: "all",
    generatedAt: lifecycleRun.completedAt,
    summarySnapshot,
    payloadSnapshot: {
      objectType: "oracle_lifecycle_heartbeat_tick_snapshot",
      summary: summarySnapshot,
      lifecycleRun
    }
  });
}

function buildRecommendations(result: Omit<OracleLifecycleHeartbeatResult, "recommendations">): string[] {
  const recommendations: string[] = [];

  if (result.unsafeActionCount > 0) {
    recommendations.push("Heartbeat found approval/manual actions. Do not auto-run them.");
  }

  if (result.blockerCount > 0) {
    recommendations.push("Heartbeat found lifecycle blockers. Operator or lane work is required before trusting silence.");
  }

  if (result.completedTickCount === 1) {
    recommendations.push("Single-tick heartbeat completed. Use oracle:lifecycle-worker, max ticks, or a deployment scheduler for continuous operation.");
  }

  return recommendations;
}

export async function runOracleLifecycleHeartbeat(
  dbPool: Pool,
  options?: RunOracleLifecycleHeartbeatOptions
): Promise<OracleLifecycleHeartbeatResult> {
  const startedAt = (options?.now ?? new Date()).toISOString();
  const runLifecycleRun = options?.runLifecycleRun ?? runOracleLifecycleRun;
  const sleep = options?.sleep ?? defaultSleep;
  const requestedTickCount = normalizeMaxTicks(options?.maxTicks);
  const intervalMs = normalizeIntervalMs(options?.intervalMs);
  const dryRun = options?.dryRun ?? false;
  const ticks: OracleLifecycleHeartbeatTick[] = [];
  const operatorReminderNotifier =
    options?.operatorReminderNotifier === undefined
      ? createOracleOperatorReminderNotifierFromEnv()
      : options.operatorReminderNotifier;

  for (let index = 0; index < requestedTickCount; index += 1) {
    const lifecycleRun = await runLifecycleRun(dbPool, {
      marketId: options?.marketId,
      limit: options?.limit,
      dryRun,
      now: options?.now
    });
    const reminderResult =
      !dryRun && resolveOperatorRemindersEnabled(options)
        ? await sendOracleOperatorReminders(dbPool, {
            lifecycleRun,
            notifier: operatorReminderNotifier,
            generatedAt: lifecycleRun.completedAt
          })
        : undefined;
    const baseTick = toTick(index + 1, lifecycleRun, undefined, reminderResult);
    const runtimeSnapshotId = options?.persistSnapshot
      ? await persistLifecycleHeartbeatTickSnapshot(dbPool, index + 1, lifecycleRun, baseTick)
      : undefined;
    const tick = runtimeSnapshotId
      ? toTick(index + 1, lifecycleRun, runtimeSnapshotId, reminderResult)
      : baseTick;
    ticks.push(tick);

    await options?.onTick?.({
      objectType: "oracle_lifecycle_heartbeat_tick_event",
      heartbeatStartedAt: startedAt,
      tick,
      lifecycleRun
    });

    if (index < requestedTickCount - 1 && intervalMs > 0) {
      await sleep(intervalMs);
    }
  }

  const baseResult: Omit<OracleLifecycleHeartbeatResult, "recommendations"> = {
    objectType: "oracle_lifecycle_heartbeat",
    startedAt,
    completedAt: new Date().toISOString(),
    dryRun,
    requestedTickCount,
    completedTickCount: ticks.length,
    intervalMs,
    marketId: options?.marketId ?? null,
    safeAutoActionCount: ticks.reduce((sum, tick) => sum + tick.safeAutoActionCount, 0),
    unsafeActionCount: ticks.reduce((sum, tick) => sum + tick.unsafeActionCount, 0),
    blockerCount: ticks.reduce((sum, tick) => sum + tick.blockerCount, 0),
    warningCount: ticks.reduce((sum, tick) => sum + tick.warningCount, 0),
    receiptCount: ticks.reduce((sum, tick) => sum + tick.receiptCount, 0),
    operatorReminderSentCount: ticks.reduce(
      (sum, tick) => sum + (tick.operatorReminderSentCount ?? 0),
      0
    ),
    operatorReminderFailedCount: ticks.reduce(
      (sum, tick) => sum + (tick.operatorReminderFailedCount ?? 0),
      0
    ),
    ticks
  };

  return {
    ...baseResult,
    recommendations: buildRecommendations(baseResult)
  };
}
