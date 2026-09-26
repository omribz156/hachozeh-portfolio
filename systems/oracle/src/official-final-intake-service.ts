import type { Pool } from "pg";

import {
  closeMarket,
  HORIZON_SYSTEM_ACTOR,
  insertLifecycleEvent
} from "../../back/src/platform-surface/oracle";
import { planDependentResolutionCascade } from "../../back/src/lifecycle/events/dependent-resolution-cascade-planner";
import { inspectOracleMarket } from "./inspect-market-service";
import {
  buildSourceContext,
  findWinningOutcomeForInspection,
  readClosedNoCaseMarkets,
  readMarketOutcomes,
  readOfficialStatus,
  resolveContractOutcomeKey
} from "./official-final-context";
import {
  classifyOracleLifecycleSupport,
  findOracleLifecycleSourceAdapter
} from "./source-adapter-registry";
import type { OracleSourceInspection } from "./source-adapter-contracts";
import { normalizeOracleLimit } from "./oracle-options";
import { createTradingViewFxSnapshotFetchJson } from "./tradingview-fx-snapshot-service";

type FetchJson = (url: string) => Promise<unknown>;
type FetchText = (url: string) => Promise<string>;

export type OracleOfficialFinalIntakeItem = {
  objectType: "oracle_official_final_intake_item";
  marketId: string;
  marketTitle: string;
  action:
    | "created_case"
    | "skipped_unsupported_source"
    | "skipped_not_final"
    | "skipped_tied_score"
    | "skipped_no_matching_outcome"
    | "skipped_fetch_failed";
  sourceUrl: string | null;
  officialJsonUrl: string | null;
  officialStatus: string | null;
  sourceFetchedAt?: string | null;
  sourceRawHash?: string | null;
  sourceSnapshot?: unknown;
  winningOutcomeId?: string | null;
  winningOutcomeKey: string | null;
  winningOutcomeLabel: string | null;
  oracleCaseId?: string;
  evidencePacketId?: string;
  resolutionRecommendationId?: string;
  protectedDependentMarketIds?: string[];
  approvalRequired: boolean;
  reason: string;
};

export async function protectDependentMarketsFromOfficialFinal(input: {
  dbPool: Pool;
  triggerMarketId: string;
  winningOutcomeId: string;
  oracleCaseId?: string | null;
  evidenceKey: string;
  sourceUrl: string;
  claimSummary: string;
  generatedAt: string;
}, dependencies: {
  plan?: typeof planDependentResolutionCascade;
  close?: typeof closeMarket;
} = {}): Promise<string[]> {
  const plan = await (dependencies.plan ?? planDependentResolutionCascade)(input.dbPool, {
    triggerMarketId: input.triggerMarketId,
    triggerWinningOutcomeId: input.winningOutcomeId,
    approvedByHuman: false,
    trustedOfficialFinal: true,
    oracleCaseId: input.oracleCaseId ?? null
  });
  if (plan.action !== "resolve_dependents_no") return [];

  const closed: string[] = [];
  for (const action of plan.dependentActions) {
    if (action.currentStatus !== "open") continue;
    await (dependencies.close ?? closeMarket)(
      input.dbPool,
      action.marketId,
      {
        triggerType: "oracle_confirmed_event_completion",
        reason: `${action.entityLabel} was eliminated by canonical official final evidence.`,
        sourceUrl: input.sourceUrl,
        note: `${input.claimSummary} Protective close only; resolution still requires human approval.`,
        oracleCaseId: input.oracleCaseId ?? null,
        triggeredByOracleId: "oracle",
        approvedByHumanId: null,
        idempotencyKey: `official-final-protective-close:${input.triggerMarketId}:${input.evidenceKey}:${action.marketId}`,
        requestedAt: input.generatedAt
      },
      HORIZON_SYSTEM_ACTOR
    );
    closed.push(action.marketId);
  }
  return closed;
}

export type OracleOfficialFinalIntakeResult = {
  objectType: "oracle_official_final_intake_result";
  generatedAt: string;
  marketId: string | null;
  checkedMarketCount: number;
  createdCaseCount: number;
  skippedCount: number;
  items: OracleOfficialFinalIntakeItem[];
  recommendations: string[];
};

export type RunOracleOfficialFinalIntakeOptions = {
  marketId?: string;
  limit?: number;
  fetchJson?: FetchJson;
  fetchText?: FetchText;
  now?: Date;
};

function buildRecommendations(result: OracleOfficialFinalIntakeResult): string[] {
  const recommendations: string[] = [];

  if (result.createdCaseCount > 0) {
    recommendations.push(
      "Official final evidence was promoted into Oracle resolution cases. Human approval is still required before Resolve."
    );
  }

  if (
    result.items.some(
      (item) =>
        item.action === "skipped_not_final" ||
        item.action === "skipped_no_matching_outcome" ||
        item.action === "skipped_fetch_failed"
    )
  ) {
    recommendations.push(
      "Some closed markets still need operator review before a resolution case can be trusted."
    );
  }

  if (result.checkedMarketCount === 0) {
    recommendations.push("No closed unresolved markets without resolution cases matched this intake pass.");
  }

  return recommendations;
}

export async function runOracleOfficialFinalIntake(
  dbPool: Pool,
  options?: RunOracleOfficialFinalIntakeOptions
): Promise<OracleOfficialFinalIntakeResult> {
  const generatedAt = (options?.now ?? new Date()).toISOString();
  const fetchJson = options?.fetchJson;
  const markets = await readClosedNoCaseMarkets(dbPool, {
    marketId: options?.marketId,
    limit: normalizeOracleLimit(options?.limit)
  });
  const items: OracleOfficialFinalIntakeItem[] = [];

  for (const market of markets) {
    const outcomes = await readMarketOutcomes(dbPool, market.market_id);
    const context = buildSourceContext(market, outcomes);
    const capability = classifyOracleLifecycleSupport(context);
    const adapter = findOracleLifecycleSourceAdapter(context);
    const blockingCapability = capability.blockers.find(
      (blocker) => blocker.blockerCode !== "manual_resolution_required"
    );

    if (!adapter || !capability.resolution.supported || blockingCapability) {
      items.push({
        objectType: "oracle_official_final_intake_item",
        marketId: market.market_id,
        marketTitle: market.market_title,
        action: "skipped_unsupported_source",
        sourceUrl: context.resolutionSource || market.resolution_source,
        officialJsonUrl: null,
        officialStatus: null,
        winningOutcomeKey: null,
        winningOutcomeLabel: null,
        approvalRequired: true,
        reason:
          blockingCapability?.reason ??
          "No supported official source adapter found for this market's resolution source."
      });
      continue;
    }

    let sourceInspection: OracleSourceInspection;

    try {
      sourceInspection = await adapter.inspectResolution(context, {
        fetchJson:
          fetchJson ??
          (adapter.sourceFamily === "tradingview_fx"
            ? createTradingViewFxSnapshotFetchJson(dbPool)
            : undefined),
        fetchText: options?.fetchText,
        now: options?.now
      });
    } catch (error) {
      items.push({
        objectType: "oracle_official_final_intake_item",
        marketId: market.market_id,
        marketTitle: market.market_title,
        action: "skipped_fetch_failed",
        sourceUrl: market.resolution_source,
        officialJsonUrl: null,
        officialStatus: null,
        winningOutcomeKey: null,
        winningOutcomeLabel: null,
        approvalRequired: true,
        reason: error instanceof Error ? error.message : String(error)
      });
      continue;
    }

    if (sourceInspection.blockers.length > 0) {
      items.push({
        objectType: "oracle_official_final_intake_item",
        marketId: market.market_id,
        marketTitle: market.market_title,
        action: "skipped_fetch_failed",
        sourceUrl: sourceInspection.sourceUrl || market.resolution_source,
        officialJsonUrl: sourceInspection.officialJsonUrl ?? null,
        officialStatus: readOfficialStatus(sourceInspection),
        sourceFetchedAt: sourceInspection.fetchedAt,
        sourceRawHash: sourceInspection.rawHash,
        sourceSnapshot: sourceInspection.normalizedSnapshot,
        winningOutcomeKey: null,
        winningOutcomeLabel: null,
        approvalRequired: true,
        reason: sourceInspection.blockers.join("; ")
      });
      continue;
    }

    if (!sourceInspection.resolutionAvailable || sourceInspection.status !== "final") {
      const officialStatus = readOfficialStatus(sourceInspection);

      items.push({
        objectType: "oracle_official_final_intake_item",
        marketId: market.market_id,
        marketTitle: market.market_title,
        action: "skipped_not_final",
        sourceUrl: sourceInspection.sourceUrl,
        officialJsonUrl: sourceInspection.officialJsonUrl ?? null,
        officialStatus,
        winningOutcomeKey: null,
        winningOutcomeLabel: null,
        approvalRequired: true,
        reason: "Official source status is not final yet."
      });
      await insertLifecycleEvent(dbPool, {
        marketId: market.market_id,
        eventType: "official_source_not_ready",
        sourceSystem: "oracle",
        actorId: "system:oracle",
        occurredAt: generatedAt,
        correlationId: sourceInspection.rawHash,
        dedupeKey: `official_source_not_ready:${market.market_id}:${officialStatus}`,
        payload: {
          sourceUrl: sourceInspection.sourceUrl,
          officialJsonUrl: sourceInspection.officialJsonUrl ?? null,
          officialStatus,
          reason: "Official source status is not final yet."
        }
      });
      continue;
    }

    const winningOutcome = findWinningOutcomeForInspection(context, outcomes, sourceInspection);

    if (sourceInspection.winnerKind === "draw" && !winningOutcome) {
      items.push({
        objectType: "oracle_official_final_intake_item",
        marketId: market.market_id,
        marketTitle: market.market_title,
        action: "skipped_tied_score",
        sourceUrl: sourceInspection.sourceUrl,
        officialJsonUrl: sourceInspection.officialJsonUrl ?? null,
        officialStatus: readOfficialStatus(sourceInspection),
        winningOutcomeKey: null,
        winningOutcomeLabel: sourceInspection.winnerLabel ?? "draw",
        approvalRequired: true,
        reason: "Official final score is tied, but no draw outcome could be mapped."
      });
      continue;
    }

    if (!winningOutcome) {
      items.push({
        objectType: "oracle_official_final_intake_item",
        marketId: market.market_id,
        marketTitle: market.market_title,
        action: "skipped_no_matching_outcome",
        sourceUrl: sourceInspection.sourceUrl,
        officialJsonUrl: sourceInspection.officialJsonUrl ?? null,
        officialStatus: readOfficialStatus(sourceInspection),
        winningOutcomeKey: null,
        winningOutcomeLabel: sourceInspection.winnerLabel ?? null,
        approvalRequired: true,
        reason: `Official winner "${sourceInspection.winnerLabel ?? "unknown"}" did not map to a listed market outcome.`
      });
      continue;
    }

    const winningOutcomeKey = resolveContractOutcomeKey(context, winningOutcome);
    const claimSummary = sourceInspection.claimSummary;
    const protectedDependentMarketIds = await protectDependentMarketsFromOfficialFinal({
      dbPool,
      triggerMarketId: market.market_id,
      winningOutcomeId: winningOutcome.id,
      evidenceKey: sourceInspection.rawHash,
      sourceUrl: sourceInspection.sourceUrl,
      claimSummary,
      generatedAt
    });

    const inspectionResult = await inspectOracleMarket(
      dbPool,
      {
        marketId: market.market_id,
        caseType: "resolution_check",
        sources: [
          {
            sourceUrl: sourceInspection.sourceUrl,
            sourceLabel: adapter.sourceLabel,
            sourceType: "official",
            claimSummary: `${claimSummary} Snapshot hash: ${sourceInspection.rawHash}.`,
            capturedAt: generatedAt
          }
        ],
        winningOutcomeId: winningOutcome.id,
        evidenceSummary: claimSummary,
        reasonSummary: claimSummary,
        resolvedAtObserved: generatedAt,
        requiresHumanReview: true,
        capturedAt: generatedAt
      },
      {
        persistResult: true
      }
    );

    items.push({
      objectType: "oracle_official_final_intake_item",
      marketId: market.market_id,
      marketTitle: market.market_title,
      action: "created_case",
      sourceUrl: sourceInspection.sourceUrl,
      officialJsonUrl: sourceInspection.officialJsonUrl ?? null,
      officialStatus: readOfficialStatus(sourceInspection),
      winningOutcomeId: winningOutcome.id,
      winningOutcomeKey,
      winningOutcomeLabel: winningOutcome.label,
      oracleCaseId: inspectionResult.oracleCase.oracleCaseId,
      evidencePacketId: inspectionResult.evidencePacket.evidencePacketId,
      resolutionRecommendationId:
        inspectionResult.output.objectType === "resolution_recommendation"
          ? inspectionResult.output.resolutionRecommendationId
          : undefined,
      protectedDependentMarketIds,
      approvalRequired: true,
      reason: "Official final result mapped to a market outcome and created a human-gated Oracle resolution case."
    });
    await insertLifecycleEvent(dbPool, {
      marketId: market.market_id,
      eventType: "resolution_case_created",
      sourceSystem: "oracle",
      actorId: "system:oracle",
      occurredAt: generatedAt,
      correlationId: inspectionResult.oracleCase.oracleCaseId,
      dedupeKey: `resolution_case_created:${inspectionResult.oracleCase.oracleCaseId}`,
      oracleCaseId: inspectionResult.oracleCase.oracleCaseId,
      payload: {
        sourceUrl: sourceInspection.sourceUrl,
        officialJsonUrl: sourceInspection.officialJsonUrl ?? null,
        officialStatus: readOfficialStatus(sourceInspection),
        winningOutcomeId: winningOutcome.id,
        winningOutcomeKey,
        winningOutcomeLabel: winningOutcome.label,
        evidencePacketId: inspectionResult.evidencePacket.evidencePacketId,
        resolutionRecommendationId:
          inspectionResult.output.objectType === "resolution_recommendation"
            ? inspectionResult.output.resolutionRecommendationId
            : null
      }
    });
  }

  const result: OracleOfficialFinalIntakeResult = {
    objectType: "oracle_official_final_intake_result",
    generatedAt,
    marketId: options?.marketId ?? null,
    checkedMarketCount: markets.length,
    createdCaseCount: items.filter((item) => item.action === "created_case").length,
    skippedCount: items.filter((item) => item.action !== "created_case").length,
    items,
    recommendations: []
  };

  return {
    ...result,
    recommendations: buildRecommendations(result)
  };
}
