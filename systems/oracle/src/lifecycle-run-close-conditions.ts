import type { Pool } from "pg";

import {
  closeMarket,
  HORIZON_SYSTEM_ACTOR,
  type CloseMarketResponse,
  type RequestActor
} from "../../back/src/platform-surface/oracle";
import type {
  OracleLifecycleSourceContext,
  OracleSourceInspection
} from "./source-adapter-contracts";
import { inspectOracleMarket } from "./inspect-market-service";
import { findOracleLifecycleSourceAdapter } from "./source-adapter-registry";

export type CloseConditionItem = {
  objectType: "oracle_lifecycle_close_condition_item";
  marketId: string;
  marketTitle: string;
  sourceFamily: string | null;
  sourceUrl: string | null;
  status: string | null;
  closeConditionSatisfied: boolean;
  action:
    | "skipped_not_supported"
    | "skipped_not_satisfied"
    | "skipped_fetch_failed"
    | "skipped_close_failed"
    | "would_close_market"
    | "would_create_case"
    | "closed_market"
    | "created_case";
  close?: CloseMarketResponse;
  oracleCaseId?: string;
  reason: string;
};

type CloseMarketFn = typeof closeMarket;

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readPath(value: unknown, path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    const object = readObject(current);
    if (!object) {
      return undefined;
    }
    current = object[key];
  }
  return current;
}

function isTerminalEvidenceAutoCloseEligible(
  context: OracleLifecycleSourceContext,
  inspection: OracleSourceInspection
): boolean {
  if (
    context.eventCompletionCloseRequiresHumanApproval ||
    inspection.status !== "final" ||
    inspection.resolutionAvailable !== true
  ) {
    return false;
  }

  const contract = context.marketContract as unknown;
  const operationalEarlyElimination = readPath(contract, ["operational", "earlyEliminationClose"]) === true;
  const explicitTerminalClose = readPath(contract, ["operational", "terminalEvidenceAutoClose"]) === true;
  const acceptsEliminationFact =
    readPath(contract, ["dependencyResolution", "acceptFact"]) === "entity_eliminated";

  return operationalEarlyElimination || explicitTerminalClose || acceptsEliminationFact;
}

export async function inspectOpenMarketCloseConditions(
  dbPool: Pool,
  input: {
    contexts: OracleLifecycleSourceContext[];
    dryRun: boolean;
    now: Date;
    fetchJson?: (url: string) => Promise<unknown>;
    fetchText?: (url: string) => Promise<string>;
    closeMarket?: CloseMarketFn;
    closeActor?: RequestActor;
  }
): Promise<CloseConditionItem[]> {
  const items: CloseConditionItem[] = [];
  const executeCloseMarket = input.closeMarket ?? closeMarket;
  const closeActor = input.closeActor ?? HORIZON_SYSTEM_ACTOR;

  for (const context of input.contexts) {
    if (context.marketStatus !== "open" || !context.closeOnEventCompletion) {
      continue;
    }

    if (
      context.marketContract?.oracleCapability === "blocked" ||
      context.marketContract?.oracleCapability === "manual_resolution_required"
    ) {
      items.push({
        objectType: "oracle_lifecycle_close_condition_item",
        marketId: context.marketId,
        marketTitle: context.marketTitle,
        sourceFamily: null,
        sourceUrl: context.resolutionSource || context.marketContract.resolutionSource?.url || null,
        status: null,
        closeConditionSatisfied: false,
        action: "skipped_not_supported",
        reason: `market_contract oracleCapability=${context.marketContract.oracleCapability}; close-condition automation is not enabled.`
      });
      continue;
    }

    const adapter = findOracleLifecycleSourceAdapter(context);

    if (!adapter || !adapter.capabilities.closeCondition) {
      items.push({
        objectType: "oracle_lifecycle_close_condition_item",
        marketId: context.marketId,
        marketTitle: context.marketTitle,
        sourceFamily: null,
        sourceUrl: null,
        status: null,
        closeConditionSatisfied: false,
        action: "skipped_not_supported",
        reason: "No source adapter supports event-completion close for this market."
      });
      continue;
    }

    let inspection: OracleSourceInspection;

    try {
      inspection = await adapter.inspectCloseCondition(context, {
        fetchJson: input.fetchJson,
        fetchText: input.fetchText,
        now: input.now
      });
    } catch (error) {
      items.push({
        objectType: "oracle_lifecycle_close_condition_item",
        marketId: context.marketId,
        marketTitle: context.marketTitle,
        sourceFamily: adapter.sourceFamily,
        sourceUrl: context.resolutionSource,
        status: null,
        closeConditionSatisfied: false,
        action: "skipped_fetch_failed",
        reason: error instanceof Error ? error.message : String(error)
      });
      continue;
    }

    if (!inspection.closeConditionSatisfied) {
      items.push({
        objectType: "oracle_lifecycle_close_condition_item",
        marketId: context.marketId,
        marketTitle: context.marketTitle,
        sourceFamily: adapter.sourceFamily,
        sourceUrl: inspection.sourceUrl,
        status: inspection.status,
        closeConditionSatisfied: false,
        action: "skipped_not_satisfied",
        reason: inspection.claimSummary
      });
      continue;
    }

    if (input.dryRun) {
      items.push({
        objectType: "oracle_lifecycle_close_condition_item",
        marketId: context.marketId,
        marketTitle: context.marketTitle,
        sourceFamily: adapter.sourceFamily,
        sourceUrl: inspection.sourceUrl,
        status: inspection.status,
        closeConditionSatisfied: true,
        action: isTerminalEvidenceAutoCloseEligible(context, inspection)
          ? "would_close_market"
          : "would_create_case",
        reason: isTerminalEvidenceAutoCloseEligible(context, inspection)
          ? `${inspection.claimSummary} Terminal official evidence can close trading without payout approval.`
          : inspection.claimSummary
      });
      continue;
    }

    if (isTerminalEvidenceAutoCloseEligible(context, inspection)) {
      try {
        const close = await executeCloseMarket(
          dbPool,
          context.marketId,
          {
            triggerType: "oracle_confirmed_event_completion",
            reason: "Official terminal evidence is available; closing trading before human-gated resolution.",
            sourceUrl: inspection.sourceUrl,
            note: JSON.stringify({
              sourceFamily: adapter.sourceFamily,
              officialJsonUrl: inspection.officialJsonUrl ?? null,
              sourceStatus: inspection.status,
              evidenceKey: inspection.evidenceKey ?? null,
              winnerLabel: inspection.winnerLabel ?? null,
              rawHash: inspection.rawHash,
              claimSummary: inspection.claimSummary
            }),
            oracleCaseId: null,
            triggeredByOracleId: "oracle",
            approvedByHumanId: null,
            idempotencyKey: `oracle-terminal-evidence-close:${context.marketId}:${inspection.rawHash}`,
            requestedAt: input.now.toISOString()
          },
          closeActor
        );

        items.push({
          objectType: "oracle_lifecycle_close_condition_item",
          marketId: context.marketId,
          marketTitle: context.marketTitle,
          sourceFamily: adapter.sourceFamily,
          sourceUrl: inspection.sourceUrl,
          status: inspection.status,
          closeConditionSatisfied: true,
          action: "closed_market",
          close,
          reason: `${inspection.claimSummary} Closed trading from terminal official evidence; payout still requires a resolution case and human approval.`
        });
      } catch (error) {
        items.push({
          objectType: "oracle_lifecycle_close_condition_item",
          marketId: context.marketId,
          marketTitle: context.marketTitle,
          sourceFamily: adapter.sourceFamily,
          sourceUrl: inspection.sourceUrl,
          status: inspection.status,
          closeConditionSatisfied: true,
          action: "skipped_close_failed",
          reason: error instanceof Error ? error.message : String(error)
        });
      }
      continue;
    }

    const result = await inspectOracleMarket(
      dbPool,
      {
        marketId: context.marketId,
        caseType: "close_condition_check",
        sources: [
          {
            sourceUrl: inspection.sourceUrl,
            sourceLabel: adapter.sourceLabel,
            sourceType: "official",
            claimSummary: `${inspection.claimSummary} Snapshot hash: ${inspection.rawHash}.`,
            capturedAt: input.now.toISOString()
          }
        ],
        closeConditionSatisfied: true,
        evidenceSummary: inspection.claimSummary,
        reasonSummary: inspection.claimSummary,
        requiresHumanReview: context.eventCompletionCloseRequiresHumanApproval,
        capturedAt: input.now.toISOString()
      },
      {
        persistResult: true
      }
    );

    items.push({
      objectType: "oracle_lifecycle_close_condition_item",
      marketId: context.marketId,
      marketTitle: context.marketTitle,
      sourceFamily: adapter.sourceFamily,
      sourceUrl: inspection.sourceUrl,
      status: inspection.status,
      closeConditionSatisfied: true,
      action: "created_case",
      oracleCaseId: result.oracleCase.oracleCaseId,
      reason: inspection.claimSummary
    });
  }

  return items;
}
