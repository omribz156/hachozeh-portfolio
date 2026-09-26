import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

import {
  HORIZON_SYSTEM_ACTOR,
  runHorizonCloseSweep
} from "../../back/src/platform-surface/oracle";
import {
  runOracleOfficialFinalIntake,
  type OracleOfficialFinalIntakeResult
} from "./official-final-intake-service";
import {
  upsertSourceLagEventUpdates
} from "./market-event-update-service";
import {
  readOracleResolveInbox
} from "./resolve-inbox-service";
import {
  classifyOracleLifecycleSupport
} from "./source-adapter-registry";
import {
  evaluateCredibleReportingEvidence,
  type CredibleReportingEvaluationResult
} from "./credible-reporting-evaluator-service";
import {
  inspectOpenMarketCloseConditions
} from "./lifecycle-run-close-conditions";
import { extractTradingViewFxSpec } from "./adapters/tradingview-fx-source-adapter";
import type { OracleLifecycleSourceContext } from "./source-adapter-contracts";
import {
  buildCapabilityContext,
  readCapabilityMarkets,
  readCapabilityOutcomes,
  readCloseAuditsByMarketId,
  readClosedMarkets,
  readClosedMarketsByIds
} from "./lifecycle-run-read-model";
import {
  mapCloseProvenanceItem
} from "./lifecycle-run-provenance";
import {
  buildCapabilityBlockers,
  buildLifecycleActions,
  buildMissingProvenanceBlocker,
  buildResolutionIntakeFailedBlocker,
  buildWarningFromIntakeItem,
  deriveStatus
} from "./lifecycle-run-actions";
import type {
  LifecycleWarning,
  OracleLifecycleRunResult,
  SourceSnapshotCapturePhase
} from "./lifecycle-run-types";
import { normalizeOracleLimit } from "./oracle-options";
import {
  captureTradingViewFxSnapshot,
  readTradingViewFxSnapshot
} from "./tradingview-fx-snapshot-service";

export type { OracleLifecycleRunResult } from "./lifecycle-run-types";

export type RunOracleLifecycleOptions = {
  marketId?: string;
  limit?: number;
  dryRun?: boolean;
  now?: Date;
  fetchJson?: (url: string) => Promise<unknown>;
  fetchText?: (url: string) => Promise<string>;
  closeSweep?: typeof runHorizonCloseSweep;
  officialFinalIntake?: typeof runOracleOfficialFinalIntake;
  credibleReportingEvaluate?: typeof evaluateCredibleReportingEvidence;
  captureFxSnapshot?: typeof captureTradingViewFxSnapshot;
  fetchTradingViewScannerJson?: (url: string, body: unknown) => Promise<unknown>;
  closeMarket?: Parameters<typeof inspectOpenMarketCloseConditions>[1]["closeMarket"];
  resolveInbox?: typeof readOracleResolveInbox;
  recordEventUpdates?: typeof upsertSourceLagEventUpdates;
};

function addMinutes(value: Date, minutes: number): string {
  return new Date(value.getTime() + minutes * 60_000).toISOString();
}

function readTimelineNumber(context: OracleLifecycleSourceContext, key: string): number | null {
  const value = context.marketContract?.timeline?.[key];
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;

  return Number.isFinite(parsed) ? parsed : null;
}

function isTradingViewWindowObservationEnabled(context: OracleLifecycleSourceContext): boolean {
  return (
    context.marketContract?.timeline?.fxObservationMode === "window" ||
    Boolean(context.marketContract?.machineResolutionEndpoint?.includes("&from=")) ||
    Boolean(context.marketContract?.machineResolutionEndpoint?.includes("?from="))
  );
}

function readTradingViewWindowCadenceMinutes(context: OracleLifecycleSourceContext): number {
  const configured = readTimelineNumber(context, "fxObservationCadenceMinutes");
  return configured == null ? 60 : Math.max(5, Math.floor(configured));
}

function shouldCaptureTradingViewWindowSnapshot(
  context: OracleLifecycleSourceContext,
  now: Date
): boolean {
  if (context.marketStatus !== "open" || !isTradingViewWindowObservationEnabled(context)) {
    return false;
  }

  const spec = extractTradingViewFxSpec(context);

  if (!spec) {
    return false;
  }

  const nowMs = now.getTime();
  const fromMs = spec.windowFrom ? Date.parse(spec.windowFrom) : -Infinity;
  const toMs = spec.windowTo ? Date.parse(spec.windowTo) : Date.parse(spec.closeAt);

  return Number.isFinite(nowMs) && nowMs >= fromMs && nowMs <= toMs;
}

export async function runOracleLifecycleRun(
  dbPool: Pool,
  options?: RunOracleLifecycleOptions
): Promise<OracleLifecycleRunResult> {
  const startedAtDate = options?.now ?? new Date();
  const startedAt = startedAtDate.toISOString();
  const runId = `olr_${randomUUID()}`;
  const limit = normalizeOracleLimit(options?.limit);
  const dryRun = options?.dryRun ?? false;
  const closeSweep = options?.closeSweep ?? runHorizonCloseSweep;
  const officialFinalIntake =
    options?.officialFinalIntake ?? runOracleOfficialFinalIntake;
  const credibleReportingEvaluate =
    options?.credibleReportingEvaluate ?? evaluateCredibleReportingEvidence;
  const captureFxSnapshot =
    options?.captureFxSnapshot ?? captureTradingViewFxSnapshot;
  const resolveInbox = options?.resolveInbox ?? readOracleResolveInbox;
  const recordEventUpdates =
    options?.recordEventUpdates ?? upsertSourceLagEventUpdates;

  const closeDueMarkets = await closeSweep(dbPool, {
    evaluatedAt: startedAt,
    dryRun,
    actor: HORIZON_SYSTEM_ACTOR,
    limit,
    marketId: options?.marketId
  });
  const capabilityMarkets = await readCapabilityMarkets(dbPool, {
    marketId: options?.marketId,
    limit
  });
  const capabilityOutcomes = await readCapabilityOutcomes(
    dbPool,
    capabilityMarkets.map((market) => market.id)
  );
  const capabilityContexts = capabilityMarkets.map((market) =>
    buildCapabilityContext(market, capabilityOutcomes.get(market.id) ?? [])
  );
  const capabilityContextByMarketId = new Map(
    capabilityContexts.map((context) => [context.marketId, context])
  );
  const capabilityItems = capabilityContexts.map((context) =>
    classifyOracleLifecycleSupport(context)
  );
  const closeConditionItems = await inspectOpenMarketCloseConditions(dbPool, {
    contexts: capabilityContexts,
    dryRun,
    now: startedAtDate,
    fetchJson: options?.fetchJson,
    fetchText: options?.fetchText,
    closeMarket: options?.closeMarket
  });
  const inbox = await resolveInbox(dbPool, {
    marketId: options?.marketId,
    limit
  });
  const initialClosedMarkets = await readClosedMarkets(dbPool, {
    marketId: options?.marketId,
    limit
  });
  const initialClosedMarketIds = new Set(initialClosedMarkets.map((market) => market.id));
  const inboxMarketIds = [
    ...inbox.missingCases.map((item) => item.marketId),
    ...inbox.recommendedCases.map((item) => item.marketId),
    ...inbox.reviewNeededCases.map((item) => item.marketId)
  ];
  const extraClosedMarkets = await readClosedMarketsByIds(
    dbPool,
    [...new Set(inboxMarketIds)].filter((marketId) => !initialClosedMarketIds.has(marketId))
  );
  const closedMarkets = [...initialClosedMarkets, ...extraClosedMarkets];
  const closeAudits = await readCloseAuditsByMarketId(
    dbPool,
    closedMarkets.map((market) => market.id)
  );
  const closeProvenanceItems = closedMarkets.map((market) =>
    mapCloseProvenanceItem(market, closeAudits.get(market.id))
  );
  const blockedProvenanceItems = closeProvenanceItems.filter(
    (item) => item.provenanceStatus === "missing" || item.provenanceStatus === "invalid"
  );
  const blockers = [
    ...capabilityItems.flatMap((item) =>
      buildCapabilityBlockers(
        item,
        capabilityContextByMarketId.get(item.marketId),
        startedAtDate
      )
    ),
    ...blockedProvenanceItems.map(buildMissingProvenanceBlocker)
  ];
  const blockedMarketIds = new Set([
    ...blockedProvenanceItems.map((item) => item.marketId),
    ...blockers.map((blocker) => blocker.marketId)
  ]);
  const provenanceCleanClosedMarketIds = new Set(
    closeProvenanceItems
      .filter(
        (item) =>
          item.provenanceStatus === "confirmed" &&
          item.marketStatus === "closed"
      )
      .map((item) => item.marketId)
  );
  const eligibleResolutionMarketIds = closedMarkets
    .filter(
      (market) =>
        market.status === "closed" &&
        !market.resolved_at &&
        provenanceCleanClosedMarketIds.has(market.id)
    )
    .map((market) => market.id);
  const intakeResults: OracleOfficialFinalIntakeResult[] = [];
  const credibleReportingResults: CredibleReportingEvaluationResult[] = [];
  const sourceSnapshots: SourceSnapshotCapturePhase = {
    objectType: "oracle_source_snapshot_capture_phase",
    checkedMarketCount: 0,
    capturedCount: 0,
    skippedExistingCount: 0,
    dryRun,
    items: []
  };

  for (const context of capabilityContexts) {
    if (!shouldCaptureTradingViewWindowSnapshot(context, startedAtDate)) {
      continue;
    }

    const spec = extractTradingViewFxSpec(context);

    if (!spec || !context.marketContract?.resolutionSource?.sourceIds?.includes("src_tradingview_fx")) {
      continue;
    }

    sourceSnapshots.checkedMarketCount += 1;

    const latestSnapshot = await readTradingViewFxSnapshot(dbPool, {
      marketId: context.marketId,
      symbol: spec.symbol
    });
    const cadenceMs = readTradingViewWindowCadenceMinutes(context) * 60_000;
    const latestObservedAtMs = latestSnapshot?.observedAt ? Date.parse(latestSnapshot.observedAt) : NaN;

    if (Number.isFinite(latestObservedAtMs) && startedAtDate.getTime() - latestObservedAtMs < cadenceMs) {
      sourceSnapshots.skippedExistingCount += 1;
      sourceSnapshots.items.push({
        objectType: "oracle_source_snapshot_capture_item",
        marketId: context.marketId,
        sourceFamily: "tradingview_fx",
        action: "skipped_existing",
        symbol: spec.symbol,
        observedAt: latestSnapshot?.observedAt,
        machineResolutionEndpoint: spec.machineResolutionEndpoint,
        reason: "TradingView FX window snapshot is already fresh for this market cadence."
      });
      continue;
    }

    if (dryRun) {
      sourceSnapshots.items.push({
        objectType: "oracle_source_snapshot_capture_item",
        marketId: context.marketId,
        sourceFamily: "tradingview_fx",
        action: "would_capture",
        symbol: spec.symbol,
        observedAt: startedAt,
        machineResolutionEndpoint: spec.machineResolutionEndpoint,
        reason: "Open TradingView FX window market needs a timestamped observation for crossing evaluation."
      });
      continue;
    }

    try {
      const capture = await captureFxSnapshot(dbPool, {
        marketId: context.marketId,
        symbol: spec.symbol,
        observedAt: startedAtDate,
        now: startedAtDate,
        idempotencyKey: `${context.marketId}:${spec.symbol}:window:${startedAt}`,
        fetchScannerJson: options?.fetchTradingViewScannerJson
      });
      sourceSnapshots.capturedCount += capture.deduped ? 0 : 1;
      sourceSnapshots.skippedExistingCount += capture.deduped ? 1 : 0;
      sourceSnapshots.items.push({
        objectType: "oracle_source_snapshot_capture_item",
        marketId: context.marketId,
        sourceFamily: "tradingview_fx",
        action: capture.deduped ? "skipped_existing" : "captured",
        symbol: spec.symbol,
        observedAt: capture.snapshot.observedAt,
        lifecycleEventId: capture.lifecycleEventId,
        machineResolutionEndpoint: capture.machineResolutionEndpoint,
        reason: capture.deduped
          ? "TradingView FX window snapshot was already captured by an idempotent lifecycle event."
          : "Captured TradingView FX window observation for crossing evaluation."
      });
    } catch (error) {
      blockers.push(buildResolutionIntakeFailedBlocker(context.marketId, error));
      blockedMarketIds.add(context.marketId);
    }
  }

  for (const marketId of eligibleResolutionMarketIds) {
    const context = capabilityContextByMarketId.get(marketId);

    if (context?.marketContract?.oracleCapability === "credible_reporting") {
      continue;
    }

    const spec = context ? extractTradingViewFxSpec(context) : null;

    if (!spec || !context?.marketContract?.resolutionSource?.sourceIds?.includes("src_tradingview_fx")) {
      continue;
    }

    sourceSnapshots.checkedMarketCount += 1;

    const existingSnapshot = await readTradingViewFxSnapshot(dbPool, {
      marketId,
      symbol: spec.symbol,
      at: spec.closeAt
    });

    if (existingSnapshot) {
      sourceSnapshots.skippedExistingCount += 1;
      sourceSnapshots.items.push({
        objectType: "oracle_source_snapshot_capture_item",
        marketId,
        sourceFamily: "tradingview_fx",
        action: "skipped_existing",
        symbol: spec.symbol,
        observedAt: existingSnapshot.observedAt,
        machineResolutionEndpoint: spec.machineResolutionEndpoint,
        reason: "TradingView FX snapshot already exists for the market close timestamp."
      });
      continue;
    }

    if (dryRun) {
      sourceSnapshots.items.push({
        objectType: "oracle_source_snapshot_capture_item",
        marketId,
        sourceFamily: "tradingview_fx",
        action: "would_capture",
        symbol: spec.symbol,
        observedAt: spec.closeAt,
        machineResolutionEndpoint: spec.machineResolutionEndpoint,
        reason: "Closed TradingView FX market needs a close-time snapshot before resolution intake."
      });
      continue;
    }

    try {
      const capture = await captureFxSnapshot(dbPool, {
        marketId,
        symbol: spec.symbol,
        observedAt: new Date(spec.closeAt),
        now: startedAtDate,
        idempotencyKey: `${marketId}:${spec.symbol}:${spec.closeAt}`,
        fetchScannerJson: options?.fetchTradingViewScannerJson
      });
      sourceSnapshots.capturedCount += capture.deduped ? 0 : 1;
      sourceSnapshots.skippedExistingCount += capture.deduped ? 1 : 0;
      sourceSnapshots.items.push({
        objectType: "oracle_source_snapshot_capture_item",
        marketId,
        sourceFamily: "tradingview_fx",
        action: capture.deduped ? "skipped_existing" : "captured",
        symbol: spec.symbol,
        observedAt: capture.snapshot.observedAt,
        lifecycleEventId: capture.lifecycleEventId,
        machineResolutionEndpoint: capture.machineResolutionEndpoint,
        reason: capture.deduped
          ? "TradingView FX snapshot was already captured by an idempotent lifecycle event."
          : "Captured TradingView FX snapshot at the market close timestamp."
      });
    } catch (error) {
      blockers.push(buildResolutionIntakeFailedBlocker(marketId, error));
      blockedMarketIds.add(marketId);
    }
  }

  if (!dryRun) {
    for (const marketId of eligibleResolutionMarketIds) {
      const context = capabilityContextByMarketId.get(marketId);

      if (blockedMarketIds.has(marketId)) {
        continue;
      }

      try {
        if (context?.marketContract?.oracleCapability === "credible_reporting") {
          credibleReportingResults.push(
            await credibleReportingEvaluate(dbPool, {
              marketId,
              now: startedAtDate
            })
          );
        } else {
          intakeResults.push(
            await officialFinalIntake(dbPool, {
              marketId,
              limit: 1,
              now: startedAtDate,
              fetchJson: options?.fetchJson,
              fetchText: options?.fetchText
            })
          );
        }
      } catch (error) {
        blockers.push(buildResolutionIntakeFailedBlocker(marketId, error));
      }
    }
  }

  const eventUpdates = dryRun
    ? {
        objectType: "source_lag_event_update_result" as const,
        generatedAt: startedAt,
        upsertedCount: 0,
        skippedCount: 0,
        items: []
      }
    : await recordEventUpdates(dbPool, {
        intakeResults,
        contextsByMarketId: capabilityContextByMarketId,
        now: startedAtDate
      });
  const finalInbox = dryRun
    ? inbox
    : await resolveInbox(dbPool, {
        marketId: options?.marketId,
        limit
      });
  const intakeWarnings = intakeResults.flatMap((result) =>
    result.items
      .map(buildWarningFromIntakeItem)
      .filter((item): item is LifecycleWarning => Boolean(item))
  );
  const sourceLagMarketIds = new Set(
    intakeResults.flatMap((result) =>
      result.items
        .filter((item) => item.action === "skipped_not_final")
        .map((item) => item.marketId)
    )
  );
  const warnings = [...intakeWarnings];
  const actions = buildLifecycleActions({
    closeConditionItems,
    credibleReportingResults,
    finalInbox,
    blockedMarketIds,
    sourceLagMarketIds
  });
  const receipts = [
    ...closeDueMarkets.executions.map((execution) => ({
      receiptType: "market_closed",
      marketId: execution.marketId,
      id: execution.auditEventId,
      summary: `Market closed by ${execution.triggerType}.`
    })),
    ...intakeResults.flatMap((result) =>
      result.items
        .filter((item) => item.action === "created_case")
        .map((item) => ({
          receiptType: "resolution_case_created",
          marketId: item.marketId,
          id: item.oracleCaseId,
          summary: item.reason
        }))
    ),
    ...sourceSnapshots.items
      .filter((item) => item.action === "captured")
      .map((item) => ({
        receiptType: "source_snapshot_captured",
        marketId: item.marketId,
        id: item.lifecycleEventId ?? undefined,
        summary: item.reason
      })),
    ...eventUpdates.items.map((item) => ({
      receiptType: "market_event_update",
      marketId: item.marketId,
      id: item.id ?? undefined,
      summary: item.summary
    })),
    ...closeConditionItems
      .filter((item) => item.action === "closed_market")
      .map((item) => ({
        receiptType: "market_closed",
        marketId: item.marketId,
        id: item.close?.auditEventId,
        summary: item.reason
      })),
    ...closeConditionItems
      .filter((item) => item.action === "skipped_close_failed")
      .map((item) => ({
        receiptType: "market_close_failed",
        marketId: item.marketId,
        summary: item.reason
    }))
  ];
  const completedAt = new Date().toISOString();
  const status = deriveStatus({
    blockers,
    warnings,
    actions: actions.filter((action) => action.actionType !== "run_lifecycle_again"),
    closeSweep: closeDueMarkets,
    intakeResults
  });

  return {
    objectType: "oracle_lifecycle_run",
    runId,
    startedAt,
    completedAt,
    status,
    dryRun,
    mutationMode: dryRun ? "report_only" : "execute_safe_actions",
    marketId: options?.marketId ?? null,
    nextRecommendedRunAt: addMinutes(startedAtDate, status === "blocked" ? 2 : 5),
    phases: {
      preflight: {
        objectType: "oracle_lifecycle_preflight_phase",
        oracleRuntime: "ok",
        seerRuntime: "not_required",
        checkedAt: startedAt
      },
      closeDueMarkets,
      capability: {
        objectType: "oracle_lifecycle_capability_phase",
        checkedMarketCount: capabilityItems.length,
        supportedCount: capabilityItems.filter((item) =>
          item.classification.startsWith("supported")
        ).length,
        unsupportedCount: capabilityItems.filter(
          (item) => item.classification === "unsupported_source_family"
        ).length,
        incompleteCount: capabilityItems.filter(
          (item) => item.classification === "contract_incomplete"
        ).length,
        manualResolutionRequiredCount: capabilityItems.filter(
          (item) => item.classification === "manual_resolution_required"
        ).length,
        blockedByContractCount: capabilityItems.filter(
          (item) => item.classification === "blocked_by_contract"
        ).length,
        items: capabilityItems
      },
      closeCondition: {
        objectType: "oracle_lifecycle_close_condition_phase",
        checkedMarketCount: closeConditionItems.length,
        satisfiedCount: closeConditionItems.filter((item) => item.closeConditionSatisfied).length,
        createdCaseCount: closeConditionItems.filter((item) => item.action === "created_case").length,
        dryRun,
        items: closeConditionItems
      },
      closeProvenance: {
        objectType: "oracle_close_provenance_phase",
        checkedMarketCount: closeProvenanceItems.length,
        confirmedCount: closeProvenanceItems.filter(
          (item) => item.provenanceStatus === "confirmed"
        ).length,
        missingCount: closeProvenanceItems.filter(
          (item) => item.provenanceStatus === "missing"
        ).length,
        invalidCount: closeProvenanceItems.filter(
          (item) => item.provenanceStatus === "invalid"
        ).length,
        items: closeProvenanceItems
      },
      sourceSnapshots,
      evidenceIntake: {
        objectType: "oracle_lifecycle_evidence_intake_phase",
        eligibleMarketCount: eligibleResolutionMarketIds.length,
        skippedForMissingProvenanceCount: blockedProvenanceItems.length,
        dryRun,
        results: intakeResults,
        credibleReportingResults
      },
      eventUpdates,
      inbox: finalInbox
    },
    actions,
    blockers,
    warnings,
    receipts
  };
}
