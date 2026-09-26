import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

import type { RequestActor } from "../../auth/actor-resolver";
import type { Queryable } from "../../db/client/pool";
import {
  dismissClosingSoonNotificationsForClosedMarkets,
  emitClosingSoonNotifications
} from "../../notifications/notification-feed-service";
import {
  buildCloseCandidate,
  inspectCloseCandidate
} from "./close-check";
import {
  closeMarket,
  type CloseMarketRequest,
  type CloseMarketResponse
} from "./close-market-service";
import type {
  HorizonCloseCandidate,
  HorizonCloseCheckResult,
  HorizonCloseExecutionResult,
  HorizonCloseTriggerType,
  HorizonLifecycleAlertItem,
  HorizonMarketLifecycle
} from "./contracts";
import {
  buildAlertFromCheck,
  buildAlertFromCloseError
} from "./close-sweep-alerts";
import {
  readDueOpenMarkets,
  readLifecycleConflicts,
  readMarketLifecycleById
} from "./close-sweep-read-model";

export type InspectMarketCloseInput = {
  marketId: string;
  evaluatedAt?: string;
  triggerType: HorizonCloseTriggerType;
  whyNow: string;
  actorId?: string;
  proposedBySubsystem?: string;
  approvalActorId?: string;
  triggerContextSummary?: string;
  sourceRef?: string;
  notes?: string;
};

export type MarketCloseInspection = {
  market: HorizonMarketLifecycle;
  candidate: HorizonCloseCandidate;
  check: HorizonCloseCheckResult;
  alert?: HorizonLifecycleAlertItem;
};

export type HorizonCloseSweepResult = {
  objectType: "horizon_close_sweep_result";
  evaluatedAt: string;
  dryRun: boolean;
  limit: number;
  candidates: HorizonCloseCandidate[];
  checks: HorizonCloseCheckResult[];
  executions: HorizonCloseExecutionResult[];
  alerts: HorizonLifecycleAlertItem[];
};

export const HORIZON_SYSTEM_ACTOR: RequestActor = {
  actorId: "system:horizon-scheduler",
  mode: "session",
  sessionId: null,
  role: "admin"
};

function readIsoTimestamp(value?: string): string {
  const timestamp = value ?? new Date().toISOString();
  const parsed = new Date(timestamp);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ISO timestamp: ${timestamp}`);
  }

  return parsed.toISOString();
}

function buildCloseRequest(
  inspection: MarketCloseInspection
): CloseMarketRequest {
  return {
    triggerType: inspection.candidate.triggerType,
    reason: inspection.candidate.whyNow,
    sourceUrl: inspection.candidate.sourceRef ?? null,
    note: inspection.candidate.triggerContextSummary ?? inspection.check.decisionSummary,
    oracleCaseId: null,
    triggeredByOracleId:
      inspection.candidate.proposedBySubsystem === "oracle"
        ? inspection.candidate.proposedBySubsystem
        : null,
    approvedByHumanId: inspection.candidate.approvalActorId ?? null,
    idempotencyKey: `close:${inspection.market.marketId}:scheduled:${inspection.market.closeAt}`,
    requestedAt: inspection.candidate.evaluatedAt
  };
}

function toExecutionResult(input: {
  inspection: MarketCloseInspection;
  response: CloseMarketResponse;
  actor: RequestActor;
}): HorizonCloseExecutionResult {
  return {
    objectType: "close_execution_result",
    closeExecutionResultId: `clr_${randomUUID()}`,
    marketId: input.response.marketId,
    previousStatus: "open",
    resultingStatus: "closed",
    triggerType: input.response.triggerType,
    executed: true,
    auditEventId: input.response.auditEventId,
    idempotencyScope: "close_market",
    idempotencyKey: buildCloseRequest(input.inspection).idempotencyKey,
    executedAt: input.response.closedAt,
    closedAt: input.response.closedAt,
    actorId: input.actor.actorId,
    proposedBySubsystem: input.inspection.candidate.proposedBySubsystem,
    approvalActorId: input.inspection.candidate.approvalActorId,
    notes: input.inspection.candidate.whyNow
  };
}

export async function inspectMarketClose(
  db: Queryable,
  input: InspectMarketCloseInput
): Promise<MarketCloseInspection> {
  const evaluatedAt = readIsoTimestamp(input.evaluatedAt);
  const market = await readMarketLifecycleById(db, input.marketId);

  if (!market) {
    throw new Error(`Market not found: ${input.marketId}`);
  }

  const candidate = buildCloseCandidate({
    closeCandidateId: `cc_${randomUUID()}`,
    evaluatedAt,
    triggerType: input.triggerType,
    market,
    whyNow: input.whyNow,
    actorId: input.actorId,
    proposedBySubsystem: input.proposedBySubsystem,
    approvalActorId: input.approvalActorId,
    triggerContextSummary: input.triggerContextSummary,
    sourceRef: input.sourceRef
  });

  const check = inspectCloseCandidate({
    closeCheckResultId: `chk_${randomUUID()}`,
    checkedAt: evaluatedAt,
    candidate,
    market,
    notes: input.notes
  });

  const inspection = {
    market,
    candidate,
    check
  } satisfies MarketCloseInspection;

  return {
    ...inspection,
    alert: buildAlertFromCheck(inspection)
  };
}

export async function runHorizonCloseSweep(
  dbPool: Pool,
  options?: {
    evaluatedAt?: string;
    dryRun?: boolean;
    actor?: RequestActor;
    limit?: number;
    marketId?: string;
  }
): Promise<HorizonCloseSweepResult> {
  const evaluatedAt = readIsoTimestamp(options?.evaluatedAt);
  const dryRun = options?.dryRun ?? false;
  const actor = options?.actor ?? HORIZON_SYSTEM_ACTOR;
  const limit = options?.limit ?? 50;
  const dueMarkets = await readDueOpenMarkets(dbPool, evaluatedAt, limit, options?.marketId);
  const candidates: HorizonCloseCandidate[] = [];
  const checks: HorizonCloseCheckResult[] = [];
  const executions: HorizonCloseExecutionResult[] = [];
  const alerts: HorizonLifecycleAlertItem[] = [];

  for (const market of dueMarkets) {
    const inspection = await inspectMarketClose(dbPool, {
      marketId: market.marketId,
      evaluatedAt,
      triggerType: "scheduled_time",
      whyNow: "Routine scheduled close sweep.",
      actorId: actor.actorId,
      notes: "Routine scheduled close sweep."
    });

    candidates.push(inspection.candidate);
    checks.push(inspection.check);

    if (inspection.alert) {
      alerts.push(inspection.alert);
      continue;
    }

    if (dryRun) {
      continue;
    }

    try {
      const response = await closeMarket(
        dbPool,
        inspection.market.marketId,
        buildCloseRequest(inspection),
        actor
      );

      executions.push(
        toExecutionResult({
          inspection,
          response,
          actor
        })
      );
    } catch (error) {
      alerts.push(
        buildAlertFromCloseError({
          inspection,
          error,
          detectedAt: evaluatedAt
        })
      );
    }
  }

  alerts.push(...(await readLifecycleConflicts(dbPool, evaluatedAt, options?.marketId)));

  // "Closing soon" heads-up to every holder of a market within 2h of close.
  // Lives in the shared sweep so it fires from whichever loop drives closes
  // (the live lifecycle-heartbeat worker, the standalone scheduler, or the CLI).
  // Best-effort + dedup-guarded — a failure here must never block the close
  // sweep, and it's skipped on dry-run.
  if (!dryRun) {
    try {
      await dismissClosingSoonNotificationsForClosedMarkets(dbPool, {
        evaluatedAt: new Date(evaluatedAt)
      });
      await emitClosingSoonNotifications(dbPool, {
        evaluatedAt: new Date(evaluatedAt),
        windowMs: 2 * 60 * 60 * 1000
      });
    } catch {
      // non-critical; closes still execute
    }
  }

  return {
    objectType: "horizon_close_sweep_result",
    evaluatedAt,
    dryRun,
    limit,
    candidates,
    checks,
    executions,
    alerts
  };
}

export async function readHorizonAlerts(
  dbPool: Pool,
  options?: {
    evaluatedAt?: string;
  }
): Promise<HorizonLifecycleAlertItem[]> {
  const result = await runHorizonCloseSweep(dbPool, {
    evaluatedAt: options?.evaluatedAt,
    dryRun: true
  });

  return result.alerts;
}
